const { Op } = require("sequelize");
const { MasterOrder, OrderItem, Cart, CartItem, Product, User, CustomerAddress, Rider, PlatformSettings, sequelize } = require("../models");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { calculateRoadDistance } = require("../utils/geoUtils");
const { getPlatformSettingsMap } = require("./platformController");

// Helper: Generate unique order number (e.g., KUNTI-100234)
function generateOrderNumber() {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `KUNTI-${randomNum}`;
}

// ─── CREATE ORDER ─────────────────────────────────────────────────────────────
exports.createOrder = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { address_id, payment_method, notes, order_type, table_number } = req.body;

  // Validate order type — default to DELIVERY
  const validOrderTypes = ["DELIVERY", "DINE_IN"];
  const selectedOrderType = validOrderTypes.includes(order_type) ? order_type : "DELIVERY";

  const validPaymentMethods = ["COD", "ONLINE"];
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
    if (!address_id) {
      return ApiResponse.error(res, "Delivery address is required for delivery orders", 400);
    }

    address = await CustomerAddress.findOne({ where: { id: address_id, user_id: userId } });
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

  // ── Calculate Delivery Fee (DELIVERY only) ────────────────────────────────
  if (selectedOrderType === "DELIVERY") {
    deliveryFee = estimatedDistance <= 3 ? deliveryFee0to3 : deliveryFee3to5;
    if (subtotal >= freeDeliveryThreshold) {
      deliveryFee = 0; // Free delivery above threshold
    }
  }
  // DINE_IN orders: no delivery fee

  const totalAmount = subtotal + deliveryFee;

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

    // 3. Clear Customer Cart
    await CartItem.destroy({ where: { cart_id: cart.id }, transaction: t });

    return masterOrder;
  });

  // Return created order with items
  const createdOrder = await MasterOrder.findByPk(result.id, {
    include: [{ model: OrderItem, as: "items" }],
  });

  return ApiResponse.success(res, createdOrder, "Order placed successfully", 201);
});


// ─── GET USER ORDERS (CUSTOMER) ───────────────────────────────────────────────
exports.getUserOrders = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const orders = await MasterOrder.findAll({
    where: { user_id: userId },
    include: [{ model: OrderItem, as: "items" }],
    order: [["createdAt", "DESC"]],
  });

  return ApiResponse.success(res, orders);
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

  return ApiResponse.success(res, order);
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

  const rider = await Rider.findByPk(rider_id);
  if (!rider) return ApiResponse.error(res, "Rider not found", 404);
  if (!rider.is_verified) return ApiResponse.error(res, "Rider is not verified yet", 400);

  order.rider_id = rider.id;
  // Flow: PLACED → ACCEPTED → PREPARING → ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
  // Rider is assigned after the kitchen has started preparing. Status becomes ASSIGNED.
  order.status = "ASSIGNED";
  await order.save();

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

  return ApiResponse.success(res, order, `Order status updated to ${status}`);
});
