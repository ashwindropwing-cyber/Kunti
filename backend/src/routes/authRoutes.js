const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authLimiter, otpLimiter } = require("../middlewares/rateLimiter");

// 🔐 Registration OTP
router.post("/send-register-otp", otpLimiter, authController.sendRegisterOTP);
router.post("/verify-register-otp", authLimiter, authController.verifyRegisterOTP);

// 🔐 Login
router.post("/login", authLimiter, authController.login);

// 🚴 Rider OTP
router.post("/rider/send-otp", otpLimiter, authController.sendRiderOTP);
router.post("/rider/verify-otp", authLimiter, authController.verifyRiderOTP);

// 🏪 Seller OTP (Login)

// 🔑 Password Reset
router.post("/forgot-password", otpLimiter, authController.forgotPassword);
router.post("/reset-password", authLimiter, authController.resetPassword);

module.exports = router;