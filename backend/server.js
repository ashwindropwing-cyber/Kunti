require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

// 🪵 Global Process Error Loggers for deployment troubleshooting
process.on("uncaughtException", (err) => {
  console.error("🔥 FATAL ERROR: Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 FATAL ERROR: Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

const app = require("./src/app");
const http = require("http");

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// ─── Production Timeouts ────────────────────────────────────────────
// Prevents 502 errors behind reverse proxies (Nginx, Hostinger LiteSpeed)
server.keepAliveTimeout = 65000;   // Must be > proxy's keep-alive (usually 60s)
server.headersTimeout = 66000;     // Must be > keepAliveTimeout



server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────
// Ensures in-flight requests complete and connections close cleanly on deploy
function gracefulShutdown(signal) {
  console.log(`\n⚡ ${signal} received. Shutting down gracefully...`);

  server.close(() => {
    console.log("✅ HTTP server closed");



    // Close Redis
    try {
      const redisClient = require("./src/config/redis");
      if (redisClient && typeof redisClient.quit === "function") {
        redisClient.quit().then(() => console.log("✅ Redis disconnected"));
      }
    } catch (_) { /* Redis may not be connected */ }

    // Give pending operations 5s to finish, then force exit
    setTimeout(() => {
      console.log("⚠️  Forcing exit after timeout");
      process.exit(0);
    }, 5000).unref();
  });

  // If server.close() hangs, force exit after 10s
  setTimeout(() => {
    console.error("❌ Forceful shutdown after 10s timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
