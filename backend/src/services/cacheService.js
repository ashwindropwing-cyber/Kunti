const NodeCache = require("node-cache");
const redisClient = require("../config/redis");

/**
 * High-Performance Two-Tier Hybrid Cache Service
 * 
 * L1: Super-fast in-memory cache (<0.5ms latency)
 * L2: Redis cache (distributed across nodes)
 * 
 * Features:
 * - Cache-Aside pattern (wrap)
 * - Wildcard prefix key invalidation
 * - Transparent fallback if Redis is unavailable
 * - Automatic deserialization / serialization
 */

// L1 Memory Cache (Default stdTTL: 300s = 5 mins, checkperiod: 60s, max 2000 items)
const l1Cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  useClones: false, // Performance optimization: avoid deep cloning
  maxKeys: 2000,
});

class CacheService {
  /**
   * Get value from cache (L1 Memory -> L2 Redis)
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    if (!key) return null;

    // 1. Check L1 Memory Cache (fastest: ~0.1ms)
    const l1Value = l1Cache.get(key);
    if (l1Value !== undefined) {
      return l1Value;
    }

    // 2. Check L2 Redis Cache
    try {
      const redisVal = await redisClient.get(key);
      if (redisVal !== null && redisVal !== undefined) {
        let parsed;
        try {
          parsed = JSON.parse(redisVal);
        } catch {
          parsed = redisVal;
        }
        // Backfill L1 Cache with remaining default TTL (60s)
        l1Cache.set(key, parsed, 60);
        return parsed;
      }
    } catch (err) {
      // Graceful fallback: Redis error does not fail the request
    }

    return null;
  }

  /**
   * Set value in both L1 Memory and L2 Redis
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlSeconds=300]
   */
  async set(key, value, ttlSeconds = 300) {
    if (!key || value === undefined) return;

    // 1. Set L1 Memory Cache
    try {
      l1Cache.set(key, value, ttlSeconds);
    } catch (_) {}

    // 2. Set L2 Redis Cache
    try {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      await redisClient.set(key, serialized, { EX: ttlSeconds });
    } catch (err) {
      // Graceful fallback
    }
  }

  /**
   * Delete a key from both L1 and L2
   * @param {string} key
   */
  async del(key) {
    if (!key) return;

    // 1. Del L1
    l1Cache.del(key);

    // 2. Del L2
    try {
      await redisClient.del(key);
    } catch (_) {}
  }

  /**
   * Delete all keys matching a prefix or wildcard pattern (e.g. "products:*", "categories*")
   * @param {string} pattern
   */
  async delPattern(pattern) {
    if (!pattern) return;

    const regexPattern = new RegExp("^" + pattern.replace(/\*/g, ".*"));

    // 1. Clear matching keys from L1
    const l1Keys = l1Cache.keys();
    for (const key of l1Keys) {
      if (regexPattern.test(key)) {
        l1Cache.del(key);
      }
    }

    // 2. Clear matching keys from Redis
    try {
      const matchPattern = pattern.endsWith("*") ? pattern : `${pattern}*`;
      if (typeof redisClient.scanIterator === "function") {
        for await (const scanned of redisClient.scanIterator({ MATCH: matchPattern })) {
          const keys = Array.isArray(scanned) ? scanned : [scanned];
          for (const k of keys) {
            if (k) await redisClient.del(k);
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Cache-Aside Helper: Returns cached data or computes it using fetchFn, then caches it.
   * @param {string} key
   * @param {number} ttlSeconds
   * @param {() => Promise<any>} fetchFn
   * @returns {Promise<any>}
   */
  async wrap(key, ttlSeconds, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const freshData = await fetchFn();
    if (freshData !== null && freshData !== undefined) {
      await this.set(key, freshData, ttlSeconds);
    }
    return freshData;
  }

  /**
   * Flush all caches
   */
  async flush() {
    l1Cache.flushAll();
    try {
      await redisClient.flushAll();
    } catch (_) {}
  }

  /**
   * Get cache health / stats
   */
  getStats() {
    return {
      l1_keys: l1Cache.keys().length,
      l1_stats: l1Cache.getStats(),
      redis_ready: redisClient.isReady || false,
    };
  }
}

module.exports = new CacheService();
