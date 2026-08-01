process.env.NODE_ENV = "test";
require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const { User, Rider, Category, Product, Banner, Coupon, MasterOrder, sequelize } = require("./src/models");
const bcrypt = require("bcryptjs");

const PORT = 5001; // Separate test port

let server;
let adminToken = "";
let riderToken = "";

// Helper to make HTTP requests
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

async function runTests() {
  console.log("==========================================");
  console.log("  KUNTI BACKEND API COMPREHENSIVE TEST   ");
  console.log("==========================================");

  // Initialize DB sequentially
  try {
    await app.initDb();
    console.log("✅ Database initialized successfully.");
  } catch (err) {
    console.error("⚠️ DB init notice:", err.message);
  }

  // Seed essential accounts for testing if missing
  const hashedPassword = await bcrypt.hash("admin123", 10);

  const [adminUser] = await User.findOrCreate({
    where: { phone: "9999999999" },
    defaults: { name: "Test Admin", email: "admin@kunti.com", password: hashedPassword, role: "ADMIN" }
  });

  const [riderUser] = await User.findOrCreate({
    where: { phone: "8800000000" },
    defaults: { name: "Test Rider", email: "rider@kunti.com", password: hashedPassword, role: "RIDER" }
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

    const res = await makeRequest(method, path, body, token);
    const passed = res.statusCode >= 200 && res.statusCode < 400;
    results.push({ name, method, path, status: res.statusCode, passed, response: res.body });
    const icon = passed ? "✅" : "❌";
    console.log(`${icon} [${res.statusCode}] ${method} ${path} - ${name}`);
    if (!passed) {
      console.log("   --> Error Body:", JSON.stringify(res.body));
    }
  }

  // 1. Health Check
  await test("Health Check", "GET", "/api/health");

  // 2. Auth APIs
  await test("Send OTP", "POST", "/api/auth/send-otp", { phone: "9999999999" });
  await test("Verify OTP", "POST", "/api/auth/verify-otp", { phone: "9999999999", otp: "123456" });

  // Admin Login to get Token
  const adminLoginRes = await makeRequest("POST", "/api/auth/admin/login", { email: "admin@kunti.com", password: "admin123" });
  if (adminLoginRes.body && adminLoginRes.body.token) {
    adminToken = adminLoginRes.body.token;
    console.log("🔑 Admin Token obtained.");
  } else if (adminLoginRes.body && adminLoginRes.body.data && adminLoginRes.body.data.token) {
    adminToken = adminLoginRes.body.data.token;
    console.log("🔑 Admin Token obtained.");
  }

  // Rider Login to get Token
  await makeRequest("POST", "/api/auth/send-otp", { phone: "8800000000" });
  const riderLoginRes = await makeRequest("POST", "/api/auth/verify-otp", { phone: "8800000000", otp: "123456", role: "RIDER" });
  if (riderLoginRes.body && riderLoginRes.body.token) {
    riderToken = riderLoginRes.body.token;
    console.log("🔑 Rider Token obtained.");
  } else if (riderLoginRes.body && riderLoginRes.body.data && riderLoginRes.body.data.token) {
    riderToken = riderLoginRes.body.data.token;
    console.log("🔑 Rider Token obtained.");
  }

  // 3. Category APIs
  await test("Get Categories", "GET", "/api/categories");
  await test("Create Category", "POST", "/api/categories", { name: "Test Category", banner_image: "https://via.placeholder.com/150" }, "admin");

  // 4. Product APIs
  await test("Get Products", "GET", "/api/products");

  // 5. Banner APIs
  await test("Get Banners", "GET", "/api/banners");
  await test("Create Banner", "POST", "/api/banners", { title: "Test Banner", image_url: "https://via.placeholder.com/300" }, "admin");

  // 6. Coupon APIs
  await test("Get Coupons", "GET", "/api/coupons", null, "admin");
  await test("Create Coupon", "POST", "/api/coupons", { code: "TEST50_" + Date.now(), discountPercent: 50, minOrderValue: 100 }, "admin");

  // 7. Rider APIs
  await test("Get Rider Profile", "GET", "/api/rider/profile", null, "rider");
  await test("Toggle Rider Status", "POST", "/api/rider/toggle-status", { is_available: true, latitude: 12.9716, longitude: 77.5946 }, "rider");
  await test("Get Available Orders for Rider", "GET", "/api/rider/available-orders", null, "rider");
  await test("Get Active Orders for Rider", "GET", "/api/rider/active-orders", null, "rider");
  await test("Get Rider Earnings", "GET", "/api/rider/earnings", null, "rider");
  await test("Get Rider Order History", "GET", "/api/rider/history", null, "rider");

  // 8. Admin APIs
  await test("Get Admin Dashboard", "GET", "/api/admin/dashboard", null, "admin");
  await test("Get Admin Store Settings", "GET", "/api/admin/store-settings", null, "admin");
  await test("Get Admin Riders List", "GET", "/api/admin/riders", null, "admin");
  await test("Get Admin Customers List", "GET", "/api/admin/customers", null, "admin");
  await test("Get Admin Orders List", "GET", "/api/admin/orders", null, "admin");

  // Close server
  server.close();

  const totalPassed = results.filter((r) => r.passed).length;
  console.log("\n==========================================");
  console.log(`  TEST RESULTS: ${totalPassed} / ${results.length} PASSED`);
  console.log("==========================================");
}

runTests();
