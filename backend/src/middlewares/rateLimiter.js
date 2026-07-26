const rateLimit = require("express-rate-limit");

// ─── Global limiter — applies to all routes ───
exports.globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many requests. Please try again later.",
  },
});

// ─── Auth limiter — login, register, OTP ───
exports.authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many authentication attempts. Please wait 10 minutes.",
  },
});

// ─── OTP limiter — very strict ───
exports.otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: {
    message: "Too many OTP requests. Try again later.",
  },
});

// ─── Heavy read limiter — admin list endpoints that do full-collection scans ───
// These are the most expensive endpoints (getAllRiders, getAllSellers, etc.)
exports.heavyReadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 15,                   // 15 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many data requests. Please wait a moment.",
  },
});

// ─── Polling limiter — for endpoints hit by timers/intervals ───
// Notification checks, order status, tracking — capped to prevent thundering herd
exports.pollingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 30,                   // 30 per minute = 1 every 2 seconds max
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Polling too frequently. Please slow down.",
  },
});

// ─── Write limiter — place order, cancel, update status ───
exports.writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many write operations. Please wait.",
  },
});

// ─── Upload limiter — file uploads ───
exports.uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many uploads. Please wait before uploading more.",
  },
});