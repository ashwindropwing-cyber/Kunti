const FirebaseModel = require("./firebaseModel");

const OTP = new FirebaseModel("otps", {
  phone: {
    type: "string",
    required: true
  },
  otp: {
    type: "string",
    required: true
  },
  expires_at: {
    type: "string",
    required: true
  },
  attempts: {
    type: "number",
    required: false,
    default: 0
  }
});

module.exports = OTP;
