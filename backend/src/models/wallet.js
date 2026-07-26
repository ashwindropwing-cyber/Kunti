const FirebaseModel = require("./firebaseModel");

const Wallet = new FirebaseModel("wallets", {
  user_id: {
    type: "string",
    required: true
  },
  pending_balance: {
    type: "number",
    required: false,
    default: 0
  },
  available_balance: {
    type: "number",
    required: false,
    default: 0
  },
  total_earned: {
    type: "number",
    required: false,
    default: 0
  },
  total_withdrawn: {
    type: "number",
    required: false,
    default: 0
  }
});

module.exports = Wallet;
