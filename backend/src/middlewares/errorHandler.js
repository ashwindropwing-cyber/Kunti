const ApiResponse = require("../utils/ApiResponse");

const errorHandler = (err, req, res, next) => {
    // Log full error details server-side
    console.error("🔥 Server Error Details:", {
        requestId: req.id || "unknown",
        message: err.message,
        name: err.name,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        path: req.path,
        method: req.method
    });

    let statusCode = err.statusCode || 500;
    let message = err.message || "Internal Server Error";

    // Handle Sequelize SQL errors
    if (err.name === "SequelizeUniqueConstraintError") {
      statusCode = 400;
      message = err.errors ? err.errors.map(e => e.message).join(", ") : "Duplicate entry error";
    } else if (err.name === "SequelizeValidationError") {
      statusCode = 400;
      message = err.errors ? err.errors.map(e => e.message).join(", ") : "Validation error";
    } else if (err.name === "SequelizeDatabaseError") {
      statusCode = 500;
      message = "Database operation error";
    }

    try {
        return ApiResponse.error(res, message, statusCode, process.env.NODE_ENV === "development" ? err.stack : null);
    } catch (fallbackError) {
        return res.status(statusCode).json({
            statusCode: statusCode,
            message: message,
            success: false
        });
    }
};

module.exports = errorHandler;
