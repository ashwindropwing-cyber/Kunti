const express = require("express");
const router = express.Router();
const refundController = require("../controllers/refundController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");
const { heavyReadLimiter } = require("../middlewares/rateLimiter");
const { cacheFor } = require("../middlewares/responseCache");

// Customer: Request refund
router.post(
    "/request",
    verifyToken,
    allowRoles("CUSTOMER"),
    refundController.requestRefund
);

// Admin: Get all refund requests
router.get(
    "/admin/all",
    verifyToken,
    allowRoles("ADMIN"),
    heavyReadLimiter,
    cacheFor(30),
    refundController.getAllRefunds
);

// Admin: Update refund status (approve/reject)
router.patch(
    "/admin/:id/status",
    verifyToken,
    allowRoles("ADMIN"),
    refundController.updateRefundStatus
);

// Customer: Get refund status for an order
router.get(
    "/order/:orderId",
    verifyToken,
    allowRoles("CUSTOMER"),
    refundController.getRefundByOrder
);

module.exports = router;
