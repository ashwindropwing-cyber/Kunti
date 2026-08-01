const Rider = require("../models/rider");
const MasterOrder = require("../models/masterOrder");
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const Review = require("../models/review");
const PlatformSettings = require("../models/platformSettings");

const { admin } = require("../config/firebase");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { chunkedFindAll } = require("../utils/dbHelper");

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

exports.getDashboard = asyncHandler(async (req, res) => {
  const rider = await Rider.findOne({
    where: { user_id: req.user.id },
  });

  if (!rider) {
    return ApiResponse.error(res, "Rider not found", 404);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch all rider orders with single simple query to avoid Firestore composite index issues
  const allRiderOrders = await MasterOrder.findAll({
    where: { rider_id: rider.id },
  });

  // Compute all stats in-memory
  // Status flow: PLACED → ACCEPTED → PREPARING → ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
  const completedOrders = allRiderOrders.filter(o => o.status === "DELIVERED").length;
  const assignedOrders = allRiderOrders.filter(o => o.status === "ASSIGNED").length;         // food ready, rider picking up
  const outForDeliveryOrders = allRiderOrders.filter(o => o.status === "OUT_FOR_DELIVERY").length;
  const codPendingAssigned = allRiderOrders.filter(o =>
    o.status === "ASSIGNED" && o.payment_method === "COD" && !o.cod_collected
  ).length;
  const codPendingOut = allRiderOrders.filter(o =>
    o.status === "OUT_FOR_DELIVERY" && o.payment_method === "COD" && !o.cod_collected
  ).length;

  // Today's delivered orders — use updatedAt since there's no delivered_at column
  const todayOrders = allRiderOrders.filter(o => {
    if (o.status !== "DELIVERED") return false;
    const deliveredAt = o.updatedAt instanceof Date ? o.updatedAt : new Date(o.updatedAt);
    return deliveredAt >= today;
  });

  // Today's delivery fee collected (for delivery orders completed today)
  const todayEarnings = todayOrders.reduce((sum, o) => sum + (parseFloat(o.delivery_fee) || 0), 0);
  const todayDeliveries = todayOrders.length;

  return ApiResponse.success(res, {
    rider_id: rider.id,
    is_available: rider.is_available,
    today_earnings: todayEarnings,
    today_deliveries: todayDeliveries,
    completed_orders: completedOrders,
    pending_orders: assignedOrders + outForDeliveryOrders,
    cod_pending_orders: codPendingAssigned + codPendingOut,
    completed_today: todayOrders.length,
    active_cod_orders: codPendingAssigned + codPendingOut,
    rating: toNumber(rider.rating),
    rating_count: toNumber(rider.rating_count),
    acceptance_rate: rider.acceptance_rate != null ? rider.acceptance_rate : 98.5,
    completion_rate: rider.completion_rate != null ? rider.completion_rate : 100.0,
    emergency_contact: rider.emergency_contact || "",
    bank_details: rider.bank_details || {},
    vehicle_type: rider.vehicle_type,
    vehicle_number: rider.vehicle_number,
  });
});

/**
 * REGISTER NEW RIDER
 * Public (with phone verification suggested in future)
 */
exports.register = asyncHandler(async (req, res) => {
  const {
    name, email, phone, address,
    vehicle_type, vehicle_number,
    license_number, aadhar_number, date_of_birth,
    delivery_radius_km
  } = req.body;

  console.log("[Rider Registration] Received body:", JSON.stringify(req.body));

  if (!phone || !name) {
    return ApiResponse.error(res, "Name and phone are required", 400);
  }

  // Validate Radius against Platform Settings
  const maxRadiusSetting = await PlatformSettings.findOne({ where: { key: "max_rider_radius_km" } });
  const maxRadius = maxRadiusSetting ? parseFloat(maxRadiusSetting.value) : 5;
  if (delivery_radius_km && parseFloat(delivery_radius_km) > maxRadius) {
    return ApiResponse.error(res, `Delivery radius cannot exceed platform limit of ${maxRadius} KM`, 400);
  }

  // 1. Handle User record
  let user = await User.findOne({ where: { phone } });
  if (user) {
    user.name = name;
    if (email) user.email = email;
    await user.save();
  } else {
    user = await User.create({
      name,
      phone,
      email,
      role: "RIDER",
      password: null
    });
  }

  // 2. Handle Rider profile record
  let rider = await Rider.findOne({ where: { user_id: user.id } });

  if (!rider) {
    console.log("[Rider Registration] Creating new rider profile for user:", user.id);
    rider = await Rider.create({
      user_id: user.id,
      vehicle_type: vehicle_type || "Bike",
      vehicle_number: vehicle_number || "",
      address: address || "",
      license_number: license_number || "",
      aadhar_number: aadhar_number || "",
      date_of_birth: date_of_birth || "",
      delivery_radius_km: parseFloat(delivery_radius_km) || 5.0,
      profile_picture_url: req.file ? req.file.path : "",
      is_verified: false,
      is_available: false,
      rating: 0.0,
      rating_count: 0
    });
  } else {
    console.log("[Profile Update] Updating existing rider profile:", user.id);
    if (req.body.vehicle_type !== undefined) rider.vehicle_type = req.body.vehicle_type;
    if (req.body.vehicle_number !== undefined) rider.vehicle_number = req.body.vehicle_number;
    if (req.body.address !== undefined) rider.address = req.body.address;
    if (req.body.license_number !== undefined) rider.license_number = req.body.license_number;
    if (req.body.aadhar_number !== undefined) rider.aadhar_number = req.body.aadhar_number;
    if (req.body.date_of_birth !== undefined) rider.date_of_birth = req.body.date_of_birth;
    if (req.file) rider.profile_picture_url = req.file.path;

    console.log("[Profile Update] New values for rider:", {
      vehicle_type: rider.vehicle_type,
      vehicle_number: rider.vehicle_number
    });

    if (delivery_radius_km !== undefined) {
      rider.delivery_radius_km = parseFloat(delivery_radius_km) || 5.0;
    }

    console.log("[Rider Registration] Profile before save:", {
      id: rider.id,
      vehicle_type: rider.vehicle_type,
      vehicle_number: rider.vehicle_number,
      delivery_radius_km: rider.delivery_radius_km
    });

    await rider.save();
  }

  // 3. Generate token so they are logged in immediately
  const token = jwt.sign(
    { id: user.id, role: "RIDER" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  // Re-fetch or use updated object to ensure response reflects reality
  const finalRider = await Rider.findOne({ where: { user_id: user.id } });

  console.log("[Rider Registration] Returning final rider data:", JSON.stringify(finalRider));

  return ApiResponse.success(res, {
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role
    },
    role_data: finalRider
  }, "Registration successful", 201);
});


/**
 * UPDATE RIDER LIVE LOCATION
 * Role: RIDER
 */
exports.updateLocation = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { current_lat, current_lng } = req.body;

  if (current_lat === undefined || current_lng === undefined) {
    return ApiResponse.error(res, "Latitude and Longitude required", 400);
  }

  const rider = await Rider.findOne({ where: { user_id: userId } });
  if (!rider) {
    return ApiResponse.error(res, "Rider not found", 404);
  }

  // Use single-field query to avoid Firestore composite index requirement
  const riderOrders = await MasterOrder.findAll({
    where: { rider_id: rider.id },
  });
  const activeOrder = riderOrders.find(
    (o) => o.status === "ASSIGNED" || o.status === "OUT_FOR_DELIVERY"
  );

  if (!rider.is_available && !activeOrder) {
    return ApiResponse.error(res, "Rider is offline", 400);
  }

  rider.current_lat = current_lat;
  rider.current_lng = current_lng;
  await rider.save();

  return ApiResponse.success(res, null, "Location updated");
});

/**
 * UPDATE RIDER AVAILABILITY (ONLINE / OFFLINE)
 * Role: RIDER
 */
exports.updateAvailability = async (req, res) => {
  try {
    const userId = req.user.id;
    const { is_available, current_lat, current_lng } = req.body;

    const rider = await Rider.findOne({
      where: { user_id: userId },
    });

    if (!rider) {
      return res.status(404).json({ message: "Rider profile not found" });
    }

    const lat = current_lat !== undefined ? current_lat : req.body.latitude;
    const lng = current_lng !== undefined ? current_lng : req.body.longitude;

    rider.is_available = is_available;

    if (is_available === true) {
      if (!rider.is_verified) {
        return res.status(403).json({
          message: "Verification required. Please complete your KYC and wait for admin approval.",
        });
      }
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({
          message: "Latitude and Longitude required when going online",
        });
      }
      rider.current_lat = lat;
      rider.current_lng = lng;
    }

    await rider.save();

    return res.json({
      message: `Rider is now ${is_available ? "ONLINE" : "OFFLINE"}`,
      is_available: rider.is_available,
    });
  } catch (error) {
    console.error("Update availability error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.updateFcmToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const normalizedToken = req.body?.fcm_token?.toString().trim();
    const orderNotificationsEnabled = req.body?.order_notifications_enabled;

    if (!normalizedToken && orderNotificationsEnabled === undefined) {
      return res.status(400).json({ message: "FCM token or notification setting required" });
    }

    const rider = await Rider.findOne({
      where: { user_id: userId },
    });

    if (!rider) {
      return res.status(404).json({ message: "Rider profile not found" });
    }

    if (normalizedToken) {
      rider.fcm_token = normalizedToken;
    }
    if (orderNotificationsEnabled !== undefined) {
      rider.order_notifications_enabled = orderNotificationsEnabled === true || orderNotificationsEnabled === "true";
    } else if (rider.order_notifications_enabled === undefined) {
      rider.order_notifications_enabled = true;
    }
    await rider.save();

    console.log(
      `[FCM] Token/Settings updated for rider ${rider.id} (User: ${userId}): token = ${normalizedToken ? "UPDATED" : "KEEP"}, order_notifications = ${rider.order_notifications_enabled}`
    );

    return res.json({
      message: "FCM token and settings updated",
      rider_id: rider.id,
      order_notifications_enabled: rider.order_notifications_enabled
    });
  } catch (error) {
    console.error("Update FCM token error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.getRiderReviews = asyncHandler(async (req, res) => {
  const rider = await Rider.findOne({ where: { user_id: req.user.id } });
  if (!rider) return ApiResponse.error(res, "Rider not found", 404);

  const reviews = await Review.findAll({
    where: { rider_id: rider.id, review_type: "RIDER" },
    order: [["createdAt", "DESC"]]
  });

  const userIds = reviews.map((r) => r.user_id).filter(Boolean);
  const users = await chunkedFindAll(User, "id", userIds);
  const userMap = users.reduce((m, u) => {
    m[u.id] = u;
    return m;
  }, {});

  const formatted = reviews.map((r) => {
    const reviewObj = typeof r.toJSON === 'function' ? r.toJSON() : { ...r };
    const user = userMap[r.user_id];
    return {
      ...reviewObj,
      User: user ? { name: user.name } : null
    };
  });

  return ApiResponse.success(res, formatted);
});


exports.requestRadiusChange = asyncHandler(async (req, res) => {
  // Radius change is managed via platform settings by admin.
  // Riders cannot directly request radius changes in this system.
  return ApiResponse.error(res, "Radius change requests are not supported. Contact admin to update delivery radius.", 400);
});

exports.getRiderNotifications = asyncHandler(async (req, res) => {
  const { Op } = require("sequelize");
  const Notification = require("../models/notification");
  
  const notifications = await Notification.findAll({
    where: {
      [Op.or]: [
        { target_audience: "RIDERS" },
        { target_audience: "ALL" },
        { user_id: req.user.id }
      ]
    },
    order: [["createdAt", "DESC"]]
  });

  return ApiResponse.success(res, notifications);
});


exports.getRadiusChangeStatus = asyncHandler(async (req, res) => {
  return ApiResponse.success(res, { has_pending: false });
});

