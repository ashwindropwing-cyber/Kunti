process.env.NODE_ENV = "test";
process.env.USE_SQLITE = "true";
process.env.DB_DIALECT = "sqlite";
process.env.JWT_SECRET = "test_secret_key_1234567890";
process.env.ENABLE_REDIS = "false";
require("dotenv").config();

const http = require("http");
const jwt = require("jsonwebtoken");
const app = require("./src/app");
const {
  User,
  Product,
  Category,
  Cart,
  CartItem,
  Wishlist,
  Review,
  OrderItem,
  MasterOrder,
  Coupon,
  CouponUsage,
  Banner,
  Rider,
  sequelize,
} = require("./src/models");

const PORT = 5099;
let server;
let adminToken = "";

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: "localhost",
      port: PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    if (token) {
      options.headers["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (e) {}
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });

    req.on("error", (err) => {
      resolve({ statusCode: 500, body: { error: err.message } });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("--------------------------------------------------");
  console.log("  TESTING COMPLETE DELETE LIFECYCLES ACROSS APP   ");
  console.log("--------------------------------------------------");

  await sequelize.sync({ force: true });

  server = app.listen(PORT);
  console.log(`Test server running on port ${PORT}`);

  // Create admin user & token
  const adminUser = await User.create({
    name: "Admin Tester",
    phone: "9999999999",
    role: "ADMIN",
  });
  adminToken = jwt.sign(
    { id: adminUser.id, phone: adminUser.phone, role: "ADMIN" },
    process.env.JWT_SECRET
  );

  // Create customer user
  const customerUser = await User.create({
    name: "Customer Tester",
    phone: "8888888888",
    role: "CUSTOMER",
  });

  // ── TEST 1: Product Deletion with Foreign Dependencies ──
  console.log("\n[Test 1] Testing Product Deletion with Cart, Wishlist, Review, and Order dependencies...");
  const category = await Category.create({ name: "Rolls", is_active: true });
  const product = await Product.create({
    name: "Chicken Roll",
    price: 120,
    category_id: category.id,
    is_available: true,
  });

  const cart = await Cart.create({ user_id: customerUser.id });
  await CartItem.create({ cart_id: cart.id, product_id: product.id, quantity: 2, price: 120 });
  await Wishlist.create({ user_id: customerUser.id, product_id: product.id });
  await Review.create({ user_id: customerUser.id, product_id: product.id, rating: 5, review_type: "PRODUCT" });
  
  const order = await MasterOrder.create({ user_id: customerUser.id, order_number: "ORD-TEST-1001", total_amount: 240, status: "DELIVERED" });
  const orderItem = await OrderItem.create({
    master_order_id: order.id,
    product_id: product.id,
    product_name: "Chicken Roll",
    quantity: 2,
    unit_price: 120,
    total_price: 240,
  });

  // Execute DELETE /api/products/admin/:id
  const delProdRes = await makeRequest("DELETE", `/api/products/admin/${product.id}`, null, adminToken);
  console.log(`  Delete Product API response: status=${delProdRes.statusCode}`, delProdRes.body);

  const prodInDb = await Product.findByPk(product.id);
  const cartItemInDb = await CartItem.findOne({ where: { product_id: product.id } });
  const wishlistInDb = await Wishlist.findOne({ where: { product_id: product.id } });
  const reviewInDb = await Review.findOne({ where: { product_id: product.id } });
  const orderItemInDb = await OrderItem.findByPk(orderItem.id);

  if (delProdRes.statusCode === 200 && !prodInDb && !cartItemInDb && !wishlistInDb && !reviewInDb && orderItemInDb && orderItemInDb.product_id === null) {
    console.log("  ✅ PASS: Product deleted successfully, associations cleaned, and historical OrderItem unlinked.");
  } else {
    console.error("  ❌ FAIL: Product deletion failed!", { prodInDb, cartItemInDb, wishlistInDb, reviewInDb, orderItemInDb });
    process.exit(1);
  }

  // ── TEST 2: Category Deletion with Products ──
  console.log("\n[Test 2] Testing Category Deletion with Products...");
  const cat2 = await Category.create({ name: "Beverages", is_active: true });
  const prod2 = await Product.create({ name: "Cold Drink", price: 40, category_id: cat2.id });

  const delCatRes = await makeRequest("DELETE", `/api/categories/${cat2.id}`, null, adminToken);
  console.log(`  Delete Category API response: status=${delCatRes.statusCode}`, delCatRes.body);

  const catInDb = await Category.findByPk(cat2.id);
  const prod2InDb = await Product.findByPk(prod2.id);

  if (delCatRes.statusCode === 200 && !catInDb && prod2InDb && prod2InDb.category_id === null) {
    console.log("  ✅ PASS: Category deleted successfully and products gracefully unlinked.");
  } else {
    console.error("  ❌ FAIL: Category deletion failed!", { catInDb, prod2InDb });
    process.exit(1);
  }

  // ── TEST 3: Coupon Deletion with Usages ──
  console.log("\n[Test 3] Testing Coupon Deletion with Usage History...");
  const coupon = await Coupon.create({
    code: "SAVE50",
    discount_type: "PERCENTAGE",
    discount_value: 50,
    is_active: true,
  });
  await CouponUsage.create({ user_id: customerUser.id, coupon_id: coupon.id, master_order_id: order.id, discount_amount: 50 });

  const delCouponRes = await makeRequest("DELETE", `/api/coupons/admin/${coupon.id}`, null, adminToken);
  console.log(`  Delete Coupon API response: status=${delCouponRes.statusCode}`, delCouponRes.body);

  const couponInDb = await Coupon.findByPk(coupon.id);
  const usageInDb = await CouponUsage.findOne({ where: { coupon_id: coupon.id } });

  if (delCouponRes.statusCode === 200 && !couponInDb && !usageInDb) {
    console.log("  ✅ PASS: Coupon and usages deleted successfully.");
  } else {
    console.error("  ❌ FAIL: Coupon deletion failed!", { couponInDb, usageInDb });
    process.exit(1);
  }

  // ── TEST 4: Banner Deletion ──
  console.log("\n[Test 4] Testing Banner Deletion...");
  const banner = await Banner.create({ title: "Summer Offer", image_url: "http://example.com/b.jpg", is_active: true });

  const delBannerRes = await makeRequest("DELETE", `/api/banners/${banner.id}`, null, adminToken);
  console.log(`  Delete Banner API response: status=${delBannerRes.statusCode}`, delBannerRes.body);

  const bannerInDb = await Banner.findByPk(banner.id);
  if (delBannerRes.statusCode === 200 && !bannerInDb) {
    console.log("  ✅ PASS: Banner deleted successfully.");
  } else {
    console.error("  ❌ FAIL: Banner deletion failed!", { bannerInDb });
    process.exit(1);
  }

  // ── TEST 5: Rider Deletion with Orders and Reviews ──
  console.log("\n[Test 5] Testing Rider Deletion with Assigned Orders and Reviews...");
  const riderUser = await User.create({ name: "Speedy Rider", phone: "7777777777", role: "RIDER" });
  const rider = await Rider.create({ user_id: riderUser.id, vehicle_type: "Bike", vehicle_number: "WB01AB1234" });
  const riderOrder = await MasterOrder.create({ user_id: customerUser.id, order_number: "ORD-TEST-1002", rider_id: rider.id, total_amount: 150, status: "DELIVERED" });
  await Review.create({ user_id: customerUser.id, rider_id: rider.id, rating: 5, review_type: "RIDER" });

  const delRiderRes = await makeRequest("DELETE", `/api/admin/rider/${rider.id}`, null, adminToken);
  console.log(`  Delete Rider API response: status=${delRiderRes.statusCode}`, delRiderRes.body);

  const riderInDb = await Rider.findByPk(rider.id);
  const riderUserInDb = await User.findByPk(riderUser.id);
  const riderOrderInDb = await MasterOrder.findByPk(riderOrder.id);
  const riderReviewInDb = await Review.findOne({ where: { rider_id: rider.id } });

  if (delRiderRes.statusCode === 200 && !riderInDb && !riderUserInDb && riderOrderInDb && riderOrderInDb.rider_id === null && !riderReviewInDb) {
    console.log("  ✅ PASS: Rider & account deleted, order history unlinked, and rider reviews cleaned.");
  } else {
    console.error("  ❌ FAIL: Rider deletion failed!", { riderInDb, riderUserInDb, riderOrderInDb, riderReviewInDb });
    process.exit(1);
  }

  server.close();
  console.log("\n==================================================");
  console.log("  🎉 ALL DELETE OPERATIONS VERIFIED & PASSED 100%!  ");
  console.log("==================================================\n");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  if (server) server.close();
  process.exit(1);
});
