/**
 * In-memory response cache middleware.
 * 
 * Caches GET responses for a configurable TTL (time-to-live) to avoid
 * hitting the database on every polling request. This is a lightweight
 * alternative to Redis caching for endpoints that tolerate slightly stale data.
 * 
 * Usage:
 *   const { cacheFor } = require('../middlewares/responseCache');
 *   router.get('/heavy-endpoint', cacheFor(30), controller.handler);
 *   // ↑ caches the response for 30 seconds
 */

const cache = new Map();
const MAX_CACHE_SIZE = 1000; // Prevent unbounded memory growth

// Evict expired entries every 2 minutes, and enforce size limit
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
  // If still over limit after expiry eviction, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const excess = cache.size - MAX_CACHE_SIZE;
    const keys = cache.keys();
    for (let i = 0; i < excess; i++) {
      cache.delete(keys.next().value);
    }
  }
}, 120_000);

/**
 * Create a caching middleware with a given TTL.
 * Cache key = method + originalUrl + user role (admin vs user-specific).
 * 
 * @param {number} ttlSeconds - How long to cache the response in seconds
 * @param {object} options
 * @param {boolean} options.perUser - If true, cache per-user. If false, cache globally per-role.
 * @returns Express middleware
 */
function cacheFor(ttlSeconds, options = {}) {
  const { perUser = false } = options;

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    // Build cache key
    const userKey = perUser
      ? req.user?.id || 'anon'
      : req.user?.role || 'public';
    const cacheKey = `${req.method}:${req.originalUrl}:${userKey}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.set('X-Cache', 'HIT');
      res.set('X-Cache-TTL', String(Math.ceil((cached.expiresAt - Date.now()) / 1000)));
      return res.status(cached.statusCode).json(cached.body);
    }

    // Intercept res.json() to capture the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(cacheKey, {
          body,
          statusCode: res.statusCode,
          expiresAt: Date.now() + (ttlSeconds * 1000),
        });
      }
      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

/**
 * Manually invalidate cache entries matching a URL pattern.
 * Useful when a write operation should bust related caches.
 * 
 * @param {string} urlPattern - String that the cached URL must include
 */
function invalidateCache(urlPattern) {
  for (const [key] of cache) {
    if (key.includes(urlPattern)) {
      cache.delete(key);
    }
  }
}

/**
 * Middleware to explicitly disable HTTP caching.
 * Useful to bypass aggressive CDN/Server caches (like Hostinger LiteSpeed).
 */
function noCache(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
}

module.exports = { cacheFor, invalidateCache, noCache };
