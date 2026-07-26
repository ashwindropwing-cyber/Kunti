const FirebaseModel = require("./firebaseModel");

const WithdrawalRequest = new FirebaseModel("withdrawal_requests", {
  user_id: {
    type: "string",
    required: true
  },
  amount: {
    type: "number",
    required: true
  },
  status: {
    type: "string",
    required: true,
    default: "PENDING"
  },
  account_name: {
    type: "string",
    required: true
  },
  account_number: {
    type: "string",
    required: true
  },
  ifsc: {
    type: "string",
    required: true
  },
  bank_name: {
    type: "string",
    required: false
  },
  razorpay_payout_id: {
    type: "string",
    required: false
  },
  retry_count: {
    type: "number",
    required: false,
    default: 0
  },
  max_retries: {
    type: "number",
    required: false,
    default: 3
  },
  wallet_refunded: {
    type: "boolean",
    required: false,
    default: false
  }
});

module.exports = WithdrawalRequest;
