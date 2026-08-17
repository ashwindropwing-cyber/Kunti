const { admin, isFcmReady } = require("../config/firebase");
const { User, Rider } = require("../models");

/**
 * Send FCM push notification to a specific token or topic.
 */
async function sendFcmNotification({ token, topic, title, body, data = {} }) {
  if (!isFcmReady) {
    console.log(`[FCM Mock] Push skipped (Firebase not configured): ${title} - ${body}`);
    return false;
  }

  try {
    const stringifiedData = {};
    if (data && typeof data === "object") {
      for (const [key, val] of Object.entries(data)) {
        if (val !== null && val !== undefined) {
          stringifiedData[key] = typeof val === "object" ? JSON.stringify(val) : String(val);
        }
      }
    }
    stringifiedData.clickAction = "FLUTTER_NOTIFICATION_CLICK";

    const payload = {
      notification: {
        title,
        body,
      },
      data: stringifiedData,
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "kunti_notifications",
          priority: "max",
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    if (token) {
      payload.token = token;
    } else if (topic) {
      payload.topic = topic;
    } else {
      console.warn("[FCM] Neither token nor topic provided for notification");
      return false;
    }

    const response = await admin.messaging().send(payload);
    console.log(`[FCM Success] Sent message: "${title}" (Response: ${response})`);
    return true;
  } catch (error) {
    console.error(`[FCM Error] Failed to send notification ("${title}"):`, error.message);
    return false;
  }
}

/**
 * Send FCM notification to all Admins (via topic 'admin_notifications' and admin user tokens).
 */
async function notifyAdmin({ title, body, data = {} }) {
  let sentCount = 0;

  // 1. Send to all registered Admin users by direct token
  try {
    const adminUsers = await User.findAll({
      where: { role: "ADMIN" },
      attributes: ["id", "name", "fcm_token"],
    });

    for (const adminUser of adminUsers) {
      if (adminUser.fcm_token) {
        const success = await sendFcmNotification({
          token: adminUser.fcm_token,
          title,
          body,
          data: { role: "ADMIN", ...data },
        });
        if (success) sentCount++;
      }
    }
  } catch (err) {
    console.error("[FCM] Failed fetching admin user tokens:", err.message);
  }

  // 2. Also broadcast to topic 'admin_notifications' for admin web/app listeners
  try {
    await sendFcmNotification({
      topic: "admin_notifications",
      title,
      body,
      data: { role: "ADMIN", ...data },
    });
  } catch (_) {}

  console.log(`[FCM] Admin notified: "${title}" (Delivered to ${sentCount} direct admin token(s) & topic)`);
  return true;
}

/**
 * Send FCM notification to a specific Rider.
 */
async function notifyRider(riderOrId, { title, body, data = {} }) {
  try {
    let rider = riderOrId;
    if (typeof riderOrId === "object" && riderOrId !== null && riderOrId.fcm_token !== undefined) {
      rider = riderOrId;
    } else if (riderOrId) {
      rider = await Rider.findByPk(riderOrId);
    }

    if (!rider || !rider.fcm_token) {
      console.log(`[FCM] Rider has no registered FCM token.`);
      return false;
    }

    return await sendFcmNotification({
      token: rider.fcm_token,
      title,
      body,
      data: { role: "RIDER", ...data },
    });
  } catch (err) {
    console.error("[FCM] Error notifying rider:", err.message);
    return false;
  }
}

/**
 * Send FCM notification to a specific Customer/User.
 */
async function notifyCustomer(userIdOrUser, { title, body, data = {} }) {
  try {
    let user = userIdOrUser;
    if (typeof userIdOrUser === "object" && userIdOrUser !== null && userIdOrUser.fcm_token !== undefined) {
      user = userIdOrUser;
    } else if (userIdOrUser) {
      user = await User.findByPk(userIdOrUser, { attributes: ["id", "fcm_token"] });
    }

    if (!user || !user.fcm_token) {
      return false;
    }

    return await sendFcmNotification({
      token: user.fcm_token,
      title,
      body,
      data: { role: "CUSTOMER", ...data },
    });
  } catch (err) {
    console.error("[FCM] Error notifying customer:", err.message);
    return false;
  }
}

module.exports = {
  sendFcmNotification,
  notifyAdmin,
  notifyRider,
  notifyCustomer,
};

