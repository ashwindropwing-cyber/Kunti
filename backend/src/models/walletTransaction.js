const FirebaseModel = require("./firebaseModel");

const WalletTransaction = new FirebaseModel("wallet_transactions", {
  user_id: {
    type: "string",
    required: true
  },
  master_order_id: {
    type: "string",
    required: false
  },
  type: {
    type: "string",
    required: true
  },
  amount: {
    type: "number",
    required: false
  },
  source: {
    type: "string",
    required: true
  },
  description: {
    type: "string",
    required: false
  },
  status: {
    type: "string",
    required: true,
    default: "SUCCESS"
  },
  reference_id: {
    type: "string",
    required: false
  }
});

module.exports = WalletTransaction;
