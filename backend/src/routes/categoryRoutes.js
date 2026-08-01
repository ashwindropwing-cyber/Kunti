const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const upload = require("../utils/uploadcategory");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");
const { uploadLimiter } = require("../middlewares/rateLimiter");

router.post(
  "/",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("banner"),
  categoryController.addCategory
);
router.post(
  "/add",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("banner"),
  categoryController.addCategory
);
router.patch(
  "/:id",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("banner"),
  categoryController.updateCategory
);
router.delete(
  "/:id",
  verifyToken,
  allowRoles("ADMIN"),
  categoryController.deleteCategory
);
router.get(
  "/",
  categoryController.getCategories
);
router.get(
  "/name/:name",
  categoryController.getCategoryIdByName
);
module.exports = router;