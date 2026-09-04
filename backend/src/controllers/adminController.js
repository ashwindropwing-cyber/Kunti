const { Op } = require("sequelize");
const User = require("../models/user");
const Rider = require("../models/rider");
const MasterOrder = require("../models/masterOrder");
const Product = require("../models/product");
const Review = require("../models/review");
const Cart = require("../models/cart");
const CartItem = require("../models/cartItem");
const Wishlist = require("../models/wishlist");
const CustomerAddress = require("../models/customerAddress");
const CouponUsage = require("../models/couponUsage");

const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { sendEmail } = require("../utils/sendEmail");
const { chunkedFindAll } = require("../utils/dbHelper");
const { invalidateCache } = require("../middlewares/responseCache");

exports.getDashboardMetrics = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    totalRiders,
    totalOrders,
    totalProducts,
    pendingRiders,
    todayOrdersCount,
    deliveredOrdersCount,
    allOrders,
  ] = await Promise.all([
    User.count({ where: { role: "CUSTOMER" } }),
    Rider.count(),
    MasterOrder.count(),
    Product.count(),
    Rider.count({ where: { is_verified: false } }),
    MasterOrder.count({ where: { createdAt: { [Op.gte]: today } } }),
    MasterOrder.count({ where: { status: "DELIVERED" } }),
    MasterOrder.findAll({
      where: {
        status: { [Op.ne]: "CANCELLED" },
      },
      order: [["createdAt", "DESC"]],
    }),
  ]);

  const todayOrdersList = allOrders.filter(
    (o) => new Date(o.createdAt) >= today
  );

  // Today's revenue: sum of non-cancelled orders created today
  const todayRevenue = todayOrdersList.reduce(
    (sum, o) => sum + (parseFloat(o.total_amount) || 0),
    0
  );

  // Total Lifetime Revenue: sum of all non-cancelled / delivered orders
  const totalRevenue = allOrders.reduce(
    (sum, o) => sum + (parseFloat(o.total_amount) || 0),
    0
  );

  // Average Order Value
  const relevantOrdersForAvg = todayOrdersList.length > 0 ? todayOrdersList : allOrders;
  const avgOrderValue = relevantOrdersForAvg.length > 0
    ? (relevantOrdersForAvg.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0) / relevantOrdersForAvg.length)
    : 0;

  // Payment Breakdown: Online vs COD
  const codOrders = allOrders.filter(
    (o) => (o.payment_method || "").toUpperCase() === "COD" || (o.payment_method || "").toUpperCase() === "CASH"
  );
  const onlineOrders = allOrders.filter(
    (o) => (o.payment_method || "").toUpperCase() === "ONLINE" || (o.payment_method || "").toUpperCase() === "RAZORPAY" || (o.payment_method || "").toUpperCase() === "UPI"
  );
  const totalPaymentOrders = codOrders.length + onlineOrders.length;
  const onlinePercentage = totalPaymentOrders > 0
    ? parseFloat(((onlineOrders.length / totalPaymentOrders) * 100).toFixed(1))
    : 50.0;
  const codPercentage = totalPaymentOrders > 0
    ? parseFloat(((codOrders.length / totalPaymentOrders) * 100).toFixed(1))
    : 50.0;

  // 7-day daily revenue trend
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dNext = new Date(d);
    dNext.setDate(dNext.getDate() + 1);

    const dayOrders = allOrders.filter((o) => {
      const oDate = new Date(o.createdAt);
      return oDate >= d && oDate < dNext;
    });
    const dayRev = dayOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    last7Days.push(dayRev);
  }

  const responseData = {
    overview: {
      users: totalUsers,
      riders: totalRiders,
      orders: totalOrders,
      products: totalProducts,
      today_orders: todayOrdersCount,
      delivered_orders: deliveredOrdersCount,
      today_revenue: parseFloat(todayRevenue.toFixed(2)),
      total_revenue: parseFloat(totalRevenue.toFixed(2)),
      todayRevenue: parseFloat(todayRevenue.toFixed(2)),
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      avg_order_value: parseFloat(avgOrderValue.toFixed(2)),
      avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      active_customers_count: totalUsers,
      activeCustomersCount: totalUsers,
      online_percentage: onlinePercentage,
      onlinePercentage: onlinePercentage,
      cod_percentage: codPercentage,
      codPercentage: codPercentage,
      weekly_revenue_trend: last7Days,
      weeklyRevenueTrend: last7Days,
    },
    todayRevenue: parseFloat(todayRevenue.toFixed(2)),
    today_revenue: parseFloat(todayRevenue.toFixed(2)),
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    total_revenue: parseFloat(totalRevenue.toFixed(2)),
    totalOrdersToday: todayOrdersCount,
    today_orders: todayOrdersCount,
    totalOrders: totalOrders,
    deliveredOrders: deliveredOrdersCount,
    delivered_orders: deliveredOrdersCount,
    avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
    avg_order_value: parseFloat(avgOrderValue.toFixed(2)),
    activeCustomersCount: totalUsers,
    active_customers_count: totalUsers,
    onlinePercentage: onlinePercentage,
    online_percentage: onlinePercentage,
    codPercentage: codPercentage,
    cod_percentage: codPercentage,
    weeklyRevenueTrend: last7Days,
    weekly_revenue_trend: last7Days,
    pending_approvals: {
      total: pendingRiders,
      riders: pendingRiders,
    },
  };

  return ApiResponse.success(res, responseData);
});

exports.createRiderByAdmin = asyncHandler(async (req, res) => {
  const {
    name, phone, email, address,
    vehicle_type, vehicle_number,
    license_number, dl_number,
    aadhar_number, date_of_birth,
    delivery_radius_km, profile_picture_url, avatar_url,
    cod_limit
  } = req.body;

  if (!name || !phone) {
    return ApiResponse.error(res, "Name and phone are required", 400);
  }

  const rawPhone = phone.toString().trim();
  const digitsOnly = rawPhone.replace(/\D/g, "");
  const last10 = digitsOnly.slice(-10);

  const phoneVariants = [rawPhone, digitsOnly, last10, `+91${last10}`, `91${last10}`].filter(Boolean);

  let user = await User.findOne({
    where: {
      phone: { [Op.in]: phoneVariants },
    },
  });

  if (!user && last10.length === 10) {
    user = await User.findOne({
      where: {
        phone: { [Op.like]: `%${last10}` },
      },
    });
  }

  if (user) {
    user.name = name;
    user.role = "RIDER";
    if (email) user.email = email;
    await user.save();
  } else {
    user = await User.create({
      name,
      phone: last10.length === 10 ? last10 : rawPhone,
      email: email || null,
      role: "RIDER",
    });
  }

  let rider = await Rider.findOne({ where: { user_id: user.id } });

  if (rider) {
    rider.vehicle_type = vehicle_type || rider.vehicle_type || "Bike";
    rider.vehicle_number = vehicle_number || rider.vehicle_number || "";
    rider.address = address || rider.address || "";
    rider.license_number = license_number || dl_number || rider.license_number || "";
    rider.aadhar_number = aadhar_number || rider.aadhar_number || "";
    rider.date_of_birth = date_of_birth || rider.date_of_birth || "";
    if (delivery_radius_km) rider.delivery_radius_km = parseFloat(delivery_radius_km);
    if (profile_picture_url || avatar_url) rider.profile_picture_url = profile_picture_url || avatar_url;
    if (cod_limit) rider.cod_limit = parseFloat(cod_limit);
    rider.is_verified = true;
    rider.is_available = true;
    await rider.save();
  } else {
    rider = await Rider.create({
      user_id: user.id,
      vehicle_type: vehicle_type || "Bike",
      vehicle_number: vehicle_number || "",
      address: address || "",
      license_number: license_number || dl_number || "",
      aadhar_number: aadhar_number || "",
      date_of_birth: date_of_birth || "",
      delivery_radius_km: delivery_radius_km ? parseFloat(delivery_radius_km) : 5.0,
      profile_picture_url: profile_picture_url || avatar_url || "",
      cod_limit: cod_limit ? parseFloat(cod_limit) : 0,
      is_verified: true,
      is_available: true,
    });
  }

  invalidateCache("/admin");
  invalidateCache("/riders");

  return ApiResponse.success(res, {
    rider_id: rider.id,
    user_id: user.id,
    rider,
    user,
  }, "Rider registered successfully", 201);
});

exports.getAllRiders = asyncHandler(async (req, res) => {
  const riders = await Rider.findAll({
    order: [["createdAt", "DESC"]],
  });

  // Bulk-fetch user data for all riders in one query
  const riderUserIds = [...new Set(riders.map(r => r.user_id).filter(Boolean))];
  let riderUsers = [];
  if (riderUserIds.length > 0) {
    riderUsers = await User.findAll({ where: { id: { [Op.in]: riderUserIds } } });
  }
  const riderUserMap = riderUsers.reduce((acc, u) => { acc[u.id] = u; return acc; }, {});

  // Bulk-fetch all rider orders in one query (PostgreSQL has no 'in' limit)
  const riderIds = riders.map(r => r.id);
  let allRiderOrders = [];
  if (riderIds.length > 0) {
    allRiderOrders = await MasterOrder.findAll({ where: { rider_id: { [Op.in]: riderIds } } });
  }
  // Group orders by rider_id
  const riderOrdersMap = {};
  allRiderOrders.forEach(o => {
    if (!riderOrdersMap[o.rider_id]) riderOrdersMap[o.rider_id] = [];
    riderOrdersMap[o.rider_id].push(o);
  });

  const formatted = riders.map((r) => {
    let deliveredCount = 0;
    let codInHand = 0;
    
    const user = riderUserMap[r.user_id];
    const masterOrders = riderOrdersMap[r.id] || [];
    
    masterOrders.forEach(o => {
      if (o.status === "DELIVERED") deliveredCount++;
      if (o.payment_method === "COD" && o.status === "DELIVERED" && !o.cod_collected) {
        codInHand += parseFloat(o.total_amount) || 0;
      }
    });

    const riderJson = r.toJSON ? r.toJSON() : { ...r };

    return {
      ...riderJson,
      id: r.id,
      user_id: r.user_id,
      name: user?.name || "",
      phone: user?.phone || "",
      email: user?.email || "",
      avatar_url: r.profile_picture_url || "",
      dl_number: r.license_number || "",
      cod_limit: r.cod_limit,
      is_available: r.is_available,
      is_verified: r.is_verified,
      vehicle_type: r.vehicle_type,
      vehicle_number: r.vehicle_number,
      rating: r.rating,
      rating_count: r.rating_count,
      current_lat: r.current_lat,
      current_lng: r.current_lng,
      createdAt: r.createdAt,
      profile_picture_url: r.profile_picture_url,
      pending_profile_update: r.pending_profile_update,
      analytics: { delivered_orders: deliveredCount, cod_in_hand: codInHand }
    };
  });

  return ApiResponse.success(res, formatted);
});

exports.updateRiderByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { 
    name, phone, email, cod_limit, is_available, is_verified,
    vehicle_type, vehicle_number, license_number, aadhar_number, address,
    date_of_birth, delivery_radius_km
  } = req.body;

  const rider = await Rider.findByPk(id);
  if (!rider) {
    return ApiResponse.error(res, "Rider not found", 404);
  }

  const user = await User.findByPk(rider.user_id);
  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (email) user.email = email;
  if (cod_limit !== undefined) rider.cod_limit = cod_limit;
  if (is_available !== undefined) rider.is_available = is_available;
  if (is_verified !== undefined) rider.is_verified = is_verified;
  
  if (vehicle_type !== undefined) rider.vehicle_type = vehicle_type;
  if (vehicle_number !== undefined) rider.vehicle_number = vehicle_number;
  if (license_number !== undefined) rider.license_number = license_number;
  if (aadhar_number !== undefined) rider.aadhar_number = aadhar_number;
  if (address !== undefined) rider.address = address;
  if (date_of_birth !== undefined) rider.date_of_birth = date_of_birth;
  if (delivery_radius_km !== undefined) rider.delivery_radius_km = delivery_radius_km;

  await user.save();
  await rider.save();

  invalidateCache("/admin");
  invalidateCache("/riders");

  return ApiResponse.success(res, { ...rider, User: user }, "Rider updated successfully");
});


exports.verifyRider = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_verified } = req.body;

  const rider = await Rider.findByPk(id);
  if (!rider) return ApiResponse.error(res, "Rider not found", 404);

  rider.is_verified = is_verified;

  // If being unverified, also set offline
  if (is_verified === false) {
    rider.is_available = false;
  }

  // Store notification inside database array as a fallback/inbox (GCM/General Messages)
  if (!rider.notifications) rider.notifications = [];
  rider.notifications.push({
    title: is_verified ? "Account Verified & Approved" : "Account Suspended/Rejected",
    body: is_verified 
      ? "Congratulations! Your rider account is approved and verified by admin. You can go online now!" 
      : "Your rider account is suspended or rejected by admin. Please contact support.",
    type: is_verified ? "RIDER_VERIFIED" : "RIDER_UNVERIFIED",
    reason: is_verified ? "Approved" : "Account suspended or rejected by admin",
    time: new Date().toISOString()
  });

  await rider.save();

  invalidateCache("/admin");
  invalidateCache("/riders");

  // Send FCM Notification
  if (rider.fcm_token) {
    try {
      const { admin } = require("../config/firebase");
      await admin.messaging().send({
        token: rider.fcm_token,
        notification: {
          title: is_verified ? "Account Verified & Approved" : "Account Suspended/Rejected",
          body: is_verified 
            ? "Congratulations! Your rider account is approved and verified by admin. You can go online now!" 
            : "Your rider account is suspended or rejected by admin. Please contact support."
        },
        data: {
          type: is_verified ? "RIDER_VERIFIED" : "RIDER_UNVERIFIED",
          reason: is_verified ? "Approved" : "Account suspended or rejected by admin"
        },
        android: {
          priority: "high",
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
              badge: 1,
            },
          },
        },
      });
    } catch (err) {
      console.error("Failed to send verification FCM to rider:", err.message);
    }
  }

  // Send Email Notification
  try {
    const riderUser = await User.findByPk(rider.user_id);
    if (riderUser && riderUser.email) {
      const subject = is_verified ? "TIND Rider Account Verified! 🎉" : "TIND Rider Account suspended/rejected ⚠️";
      const bodyText = is_verified 
        ? "Congratulations! Your rider account is approved and verified by admin. You can go online now!" 
        : "Your rider account is suspended or rejected by admin. Please contact support.";
      const themeColor = is_verified ? "#10B981" : "#EF4444";
      const bgColor = is_verified ? "#ECFDF5" : "#FEE2E2";
      const textColor = is_verified ? "#065F46" : "#991B1B";

      await sendEmail({
        to: riderUser.email,
        subject: subject,
        text: bodyText,
        html: `
          <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 600px; margin: auto; border: 1px solid #E5E7EB; border-radius: 16px; background-color: #FFFFFF;">
            <h2 style="color: ${themeColor}; margin-bottom: 16px; font-weight: 800;">${is_verified ? "ACCOUNT VERIFIED" : "ACCOUNT SUSPENDED / REJECTED"}</h2>
            <p style="font-size: 16px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">${bodyText}</p>
            <div style="background-color: ${bgColor}; padding: 16px; border-radius: 12px; margin-bottom: 24px;">
              <p style="margin: 0; font-size: 14px; color: ${textColor};"><strong>Rider Name:</strong> ${riderUser.name}</p>
              <p style="margin: 4px 0 0 0; font-size: 14px; color: ${textColor};"><strong>Status:</strong> ${is_verified ? "Verified & Approved" : "Suspended / Rejected"}</p>
            </div>
            ${is_verified ? `<p style="font-size: 14px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">You can now log in to the TIND Rider App and go online to receive delivery requests.</p>` : ""}
            <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin: 0;">This is an automated notification from Tind. Please do not reply.</p>
          </div>
        `
      });
    }
  } catch (emailErr) {
    console.error("Failed to send email to rider:", emailErr.message);
  }

  return ApiResponse.success(res, rider, `Rider ${is_verified ? "verified" : "unverified"} successfully`);
});

exports.getRiderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rider = await Rider.findByPk(id);
  if (!rider) return ApiResponse.error(res, "Rider not found", 404);

  const user = await User.findByPk(rider.user_id);

  const masterOrders = await MasterOrder.findAll({
    where: { rider_id: rider.id },
    order: [["createdAt", "DESC"]],
    limit: 10
  });

  let deliveredCount = 0;
  let codInHand = 0;
  masterOrders.forEach(o => {
    if (o.status === "DELIVERED") deliveredCount++;
    if (o.payment_method === "COD" && o.status === "DELIVERED" && !o.cod_collected) {
      codInHand += parseFloat(o.total_amount) || 0;
    }
  });

  const formatted = {
    ...rider.toJSON(),
    User: user ? { id: user.id, name: user.name, phone: user.phone, email: user.email } : null,
    RecentOrders: masterOrders,
    analytics: { delivered_orders: deliveredCount, cod_in_hand: codInHand }
  };

  return ApiResponse.success(res, formatted);
});

exports.deleteRiderByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rider = await Rider.findByPk(id);
  if (!rider) {
    return ApiResponse.error(res, "Rider not found", 404);
  }

  // Unlink assigned orders so historical orders remain intact
  await MasterOrder.update({ rider_id: null }, { where: { rider_id: id } }).catch((e) => console.warn("MasterOrder rider unlink error:", e.message));
  // Clean up reviews associated with rider
  await Review.destroy({ where: { rider_id: id } }).catch((e) => console.warn("Review rider cleanup error:", e.message));

  const userId = rider.user_id;
  await Rider.destroy({ where: { id } });
  if (userId) {
    await User.destroy({ where: { id: userId } }).catch((e) => console.warn("User cleanup error:", e.message));
  }
  
  invalidateCache("/admin");
  invalidateCache("/riders");

  return ApiResponse.success(res, { id }, "Rider and associated user account deleted");
});

// ======================================
// USER MANAGEMENT (ADMIN)
// ======================================

exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    order: [["createdAt", "DESC"]]
  });
  return ApiResponse.success(res, users);
});

exports.createUserByAdmin = asyncHandler(async (req, res) => {
  const { name, phone, email, role, password } = req.body;

  if (!name || !phone || !role) {
    return ApiResponse.error(res, "Name, phone, and role are required", 400);
  }

  const existingUser = await User.findOne({ where: { phone } });
  if (existingUser) {
    return ApiResponse.error(res, "User with this phone already exists", 400);
  }

  const user = await User.create({
    name,
    phone,
    email: email || "",
    role,
    password: password || "123456", // Default password if not provided
  });

  return ApiResponse.success(res, user, "User created successfully", 201);
});

exports.updateUserByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, role } = req.body;

  const user = await User.findByPk(id);
  if (!user) return ApiResponse.error(res, "User not found", 404);

  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (email !== undefined) user.email = email;
  if (role !== undefined) user.role = role;

  await user.save();
  return ApiResponse.success(res, user, "User updated successfully");
});

exports.deleteUserByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findByPk(id);
  if (!user) return ApiResponse.error(res, "User not found", 404);

  // Clean up user dependent data
  const userCarts = await Cart.findAll({ where: { user_id: id } }).catch(() => []);
  for (const c of userCarts) {
    await CartItem.destroy({ where: { cart_id: c.id } }).catch(() => {});
  }
  await Cart.destroy({ where: { user_id: id } }).catch(() => {});
  await Wishlist.destroy({ where: { user_id: id } }).catch(() => {});
  await CustomerAddress.destroy({ where: { user_id: id } }).catch(() => {});
  await Review.destroy({ where: { user_id: id } }).catch(() => {});
  await CouponUsage.destroy({ where: { user_id: id } }).catch(() => {});
  await Rider.destroy({ where: { user_id: id } }).catch(() => {});
  await MasterOrder.update({ user_id: null }, { where: { user_id: id } }).catch(() => {});

  await user.destroy();

  return ApiResponse.success(res, { id }, "User deleted successfully");
});

exports.confirmOrderPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await MasterOrder.findByPk(id);

  if (!order) return ApiResponse.error(res, "Order not found", 404);
  if (order.payment_method !== "COD") {
    return ApiResponse.error(res, "Only COD orders can be manually confirmed", 400);
  }
  if (order.cod_collected) {
    return ApiResponse.error(res, "Cash already collected for this order", 400);
  }

  // Mark cash as collected and payment as paid
  order.is_paid = true;
  order.payment_status = "PAID";
  order.cod_collected = true;
  await order.save();

  return ApiResponse.success(res, order, "COD payment confirmed successfully");
});

// ======================================
// REVIEWS MANAGEMENT (ADMIN)
// ======================================

exports.getAllReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.findAll({
    order: [["createdAt", "DESC"]]
  });

  const authorIds = reviews.map(r => r.user_id).filter(Boolean);
  const riderIds = reviews.map(r => r.rider_id).filter(Boolean);
  const productIds = reviews.map(r => r.product_id).filter(Boolean);
  const orderIds = reviews.map(r => r.master_order_id).filter(Boolean);

  const [riders, products, orders, users] = await Promise.all([
    chunkedFindAll(Rider, "id", riderIds),
    chunkedFindAll(Product, "id", productIds),
    chunkedFindAll(MasterOrder, "id", orderIds),
    chunkedFindAll(User, "id", authorIds),
  ]);

  const riderMap = riders.reduce((m, r) => { m[r.id] = r; return m; }, {});
  const productMap = products.reduce((m, p) => { m[p.id] = p; return m; }, {});
  const orderMap = orders.reduce((m, o) => { m[o.id] = o; return m; }, {});

  // For riders, also get their User names
  const riderUserIds = riders.map(r => r.user_id).filter(Boolean);
  const riderUsers = await chunkedFindAll(User, "id", riderUserIds);
  const riderUserMap = riderUsers.reduce((m, u) => { m[u.id] = u; return m; }, {});
  const userMap = users.reduce((m, u) => { m[u.id] = u; return m; }, {});

  const formatted = reviews.map((r) => {
    const reviewObj = typeof r.toJSON === 'function' ? r.toJSON() : { ...r };
    const authorUser = userMap[r.user_id] || null;
    const productDoc = r.product_id ? productMap[r.product_id] : null;
    const orderDoc = r.master_order_id ? orderMap[r.master_order_id] : null;

    let rider = null;
    if (r.rider_id) {
      const riderDoc = riderMap[r.rider_id];
      if (riderDoc) {
        const riderUser = riderUserMap[riderDoc.user_id];
        rider = {
          id: riderDoc.id,
          name: riderUser?.name || "Rider",
          phone: riderUser?.phone || null,
          vehicle_type: riderDoc.vehicle_type || "Bike",
          vehicle_number: riderDoc.vehicle_number || "",
        };
      }
    }

    const orderNum = orderDoc?.order_number || (reviewObj.master_order_id ? `#${reviewObj.master_order_id.slice(0, 8)}` : "ORD-DIRECT");
    const foodList = productDoc?.name ? [productDoc.name] : [];

    return {
      id: reviewObj.id,
      rating: parseFloat(reviewObj.rating) || 5.0,
      comment: reviewObj.comment || "",
      review_type: reviewObj.review_type || (r.rider_id ? "RIDER" : "PRODUCT"),
      admin_reply: reviewObj.admin_reply || null,
      adminReply: reviewObj.admin_reply || null,
      is_hidden: reviewObj.is_hidden || false,
      isHidden: reviewObj.is_hidden || false,
      createdAt: reviewObj.createdAt,
      date: reviewObj.createdAt,
      user_id: reviewObj.user_id,
      product_id: reviewObj.product_id,
      rider_id: reviewObj.rider_id,
      master_order_id: reviewObj.master_order_id,
      orderId: orderNum,
      customerName: authorUser?.name || "Customer",
      customerPhone: authorUser?.phone || "",
      productName: productDoc?.name || null,
      productImage: productDoc?.image_url || null,
      riderName: rider?.name || null,
      riderPhone: rider?.phone || null,
      riderVehicle: rider ? `${rider.vehicle_type} ${rider.vehicle_number}`.trim() : null,
      foodItems: foodList,
      Author: authorUser ? { id: authorUser.id, name: authorUser.name, phone: authorUser.phone } : null,
      Product: productDoc ? { id: productDoc.id, name: productDoc.name, image_url: productDoc.image_url, price: productDoc.price } : null,
      Rider: rider,
      Order: orderDoc ? { id: orderDoc.id, order_number: orderDoc.order_number } : null,
    };
  });

  return ApiResponse.success(res, formatted);
});

exports.replyToReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reply, admin_reply } = req.body;
  const text = reply !== undefined ? reply : admin_reply;

  const review = await Review.findByPk(id);
  if (!review) return ApiResponse.error(res, "Review not found", 404);

  review.admin_reply = text || "";
  await review.save();

  return ApiResponse.success(res, review, "Reply saved successfully");
});

exports.toggleHideReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const review = await Review.findByPk(id);
  if (!review) return ApiResponse.error(res, "Review not found", 404);

  review.is_hidden = !review.is_hidden;
  await review.save();

  // Recalculate average ratings if hidden state changed
  if (review.product_id && review.review_type === "PRODUCT") {
    const allReviews = await Review.findAll({
      where: { product_id: review.product_id, review_type: "PRODUCT", is_hidden: false },
    });
    const totalRating = allReviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0);
    const avg = allReviews.length > 0 ? (totalRating / allReviews.length) : 0;
    await Product.update(
      { rating: parseFloat(avg.toFixed(1)), rating_count: allReviews.length },
      { where: { id: review.product_id } }
    );
  } else if (review.rider_id && review.review_type === "RIDER") {
    const allRiderReviews = await Review.findAll({
      where: { rider_id: review.rider_id, review_type: "RIDER", is_hidden: false },
    });
    const totalRiderRating = allRiderReviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0);
    const avgRider = allRiderReviews.length > 0 ? (totalRiderRating / allRiderReviews.length) : 5.0;
    await Rider.update(
      { rating: parseFloat(avgRider.toFixed(1)), rating_count: allRiderReviews.length },
      { where: { id: review.rider_id } }
    );
  }

  return ApiResponse.success(res, { is_hidden: review.is_hidden }, `Review ${review.is_hidden ? "hidden" : "unhidden"} successfully`);
});

exports.deleteReviewByAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const review = await Review.findByPk(id);
  
  if (!review) {
    return ApiResponse.error(res, "Review not found", 404);
  }

  const pId = review.product_id;
  const rId = review.rider_id;
  const revType = review.review_type;

  await review.destroy();

  // Recalculate rating
  if (pId && revType === "PRODUCT") {
    const allReviews = await Review.findAll({
      where: { product_id: pId, review_type: "PRODUCT", is_hidden: false },
    });
    const totalRating = allReviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0);
    const avg = allReviews.length > 0 ? (totalRating / allReviews.length) : 0;
    await Product.update(
      { rating: parseFloat(avg.toFixed(1)), rating_count: allReviews.length },
      { where: { id: pId } }
    );
  } else if (rId && revType === "RIDER") {
    const allRiderReviews = await Review.findAll({
      where: { rider_id: rId, review_type: "RIDER", is_hidden: false },
    });
    const totalRiderRating = allRiderReviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0);
    const avgRider = allRiderReviews.length > 0 ? (totalRiderRating / allRiderReviews.length) : 5.0;
    await Rider.update(
      { rating: parseFloat(avgRider.toFixed(1)), rating_count: allRiderReviews.length },
      { where: { id: rId } }
    );
  }

  return ApiResponse.success(res, null, "Review deleted successfully");
});

exports.approveRiderProfileUpdate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rider = await Rider.findByPk(id);

  if (!rider) {
    return ApiResponse.error(res, "Rider not found", 404);
  }

  if (!rider.pending_profile_update || rider.pending_profile_update.status !== "PENDING") {
    return ApiResponse.error(res, "No pending profile update found for this rider", 400);
  }

  const { data } = rider.pending_profile_update;

  // Apply the data
  if (data.vehicle_type !== undefined) rider.vehicle_type = data.vehicle_type;
  if (data.vehicle_number !== undefined) rider.vehicle_number = data.vehicle_number;
  if (data.address !== undefined) rider.address = data.address;
  if (data.license_number !== undefined) rider.license_number = data.license_number;
  if (data.aadhar_number !== undefined) rider.aadhar_number = data.aadhar_number;
  if (data.date_of_birth !== undefined) rider.date_of_birth = data.date_of_birth;
  if (data.delivery_radius_km !== undefined) rider.delivery_radius_km = data.delivery_radius_km;
  if (data.profile_picture_url !== undefined) rider.profile_picture_url = data.profile_picture_url;

  // Clear pending update
  rider.pending_profile_update = null;
  await rider.save();

  // If there are user fields like name/email
  if (data.name || data.email) {
    const user = await User.findByPk(rider.user_id);
    if (user) {
      if (data.name) user.name = data.name;
      if (data.email) user.email = data.email;
      await user.save();
    }
  }

  // Send FCM Notification
  if (rider.fcm_token) {
    try {
      const { admin } = require("../config/firebase");
      await admin.messaging().send({
        token: rider.fcm_token,
        notification: {
          title: "Profile Update Approved",
          body: "Your profile update request has been approved by the admin."
        },
        data: {
          type: "PROFILE_UPDATE_APPROVED"
        },
        android: {
          priority: "high",
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
              badge: 1,
            },
          },
        },
      });
    } catch (err) {
      console.error("Failed to send FCM to rider:", err.message);
    }
  }

  // Send Email Notification
  try {
    const riderUser = await User.findByPk(rider.user_id);
    if (riderUser && riderUser.email) {
      await sendEmail({
        to: riderUser.email,
        subject: "TIND Rider Profile Update Approved! 🎉",
        text: "Your profile update request has been approved by the admin.",
        html: `
          <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 600px; margin: auto; border: 1px solid #E5E7EB; border-radius: 16px; background-color: #FFFFFF;">
            <h2 style="color: #10B981; margin-bottom: 16px; font-weight: 800;">PROFILE UPDATE APPROVED! 🎉</h2>
            <p style="font-size: 16px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">Your profile update request has been approved by our admin team.</p>
            <div style="background-color: #ECFDF5; padding: 16px; border-radius: 12px; margin-bottom: 24px;">
              <p style="margin: 0; font-size: 14px; color: #065F46;"><strong>Rider:</strong> ${riderUser.name}</p>
              <p style="margin: 4px 0 0 0; font-size: 14px; color: #065F46;"><strong>Status:</strong> Approved & Applied</p>
            </div>
            <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin: 0;">This is an automated notification from Tind. Please do not reply.</p>
          </div>
        `
      });
    }
  } catch (emailErr) {
    console.error("Failed to send rider profile update approval email:", emailErr.message);
  }

  return ApiResponse.success(res, rider, "Rider profile update approved");
});

exports.rejectRiderProfileUpdate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { admin_note } = req.body;
  
  const rider = await Rider.findByPk(id);

  if (!rider) {
    return ApiResponse.error(res, "Rider not found", 404);
  }

  if (!rider.pending_profile_update || rider.pending_profile_update.status !== "PENDING") {
    return ApiResponse.error(res, "No pending profile update found for this rider", 400);
  }

  // Clear pending update
  rider.pending_profile_update = null;
  await rider.save();

  // Send FCM Notification
  if (rider.fcm_token) {
    try {
      const { admin } = require("../config/firebase");
      await admin.messaging().send({
        token: rider.fcm_token,
        notification: {
          title: "Profile Update Rejected",
          body: `Your profile update request was rejected. Reason: ${admin_note || "Not specified"}`
        },
        data: {
          type: "PROFILE_UPDATE_REJECTED",
          reason: admin_note || "Not specified"
        },
        android: {
          priority: "high",
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
              badge: 1,
            },
          },
        },
      });
    } catch (err) {
      console.error("Failed to send FCM to rider:", err.message);
    }
  }

  // Send Email Notification
  try {
    const riderUser = await User.findByPk(rider.user_id);
    if (riderUser && riderUser.email) {
      await sendEmail({
        to: riderUser.email,
        subject: "TIND Rider Profile Update Rejected ⚠️",
        text: `Your profile update request was rejected by the admin. Reason: ${admin_note || "Not specified"}`,
        html: `
          <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 600px; margin: auto; border: 1px solid #E5E7EB; border-radius: 16px; background-color: #FFFFFF;">
            <h2 style="color: #EF4444; margin-bottom: 16px; font-weight: 800;">PROFILE UPDATE REJECTED ⚠️</h2>
            <p style="font-size: 16px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">Your profile update request has been rejected by the admin.</p>
            <div style="background-color: #FEE2E2; padding: 16px; border-radius: 12px; margin-bottom: 24px;">
              <p style="margin: 0; font-size: 14px; color: #991B1B;"><strong>Rider:</strong> ${riderUser.name}</p>
              <p style="margin: 4px 0 0 0; font-size: 14px; color: #991B1B;"><strong>Status:</strong> Rejected</p>
              <p style="margin: 4px 0 0 0; font-size: 14px; color: #991B1B;"><strong>Reason:</strong> ${admin_note || "Not specified"}</p>
            </div>
            <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin: 0;">This is an automated notification from Tind. Please do not reply.</p>
          </div>
        `
      });
    }
  } catch (emailErr) {
    console.error("Failed to send rider profile update rejection email:", emailErr.message);
  }

  return ApiResponse.success(res, rider, "Rider profile update rejected");
});

// ── BROADCAST PUSH NOTIFICATION (ADMIN) ──────────────────────────────────────
exports.broadcastNotification = asyncHandler(async (req, res) => {
  const { title, message, targetAudience, target_audience } = req.body;
  const audience = (targetAudience || target_audience || "ALL").toUpperCase();

  if (!title || !message) {
    return ApiResponse.error(res, "Title and message are required", 400);
  }

  const Notification = require("../models/notification");
  const notification = await Notification.create({
    title,
    message,
    target_audience: audience,
    sent_by: req.user.id,
  });

  return ApiResponse.success(res, notification, "Notification broadcasted successfully", 201);
});