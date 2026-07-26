const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isImage = file.mimetype && file.mimetype.startsWith("image/");
    return {
      folder: "tind_rider_documents",
      allowed_formats: ["jpg", "png", "jpeg", "webp", "pdf"],
      resource_type: "auto",
      transformation: isImage ? [{ width: 1600, height: 1600, crop: "limit", quality: "auto", fetch_format: "auto" }] : undefined
    };
  }
});

const documentUpload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (PDFs can be larger)
});

module.exports = documentUpload;
