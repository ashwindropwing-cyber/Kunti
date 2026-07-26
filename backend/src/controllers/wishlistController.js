const Wishlist = require("../models/wishlist");
const Product = require("../models/product");
const { chunkedFindAll } = require("../utils/dbHelper");

exports.addToWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;

    const product = await Product.findByPk(product_id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const existing = await Wishlist.findOne({
      where: {
        user_id: userId,
        product_id
      }
    });

    if (existing) {
      return res.json({ message: "Already in wishlist" });
    }

    await Wishlist.create({
      user_id: userId,
      product_id,
    });

    return res.json({ message: "Added to wishlist" });

  } catch (error) {

    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};
exports.removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;

    await Wishlist.destroy({
      where: {
        user_id: userId,
        product_id,
      },
    });

    return res.json({ message: "Removed from wishlist" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.clearWishlist = async (req, res) => {
  try {
    const userId = req.user.id;

    await Wishlist.destroy({
      where: {
        user_id: userId,
      },
    });

    return res.json({ message: "Wishlist cleared" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};
exports.getWishlist = async (req, res) => {
  try {
    const userId = req.user.id;

    const wishlistItems = await Wishlist.findAll({
      where: { user_id: userId },
      order: [["createdAt", "DESC"]],
    });

    const productIds = wishlistItems.map(item => item.product_id).filter(Boolean);
    const products = await chunkedFindAll(Product, "id", productIds);
    const productMap = products.reduce((m, p) => {
      m[p.id] = p;
      return m;
    }, {});

    const items = wishlistItems.map((item) => {
      const product = productMap[item.product_id];
      if (!product) {
        // Clean up orphaned Wishlist record asynchronously in the background
        Wishlist.destroy({ where: { id: item.id } }).catch(err => {
          console.warn("Failed to clean up orphaned wishlist item:", err.message);
        });
        return null;
      }

      return {
        id: item.id,
        user_id: item.user_id,
        product_id: item.product_id,
        product: {
          id: product.id,
          name: product.name,
          image_url: product.image_url,
          selling_price: product.selling_price,
          description: product.description,
        },
        createdAt: item.createdAt
      };
    }).filter(i => i !== null);

    return res.json(items);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};