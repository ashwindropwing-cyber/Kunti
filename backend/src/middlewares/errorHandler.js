const ApiResponse = require("../utils/ApiResponse");

// Map Firestore/Firebase error codes to user-friendly messages
const FIRESTORE_ERROR_MAP = {
  5: "Resource not found",
  7: "Permission denied",
  9: "Query requires an index",
  14: "Service temporarily unavailable",
  16: "Authentication failed",
};

const errorHandler = (err, req, res, next) => {
    // Log full error details server-side (never sent to client)
    console.error("🔥 Server Error Details:", {
        requestId: req.id || "unknown",
        message: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        path: req.path,
        method: req.method
    });

    let statusCode = err.statusCode || 500;
    let message = err.message || "Internal Server Error";

    // Map Firestore error codes to user-friendly messages
    if (err.code && FIRESTORE_ERROR_MAP[err.code]) {
        message = FIRESTORE_ERROR_MAP[err.code];
        if (err.code === 5) statusCode = 404;
        else if (err.code === 7 || err.code === 16) statusCode = 403;
        else if (err.code === 14) statusCode = 503;
    }

    // Sanitize: strip internal paths and collection names in production
    if (process.env.NODE_ENV === "production") {
        // Remove file paths like /app/src/... or C:\Users\...
        message = message.replace(/(?:[A-Z]:\\|\/)[^\s:]+/gi, "[path]");
        // Remove Firestore collection references
        message = message.replace(/projects\/[^\s]+/g, "[resource]");
    }

    // ✅ Ensure we always return the ApiResponse format even on crash
    try {
        return ApiResponse.error(res, message, statusCode, process.env.NODE_ENV === "development" ? err.stack : null);
    } catch (fallbackError) {
        // 🚨 Extreme fallback if ApiResponse itself fails
        return res.status(statusCode).json({
            statusCode: statusCode,
            message: message,
            success: false
        });
    }
};

module.exports = errorHandler;
