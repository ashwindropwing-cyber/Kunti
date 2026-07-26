const jwt = require("jsonwebtoken");
const ApiResponse = require("../utils/ApiResponse");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET not defined");
}

// ===============================
// VERIFY JWT TOKEN
// ===============================
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return ApiResponse.error(res, "No token provided", 401);
  }

  const tokenParts = authHeader.split(" ");

  if (tokenParts.length !== 2 || tokenParts[0] !== "Bearer") {
    return ApiResponse.error(res, "Invalid token format", 401);
  }

  const token = tokenParts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Normalize payload
    req.user = {
      id: decoded.id || decoded.userId,
      role: decoded.role,
    };

    if (!req.user.id || !req.user.role) {
      return ApiResponse.error(res, "Invalid token payload", 401);
    }

    // JWT OK - user attached to request

    next();
  } catch (error) {
    console.error("❌ JWT verification failed:", error.message);
    return ApiResponse.error(res, "Invalid or expired token", 401);
  }
};

// ===============================
// ROLE-BASED ACCESS CONTROL
// ===============================
exports.allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return ApiResponse.error(
        res,
        "Access denied: insufficient permissions",
        403
      );
    }
    next();
  };
};