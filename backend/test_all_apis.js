process.env.NODE_ENV = "test";
process.env.USE_SQLITE = "true";
process.env.DB_DIALECT = "sqlite";
require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const { User, Rider, OTP, Category, Product, Banner, Coupon, MasterOrder, CustomerAddress, Cart, CartItem, sequelize } = require("./src/models");
const bcrypt = require("bcryptjs");

const PORT = 5001; // Separate test port

let server;
let adminToken = "";
let riderToken = "";
let customerToken = "";
let sampleCategoryId = "";
let sampleProductId = "";
let sampleAddressId = "";

// Helper to make HTTP requests and measure response time
function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const startTime = process.hrtime();
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
        const diff = process.hrtime(startTime);
        const durationMs = parseFloat((diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2));
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          durationMs,
          body: parsed
        });
      });
    });

    req.on("error", (err) => {
      resolve({ statusCode: 500, durationMs: 0, body: { error: err.message } });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("===============================================================");
  console.log("  KUNTI BACKEND: COMPREHENSIVE API TEST & LATENCY BENCHMARK   ");
  console.log("===============================================================");

  // Initialize DB
  try {
    await app.initDb();
    console.log("✅ Database initialized successfully.");
  } catch (err) {
    console.error("⚠️ DB init notice:", err.message);
  }

  // Seed essential test accounts
  const hashedPassword = await bcrypt.hash("admin123", 10);

  const [adminUser] = await User.findOrCreate({
    where: { phone: "9999999999" },
    defaults: { name: "Test Admin", email: "admin@kunti.com", password: hashedPassword, role: "ADMIN" }
  });
  adminUser.password = hashedPassword;
  adminUser.role = "ADMIN";
  await adminUser.save();


  const [riderUser] = await User.findOrCreate({
    where: { phone: "8800000000" },
    defaults: { name: "Test Rider", email: "rider@kunti.com", password: hashedPassword, role: "RIDER" }
  });

  const [custUser] = await User.findOrCreate({
    where: { phone: "7700000000" },
    defaults: { name: "Test Customer", email: "customer@kunti.com", password: hashedPassword, role: "CUSTOMER" }
  });

  await Rider.findOrCreate({
    where: { user_id: riderUser.id },
    defaults: { is_available: true, current_lat: 12.9716, current_lng: 77.5946, is_verified: true }
  });

  // Start HTTP server
  await new Promise((res) => {
    server = app.listen(PORT, () => {
      console.log(`🚀 Test Server running on http://localhost:${PORT}`);
      res();
    });
  });

  const results = [];

  async function test(name, method, path, body = null, useAuth = null) {
    let token = null;
    if (useAuth === "admin") token = adminToken;
    if (useAuth === "rider") token = riderToken;
    if (useAuth === "customer") token = customerToken;

    const res = await makeRequest(method, path, body, token);
    const passed = res.statusCode >= 200 && res.statusCode < 400;
    results.push({
      name,
      method,
      path,
      status: res.statusCode,
      passed,
      durationMs: res.durationMs,
      response: res.body
    });
    const icon = passed ? "✅" : "❌";
    console.log(`${icon} [${res.statusCode}] ${method} ${path.padEnd(35)} — ${name} (${res.durationMs}ms)`);
    if (!passed) {
      console.log("   --> Error Body:", JSON.stringify(res.body));
    }
    return res;
  }

  // 1. Health Check & Cache Metrics
  await test("Health Check & Cache Stats", "GET", "/api/health");

  // 2. Auth APIs
  await test("Customer Send OTP", "POST", "/api/auth/send-otp", { phone: "7700000000" });
  const custOtpDoc = await OTP.findOne({ where: { phone: "7700000000" } });
  const custLoginRes = await test("Customer Verify OTP", "POST", "/api/auth/verify-otp", { phone: "7700000000", otp: custOtpDoc ? custOtpDoc.otp : "123456" });
  if (custLoginRes.body && custLoginRes.body.token) customerToken = custLoginRes.body.token;
  else if (custLoginRes.body?.data?.token) customerToken = custLoginRes.body.data.token;

  // Admin Login
  const adminLoginRes = await test("Admin Login", "POST", "/api/auth/admin/login", { email: "admin@kunti.com", password: "admin123" });
  if (adminLoginRes.body && adminLoginRes.body.token) adminToken = adminLoginRes.body.token;
  else if (adminLoginRes.body?.data?.token) adminToken = adminLoginRes.body.data.token;

  // Rider Login
  await makeRequest("POST", "/api/auth/send-otp", { phone: "8800000000" });
  const riderOtpDoc = await OTP.findOne({ where: { phone: "8800000000" } });
  const riderLoginRes = await test("Rider Verify OTP", "POST", "/api/auth/verify-otp", { phone: "8800000000", otp: riderOtpDoc ? riderOtpDoc.otp : "123456", role: "RIDER" });
  if (riderLoginRes.body && riderLoginRes.body.token) riderToken = riderLoginRes.body.token;
  else if (riderLoginRes.body?.data?.token) riderToken = riderLoginRes.body.data.token;


  // 3. Platform Settings APIs
  await test("Get Public Settings (Miss)", "GET", "/api/platform/public-settings");
  await test("Get Public Settings (Hit)", "GET", "/api/platform/public-settings");
  await test("Get Admin Settings", "GET", "/api/platform/settings", null, "admin");

  // 4. Category APIs
  const catCreateRes = await test("Create Category", "POST", "/api/categories", { name: "Rolls & Wraps", display_order: 1 }, "admin");
  if (catCreateRes.body?.id) sampleCategoryId = catCreateRes.body.id;

  await test("Get Categories (Miss)", "GET", "/api/categories");
  await test("Get Categories (Hit - L1/L2)", "GET", "/api/categories");
  await test("Get Categories All (Admin)", "GET", "/api/categories?all=true", null, "admin");

  // 5. Product APIs
  const prodCreateRes = await test("Create Product", "POST", "/api/products", {
    name: "Classic Kolkata Egg Roll",
    description: "Delicious freshly made roll with eggs and onions",
    category_id: sampleCategoryId,
    price: 120,
    discount_price: 99,
    food_type: "egg",
    is_available: true,
  }, "admin");
  if (prodCreateRes.body?.product?.id) sampleProductId = prodCreateRes.body.product.id;

  await test("Get Products (Miss)", "GET", "/api/products");
  await test("Get Products (Hit - L1/L2)", "GET", "/api/products");

  if (sampleProductId) {
    await test("Get Product Details (Miss)", "GET", `/api/products/${sampleProductId}`);
    await test("Get Product Details (Hit)", "GET", `/api/products/${sampleProductId}`);
    await test("Get Product Reviews", "GET", `/api/products/${sampleProductId}/reviews`);
    await test("Toggle Product Active Status", "PUT", `/api/products/${sampleProductId}/toggle`, null, "admin");
  }

  // 6. Banner APIs
  await test("Create Banner", "POST", "/api/banners", { title: "Special Discount", image_url: "https://via.placeholder.com/600x300", display_order: 1 }, "admin");
  await test("Get Active Banners (Miss)", "GET", "/api/banners");
  await test("Get Active Banners (Hit - L1/L2)", "GET", "/api/banners");
  await test("Get All Banners (Admin)", "GET", "/api/banners/admin", null, "admin");

  // 7. Coupon APIs
  const couponCode = "KUNTI50_" + Date.now().toString().slice(-4);
  await test("Create Coupon", "POST", "/api/coupons", { code: couponCode, discountPercent: 20, minOrderValue: 150 }, "admin");
  await test("Get All Coupons (Admin)", "GET", "/api/coupons", null, "admin");
  await test("Get Available Coupons (Customer)", "GET", "/api/coupons/available", null, "customer");

  // 8. Customer Address & Cart APIs
  const addrRes = await test("Create Customer Address", "POST", "/api/address", {
    address_type: "HOME",
    address_line1: "Flat 402, Green Enclave",
    address_line2: "Salt Lake Sector 5",
    city: "Kolkata",
    pincode: "700091",
    latitude: 22.5726,
    longitude: 88.3639,
  }, "customer");
  if (addrRes.body?.id) sampleAddressId = addrRes.body.id;
  else if (addrRes.body?.data?.id) sampleAddressId = addrRes.body.data.id;

  await test("Get Customer Addresses", "GET", "/api/address", null, "customer");

  if (sampleProductId) {
    await test("Add Product to Cart", "POST", "/api/cart/add", { product_id: sampleProductId, quantity: 2 }, "customer");
    await test("Get Cart", "GET", "/api/cart", null, "customer");
  }

  // 9. Rider APIs
  await test("Get Rider Profile", "GET", "/api/rider/profile", null, "rider");
  await test("Toggle Rider Status", "POST", "/api/rider/toggle-status", { is_available: true, latitude: 22.5726, longitude: 88.3639 }, "rider");
  await test("Get Available Orders for Rider", "GET", "/api/rider/available-orders", null, "rider");
  await test("Get Active Orders for Rider", "GET", "/api/rider/active-orders", null, "rider");
  await test("Get Rider Earnings", "GET", "/api/rider/earnings", null, "rider");
  await test("Get Rider Order History", "GET", "/api/rider/history", null, "rider");

  // 10. Admin Dashboard & Operations APIs
  await test("Get Admin Dashboard (Miss)", "GET", "/api/admin/dashboard", null, "admin");
  await test("Get Admin Dashboard (Hit)", "GET", "/api/admin/dashboard", null, "admin");
  await test("Get Admin Store Settings", "GET", "/api/admin/store-settings", null, "admin");
  await test("Get Admin Riders List", "GET", "/api/admin/riders", null, "admin");
  await test("Get Admin Customers List", "GET", "/api/admin/customers", null, "admin");
  await test("Get Admin Orders List", "GET", "/api/admin/orders", null, "admin");

  // Close server
  server.close();

  const totalPassed = results.filter((r) => r.passed).length;
  const avgLatency = (results.reduce((s, r) => s + r.durationMs, 0) / results.length).toFixed(2);
  const cacheHitTests = results.filter(r => r.name.includes("(Hit"));
  const avgHitLatency = cacheHitTests.length > 0
    ? (cacheHitTests.reduce((s, r) => s + r.durationMs, 0) / cacheHitTests.length).toFixed(2)
    : "N/A";

  console.log("\n===============================================================");
  console.log(`  BENCHMARK SUMMARY & TEST RESULTS: ${totalPassed} / ${results.length} PASSED`);
  console.log(`  Average Overall Latency: ${avgLatency} ms`);
  console.log(`  Average Cache-Hit Latency (L1/L2): ${avgHitLatency} ms ⚡`);
  console.log("===============================================================");
}

runTests();

