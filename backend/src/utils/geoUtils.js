const axios = require("axios");
const redisClient = require("../config/redis");
const memoryCache = new Map();

function getMemory(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setMemory(key, value, durationMs = 5 * 60 * 1000) {
  memoryCache.set(key, {
    value,
    expiry: Date.now() + durationMs
  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth radius in KM

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function calculateRoadDistance(lat1, lon1, lat2, lon2, options = {}) {
  const { addressId, sellerId } = options;

  // ── GPS Quantization / coordinate key ──
  const qLat1 = parseFloat(lat1).toFixed(3);
  const qLon1 = parseFloat(lon1).toFixed(3);
  const qLat2 = parseFloat(lat2).toFixed(3);
  const qLon2 = parseFloat(lon2).toFixed(3);
  const coordKey = `road_dist:coords_${qLat1}_${qLon1}|${qLat2}_${qLon2}`;

  // ── Address-specific key ──
  const addrKey = addressId && sellerId ? `road_dist:addr_${addressId}|rest_${sellerId}` : null;

  // 1. Check Node Memory Cache
  if (addrKey) {
    const cached = getMemory(addrKey);
    if (cached !== null) {
      console.log(`⚡ [Memory Cache] Hit for address key: ${addrKey} -> ${cached} km`);
      return cached;
    }
  }
  const cachedCoordMem = getMemory(coordKey);
  if (cachedCoordMem !== null) {
    console.log(`⚡ [Memory Cache] Hit for coords key: ${coordKey} -> ${cachedCoordMem} km`);
    if (addrKey) {
      setMemory(addrKey, cachedCoordMem);
    }
    return cachedCoordMem;
  }

  // 2. Check Redis Cache
  if (addrKey) {
    try {
      const cached = await redisClient.get(addrKey);
      if (cached !== null) {
        const val = parseFloat(cached);
        console.log(`⚡ [Redis Cache] Hit for address key: ${addrKey} -> ${val} km`);
        setMemory(addrKey, val);
        setMemory(coordKey, val);
        return val;
      }
    } catch (err) {
      console.warn("Redis error on addrKey check:", err.message);
    }
  }
  try {
    const cached = await redisClient.get(coordKey);
    if (cached !== null) {
      const val = parseFloat(cached);
      console.log(`⚡ [Redis Cache] Hit for coords key: ${coordKey} -> ${val} km`);
      setMemory(coordKey, val);
      if (addrKey) {
        setMemory(addrKey, val);
        await redisClient.set(addrKey, val, { EX: 30 * 24 * 3600 });
      }
      return val;
    }
  } catch (err) {
    console.warn("Redis error on coordKey check:", err.message);
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ GOOGLE_MAPS_API_KEY is not set. Falling back to Haversine * 1.3.");
    return calculateDistance(lat1, lon1, lat2, lon2) * 1.3;
  }

  try {
    const response = await axios.post(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        origin: {
          location: {
            latLng: {
              latitude: parseFloat(lat1),
              longitude: parseFloat(lon1)
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: parseFloat(lat2),
              longitude: parseFloat(lon2)
            }
          }
        },
        travelMode: "TWO_WHEELER",
        routingPreference: "TRAFFIC_AWARE"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters"
        },
        timeout: 5000
      }
    );

    const distanceMeters = response.data?.routes?.[0]?.distanceMeters;
    if (typeof distanceMeters === "number") {
      const distanceKm = distanceMeters / 1000;
      console.log(`🚗 [Google Routes API] Calculated road distance: ${distanceKm.toFixed(2)} km`);

      // Write to Node Memory
      setMemory(coordKey, distanceKm);
      if (addrKey) {
        setMemory(addrKey, distanceKm);
      }

      // Write to Redis (30 days expiration)
      try {
        await redisClient.set(coordKey, distanceKm, { EX: 30 * 24 * 3600 });
        if (addrKey) {
          await redisClient.set(addrKey, distanceKm, { EX: 30 * 24 * 3600 });
        }
      } catch (redisErr) {
        console.warn("Failed to write to Redis:", redisErr.message);
      }

      return distanceKm;
    }

    console.warn("⚠️ Google Routes API response invalid. Falling back to Haversine * 1.3.");
    return calculateDistance(lat1, lon1, lat2, lon2) * 1.3;
  } catch (error) {
    console.error("❌ Google Routes API request failed:", error.message || error);
    return calculateDistance(lat1, lon1, lat2, lon2) * 1.3;
  }
}

module.exports = { calculateDistance, calculateRoadDistance };

