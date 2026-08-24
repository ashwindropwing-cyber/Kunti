const { Op } = require("sequelize");
const { MasterOrder, OrderItem, Cart, CartItem, Product, User, CustomerAddress, Rider, PlatformSettings, Coupon, CouponUsage, Review, sequelize } = require("../models");
const razorpay = require("../config/razorpay");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { calculateRoadDistance } = require("../utils/geoUtils");
const { getPlatformSettingsMap } = require("./platformController");
const { validateCoupon } = require("./couponController");
const { notifyAdmin, notifyRider, notifyCustomer } = require("../utils/fcmService");

// Helper: Generate unique order number (e.g., KUNTI-100234)
function generateOrderNumber() {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `KUNTI-${randomNum}`;
}

// ─── CREATE ORDER ─────────────────────────────────────────────────────────────
exports.createOrder = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { address_id, delivery_address_id, payment_method, notes, order_type, table_number, coupon_code } = req.body;
  const resolvedAddressId = address_id || delivery_address_id;

  // Validate order type — default to DELIVERY
  const validOrderTypes = ["DELIVERY", "DINE_IN"];
  const selectedOrderType = validOrderTypes.includes(order_type) ? order_type : "DELIVERY";

  const validPaymentMethods = ["COD", "ONLINE", "WALLET"];
  const selectedPaymentMethod = validPaymentMethods.includes(payment_method) ? payment_method : "COD";

  // ── DELIVERY — requires address + 5km radius check ────────────────────────
  let address = null;
  let estimatedDistance = 0;
  let deliveryFee = 0;

  const settingsMap = await getPlatformSettingsMap();
  const freeDeliveryThreshold = parseFloat(settingsMap.free_delivery_threshold) || 299;
  const deliveryFee0to3 = parseFloat(settingsMap.delivery_fee_0_to_3km) || 15;
  const deliveryFee3to5 = parseFloat(settingsMap.delivery_fee_3_to_5km) || 25;
  const maxDeliveryRadius = parseFloat(settingsMap.max_delivery_radius_km) || 5.0;
  const shopLat = parseFloat(settingsMap.shop_lat) || 22.5726;
  const shopLng = parseFloat(settingsMap.shop_lng) || 88.3639;

  if (selectedOrderType === "DELIVERY") {
    if (!resolvedAddressId) {
      return ApiResponse.error(res, "Delivery address is required for delivery orders", 400);
    }

    address = await CustomerAddress.findOne({ where: { id: resolvedAddressId, user_id: userId } });
    if (!address) {
      return ApiResponse.error(res, "Selected delivery address not found", 404);
    }

    // Verify 5km Maximum Delivery Coverage Radius
    if (address.latitude && address.longitude && shopLat && shopLng) {
      estimatedDistance = await calculateRoadDistance(shopLat, shopLng, address.latitude, address.longitude);
      if (estimatedDistance > maxDeliveryRadius) {
        return ApiResponse.error(
          res,
          `Delivery location (${estimatedDistance} km) is outside our maximum delivery coverage of ${maxDeliveryRadius} km.`,
          400
        );
      }
    }
  }

  // ── DINE_IN — requires table number ──────────────────────────────────────
  if (selectedOrderType === "DINE_IN" && !table_number) {
    return ApiResponse.error(res, "Table number is required for dine-in orders", 400);
  }

  // ── Load Cart ─────────────────────────────────────────────────────────────
  const cart = await Cart.findOne({ where: { user_id: userId } });
  if (!cart) {
    return ApiResponse.error(res, "Cart is empty", 400);
  }

  const cartItems = await CartItem.findAll({ where: { cart_id: cart.id } });
  if (!cartItems || cartItems.length === 0) {
    return ApiResponse.error(res, "Cart is empty", 400);
  }

  const productIds = cartItems.map((i) => i.product_id);
  const products = await Product.findAll({ where: { id: { [Op.in]: productIds } } });
  const productMap = products.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

  // Calculate Subtotal & Verify Stock
  let subtotal = 0;
  const orderItemsData = [];

  for (const item of cartItems) {
    const product = productMap[item.product_id];
    if (!product || !product.is_available) {
      return ApiResponse.error(res, `Product ${item.product_id} is no longer available`, 400);
    }
    if (product.stock_quantity < item.quantity) {
      return ApiResponse.error(res, `Insufficient stock for ${product.name}`, 400);
    }

    const itemPrice = parseFloat(product.discount_price || product.price) || 0;
    const itemTotal = itemPrice * item.quantity;
    subtotal += itemTotal;

    orderItemsData.push({
      product_id: product.id,
      product_name: product.name,
      product_image: product.image_url,
      quantity: item.quantity,
      unit_price: itemPrice,
      total_price: itemTotal,
    });
  }

  // ── Validate Coupon (if provided) ─────────────────────────────────────────
  let discountAmount = 0;
  let appliedCoupon = null;

  if (coupon_code && coupon_code.trim().length > 0) {
    const couponRes = await validateCoupon(coupon_code, userId, subtotal);
    if (!couponRes.valid) {
      return ApiResponse.error(res, couponRes.message, 400);
    }
    discountAmount = couponRes.discount;
    appliedCoupon = couponRes.coupon;
  }

  // ── Calculate Delivery Fee (DELIVERY only) ────────────────────────────────
  if (selectedOrderType === "DELIVERY") {
    deliveryFee = estimatedDistance <= 3 ? deliveryFee0to3 : deliveryFee3to5;
    if (subtotal >= freeDeliveryThreshold) {
      deliveryFee = 0; // Free delivery above threshold
    }
  }
  // DINE_IN orders: no delivery fee

  const totalAmount = Math.max(0, subtotal - discountAmount) + deliveryFee;

  // ── Execute SQL Transaction ───────────────────────────────────────────────
  const result = await sequelize.transaction(async (t) => {
    // 1. Create Master Order
    const masterOrder = await MasterOrder.create(
      {
        order_number: generateOrderNumber(),
        user_id: userId,
        order_type: selectedOrderType,
        table_number: selectedOrderType === "DINE_IN" ? table_number : null,
        address_id: address ? address.id : null,
        subtotal,
        discount_amount: discountAmount,
        coupon_code: appliedCoupon ? appliedCoupon.code : null,
        delivery_fee: deliveryFee,
        total_amount: totalAmount,
        payment_method: selectedPaymentMethod,
        payment_status: "PENDING",
        status: "PLACED",
        delivery_address: address
          ? {
              address_line1: address.address_line1,
              address_line2: address.address_line2,
              landmark: address.landmark,
              city: address.city,
              pincode: address.pincode,
              address_type: address.address_type,
            }
          : null,
        delivery_otp: Math.floor(1000 + Math.random() * 9000).toString(),
        notes: notes || null,
      },
      { transaction: t }
    );

    // 2. Create Order Items & Decrement Stock
    for (const itemData of orderItemsData) {
      await OrderItem.create(
        {
          ...itemData,
          master_order_id: masterOrder.id,
        },
        { transaction: t }
      );

      await Product.decrement("stock_quantity", {
        by: itemData.quantity,
        where: { id: itemData.product_id },
        transaction: t,
      });
    }

    // 3. Record Coupon Usage & Increment Counter (if coupon applied)
    if (appliedCoupon) {
      await CouponUsage.create(
        {
          user_id: userId,
          coupon_id: appliedCoupon.id,
          master_order_id: masterOrder.id,
        },
        { transaction: t }
      );

      await Coupon.increment("used_count", {
        by: 1,
        where: { id: appliedCoupon.id },
        transaction: t,
      });
    }

    // 4. Clear Customer Cart
    await CartItem.destroy({ where: { cart_id: cart.id }, transaction: t });

    return masterOrder;
  });

  // Return created order with items
  const createdOrder = await MasterOrder.findByPk(result.id, {
    include: [{ model: OrderItem, as: "items" }],
  });

  let razorpayOrderId = null;
  let paymentRequired = false;

  if (selectedPaymentMethod === "ONLINE") {
    paymentRequired = true;
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: Math.round(parseFloat(createdOrder.total_amount) * 100),
        currency: "INR",
        receipt: createdOrder.id,
      });
      razorpayOrderId = rzpOrder.id;
      createdOrder.razorpay_order_id = rzpOrder.id;
      await createdOrder.save();
    } catch (rzpErr) {
      console.warn("Razorpay order creation fallback:", rzpErr.message);
      razorpayOrderId = `rzp_order_${createdOrder.id.substring(0, 10)}`;
      createdOrder.razorpay_order_id = razorpayOrderId;
      await createdOrder.save();
    }
  }

  notifyAdmin({
    title: `New Order #${createdOrder.order_number || createdOrder.id}! 🍕`,
    body: `New order placed for ₹${createdOrder.total_amount}. Tap to view in Admin app.`,
    data: { order_id: createdOrder.id.toString(), type: "NEW_ORDER" },
  });

  const responseData = {
    ...createdOrder.toJSON(),
    order_id: createdOrder.id,
    master_order_id: createdOrder.id,
    payment_required: paymentRequired,
    razorpay_order_id: razorpayOrderId,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID || "",
  };

  return ApiResponse.success(res, responseData, "Order placed successfully", 201);
});


// ─── GET USER ORDERS (CUSTOMER) ───────────────────────────────────────────────
exports.getUserOrders = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const orders = await MasterOrder.findAll({
    where: { user_id: userId },
    include: [{ model: OrderItem, as: "items" }],
    order: [["createdAt", "DESC"]],
  });

  return ApiResponse.success(res, orders.map(o => o.toJSON ? o.toJSON() : o));
});

// ─── GET ORDER BY ID ──────────────────────────────────────────────────────────
exports.getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await MasterOrder.findByPk(id, {
    include: [
      { model: OrderItem, as: "items" },
      { model: User, as: "user", attributes: ["id", "name", "phone", "email"] },
      { model: Rider, as: "rider", include: [{ model: User, as: "user", attributes: ["name", "phone"] }] },
    ],
  });

  if (!order) {
    return ApiResponse.error(res, "Order not found", 404);
  }

  if (req.user.role === "CUSTOMER" && order.user_id !== req.user.id) {
    return ApiResponse.error(res, "Access denied", 403);
  }

  return ApiResponse.success(res, order.toJSON ? order.toJSON() : order);
});

// ─── GET ORDER TRACKING (STATUS ONLY) ─────────────────────────────────────────
exports.getOrderTracking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await MasterOrder.findByPk(id, {
    include: [
      { model: OrderItem, as: "items" },
      { model: Rider, as: "rider", include: [{ model: User, as: "user", attributes: ["name", "phone"] }] },
    ],
  });

  if (!order) {
    return ApiResponse.error(res, "Order not found", 404);
  }

  return ApiResponse.success(res, {
    order_id: order.id,
    order_number: order.order_number,
    status: order.status,
    payment_status: order.payment_status,
    payment_method: order.payment_method,
    total_amount: order.total_amount,
    rider: order.rider
      ? {
          name: order.rider.user?.name,
          phone: order.rider.user?.phone,
          vehicle_number: order.rider.vehicle_number,
        }
      : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
});

// ─── UPDATE ORDER STATUS (ADMIN) ──────────────────────────────────────────────
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["PLACED", "ACCEPTED", "ASSIGNED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
  if (!validStatuses.includes(status)) {
    return ApiResponse.error(res, `Invalid status. Allowed: ${validStatuses.join(", ")}`, 400);
  }

  const order = await MasterOrder.findByPk(id);
  if (!order) {
    return ApiResponse.error(res, "Order not found", 404);
  }

  // Guard: DINE_IN orders cannot go OUT_FOR_DELIVERY
  if (order.order_type === "DINE_IN" && status === "OUT_FOR_DELIVERY") {
    return ApiResponse.error(res, "Dine-in orders cannot be set to OUT_FOR_DELIVERY", 400);
  }

  order.status = status;
  if (status === "DELIVERED" && order.payment_method === "COD") {
    order.payment_status = "PAID";
    order.is_paid = true;
  }
  await order.save();

  if (status === "DELIVERED") {
    notifyAdmin({
      title: "Order Delivered! ✅",
      body: `Order #${order.order_number || order.id} has been delivered successfully.`,
      data: { order_id: order.id.toString(), type: "ORDER_DELIVERED" },
    });
    if (order.user_id) {
      notifyCustomer(order.user_id, {
        title: "Order Delivered! 😋",
        body: `Your order #${order.order_number || order.id} has been delivered. Enjoy your meal!`,
        data: { order_id: order.id.toString(), type: "ORDER_STATUS_CHANGE" },
      });
    }
  }

  return ApiResponse.success(res, order, `Order status updated to ${status}`);
});


// ─── ASSIGN RIDER (ADMIN - SINGLE ORDER) ──────────────────────────────────────────────
exports.assignRider = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rider_id } = req.body;

  const order = await MasterOrder.findByPk(id);
  if (!order) return ApiResponse.error(res, "Order not found", 404);

  if (["DELIVERED", "CANCELLED"].includes(order.status)) {
    return ApiResponse.error(res, `Cannot assign rider to a ${order.status} order`, 400);
  }

  const rider = await Rider.findByPk(rider_id, {
    include: [{ model: User, as: "user", attributes: ["name", "phone", "fcm_token"] }]
  });
  if (!rider) return ApiResponse.error(res, "Rider not found", 404);
  if (!rider.is_verified) return ApiResponse.error(res, "Rider is not verified yet", 400);

  order.rider_id = rider.id;
  // Auto-accept if the order is still pending/placed, then mark as ASSIGNED
  if (["PLACED", "PENDING"].includes(order.status)) {
    order.status = "ASSIGNED"; // skip the ACCEPTED step, go directly to ASSIGNED
  } else {
    order.status = "ASSIGNED";
  }
  await order.save();

  // Send FCM push notification to the rider's device
  notifyRider(rider, {
    title: "New Order Assigned 🛵",
    body: `You have been assigned Order #${order.order_number || order.id}. Tap to view.`,
    data: { order_id: order.id.toString(), type: "ORDER_ASSIGNED" },
  });

  return ApiResponse.success(res, order, "Rider assigned successfully");
});


// ─── BULK ASSIGN RIDER (ADMIN - BULK ORDERS FOR ONE RIDER) ─────────────────────
exports.bulkAssignRider = asyncHandler(async (req, res) => {
  const { order_ids, rider_id, new_status } = req.body;

  if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
    return ApiResponse.error(res, "order_ids array is required", 400);
  }

  if (!rider_id) {
    return ApiResponse.error(res, "rider_id is required", 400);
  }

  const rider = await Rider.findByPk(rider_id, {
    include: [{ model: User, as: "user", attributes: ["name", "phone"] }]
  });
  if (!rider) return ApiResponse.error(res, "Rider not found", 404);
  if (!rider.is_verified) return ApiResponse.error(res, "Rider is not verified yet", 400);

  const targetStatus = new_status || "ASSIGNED";

  // Bulk update all specified orders in SQL
  const [updatedCount] = await MasterOrder.update(
    {
      rider_id: rider.id,
      status: targetStatus,
    },
    {
      where: {
        id: { [Op.in]: order_ids }
      }
    }
  );

  const updatedOrders = await MasterOrder.findAll({
    where: { id: { [Op.in]: order_ids } },
    include: [{ model: OrderItem, as: "items" }]
  });

  for (const o of updatedOrders) {
    notifyRider(rider, {
      title: "New Order Assigned 🛵",
      body: `You have been assigned Order #${o.order_number || o.id}.`,
      data: { order_id: o.id.toString(), type: "ORDER_ASSIGNED" },
    });
  }

  return ApiResponse.success(
    res,
    {
      assigned_count: updatedCount,
      rider: { id: rider.id, name: rider.user?.name, phone: rider.user?.phone },
      orders: updatedOrders
    },
    `Successfully assigned ${updatedCount} bulk orders to delivery rider ${rider.user?.name || ''}`
  );
});

// ─── BULK UPDATE RIDER ORDERS STATUS (RIDER / ADMIN) ──────────────────────────
exports.bulkUpdateRiderOrders = asyncHandler(async (req, res) => {
  const { order_ids, status } = req.body;

  if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
    return ApiResponse.error(res, "order_ids array is required", 400);
  }

  // Riders update their own active orders: ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
  // PREPARING is set by admin/restaurant, ASSIGNED is set by the assign endpoint.
  const validStatuses = ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
  if (!status || !validStatuses.includes(status)) {
    return ApiResponse.error(res, `Invalid status. Allowed for bulk rider update: ${validStatuses.join(", ")}`, 400);
  }

  // Build update fields — for DELIVERED, also mark COD orders as paid in one pass
  const updateFields = { status };
  if (status === "DELIVERED") {
    // We do two targeted updates: one for COD (mark paid), one for all
    // First update: COD-specific — set payment_status and is_paid
    await MasterOrder.update(
      { status: "DELIVERED", payment_status: "PAID", is_paid: true },
      { where: { id: { [Op.in]: order_ids }, payment_method: "COD" } }
    );
    // Second update: non-COD orders — just status (no payment change needed)
    await MasterOrder.update(
      { status: "DELIVERED" },
      { where: { id: { [Op.in]: order_ids }, payment_method: { [Op.ne]: "COD" } } }
    );
  } else {
    await MasterOrder.update(updateFields, {
      where: { id: { [Op.in]: order_ids } }
    });
  }

  const updatedOrders = await MasterOrder.findAll({
    where: { id: { [Op.in]: order_ids } },
    include: [{ model: OrderItem, as: "items" }]
  });

  if (status === "DELIVERED") {
    for (const o of updatedOrders) {
      notifyAdmin({
        title: "Order Delivered! ✅",
        body: `Order #${o.order_number || o.id} has been delivered.`,
        data: { order_id: o.id.toString(), type: "ORDER_DELIVERED" },
      });
      if (o.user_id) {
        notifyCustomer(o.user_id, {
          title: "Order Delivered! 😋",
          body: `Your order #${o.order_number || o.id} has been delivered. Enjoy your meal!`,
          data: { order_id: o.id.toString(), type: "ORDER_STATUS_CHANGE" },
        });
      }
    }
  }

  return ApiResponse.success(
    res,
    { updated_count: updatedOrders.length, orders: updatedOrders },
    `Bulk updated ${updatedOrders.length} orders to ${status}`
  );
});


// ─── GET RIDER ASSIGNED ORDERS (RIDER - BULK / MULTIPLE ACTIVE) ───────────────
exports.getRiderOrders = asyncHandler(async (req, res) => {
  const rider = await Rider.findOne({ where: { user_id: req.user.id } });
  if (!rider) return ApiResponse.error(res, "Rider profile not found", 404);

  const { status } = req.query;
  const whereClause = { rider_id: rider.id };
  if (status) {
    whereClause.status = status;
  }

  const orders = await MasterOrder.findAll({
    where: whereClause,
    include: [
      { model: OrderItem, as: "items" },
      { model: User, as: "user", attributes: ["id", "name", "phone"] }
    ],
    order: [["createdAt", "DESC"]],
  });

  return ApiResponse.success(res, {
    rider_id: rider.id,
    total_assigned: orders.length,
    orders
  });
});

// ─── GET ALL ORDERS (ADMIN) ───────────────────────────────────────────────────
exports.getAllOrders = asyncHandler(async (req, res) => {
  const { status, order_type, limit = 50, offset = 0 } = req.query;
  const whereClause = {};
  if (status) whereClause.status = status;
  if (order_type) whereClause.order_type = order_type;

  const parsedLimit = Math.min(parseInt(limit) || 50, 200); // max 200 per page
  const parsedOffset = parseInt(offset) || 0;

  const orders = await MasterOrder.findAll({
    where: whereClause,
    include: [
      { model: OrderItem, as: "items" },
      { model: User, as: "user", attributes: ["id", "name", "phone"] },
      {
        model: Rider,
        as: "rider",
        include: [{ model: User, as: "user", attributes: ["id", "name", "phone"] }],
      },
    ],
    order: [["createdAt", "DESC"]],
    limit: parsedLimit,
    offset: parsedOffset,
  });

  return ApiResponse.success(res, orders);
});

// ─── CANCEL ORDER ─────────────────────────────────────────────────────────────
exports.cancelOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await MasterOrder.findByPk(id);

  if (!order) return ApiResponse.error(res, "Order not found", 404);

  if (req.user.role === "CUSTOMER" && order.user_id !== req.user.id) {
    return ApiResponse.error(res, "Access denied", 403);
  }

  if (["DELIVERED", "CANCELLED"].includes(order.status)) {
    return ApiResponse.error(res, `Cannot cancel order in ${order.status} state`, 400);
  }

  // Customers can only cancel at PLACED or ACCEPTED — once PREPARING starts, kitchen is working.
  // New flow: PLACED → ACCEPTED → PREPARING → ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
  if (req.user.role === "CUSTOMER" && ["PREPARING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(order.status)) {
    return ApiResponse.error(res, "Order cannot be cancelled once the kitchen has started preparing", 400);
  }

  await sequelize.transaction(async (t) => {
    order.status = "CANCELLED";
    await order.save({ transaction: t });

    // Restore Stock — fetch items INSIDE the transaction to prevent race condition
    const orderItems = await OrderItem.findAll({
      where: { master_order_id: order.id },
      transaction: t,
    });
    for (const item of orderItems) {
      await Product.increment("stock_quantity", {
        by: item.quantity,
        where: { id: item.product_id },
        transaction: t,
      });
    }
  });

  return ApiResponse.success(res, order, "Order cancelled successfully");
});

// ─── RIDER UPDATE SINGLE ORDER STATUS ────────────────────────────────────────
exports.riderUpdateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // Riders can push their assigned orders forward: ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
  // PREPARING is set by the restaurant/admin — riders do not set this.
  const allowedRiderStatuses = ["OUT_FOR_DELIVERY", "DELIVERED"];
  if (!status || !allowedRiderStatuses.includes(status)) {
    return ApiResponse.error(res, `Riders can only set: ${allowedRiderStatuses.join(", ")}`, 400);
  }

  const rider = await Rider.findOne({ where: { user_id: req.user.id } });
  if (!rider) return ApiResponse.error(res, "Rider profile not found", 404);

  const order = await MasterOrder.findByPk(id);
  if (!order) return ApiResponse.error(res, "Order not found", 404);

  // Rider can only update orders assigned to them
  if (order.rider_id !== rider.id) {
    return ApiResponse.error(res, "This order is not assigned to you", 403);
  }

  if (["DELIVERED", "CANCELLED"].includes(order.status)) {
    return ApiResponse.error(res, `Order is already ${order.status}`, 400);
  }

  order.status = status;
  if (status === "DELIVERED" && order.payment_method === "COD") {
    order.payment_status = "PAID";
    order.is_paid = true;
  }
  await order.save();

  if (status === "DELIVERED") {
    notifyAdmin({
      title: "Order Completed! ✅",
      body: `Order #${order.order_number || order.id} has been delivered.`,
      data: { order_id: order.id.toString(), type: "ORDER_DELIVERED" },
    });
    if (order.user_id) {
      notifyCustomer(order.user_id, {
        title: "Order Delivered! 😋",
        body: `Your order #${order.order_number || order.id} has been delivered. Enjoy your meal!`,
        data: { order_id: order.id.toString(), type: "ORDER_STATUS_CHANGE" },
      });
    }
  }

  return ApiResponse.success(res, order, `Order status updated to ${status}`);
});

// ─── VERIFY DELIVERY OTP (RIDER) ─────────────────────────────────────────────
exports.verifyDeliveryOTP = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { otp } = req.body;

  if (!otp) return ApiResponse.error(res, "OTP code is required", 400);

  const rider = await Rider.findOne({ where: { user_id: req.user.id } });
  if (!rider) return ApiResponse.error(res, "Rider profile not found", 404);

  const order = await MasterOrder.findByPk(id);
  if (!order) return ApiResponse.error(res, "Order not found", 404);

  if (order.rider_id !== rider.id) {
    return ApiResponse.error(res, "This order is not assigned to you", 403);
  }

  if (order.status === "DELIVERED") {
    return ApiResponse.error(res, "Order is already delivered", 400);
  }

  if (order.delivery_otp && order.delivery_otp !== otp.toString().trim()) {
    return ApiResponse.error(res, "Invalid delivery OTP. Please check with customer.", 400);
  }

  order.status = "DELIVERED";
  if (order.payment_method === "COD") {
    order.payment_status = "PAID";
    order.is_paid = true;
  }
  await order.save();

  notifyAdmin({
    title: "Order Delivered! ✅",
    body: `Order #${order.order_number || order.id} verified with OTP and delivered.`,
    data: { order_id: order.id.toString(), type: "ORDER_DELIVERED" },
  });
  if (order.user_id) {
    notifyCustomer(order.user_id, {
      title: "Order Delivered! 😋",
      body: `Your order #${order.order_number || order.id} has been delivered. Enjoy your meal!`,
      data: { order_id: order.id.toString(), type: "ORDER_STATUS_CHANGE" },
    });
  }

  return ApiResponse.success(res, order, "Delivery OTP verified and order marked as DELIVERED successfully!");
});

// ─── CANCEL ORDER (CUSTOMER / ADMIN) ─────────────────────────────────────────
exports.cancelOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { cancel_reason } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  const order = await MasterOrder.findByPk(id, {
    include: [{ model: OrderItem, as: "items" }],
  });

  if (!order) {
    return ApiResponse.error(res, "Order not found", 404);
  }

  if (userRole === "CUSTOMER" && order.user_id !== userId) {
    return ApiResponse.error(res, "Access denied: this order does not belong to you", 403);
  }

  if (["DELIVERED", "CANCELLED"].includes(order.status)) {
    return ApiResponse.error(res, `Cannot cancel an order that is already ${order.status}`, 400);
  }

  if (userRole === "CUSTOMER" && !["PLACED", "ACCEPTED", "PENDING"].includes(order.status)) {
    return ApiResponse.error(res, `Order is already ${order.status} and cannot be cancelled by customer`, 400);
  }

  // Restore inventory stock
  if (order.items && order.items.length > 0) {
    for (const item of order.items) {
      if (item.product_id && item.quantity) {
        await Product.increment("stock_quantity", {
          by: item.quantity,
          where: { id: item.product_id },
        }).catch(err => console.warn("Stock restore warn:", err.message));
      }
    }
  }

  order.status = "CANCELLED";
  order.cancel_reason = cancel_reason || "Cancelled by user";
  order.cancelled_by = userRole;
  await order.save();

  return ApiResponse.success(res, order.toJSON(), "Order cancelled successfully");
});

// ─── SUBMIT ORDER REVIEW (CUSTOMER) ──────────────────────────────────────────
exports.submitOrderReview = asyncHandler(async (req, res) => {
  const orderId = req.params.id || req.body.order_id || req.body.orderId;
  const { productReviews, riderRating, riderComment } = req.body;
  const userId = req.user.id;

  let order = null;
  if (orderId) {
    order = await MasterOrder.findByPk(orderId);
    if (!order) {
      order = await MasterOrder.findOne({ where: { order_number: orderId } });
    }
  }

  // 1. Process Product / Food Reviews
  if (productReviews && Array.isArray(productReviews)) {
    for (const rev of productReviews) {
      const pId = rev.productId || rev.product_id;
      const rating = Math.max(1, Math.min(5, parseFloat(rev.rating) || 5.0));
      const comment = rev.comment || rev.reviewText || "";

      if (pId) {
        // Find existing review from this user for this order/product to avoid duplicate inflation
        let existingReview = null;
        if (order) {
          existingReview = await Review.findOne({
            where: {
              user_id: userId,
              product_id: pId,
              master_order_id: order.id,
              review_type: "PRODUCT",
            },
          });
        }

        if (existingReview) {
          existingReview.rating = rating;
          existingReview.comment = comment;
          await existingReview.save();
        } else {
          await Review.create({
            user_id: userId,
            master_order_id: order ? order.id : null,
            product_id: pId,
            rating,
            comment,
            review_type: "PRODUCT",
          });
        }

        // Recalculate Product average rating & count
        const allReviews = await Review.findAll({
          where: { product_id: pId, review_type: "PRODUCT", is_hidden: false },
        });
        const totalRating = allReviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0);
        const avg = allReviews.length > 0 ? (totalRating / allReviews.length) : rating;

        await Product.update(
          {
            rating: parseFloat(avg.toFixed(1)),
            rating_count: allReviews.length,
          },
          { where: { id: pId } }
        );
      }
    }
  }

  // 2. Process Delivery Rider Review
  const targetRiderId = order?.rider_id || req.body.rider_id || req.body.riderId;
  if (riderRating && targetRiderId) {
    const rRating = Math.max(1, Math.min(5, parseFloat(riderRating) || 5.0));
    const rComment = riderComment || req.body.rider_comment || "";

    let existingRiderReview = null;
    if (order) {
      existingRiderReview = await Review.findOne({
        where: {
          user_id: userId,
          rider_id: targetRiderId,
          master_order_id: order.id,
          review_type: "RIDER",
        },
      });
    }

    if (existingRiderReview) {
      existingRiderReview.rating = rRating;
      existingRiderReview.comment = rComment;
      await existingRiderReview.save();
    } else {
      await Review.create({
        user_id: userId,
        master_order_id: order ? order.id : null,
        rider_id: targetRiderId,
        rating: rRating,
        comment: rComment,
        review_type: "RIDER",
      });
    }

    // Recalculate Rider average rating & count
    const allRiderReviews = await Review.findAll({
      where: { rider_id: targetRiderId, review_type: "RIDER", is_hidden: false },
    });
    const totalRiderRating = allRiderReviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0);
    const avgRider = allRiderReviews.length > 0 ? (totalRiderRating / allRiderReviews.length) : rRating;

    await Rider.update(
      {
        rating: parseFloat(avgRider.toFixed(1)),
        rating_count: allRiderReviews.length,
      },
      { where: { id: targetRiderId } }
    );
  }

  return ApiResponse.success(res, { success: true }, "Review submitted successfully!");
});

