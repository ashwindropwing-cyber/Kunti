const express = require("express");
const router = express.Router();
const couponController = require("../controllers/couponController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");

// ─── ADMIN ROUTES ──────────────────────────────────────────────────────────
router.post(
  "/admin",
  verifyToken,
  allowRoles("ADMIN"),
  couponController.createCoupon
);

router.get(
  "/admin/all",
  verifyToken,
  allowRoles("ADMIN"),
  couponController.getAllCoupons
);

router.patch(
  "/admin/:id",
  verifyToken,
  allowRoles("ADMIN"),
  couponController.updateCoupon
);

router.patch(
  "/admin/:id/toggle",
  verifyToken,
  allowRoles("ADMIN"),
  couponController.toggleCoupon
);

router.delete(
  "/admin/:id",
  verifyToken,
  allowRoles("ADMIN"),
  couponController.deleteCoupon
);

// ─── CUSTOMER ROUTES ────────────────────────────────────────────────────────
router.get(
  "/available",
  verifyToken,
  allowRoles("CUSTOMER"),
  couponController.getAvailableCoupons
);

router.post(
  "/apply",
  verifyToken,
  allowRoles("CUSTOMER"),
  couponController.applyCoupon
);

module.exports = router;
