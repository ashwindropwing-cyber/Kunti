const { Op } = require("sequelize");
const { Cart, CartItem, Product, PlatformSettings } = require("../models");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");

// Helper to get formatted cart data
const getFormattedCart = async (userId, deliveryAddressId = null) => {
  const cart = await Cart.findOne({ where: { user_id: userId } });
  if (!cart) return { items: [], items_total: 0, delivery_fee: 0, total_amount: 0 };

  const cartItems = await CartItem.findAll({ where: { cart_id: cart.id } });
  if (cartItems.length === 0) return { items: [], items_total: 0, delivery_fee: 0, total_amount: 0 };

  const productIds = [...new Set(cartItems.map(i => i.product_id).filter(Boolean))];
  let products = [];
  if (productIds.length > 0) {
    products = await Product.findAll({ where: { id: { [Op.in]: productIds } } });
  }
  const productMap = products.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

  const items = cartItems.map((item) => {
    const product = productMap[item.product_id];
    if (!product) {
      CartItem.destroy({ where: { id: item.id } }).catch(err => {
        console.warn("Failed to clean up orphaned cart item:", err.message);
      });
      return null;
    }

    const price = parseFloat(product.discount_price || product.price) || 0;
    const subtotal = item.quantity * price;

    return {
      cart_item_id: item.id,
      product_id: item.product_id,
      name: product.name,
      price,
      quantity: item.quantity,
      subtotal,
      image_url: product.image_url || null,
      product: {
        id: product.id,
        name: product.name,
        images: product.image_url ? [product.image_url] : [],
        price: price,
      }
    };
  });

  const filteredItems = items.filter(i => i !== null);
  const totalAmount = filteredItems.reduce((sum, item) => sum + item.subtotal, 0);

  const { getPlatformSettingsMap } = require("./platformController");
  const settingsMap = await getPlatformSettingsMap();

  let freeDeliveryThreshold = parseFloat(settingsMap.free_delivery_threshold) || 299;
  let defaultDeliveryFee = parseFloat(settingsMap.delivery_fee_0_to_3km) || 15;
  let maxDeliveryRadius = parseFloat(settingsMap.max_delivery_radius_km) || 5.0;
  let deliveryFee = 0;

  if (filteredItems.length > 0) {
    if (totalAmount >= freeDeliveryThreshold) {
      deliveryFee = 0;
    } else {
      deliveryFee = defaultDeliveryFee;
    }
  }

  return {
    items: filteredItems,
    items_total: totalAmount,
    delivery_fee: deliveryFee,
    total_amount: totalAmount + deliveryFee,
    free_delivery_threshold: freeDeliveryThreshold,
    max_delivery_radius_km: maxDeliveryRadius,
  };
};

exports.addToCart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { product_id, quantity } = req.body;
  const { delivery_address_id } = req.query;

  if (!product_id || !quantity || quantity <= 0) {
    return ApiResponse.error(res, "Invalid product_id or quantity", 400);
  }

  const product = await Product.findByPk(product_id);
  if (!product || !product.is_available) {
    return ApiResponse.error(res, "Product not available", 400);
  }

  if (product.stock_quantity < quantity) {
    return ApiResponse.error(res, "Not enough stock available", 400);
  }

  let [cart] = await Cart.findOrCreate({
    where: { user_id: userId },
    defaults: { user_id: userId }
  });

  let cartItem = await CartItem.findOne({
    where: { cart_id: cart.id, product_id }
  });

  if (cartItem) {
    const newQty = cartItem.quantity + quantity;
    if (product.stock_quantity < newQty) {
      return ApiResponse.error(res, "Stock limit exceeded", 400);
    }
    cartItem.quantity = newQty;
    await cartItem.save();
  } else {
    await CartItem.create({
      cart_id: cart.id,
      product_id,
      quantity,
      price: product.discount_price || product.price
    });
  }

  const updatedCart = await getFormattedCart(userId, delivery_address_id);
  return ApiResponse.success(res, updatedCart, "Added to cart");
});

exports.getCart = asyncHandler(async (req, res) => {
  const { delivery_address_id } = req.query;
  const cartData = await getFormattedCart(req.user.id, delivery_address_id);
  return ApiResponse.success(res, cartData);
});

exports.updateQuantity = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { product_id, quantity } = req.body;
  const { delivery_address_id } = req.query;

  if (!product_id || quantity === undefined || quantity < 0) {
    return ApiResponse.error(res, "Invalid request", 400);
  }

  const cart = await Cart.findOne({ where: { user_id: userId } });
  if (!cart) return ApiResponse.error(res, "Cart not found", 404);

  const cartItem = await CartItem.findOne({
    where: { cart_id: cart.id, product_id }
  });
  if (!cartItem) return ApiResponse.error(res, "Item not in cart", 404);

  if (quantity === 0) {
    await cartItem.destroy();
  } else {
    const product = await Product.findByPk(product_id);
    if (!product) return ApiResponse.error(res, "Product not found", 404);

    if (product.stock_quantity < quantity) {
      return ApiResponse.error(res, "Not enough stock", 400);
    }

    cartItem.quantity = quantity;
    await cartItem.save();
  }

  const updatedCart = await getFormattedCart(userId, delivery_address_id);
  return ApiResponse.success(res, updatedCart, "Quantity updated");
});

exports.removeFromCart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { delivery_address_id } = req.query;
  
  const cart = await Cart.findOne({ where: { user_id: userId } });
  if (!cart) return ApiResponse.success(res, await getFormattedCart(userId, delivery_address_id), "Cart already empty");

  await CartItem.destroy({
    where: { cart_id: cart.id, product_id: req.params.productId },
  });

  const updatedCart = await getFormattedCart(userId, delivery_address_id);
  return ApiResponse.success(res, updatedCart, "Item removed");
});

exports.clearCart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const cart = await Cart.findOne({ where: { user_id: userId } });
  if (!cart) return ApiResponse.success(res, { items: [], total_amount: 0 }, "Cart already empty");

  await CartItem.destroy({ where: { cart_id: cart.id } });
  await cart.destroy();

  return ApiResponse.success(res, { items: [], total_amount: 0 }, "Cart cleared");
});
