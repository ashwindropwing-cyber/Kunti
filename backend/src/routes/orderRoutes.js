const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const paymentController = require("../controllers/paymentController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");
const { pollingLimiter } = require("../middlewares/rateLimiter");
const { cacheFor } = require("../middlewares/responseCache");

/**
 * CUSTOMER ROUTES
 */
// Create / Place Order
router.post(
  "/create",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.createOrder
);
router.post(
  "/place",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.createOrder
);

// Get Customer Orders
router.get(
  "/my",
  verifyToken,
  allowRoles("CUSTOMER"),
  orderController.getUserOrders
);

// Cancel Order
router.patch(
  "/cancel/:id",
  verifyToken,
  allowRoles("CUSTOMER", "ADMIN"),
  orderController.cancelOrder
);

// Verify Payment
router.post(
  "/verify-payment",
  verifyToken,
  allowRoles("CUSTOMER"),
  paymentController.verifyPayment
);

// Get Order Tracking (Status)
router.get(
  "/tracking/:id",
  verifyToken,
  allowRoles("CUSTOMER", "RIDER", "ADMIN"),
  pollingLimiter,
  cacheFor(10),
  orderController.getOrderTracking
);

/**
 * ADMIN ROUTES — declared BEFORE /:id wildcard to prevent route shadowing
 */
// Get All Orders
router.get(
  "/admin/all",
  verifyToken,
  allowRoles("ADMIN"),
  orderController.getAllOrders
);

// Update Single Order Status
router.patch(
  "/admin/:id/status",
  verifyToken,
  allowRoles("ADMIN"),
  orderController.updateOrderStatus
);

// Assign Rider to Single Order
router.patch(
  "/admin/assign/:id",
  verifyToken,
  allowRoles("ADMIN"),
  orderController.assignRider
);

// Bulk Assign Multiple Orders to One Delivery Guy
router.patch(
  "/admin/bulk-assign",
  verifyToken,
  allowRoles("ADMIN"),
  orderController.bulkAssignRider
);

/**
 * RIDER ROUTES — declared BEFORE /:id wildcard to prevent route shadowing
 */
// Get Rider Assigned Orders (supports multiple active / bulk assigned orders)
router.get(
  "/rider/my",
  verifyToken,
  allowRoles("RIDER"),
  orderController.getRiderOrders
);

// Rider updates status of a single assigned order (ASSIGNED → PREPARING → OUT_FOR_DELIVERY → DELIVERED)
router.patch(
  "/rider/:id/status",
  verifyToken,
  allowRoles("RIDER"),
  orderController.riderUpdateOrderStatus
);

// Rider verifies delivery OTP with customer
router.post(
  "/rider/verify-otp/:id",
  verifyToken,
  allowRoles("RIDER"),
  orderController.verifyDeliveryOTP
);

// Bulk Update Rider Orders Status (e.g., deliver multiple orders at once)
router.patch(
  "/rider/bulk-status",
  verifyToken,
  allowRoles("RIDER", "ADMIN"),
  orderController.bulkUpdateRiderOrders
);

/**
 * GENERIC WILDCARD — MUST be declared last
 */
// Get Single Order Details
router.get(
  "/:id",
  verifyToken,
  allowRoles("CUSTOMER", "ADMIN", "RIDER"),
  orderController.getOrderById
);

module.exports = router;
