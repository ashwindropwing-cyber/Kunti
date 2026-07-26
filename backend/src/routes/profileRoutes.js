const express = require("express");
const router = express.Router();
const profileController = require("../controllers/profileController");
const { verifyToken } = require("../middlewares/authMiddleware");

const upload = require("../utils/upload");
const { uploadLimiter } = require("../middlewares/rateLimiter");

router.get("/", verifyToken, profileController.getProfile);
router.patch("/", verifyToken, uploadLimiter, upload.single("profile_picture"), profileController.updateProfile);

module.exports = router;