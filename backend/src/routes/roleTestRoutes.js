const express = require("express");
const router = express.Router();
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");

// Admin only
router.get(
  "/admin",
  verifyToken,
  allowRoles("ADMIN"),
  (req, res) => {
    res.json({ message: "Welcome Admin 👑" });
  }
);


// Rider only
router.get(
  "/rider",
  verifyToken,
  allowRoles("RIDER"),
  (req, res) => {
    res.json({ message: "Welcome Rider 🛵" });
  }
);

// Any logged-in user
router.get(
  "/user",
  verifyToken,
  (req, res) => {
    res.json({ message: "Welcome User 🙌" });
  }
);

module.exports = router;