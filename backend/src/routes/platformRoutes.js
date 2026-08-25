const express = require("express");
const router = express.Router();
const platformController = require("../controllers/platformController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");
const upload = require("../utils/upload");
const { cacheFor, noCache } = require("../middlewares/responseCache");
const { uploadLimiter } = require("../middlewares/rateLimiter");

const ADMIN_ONLY = [verifyToken, allowRoles("ADMIN")];

// ── Platform Settings ──────────────────────────────────────────────────────
router.get("/settings/public", noCache, platformController.getPublicSettings);
router.get("/public-settings", noCache, platformController.getPublicSettings);
router.get("/settings", ...ADMIN_ONLY, platformController.getAllSettings);
router.patch("/settings/:key", ...ADMIN_ONLY, platformController.updateSetting);
router.post("/settings/bulk", ...ADMIN_ONLY, platformController.bulkUpdateSettings);


// ── Seller Online/Offline Toggle ────────────────────────────────────────────

// ── Payment Reports ──────────────────────────────────────────────────────────
router.get("/reports/payments", ...ADMIN_ONLY, platformController.getPaymentReport);


// ── Generic Upload ───────────────────────────────────────────────────────────
router.post("/upload", verifyToken, uploadLimiter, upload.any(), platformController.uploadImage);

module.exports = router;
