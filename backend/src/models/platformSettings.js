const FirebaseModel = require("./firebaseModel");
const redisClient = require("../config/redis");

const PlatformSettingsModel = new FirebaseModel("platform_settings", {
  key: {
    type: "string",
    required: true
  },
  value: {
    type: "string",
    required: true
  },
  type: {
    type: "string",
    required: false,
    default: "string"
  },
  description: {
    type: "string",
    required: false
  }
});

// Caching proxy wrapper for read-only setting lookups
const PlatformSettings = new Proxy(PlatformSettingsModel, {
  get(target, prop) {
    if (prop === "findOne") {
      return async (query) => {
        const keyVal = query?.where?.key;
        if (typeof keyVal === "string") {
          const cacheKey = `setting_${keyVal}`;
          try {
            const cached = await redisClient.get(cacheKey);
            if (cached) return JSON.parse(cached);
          } catch (_) {}

          const result = await target.findOne(query);
          if (result) {
            try {
              await redisClient.set(cacheKey, JSON.stringify(result), { EX: 3600 });
            } catch (_) {}
          }
          return result;
        }
        return target.findOne(query);
      };
    }

    if (prop === "findAll") {
      return async (query) => {
        const keyVal = query?.where?.key;
        if (Array.isArray(keyVal)) {
          const sortedKeys = [...keyVal].sort();
          const cacheKey = `settings_${sortedKeys.join("_")}`;
          try {
            const cached = await redisClient.get(cacheKey);
            if (cached) return JSON.parse(cached);
          } catch (_) {}

          const results = await target.findAll(query);
          try {
            await redisClient.set(cacheKey, JSON.stringify(results), { EX: 3600 });
          } catch (_) {}
          return results;
        }

        if (typeof keyVal === "string") {
          const cacheKey = `settings_${keyVal}`;
          try {
            const cached = await redisClient.get(cacheKey);
            if (cached) return JSON.parse(cached);
          } catch (_) {}

          const results = await target.findAll(query);
          try {
            await redisClient.set(cacheKey, JSON.stringify(results), { EX: 3600 });
          } catch (_) {}
          return results;
        }

        return target.findAll(query);
      };
    }

    // Invalidate caches on mutation
    if (prop === "create" || prop === "update" || prop === "destroy" || prop === "findOrCreate") {
      const originalMethod = target[prop];
      return async (...args) => {
        const result = await originalMethod.apply(target, args);
        try {
          for await (const key of redisClient.scanIterator({ MATCH: "setting*" })) {
            if (key.startsWith("setting_") || key.startsWith("settings_")) {
              await redisClient.del(key);
            }
          }
        } catch (_) {}
        return result;
      };
    }

    return target[prop];
  }
});

module.exports = PlatformSettings;
