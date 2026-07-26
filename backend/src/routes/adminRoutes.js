const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const {
  verifyToken,
  allowRoles,
} = require("../middlewares/authMiddleware");
const { heavyReadLimiter, uploadLimiter } = require("../middlewares/rateLimiter");
const { cacheFor } = require("../middlewares/responseCache");

// Get real-time admin dashboard metrics
router.get(
  "/dashboard-metrics",
  verifyToken,
  allowRoles("ADMIN"),
  cacheFor(30),
  adminController.getDashboardMetrics
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

const upload = require("../utils/upload");
router.post(
  "/rider/:id/documents",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("document"),
  adminController.uploadRiderDocumentByAdmin
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
  cacheFor(30),
  adminController.getAllReviews
);

router.delete(
  "/reviews/:id",
  verifyToken,
  allowRoles("ADMIN"),
  adminController.deleteReviewByAdmin
);

module.exports = router;