const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authLimiter, otpLimiter } = require("../middlewares/rateLimiter");

// 🔐 Generic OTP
router.post("/send-otp", otpLimiter, authController.sendOTP);
router.post("/verify-otp", authLimiter, authController.verifyOTP);

// 🔐 Registration OTP
router.post("/send-register-otp", otpLimiter, authController.sendRegisterOTP);
router.post("/verify-register-otp", authLimiter, authController.verifyRegisterOTP);

// 🔐 Login
router.post("/login", authLimiter, authController.login);
router.post("/admin/login", authLimiter, authController.adminLogin);

// 🚴 Rider OTP
router.post("/rider/send-otp", otpLimiter, authController.sendRiderOTP);
router.post("/rider/verify-otp", authLimiter, authController.verifyRiderOTP);

// 🔑 Password Reset
router.post("/forgot-password", otpLimiter, authController.forgotPassword);
router.post("/reset-password", authLimiter, authController.resetPassword);

// 🔔 FCM Push Token Update (Unified for all logged-in roles)
const { verifyToken } = require("../middlewares/authMiddleware");
router.post("/fcm-token", verifyToken, authController.updateFcmToken);
router.patch("/fcm-token", verifyToken, authController.updateFcmToken);

module.exports = router;