const Banner = require("../models/banner");
const redisClient = require("../config/redis");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { optimizeCloudinaryUrl, CLOUDINARY_TRANSFORMATIONS } = require("../utils/cloudinaryUtils");

/**
 * ======================================
 * GET ACTIVE BANNERS — CUSTOMER
 * GET /api/banners
 * Returns all is_active banners ordered by display_order ASC.
 * ======================================
 */
exports.getActiveBanners = asyncHandler(async (req, res) => {
  const cacheKey = "active_banners";

  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return ApiResponse.success(res, JSON.parse(cached), "Banners retrieved from cache");
  }

  const banners = await Banner.findAll({
    where: { is_active: true },
    order: [["display_order", "ASC"], ["createdAt", "ASC"]],
    attributes: ["id", "image_url", "title", "redirect_url", "display_order"],
  });

  const formattedBanners = banners.map(b => {
    const data = b.toJSON ? b.toJSON() : { ...b };
    if (data.image_url) {
      data.image_url = optimizeCloudinaryUrl(data.image_url, CLOUDINARY_TRANSFORMATIONS.BANNER);
    }
    return data;
  });

  await redisClient.set(cacheKey, JSON.stringify(formattedBanners), { EX: 300 });
  return ApiResponse.success(res, formattedBanners);
});

exports.getAllBannersAdmin = asyncHandler(async (req, res) => {
  const banners = await Banner.findAll({
    order: [["display_order", "ASC"], ["createdAt", "DESC"]],
  });
  return ApiResponse.success(res, banners);
});

exports.addBanner = asyncHandler(async (req, res) => {
  const { title, redirect_url, display_order } = req.body;
  if (!req.file) return ApiResponse.error(res, "Banner image is required", 400);

  const banner = await Banner.create({
    image_url: req.file.path,
    title: title || null,
    redirect_url: redirect_url || null,
    display_order: display_order != null ? Number(display_order) : 0,
    is_active: true,
  });

  await redisClient.del("active_banners");
  return ApiResponse.success(res, banner, "Banner added successfully", 201);
});

exports.updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByPk(req.params.id);
  if (!banner) return ApiResponse.error(res, "Banner not found", 404);

  const { title, redirect_url, display_order, is_active } = req.body;

  if (title !== undefined) banner.title = title;
  if (redirect_url !== undefined) banner.redirect_url = redirect_url;
  if (display_order !== undefined) banner.display_order = Number(display_order);
  if (is_active !== undefined) banner.is_active = is_active;
  if (req.file) banner.image_url = req.file.path;

  await banner.save();
  await redisClient.del("active_banners");

  return ApiResponse.success(res, banner, "Banner updated");
});

exports.toggleBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByPk(req.params.id);
  if (!banner) return ApiResponse.error(res, "Banner not found", 404);

  banner.is_active = !banner.is_active;
  await banner.save();
  await redisClient.del("active_banners");

  return ApiResponse.success(res, banner, `Banner ${banner.is_active ? "activated" : "deactivated"}`);
});

exports.deleteBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByPk(req.params.id);
  if (!banner) return ApiResponse.error(res, "Banner not found", 404);

  await banner.destroy();
  await redisClient.del("active_banners");

  return ApiResponse.success(res, null, "Banner deleted");
});