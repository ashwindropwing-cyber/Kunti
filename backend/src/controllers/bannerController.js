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
  });

  const formattedBanners = banners.map(b => {
    const data = b.toJSON ? b.toJSON() : { ...b };
    if (data.image_url) {
      data.image_url = optimizeCloudinaryUrl(data.image_url, CLOUDINARY_TRANSFORMATIONS.BANNER);
    }
    data.priority = data.display_order;
    return data;
  });

  await redisClient.set(cacheKey, JSON.stringify(formattedBanners), { EX: 300 });
  return ApiResponse.success(res, formattedBanners);
});

exports.getAllBannersAdmin = asyncHandler(async (req, res) => {
  const banners = await Banner.findAll({
    order: [["display_order", "ASC"], ["createdAt", "DESC"]],
  });

  const formattedBanners = banners.map(b => {
    const data = b.toJSON ? b.toJSON() : { ...b };
    data.priority = data.display_order;
    return data;
  });

  return ApiResponse.success(res, formattedBanners);
});

exports.addBanner = asyncHandler(async (req, res) => {
  const { title, subtitle, target_category, redirect_url, display_order, priority } = req.body;
  if (!req.file) return ApiResponse.error(res, "Banner image is required", 400);

  const orderVal = priority !== undefined ? Number(priority) : (display_order !== undefined ? Number(display_order) : 0);

  const banner = await Banner.create({
    image_url: req.file.path,
    title: title || null,
    subtitle: subtitle || null,
    target_category: target_category || null,
    redirect_url: redirect_url || null,
    display_order: orderVal,
    is_active: true,
  });

  await redisClient.del("active_banners");
  return ApiResponse.success(res, banner, "Banner added successfully", 201);
});

exports.updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByPk(req.params.id);
  if (!banner) return ApiResponse.error(res, "Banner not found", 404);

  const { title, subtitle, target_category, redirect_url, display_order, priority, is_active } = req.body;

  if (title !== undefined) banner.title = title;
  if (subtitle !== undefined) banner.subtitle = subtitle;
  if (target_category !== undefined) banner.target_category = target_category;
  if (redirect_url !== undefined) banner.redirect_url = redirect_url;
  if (priority !== undefined) banner.display_order = Number(priority);
  else if (display_order !== undefined) banner.display_order = Number(display_order);

  if (is_active !== undefined) banner.is_active = is_active === true || is_active === "true";
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