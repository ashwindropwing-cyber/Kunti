const admin = require("firebase-admin");

const firebaseServiceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
let isFirebaseReady = false;

if (firebaseServiceAccountRaw) {
  try {
    let cleanJson = firebaseServiceAccountRaw.trim();
    if (
      (cleanJson.startsWith('"') && cleanJson.endsWith('"')) ||
      (cleanJson.startsWith("'") && cleanJson.endsWith("'"))
    ) {
      cleanJson = cleanJson.slice(1, -1);
    }
    // Clean escaping backslashes from JSON characters that are not valid JSON escape sequences (e.g. \{ -> {, \_ -> _)
    cleanJson = cleanJson.replace(/\\(?!["\\/bfnrtu])/g, "");

    const serviceAccount = JSON.parse(cleanJson);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL:
          process.env.FIREBASE_DATABASE_URL ||
          "https://tind-ffb61-default-rtdb.firebaseio.com",
      });
    }

    isFirebaseReady = true;
  } catch (error) {
    console.error("Firebase init failed:", error.message);
  }
} else {
  console.warn("FIREBASE_SERVICE_ACCOUNT not set. Firebase disabled.");
}

const dbMock = {
  ref: () => ({
    set: async () => undefined,
    update: async () => undefined,
  }),
};

const makeMockQuery = () => {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    offset: () => query,
    count: () => ({
      get: async () => ({
        data: () => ({ count: 0 })
      })
    }),
    get: async () => ({
      empty: true,
      docs: []
    })
  };
  return query;
};

const firestoreMock = {
  collection: () => {
    const query = makeMockQuery();
    return {
      ...query,
      doc: () => ({
        set: async () => undefined,
        get: async () => ({ exists: false, data: () => undefined }),
        update: async () => undefined,
        delete: async () => undefined,
      }),
      add: async () => ({ id: "mock" }),
    };
  },
  batch: () => ({
    update: () => {},
    delete: () => {},
    commit: async () => {},
  }),
};

const messaging = {
  send: async () => undefined,
};

const mockAdmin = {
  messaging: () => messaging,
  firestore: {
    FieldPath: {
      documentId: () => "__documentId__"
    }
  }
};

module.exports = {
  admin: isFirebaseReady ? admin : mockAdmin,
  db: isFirebaseReady ? admin.database() : dbMock,
  firestore: isFirebaseReady ? admin.firestore() : firestoreMock,
  isFirebaseReady,
};

