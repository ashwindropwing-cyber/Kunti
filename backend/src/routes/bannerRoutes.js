
const express = require("express");
const router = express.Router();
const bannerController = require("../controllers/bannerController");
const upload = require("../utils/uploadBanner");           // ← separate multer for banners
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");
const { uploadLimiter } = require("../middlewares/rateLimiter");


// ── CUSTOMER / SELLER — get all active banners ─────────────────
// GET /api/banners
router.get(
  "/",
  verifyToken,
  bannerController.getActiveBanners
);

// ── ADMIN — get ALL banners (active + inactive) ─────────────────
// GET /api/banners/admin/all
router.get(
  "/admin/all",
  verifyToken,
  allowRoles("ADMIN"),
  bannerController.getAllBannersAdmin
);

// ── ADMIN — add a new banner with image ───────────────────────
// POST /api/banners/add   (multipart: field name "banner")
router.post(
  "/add",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("banner"),
  bannerController.addBanner
);

// ── ADMIN — update banner details ────────────────────────────
// PATCH /api/banners/:id
router.patch(
  "/:id",
  verifyToken,
  allowRoles("ADMIN"),
  uploadLimiter,
  upload.single("banner"),
  bannerController.updateBanner
);

// ── ADMIN — toggle active/inactive ────────────────────────────
// PATCH /api/banners/:id/toggle
router.patch(
  "/:id/toggle",
  verifyToken,
  allowRoles("ADMIN"),
  bannerController.toggleBanner
);

// ── ADMIN — delete ─────────────────────────────────────────────
// DELETE /api/banners/:id
router.delete(
  "/:id",
  verifyToken,
  allowRoles("ADMIN"),
  bannerController.deleteBanner
);

module.exports = router;
