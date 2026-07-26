const express = require("express");
const router = express.Router();
const riderController = require("../controllers/riderController");
const {
  verifyToken,
  allowRoles,
} = require("../middlewares/authMiddleware");

const upload = require("../utils/upload");
const { uploadLimiter } = require("../middlewares/rateLimiter");

/**
 * RIDER REGISTRATION
 */
router.post("/register", uploadLimiter, upload.single("profile_picture"), riderController.register);

/**
 * RIDER ONLINE / OFFLINE & DASHBOARD
 */
router.get(
  "/dashboard",
  verifyToken,
  allowRoles("RIDER"),
  riderController.getDashboard
);

router.patch(
  "/availability",
  verifyToken,
  allowRoles("RIDER"),
  riderController.updateAvailability
);

router.patch(
  "/fcm-token",
  verifyToken,
  allowRoles("RIDER"),
  riderController.updateFcmToken
);

router.get(
  "/reviews",
  verifyToken,
  allowRoles("RIDER"),
  riderController.getRiderReviews
);

module.exports = router;
