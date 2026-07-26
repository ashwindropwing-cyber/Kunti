const Product = require("./product");
const Cart = require("./cart");
const CartItem = require("./cartItem");
const Category = require("./category");
const MasterOrder = require("./masterOrder");
const OrderItem = require("./orderItem");
const User = require("./user");
const CustomerAddress = require("./customerAddress");
const Rider = require("./rider");
const Wallet = require("./wallet");
const Banner = require("./banner");
const RiderDocument = require("./riderDocument");
const PlatformSettings = require("./platformSettings");
const Wishlist = require("./wishlist");
const RefundRequest = require("./refundRequest");
const WalletTransaction = require("./walletTransaction");
const Otp = require("./otp");
const Review = require("./review");
const WithdrawalRequest = require("./withdrawalRequest");

// =======================
// Export Models
// =======================
module.exports = {
  Product,
  Cart,
  CartItem,
  Category,
  MasterOrder,
  OrderItem,
  User,
  CustomerAddress,
  Rider,
  Wishlist,
  Wallet,
  Banner,
  RiderDocument,
  PlatformSettings,
  RefundRequest,
  WalletTransaction,
  Otp,
  Review,
  WithdrawalRequest
};