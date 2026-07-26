require('dotenv').config();
const admin = require('firebase-admin');
const firebaseServiceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
try {
  const serviceAccount = JSON.parse(firebaseServiceAccountRaw);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://tind-ffb61-default-rtdb.firebaseio.com",
  });
  admin.firestore().collection('health-check').doc('status').set({ status: 'OK' })
    .then(() => { console.log('Firestore OK'); process.exit(0); })
    .catch(e => { console.error('Firestore Error:', e.message); process.exit(1); });
} catch (e) {
  console.error("JSON Parse Error:", e.message);
  console.log("Raw value:", firebaseServiceAccountRaw);
}
