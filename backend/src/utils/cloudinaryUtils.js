function optimizeCloudinaryUrl(url, transformationStr) {
  if (!url || typeof url !== "string") return url;
  
  // Only process if it's a Cloudinary URL
  if (!url.includes("res.cloudinary.com")) return url;
  
  const uploadSegment = "image/upload/";
  const index = url.indexOf(uploadSegment);
  if (index === -1) return url;
  
  const before = url.substring(0, index + uploadSegment.length);
  const after = url.substring(index + uploadSegment.length);
  
  // Return the transformed Cloudinary URL
  return `${before}${transformationStr}/${after}`;
}

const CLOUDINARY_TRANSFORMATIONS = {
  CATEGORY: "w_200,h_200,c_fill,g_auto,f_auto,q_75",
  PRODUCT: "w_600,f_auto,q_75",
  BANNER: "w_1200,h_600,c_fill,g_auto,f_auto,q_75",
  POD: "w_500,q_50,f_auto"
};

module.exports = {
  optimizeCloudinaryUrl,
  CLOUDINARY_TRANSFORMATIONS
};
