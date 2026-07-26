const Cart = require("../models/cart");
const CartItem = require("../models/cartItem");
const Product = require("../models/product");
const CustomerAddress = require("../models/customerAddress");
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
    products = await Product.findAll({ where: { id: { in: productIds } } });
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

    const price = parseFloat(product.selling_price) || 0;
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
        unit: product.unit || ""
      }
    };
  });

  const filteredItems = items.filter(i => i !== null);
  const totalAmount = filteredItems.reduce((sum, item) => sum + item.subtotal, 0);

  let deliveryFee = 0;
  let freeDeliveryThreshold = 500;
  let defaultDeliveryFee = 15; // Simplified flat fee for single-vendor

  const PlatformSettings = require("../models/platformSettings");
  const settings = await PlatformSettings.findAll({
    where: { key: ["free_delivery_threshold", "default_delivery_fee"] }
  });

  for (const s of settings) {
    if (s.key === "free_delivery_threshold") freeDeliveryThreshold = parseFloat(s.value);
    if (s.key === "default_delivery_fee") defaultDeliveryFee = parseFloat(s.value);
  }

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
  };
};

exports.addToCart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { product_id, quantity } = req.body;
  const { delivery_address_id } = req.query;

  if (!product_id || !quantity || quantity <= 0) {
    return ApiResponse.error(res, "Invalid product_id or quantity", 400);
  }

  const { firestore } = require("../config/firebase");
  let cartId;

  try {
    await firestore.runTransaction(async (dbTx) => {
      // 1. Fetch Cart
      const cartQuery = firestore.collection("carts").where("user_id", "==", userId).limit(1);
      const cartSnap = await dbTx.get(cartQuery);
      
      let cartRef;
      if (cartSnap.empty) {
        cartRef = firestore.collection("carts").doc();
        cartId = cartRef.id;
        dbTx.set(cartRef, {
          user_id: userId,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } else {
        cartRef = cartSnap.docs[0].ref;
        cartId = cartSnap.docs[0].id;
      }

      // 2. Fetch Product (to check stock, active status)
      const productRef = firestore.collection("products").doc(product_id);
      const productSnap = await dbTx.get(productRef);
      if (!productSnap.exists) {
        throw new Error("Product not available");
      }
      const productData = productSnap.data();
      if (!productData.is_active) {
        throw new Error("Product not available");
      }
      if (productData.quantity < quantity) {
        throw new Error("Not enough stock available");
      }

      // Removed single-seller rule check entirely

      // 3. Fetch/Create CartItem using deterministic ID
      const cartItemRef = firestore.collection("cart_items").doc(`${cartId}_${product_id}`);
      const cartItemSnap = await dbTx.get(cartItemRef);

      if (cartItemSnap.exists) {
        const cartItemData = cartItemSnap.data();
        const newQty = (cartItemData.quantity || 0) + quantity;
        if (productData.quantity < newQty) {
          throw new Error("Stock limit exceeded");
        }
        dbTx.update(cartItemRef, {
          quantity: newQty,
          updatedAt: new Date()
        });
      } else {
        dbTx.set(cartItemRef, {
          cart_id: cartId,
          product_id: product_id,
          quantity: quantity,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    });
  } catch (txError) {
    return ApiResponse.error(res, txError.message, 400);
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

  const { firestore } = require("../config/firebase");

  try {
    await firestore.runTransaction(async (dbTx) => {
      // 1. Fetch Cart
      const cartQuery = firestore.collection("carts").where("user_id", "==", userId).limit(1);
      const cartSnap = await dbTx.get(cartQuery);
      if (cartSnap.empty) {
        throw new Error("Cart not found");
      }
      const cartId = cartSnap.docs[0].id;

      // 2. Fetch/Check CartItem using deterministic ID or fall back to query
      const cartItemRef = firestore.collection("cart_items").doc(`${cartId}_${product_id}`);
      let cartItemSnap = await dbTx.get(cartItemRef);

      if (!cartItemSnap.exists) {
        const itemQuery = firestore.collection("cart_items")
          .where("cart_id", "==", cartId)
          .where("product_id", "==", product_id)
          .limit(1);
        const itemSnap = await dbTx.get(itemQuery);
        if (itemSnap.empty) {
          throw new Error("Item not in cart");
        }
        cartItemSnap = itemSnap.docs[0];
      }

      if (quantity === 0) {
        dbTx.delete(cartItemSnap.ref);
      } else {
        // Fetch Product to check stock
        const productRef = firestore.collection("products").doc(product_id);
        const productSnap = await dbTx.get(productRef);
        if (!productSnap.exists) {
          throw new Error("Product not found");
        }
        const productData = productSnap.data();
        if (productData.quantity < quantity) {
          throw new Error("Not enough stock");
        }

        dbTx.update(cartItemSnap.ref, {
          quantity: quantity,
          updatedAt: new Date()
        });
      }
    });
  } catch (txError) {
    if (txError.message === "Cart not found") {
      return ApiResponse.error(res, txError.message, 404);
    }
    if (txError.message === "Item not in cart") {
      return ApiResponse.error(res, txError.message, 404);
    }
    if (txError.message === "Product not found") {
      return ApiResponse.error(res, txError.message, 404);
    }
    return ApiResponse.error(res, txError.message, 400);
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
