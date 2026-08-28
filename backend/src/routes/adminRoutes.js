const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const {
  verifyToken,
  allowRoles,
} = require("../middlewares/authMiddleware");
const { heavyReadLimiter, uploadLimiter } = require("../middlewares/rateLimiter");
const { cacheFor } = require("../middlewares/responseCache");

const platformController = require("../controllers/platformController");
const orderController = require("../controllers/orderController");

// Get real-time admin dashboard metrics
router.get(
  "/dashboard-metrics",
  verifyToken,
  allowRoles("ADMIN"),
  cacheFor(30),
  adminController.getDashboardMetrics
);

router.get(
  "/dashboard",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.getDashboardMetrics
);

router.get(
  "/store-settings",
  verifyToken,
  allowRoles("ADMIN"),
  platformController.getAllSettings
);

router.get(
  "/customers",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.getAllUsers
);

router.get(
  "/orders",
  verifyToken,
  allowRoles("ADMIN"),
  orderController.getAllOrders
);

// RIDERS MANAGEMENT (ADMIN)
router.post(
  "/rider/create",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.createRiderByAdmin
);

router.get(
  "/riders",
  verifyToken,
  allowRoles("ADMIN"),
  heavyReadLimiter,
  cacheFor(30),
  adminController.getAllRiders
);

router.get(
  "/rider/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.getRiderById
);

router.patch(
  "/rider/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.updateRiderByAdmin
);

router.delete(
  "/rider/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.deleteRiderByAdmin
);
router.delete(
  "/riders/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.deleteRiderByAdmin
);

// Rider Profile Update Approval/Rejection
router.patch(
  "/rider/:id/profile-update/approve",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.approveRiderProfileUpdate
);

router.patch(
  "/rider/:id/profile-update/reject",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.rejectRiderProfileUpdate
);

router.patch(
  "/rider/:id/verify",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.verifyRider
);

// USER MANAGEMENT
router.get(
  "/users",
  verifyToken,
  allowRoles("ADMIN"),
  heavyReadLimiter,
  adminController.getAllUsers
);

router.post(
  "/user/create",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.createUserByAdmin
);

router.patch(
  "/user/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.updateUserByAdmin
);

router.delete(
  "/user/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.deleteUserByAdmin
);

// Confirm COD payment received from rider
router.patch(
  "/order/:id/confirm-payment",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.confirmOrderPayment
);

// REVIEWS MANAGEMENT
router.get(
  "/reviews",
  verifyToken,
  allowRoles("ADMIN"),
  heavyReadLimiter,
  adminController.getAllReviews
);

router.post(
  "/reviews/:id/reply",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.replyToReview
);

router.patch(
  "/reviews/:id/reply",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.replyToReview
);

router.patch(
  "/reviews/:id/toggle-hide",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.toggleHideReview
);

router.delete(
  "/reviews/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.deleteReviewByAdmin
);

// PUSH NOTIFICATIONS BROADCAST (ADMIN)
router.post(
  "/notifications/broadcast",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.broadcastNotification
);

module.exports = router;