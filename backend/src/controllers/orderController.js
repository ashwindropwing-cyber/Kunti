const MasterOrder = require("../models/masterOrder");
const Rider = require("../models/rider");
const Wallet = require("../models/wallet");
const WalletTransaction = require("../models/walletTransaction");
const Product = require("../models/product");
const Cart = require("../models/cart");
const CartItem = require("../models/cartItem");
const User = require("../models/user");
const OrderItem = require("../models/orderItem");
const Review = require("../models/review");
const CustomerAddress = require("../models/customerAddress");
const RefundRequest = require("../models/refundRequest");
const PlatformSettings = require("../models/platformSettings");
const { admin, db, isFirebaseReady, firestore } = require("../config/firebase");

const redisClient = require("../config/redis");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { sendEmail } = require("../utils/sendEmail");

const COMMISSION_PERCENT = 7;
const MAX_BROADCAST_RIDERS = 10;
const SINGLE_OFFER_TIMEOUT_MS = 30000;

async function clearPatternKeys(pattern) {
  for await (const scanned of redisClient.scanIterator({ MATCH: pattern })) {
    const keys = Array.isArray(scanned) ? scanned : [scanned];
    for (const key of keys) {
      if (typeof key === "string" && key.length > 0) {
        try {
          await redisClient.del(key);
        } catch (error) {
          console.error("Redis DEL error:", error.message);
        }
      }
    }
  }
}

// Helper to handle wallet settlements when an order is delivered
async function settleOrderWallets(masterOrder) {
  // If already settled, do not settle again to prevent double-spending
  if (masterOrder.is_settled) return;

  const orderId = masterOrder.id;

  try {
    await firestore.runTransaction(async (transaction) => {
      // 1. Get latest order document to check is_settled atomically
      const orderRef = firestore.collection("master_orders").doc(orderId);
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new Error("Order not found");
      }
      const orderData = orderSnap.data();
      if (orderData.is_settled) {
        return; // Already settled
      }

      const riderEarningFee = parseFloat(orderData.distance_fee) || 0;
      const riderTip = parseFloat(orderData.rider_tip) || 0;
      const sellerAmount = parseFloat(orderData.seller_amount) || 0;
      const totalOrderAmount = parseFloat(orderData.total_amount) || 0;
      const paymentMethod = orderData.payment_method;

      // Prepare updates and creations
      const updates = [];
      const creations = [];

      // ============================================
      // 1. Rider Settlement
      // ============================================
      if (orderData.rider_id) {
        const riderRef = firestore.collection("riders").doc(orderData.rider_id);
        const riderSnap = await transaction.get(riderRef);
        if (riderSnap.exists) {
          const riderData = riderSnap.data();
          const riderUserId = riderData.user_id;

          // Create transactions
          if (riderEarningFee > 0) {
            creations.push({
              ref: firestore.collection("wallet_transactions").doc(),
              data: {
                user_id: riderUserId,
                type: "CREDIT",
                amount: riderEarningFee,
                source: "DELIVERY_EARNING",
                description: `Delivery fee for order ${orderId}`,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            });
          }

          if (riderTip > 0) {
            creations.push({
              ref: firestore.collection("wallet_transactions").doc(),
              data: {
                user_id: riderUserId,
                type: "CREDIT",
                amount: riderTip,
                source: "RIDER_TIP",
                description: `Tip for order ${orderId}`,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            });
          }

          if (paymentMethod === "COD") {
            creations.push({
              ref: firestore.collection("wallet_transactions").doc(),
              data: {
                user_id: riderUserId,
                type: "DEBIT",
                amount: totalOrderAmount,
                source: "COD_COLLECTED",
                description: `Cash collected for COD order ${orderId}`,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            });
          }

          // Fetch Rider Wallet
          const walletQuery = firestore.collection("wallets").where("user_id", "==", riderUserId).limit(1);
          const walletSnap = await transaction.get(walletQuery);
          if (!walletSnap.empty) {
            const walletDoc = walletSnap.docs[0];
            const walletData = walletDoc.data();
            let netChange = riderEarningFee + riderTip;
            if (paymentMethod === "COD") {
              netChange -= totalOrderAmount;
            }
            updates.push({
              ref: walletDoc.ref,
              data: {
                available_balance: (parseFloat(walletData.available_balance) || 0) + netChange,
                total_earned: (parseFloat(walletData.total_earned) || 0) + riderEarningFee + riderTip,
                updatedAt: new Date()
              }
            });
          } else {
            let netChange = riderEarningFee + riderTip;
            if (paymentMethod === "COD") {
              netChange -= totalOrderAmount;
            }
            creations.push({
              ref: firestore.collection("wallets").doc(),
              data: {
                user_id: riderUserId,
                available_balance: netChange,
                pending_balance: 0,
                total_earned: riderEarningFee + riderTip,
                total_withdrawn: 0,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            });
          }
        }
      }

      // ============================================
      // 2. Admin Settlement (Single Shop)
      // ============================================
      // Admin gets the entire order value minus what's paid to the rider.
      const netAdminAmount = totalOrderAmount - (riderEarningFee + riderTip);

      if (netAdminAmount !== 0) {
        const adminUserQuery = firestore.collection("users").where("role", "==", "ADMIN").limit(1);
        const adminUserSnap = await transaction.get(adminUserQuery);
        if (!adminUserSnap.empty) {
          const adminUserId = adminUserSnap.docs[0].id;

          creations.push({
            ref: firestore.collection("wallet_transactions").doc(),
            data: {
              user_id: adminUserId,
              type: netAdminAmount > 0 ? "CREDIT" : "DEBIT",
              amount: Math.abs(netAdminAmount),
              source: "ORDER_REVENUE",
              description: `Revenue for order ${orderId} (Net of rider fees)`,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });

          // Fetch Admin Wallet
          const walletQuery = firestore.collection("wallets").where("user_id", "==", adminUserId).limit(1);
          const walletSnap = await transaction.get(walletQuery);
          if (!walletSnap.empty) {
            const walletDoc = walletSnap.docs[0];
            const walletData = walletDoc.data();
            updates.push({
              ref: walletDoc.ref,
              data: {
                available_balance: (parseFloat(walletData.available_balance) || 0) + netAdminAmount,
                total_earned: (parseFloat(walletData.total_earned) || 0) + Math.max(0, netAdminAmount),
                updatedAt: new Date()
              }
            });
          } else {
            creations.push({
              ref: firestore.collection("wallets").doc(),
              data: {
                user_id: adminUserId,
                available_balance: netAdminAmount,
                pending_balance: 0,
                total_earned: Math.max(0, netAdminAmount),
                total_withdrawn: 0,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            });
          }
        }
      }

      // Execute all creations and updates
      creations.forEach(c => transaction.set(c.ref, c.data));
      updates.forEach(u => transaction.update(u.ref, u.data));

      // Mark order as settled
      transaction.update(orderRef, {
        is_settled: true,
        updatedAt: new Date()
      });
    });

    console.log(`✅ Order ${orderId} settled successfully via Firestore Transaction.`);
    masterOrder.is_settled = true; // Sync local object state
    // BUG-01 FIX: persist is_settled = true to MySQL so the settlement cron
    // (processSettlements) never picks up this order again.
    await masterOrder.save();
  } catch (error) {
    console.error("❌ settleOrderWallets transaction failed:", error.message);
    throw error;
  }
}

async function clearOrderRelatedCaches({ masterOrderId, customerId, riderId }) {
  const keys = [];
  if (masterOrderId) {
    keys.push(`populated_order_${masterOrderId}`);
  }
  if (customerId) {
    keys.push(`customer_orders_${customerId}`);
  }
  if (riderId) {
    keys.push(`rider_orders_${riderId}`);
    if (masterOrderId) keys.push(`rider_order_${riderId}_${masterOrderId}`);
  }
  for (const key of keys) {
    if (typeof key === "string" && key.length > 0) {
      try {
        await redisClient.del(key);
      } catch (error) {
        console.error("Redis DEL error:", error.message);
      }
    }
  }
}
function getOrderTrackingPath(masterOrderId) {
  return `tracking/orders/${masterOrderId}`;
}
function exceedsCodLimit(orderTotal, riderCodLimit) {
  return parseFloat(orderTotal) > parseFloat(riderCodLimit);
}
const { calculateDistance, calculateRoadDistance } = require("../utils/geoUtils");
const { optimizeCloudinaryUrl, CLOUDINARY_TRANSFORMATIONS } = require("../utils/cloudinaryUtils");

function formatSecondsToMMSS(seconds) {
  if (!seconds || seconds <= 0) return "00:00";

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  const paddedMins = String(mins).padStart(2, "0");
  const paddedSecs = String(secs).padStart(2, "0");

  return `${paddedMins}:${paddedSecs}`;
}

async function populateMasterOrderData(order) {
  if (!order) return order;

  const orderId = order.id || (typeof order === 'string' ? order : null);
  if (!orderId) return order;

  // 0. Check Redis Cache First to prevent Firestore Quota Exceeded
  const cacheKey = `populated_order_${orderId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn("Redis Cache Get Error:", err.message);
  }

  // Convert to plain object if it's a Sequelize model instance
  const orderObj = typeof order.toJSON === 'function' ? order.toJSON() : { ...order };
  // If order was passed as a string/id only, we'd need to fetch it here, 
  // but usually we pass the object.

  try {


    // 2. Fetch Delivery Address
    if (orderObj.delivery_address_id) {
      const address = await CustomerAddress.findByPk(orderObj.delivery_address_id);
      if (address) {
        orderObj.delivery_address = {
          id: address.id,
          label: address.label,
          house_no: address.house_no,
          area: address.area,
          landmark: address.landmark,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          latitude: address.latitude,
          longitude: address.longitude,
          name: address.name,
          phone_number: address.phone_number,
        };
      }
    }

    // 3. Fetch Order Items & Products
    const items = await OrderItem.findAll({ where: { master_order_id: orderObj.id } });
    if (items && items.length > 0) {
      const productIds = [...new Set(items.map(item => item.product_id).filter(Boolean))];
      let products = [];
      if (productIds.length > 0) {
        products = await Product.findAll({ where: { id: { in: productIds } } });
      }
      const productMap = products.reduce((acc, p) => {
        acc[p.id] = p;
        return acc;
      }, {});

      const plainItems = [];
      for (const item of items) {
        const itemObj = typeof item.toJSON === 'function' ? item.toJSON() : { ...item };
        if (itemObj.product_id) {
          const product = productMap[itemObj.product_id];
          if (product) {
            itemObj.Product = {
              id: product.id,
              name: product.name,
              image_url: product.image_url,
              selling_price: product.selling_price,
              description: product.description,
            };
          }
        }
        plainItems.push(itemObj);
      }
      orderObj.items = plainItems;
    } else {
      orderObj.items = [];
    }

    // 4. Fetch Rider & User (if assigned)
    if (orderObj.rider_id) {
      const rider = await Rider.findByPk(orderObj.rider_id);
      if (rider) {
        orderObj.rider = {
          id: rider.id,
          current_lat: rider.current_lat,
          current_lng: rider.current_lng,
          profile_picture_url: rider.profile_picture_url,
        };
        if (rider.user_id) {
          const user = await User.findByPk(rider.user_id);
          if (user) {
            orderObj.rider.User = { name: user.name, phone: user.phone };
          }
        }
      }
    }

    // 5. Fetch Customer (User)
    if (orderObj.customer_id) {
      const user = await User.findByPk(orderObj.customer_id);
      if (user) {
        orderObj.customer = { id: user.id, name: user.name, phone: user.phone };
        // Fallback top-level fields
        orderObj.customer_name = orderObj.customer_name || user.name;
        orderObj.customer_phone = orderObj.customer_phone || user.phone;
      }
    }

    // 5.5 Override customer name/phone from delivery address if provided
    if (orderObj.delivery_address) {
      if (orderObj.delivery_address.name) {
        orderObj.customer_name = orderObj.delivery_address.name;
      }
      if (orderObj.delivery_address.phone_number) {
        orderObj.customer_phone = orderObj.delivery_address.phone_number;
      }

      if (orderObj.is_for_friend) {
        orderObj.customer_name = orderObj.friend_name;
        orderObj.customer_phone = orderObj.friend_phone;
        orderObj.delivery_address.name = orderObj.friend_name;
        orderObj.delivery_address.phone_number = orderObj.friend_phone;
      }

      // Flatten address to a professional string
      const addr = orderObj.delivery_address;
      orderObj.delivery_address_text = [
        addr.house_no,
        addr.area,
        addr.landmark ? `(Near ${addr.landmark})` : null,
        addr.city,
        addr.pincode
      ].filter(Boolean).join(", ");

      orderObj.delivery_lat = addr.latitude;
      orderObj.delivery_lng = addr.longitude;
    }

    // 5.6 Fetch Refund Request
    try {
      const refunds = await RefundRequest.findAll({ where: { master_order_id: orderObj.id } });
      if (refunds && refunds.length > 0) {
        // Sort by createdAt descending (assuming Firebase timestamps or ID sorting)
        const latestRefund = refunds.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        orderObj.refund_request = latestRefund;
      }
    } catch (err) {
      console.warn("Failed to fetch refund request:", err.message);
    }

    // 6. Format Dates and Meta for Frontend (Production Level)
    const settings = await PlatformSettings.findAll({
      where: { key: ["shop_lat", "shop_lng", "shop_name"] }
    });
    let shopLat = null, shopLng = null, shopName = null;
    settings.forEach(s => {
      if (s.key === "shop_lat") shopLat = parseFloat(s.value);
      if (s.key === "shop_lng") shopLng = parseFloat(s.value);
      if (s.key === "shop_name") shopName = s.value;
    });

    _formatOrderMeta(orderObj, shopLat, shopLng, shopName);

    // 7. Save to Cache for 60 seconds
    try {
      await redisClient.set(cacheKey, JSON.stringify(orderObj), { EX: 60 });
    } catch (cacheErr) {
      console.warn("Redis Cache Set Error:", cacheErr.message);
    }

  } catch (error) {
    console.error(`[populateMasterOrderData] Error populating order ${orderObj.id}:`, error.message);
  }

  return orderObj;
}

/**
 * Shared helper: compute derived fields on an order object.
 * Used by both populateMasterOrderData and populateMasterOrdersBatch.
 */
function _formatOrderMeta(orderObj, shopLat = null, shopLng = null, shopName = null) {
  orderObj.order_value = Number((orderObj.total_amount - (orderObj.delivery_fee || 0) - (orderObj.rider_tip || 0)).toFixed(2));

  if (shopName) {
    orderObj.pickup_address = shopName;
    orderObj.pickup_lat = shopLat;
    orderObj.pickup_lng = shopLng;
  }

  orderObj.payment_type = orderObj.payment_method ? orderObj.payment_method.toLowerCase() : "online";

  if (orderObj.createdAt && typeof orderObj.createdAt.toDate === 'function') {
    orderObj.created_at = orderObj.createdAt.toDate().toISOString();
  } else if (orderObj.createdAt instanceof Date) {
    orderObj.created_at = orderObj.createdAt.toISOString();
  } else {
    orderObj.created_at = new Date().toISOString();
  }

  if (orderObj.updatedAt && typeof orderObj.updatedAt.toDate === 'function') {
    orderObj.updated_at = orderObj.updatedAt.toDate().toISOString();
  } else if (orderObj.updatedAt instanceof Date) {
    orderObj.updated_at = orderObj.updatedAt.toISOString();
  }
}

/**
 * Batch-populate an array of orders in bulk.
 * Instead of N sequential populateMasterOrderData calls (each doing 5-7 DB reads),
 * this fetches all related data in bulk and maps in-memory.
 * Reduces Firestore reads by ~85% for list endpoints.
 */
async function populateMasterOrdersBatch(orders) {
  if (!orders || orders.length === 0) return [];

  // Check Redis cache for each order, collect uncached ones
  const results = new Array(orders.length);
  const uncachedIndexes = [];

  for (let i = 0; i < orders.length; i++) {
    const orderId = orders[i].id;
    if (!orderId) { results[i] = orders[i]; continue; }
    const cacheKey = `populated_order_${orderId}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) { results[i] = JSON.parse(cached); continue; }
    } catch (_) { /* ignore cache miss */ }
    uncachedIndexes.push(i);
  }

  if (uncachedIndexes.length === 0) return results;

  // Convert uncached orders to plain objects
  const uncachedOrders = uncachedIndexes.map(i => {
    const o = orders[i];
    return typeof o.toJSON === 'function' ? o.toJSON() : { ...o };
  });

  try {
    // 1. Collect all unique IDs
    const addressIds = [...new Set(uncachedOrders.map(o => o.delivery_address_id).filter(Boolean))];
    const riderIds = [...new Set(uncachedOrders.map(o => o.rider_id).filter(Boolean))];
    const customerIds = [...new Set(uncachedOrders.map(o => o.customer_id).filter(Boolean))];
    const orderIds = uncachedOrders.map(o => o.id).filter(Boolean);

    // Fetch shop settings once for batch
    const settings = await PlatformSettings.findAll({
      where: { key: ["shop_lat", "shop_lng", "shop_name"] }
    });
    let shopLat = null, shopLng = null, shopName = null;
    settings.forEach(s => {
      if (s.key === "shop_lat") shopLat = parseFloat(s.value);
      if (s.key === "shop_lng") shopLng = parseFloat(s.value);
      if (s.key === "shop_name") shopName = s.value;
    });

    // 2. Bulk-fetch all related entities in parallel
    const [addresses, riders, customers, allOrderItems, allRefunds] = await Promise.all([
      addressIds.length > 0 ? CustomerAddress.findAll({ where: { id: { in: addressIds } } }) : [],
      riderIds.length > 0 ? Rider.findAll({ where: { id: { in: riderIds } } }) : [],
      customerIds.length > 0 ? User.findAll({ where: { id: { in: customerIds } } }) : [],
      orderIds.length > 0 ? OrderItem.findAll({ where: { master_order_id: { in: orderIds } } }) : [],
      orderIds.length > 0 ? RefundRequest.findAll({ where: { master_order_id: { in: orderIds } } }) : [],
    ]);

    // 3. Build lookup maps

    const addressMap = addresses.reduce((m, a) => { m[a.id] = a; return m; }, {});
    const riderMap = riders.reduce((m, r) => { m[r.id] = r; return m; }, {});
    const customerMap = customers.reduce((m, u) => { m[u.id] = u; return m; }, {});

    // Group order items by master_order_id
    const itemsByOrder = {};
    for (const item of allOrderItems) {
      if (!itemsByOrder[item.master_order_id]) itemsByOrder[item.master_order_id] = [];
      itemsByOrder[item.master_order_id].push(item);
    }

    // Group refunds by master_order_id
    const refundsByOrder = {};
    for (const refund of allRefunds) {
      if (!refundsByOrder[refund.master_order_id]) refundsByOrder[refund.master_order_id] = [];
      refundsByOrder[refund.master_order_id].push(refund);
    }

    // 4. Bulk-fetch products for all order items
    const allProductIds = [...new Set(allOrderItems.map(i => i.product_id).filter(Boolean))];
    let allProducts = [];
    if (allProductIds.length > 0) {
      // Firestore 'in' max = 30, chunk if needed
      for (let i = 0; i < allProductIds.length; i += 30) {
        const chunk = allProductIds.slice(i, i + 30);
        const batch = await Product.findAll({ where: { id: { in: chunk } } });
        allProducts = allProducts.concat(batch);
      }
    }
    const productMap = allProducts.reduce((m, p) => { m[p.id] = p; return m; }, {});

    // 5. Bulk-fetch rider users
    const riderUserIds = [...new Set(riders.map(r => r.user_id).filter(Boolean))];
    let riderUsers = [];
    if (riderUserIds.length > 0) {
      riderUsers = await User.findAll({ where: { id: { in: riderUserIds } } });
    }
    const riderUserMap = riderUsers.reduce((m, u) => { m[u.id] = u; return m; }, {});

    // 6. Assemble each order
    for (let idx = 0; idx < uncachedOrders.length; idx++) {
      const orderObj = uncachedOrders[idx];



      // Delivery Address
      if (orderObj.delivery_address_id && addressMap[orderObj.delivery_address_id]) {
        const a = addressMap[orderObj.delivery_address_id];
        orderObj.delivery_address = {
          id: a.id, label: a.label, house_no: a.house_no, area: a.area,
          landmark: a.landmark, city: a.city, state: a.state, pincode: a.pincode,
          latitude: a.latitude, longitude: a.longitude, name: a.name, phone_number: a.phone_number,
        };
      }

      // Order Items + Products
      const items = itemsByOrder[orderObj.id] || [];
      orderObj.items = items.map(item => {
        const itemObj = typeof item.toJSON === 'function' ? item.toJSON() : { ...item };
        if (itemObj.product_id && productMap[itemObj.product_id]) {
          const p = productMap[itemObj.product_id];
          itemObj.Product = { id: p.id, name: p.name, image_url: p.image_url, selling_price: p.selling_price, description: p.description };
        }
        return itemObj;
      });

      // Rider
      if (orderObj.rider_id && riderMap[orderObj.rider_id]) {
        const r = riderMap[orderObj.rider_id];
        orderObj.rider = { id: r.id, current_lat: r.current_lat, current_lng: r.current_lng, profile_picture_url: r.profile_picture_url };
        if (r.user_id && riderUserMap[r.user_id]) {
          const u = riderUserMap[r.user_id];
          orderObj.rider.User = { name: u.name, phone: u.phone };
        }
      }

      // Customer
      if (orderObj.customer_id && customerMap[orderObj.customer_id]) {
        const u = customerMap[orderObj.customer_id];
        orderObj.customer = { id: u.id, name: u.name, phone: u.phone };
        orderObj.customer_name = orderObj.customer_name || u.name;
        orderObj.customer_phone = orderObj.customer_phone || u.phone;
      }

      // Delivery address overrides
      if (orderObj.delivery_address) {
        if (orderObj.delivery_address.name) orderObj.customer_name = orderObj.delivery_address.name;
        if (orderObj.delivery_address.phone_number) orderObj.customer_phone = orderObj.delivery_address.phone_number;
        if (orderObj.is_for_friend) {
          orderObj.customer_name = orderObj.friend_name;
          orderObj.customer_phone = orderObj.friend_phone;
          orderObj.delivery_address.name = orderObj.friend_name;
          orderObj.delivery_address.phone_number = orderObj.friend_phone;
        }
        const addr = orderObj.delivery_address;
        orderObj.delivery_address_text = [addr.house_no, addr.area, addr.landmark ? `(Near ${addr.landmark})` : null, addr.city, addr.pincode].filter(Boolean).join(", ");
        orderObj.delivery_lat = addr.latitude;
        orderObj.delivery_lng = addr.longitude;
      }

      // Refund
      const refunds = refundsByOrder[orderObj.id] || [];
      if (refunds.length > 0) {
        orderObj.refund_request = refunds.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      }

      // Format meta
      _formatOrderMeta(orderObj, shopLat, shopLng, shopName);

      // Cache
      try {
        await redisClient.set(`populated_order_${orderObj.id}`, JSON.stringify(orderObj), { EX: 60 });
      } catch (_) { /* ignore */ }

      results[uncachedIndexes[idx]] = orderObj;
    }
  } catch (error) {
    console.error(`[populateMasterOrdersBatch] Error:`, error.message);
    // Fallback: populate individually for any that failed
    for (const idx of uncachedIndexes) {
      if (!results[idx]) {
        results[idx] = await populateMasterOrderData(orders[idx]);
      }
    }
  }

  return results;
}

function parseRejectedRiderIds(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getSortedEligibleRiders(masterOrder, excludedRiderIds = [], allAvailableRiders = null) {
  // 1. Get central shop coordinates
  const settings = await PlatformSettings.findAll();
  let shopLat = 0, shopLng = 0;
  settings.forEach(s => {
    if (s.key === "shop_lat") shopLat = parseFloat(s.value);
    if (s.key === "shop_lng") shopLng = parseFloat(s.value);
  });

  // 2. Get all riders who are online and verified
  const riders = allAvailableRiders || await Rider.findAll({
    where: {
      is_available: true,
      is_verified: true,
    },
  });

  if (riders.length === 0) return [];

  // 3. Filter in memory for coordinates, excluded IDs, delivery radius, and COD limits
  let filteredRiders = riders.filter(r => {
    if (r.current_lat === null || r.current_lng === null) return false;
    if (excludedRiderIds.includes(r.id)) return false;

    // Check delivery radius
    const distanceToShop = calculateDistance(
      shopLat,
      shopLng,
      r.current_lat,
      r.current_lng
    );

    const maxRadius = parseFloat(r.delivery_radius_km) || 5;
    if (distanceToShop > maxRadius) return false;

    // Check COD limit if order is COD
    if (masterOrder.payment_method === "COD") {
      const orderTotal = parseFloat(masterOrder.total_amount) || 0;
      const riderCodLimit = r.cod_limit !== undefined && r.cod_limit !== null ? parseFloat(r.cod_limit) : 1000;
      if (exceedsCodLimit(orderTotal, riderCodLimit)) {
        return false;
      }
    }

    // Save distance temporarily for sorting
    r._distanceToShop = distanceToShop;

    return true;
  });

  if (filteredRiders.length === 0) return [];

  // 4. Sort by distance to shop
  return filteredRiders.sort((a, b) => a._distanceToShop - b._distanceToShop);
}

async function sendOrderNotificationToRider(rider, masterOrder, mode) {
  if (rider && rider.order_notifications_enabled === false) {
    console.log(`[FCM] Notification skipped. Rider ${rider.id} disabled order notifications.`);
    return false;
  }
  const riderToken = rider?.fcm_token?.toString().trim();
  let token = riderToken;

  // Backward compatibility: recover token from linked user profile if rider doc is stale.
  if (!token && rider?.user_id) {
    const linkedUser = await User.findByPk(rider.user_id);
    const userToken = linkedUser?.fcm_token?.toString().trim();
    if (userToken) {
      token = userToken;
      rider.fcm_token = userToken;
      await rider.save();
    }
  }

  if (!token) {
    const availableKeys = rider ? Object.keys(rider.toJSON ? rider.toJSON() : rider) : 'NONE';
    console.warn(
      `[FCM] Rider ${rider?.id} has no token. Skipping order ${masterOrder?.id}. Available keys: ${availableKeys}`
    );
    return false;
  }

  const { PlatformSettings } = require("../models");
  const timeoutSetting = await PlatformSettings.findOne({ where: { key: "rider_order_request_timeout" } });
  let timeoutSeconds = 30;
  if (timeoutSetting && !isNaN(parseInt(timeoutSetting.value))) {
    timeoutSeconds = parseInt(timeoutSetting.value);
  }

  try {
    const messageId = await admin.messaging().send({
      token,
      notification: {
        title: "New delivery request",
        body: `Order #${masterOrder.id.slice(0, 8)} is available`,
      },
      data: {
        type: "NEW_ORDER_REQUEST",
        action: "OPEN_ORDER_OFFER",
        show_popup: "true",
        mode: String(mode || "SINGLE"),
        order_id: String(masterOrder.id),
        seller_id: String(masterOrder.seller_id),
        timeout_seconds: String(timeoutSeconds),
      },
      android: {
        priority: "high",
        ttl: timeoutSeconds * 1000,
        notification: {
          sound: "default",
          channelId: "high_importance_channel",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    console.log(
      `[FCM] Sent ${mode} order notification to rider ${rider.id} for order ${masterOrder.id} (${messageId})`
    );
    return true;
  } catch (error) {
    console.error(
      `[FCM] Failed for rider ${rider.id} order ${masterOrder.id}:`,
      error?.message || error
    );

    const errorCode = String(error?.code || "");
    const errorMessage = String(error?.message || "");

    // Check specifically for SenderId mismatch - this is a SERVER CONFIG error
    if (/SenderId mismatch/i.test(errorMessage) || errorCode === "messaging/mismatched-credential") {
      console.error(
        `[FCM] CRITICAL: SenderId mismatch detected. Your backend Firebase credentials (serviceAccountKey.json) do not match the Firebase project used by the mobile app. Check your FIREBASE_SERVICE_ACCOUNT env var.`
      );
      return false; // Do NOT clear the token, it's a server config issue
    }

    const isInvalidToken =
      errorCode === "messaging/registration-token-not-registered" ||
      errorCode === "messaging/invalid-registration-token";

    if (isInvalidToken && rider?.fcm_token) {
      try {
        console.warn(`[FCM] Clearing invalid/expired token for rider ${rider.id}`);
        const failedToken = rider.fcm_token?.toString().trim();
        rider.fcm_token = null;
        await rider.save();

        if (rider.user_id) {
          const linkedUser = await User.findByPk(rider.user_id);
          if (linkedUser?.fcm_token?.toString().trim() === failedToken) {
            linkedUser.fcm_token = null;
            await linkedUser.save();
          }
        }
      } catch (cleanupError) {
        console.error(`[FCM] Failed to clear bad token for rider ${rider.id}:`, cleanupError?.message || cleanupError);
      }
    }

    return false;
  }
}

async function notifyNearestSingleRider(masterOrderId) {
  const masterOrder = await MasterOrder.findByPk(masterOrderId);
  if (!masterOrder || masterOrder.status !== "PLACED" || masterOrder.rider_id) return;
  if (masterOrder.offered_rider_id) return masterOrder.offered_rider_id;

  const excluded = parseRejectedRiderIds(masterOrder.rider_rejected_ids);
  const riders = await getSortedEligibleRiders(masterOrder, excluded);

  for (const rider of riders) {
    try {
      console.log(`[Dispatch] Offering order ${masterOrder.id} to rider ${rider.id} (Single Offer)`);

      // ✅ Update DB FIRST so the rider app finds it immediately when notification arrives
      masterOrder.offered_rider_id = rider.id;
      await masterOrder.save();

      console.log(`[Dispatch] Database updated: offered_rider_id = ${rider.id} for order ${masterOrder.id}`);

      const sent = await sendOrderNotificationToRider(rider, masterOrder, "SINGLE");
      if (!sent) {
        console.warn(`[Dispatch] Notification failed for rider ${rider.id}. Clearing offer.`);
        // If notification failed, clear it so someone else can get it
        masterOrder.offered_rider_id = null;
        await masterOrder.save();
        continue;
      }

      return rider.id;
    } catch (error) {
      console.error("Failed to notify rider:", rider.id, error.message);
    }
  }
  return null;
}

// Helper to start the real fallback after fetching the dynamic timeout
async function _startSingleOfferFallback(masterOrderId, offeredRiderId) {
  const { PlatformSettings } = require("../models");
  const timeoutSetting = await PlatformSettings.findOne({ where: { key: "rider_order_request_timeout" } });
  let timeoutSeconds = 30;
  if (timeoutSetting && !isNaN(parseInt(timeoutSetting.value))) {
    timeoutSeconds = parseInt(timeoutSetting.value);
  }

  setTimeout(async () => {
    try {
      const latestOrder = await MasterOrder.findByPk(masterOrderId);
      if (!latestOrder || latestOrder.status !== "PLACED" || latestOrder.rider_id) return;
      if (latestOrder.offered_rider_id !== offeredRiderId) return;

      const rejectedIds = parseRejectedRiderIds(latestOrder.rider_rejected_ids);
      if (!rejectedIds.includes(offeredRiderId)) {
        rejectedIds.push(offeredRiderId);
      }
      latestOrder.rider_rejected_ids = JSON.stringify(rejectedIds);
      latestOrder.offered_rider_id = null;
      await latestOrder.save();
      console.log(`[Dispatch] Single offer timeout for rider ${offeredRiderId} on order ${masterOrderId}.`);
    } catch (error) {
      console.error("Single-offer fallback error:", error.message);
    }
  }, timeoutSeconds * 1000);
}

function scheduleSingleOfferFallback(masterOrderId, offeredRiderId) {
  if (!offeredRiderId) return;
  _startSingleOfferFallback(masterOrderId, offeredRiderId);
}

async function _startBroadcastFallback(masterOrderId, notifiedRiderIds) {
  const { PlatformSettings } = require("../models");
  const timeoutSetting = await PlatformSettings.findOne({ where: { key: "rider_order_request_timeout" } });
  let timeoutSeconds = 30;
  if (timeoutSetting && !isNaN(parseInt(timeoutSetting.value))) {
    timeoutSeconds = parseInt(timeoutSetting.value);
  }

  setTimeout(async () => {
    try {
      const latestOrder = await MasterOrder.findByPk(masterOrderId);
      // If order already assigned or not in PLACED status, stop
      if (!latestOrder || latestOrder.status !== "PLACED" || latestOrder.rider_id) return;

      const rejectedIds = parseRejectedRiderIds(latestOrder.rider_rejected_ids);
      let changed = false;
      for (const id of notifiedRiderIds) {
        if (!rejectedIds.includes(id)) {
          rejectedIds.push(id);
          changed = true;
        }
      }

      if (changed) {
        latestOrder.rider_rejected_ids = JSON.stringify(rejectedIds);
        await latestOrder.save();
        console.log(`[Dispatch] Broadcast batch timeout for order ${masterOrderId}. Retrying with next batch.`);
      }
    } catch (error) {
      console.error("Broadcast fallback error:", error.message);
    }
  }, timeoutSeconds * 1000);
}

exports.dispatchOrderToRiders = async (masterOrderId) => {
  const masterOrder = await MasterOrder.findByPk(masterOrderId);
  if (!masterOrder) return null;

  // For ONLINE payment orders, check if payment is successfully completed first
  if (masterOrder.payment_method === "ONLINE" && masterOrder.payment_status !== "PAID") {
    console.log(`[Dispatch] Skipping dispatch for unpaid ONLINE order ${masterOrderId}. (status: ${masterOrder.payment_status})`);
    return null;
  }

  // 1. Try single offer first
  const offeredRiderId = await notifyNearestSingleRider(masterOrderId);
  if (offeredRiderId) {
    scheduleSingleOfferFallback(masterOrderId, offeredRiderId);
    return offeredRiderId;
  }

  // 2. If no single offer could be made, move to broadcast
  console.log(`[Dispatch] No single riders available for order ${masterOrderId}. Moving to Broadcast mode.`);
  const broadcastRiderIds = await notifyNearestRidersBroadcast(masterOrderId);
  if (broadcastRiderIds && broadcastRiderIds.length > 0) {
    scheduleBroadcastFallback(masterOrderId, broadcastRiderIds);
    return 'BROADCAST';
  }

  console.log(`[Dispatch] No riders available at all for order ${masterOrderId}.`);
  return null;
};

async function markOrderTrackingStarted(masterOrder, rider) {
  if (!isFirebaseReady || !masterOrder || !rider) return;
  const now = Date.now();
  await db.ref(getOrderTrackingPath(masterOrder.id)).update({
    master_order_id: masterOrder.id,
    rider_id: rider.id,
    seller_id: masterOrder.seller_id,
    lat: rider.current_lat ?? null,
    lng: rider.current_lng ?? null,
    status: "OUT_FOR_DELIVERY",
    is_active: true,
    started_at: now,
    updated_at: now,
  });
}

async function markOrderTrackingClosed(masterOrderId, status) {
  if (!isFirebaseReady || !masterOrderId) return;
  const now = Date.now();
  await db.ref(getOrderTrackingPath(masterOrderId)).update({
    status,
    is_active: false,
    closed_at: now,
    updated_at: now,
  });
}

async function notifyNearestRidersBroadcast(masterOrderId, extraExcludedRiderIds = []) {
  const masterOrder = await MasterOrder.findByPk(masterOrderId);
  if (!masterOrder || masterOrder.status !== "PLACED" || masterOrder.rider_id) return [];

  const excluded = parseRejectedRiderIds(masterOrder.rider_rejected_ids);
  const riders = await getSortedEligibleRiders(masterOrder, excluded);
  const nearestBatch = riders.slice(0, MAX_BROADCAST_RIDERS);

  if (nearestBatch.length === 0) return [];

  await Promise.all(
    nearestBatch.map(async (rider) => {
      try {
        await sendOrderNotificationToRider(rider, masterOrder, "BROADCAST");
      } catch (error) {
        console.error("Broadcast notification failed:", rider.id, error.message);
      }
    })
  );

  return nearestBatch.map(r => r.id);
}

async function cleanupRiderOtherOffers(riderId) {
  try {
    const otherOffers = await MasterOrder.findAll({
      where: {
        status: "PLACED",
        offered_rider_id: riderId,
      }
    });

    for (const order of otherOffers) {
      console.log(`[Dispatch] Rider ${riderId} accepted another order. Re-dispatching order ${order.id}.`);
      order.offered_rider_id = null;
      await order.save();

      // Re-trigger dispatch for this order to find someone else
    }
  } catch (error) {
    console.error("[cleanupRiderOtherOffers] Error:", error.message);
  }
}
/**
 * =========================
 * CUSTOMER → PLACE ORDER
 * =========================
 */
exports.placeOrder = asyncHandler(async (req, res) => {
  try {
    const customerId = req.user.id;
    const { payment_method, delivery_address_id, rider_tip, is_for_friend, friend_name, friend_phone } = req.body;

    let tipAmount = parseFloat(rider_tip) || 0;
    if (tipAmount < 0) tipAmount = 0;

    if (!["ONLINE", "COD", "WALLET"].includes(payment_method)) {
      return ApiResponse.error(res, "Invalid payment method. Allowed: ONLINE, COD, or WALLET", 400);
    }

    if (!delivery_address_id) {
      return ApiResponse.error(res, "Delivery address required", 400);
    }

    const address = await CustomerAddress.findOne({
      where: { id: delivery_address_id, user_id: customerId },
    });

    if (!address) {
      return ApiResponse.error(res, "Invalid delivery address", 400);
    }

    const cart = await Cart.findOne({
      where: { user_id: customerId },
    });

    if (!cart) {
      return ApiResponse.error(res, "Cart is empty", 400);
    }

    const cartItems = await CartItem.findAll({
      where: { cart_id: cart.id }
    });

    if (cartItems.length === 0) {
      return ApiResponse.error(res, "Cart is empty", 400);
    }

    let totalAmount = 0;
    const productsToUpdate = [];

    // Batch-fetch all products at once instead of N individual queries
    const cartProductIds = [...new Set(cartItems.map(i => i.product_id))];
    let cartProducts = [];
    if (cartProductIds.length > 0) {
      cartProducts = await Product.findAll({ where: { id: { in: cartProductIds } } });
    }
    const cartProductMap = cartProducts.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

    for (const item of cartItems) {
      const product = cartProductMap[item.product_id];

      if (!product || product.quantity < item.quantity) {
        return ApiResponse.error(res, `Insufficient stock for ${product?.name || "product"}`, 400);
      }

      const price = parseFloat(product.selling_price);
      if (!Number.isFinite(price) || price <= 0) {
        return ApiResponse.error(res, `Invalid price for product: ${product.name}`, 400);
      }

      totalAmount += price * item.quantity;
      productsToUpdate.push({ product, quantity: item.quantity });
    }

    // Final NaN guard
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return ApiResponse.error(res, "Order total calculation failed. Please try again.", 400);
    }

    // Fetch all fee settings in one go
    const settings = await PlatformSettings.findAll({
      where: { key: ["shop_lat", "shop_lng", "free_delivery_threshold", "delivery_fee_0_to_3km", "delivery_fee_3_to_5km", "delivery_fee_5_to_8km", "rider_fee_0_to_3km", "rider_fee_3_to_5km", "rider_fee_5_to_8km"] }
    });

    let shopLat = 0, shopLng = 0;
    settings.forEach(s => {
      if (s.key === "shop_lat") shopLat = parseFloat(s.value);
      if (s.key === "shop_lng") shopLng = parseFloat(s.value);
    });

    const distance = await calculateRoadDistance(shopLat, shopLng, address.latitude, address.longitude, {
      addressId: address.id
    });

    let freeDeliveryThreshold = 500;
    let c_fee_0_to_3km = 12;
    let c_fee_3_to_5km = 18;
    let c_fee_5_to_8km = 28;
    let r_fee_0_to_3km = 12;
    let r_fee_3_to_5km = 18;
    let r_fee_5_to_8km = 28;

    for (const s of settings) {
      if (s.key === "free_delivery_threshold") freeDeliveryThreshold = parseFloat(s.value);
      if (s.key === "delivery_fee_0_to_3km") c_fee_0_to_3km = parseFloat(s.value);
      if (s.key === "delivery_fee_3_to_5km") c_fee_3_to_5km = parseFloat(s.value);
      if (s.key === "delivery_fee_5_to_8km") c_fee_5_to_8km = parseFloat(s.value);
      if (s.key === "rider_fee_0_to_3km") r_fee_0_to_3km = parseFloat(s.value);
      if (s.key === "rider_fee_3_to_5km") r_fee_3_to_5km = parseFloat(s.value);
      if (s.key === "rider_fee_5_to_8km") r_fee_5_to_8km = parseFloat(s.value);
    }

    let rawDeliveryFee = 0;
    let distanceFee = 0; // Rider earning

    if (distance <= 3) {
      rawDeliveryFee = c_fee_0_to_3km;
      distanceFee = r_fee_0_to_3km;
    } else if (distance <= 5) {
      rawDeliveryFee = c_fee_3_to_5km;
      distanceFee = r_fee_3_to_5km;
    } else if (distance <= 8) {
      rawDeliveryFee = c_fee_5_to_8km;
      distanceFee = r_fee_5_to_8km;
    } else {
      return ApiResponse.error(res, "Delivery not available beyond 8 KM", 400);
    }

    // BUG-H2 FIX: Use let instead of const — these are reassigned inside the transaction callback
    // Customer pays delivery fee only if order < threshold
    let deliveryFee = totalAmount < freeDeliveryThreshold ? rawDeliveryFee : 0;

    let finalTotal = Number((totalAmount + deliveryFee + tipAmount).toFixed(2));

    // Wallet balance verification before write operations
    let customerWallet = null;
    if (payment_method === "WALLET") {
      customerWallet = await Wallet.findOne({ where: { user_id: customerId } });
      if (!customerWallet || (parseFloat(customerWallet.available_balance) || 0) < finalTotal) {
        return ApiResponse.error(res, "Insufficient wallet balance", 400);
      }
    }

    let masterOrderId = "";
    try {
      await firestore.runTransaction(async (dbTx) => {
        // 1. Fetch products inside transaction and check stock
        const productRefs = cartItems.map(item => firestore.collection("products").doc(item.product_id));
        const productSnaps = await Promise.all(productRefs.map(ref => dbTx.get(ref)));

        // BUG-04 FIX: Recompute total from transaction-time product prices.
        // This ensures the charged amount matches current prices, not stale
        // pre-transaction prices that could have changed while the user was checking out.
        let txTotalAmount = 0;
        for (let i = 0; i < cartItems.length; i++) {
          const snap = productSnaps[i];
          const item = cartItems[i];
          if (!snap.exists) {
            throw new Error(`Product not found`);
          }
          const productData = snap.data();
          if (productData.quantity < item.quantity) {
            throw new Error(`Insufficient stock for ${productData.name || "product"}`);
          }
          const txPrice = parseFloat(productData.selling_price);
          if (!Number.isFinite(txPrice) || txPrice <= 0) {
            throw new Error(`Invalid price for product: ${productData.name}`);
          }
          txTotalAmount += txPrice * item.quantity;
        }
        txTotalAmount = Number(txTotalAmount.toFixed(2));

        // If product prices changed since cart was loaded, reject the order
        // so the customer sees the correct price before being charged.
        if (Math.abs(txTotalAmount - totalAmount) > 0.01) {
          throw new Error("Product prices have changed since you loaded your cart. Please refresh and review your order.");
        }

        // Recompute all financial fields from the verified transaction-time total
        const txDeliveryFee = txTotalAmount < freeDeliveryThreshold ? rawDeliveryFee : 0;
        const txFinalTotal = Number((txTotalAmount + txDeliveryFee + tipAmount).toFixed(2));

        // 2. Wallet balance verification if using WALLET
        let walletDoc = null;
        if (payment_method === "WALLET") {
          const walletQuery = firestore.collection("wallets").where("user_id", "==", customerId).limit(1);
          const walletSnapshot = await dbTx.get(walletQuery);
          if (walletSnapshot.empty) {
            throw new Error("Wallet not found. Please setup your wallet.");
          }
          walletDoc = walletSnapshot.docs[0];
          const walletData = walletDoc.data();
          if ((parseFloat(walletData.available_balance) || 0) < txFinalTotal) {
            throw new Error("Insufficient wallet balance");
          }
        }

        // Generate MasterOrder ID
        const masterOrderRef = firestore.collection("master_orders").doc();
        masterOrderId = masterOrderRef.id;

        // 3. Create OrderItems and update product stock inside transaction
        for (let i = 0; i < cartItems.length; i++) {
          const snap = productSnaps[i];
          const item = cartItems[i];
          const productData = snap.data();

          const orderItemRef = firestore.collection("order_items").doc();
          dbTx.set(orderItemRef, {
            id: orderItemRef.id,
            master_order_id: masterOrderId,
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_purchase: productData.selling_price,
            createdAt: new Date(),
            updatedAt: new Date()
          });

          let newQty = productData.quantity - item.quantity;
          let updateFields = { quantity: newQty, updatedAt: new Date() };
          if (newQty <= 0) {
            updateFields.quantity = 0;
            updateFields.is_active = false;
          }
          dbTx.update(snap.ref, updateFields);
        }

        // 4. Delete cart and cart items inside transaction
        const cartRef = firestore.collection("carts").doc(cart.id);
        dbTx.delete(cartRef);
        for (const item of cartItems) {
          const cartItemRef = firestore.collection("cart_items").doc(item.id);
          dbTx.delete(cartItemRef);
        }

        // 5. Create MasterOrder inside transaction using verified tx-time amounts
        dbTx.set(masterOrderRef, {
          id: masterOrderId,
          customer_id: customerId,
          delivery_address_id,
          total_amount: txFinalTotal,
          delivery_fee: txDeliveryFee,
          distance_fee: distanceFee,
          rider_tip: tipAmount,
          payment_method,
          is_paid: payment_method === "WALLET" ? true : false,
          payment_status: payment_method === "COD" ? "COD" : (payment_method === "WALLET" ? "PAID" : "PENDING"),
          status: "PLACED",
          is_settled: false,
          rider_id: null,
          offered_rider_id: null,
          is_for_friend: is_for_friend || false,
          friend_name: friend_name || null,
          friend_phone: friend_phone || null,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Store tx-time values back so post-transaction code (Razorpay, response) uses them
        finalTotal = txFinalTotal;
        deliveryFee = txDeliveryFee;

        // 6. Deduct wallet balance and create WalletTransaction if using WALLET
        if (payment_method === "WALLET" && walletDoc) {
          const newBalance = (parseFloat(walletDoc.data().available_balance) || 0) - txFinalTotal;
          dbTx.update(walletDoc.ref, {
            available_balance: newBalance,
            updatedAt: new Date()
          });

          const walletTxRef = firestore.collection("wallet_transactions").doc();
          dbTx.set(walletTxRef, {
            id: walletTxRef.id,
            user_id: customerId,
            master_order_id: masterOrderId,
            type: "DEBIT",
            amount: txFinalTotal,
            source: "ORDER_PAYMENT",
            description: `Paid for order #${masterOrderId.slice(0, 8)}`,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      });
    } catch (txError) {
      console.error("Checkout transaction failed:", txError.message);
      return ApiResponse.error(res, txError.message, 400);
    }

    let razorpayOrderId = "";
    let razorpayKeyId = "";
    if (payment_method === "ONLINE") {
      try {
        const razorpay = require("../config/razorpay");
        const razorpayOrder = await razorpay.orders.create({
          amount: Math.round(finalTotal * 100),
          currency: "INR",
          receipt: masterOrderId,
        });
        razorpayOrderId = razorpayOrder.id;
        razorpayKeyId = process.env.RAZORPAY_KEY_ID;

        const masterOrder = await MasterOrder.findByPk(masterOrderId);
        if (masterOrder) {
          masterOrder.razorpay_order_id = razorpayOrderId;
          await masterOrder.save();
        }
      } catch (razorpayError) {
        // If razorpay order creation fails, return error
        return ApiResponse.error(res, "Payment setup failed: " + razorpayError.message, 500);
      }
    }

    if (payment_method === "COD") {
      try {
      } catch (dispatchError) {
        console.error("⚠️ COD rider dispatch failed (non-fatal):", dispatchError.message);
      }
    }

    if (payment_method === "WALLET") {
      try {
      } catch (dispatchError) {
        console.error("⚠️ Wallet rider dispatch failed (non-fatal):", dispatchError.message);
      }
    }

    return ApiResponse.success(res, {
      master_order_id: masterOrderId,
      total_amount: Number(parseFloat(finalTotal).toFixed(2)),
      delivery_fee: Number(parseFloat(deliveryFee).toFixed(2)),
      payment_method,
      payment_required: payment_method === "ONLINE",
      razorpay_order_id: razorpayOrderId,
      razorpay_key_id: razorpayKeyId
    }, "Order placed successfully", 201);

  } catch (error) {
    throw error;
  }
});


/**
 * =========================
 * ADMIN → ASSIGN RIDER
 * =========================
 */
exports.assignRider = asyncHandler(async (req, res) => {
  try {
    const masterOrder = await MasterOrder.findByPk(req.params.id);

    if (!masterOrder) {
      return ApiResponse.error(res, "Order not found", 404);
    }

    if (masterOrder.status !== "PLACED") {
      return ApiResponse.error(res, "Order cannot be assigned at this stage", 400);
    }

    const rider = await Rider.findByPk(req.body.rider_id);

    if (!rider) {
      return ApiResponse.error(res, "Rider not found", 404);
    }

    if (!rider.is_available) {
      return ApiResponse.error(res, "Rider is not available", 400);
    }

    // Assign rider
    masterOrder.rider_id = rider.id;
    masterOrder.status = "ASSIGNED";
    masterOrder.assigned_at = new Date();
    await masterOrder.save();

    // Mark rider as unavailable
    rider.is_available = false;
    await rider.save();

    // Immediately re-dispatch other orders offered to this rider
    await cleanupRiderOtherOffers(rider.id);

    await clearOrderRelatedCaches({
      masterOrderId: masterOrder.id,
      customerId: masterOrder.customer_id,
      sellerId: masterOrder.seller_id,
      riderId: rider.id,
    });

    await sendOrderStatusNotification(masterOrder, "ASSIGNED");

    // Fetch the rider's linked user for the response
    const riderUser = rider.user_id ? await User.findByPk(rider.user_id) : null;

    const assignedOrder = {
      ...masterOrder,
      Rider: {
        ...rider,
        User: riderUser ? { id: riderUser.id, name: riderUser.name, phone: riderUser.phone } : null
      }
    };

    return ApiResponse.success(res, assignedOrder, "Rider assigned successfully");
  } catch (error) {
    throw error;
  }
});

exports.riderAcceptOrder = asyncHandler(async (req, res) => {
  try {
    const riderId = req.user.id; // user_id from token
    const orderId = req.params.id;

    const result = await firestore.runTransaction(async (transaction) => {
      // 1. Get Rider Document
      const riderQuery = firestore.collection("riders").where("user_id", "==", riderId).limit(1);
      const riderSnapshot = await transaction.get(riderQuery);

      if (riderSnapshot.empty) {
        throw new Error("Rider profile not found");
      }
      const riderDoc = riderSnapshot.docs[0];
      const riderData = riderDoc.data();

      // 2. Get Order Document
      const orderRef = firestore.collection("master_orders").doc(orderId);
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists) {
        throw new Error("Order not found");
      }
      const orderData = orderSnapshot.data();

      // 3. Availability Checks
      if (orderData.status !== "PLACED" || orderData.rider_id) {
        throw new Error("Order is no longer available");
      }

      if (!riderData.is_available) {
        throw new Error("You are currently marked as unavailable");
      }

      if (orderData.offered_rider_id && orderData.offered_rider_id !== riderDoc.id) {
        throw new Error("Order was offered to another rider");
      }

      // 4. COD Eligibility Check
      if (orderData.payment_method === "COD") {
        const walletQuery = firestore.collection("wallets").where("user_id", "==", riderId).limit(1);
        const walletSnapshot = await transaction.get(walletQuery);

        if (walletSnapshot.empty) {
          throw new Error("Wallet not found. Please setup your wallet.");
        }

        const walletData = walletSnapshot.docs[0].data();
        const orderTotal = parseFloat(orderData.total_amount) || 0;
        const availableBalance = parseFloat(walletData.available_balance) || 0;

        if (availableBalance < orderTotal) {
          throw new Error(`Insufficient wallet balance. You need ₹${orderTotal.toFixed(0)} for this COD order.`);
        }

        const riderCodLimit = riderData.cod_limit !== undefined && riderData.cod_limit !== null ? parseFloat(riderData.cod_limit) : 1000;
        if (exceedsCodLimit(orderTotal, riderCodLimit)) {
          throw new Error(`Order amount ₹${orderTotal.toFixed(0)} exceeds your Cash on Delivery limit of ₹${riderCodLimit.toFixed(0)}.`);
        }
      }

      // 5. Atomic Updates
      transaction.update(orderRef, {
        rider_id: riderDoc.id,
        status: "ASSIGNED",
        assigned_at: new Date(),
        offered_rider_id: null,
        updatedAt: new Date()
      });

      transaction.update(riderDoc.ref, {
        is_available: false,
        updatedAt: new Date()
      });

      return { master_order_id: orderId, status: "ASSIGNED" };
    });

    // Post-transaction tasks (non-atomic or background)
    const rider = await Rider.findOne({ where: { user_id: req.user.id } });
    if (rider) {
      // Update MasterOrder in MySQL database
      const masterOrder = await MasterOrder.findByPk(orderId);
      if (masterOrder) {
        masterOrder.rider_id = rider.id;
        masterOrder.status = "ASSIGNED";
        masterOrder.assigned_at = new Date();
        masterOrder.offered_rider_id = null;
        await masterOrder.save();
        await sendOrderStatusNotification(masterOrder, "ASSIGNED");
      }

      // Mark rider as unavailable in MySQL database
      rider.is_available = false;
      await rider.save();

      await cleanupRiderOtherOffers(rider.id);
      await clearOrderRelatedCaches({
        masterOrderId: orderId,
        customerId: masterOrder ? masterOrder.customer_id : null,
        riderId: rider.id,
      });
    }

    return ApiResponse.success(res, result, "Order accepted successfully");
  } catch (error) {
    return ApiResponse.error(res, error.message, 400);
  }
});

exports.riderDeclineOrder = asyncHandler(async (req, res) => {
  try {
    const rider = await Rider.findOne({
      where: { user_id: req.user.id },
    });

    if (!rider) {
      return ApiResponse.error(res, "Rider not found", 404);
    }

    const masterOrder = await MasterOrder.findByPk(req.params.id);

    if (!masterOrder) {
      return ApiResponse.error(res, "Order not found", 404);
    }

    if (masterOrder.status !== "PLACED" || masterOrder.rider_id) {
      return ApiResponse.error(res, "Order is no longer available", 400);
    }

    if (masterOrder.offered_rider_id && masterOrder.offered_rider_id !== rider.id) {
      return ApiResponse.error(res, "Order was offered to another rider", 403);
    }

    // On decline, immediately rotate the offer to the next nearest eligible rider.
    masterOrder.offered_rider_id = null;
    const rejectedIds = parseRejectedRiderIds(masterOrder.rider_rejected_ids);
    if (!rejectedIds.includes(rider.id)) {
      rejectedIds.push(rider.id);
    }
    masterOrder.rider_rejected_ids = JSON.stringify(rejectedIds);
    await masterOrder.save();

    try {
    } catch (dispatchError) {
      console.error(
        `Dispatch failed after rider ${rider.id} declined order ${masterOrder.id}:`,
        dispatchError.message
      );
    }

    return ApiResponse.success(
      res,
      { master_order_id: masterOrder.id, status: masterOrder.status },
      "Order declined"
    );
  } catch (error) {
    throw error;
  }
});

/**
 * =========================
 * RIDER → START DELIVERY
 * =========================
 */
exports.startDelivery = async (req, res) => {
  try {
    const rider = await Rider.findOne({
      where: { user_id: req.user.id },
    });

    const masterOrder = await MasterOrder.findByPk(req.params.id);

    if (!rider || !masterOrder || masterOrder.rider_id !== rider.id) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!["ASSIGNED", "PICKED_UP"].includes(masterOrder.status)) {
      return res.status(400).json({
        message: "Order must be ASSIGNED or PICKED_UP first",
      });
    }

    // ✅ Update status
    masterOrder.status = "OUT_FOR_DELIVERY";
    await masterOrder.save();
    await sendOrderStatusNotification(masterOrder, "OUT_FOR_DELIVERY");
    await clearOrderRelatedCaches({
      masterOrderId: masterOrder.id,
      customerId: masterOrder.customer_id,
      sellerId: masterOrder.seller_id,
      riderId: rider.id,
    });

    // Start tracking in Firebase RTDB (non-blocking — don't crash if RTDB creds are invalid)
    try {
      await markOrderTrackingStarted(masterOrder, rider);
    } catch (trackingErr) {
      console.error("[startDelivery] RTDB tracking failed (non-fatal):", trackingErr.message);
    }

    // ✅ Refetch with populated data
    let updatedOrder = await MasterOrder.findByPk(masterOrder.id);
    updatedOrder = await populateMasterOrderData(updatedOrder);

    return res.json({
      message: "Order is now out for delivery",
      master_order_id: updatedOrder.id,
      status: updatedOrder.status,
      tracking: isFirebaseReady
        ? {
          provider: "firebase_rtdb",
          path: getOrderTrackingPath(updatedOrder.id),
        }
        : null,
      rider: updatedOrder.rider
        ? {
          name: updatedOrder.rider.User?.name ?? null,
          phone: updatedOrder.rider.User?.phone ?? null,
        }
        : null,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};
/**
 * =========================
 * RIDER → PICK UP ORDER
 * =========================
 */
exports.pickUpOrder = async (req, res) => {
  try {
    const rider = await Rider.findOne({
      where: { user_id: req.user.id },
    });

    const masterOrder = await MasterOrder.findByPk(req.params.id);

    if (!rider || !masterOrder || masterOrder.rider_id !== rider.id) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (masterOrder.status !== "ASSIGNED") {
      return res.status(400).json({
        message: "Order must be ASSIGNED before picking up",
      });
    }

    // ✅ Update status
    masterOrder.status = "PICKED_UP";
    await masterOrder.save();
    await sendOrderStatusNotification(masterOrder, "PICKED_UP");
    await clearOrderRelatedCaches({
      masterOrderId: masterOrder.id,
      customerId: masterOrder.customer_id,
      sellerId: masterOrder.seller_id,
      riderId: rider.id,
    });

    return res.json({
      message: "Order picked up successfully",
      master_order_id: masterOrder.id,
      status: masterOrder.status,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};


/**
 * =========================
 * RIDER → DELIVER ORDER
 * =========================
 */
exports.deliverOrder = async (req, res) => {
  try {
    const rider = await Rider.findOne({
      where: { user_id: req.user.id },
    });

    if (!rider) {
      return res.status(404).json({ message: "Rider not found" });
    }

    const masterOrder = await MasterOrder.findByPk(req.params.id);

    if (!masterOrder || masterOrder.rider_id !== rider.id) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (masterOrder.status !== "OUT_FOR_DELIVERY") {
      return res.status(400).json({
        message: "Order must be OUT_FOR_DELIVERY before delivery",
      });
    }

    const uploadedPOD =
      req.file ||
      req.files?.pod?.[0] ||
      req.files?.image?.[0] ||
      req.files?.file?.[0];

    if (!uploadedPOD) {
      return res.status(400).json({
        message: "Proof of Delivery (POD) image required (field: pod)",
      });
    }

    const pod_image = uploadedPOD.path || uploadedPOD.location;

    masterOrder.status = "DELIVERED";
    masterOrder.delivered_at = new Date();
    masterOrder.pod_image = optimizeCloudinaryUrl(pod_image, CLOUDINARY_TRANSFORMATIONS.POD);
    await masterOrder.save();
    await sendOrderStatusNotification(masterOrder, "DELIVERED");

    rider.is_available = true;
    await rider.save();

    // ============================================
    // WALLET SETTLEMENT (Rider & Seller)
    // ============================================
    await settleOrderWallets(masterOrder);
    // ============================================

    try {
      await db.ref(getOrderTrackingPath(masterOrder.id)).remove();
    } catch (trackingErr) {
      console.error("[deliverOrder] RTDB cleanup failed (non-fatal):", trackingErr.message);
    }

    await clearOrderRelatedCaches({
      masterOrderId: masterOrder.id,
      customerId: masterOrder.customer_id,
      sellerId: masterOrder.seller_id,
      riderId: rider.id,
    });

    return res.json({
      message: "Order delivered successfully",
      masterOrder,
    });

  } catch (error) {
    console.error("Deliver order error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Centralized function to send FCM + Email notifications to all parties of an order (Customer, Seller, Rider)
 * when the status changes.
 */
async function sendOrderStatusNotification(order, status) {
  try {
    // 1. Customer Notification
    if (order.customer_id) {
      const customerUser = await User.findByPk(order.customer_id);
      if (customerUser) {
        const customerEmail = customerUser.email;
        const customerFcm = customerUser.fcm_token?.toString().trim();

        const title = `Order Update: #${order.id.substring(order.id.length - 6)}`;
        let body = `Your order status has changed to ${status}.`;
        
        if (status === "READY") {
          body = "Your order is ready for pickup!";
        } else if (status === "OUT_FOR_DELIVERY") {
          body = "Our rider is on the way to deliver your order!";
        } else if (status === "DELIVERED") {
          body = "Your order has been delivered successfully. Enjoy!";
        } else if (status === "CANCELLED") {
          body = `Your order has been cancelled. Reason: ${order.cancel_reason || "Not specified"}`;
        } else if (status === "ASSIGNED") {
          body = "A rider has been assigned to deliver your order!";
        }

        // Send FCM to Customer
        if (customerFcm && isFirebaseReady) {
          try {
            await admin.messaging().send({
              token: customerFcm,
              notification: { title, body },
              data: {
                orderId: String(order.id),
                status: String(status),
                type: "ORDER_STATUS_CHANGE"
              },
              android: {
                priority: "high",
                notification: {
                  sound: "default",
                  channelId: "customer_notifications",
                  clickAction: "FLUTTER_NOTIFICATION_CLICK",
                },
              },
              apns: {
                headers: {
                  "apns-priority": "10",
                },
                payload: {
                  aps: {
                    sound: "default",
                    badge: 1,
                  },
                },
              },
            });
            console.log(`[FCM] Sent to Customer ${customerUser.name} for status ${status}`);
          } catch (fcmError) {
            console.error(`[FCM] Failed to send to Customer ${customerUser.name}:`, fcmError.message);
          }
        }

        // Send Email to Customer
        if (customerEmail) {
          await sendEmail({
            to: customerEmail,
            subject: title,
            text: body,
            html: `
              <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 600px; margin: auto; border: 1px solid #E5E7EB; border-radius: 16px; background-color: #FFFFFF;">
                <h2 style="color: #111827; margin-bottom: 16px; font-weight: 800;">TIND ORDER UPDATE</h2>
                <p style="font-size: 16px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">${body}</p>
                <div style="background-color: #F3F4F6; padding: 16px; border-radius: 12px; margin-bottom: 24px;">
                  <p style="margin: 0; font-size: 14px; color: #374151;"><strong>Order ID:</strong> #${order.id}</p>
                  <p style="margin: 4px 0 0 0; font-size: 14px; color: #374151;"><strong>Total Amount:</strong> ₹${order.total_amount}</p>
                  <p style="margin: 4px 0 0 0; font-size: 14px; color: #374151;"><strong>Status:</strong> ${status}</p>
                </div>
                <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin: 0;">This is an automated notification from Tind. Please do not reply.</p>
              </div>
            `
          });
        }
      }
    }

    // 3. Rider Notification (for cancellations)
    if (order.rider_id && status === "CANCELLED") {
      const rider = await Rider.findByPk(order.rider_id);
      if (rider) {
        const riderUser = await User.findByPk(rider.user_id);
        if (riderUser) {
          const riderEmail = riderUser.email;
          const riderFcm = rider.fcm_token?.toString().trim();

          const title = `Order Cancelled: #${order.id.substring(order.id.length - 6)}`;
          const body = `Assigned order #${order.id.substring(order.id.length - 6)} has been cancelled.`;

          // Send FCM to Rider
          if (riderFcm && isFirebaseReady) {
            try {
              await admin.messaging().send({
                token: riderFcm,
                notification: { title, body },
                data: { orderId: order.id, status, type: "ORDER_STATUS_CHANGE" }
              });
              console.log(`[FCM] Sent to Rider for cancellation`);
            } catch (fcmError) {
              console.error(`[FCM] Failed to send to Rider:`, fcmError.message);
            }
          }

          // Send Email to Rider
          if (riderEmail) {
            await sendEmail({
              to: riderEmail,
              subject: title,
              text: body,
              html: `
                <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 600px; margin: auto; border: 1px solid #E5E7EB; border-radius: 16px; background-color: #FFFFFF;">
                  <h2 style="color: #DC2626; margin-bottom: 16px; font-weight: 800;">ORDER CANCELLED (RIDER NOTIFICATION)</h2>
                  <p style="font-size: 16px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">${body}</p>
                  <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin: 0;">This is an automated notification from Tind. Please do not reply.</p>
                </div>
              `
            });
          }
        }
      }
    }

  } catch (error) {
    console.error("[OrderStatusNotification] Error sending notifications:", error.message || error);
  }
}

/**
 * =========================
 * CUSTOMER → CANCEL ORDER (RESTOCK + REFUND)
 * =========================
 */
const executeOrderCancellation = async (masterOrder, reason, cancelledBy) => {
  const { firestore } = require("../config/firebase");
  const orderId = masterOrder.id;

  try {
    let refundAmount = 0;
    let refundCredited = false;
    let customerId = "";

    await firestore.runTransaction(async (dbTx) => {
      const orderRef = firestore.collection("master_orders").doc(orderId);
      const orderSnap = await dbTx.get(orderRef);
      if (!orderSnap.exists) {
        throw new Error("Order not found");
      }
      const orderData = orderSnap.data();

      // Check if already cancelled to prevent duplicate operations (double refund/restock)
      if (orderData.status === "CANCELLED") {
        throw new Error("Order already cancelled");
      }

      customerId = orderData.customer_id;

      // 1. Update order status to CANCELLED atomically
      dbTx.update(orderRef, {
        status: "CANCELLED",
        cancel_reason: reason || "Order cancelled",
        cancelled_by: cancelledBy || "SYSTEM",
        updatedAt: new Date()
      });

      // 2. Fetch order items to restock
      const orderItemsQuery = firestore.collection("order_items").where("master_order_id", "==", orderId);
      const orderItemsSnap = await dbTx.get(orderItemsQuery);

      if (!orderItemsSnap.empty) {
        const productRefs = orderItemsSnap.docs.map(doc => firestore.collection("products").doc(doc.data().product_id));
        const productSnaps = await Promise.all(productRefs.map(ref => dbTx.get(ref)));

        for (let i = 0; i < orderItemsSnap.docs.length; i++) {
          const itemDoc = orderItemsSnap.docs[i];
          const itemData = itemDoc.data();
          const productSnap = productSnaps[i];

          if (productSnap.exists) {
            const productData = productSnap.data();
            const newQty = (parseFloat(productData.quantity) || 0) + (parseFloat(itemData.quantity) || 0);
            dbTx.update(productSnap.ref, {
              quantity: newQty,
              is_active: true,
              updatedAt: new Date()
            });
          }
        }
      }

      // 3. Refund if ONLINE or WALLET and payment is paid
      if (["ONLINE", "WALLET"].includes(orderData.payment_method) && orderData.is_paid) {
        refundAmount = parseFloat(orderData.total_amount) || 0;
        if (refundAmount > 0) {
          const walletQuery = firestore.collection("wallets").where("user_id", "==", orderData.customer_id).limit(1);
          const walletSnap = await dbTx.get(walletQuery);
          let walletRef;
          let currentBal = 0;

          if (walletSnap.empty) {
            walletRef = firestore.collection("wallets").doc();
            dbTx.set(walletRef, {
              user_id: orderData.customer_id,
              available_balance: refundAmount,
              pending_balance: 0,
              total_earned: 0,
              total_withdrawn: 0,
              createdAt: new Date(),
              updatedAt: new Date()
            });
          } else {
            const walletDoc = walletSnap.docs[0];
            walletRef = walletDoc.ref;
            currentBal = parseFloat(walletDoc.data().available_balance) || 0;
            dbTx.update(walletRef, {
              available_balance: currentBal + refundAmount,
              updatedAt: new Date()
            });
          }

          const walletTxRef = firestore.collection("wallet_transactions").doc();
          dbTx.set(walletTxRef, {
            id: walletTxRef.id,
            user_id: orderData.customer_id,
            type: "CREDIT",
            amount: refundAmount,
            source: "ORDER_CANCELLED",
            description: `Refund for cancelled order ${orderId}`,
            createdAt: new Date(),
            updatedAt: new Date()
          });

          refundCredited = true;
        }
      }

      // 4. If rider was assigned, make him available
      if (orderData.rider_id) {
        const riderRef = firestore.collection("riders").doc(orderData.rider_id);
        dbTx.update(riderRef, {
          is_available: true,
          updatedAt: new Date()
        });
      }
    });

    console.log(`✅ Order ${orderId} cancelled and processed atomically.`);

    masterOrder.status = "CANCELLED";
    masterOrder.cancel_reason = reason || "Order cancelled";
    masterOrder.cancelled_by = cancelledBy || "SYSTEM";

    // Send FCM Notification for Refund (Outside transaction)
    if (refundCredited && refundAmount > 0) {
      try {
        const customerUser = await User.findByPk(customerId);
        const customerFcm = customerUser?.fcm_token?.toString().trim();
        if (customerFcm && isFirebaseReady) {
          const refundTitle = "Wallet Credited (Refund)! 💸";
          const refundBody = `₹${refundAmount.toFixed(2)} has been refunded to your wallet for cancelled order #${orderId.substring(orderId.length - 6).toUpperCase()}.`;

          await admin.messaging().send({
            token: customerFcm,
            notification: { title: refundTitle, body: refundBody },
            data: {
              type: "WALLET_CREDITED",
              amount: String(refundAmount),
              source: "ORDER_CANCELLED",
              orderId: String(orderId)
            },
            android: {
              priority: "high",
              notification: {
                sound: "default",
                channelId: "customer_notifications",
                clickAction: "FLUTTER_NOTIFICATION_CLICK",
              },
            },
            apns: {
              headers: { "apns-priority": "10" },
              payload: { aps: { sound: "default", badge: 1 } },
            },
          });
          console.log(`[FCM] Sent wallet credit refund notification to customer ${customerId}`);
        }
      } catch (fcmError) {
        console.error("[FCM] Failed to send cancellation refund notification:", fcmError.message);
      }
    }

    // Trigger non-atomic side-effects/caches
    await clearOrderRelatedCaches({
      masterOrderId: orderId,
      customerId: customerId,
      sellerId: masterOrder.seller_id,
      riderId: masterOrder.rider_id,
    });
    await markOrderTrackingClosed(orderId, "CANCELLED");
    await sendOrderStatusNotification(masterOrder, "CANCELLED");

  } catch (error) {
    if (error.message === "Order already cancelled") {
      console.log(`Order ${orderId} was already cancelled (skipped).`);
      return;
    }
    console.error("executeOrderCancellation transaction error:", error);
    throw error;
  }
};

exports.executeOrderCancellation = executeOrderCancellation;


exports.cancelOrder = async (req, res) => {
  try {
    const masterOrder = await MasterOrder.findByPk(req.params.id);

    if (!masterOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // BUG-C6 FIX: Verify the authenticated user owns this order
    if (masterOrder.customer_id !== req.user.id) {
      return res.status(403).json({ message: "Access denied: this order does not belong to you" });
    }

    if (!["PLACED", "ASSIGNED"].includes(masterOrder.status)) {
      return res.status(400).json({
        message: "Order cannot be cancelled now",
      });
    }

    const { cancel_reason } = req.body;
    await executeOrderCancellation(masterOrder, cancel_reason || "Customer cancelled the order", "CUSTOMER");

    return res.json({ message: "Order cancelled successfully" });

  } catch (error) {
    console.error("Cancel order error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
exports.getMyOrders = async (req, res) => {
  try {
    const cacheKey = `customer_orders_${req.user.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const orders = await MasterOrder.findAll({
      where: { customer_id: req.user.id },
      order: [["createdAt", "DESC"]],
    });

    // Batch-populate all orders in bulk (reduces Firestore reads by ~85%)
    const populatedOrders = await populateMasterOrdersBatch(orders);
    for (let i = 0; i < orders.length; i++) {
      orders[i] = populatedOrders[i];
    }

    const response = orders.map(order => {
      // Normalize payment_status: legacy COD orders may still have "PENDING"
      let paymentStatus = order.payment_status;
      if (order.payment_method === "COD" && paymentStatus === "PENDING") {
        paymentStatus = "COD";
      }

      return {
        master_order_id: order.id,
        status: order.status,
        delivered_at: order.delivered_at,
        created_at: order.created_at,
        seller: order.seller,
        delivery_address: order.delivery_address,
        rider:
          ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(order.status) &&
            order.rider
            ? {
              name: order.rider.User?.name || null,
              phone: order.rider.User?.phone || null,
              profile_picture_url: order.rider.profile_picture_url || null,
              current_lat: order.rider.current_lat ?? null,
              current_lng: order.rider.current_lng ?? null,
            }
            : null,
        replacement_request: order.replacement_request || null,
        refund_request: order.refund_request || null,
        items: order.items,
        total_amount: order.total_amount,
        delivery_fee: order.delivery_fee,
        rider_tip: order.rider_tip,
        payment_method: order.payment_method,
        payment_status: paymentStatus,
        cancel_reason: order.cancel_reason || null,
        cancelled_by: order.cancelled_by || null,
      };
    });

    await redisClient.set(cacheKey, JSON.stringify(response), { EX: 60 });
    return res.json(response);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};
exports.getOrderDetails = async (req, res) => {
  try {
    let order = await MasterOrder.findOne({
      where: {
        id: req.params.id,
        customer_id: req.user.id,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order = await populateMasterOrderData(order);

    // ===============================
    // PAYMENT COUNTDOWN LOGIC
    // ===============================
    const PAYMENT_TIMEOUT_MIN = 10;
    const RETRY_WINDOW_MIN = 10;

    let paymentSecondsRemaining = 0;
    let retrySecondsRemaining = 0;

    const now = new Date();

    // 1️⃣ Initial payment countdown
    if (
      order.payment_method === "ONLINE" &&
      order.payment_status === "PENDING" &&
      order.status === "PLACED"
    ) {
      const paymentDeadline = new Date(
        new Date(order.createdAt).getTime() +
        PAYMENT_TIMEOUT_MIN * 60 * 1000
      );

      const diffMs = paymentDeadline - now;

      if (diffMs > 0) {
        paymentSecondsRemaining = Math.floor(diffMs / 1000);
      }
    }

    // 2️⃣ Retry countdown
    if (
      order.status === "PAYMENT_EXPIRED" &&
      order.payment_expired_at
    ) {
      const retryDeadline = new Date(
        new Date(order.payment_expired_at).getTime() +
        RETRY_WINDOW_MIN * 60 * 1000
      );

      const diffMs = retryDeadline - now;

      if (diffMs > 0) {
        retrySecondsRemaining = Math.floor(diffMs / 1000);
      }
    }
    const paymentTimeText = formatSecondsToMMSS(paymentSecondsRemaining);
    const retryTimeText = formatSecondsToMMSS(retrySecondsRemaining);

    const response = {
      master_order_id: order.id,
      status: order.status,
      delivered_at: order.delivered_at,
      created_at: order.created_at,
      seller: order.seller,
      delivery_address: order.delivery_address,
      rider:
        ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(order.status) &&
          order.rider
          ? {
            name: order.rider.User?.name || null,
            phone: order.rider.User?.phone || null,
            profile_picture_url: order.rider.profile_picture_url || null,
            current_lat: order.rider.current_lat ?? null,
            current_lng: order.rider.current_lng ?? null,
          }
          : null,
      tracking:
        ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(order.status) &&
          order.rider &&
          isFirebaseReady
          ? {
            provider: "firebase_rtdb",
            path: getOrderTrackingPath(order.id),
          }
          : null,
      replacement_request: order.replacement_request || null,
      refund_request: order.refund_request || null,
      items: order.items,
      total_amount: order.total_amount,
      delivery_fee: order.delivery_fee,
      rider_tip: order.rider_tip,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      payment_seconds_remaining: paymentSecondsRemaining,
      retry_seconds_remaining: retrySecondsRemaining,
      payment_time_left_text: paymentTimeText,
      retry_time_left_text: retryTimeText,
      is_retry_allowed:
        order.status === "PAYMENT_EXPIRED" &&
        retrySecondsRemaining > 0,
      cancel_reason: order.cancel_reason || null,
      cancelled_by: order.cancelled_by || null,
    };

    return res.json(response);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.getRiderPendingOffer = async (req, res) => {
  try {
    const rider = await Rider.findOne({
      where: { user_id: req.user.id },
    });

    if (!rider) {
      return res.status(404).json({ message: "Rider not found" });
    }

    console.log(`[RiderAPI] Checking pending offers for rider ${rider.id} (User: ${req.user.id})`);

    let eligibleOrders = [];

    // 1. Check for DIRECT SINGLE OFFERS (Highest priority)
    const directOffers = await MasterOrder.findAll({
      where: {
        status: "PLACED",
        rider_id: null,
        offered_rider_id: rider.id,
      },
      order: [["createdAt", "DESC"]],
    });

    const populatedDirectOffers = await populateMasterOrdersBatch(directOffers);
    eligibleOrders.push(...populatedDirectOffers);

    // 2. Check for Broadcast candidates
    const broadcastCandidates = await MasterOrder.findAll({
      where: {
        status: "PLACED",
        rider_id: null,
        offered_rider_id: null,
      },
      order: [["createdAt", "DESC"]],
      limit: 20, // Increase limit to find more potential orders
    });

    // Filter out unpaid ONLINE orders
    const validBroadcastCandidates = broadcastCandidates.filter(
      (order) => !(order.payment_method === "ONLINE" && order.payment_status !== "PAID")
    );

    // Batch-populate broadcast candidates in bulk
    const populatedCandidates = await populateMasterOrdersBatch(validBroadcastCandidates);

    // Fetch all available, online riders once to reuse across distance checks
    const allAvailableRiders = await Rider.findAll({
      where: {
        is_available: true,
        is_verified: true,
      },
    });

    for (const populatedCandidate of populatedCandidates) {
      // Avoid duplicates if already in direct offers
      if (eligibleOrders.some(o => o.id === populatedCandidate.id)) continue;

      const rejectedIds = parseRejectedRiderIds(populatedCandidate.rider_rejected_ids);
      if (rejectedIds.includes(rider.id)) continue;

      const seller = populatedCandidate.seller;
      if (!seller?.latitude || !seller?.longitude) continue;

      const eligibleRiders = await getSortedEligibleRiders(
        populatedCandidate,
        seller,
        rejectedIds,
        allAvailableRiders
      );

      const nearestBatch = eligibleRiders.slice(0, 10);
      const isRiderInBatch = nearestBatch.some(
        (eligibleRider) => eligibleRider.id === rider.id
      );

      if (isRiderInBatch) {
        eligibleOrders.push(populatedCandidate);
      }
    }

    const { PlatformSettings } = require("../models");
    const timeoutSetting = await PlatformSettings.findOne({ where: { key: "rider_order_request_timeout" } });
    let timeoutSeconds = 30;
    if (timeoutSetting && !isNaN(parseInt(timeoutSetting.value))) {
      timeoutSeconds = parseInt(timeoutSetting.value);
    }

    const response = {
      timeout_seconds: timeoutSeconds,
      orders: eligibleOrders.map((order) => ({
        id: order.id,
        master_order_id: order.id,
        items: order.items,
        total_amount: order.total_amount,
        order_value: order.order_value,
        delivery_fee: order.delivery_fee,
        distance_fee: order.distance_fee,
        rider_tip: order.rider_tip,
        payment_method: order.payment_method,
        payment_type: order.payment_type,
        status: order.status,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        pickup_address: order.pickup_address,
        pickup_lat: order.pickup_lat,
        pickup_lng: order.pickup_lng,
        delivery_address: order.delivery_address || order.delivery_address_text || "N/A",
        delivery_address_text: order.delivery_address_text || "",
        delivery_lat: order.delivery_lat,
        delivery_lng: order.delivery_lng,
        distance: order.distance || 0,
        created_at: order.created_at,
        seller: order.seller,
      })),
    };

    return ApiResponse.success(res, response);
  } catch (error) {
    console.error("Rider pending offer error:", error);
    return res.status(500).json({
      success: false,
      message: `Server Error: ${error.message}`,
    });
  }
};


exports.getRiderOrders = async (req, res) => {
  try {
    const rider = await Rider.findOne({
      where: { user_id: req.user.id },
    });

    if (!rider) {
      return res.status(404).json({ message: "Rider not found" });
    }

    const cacheKey = `rider_orders_${rider.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const orders = await MasterOrder.findAll({
      where: { rider_id: rider.id },
      order: [["createdAt", "DESC"]],
    });

    // Batch-populate all orders in bulk (reduces Firestore reads by ~85%)
    const populatedOrders = await populateMasterOrdersBatch(orders);
    for (let i = 0; i < orders.length; i++) {
      orders[i] = populatedOrders[i];
    }

    const response = {
      orders: orders.map((order) => ({
        id: order.id,
        master_order_id: order.id,
        status: order.status,
        created_at: order.created_at,
        delivered_at: order.delivered_at,
        total_amount: order.total_amount,
        order_value: order.order_value,
        delivery_fee: order.delivery_fee,
        distance_fee: order.distance_fee,
        rider_tip: order.rider_tip,
        payment_method: order.payment_method,
        payment_type: order.payment_type,
        pod_image: optimizeCloudinaryUrl(order.pod_image, CLOUDINARY_TRANSFORMATIONS.POD),
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        pickup_address: order.pickup_address,
        pickup_lat: order.pickup_lat,
        pickup_lng: order.pickup_lng,
        delivery_address: order.delivery_address || order.delivery_address_text || "N/A",
        delivery_address_text: order.delivery_address_text || "",
        delivery_lat: order.delivery_lat,
        delivery_lng: order.delivery_lng,
        distance: order.distance || 0,
        seller: order.seller,
        cancel_reason: order.cancel_reason || null,
        cancelled_by: order.cancelled_by || null,
      })),
    };

    await redisClient.set(cacheKey, JSON.stringify(response), { EX: 60 });
    return res.json(response);
  } catch (error) {
    console.error("Rider orders error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.getRiderOrderDetails = async (req, res) => {
  try {
    const rider = await Rider.findOne({
      where: { user_id: req.user.id },
    });

    if (!rider) {
      return res.status(404).json({ message: "Rider not found" });
    }

    const cacheKey = `rider_order_${rider.id}_${req.params.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    let order = await MasterOrder.findOne({
      where: {
        id: req.params.id,
        rider_id: rider.id,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order = await populateMasterOrderData(order);

    const response = {
      ...order,
      tracking:
        ["OUT_FOR_DELIVERY", "DELIVERED"].includes(order.status) &&
          isFirebaseReady
          ? {
            provider: "firebase_rtdb",
            path: getOrderTrackingPath(order.id),
          }
          : null,
    };

    await redisClient.set(cacheKey, JSON.stringify(response), { EX: 60 });
    return res.json(response);
  } catch (error) {
    console.error("Rider order details error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};


exports.addOrderReview = async (req, res) => {
  try {
    const { productReviews, riderComment } = req.body;
    const riderRating = req.body.riderRating ? Number(req.body.riderRating) : null;

    const orderId = req.params.id;
    const userId = req.user.id;

    const order = await MasterOrder.findByPk(orderId);
    if (!order || order.customer_id !== userId) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.status !== "DELIVERED") {
      return res.status(400).json({ message: "Only delivered orders can be reviewed." });
    }

    // Check if any review already exists for this order
    const existingReviews = await Review.findAll({
      where: {
        master_order_id: orderId,
        user_id: userId
      }
    });

    if (existingReviews.length > 0) {
      return res.status(400).json({ message: "Only one time rating allowed" });
    }

    const createdReviews = [];

    // 1. Process PRODUCT reviews
    if (Array.isArray(productReviews)) {
      for (const rev of productReviews) {
        const rating = Number(rev.rating);
        if (!isNaN(rating) && rating >= 1 && rating <= 5) {
          const productRev = await Review.create({
            user_id: userId,
            master_order_id: orderId,
            product_id: rev.productId,
            review_type: "PRODUCT",
            rating: rating,
            comment: rev.comment || ""
          });
          createdReviews.push(productRev);

          // Update Product average rating
          const Product = require("../models/product");
          const product = await Product.findByPk(rev.productId);
          if (product) {
            const currentCount = Number(product.rating_count) || 0;
            const currentRating = Number(product.rating) || 0;
            const newCount = currentCount + 1;
            const newRating = ((currentRating * currentCount) + rating) / newCount;

            product.rating = Number(newRating.toFixed(2));
            product.rating_count = newCount;
            await product.save();
          }
        }
      }
    }

    // 2. Process RIDER review
    if (riderRating !== null && !isNaN(riderRating) && riderRating >= 1 && riderRating <= 5 && order.rider_id) {
      const riderRev = await Review.create({
        user_id: userId,
        master_order_id: orderId,
        rider_id: order.rider_id,
        review_type: "RIDER",
        rating: riderRating,
        comment: riderComment || ""
      });
      createdReviews.push(riderRev);

      // Update Rider average rating
      const Rider = require("../models/rider");
      const rider = await Rider.findOne({ where: { id: order.rider_id } });
      if (rider) {
        const currentCount = Number(rider.rating_count) || 0;
        const currentRating = Number(rider.rating) || 0;
        const newCount = currentCount + 1;
        const newRating = ((currentRating * currentCount) + riderRating) / newCount;

        console.log(`[Review] Updating rider ${rider.id}: rating ${currentRating} -> ${newRating} (${newCount} reviews)`);

        rider.rating = Number(newRating.toFixed(2));
        rider.rating_count = newCount;
        await rider.save();

        // 🔥 Cache Invalidation: Clear populated order and profile related caches 
        // to ensure the new rating is reflected immediately in the app
        try {
          const riderUserId = rider.user_id;
          if (riderUserId) {
            // Clear any order populations that might be cached
            await clearPatternKeys(`populated_order_*`);
            // Clear rider orders cache
            await redisClient.del(`rider_orders_${rider.id}`);
          }
        } catch (cacheErr) {
          console.warn("Failed to clear rider cache after review:", cacheErr.message);
        }
      }
    }

    if (createdReviews.length === 0) {
      return res.status(400).json({ message: "No valid ratings provided." });
    }

    return res.json({
      success: true,
      message: "Review submitted successfully",
      count: createdReviews.length
    });

  } catch (error) {
    console.error("Add review error:", error);
    return res.status(500).json({ message: "Server error: " + error.message });
  }
};

/**
 * =========================
 * CUSTOMER → GET ORDER TRACKING (Rider Location)
 * =========================
 * Security: Only the customer who owns the order can see the rider location.
 * Returns rider lat/lng from Firebase RTDB (real-time) with fallback to Firestore.
 */
exports.getOrderTracking = async (req, res) => {
  try {
    const masterOrder = await MasterOrder.findByPk(req.params.id);

    if (!masterOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Security check: only the customer who placed this order can track it
    if (masterOrder.customer_id !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to track this order" });
    }

    if (masterOrder.status !== "OUT_FOR_DELIVERY") {
      return res.status(400).json({
        message: "Tracking is only available when order is out for delivery",
        status: masterOrder.status,
      });
    }

    if (!masterOrder.rider_id) {
      return res.status(400).json({ message: "No rider assigned yet" });
    }

    // Try RTDB first (real-time location)
    let riderLocation = null;
    if (isFirebaseReady) {
      try {
        const trackingSnapshot = await db
          .ref(getOrderTrackingPath(masterOrder.id))
          .once("value");
        const trackingData = trackingSnapshot.val();
        if (trackingData && trackingData.lat && trackingData.lng) {
          riderLocation = {
            lat: trackingData.lat,
            lng: trackingData.lng,
            updated_at: trackingData.updated_at || null,
            source: "rtdb",
          };
        }
      } catch (rtdbErr) {
        console.error("[getOrderTracking] RTDB read failed:", rtdbErr.message);
      }
    }

    // Get rider info (single fetch, reused for fallback and response)
    const rider = await Rider.findByPk(masterOrder.rider_id);

    // Fallback: read from Firestore rider document
    if (!riderLocation) {
      if (rider && rider.current_lat && rider.current_lng) {
        riderLocation = {
          lat: rider.current_lat,
          lng: rider.current_lng,
          updated_at: null,
          source: "firestore",
        };
      }
    }

    if (!riderLocation) {
      return res.status(404).json({ message: "Rider location not available" });
    }

    let riderName = null;
    let riderPhone = null;
    if (rider && rider.user_id) {
      const user = await User.findByPk(rider.user_id);
      if (user) {
        riderName = user.name;
        riderPhone = user.phone;
      }
    }

    return res.json({
      order_id: masterOrder.id,
      status: masterOrder.status,
      rider: {
        id: masterOrder.rider_id,
        name: riderName,
        phone: riderPhone,
        location: riderLocation,
      },
    });

  } catch (error) {
    console.error("Get order tracking error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
