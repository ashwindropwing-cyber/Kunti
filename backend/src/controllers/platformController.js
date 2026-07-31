const { PlatformSettings, MasterOrder } = require("../models");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const redisClient = require("../config/redis");
const { invalidateCache } = require("../middlewares/responseCache");

// ─── DEFAULT SETTINGS ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = [
    {
        key: "max_delivery_radius_km",
        value: "5.0",
        type: "number",
        description: "Maximum delivery coverage radius for restaurant (in km)",
    },
    {
        key: "free_delivery_threshold",
        value: "299",
        type: "number",
        description: "Order amount above which delivery is free (in ₹)",
    },
    {
        key: "min_order_amount_customer",
        value: "99",
        type: "number",
        description: "Minimum order amount for customers (in ₹)",
    },
    {
        key: "delivery_fee_0_to_3km",
        value: "15",
        type: "number",
        description: "Customer delivery fee for 0-3km (in ₹)",
    },
    {
        key: "delivery_fee_3_to_5km",
        value: "25",
        type: "number",
        description: "Customer delivery fee for 3-5km (in ₹)",
    },
    {
        key: "shop_lat",
        value: "22.5726",
        type: "number",
        description: "Restaurant latitude",
    },
    {
        key: "shop_lng",
        value: "88.3639",
        type: "number",
        description: "Restaurant longitude",
    },
    {
        key: "shop_name",
        value: "Kunti Ke Ande Ka Funda",
        type: "string",
        description: "Restaurant name",
    },
    {
        key: "working_days",
        value: JSON.stringify([1, 2, 3, 4, 5, 6]),
        type: "json",
        description: "Working days as array of day indices (0=Sun, 1=Mon, ..., 6=Sat)",
    },
    {
        key: "working_hours_start",
        value: "09:00",
        type: "string",
        description: "Working hours start time (24h format)",
    },
    {
        key: "working_hours_end",
        value: "22:00",
        type: "string",
        description: "Working hours end time (24h format)",
    },
    {
        key: "gst_percentage",
        value: "5",
        type: "number",
        description: "GST percentage applied (in %)",
    },
];

const SETTINGS_REDIS_KEY = "platform_settings_map";

async function ensureDefaultSettings(keysToCheck) {
    const existing = await PlatformSettings.findAll();
    const existingMap = new Map();
    existing.forEach(s => {
        if (s && s.key) {
            existingMap.set(s.key, s);
        }
    });
    
    const missingSettings = [];

    for (const key of keysToCheck) {
        const def = DEFAULT_SETTINGS.find(d => d.key === key);
        if (!def) continue;

        const setting = existingMap.get(key);
        if (!setting) {
            missingSettings.push(def);
        }
    }

    if (missingSettings.length > 0) {
        await Promise.all(missingSettings.map(s => PlatformSettings.create(s)));
        return await PlatformSettings.findAll();
    }
    return existing;
}

// Clear Redis and In-Memory caches when admin updates settings
async function clearPlatformSettingsCache() {
    try {
        await redisClient.del(SETTINGS_REDIS_KEY);
    } catch (err) {
        console.warn("Redis setting cache clear warning:", err.message);
    }
    invalidateCache("/api/platform");
    invalidateCache("/api/cart");
    invalidateCache("/api/order");
    console.log("⚡ Platform settings Redis & Memory caches invalidated!");
}

// Get setting map with Redis cache fallback
async function getPlatformSettingsMap() {
    try {
        const cached = await redisClient.get(SETTINGS_REDIS_KEY);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (err) {
        console.warn("Redis get settings warning:", err.message);
    }

    const settings = await ensureDefaultSettings(DEFAULT_SETTINGS.map(s => s.key));
    const map = {};
    for (const s of settings) {
        let val = s.value;
        if (s.type === "number") val = parseFloat(s.value);
        else if (s.type === "boolean") val = s.value === "true";
        else if (s.type === "json") {
            try { val = JSON.parse(s.value); } catch { val = s.value; }
        }
        map[s.key] = val;
    }

    try {
        await redisClient.set(SETTINGS_REDIS_KEY, JSON.stringify(map), { EX: 86400 });
    } catch (err) {
        console.warn("Redis set settings warning:", err.message);
    }

    return map;
}

// ─── GET PUBLIC SETTINGS (APP & WEB) ──────────────────────────────────────────
exports.getPublicSettings = asyncHandler(async (req, res) => {
    const settingsMap = await getPlatformSettingsMap();
    return ApiResponse.success(res, settingsMap);
});

// ─── GET ALL PLATFORM SETTINGS (ADMIN) ─────────────────────────────────────────
exports.getAllSettings = asyncHandler(async (req, res) => {
    const settingsMap = await getPlatformSettingsMap();
    const rawSettings = await PlatformSettings.findAll();
    rawSettings.sort((a, b) => a.key.localeCompare(b.key));

    return ApiResponse.success(res, { settings: settingsMap, raw: rawSettings });
});

// ─── UPDATE A SINGLE SETTING (ADMIN) ───────────────────────────────────────────
exports.updateSetting = asyncHandler(async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
        return ApiResponse.error(res, "value is required", 400);
    }

    let strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    const def = DEFAULT_SETTINGS.find((d) => d.key === key);
    const type = def ? def.type : (typeof value === "boolean" ? "boolean" : (isNaN(value) ? "string" : "number"));

    // Atomic upsert — avoids race condition from destroy+create
    await PlatformSettings.upsert({
        key,
        value: strValue,
        type,
        description: def ? def.description : "",
    });

    // Invalidate Redis and Memory Caches Instantly
    await clearPlatformSettingsCache();

    return ApiResponse.success(res, { key, value }, `Setting '${key}' updated successfully`);
});

// ─── BULK UPDATE SETTINGS (ADMIN) ─────────────────────────────────────────────
exports.bulkUpdateSettings = asyncHandler(async (req, res) => {
    const { settings } = req.body;

    if (!settings || typeof settings !== "object") {
        return ApiResponse.error(res, "settings object is required", 400);
    }

    const updates = [];
    for (const [key, value] of Object.entries(settings)) {
        let strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
        const def = DEFAULT_SETTINGS.find((d) => d.key === key);
        const type = def ? def.type : (typeof value === "boolean" ? "boolean" : (isNaN(value) ? "string" : "number"));

        // Atomic upsert — avoids race condition from destroy+create
        await PlatformSettings.upsert({
            key,
            value: strValue,
            type,
            description: def ? def.description : "",
        });

        updates.push({ key, value: strValue });
    }

    // Invalidate Redis and Memory Caches Instantly — delivery fee updates reflect immediately
    await clearPlatformSettingsCache();

    return ApiResponse.success(res, updates, "Settings updated successfully");
});

// ─── PAYMENT REPORTS (ADMIN) ─────────────────────────────────────────────────
exports.getPaymentReport = asyncHandler(async (req, res) => {
    const orders = await MasterOrder.findAll({
        where: { payment_status: "PAID" },
        attributes: ["id", "order_number", "total_amount", "payment_method", "createdAt"]
    });

    const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

    return ApiResponse.success(res, {
        total_orders: orders.length,
        total_revenue: totalRevenue,
        orders
    });
});

// ─── GENERIC IMAGE UPLOAD ─────────────────────────────────────────────────────
exports.uploadImage = asyncHandler(async (req, res) => {
    const file = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    if (!file) {
        return ApiResponse.error(res, "No file uploaded", 400);
    }
    const fileUrl = file.filename ? `/uploads/${file.filename}` : (file.path || "");
    return ApiResponse.success(res, { url: fileUrl, imageUrl: fileUrl }, "Image uploaded successfully");
});

exports.getPlatformSettingsMap = getPlatformSettingsMap;
exports.ensureDefaultSettings = ensureDefaultSettings;
exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
