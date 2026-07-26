const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");

// USER PAYMENT ROUTES
router.post("/create", verifyToken, allowRoles("CUSTOMER"), paymentController.createPaymentOrder);
router.post("/verify", verifyToken, allowRoles("CUSTOMER"), paymentController.verifyPayment);
router.post("/retry", verifyToken, allowRoles("CUSTOMER"), paymentController.retryPayment);

module.exports = router;
