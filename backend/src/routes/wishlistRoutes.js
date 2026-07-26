const express = require("express");
const router = express.Router();
const wishlistController = require("../controllers/wishlistController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");

// Add
router.post(
  "/add",
  verifyToken,
  allowRoles("CUSTOMER"),
  wishlistController.addToWishlist
);

// Remove
router.post(
  "/remove",
  verifyToken,
  allowRoles("CUSTOMER"),
  wishlistController.removeFromWishlist
);

// Clear
router.post(
  "/clear",
  verifyToken,
  allowRoles("CUSTOMER"),
  wishlistController.clearWishlist
);

// Get
router.get(
  "/my",
  verifyToken,
  allowRoles("CUSTOMER"),
  wishlistController.getWishlist
);

module.exports = router;