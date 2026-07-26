const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const paymentController = require("../controllers/paymentController"); // ✅ ADD THIS
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");
const upload = require("../utils/uploadPod");
const { pollingLimiter, heavyReadLimiter, uploadLimiter } = require("../middlewares/rateLimiter");
const { cacheFor } = require("../middlewares/responseCache");

/**
 * =========================
 * CUSTOMER ROUTES
 * =========================
 */

// Place Master Order (from cart)
router.post(
  "/place",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.placeOrder
);

// Get my orders
router.get(
  "/my",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.getMyOrders
);

// Cancel order
router.patch(
  "/cancel/:id",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.cancelOrder
);

// ✅ ADD THIS: Verify Razorpay payment
router.post(
  "/verify-payment",
  verifyToken,
  allowRoles("CUSTOMER"),
  paymentController.verifyPayment
);

// Submit Review for a delivered order
router.post(
  "/:id/review",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.addOrderReview
);

// Customer → Get live rider tracking for an order
router.get(
  "/tracking/:id",
  verifyToken,
  allowRoles("CUSTOMER"),
  pollingLimiter,
  cacheFor(10),
  orderController.getOrderTracking
);

// Customer → Submit Refund Request
router.post(
  "/refund/submit",
  verifyToken,
  allowRoles("CUSTOMER"),
  require("../controllers/refundController").requestRefund
);

/**
 * =========================
 * ADMIN ROUTES
 * =========================
 */


// Admin → Get all refund requests
router.get(
  "/admin/refunds/all",
  verifyToken,
  allowRoles("ADMIN"),
  require("../controllers/refundController").getAllRefunds
);

// Admin: update order status directly
router.patch(
  "/admin/:id/status",
  verifyToken,
  allowRoles("ADMIN"),
);

// Assign rider to master order
router.patch(
  "/assign/:id",
  verifyToken,
  allowRoles("ADMIN"),
  orderController.assignRider
);

/**
 * =========================
 * RIDER ROUTES
 * =========================
 */

router.patch(
  "/pick-up/:id",
  verifyToken,
  allowRoles("RIDER"),
  orderController.pickUpOrder
);

router.patch(
  "/start-delivery/:id",
  verifyToken,
  allowRoles("RIDER"),
  orderController.startDelivery
);



// Rider delivers order (POD required)
router.patch(
  "/deliver/:id",
  verifyToken,
  allowRoles("RIDER"),
  uploadLimiter,
  upload.fields([
    { name: "pod", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  orderController.deliverOrder
);



router.get(
  "/rider/my",
  verifyToken,
  allowRoles("RIDER"),
  orderController.getRiderOrders
);

router.get(
  "/rider/:id",
  verifyToken,
  allowRoles("RIDER"),
  orderController.getRiderOrderDetails
);

// Get single order details
router.get(
  "/:id",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.getOrderDetails
);
module.exports = router;
