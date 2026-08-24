const Product = require("../models/product");
const Category = require("../models/category");
const Review = require("../models/review");
const User = require("../models/user");
const { optimizeCloudinaryUrl, CLOUDINARY_TRANSFORMATIONS } = require("../utils/cloudinaryUtils");
const redisClient = require("../config/redis");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");

const { Op } = require("sequelize");

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
    whereCondition.name = { [Op.like]: `%${search}%` };
  }
  if (category_id) {
    whereCondition.category_id = category_id;
  }
  const { count, rows } = await Product.findAndCountAll({
    where: whereCondition,
    include: [
      { model: Category, as: "category", attributes: ["id", "name"] }
    ],
    order: [["createdAt", "DESC"]],
    limit: parseInt(limit),
    offset
  });

  const categoryIds = [...new Set(rows.map(p => p.category_id).filter(Boolean))];
  let categories = [];
  if (categoryIds.length > 0) {
    categories = await Category.findAll({ where: { id: categoryIds } });
  }

  const categoryMap = categories.reduce((acc, cat) => {
    acc[cat.id] = cat;
    return acc;
  }, {});

  const formatted = rows.map((p) => {
    const originalPrice = p.price;
    const discPrice = p.discount_price || p.price;
    const discount = originalPrice > discPrice ? Math.round(((originalPrice - discPrice) / originalPrice) * 100) : 0;
    const cat = categoryMap[p.category_id];

    return {
      id: p.id,
      product_id: p.id,
      name: p.name,
      description: p.description,
      category_id: p.category_id,
      Category: cat ? { id: cat.id, name: cat.name } : null,
      category_name: cat ? cat.name : "",
      price: p.price,
      discount_price: p.discount_price,
      mrp: p.price,
      selling_price: discPrice,
      discount_percent: discount,
      stock_quantity: p.stock_quantity,
      quantity: p.stock_quantity,
      image_url: p.image_url,
      is_veg: p.is_veg,
      food_type: p.food_type || (p.is_veg ? "veg" : "nonVeg"),
      is_bestseller: p.is_bestseller || false,
      is_available: p.is_available,
      is_active: p.is_available,
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
    const {
      name, description, category_id,
      price, mrp,
      discount_price, selling_price,
      stock_quantity, quantity,
      is_available, is_active,
      is_veg, food_type, is_bestseller, rating
    } = req.body;

    const finalPrice = parseFloat(price !== undefined ? price : mrp);
    const finalDiscountPrice = (discount_price !== undefined || selling_price !== undefined) 
      ? parseFloat(discount_price !== undefined ? discount_price : selling_price) 
      : null;
    let finalCategory = category_id;
    if (!finalCategory && (req.body.category_name || req.body.category)) {
      const cat = await Category.findOne({
        where: { name: req.body.category_name || req.body.category }
      });
      if (cat) finalCategory = cat.id;
    }
    if (!finalCategory) {
      const firstCat = await Category.findOne({ order: [["display_order", "ASC"]] });
      if (firstCat) finalCategory = firstCat.id;
    }

    if (!name || isNaN(finalPrice) || !finalCategory) {
      return res.status(400).json({ message: "Missing required fields (name, price, category_id)" });
    }

    const isVegVal = is_veg !== undefined 
      ? (is_veg === true || is_veg === "true") 
      : (food_type ? food_type === "veg" : true);

    const product = await Product.create({
      category_id: finalCategory,
      name,
      description: description || "",
      price: finalPrice,
      discount_price: finalDiscountPrice,
      stock_quantity: stock_quantity !== undefined ? parseInt(stock_quantity) : (quantity !== undefined ? parseInt(quantity) : 100),
      image_url: req.file ? req.file.path : (req.body.image_url || req.body.imageUrl || req.body.image || null),
      is_veg: isVegVal,
      food_type: food_type || (isVegVal ? "veg" : "nonVeg"),
      is_bestseller: is_bestseller === true || is_bestseller === "true",
      is_available: is_available !== undefined ? (is_available === true || is_available === "true") : (is_active !== undefined ? (is_active === true || is_active === "true") : true),
      rating: rating ? parseFloat(rating) : 0,
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

    const {
      name, description, category_id,
      price, mrp,
      discount_price, selling_price,
      stock_quantity, quantity,
      is_available, is_active,
      is_veg, food_type, is_bestseller, rating
    } = req.body;

    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (category_id !== undefined) {
      product.category_id = category_id;
    } else if (req.body.category_name || req.body.category) {
      const cat = await Category.findOne({
        where: { name: req.body.category_name || req.body.category }
      });
      if (cat) product.category_id = cat.id;
    }
    if (price !== undefined) product.price = parseFloat(price);
    else if (mrp !== undefined) product.price = parseFloat(mrp);

    if (discount_price !== undefined) product.discount_price = parseFloat(discount_price);
    else if (selling_price !== undefined) product.discount_price = parseFloat(selling_price);

    if (stock_quantity !== undefined) product.stock_quantity = parseInt(stock_quantity);
    else if (quantity !== undefined) product.stock_quantity = parseInt(quantity);

    if (is_available !== undefined) product.is_available = is_available === true || is_available === "true";
    else if (is_active !== undefined) product.is_available = is_active === true || is_active === "true";

    if (food_type !== undefined) {
      product.food_type = food_type;
      product.is_veg = food_type === "veg";
    } else if (is_veg !== undefined) {
      product.is_veg = is_veg === true || is_veg === "true";
      product.food_type = product.is_veg ? "veg" : "nonVeg";
    }

    if (req.file) {
      product.image_url = req.file.path;
    } else if (req.body.image_url !== undefined || req.body.imageUrl !== undefined) {
      product.image_url = req.body.image_url || req.body.imageUrl;
    }

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
    where: { product_id: id, review_type: "PRODUCT", is_hidden: false },
    order: [["createdAt", "DESC"]]
  });

  const userIds = [...new Set(reviews.map(r => r.user_id))];
  let users = [];
  if (userIds.length > 0) {
    users = await User.findAll({
      where: { id: userIds }
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
