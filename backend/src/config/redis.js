const redis = require("redis");

const client = redis.createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error("Redis: max reconnect attempts reached. Giving up.");
        return new Error("Max reconnect attempts reached");
      }
      return Math.min(retries * 200, 3000);
    },
    connectTimeout: 5000,
  }
});

let isRedisReady = false;

client.on("ready", () => {
  isRedisReady = true;
  console.log("Redis connected ✅");
});

client.on("error", (err) => {
  isRedisReady = false;
  console.error("Redis error:", err.message);
});

client.on("end", () => {
  isRedisReady = false;
  console.warn("Redis connection closed");
});

client.connect().catch((err) => {
  console.error("Redis initial connect failed:", err.message);
});

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