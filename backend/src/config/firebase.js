const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

let isFcmReady = false;
let serviceAccount = null;

const serviceAccountFilePath = path.join(__dirname, "serviceAccountKey.json");
const firebaseServiceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;

function parseServiceAccount(raw) {
  if (!raw) return null;
  let str = raw.trim();

  // Strip wrapping outer quotes if any
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1).trim();
  }

  // Attempt 1: Direct JSON parse
  try {
    return JSON.parse(str);
  } catch (_) {}

  // Attempt 2: If leading backslashes exist (e.g. \{"type":...)
  try {
    const cleanedLeading = str.replace(/^\\+/, "");
    return JSON.parse(cleanedLeading);
  } catch (_) {}

  // Attempt 3: If escaped quotes were preserved (e.g. {\"type\":\"service_account\"...})
  try {
    const unescapedQuotes = str.replace(/\\"/g, '"');
    return JSON.parse(unescapedQuotes);
  } catch (_) {}

  // Attempt 4: Clean all stray escape slashes
  try {
    const cleaned = str
      .replace(/\\(?!["\\/bfnrtu])/g, "")
      .replace(/\\"/g, '"');
    return JSON.parse(cleaned);
  } catch (_) {}

  return null;
}

if (firebaseServiceAccountRaw) {
  serviceAccount = parseServiceAccount(firebaseServiceAccountRaw);
  if (!serviceAccount) {
    console.error("Firebase FCM JSON parse failed from env variable, attempting fallback to local key file.");
  }
}

if (!serviceAccount && fs.existsSync(serviceAccountFilePath)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(serviceAccountFilePath, "utf8"));
  } catch (error) {
    console.error("Failed to read serviceAccountKey.json:", error.message);
  }
}

if (serviceAccount) {
  try {
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key
        .replace(/\\n/g, "\n")
        .replace(/\n\n/g, "\n");
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || "kunti-1e772",
      });
    }

    isFcmReady = true;
    console.log(`Firebase Admin SDK initialized ✅ (Project: ${serviceAccount.project_id || "kunti-1e772"})`);
  } catch (error) {
    console.error("Firebase Admin SDK init failed:", error.message);
  }
} else {
  console.warn("FIREBASE_SERVICE_ACCOUNT not set. Push notifications (FCM) disabled.");
}

const mockMessaging = {
  send: async () => undefined,
  sendEachForMulticast: async () => ({ responses: [] }),
};

const mockAdmin = {
  messaging: () => mockMessaging,
};

module.exports = {
  admin: isFcmReady ? admin : mockAdmin,
  isFcmReady,
  isFirebaseReady: isFcmReady,
};

