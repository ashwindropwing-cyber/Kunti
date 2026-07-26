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
router.get("/settings", ...ADMIN_ONLY, platformController.getAllSettings);
router.patch("/settings/:key", ...ADMIN_ONLY, platformController.updateSetting);
router.post("/settings/bulk", ...ADMIN_ONLY, platformController.bulkUpdateSettings);

// ── Seller Online/Offline Toggle ────────────────────────────────────────────

// ── Rider Document Verification ─────────────────────────────────────────────
router.get("/rider-documents", ...ADMIN_ONLY, cacheFor(30), platformController.getRiderDocuments);
router.get("/rider-documents/:riderId", ...ADMIN_ONLY, platformController.getRiderDocumentsByRiderId);
router.patch("/rider-document/:id/verify", ...ADMIN_ONLY, platformController.verifyRiderDocument);

// ── Payment Reports ──────────────────────────────────────────────────────────
router.get("/reports/payments", ...ADMIN_ONLY, platformController.getPaymentReport);


// ── Generic Upload ───────────────────────────────────────────────────────────
router.post("/upload", verifyToken, uploadLimiter, upload.single("file"), platformController.uploadImage);

module.exports = router;
