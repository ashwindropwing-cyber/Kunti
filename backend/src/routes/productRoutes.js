const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const upload = require("../utils/upload");
const {
  verifyToken,
  allowRoles,
} = require("../middlewares/authMiddleware");
const { uploadLimiter } = require("../middlewares/rateLimiter");

// Public/All Products
router.get("/", productController.getAdminAllProducts);

// Admin: List all
router.get("/admin/all", verifyToken, allowRoles("ADMIN"), productController.getAdminAllProducts);

// Admin: Create product
router.post(
  "/",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("image"),
  productController.adminCreateProduct
);

// Admin: Create product
router.post(
  "/admin",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("image"),
  productController.adminCreateProduct
);

// Admin: Update product
router.patch(
  "/admin/:id",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("image"),
  productController.adminUpdateProduct
);

// Admin: Toggle active/inactive
router.patch(
  "/admin/:id/toggle",
  verifyToken,
  allowRoles("ADMIN"),
  productController.adminToggleProduct
);

// Admin: Delete a product
router.delete(
  "/admin/:id",
  verifyToken,
  allowRoles("ADMIN"),
  productController.adminDeleteProduct
);

// CUSTOMER → Nearby products (Simplified for single-vendor)
router.get(
  "/nearby",
  verifyToken,
  allowRoles("CUSTOMER"),
  productController.discoverProducts
);

router.get(
  "/discover",
  verifyToken,
  allowRoles("CUSTOMER"),
  productController.discoverProducts
);

router.get(
  "/:id",
  productController.getProductDetails
);

router.get(
  "/:id/reviews",
  productController.getProductReviews
);
module.exports = router;