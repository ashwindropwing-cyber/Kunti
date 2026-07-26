const FirebaseModel = require("./firebaseModel");

const RefundRequest = new FirebaseModel("refund_requests", {
  master_order_id: {
    type: "string",
    required: true
  },
  user_id: {
    type: "string",
    required: true
  },
  reason: {
    type: "string",
    required: true
  },
  description: {
    type: "string",
    required: false
  },
  images: {
    type: "string",
    required: false,
    default: "[]"
  },
  items: {
    type: "string",
    required: false,
    default: "[]"
  },
  amount: {
    type: "number",
    required: true
  },
  refund_method: {
    type: "string",
    required: false,
    default: "WALLET"
  },
  status: {
    type: "string",
    required: false,
    default: "PENDING"
  },
  admin_note: {
    type: "string",
    required: false
  },
  processed_at: {
    type: "string",
    required: false
  }
});

module.exports = RefundRequest;
