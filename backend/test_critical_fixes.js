process.env.NODE_ENV = "test";
process.env.USE_SQLITE = "true";
process.env.DB_DIALECT = "sqlite";
require("dotenv").config();

const http = require("http");
const app = require("./src/app");
const { User, Product, Category, CustomerAddress, Coupon, CouponUsage, MasterOrder, OrderItem, OTP, sequelize } = require("./src/models");
const { restoreOrderInventoryAndCoupon } = require("./src/controllers/orderController");
const bcrypt = require("bcryptjs");

const PORT = 5003;
let server;
let adminToken = "";
let customerToken = "";
let testUserId = "";
let testCategoryId = "";
let testProductId = "";
let testAddressId = "";

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: "localhost",
      port: PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
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

async function runVerification() {
  console.log("\n===============================================================");
  console.log("  TESTING ALL CRITICAL BACKEND BUG FIXES & RESTORATION FLOWS  ");
  console.log("===============================================================\n");

  await app.initDb();

  const hashedPassword = await bcrypt.hash("admin123", 10);

  const [adminUser] = await User.findOrCreate({
    where: { phone: "9999999999" },
    defaults: { name: "Test Admin", email: "admin@kunti.com", password: hashedPassword, role: "ADMIN" }
  });

  const [custUser] = await User.findOrCreate({
    where: { phone: "7700000000" },
    defaults: { name: "Test Customer", email: "customer@kunti.com", password: hashedPassword, role: "CUSTOMER" }
  });
  testUserId = custUser.id;

  await new Promise((res) => {
    server = app.listen(PORT, () => res());
  });

  // Auth tokens
  const adminLogin = await makeRequest("POST", "/api/auth/admin/login", { email: "admin@kunti.com", password: "admin123" });
  adminToken = adminLogin.body.token || adminLogin.body.data.token;

  await makeRequest("POST", "/api/auth/send-otp", { phone: "7700000000" });
  const custOtpDoc = await OTP.findOne({ where: { phone: "7700000000" } });
  const custLogin = await makeRequest("POST", "/api/auth/verify-otp", { phone: "7700000000", otp: custOtpDoc ? custOtpDoc.otp : "123456" });
  customerToken = custLogin.body.token || custLogin.body.data.token;

  // Setup Category, Product, Address
  const catRes = await makeRequest("POST", "/api/categories", { name: "Fixed Category", display_order: 1 }, adminToken);
  testCategoryId = catRes.body.id || catRes.body.data?.id;

  const prodRes = await makeRequest("POST", "/api/products", {
    name: "Mughlai Egg Roll",
    price: 200,
    category_id: testCategoryId,
    food_type: "egg",
    stock_quantity: 100,
    is_available: true
  }, adminToken);
  testProductId = prodRes.body.product?.id || prodRes.body.id;

  const addrRes = await makeRequest("POST", "/api/address", {
    address_type: "HOME",
    address_line1: "Flat 101",
    address_line2: "Sector 5",
    city: "Kolkata",
    pincode: "700091",
    latitude: 22.5726,
    longitude: 88.3639
  }, customerToken);
  testAddressId = addrRes.body.address?.id || addrRes.body.data?.id || addrRes.body.id;

  // ── TEST 1: Product Toggle is_available ──────────────────────────────────────
  console.log("[Test 1] Testing Product Toggle (`adminToggleProduct`)...");
  const toggleRes = await makeRequest("PUT", `/api/products/${testProductId}/toggle`, null, adminToken);
  const prodAfterToggle = await Product.findByPk(testProductId);
  if (toggleRes.statusCode === 200 && prodAfterToggle.is_available === false) {
    console.log("  ✅ PASS: adminToggleProduct correctly toggled `is_available` to false in DB.");
  } else {
    console.error("  ❌ FAIL: adminToggleProduct did not toggle `is_available` in DB!", toggleRes.body);
    process.exit(1);
  }
  // Toggle back to true
  await makeRequest("PUT", `/api/products/${testProductId}/toggle`, null, adminToken);

  // ── TEST 2: Coupon Date Filtering ([Op.and] Fix) ──────────────────────────
  console.log("\n[Test 2] Testing Coupon Date Filtering with Future Start Date...");
  const futureCouponCode = "FUTURE_" + Math.floor(1000 + Math.random() * 9000);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5); // 5 days in future

  await makeRequest("POST", "/api/coupons", {
    code: futureCouponCode,
    discount_type: "FIXED",
    discount_value: 30,
    min_order_amount: 50,
    start_date: futureDate.toISOString(),
  }, adminToken);

  const availableCouponsRes = await makeRequest("GET", "/api/coupons/available", null, customerToken);
  const couponList = availableCouponsRes.body.data || availableCouponsRes.body || [];
  const futureFound = couponList.some(c => c.code === futureCouponCode);
  if (!futureFound) {
    console.log("  ✅ PASS: Future coupon is correctly hidden by [Op.and] date filtering.");
  } else {
    console.error("  ❌ FAIL: Future coupon was returned in available list!", futureCouponCode);
    process.exit(1);
  }

  // ── TEST 3: Order Placement -> Stock & Coupon Deduction -> Admin Status Cancel Restore ──
  console.log("\n[Test 3] Testing Order Placement & Admin Status Cancellation Stock/Coupon Restore...");
  const testCoupon = "TESTCOUP_" + Math.floor(1000 + Math.random() * 9000);
  await makeRequest("POST", "/api/coupons", {
    code: testCoupon,
    discount_type: "FIXED",
    discount_value: 40,
    min_order_amount: 100,
    usage_limit_per_user: 1,
  }, adminToken);

  const initialStock = (await Product.findByPk(testProductId)).stock_quantity;
  await makeRequest("POST", "/api/cart/add", { product_id: testProductId, quantity: 2 }, customerToken);

  const orderPlaceRes = await makeRequest("POST", "/api/orders/place", {
    address_id: testAddressId,
    delivery_address_id: testAddressId,
    payment_method: "COD",
    order_type: "DELIVERY",
    coupon_code: testCoupon,
  }, customerToken);

  const placedOrderId = orderPlaceRes.body.data?.id || orderPlaceRes.body.id;
  const stockAfterOrder = (await Product.findByPk(testProductId)).stock_quantity;
  const couponDocAfterOrder = await Coupon.findOne({ where: { code: testCoupon } });
  const couponUsageCount = await CouponUsage.count({ where: { user_id: testUserId, coupon_id: couponDocAfterOrder.id } });

  if (stockAfterOrder === initialStock - 2 && couponDocAfterOrder.used_count === 1 && couponUsageCount === 1) {
    console.log(`  ✅ PASS: Stock decremented (${initialStock} -> ${stockAfterOrder}) and Coupon usage recorded.`);
  } else {
    console.error("  ❌ FAIL: Stock or coupon not deducted correctly on order placement!");
    process.exit(1);
  }

  // Admin cancels the order via updateOrderStatus
  console.log("  Testing Admin cancellation via updateOrderStatus...");
  const adminCancelRes = await makeRequest("PATCH", `/api/orders/admin/${placedOrderId}/status`, {
    status: "CANCELLED",
    cancel_reason: "Kitchen out of ingredients"
  }, adminToken);

  const stockAfterAdminCancel = (await Product.findByPk(testProductId)).stock_quantity;
  const couponDocAfterCancel = await Coupon.findOne({ where: { code: testCoupon } });
  const couponUsageAfterCancel = await CouponUsage.count({ where: { user_id: testUserId, coupon_id: couponDocAfterCancel.id } });

  if (adminCancelRes.statusCode === 200 && stockAfterAdminCancel === initialStock && couponDocAfterCancel.used_count === 0 && couponUsageAfterCancel === 0) {
    console.log(`  ✅ PASS: Admin status update to CANCELLED restored stock (${stockAfterAdminCancel}) and restored coupon.`);
  } else {
    console.error("  ❌ FAIL: Stock or coupon was not restored by admin status cancellation!", { stockAfterAdminCancel, initialStock, used_count: couponDocAfterCancel.used_count });
    process.exit(1);
  }

  // ── TEST 4: Payment Verification Failure Resource Restoration ───────────────
  console.log("\n[Test 4] Testing Payment Verification Failure Resource Restoration...");
  await makeRequest("POST", "/api/cart/add", { product_id: testProductId, quantity: 3 }, customerToken);
  const onlineOrderRes = await makeRequest("POST", "/api/orders/place", {
    address_id: testAddressId,
    delivery_address_id: testAddressId,
    payment_method: "ONLINE",
    order_type: "DELIVERY",
    coupon_code: testCoupon,
  }, customerToken);

  const onlineOrderId = onlineOrderRes.body.data?.id || onlineOrderRes.body.id;
  const stockAfterOnlinePlace = (await Product.findByPk(testProductId)).stock_quantity;
  console.log(`  Online order placed. Stock is now: ${stockAfterOnlinePlace} (Expected: ${initialStock - 3})`);

  // Simulate payment verification with invalid signature
  const verifyRes = await makeRequest("POST", "/api/orders/verify-payment", {
    master_order_id: onlineOrderId,
    razorpay_order_id: onlineOrderRes.body.razorpay_order_id || "rzp_order_mock",
    razorpay_payment_id: "pay_fake_123",
    razorpay_signature: "invalid_sig_abc123"
  }, customerToken);

  const stockAfterPayFail = (await Product.findByPk(testProductId)).stock_quantity;
  const couponDocAfterPayFail = await Coupon.findOne({ where: { code: testCoupon } });
  const couponUsageAfterPayFail = await CouponUsage.count({ where: { user_id: testUserId, coupon_id: couponDocAfterPayFail.id } });

  if (verifyRes.statusCode === 400 && stockAfterPayFail === initialStock && couponDocAfterPayFail.used_count === 0 && couponUsageAfterPayFail === 0) {
    console.log(`  ✅ PASS: Payment verification failure safely cancelled order, restored stock (${stockAfterPayFail}) and refunded coupon!`);
  } else {
    console.error("  ❌ FAIL: Payment verification failure did not restore stock or coupon!", {
      statusCode: verifyRes.statusCode,
      stockAfterPayFail,
      initialStock,
      used_count: couponDocAfterPayFail.used_count
    });
    process.exit(1);
  }

  server.close();
  console.log("\n===============================================================");
  console.log("  🎉 ALL CRITICAL FIXES VERIFIED SUCCESSFULLY WITH 100% PASS! ");
  console.log("===============================================================\n");
  process.exit(0);
}

runVerification();
