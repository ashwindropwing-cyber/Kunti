const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "tind_banners",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],

    transformation: [
      {
        width: 1200,
        height: 500,
        crop: "fill",      // ensures exact size matching customer app carousel
        gravity: "auto",   // smart subject detection
        quality: "auto",
        fetch_format: "auto",
        aspect_ratio: "2.4:1"
      }
    ]
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = upload;