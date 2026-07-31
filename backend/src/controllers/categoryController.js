const Category = require("../models/category");
const redisClient = require("../config/redis");
const { optimizeCloudinaryUrl, CLOUDINARY_TRANSFORMATIONS } = require("../utils/cloudinaryUtils");

// ======================================
// ADD CATEGORY
// ======================================
exports.addCategory = async (req, res) => {
  try {
    const { name, description, display_order, is_active } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Category name required" });
    }

    const imagePath = req.file ? req.file.path : null;

    const category = await Category.create({
      name,
      description: description || null,
      display_order: display_order !== undefined ? parseInt(display_order) : 0,
      is_active: is_active !== undefined ? (is_active === true || is_active === "true") : true,
      image_url: imagePath
    });

    // clear cache when category changes
    await redisClient.del("categories");
    await redisClient.del("categories_all");

    res.status(201).json(category);

  } catch (error) {
    console.error("Add category error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ======================================
// GET CATEGORIES (WITH REDIS CACHE)
// ======================================
exports.getCategories = async (req, res) => {
  try {
    const showAll = req.query.all === "true";
    const cacheKey = showAll ? "categories_all" : "categories";

    // check Redis cache
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("⚡ Categories from Redis cache");
      return res.json(JSON.parse(cached));
    }

    const whereCondition = showAll ? {} : { is_active: true };

    // fetch from database
    const categories = await Category.findAll({
      where: whereCondition,
      order: [["display_order", "ASC"], ["createdAt", "DESC"]],
    });

    const formattedCategories = categories.map(cat => {
      const data = cat.toJSON ? cat.toJSON() : { ...cat };
      if (data.image_url) {
        data.image_url = optimizeCloudinaryUrl(data.image_url, CLOUDINARY_TRANSFORMATIONS.CATEGORY);
      }
      data.banner_image = data.image_url; // Backward compatibility alias
      return data;
    });

    // save in Redis cache for 5 minutes
    await redisClient.setEx(
      cacheKey,
      300,
      JSON.stringify(formattedCategories)
    );

    console.log("📦 Categories from DB");

    res.json(formattedCategories);

  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ======================================
// UPDATE CATEGORY
// ======================================
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, display_order, is_active } = req.body;

    const category = await Category.findByPk(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (name !== undefined) category.name = name;
    if (description !== undefined) category.description = description;
    if (display_order !== undefined) category.display_order = parseInt(display_order);

    // Parse is_active from FormData string to boolean
    if (is_active !== undefined && is_active !== null) {
      if (typeof is_active === "string") {
        category.is_active = is_active === "true";
      } else {
        category.is_active = Boolean(is_active);
      }
    }
    if (req.file) category.image_url = req.file.path;

    await category.save();
    // Clear both cache keys
    await redisClient.del("categories");
    await redisClient.del("categories_all");

    return res.status(200).json({
      message: "Category updated successfully",
      category
    });
  } catch (error) {
    console.error("Update category error:", error);
    return res.status(500).json({ message: error.message });
  }
};

// ======================================
// DELETE CATEGORY
// ======================================
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findByPk(id);

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    await category.destroy();
    await redisClient.del("categories");
    await redisClient.del("categories_all");

    return res.json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Delete category error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ======================================
// GET CATEGORY ID BY NAME
// ======================================
exports.getCategoryIdByName = async (req, res) => {
  try {

    const { name } = req.params;

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const category = await Category.findOne({
      where: {
        name,
        is_active: true
      }
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    return res.status(200).json({
      id: category.id,
      name: category.name
    });

  } catch (error) {
    console.error("Get category by name error:", error);
    res.status(500).json({ message: "Server error" });
  }
};