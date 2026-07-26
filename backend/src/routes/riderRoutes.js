const express = require("express");
const router = express.Router();
const riderController = require("../controllers/riderController");
const {
  verifyToken,
  allowRoles,
} = require("../middlewares/authMiddleware");

const upload = require("../utils/upload");
const documentUpload = require("../utils/documentUpload");
const { uploadLimiter } = require("../middlewares/rateLimiter");

/**
 * RIDER REGISTRATION
 */
router.post("/register", uploadLimiter, upload.single("profile_picture"), riderController.register);

/**
 * RIDER ONLINE / OFFLINE
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

// Map tracking and radius features removed

router.patch(
  "/fcm-token",
  verifyToken,
  allowRoles("RIDER"),
  riderController.updateFcmToken
);
router.post(
  "/documents/upload",
  verifyToken,
  allowRoles("RIDER"),
  uploadLimiter,
  documentUpload.array("document", 3),
  riderController.uploadDocument
);

router.get(
  "/documents/my",
  verifyToken,
  allowRoles("RIDER"),
  riderController.getMyDocuments
);

router.get(
  "/reviews",
  verifyToken,
  allowRoles("RIDER"),
  riderController.getRiderReviews
);

module.exports = router;
