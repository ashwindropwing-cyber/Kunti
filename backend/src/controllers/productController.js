const Product = require("../models/product");
const Category = require("../models/category");
const Review = require("../models/review");
const User = require("../models/user");
const { optimizeCloudinaryUrl, CLOUDINARY_TRANSFORMATIONS } = require("../utils/cloudinaryUtils");
const redisClient = require("../config/redis");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");

const Op = {
  gte: "gte",
  lte: "lte",
  gt: "gt",
  lt: "lt",
  in: "in",
  iLike: "iLike"
};

async function clearProductCaches(productId) {
  const keysToDelete = ["all_products"];
  if (productId) keysToDelete.push(`product_${productId}`);

  for await (const scanned of redisClient.scanIterator({ MATCH: "nearby_*" })) {
    const keys = Array.isArray(scanned) ? scanned : [scanned];
    for (const key of keys) {
      if (typeof key === "string" && key.length > 0) {
        keysToDelete.push(key);
      }
    }
  }

  for (const key of keysToDelete) {
    if (typeof key === "string" && key.length > 0) {
      try {
        await redisClient.del(key);
      } catch (error) {
        console.error("Redis DEL error:", error.message);
      }
    }
  }
}

/**
 * GET ALL PRODUCTS (ADMIN & PUBLIC)
 */
exports.getAdminAllProducts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 100, search, category_id } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let whereCondition = {};
  if (search) {
    whereCondition.name = { [Op.iLike]: `%${search}%` };
  }
  if (category_id) {
    whereCondition.category_id = category_id;
  }
  const { count, rows } = await Product.findAndCountAll({
    where: whereCondition,
    include: [
      { model: Category, attributes: ["id", "name"] }
    ],
    order: [["createdAt", "DESC"]],
    limit: parseInt(limit),
    offset
  });

  const categoryIds = [...new Set(rows.map(p => p.category_id))];
  let categories = [];
  if (categoryIds.length > 0) {
    categories = await Category.findAll({ where: { id: { in: categoryIds } } });
  }

  const categoryMap = categories.reduce((acc, cat) => {
    acc[cat.id] = cat;
    return acc;
  }, {});

  const formatted = rows.map((p) => {
    const discount = p.mrp > p.selling_price ? Math.round(((p.mrp - p.selling_price) / p.mrp) * 100) : 0;
    const cat = categoryMap[p.category_id];

    return {
      product_id: p.id,
      name: p.name,
      description: p.description,
      category_id: p.category_id,
      Category: cat ? { id: cat.id, name: cat.name } : null,
      category_name: cat ? cat.name : "",
      mrp: p.mrp,
      selling_price: p.selling_price,
      discount_percent: discount,
      quantity: p.quantity,
      image_url: p.image_url,
      is_active: p.is_active,
      rating: p.rating,
      rating_count: p.rating_count
    };
  });
  return ApiResponse.success(res, { total: count, products: formatted });
});

/**
 * ADMIN → CREATE PRODUCT
 */
exports.adminCreateProduct = async (req, res) => {
  try {
    const { name, description, mrp, selling_price, quantity, category_id, rating } = req.body;

    if (!name || !mrp || !selling_price || !category_id) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const product = await Product.create({
      category_id,
      name,
      description,
      mrp,
      selling_price,
      quantity: quantity || 0,
      image_url: req.file ? req.file.path : null,
      is_active: true,
      rating: rating || 0,
    });

    await clearProductCaches(product.id);
    return res.status(201).json({ message: "Product created", product });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * ADMIN → UPDATE PRODUCT
 */
exports.adminUpdateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const { name, description, mrp, selling_price, quantity, category_id, is_active, rating } = req.body;

    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (mrp !== undefined) product.mrp = mrp;
    if (selling_price !== undefined) product.selling_price = selling_price;
    if (quantity !== undefined) product.quantity = quantity;
    if (category_id !== undefined) product.category_id = category_id;
    if (is_active !== undefined) product.is_active = is_active;
    if (rating !== undefined) product.rating = rating;
    if (req.file) product.image_url = req.file.path;

    await product.save();
    await clearProductCaches(id);

    return res.json({ message: "Product updated", product });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.adminToggleProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    product.is_active = !product.is_active;
    await product.save();
    await clearProductCaches(id);

    return res.json({
      message: `Product ${product.is_active ? "listed" : "hidden"}`,
      product_id: product.id,
      is_active: product.is_active,
    });
  } catch (error) {
    console.error("adminToggleProduct error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.adminDeleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    await product.destroy();
    await clearProductCaches(id);

    return res.json({ message: "Product deleted", product_id: id });
  } catch (error) {
    console.error("adminDeleteProduct error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * CUSTOMER → GET PRODUCTS (Replacement for discoverProducts and getNearbyProducts)
 */
exports.discoverProducts = async (req, res) => {
  return exports.getAdminAllProducts(req, res); // Simplified to return all products for Dominos style
};

/**
 * GET PRODUCT DETAILS
 */
exports.getProductDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `product_${id}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const product = await Product.findByPk(id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await redisClient.set(cacheKey, JSON.stringify(product), { EX: 120 });
    return res.json(product);

  } catch (error) {
    console.error("Get product details error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET PRODUCT REVIEWS
 */
exports.getProductReviews = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const reviews = await Review.findAll({
    where: { product_id: id, review_type: "PRODUCT" },
    order: [["createdAt", "DESC"]]
  });

  const userIds = [...new Set(reviews.map(r => r.user_id))];
  let users = [];
  if (userIds.length > 0) {
    users = await User.findAll({
      where: { id: { in: userIds } }
    });
  }
  const userMap = users.reduce((acc, u) => {
    acc[u.id] = u.name;
    return acc;
  }, {});

  const populatedReviews = reviews.map((rev) => {
    const revObj = typeof rev.toJSON === 'function' ? rev.toJSON() : { ...rev };
    
    if (revObj.createdAt && typeof revObj.createdAt.toDate === 'function') {
      revObj.createdAt = revObj.createdAt.toDate().toISOString();
    } else if (revObj.createdAt && revObj.createdAt._seconds) {
      revObj.createdAt = new Date(revObj.createdAt._seconds * 1000).toISOString();
    }
    
    if (revObj.updatedAt && typeof revObj.updatedAt.toDate === 'function') {
      revObj.updatedAt = revObj.updatedAt.toDate().toISOString();
    } else if (revObj.updatedAt && revObj.updatedAt._seconds) {
      revObj.updatedAt = new Date(revObj.updatedAt._seconds * 1000).toISOString();
    }

    revObj.user_name = userMap[rev.user_id] || "";
    return revObj;
  });

  return ApiResponse.success(res, populatedReviews);
});
