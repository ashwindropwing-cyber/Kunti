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
Category.hasMany(Product, { foreignKey: "category_id", as: "products", onDelete: "SET NULL" });
Product.belongsTo(Category, { foreignKey: "category_id", as: "category" });

// User <-> CustomerAddress
User.hasMany(CustomerAddress, { foreignKey: "user_id", as: "addresses", onDelete: "CASCADE" });
CustomerAddress.belongsTo(User, { foreignKey: "user_id", as: "user" });

// User <-> Cart
User.hasOne(Cart, { foreignKey: "user_id", as: "cart", onDelete: "CASCADE" });
Cart.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Cart <-> CartItem <-> Product
Cart.hasMany(CartItem, { foreignKey: "cart_id", as: "items", onDelete: "CASCADE" });
CartItem.belongsTo(Cart, { foreignKey: "cart_id", as: "cart" });
CartItem.belongsTo(Product, { foreignKey: "product_id", as: "product", constraints: false });
Product.hasMany(CartItem, { foreignKey: "product_id", onDelete: "CASCADE", constraints: false });

// User <-> MasterOrder <-> OrderItem
User.hasMany(MasterOrder, { foreignKey: "user_id", as: "orders", constraints: false });
MasterOrder.belongsTo(User, { foreignKey: "user_id", as: "user", constraints: false });

MasterOrder.hasMany(OrderItem, { foreignKey: "master_order_id", as: "items", onDelete: "CASCADE" });
OrderItem.belongsTo(MasterOrder, { foreignKey: "master_order_id", as: "order" });

OrderItem.belongsTo(Product, { foreignKey: "product_id", as: "product", constraints: false });
Product.hasMany(OrderItem, { foreignKey: "product_id", constraints: false });

// MasterOrder <-> CustomerAddress
MasterOrder.belongsTo(CustomerAddress, { foreignKey: "address_id", as: "address", constraints: false });

// User <-> Rider <-> MasterOrder
User.hasOne(Rider, { foreignKey: "user_id", as: "rider", onDelete: "CASCADE", constraints: false });
Rider.belongsTo(User, { foreignKey: "user_id", as: "user", constraints: false });

Rider.hasMany(MasterOrder, { foreignKey: "rider_id", as: "assigned_orders", constraints: false });
MasterOrder.belongsTo(Rider, { foreignKey: "rider_id", as: "rider", constraints: false });

// User <-> Wishlist <-> Product
User.hasMany(Wishlist, { foreignKey: "user_id", as: "wishlist", onDelete: "CASCADE" });
Wishlist.belongsTo(User, { foreignKey: "user_id", as: "user" });
Wishlist.belongsTo(Product, { foreignKey: "product_id", as: "product", constraints: false });
Product.hasMany(Wishlist, { foreignKey: "product_id", onDelete: "CASCADE", constraints: false });

// User <-> Review
User.hasMany(Review, { foreignKey: "user_id", as: "reviews", onDelete: "CASCADE" });
Review.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Product <-> Review
Product.hasMany(Review, { foreignKey: "product_id", as: "reviews", onDelete: "CASCADE", constraints: false });
Review.belongsTo(Product, { foreignKey: "product_id", as: "product", constraints: false });

// Rider <-> Review
Rider.hasMany(Review, { foreignKey: "rider_id", as: "reviews", onDelete: "CASCADE", constraints: false });
Review.belongsTo(Rider, { foreignKey: "rider_id", as: "rider", constraints: false });

// MasterOrder <-> Review
MasterOrder.hasMany(Review, { foreignKey: "master_order_id", as: "reviews", onDelete: "CASCADE", constraints: false });
Review.belongsTo(MasterOrder, { foreignKey: "master_order_id", as: "order", constraints: false });

// Coupon <-> CouponUsage <-> User / MasterOrder
User.hasMany(CouponUsage, { foreignKey: "user_id", as: "coupon_usages", onDelete: "CASCADE" });
CouponUsage.belongsTo(User, { foreignKey: "user_id", as: "user" });

Coupon.hasMany(CouponUsage, { foreignKey: "coupon_id", as: "usages", onDelete: "CASCADE" });
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
  OTP: Otp,
  Review,
  Coupon,
  CouponUsage,
  Notification,
};