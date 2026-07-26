const { PlatformSettings, RiderDocument, Rider, User, MasterOrder, OrderItem } = require("../models");

const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const path = require("path");
const fs = require("fs");
const { chunkedFindAll } = require("../utils/dbHelper");

// ─── DEFAULT SETTINGS ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = [
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
        value: "12",
        type: "number",
        description: "Customer delivery fee for 0-3km (in ₹)",
    },
    {
        key: "delivery_fee_3_to_5km",
        value: "18",
        type: "number",
        description: "Customer delivery fee for 3-5km (in ₹)",
    },
    {
        key: "rider_fee_0_to_3km",
        value: "12",
        type: "number",
        description: "Rider earning for 0-3km (in ₹)",
    },
    {
        key: "rider_fee_3_to_5km",
        value: "18",
        type: "number",
        description: "Rider earning for 3-5km (in ₹)",
    },
    {
        key: "rider_order_request_timeout",
        value: "30",
        type: "number",
        description: "Time given to a rider to accept an order before it is passed to the next rider (in seconds)",
    },
    {
        key: "shop_lat",
        value: "0.0",
        type: "number",
        description: "Central shop latitude",
    },
    {
        key: "shop_lng",
        value: "0.0",
        type: "number",
        description: "Central shop longitude",
    },
    {
        key: "shop_name",
        value: "Tind Store",
        type: "string",
        description: "Central shop name",
    },
    {
        key: "working_days",
        value: JSON.stringify([1, 2, 3, 4, 5, 6]), // Mon–Sat (0=Sun)
        type: "json",
        description: "Working days as array of day indices (0=Sun, 1=Mon, ..., 6=Sat)",
    },
    {
        key: "working_hours_start",
        value: "09:00",
        type: "string",
        description: "Store opening time (HH:MM 24h)",
    },
    {
        key: "working_hours_end",
        value: "22:00",
        type: "string",
        description: "Store closing time (HH:MM 24h)",
    },
    {
        key: "replacement_enabled",
        value: "true",
        type: "boolean",
        description: "Whether order replacement/return system is enabled platform-wide",
    },
    {
        key: "replacement_window_hours",
        value: "24",
        type: "number",
        description: "Hours after delivery within which replacement can be requested",
    },
    {
        key: "platform_commission_percentage",
        value: "7",
        type: "number",
        description: "Platform commission percentage on order total (in %)",
    },
    {
        key: "gst_percentage",
        value: "18",
        type: "number",
        description: "GST percentage applied (in %)",
    },
    {
        key: "min_withdrawal_amount",
        value: "500",
        type: "number",
        description: "Minimum balance required for a withdrawal request (in ₹)",
    },
    {
        key: "max_rider_radius_km",
        value: "5",
        type: "number",
        description: "Maximum delivery radius allowed for riders (in KM)",
    },

    {
        key: "platform_name",
        value: "TIND",
        type: "string",
        description: "Platform display name",
    },
];

async function ensureDefaultSettings(keysToCheck) {
    const existing = await PlatformSettings.findAll();
    const existingMap = new Map();
    existing.forEach(s => {
        if (s && s.key) {
            existingMap.set(s.key, s);
        }
    });
    
    const missingSettings = [];
    const updates = [];

    for (const key of keysToCheck) {
        const def = DEFAULT_SETTINGS.find(d => d.key === key);
        if (!def) continue;

        const setting = existingMap.get(key);
        if (!setting) {
            missingSettings.push(def);
        } else if (key === "max_rider_radius_km" && setting.value === "10") {
            setting.value = "5";
            updates.push(setting);
        }
    }

    if (missingSettings.length > 0) {
        await Promise.all(missingSettings.map(s => PlatformSettings.create(s)));
    }

    if (updates.length > 0) {
        await Promise.all(updates.map(s => s.save()));
    }

    if (missingSettings.length > 0 || updates.length > 0) {
        return await PlatformSettings.findAll();
    }
    return existing;
}

// ─── GET ALL PLATFORM SETTINGS ───────────────────────────────────────────────
exports.getAllSettings = asyncHandler(async (req, res) => {
    const settings = await ensureDefaultSettings(DEFAULT_SETTINGS.map(s => s.key));
    settings.sort((a, b) => a.key.localeCompare(b.key));

    // Parse typed values
    const parsed = settings.reduce((acc, s) => {
        let val = s.value;
        if (s.type === "number") val = parseFloat(s.value);
        else if (s.type === "boolean") val = s.value === "true";
        else if (s.type === "json") {
            try { val = JSON.parse(s.value); } catch { val = s.value; }
        }
        acc[s.key] = { value: val, description: s.description, type: s.type };
        return acc;
    }, {});

    return ApiResponse.success(res, { settings: parsed, raw: settings });
});

// ─── UPDATE A SINGLE SETTING ─────────────────────────────────────────────────
exports.updateSetting = asyncHandler(async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
        return ApiResponse.error(res, "value is required", 400);
    }

    let strValue = value;
    if (typeof value === "object") strValue = JSON.stringify(value);
    else strValue = String(value);

    const existingSettings = await PlatformSettings.findAll({ where: { key } });
    for (const setting of existingSettings) {
        await PlatformSettings.destroy({ where: { id: setting.id } });
    }
    
    // Check if there is a default to inherit type and description
    const def = DEFAULT_SETTINGS.find((d) => d.key === key);
    await PlatformSettings.create({ 
        key, 
        value: strValue,
        type: def ? def.type : (typeof value === "boolean" ? "boolean" : (isNaN(value) ? "string" : "number")),
        description: def ? def.description : ""
    });

    return ApiResponse.success(res, { key, value }, "Setting updated successfully");
});

// ─── BULK UPDATE SETTINGS ─────────────────────────────────────────────────────
exports.bulkUpdateSettings = asyncHandler(async (req, res) => {
    const { settings } = req.body; // { key: value, ... }

    if (!settings || typeof settings !== "object") {
        return ApiResponse.error(res, "settings object is required", 400);
    }

    const updates = [];
    for (const [key, value] of Object.entries(settings)) {
        let strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
        
        const existingSettings = await PlatformSettings.findAll({ where: { key } });
        for (const setting of existingSettings) {
            await PlatformSettings.destroy({ where: { id: setting.id } });
        }
        
        const def = DEFAULT_SETTINGS.find((d) => d.key === key);
        await PlatformSettings.create({ 
            key, 
            value: strValue,
            type: def ? def.type : (typeof value === "boolean" ? "boolean" : (isNaN(value) ? "string" : "number")),
            description: def ? def.description : ""
        });
        
        updates.push({ key, value: strValue });
    }

    return ApiResponse.success(res, updates, "Settings updated successfully");
});



// ─── RIDER DOCUMENT VERIFICATION ─────────────────────────────────────────────
exports.getRiderDocuments = asyncHandler(async (req, res) => {
    const docs = await RiderDocument.findAll({
        order: [["createdAt", "DESC"]],
    });

    const riderIds = docs.map(d => d.rider_id).filter(Boolean);
    const riders = await chunkedFindAll(Rider, "id", riderIds);
    const riderMap = riders.reduce((m, r) => { m[r.id] = r; return m; }, {});

    const userIds = riders.map(r => r.user_id).filter(Boolean);
    const users = await chunkedFindAll(User, "id", userIds);
    const userMap = users.reduce((m, u) => { m[u.id] = u; return m; }, {});

    const formattedDocs = docs.map((doc) => {
        const docObj = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
        const rider = riderMap[doc.rider_id];
        let riderObj = null;
        if (rider) {
            const rawRider = typeof rider.toJSON === 'function' ? rider.toJSON() : { ...rider };
            const user = userMap[rider.user_id];
            riderObj = {
                ...rawRider,
                User: user ? { name: user.name, phone: user.phone } : null
            };
        }
        return {
            ...docObj,
            Rider: riderObj
        };
    });

    return ApiResponse.success(res, formattedDocs);
});


exports.getRiderDocumentsByRiderId = asyncHandler(async (req, res) => {
    const { riderId } = req.params;
    const docs = await RiderDocument.findAll({
        where: { rider_id: riderId },
        order: [["document_type", "ASC"]],
    });
    return ApiResponse.success(res, docs);
});

exports.verifyRiderDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    if (!["APPROVED", "REJECTED"].includes(status)) {
        return ApiResponse.error(res, "status must be APPROVED or REJECTED", 400);
    }

    const doc = await RiderDocument.findByPk(id);
    if (!doc) return ApiResponse.error(res, "Document not found", 404);

    doc.status = status;
    doc.rejection_reason = rejection_reason || null;
    doc.verified_at = status === "APPROVED" ? new Date() : null;
    await doc.save();

    // Fetch the rider to send FCM notification and update verification status
    const rider = await Rider.findByPk(doc.rider_id);
    if (rider) {
        // Automatically verify or unverify rider based on the KYC document approval status
        rider.is_verified = (status === "APPROVED");
        if (status === "REJECTED") {
            rider.is_available = false; // Set offline if rejected
        }

        // Store notification inside database array as a fallback/inbox (GCM/General Messages)
        if (!rider.notifications) rider.notifications = [];
        rider.notifications.push({
            title: `KYC Document ${status === "APPROVED" ? "Approved" : "Rejected"}`,
            body: `Your ${doc.document_type} verification has been ${status.toLowerCase()}.${status === "REJECTED" ? " Reason: " + (rejection_reason || "Not specified") : ""}`,
            type: `DOCUMENT_VERIFICATION_${status}`,
            reason: rejection_reason || "Not specified",
            time: new Date().toISOString()
        });

        await rider.save();
        console.log(`[KYC Auto-Verify] Automatically updated rider ${rider.id} is_verified status to: ${rider.is_verified}`);

        if (rider.fcm_token) {
            try {
                const { admin } = require("../config/firebase");
                const payload = {
                    token: rider.fcm_token,
                    notification: {
                        title: `KYC Document ${status === "APPROVED" ? "Approved" : "Rejected"}`,
                        body: `Your ${doc.document_type} verification has been ${status.toLowerCase()}.${status === "REJECTED" ? " Reason: " + (rejection_reason || "Not specified") : ""}`
                    },
                    data: {
                        type: `DOCUMENT_VERIFICATION_${status}`,
                        reason: rejection_reason || "Not specified",
                        document_type: doc.document_type
                    }
                };
                await admin.messaging().send(payload);
                console.log(`[FCM] KYC document verification notification sent to rider ${rider.id}`);
            } catch (err) {
                console.error("Failed to send KYC FCM to rider:", err.message);
            }
        }
    }

    return ApiResponse.success(res, doc, `Document ${status.toLowerCase()} successfully`);
});

// ─── PAYMENT REPORTS ─────────────────────────────────────────────────────────
exports.getPaymentReport = asyncHandler(async (req, res) => {
    const { from, to } = req.query;

    const where = { status: "DELIVERED" };

    if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) {
            const endDate = new Date(to);
            endDate.setHours(23, 59, 59, 999);
            where.createdAt.lte = endDate;
        }
    }

    const ordersRaw = await MasterOrder.findAll({
        where,
        order: [["createdAt", "DESC"]],
    });

    const customerIds = ordersRaw.map(o => o.customer_id).filter(Boolean);

    const customers = await chunkedFindAll(User, "id", customerIds);
    const customerMap = customers.reduce((m, u) => { m[u.id] = u; return m; }, {});

    const orders = ordersRaw.map((o) => {
        try {
            const orderObj = typeof o.toJSON === 'function' ? o.toJSON() : { ...o };
            const customer = customerMap[o.customer_id];

            const toISO = (v) => {
                if (!v) return null;
                if (typeof v.toDate === 'function') return v.toDate().toISOString();
                if (v instanceof Date) return v.toISOString();
                return String(v);
            };

            return {
                ...orderObj,
                createdAt: toISO(o.createdAt),
                Customer: customer ? { name: customer.name, phone: customer.phone } : null,
            };
        } catch (err) {
            console.error(`[getPaymentReport] Error populating order ${o.id}:`, err.message);
            const orderObj = typeof o.toJSON === 'function' ? o.toJSON() : { ...o };
            return {
                ...orderObj,
                Customer: null,
                error: "Population failed"
            };
        }
    });

    const toNum = (v) => parseFloat(v) || 0;

    // Summary calculations
    const totalRevenue = orders.reduce((s, o) => s + toNum(o.total_amount), 0);
    const totalDeliveryFees = orders.reduce((s, o) => s + toNum(o.delivery_fee), 0);
    const totalCommission = orders.reduce((s, o) => s + toNum(o.commission_amount), 0);
    const totalRiderTips = orders.reduce((s, o) => s + toNum(o.rider_tip), 0);
    const codRevenue = orders
        .filter((o) => o.payment_method === "COD")
        .reduce((s, o) => s + toNum(o.total_amount), 0);
    const onlineRevenue = orders
        .filter((o) => o.payment_method !== "COD")
        .reduce((s, o) => s + toNum(o.total_amount), 0);
    const settledCount = orders.filter((o) => o.is_settled === true).length;
    const unsettledCount = orders.filter((o) => o.is_settled !== true).length;

    return ApiResponse.success(res, {
        summary: {
            total_orders: orders.length,
            total_revenue: totalRevenue,
            total_delivery_fees: totalDeliveryFees,
            total_commission: totalCommission,
            total_rider_tips: totalRiderTips,
            cod_revenue: codRevenue,
            online_revenue: onlineRevenue,
            settled_count: settledCount,
            unsettled_count: unsettledCount,
        },
        orders: orders.map((o) => ({
            id: o.id,
            customer_name: o.Customer?.name || "N/A",
            customer_phone: o.Customer?.phone || "N/A",
            total_amount: toNum(o.total_amount),
            delivery_fee: toNum(o.delivery_fee),
            rider_tip: toNum(o.rider_tip),
            commission_amount: toNum(o.commission_amount),
            payment_method: o.payment_method,
            payment_status: o.payment_status || "PENDING",
            is_paid: o.is_paid || false,
            is_settled: o.is_settled || false,
            status: o.status,
            createdAt: o.createdAt,
        })),
        generated_at: new Date().toISOString(),
        filters: { from, to },
    });
});



// ─── UPLOAD IMAGE ─────────────────────────────────────────────────────────────
exports.uploadImage = asyncHandler(async (req, res) => {
    if (!req.file) {
        return ApiResponse.error(res, "No file uploaded", 400);
    }
    return ApiResponse.success(res, { url: req.file.path }, "Image uploaded successfully");
});

// ─── PUBLIC SETTINGS ─────────────────────────────────────────────────────────
exports.getPublicSettings = asyncHandler(async (req, res) => {
    const NUMERIC_KEYS = [
        "free_delivery_threshold",
        "min_order_amount_customer",
        "delivery_fee_0_to_3km",
        "delivery_fee_3_to_5km",
        "min_withdrawal_amount",
        "platform_commission_percentage",
        "gst_percentage",
        "replacement_window_hours",
        "shop_lat",
        "shop_lng",
    ];
    const BOOLEAN_KEYS = [
        "replacement_enabled",
    ];
    const ALL_PUBLIC_KEYS = [...NUMERIC_KEYS, ...BOOLEAN_KEYS];

    // Seed defaults for any missing keys in bulk
    const allSettings = await ensureDefaultSettings(ALL_PUBLIC_KEYS);
    const settings = allSettings.filter((s) => ALL_PUBLIC_KEYS.includes(s.key));

    const publicSettings = {};
    for (const key of NUMERIC_KEYS) {
        const found = settings.slice().reverse().find((s) => s.key === key);
        if (found) {
            publicSettings[key] = parseFloat(found.value);
        } else {
            const def = DEFAULT_SETTINGS.find((d) => d.key === key);
            publicSettings[key] = def ? parseFloat(def.value) : 0;
        }
    }
    for (const key of BOOLEAN_KEYS) {
        const found = settings.slice().reverse().find((s) => s.key === key);
        if (found) {
            publicSettings[key] = found.value === "true";
        } else {
            const def = DEFAULT_SETTINGS.find((d) => d.key === key);
            publicSettings[key] = def ? def.value === "true" : false;
        }
    }

    return ApiResponse.success(res, publicSettings);
});

exports.ensureDefaultSettings = ensureDefaultSettings;
exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;


