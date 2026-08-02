const redis = require("redis");

const client = redis.createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 1) {
        return false; // Stop reconnecting if Redis is not available locally
      }
      return 500;
    },
    connectTimeout: 5000,
  }
});

let hasLoggedRedisError = false;

client.on("ready", () => {
  isRedisReady = true;
  console.log("Redis connected ✅");
});

client.on("error", (err) => {
  isRedisReady = false;
  if (!hasLoggedRedisError) {
    console.warn("Redis unavailable (running without Redis cache):", err.message);
    hasLoggedRedisError = true;
  }
});

client.on("end", () => {
  isRedisReady = false;
});

if (process.env.REDIS_URL || process.env.ENABLE_REDIS === "true") {
  client.connect().catch((err) => {
    if (!hasLoggedRedisError) {
      console.warn("Redis initial connect failed:", err.message);
      hasLoggedRedisError = true;
    }
  });
}

// Safe wrapper: returns null on failure instead of throwing
const safeClient = new Proxy(client, {
  get(target, prop) {
    const val = target[prop];
    if (typeof val !== "function") return val;

    // Handle scan iterators (like scanIterator, hScanIterator, zScanIterator, sScanIterator)
    // which return async iterables instead of promises
    if (typeof prop === "string" && prop.endsWith("Iterator")) {
      return (...args) => {
        if (!isRedisReady) {
          return (async function* () {})();
        }
        try {
          return val.apply(target, args);
        } catch (err) {
          console.warn(`Redis ${prop} initialization failed:`, err.message);
          return (async function* () {})();
        }
      };
    }

    // Wrap async redis commands to fail gracefully
    return async (...args) => {
      if (!isRedisReady) return null;
      try {
        return await val.apply(target, args);
      } catch (err) {
        console.warn(`Redis ${prop} failed:`, err.message);
        return null;
      }
    };
  }
});

module.exports = safeClient;