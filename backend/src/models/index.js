const sequelize = require("../config/database");
const User = require("./user");
const Category = require("./category");
const Product = require("./product");
const Cart = require("./cart");
const CartItem = require("./cartItem");
const CustomerAddress = require("./customerAddress");
const MasterOrder = require("./masterOrder");
const OrderItem = require("./orderItem");
const Rider = require("./rider");
const Banner = require("./banner");
const PlatformSettings = require("./platformSettings");
const Wishlist = require("./wishlist");
const Otp = require("./otp");
const Review = require("./review");
const Coupon = require("./coupon");
const CouponUsage = require("./couponUsage");
const Notification = require("./notification");

// ==========================================
// Define Sequelize Relational Associations
// ==========================================

// Category <-> Product
Category.hasMany(Product, { foreignKey: "category_id", as: "products" });
Product.belongsTo(Category, { foreignKey: "category_id", as: "category" });

// User <-> CustomerAddress
User.hasMany(CustomerAddress, { foreignKey: "user_id", as: "addresses" });
CustomerAddress.belongsTo(User, { foreignKey: "user_id", as: "user" });

// User <-> Cart
User.hasOne(Cart, { foreignKey: "user_id", as: "cart" });
Cart.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Cart <-> CartItem <-> Product
Cart.hasMany(CartItem, { foreignKey: "cart_id", as: "items" });
CartItem.belongsTo(Cart, { foreignKey: "cart_id", as: "cart" });
CartItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });
Product.hasMany(CartItem, { foreignKey: "product_id" });

// User <-> MasterOrder <-> OrderItem
User.hasMany(MasterOrder, { foreignKey: "user_id", as: "orders" });
MasterOrder.belongsTo(User, { foreignKey: "user_id", as: "user" });

MasterOrder.hasMany(OrderItem, { foreignKey: "master_order_id", as: "items" });
OrderItem.belongsTo(MasterOrder, { foreignKey: "master_order_id", as: "order" });

OrderItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });
Product.hasMany(OrderItem, { foreignKey: "product_id" });

// MasterOrder <-> CustomerAddress
MasterOrder.belongsTo(CustomerAddress, { foreignKey: "address_id", as: "address" });

// User <-> Rider <-> MasterOrder
User.hasOne(Rider, { foreignKey: "user_id", as: "rider" });
Rider.belongsTo(User, { foreignKey: "user_id", as: "user" });

Rider.hasMany(MasterOrder, { foreignKey: "rider_id", as: "assigned_orders" });
MasterOrder.belongsTo(Rider, { foreignKey: "rider_id", as: "rider" });

// User <-> Wishlist <-> Product
User.hasMany(Wishlist, { foreignKey: "user_id", as: "wishlist" });
Wishlist.belongsTo(User, { foreignKey: "user_id", as: "user" });
Wishlist.belongsTo(Product, { foreignKey: "product_id", as: "product" });

// User <-> Review
User.hasMany(Review, { foreignKey: "user_id", as: "reviews" });
Review.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Product <-> Review
Product.hasMany(Review, { foreignKey: "product_id", as: "reviews" });
Review.belongsTo(Product, { foreignKey: "product_id", as: "product" });

// Rider <-> Review
Rider.hasMany(Review, { foreignKey: "rider_id", as: "reviews" });
Review.belongsTo(Rider, { foreignKey: "rider_id", as: "rider" });

// MasterOrder <-> Review
MasterOrder.hasMany(Review, { foreignKey: "master_order_id", as: "reviews" });
Review.belongsTo(MasterOrder, { foreignKey: "master_order_id", as: "order" });

// Coupon <-> CouponUsage <-> User / MasterOrder
User.hasMany(CouponUsage, { foreignKey: "user_id", as: "coupon_usages" });
CouponUsage.belongsTo(User, { foreignKey: "user_id", as: "user" });

Coupon.hasMany(CouponUsage, { foreignKey: "coupon_id", as: "usages" });
CouponUsage.belongsTo(Coupon, { foreignKey: "coupon_id", as: "coupon" });

MasterOrder.hasOne(CouponUsage, { foreignKey: "master_order_id", as: "coupon_usage" });
CouponUsage.belongsTo(MasterOrder, { foreignKey: "master_order_id", as: "order" });

module.exports = {
  sequelize,
  User,
  Category,
  Product,
  Cart,
  CartItem,
  CustomerAddress,
  MasterOrder,
  OrderItem,
  Rider,
  Banner,
  PlatformSettings,
  Wishlist,
  Otp,
  Review,
  Coupon,
  CouponUsage,
  Notification,
};