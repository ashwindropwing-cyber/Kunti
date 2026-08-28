const { Coupon, CouponUsage, Cart, CartItem, Product } = require("../models");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const cacheService = require("../services/cacheService");
const { Op } = require("sequelize");


/**
 * Helper: Calculate discount amount for a given coupon and subtotal
 */
function calculateDiscount(coupon, subtotal) {
  let discountAmount = 0;

  if (coupon.discount_type === "PERCENTAGE") {
    discountAmount = (subtotal * parseFloat(coupon.discount_value)) / 100;
    if (coupon.max_discount_amount && coupon.max_discount_amount > 0) {
      discountAmount = Math.min(discountAmount, parseFloat(coupon.max_discount_amount));
    }
  } else if (coupon.discount_type === "FIXED") {
    discountAmount = parseFloat(coupon.discount_value);
  }

  // Discount cannot exceed subtotal
  discountAmount = Math.min(discountAmount, subtotal);
  return Math.round(discountAmount * 100) / 100;
}

/**
 * Helper: Validate coupon eligibility for a user & subtotal
 */
async function validateCoupon(code, userId, subtotal) {
  const coupon = await Coupon.findOne({
    where: { code: code.toUpperCase().trim() },
  });

  if (!coupon) {
    return { valid: false, message: "Invalid coupon code", coupon: null, discount: 0 };
  }

  if (!coupon.is_active) {
    return { valid: false, message: "This coupon is no longer active", coupon, discount: 0 };
  }

  const now = new Date();
  if (coupon.start_date) {
    const startDate = new Date(coupon.start_date);
    startDate.setHours(0, 0, 0, 0);
    if (startDate > now) {
      return { valid: false, message: "This coupon is not valid yet", coupon, discount: 0 };
    }
  }
  if (coupon.end_date) {
    const endDate = new Date(coupon.end_date);
    endDate.setHours(23, 59, 59, 999);
    if (endDate < now) {
      return { valid: false, message: "This coupon has expired", coupon, discount: 0 };
    }
  }

  if (coupon.total_usage_limit && coupon.used_count >= coupon.total_usage_limit) {
    return { valid: false, message: "Coupon usage limit reached", coupon, discount: 0 };
  }

  if (subtotal < parseFloat(coupon.min_order_amount || 0)) {
    return {
      valid: false,
      message: `Minimum order amount of ₹${coupon.min_order_amount} required for this coupon`,
      coupon,
      discount: 0,
    };
  }

  // Check per-user usage count
  if (userId && coupon.usage_limit_per_user) {
    const userUsages = await CouponUsage.count({
      where: { user_id: userId, coupon_id: coupon.id },
    });
    if (userUsages >= coupon.usage_limit_per_user) {
      return {
        valid: false,
        message: `You have already used this coupon maximum allowed times (${coupon.usage_limit_per_user})`,
        coupon,
        discount: 0,
      };
    }
  }

  const discount = calculateDiscount(coupon, subtotal);
  return { valid: true, message: "Coupon applied successfully", coupon, discount };
}

// ─── ADMIN: CREATE COUPON ──────────────────────────────────────────────────
exports.createCoupon = asyncHandler(async (req, res) => {
  let {
    code,
    description,
    discount_type,
    discount_value,
    discountPercent,
    discountAmount,
    max_discount_amount,
    maxDiscount,
    min_order_amount,
    minOrderValue,
    usage_limit_per_user,
    max_usage_per_user,
    maxUsage,
    usageLimitPerUser,
    total_usage_limit,
    totalUsageLimit,
    start_date,
    end_date,
  } = req.body;

  const actualDiscountVal = discount_value !== undefined ? discount_value : (discountPercent !== undefined ? discountPercent : discountAmount);

  if (!code || actualDiscountVal === undefined || actualDiscountVal === null) {
    return ApiResponse.error(res, "Code and discount_value are required", 400);
  }

  code = code.toUpperCase().trim();

  const existing = await Coupon.findOne({ where: { code } });
  if (existing) {
    return ApiResponse.error(res, `Coupon code '${code}' already exists`, 400);
  }

  const resolvedUsagePerUser = usage_limit_per_user ?? max_usage_per_user ?? maxUsage ?? usageLimitPerUser ?? 1;
  const resolvedTotalUsage = total_usage_limit ?? totalUsageLimit ?? 1000;

  const coupon = await Coupon.create({
    code,
    description: description || null,
    discount_type: discount_type === "FIXED" ? "FIXED" : "PERCENTAGE",
    discount_value: parseFloat(actualDiscountVal),
    max_discount_amount: (max_discount_amount || maxDiscount) ? parseFloat(max_discount_amount || maxDiscount) : 0,
    min_order_amount: (min_order_amount || minOrderValue) ? parseFloat(min_order_amount || minOrderValue) : 0,
    usage_limit_per_user: parseInt(resolvedUsagePerUser),
    total_usage_limit: parseInt(resolvedTotalUsage),
    start_date: start_date ? new Date(start_date) : null,
    end_date: end_date ? new Date(end_date) : null,
    is_active: true,
  });

  await cacheService.delPattern("coupons*");
  return ApiResponse.success(res, coupon, "Coupon created successfully", 201);
});

// ─── ADMIN: GET ALL COUPONS ────────────────────────────────────────────────
exports.getAllCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.findAll({
    order: [["createdAt", "DESC"]],
  });
  return ApiResponse.success(res, coupons);
});

// ─── ADMIN: UPDATE COUPON ──────────────────────────────────────────────────
exports.updateCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const coupon = await Coupon.findByPk(id);
  if (!coupon) {
    return ApiResponse.error(res, "Coupon not found", 404);
  }

  const allowedFields = [
    "description",
    "discount_type",
    "discount_value",
    "max_discount_amount",
    "min_order_amount",
    "usage_limit_per_user",
    "max_usage_per_user",
    "maxUsage",
    "total_usage_limit",
    "start_date",
    "end_date",
    "is_active",
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (["discount_value", "max_discount_amount", "min_order_amount"].includes(field)) {
        coupon[field] = parseFloat(req.body[field]);
      } else if (["usage_limit_per_user", "max_usage_per_user", "maxUsage"].includes(field)) {
        coupon.usage_limit_per_user = parseInt(req.body[field]);
      } else if (field === "total_usage_limit") {
        coupon.total_usage_limit = parseInt(req.body[field]);
      } else if (["start_date", "end_date"].includes(field)) {
        coupon[field] = req.body[field] ? new Date(req.body[field]) : null;
      } else {
        coupon[field] = req.body[field];
      }
    }
  }

  await coupon.save();
  await cacheService.delPattern("coupons*");
  return ApiResponse.success(res, coupon, "Coupon updated successfully");
});

// ─── ADMIN: TOGGLE ACTIVE/INACTIVE ──────────────────────────────────────────
exports.toggleCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const coupon = await Coupon.findByPk(id);
  if (!coupon) {
    return ApiResponse.error(res, "Coupon not found", 404);
  }

  coupon.is_active = !coupon.is_active;
  await coupon.save();
  await cacheService.delPattern("coupons*");

  return ApiResponse.success(
    res,
    coupon,
    `Coupon '${coupon.code}' ${coupon.is_active ? "activated" : "deactivated"}`
  );
});

// ─── ADMIN: DELETE COUPON ──────────────────────────────────────────────────
exports.deleteCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const coupon = await Coupon.findByPk(id);
  if (!coupon) {
    return ApiResponse.error(res, "Coupon not found", 404);
  }

  // Clean up associated usage records
  await CouponUsage.destroy({ where: { coupon_id: id } }).catch((e) => console.warn("CouponUsage cleanup error:", e.message));

  await coupon.destroy();
  await cacheService.delPattern("coupons*");
  return ApiResponse.success(res, { id }, "Coupon deleted successfully");
});


// ─── CUSTOMER: LIST AVAILABLE COUPONS ──────────────────────────────────────
exports.getAvailableCoupons = asyncHandler(async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const cacheKey = `coupons_available_${userId || 'anon'}`;
  
  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return ApiResponse.success(res, cached);
  }

  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  // Fetch active coupons within valid date range
  const coupons = await Coupon.findAll({
    where: {
      is_active: true,
      [Op.and]: [
        { [Op.or]: [{ start_date: null }, { start_date: { [Op.lte]: endOfDay } }] },
        { [Op.or]: [{ end_date: null }, { end_date: { [Op.gte]: startOfDay } }] },
      ],
    },
    order: [["min_order_amount", "ASC"]],
  });

  // Filter out coupons where user reached personal usage limit or global usage limit
  const availableCoupons = [];
  for (const c of coupons) {
    if (c.total_usage_limit && c.used_count >= c.total_usage_limit) {
      continue;
    }

    if (userId && c.usage_limit_per_user) {
      const userUsages = await CouponUsage.count({
        where: { user_id: userId, coupon_id: c.id },
      });
      if (userUsages >= c.usage_limit_per_user) {
        continue;
      }
    }

    availableCoupons.push({
      id: c.id,
      code: c.code,
      description: c.description,
      discount_type: c.discount_type,
      discount_value: c.discount_value,
      max_discount_amount: c.max_discount_amount,
      min_order_amount: c.min_order_amount,
      end_date: c.end_date,
    });
  }

  await cacheService.set(cacheKey, availableCoupons, 60);
  return ApiResponse.success(res, availableCoupons);
});


// ─── CUSTOMER: APPLY / PREVIEW COUPON ──────────────────────────────────────
exports.applyCoupon = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let { code, subtotal } = req.body;

  if (!code) {
    return ApiResponse.error(res, "Coupon code is required", 400);
  }

  let cartSubtotal = subtotal ? parseFloat(subtotal) : 0;

  // If subtotal is not passed, calculate dynamically from customer's current cart
  if (!cartSubtotal || cartSubtotal <= 0) {
    const cart = await Cart.findOne({ where: { user_id: userId } });
    if (cart) {
      const cartItems = await CartItem.findAll({ where: { cart_id: cart.id } });
      if (cartItems && cartItems.length > 0) {
        const productIds = cartItems.map((i) => i.product_id);
        const products = await Product.findAll({ where: { id: { [Op.in]: productIds } } });
        const productMap = products.reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {});

        for (const item of cartItems) {
          const product = productMap[item.product_id];
          if (product && product.is_available) {
            const price = parseFloat(product.discount_price || product.price) || 0;
            cartSubtotal += price * item.quantity;
          }
        }
      }
    }
  }

  if (cartSubtotal <= 0) {
    return ApiResponse.error(res, "Cart is empty or invalid subtotal", 400);
  }

  const result = await validateCoupon(code, userId, cartSubtotal);

  if (!result.valid) {
    return ApiResponse.error(res, result.message, 400);
  }

  const finalSubtotal = Math.max(0, cartSubtotal - result.discount);

  return ApiResponse.success(
    res,
    {
      code: result.coupon.code,
      discount_amount: result.discount,
      original_subtotal: cartSubtotal,
      final_subtotal: finalSubtotal,
      description: result.coupon.description,
    },
    `Coupon '${result.coupon.code}' applied! Saved ₹${result.discount}`
  );
});

exports.validateCoupon = validateCoupon;
exports.calculateDiscount = calculateDiscount;
