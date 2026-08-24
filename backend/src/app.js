require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
const hpp = require("hpp");
const crypto = require("crypto");

const authRoutes = require("./routes/authRoutes");
const protectedRoutes = require("./routes/protectedRoutes");
const roleTestRoutes = require("./routes/roleTestRoutes");
const adminRoutes = require("./routes/adminRoutes");
const riderRoutes = require("./routes/riderRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const addressRoutes = require("./routes/addressRoutes");
const { globalLimiter } = require("./middlewares/rateLimiter");
const orderRoutes = require("./routes/orderRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const cron = require("node-cron");
const platformRoutes = require("./routes/platformRoutes");
const compression = require("compression");

require("./models/user");
require("./models/rider");
require("./models/product");
require("./models/cart");
require("./models/cartItem");
require("./models");
require("./config/razorpay");
require("./models/platformSettings");
const bannerRoutes = require("./routes/bannerRoutes");
const app = express();
const paymentRoutes = require("./routes/paymentRoutes");

// ─── Static Files ────────────────────────────────────────────────────
app.use("/uploads", express.static("uploads"));
const distDirectory = path.join(__dirname, "../dist");
if (fs.existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
}

// ─── Webhook raw body (MUST be before express.json()) ────────────────
app.use("/api/payment/webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use("/api/webhook", express.raw({ type: "application/json", limit: "1mb" }));

// ─── Security Middleware ─────────────────────────────────────────────
app.set("trust proxy", 1);

const allowedOrigins = [
  "https://tind-admin.dropwinggroups.com",
  "https://tind.dropwinggroups.com",
  "http://kunti.dropwinggroups.com",
  "https://kunti.dropwinggroups.com"
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    // Always allow localhost and 127.0.0.1 origins (for dev and Flutter web test)
    if (origin.startsWith("http://localhost") || origin.startsWith("https://localhost") ||
        origin.startsWith("http://127.0.0.1") || origin.startsWith("https://127.0.0.1")) {
      return callback(null, true);
    }
    
    const normalizedOrigin = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(normalizedOrigin) || allowedOrigins.includes("*") || normalizedOrigin.includes("dropwinggroups.com")) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS: " + origin));
    }
  },
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: false,   // Disabled for API servers serving a SPA
  crossOriginEmbedderPolicy: false,
}));
app.use(hpp());                   // Prevent HTTP Parameter Pollution

// ─── Performance Middleware ──────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: "2mb" }));   // Prevent DoS via oversized payloads
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ─── Request ID Middleware ───────────────────────────────────────────
// Attaches a unique ID to each request for log correlation
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
});

// ─── Request Logging (dev) + Slow Request Detection (prod) ──────────
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
} else {
  // In production, only log slow requests (>2 seconds)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      if (duration > 2000) {
        console.warn(`⚠️  SLOW REQUEST [${req.id}] ${req.method} ${req.originalUrl} — ${duration}ms (${res.statusCode})`);
      }
    });
    next();
  });
}

// ─── Rate Limiting ───────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Health Check (no auth, no rate limit) ───────────────────────────
app.get("/api/health", (req, res) => {
  const { isFirebaseReady } = require("./config/firebase");
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    firebase: isFirebaseReady ? "connected" : "disconnected",
    memory: {
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    node_version: process.version,
  });
});

// ─── API Routes ──────────────────────────────────────────────────────
app.use("/api/banners", bannerRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", protectedRoutes);
app.use("/api/test", roleTestRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/rider", riderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/address", addressRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/platform", platformRoutes);
app.use("/api/upload", platformRoutes);
app.use("/api/wishlist", require("./routes/wishlistRoutes"));
app.use("/api/coupons", require("./routes/couponRoutes"));
app.use(require("./middlewares/errorHandler"));


const { sequelize } = require("./models");

const initDb = async () => {
  try {
    await sequelize.authenticate();
    console.log("SQL Database connected successfully ✅");

    // Sync database schema
    await sequelize.sync();

    // Ensure review columns exist for existing databases
    try {
      const queryInterface = sequelize.getQueryInterface();
      const tableInfo = await queryInterface.describeTable("reviews").catch(() => ({}));
      if (!tableInfo.master_order_id) {
        await queryInterface.addColumn("reviews", "master_order_id", {
          type: require("sequelize").DataTypes.UUID,
          allowNull: true,
        }).catch(() => {});
      }
      if (!tableInfo.admin_reply) {
        await queryInterface.addColumn("reviews", "admin_reply", {
          type: require("sequelize").DataTypes.TEXT,
          allowNull: true,
        }).catch(() => {});
      }
      if (!tableInfo.is_hidden) {
        await queryInterface.addColumn("reviews", "is_hidden", {
          type: require("sequelize").DataTypes.BOOLEAN,
          defaultValue: false,
        }).catch(() => {});
      }
    } catch (_) {}

    console.log("SQL Database schema synced ✅");

    // Seed default platform settings once on startup
    try {
      const { ensureDefaultSettings, DEFAULT_SETTINGS } = require("./controllers/platformController");
      await ensureDefaultSettings(DEFAULT_SETTINGS.map(s => s.key));
      console.log("Platform settings verified and seeded successfully ✅");
    } catch (settingsError) {
      console.error("Failed to seed default platform settings:", settingsError.message);
    }

    require("./jobs/autoCancelOrders");
    require("./jobs/stuckOrderRecovery");
  } catch (error) {
    console.error("SQL Database connection FAILED ❌", error.message);
  }
};

app.initDb = initDb;
if (process.env.NODE_ENV !== "test") {
  initDb();
}

app.use("/api/*", (req, res) => {
  res.status(404).json({ success: false, message: `API route not found: ${req.method} ${req.originalUrl}` });
});

app.get("*", (req, res, next) => {
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/uploads") ||
    req.path.startsWith("/db-test") ||
    req.path.startsWith("/test-firebase")
  ) {
    return next();
  }
  const distIndexPath = path.join(__dirname, "../dist", "index.html");
  if (fs.existsSync(distIndexPath)) {
    return res.sendFile(distIndexPath);
  }
  return res.json({
    status: "OK",
    service: "Kunti Backend API",
    timestamp: new Date().toISOString()
  });
});

// ─── Debug/Test Routes (dev only) ────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  app.get("/db-test", async (req, res) => {
    if (isFirebaseReady) {
      try {
        await firestore.collection("health-check").doc("status").set({
          last_checked: new Date(),
          status: "OK",
        });
        res.send("Firebase Firestore connected successfully ✅");
      } catch (err) {
        res.send("Firebase NOT connected ❌ " + err.message);
      }
    } else {
      res.send("Firebase NOT initialized ❌");
    }
  });

  const { db } = require("./config/firebase");

  app.get("/test-firebase", async (req, res) => {
    try {
      await db.ref("test").set({
        message: "Firebase connected 🚀"
      });

      res.send("Data sent to Firebase");
    } catch (err) {
      console.error(err);
      res.status(500).send(err.message);
    }
  });
}

module.exports = app;
