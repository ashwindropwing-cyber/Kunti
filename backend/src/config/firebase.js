const admin = require("firebase-admin");

const firebaseServiceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
let isFcmReady = false;

if (firebaseServiceAccountRaw) {
  try {
    let cleanJson = firebaseServiceAccountRaw.trim();
    if (
      (cleanJson.startsWith('"') && cleanJson.endsWith('"')) ||
      (cleanJson.startsWith("'") && cleanJson.endsWith("'"))
    ) {
      cleanJson = cleanJson.slice(1, -1);
    }
    cleanJson = cleanJson.replace(/\\(?!["\\/bfnrtu])/g, "");

    const serviceAccount = JSON.parse(cleanJson);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key
        .replace(/\\n/g, "\n")
        .replace(/\n\n/g, "\n");
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    isFcmReady = true;
    console.log("Firebase FCM Messaging initialized ✅");
  } catch (error) {
    console.error("Firebase FCM init failed:", error.message);
  }
} else {
  console.warn("FIREBASE_SERVICE_ACCOUNT not set. Push notifications (FCM) disabled.");
}

const mockMessaging = {
  send: async () => undefined,
};

const mockAdmin = {
  messaging: () => mockMessaging,
};

module.exports = {
  admin: isFcmReady ? admin : mockAdmin,
  isFcmReady,
};
