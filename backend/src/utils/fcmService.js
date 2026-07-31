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
    const payload = {
      notification: {
        title,
        body,
      },
      data: {
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
        ...data,
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
    console.log(`[FCM Success] Sent message: ${title} (Response: ${response})`);
    return true;
  } catch (error) {
    console.error(`[FCM Error] Failed to send notification (${title}):`, error.message);
    return false;
  }
}

/**
 * Send FCM notification to all Admins (via topic 'admin_notifications' and admin user tokens).
 */
async function notifyAdmin({ title, body, data = {} }) {
  // 1. Broadcast to topic 'admin_notifications'
  await sendFcmNotification({
    topic: "admin_notifications",
    title,
    body,
    data: { role: "ADMIN", ...data },
  });

  // 2. Also send to specific admin user tokens if stored
  try {
    const adminUsers = await User.findAll({
      where: { role: "ADMIN" },
      attributes: ["id", "fcm_token"],
    });

    for (const adminUser of adminUsers) {
      if (adminUser.fcm_token) {
        await sendFcmNotification({
          token: adminUser.fcm_token,
          title,
          body,
          data: { role: "ADMIN", ...data },
        });
      }
    }
  } catch (err) {
    console.error("[FCM] Failed fetching admin user tokens:", err.message);
  }
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

module.exports = {
  sendFcmNotification,
  notifyAdmin,
  notifyRider,
};
