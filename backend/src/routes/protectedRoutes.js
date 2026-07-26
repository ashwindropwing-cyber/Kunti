const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/authMiddleware");

router.get("/_profile", verifyToken, (req, res) => {
  res.json({
    message: "Access granted ✅",
    user: req.user,
  });
});

module.exports = router;