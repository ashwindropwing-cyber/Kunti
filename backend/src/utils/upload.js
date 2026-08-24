const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "tind_products",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [
      {
        width: 800,
        height: 800,
        crop: "fill",
        gravity: "auto",
        quality: "auto",
        fetch_format: "auto",
        aspect_ratio: "1:1"
      }
    ]
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;