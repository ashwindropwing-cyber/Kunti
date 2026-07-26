const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "tind_categories",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [
      {
        width: 800,
        height: 800,
        crop: "fill",
        gravity: "center",
        quality: "auto",
        fetch_format: "auto",
        radius: 50,
        aspect_ratio:"1:1"
      }
    ]
  })
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = upload;