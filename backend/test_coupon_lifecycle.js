process.env.NODE_ENV = "test";
process.env.USE_SQLITE = "true";
process.env.DB_DIALECT = "sqlite";
require("dotenv").config();

const http = require("http");
const app = require("./src/app");
const { User, Category, Product, CustomerAddress, Cart, CartItem, OTP, sequelize } = require("./src/models");
const bcrypt = require("bcryptjs");

const PORT = 5002;
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
      path: path,
      method: method,
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

async function runCouponLifecycleTest() {
  console.log("\n===============================================================");
  console.log("  TESTING COUPON LIFECYCLE: MAX USAGE = 1 PER USER SCENARIO   ");
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

  // Start HTTP server
  await new Promise((res) => {
    server = app.listen(PORT, () => res());
  });

  // 1. Get Tokens
  const adminLogin = await makeRequest("POST", "/api/auth/admin/login", { email: "admin@kunti.com", password: "admin123" });
  adminToken = adminLogin.body.token || adminLogin.body.data.token;

  await makeRequest("POST", "/api/auth/send-otp", { phone: "7700000000" });
  const custOtpDoc = await OTP.findOne({ where: { phone: "7700000000" } });
  const custLogin = await makeRequest("POST", "/api/auth/verify-otp", { phone: "7700000000", otp: custOtpDoc ? custOtpDoc.otp : "123456" });
  customerToken = custLogin.body.token || custLogin.body.data.token;


  // 2. Setup Category, Product, Address
  const catRes = await makeRequest("POST", "/api/categories", { name: "Special Rolls", display_order: 1 }, adminToken);
  testCategoryId = catRes.body.id || catRes.body.data?.id;

  const prodRes = await makeRequest("POST", "/api/products", {
    name: "Paneer Roll",
    price: 150,
    category_id: testCategoryId,
    food_type: "veg",
    stock_quantity: 50,
    is_available: true
  }, adminToken);
  testProductId = prodRes.body.product?.id || prodRes.body.id;

  const addrRes = await makeRequest("POST", "/api/address", {
    address_type: "HOME",
    address_line1: "Flat 402",
    address_line2: "Salt Lake Sector 5",
    city: "Kolkata",
    pincode: "700091",
    latitude: 22.5726,
    longitude: 88.3639
  }, customerToken);
  testAddressId = addrRes.body.address?.id || addrRes.body.data?.id || addrRes.body.id;


  // 3. STEP 1: Admin creates coupon with max_usage_per_user = 1
  const testCouponCode = "ONETIME_" + Math.floor(1000 + Math.random() * 9000);
  console.log(`[Step 1] Admin creates coupon "${testCouponCode}" with usage_limit_per_user = 1...`);
  const createCouponRes = await makeRequest("POST", "/api/coupons", {
    code: testCouponCode,
    description: "Flat ₹50 OFF on first order",
    discount_type: "FIXED",
    discount_value: 50,
    min_order_amount: 100,
    usage_limit_per_user: 1, // Max usage = 1
    total_usage_limit: 1000,
  }, adminToken);

  if (createCouponRes.statusCode === 201) {
    console.log("   ✅ Coupon created successfully with usage_limit_per_user = 1.");
  } else {
    console.error("   ❌ Failed to create coupon:", createCouponRes.body);
    process.exit(1);
  }

  // 4. STEP 2: Customer checks available coupons -> Must see the coupon
  console.log(`\n[Step 2] Customer checks available coupons...`);
  const availRes1 = await makeRequest("GET", "/api/coupons/available", null, customerToken);
  const couponsList1 = availRes1.body.data || availRes1.body || [];
  const foundInList1 = couponsList1.some((c) => c.code === testCouponCode);
  if (foundInList1) {
    console.log(`   ✅ Coupon "${testCouponCode}" is visible to customer in available coupons list.`);
  } else {
    console.error(`   ❌ Coupon "${testCouponCode}" NOT found in available coupons list!`, couponsList1);
    process.exit(1);
  }

  // 5. STEP 3: Customer applies coupon to preview / calculate discount (WITHOUT placing order)
  console.log(`\n[Step 3] Customer applies coupon in cart preview (subtotal = 150) without placing order...`);
  const applyRes = await makeRequest("POST", "/api/coupons/apply", { code: testCouponCode, subtotal: 150 }, customerToken);
  const appliedDiscount = applyRes.body?.data?.discount_amount ?? applyRes.body?.discount_amount;
  const finalSub = applyRes.body?.data?.final_subtotal ?? applyRes.body?.final_subtotal;
  if (applyRes.statusCode === 200 && appliedDiscount === 50) {
    console.log(`   ✅ Coupon applied in cart! Discount = ₹${appliedDiscount}, Final Subtotal = ₹${finalSub}`);
  } else {
    console.error("   ❌ Failed to apply coupon:", applyRes.body);
    process.exit(1);
  }


  // 6. STEP 4: Customer checks available coupons again -> MUST STILL BE VISIBLE because no order was placed!
  console.log(`\n[Step 4] Customer checks available coupons after preview (no order placed)...`);
  const availRes2 = await makeRequest("GET", "/api/coupons/available", null, customerToken);
  const couponsList2 = availRes2.body.data || availRes2.body || [];
  const foundInList2 = couponsList2.some((c) => c.code === testCouponCode);
  if (foundInList2) {
    console.log(`   ✅ PASS: Coupon "${testCouponCode}" is STILL visible because order was not placed.`);
  } else {
    console.error(`   ❌ FAIL: Coupon was prematurely hidden before order was placed!`);
    process.exit(1);
  }

  // 7. STEP 5: Customer adds item to cart and PLACES ORDER with the coupon
  console.log(`\n[Step 5] Customer adds item to cart and places order with coupon "${testCouponCode}"...`);
  await makeRequest("POST", "/api/cart/add", { product_id: testProductId, quantity: 1 }, customerToken);

  const placeOrderRes = await makeRequest("POST", "/api/orders/place", {
    address_id: testAddressId,
    delivery_address_id: testAddressId,
    payment_method: "COD",
    order_type: "DELIVERY",
    coupon_code: testCouponCode,
  }, customerToken);

  let placedOrderId = "";
  if (placeOrderRes.statusCode === 201) {
    placedOrderId = placeOrderRes.body.data?.id || placeOrderRes.body.id;
    const discount = placeOrderRes.body.data?.discount_amount ?? placeOrderRes.body.discount_amount;
    console.log(`   ✅ Order placed successfully! Order ID: ${placedOrderId}, Coupon Discount: ₹${discount}`);
  } else {
    console.error("   ❌ Failed to place order with coupon:", placeOrderRes.body);
    process.exit(1);
  }

  // 8. STEP 6: Customer checks available coupons again -> MUST BE HIDDEN (usage limit 1 reached)
  console.log(`\n[Step 6] Customer checks available coupons after successful order placement...`);
  const availRes3 = await makeRequest("GET", "/api/coupons/available", null, customerToken);
  const couponsList3 = availRes3.body.data || availRes3.body || [];
  const foundInList3 = couponsList3.some((c) => c.code === testCouponCode);
  if (!foundInList3) {
    console.log(`   ✅ PASS: Coupon "${testCouponCode}" is now HIDDEN from customer (max usage reached = 0 remaining)!`);
  } else {
    console.error(`   ❌ FAIL: Coupon "${testCouponCode}" is still visible to customer after reaching max usage!`);
    process.exit(1);
  }

  // 9. STEP 7: Customer attempts to re-apply the coupon manually or place another order with it
  console.log(`\n[Step 7] Customer tries to re-apply "${testCouponCode}" on a new cart...`);
  const reapplyRes = await makeRequest("POST", "/api/coupons/apply", { code: testCouponCode, subtotal: 150 }, customerToken);
  if (reapplyRes.statusCode === 400) {
    console.log(`   ✅ PASS: Re-application correctly blocked! Message: "${reapplyRes.body.message}"`);
  } else {
    console.error(`   ❌ FAIL: Re-application was NOT blocked! Status: ${reapplyRes.statusCode}`);
    process.exit(1);
  }

  // 10. STEP 8: Admin / Customer cancels the order -> Coupon usage is restored
  console.log(`\n[Step 8] Order is cancelled. Verifying coupon usage restoration...`);
  const cancelRes = await makeRequest("PATCH", `/api/orders/cancel/${placedOrderId}`, null, customerToken);
  if (cancelRes.statusCode === 200) {
    console.log(`   ✅ Order #${placedOrderId} cancelled successfully.`);
  } else {
    console.error(`   ❌ Order cancel failed:`, cancelRes.body);
    process.exit(1);
  }

  const availRes4 = await makeRequest("GET", "/api/coupons/available", null, customerToken);
  const couponsList4 = availRes4.body.data || availRes4.body || [];
  const foundInList4 = couponsList4.some((c) => c.code === testCouponCode);
  if (foundInList4) {
    console.log(`   ✅ PASS: Coupon "${testCouponCode}" is restored and visible again after order cancellation!`);
  } else {
    console.error(`   ❌ FAIL: Coupon was not restored after cancellation!`);
    process.exit(1);
  }

  server.close();
  console.log("\n===============================================================");
  console.log("  🎉 ALL COUPON LIFECYCLE TESTS PASSED WITH 100% ACCURACY!    ");
  console.log("===============================================================\n");
}

runCouponLifecycleTest();
