const FirebaseModel = require("./firebaseModel");

const MasterOrder = new FirebaseModel("master_orders", {
  customer_id: {
    type: "string",
    required: true
  },
  rider_id: {
    type: "string",
    required: false
  },
  delivery_address_id: {
    type: "string",
    required: false
  },
  payment_expired_at: {
    type: "string",
    required: false
  },
  total_amount: {
    type: "number",
    required: true
  },
  delivery_fee: {
    type: "number",
    required: true,
    default: 0
  },
  payment_method: {
    type: "string",
    required: true
  },
  is_paid: {
    type: "boolean",
    required: false,
    default: false
  },
  payment_id: {
    type: "string",
    required: false
  },
  delivered_at: {
    type: "string",
    required: false
  },
  razorpay_order_id: {
    type: "string",
    required: false
  },
  payment_status: {
    type: "string",
    required: false,
    default: "PENDING"
  },
  pod_image: {
    type: "string",
    required: false
  },
  cod_collected: {
    type: "boolean",
    required: false,
    default: false
  },
  status: {
    type: "string",
    required: false,
    default: "PENDING"
  },
  offered_rider_id: {
    type: "string",
    required: false
  },
  rider_rejected_ids: {
    type: "string",
    required: true,
    default: "[]"
  },
  rider_tip: {
    type: "number",
    required: true,
    default: 0
  },
  is_for_friend: {
    type: "boolean",
    required: false,
    default: false
  },
  friend_name: {
    type: "string",
    required: false
  },
  friend_phone: {
    type: "string",
    required: false
  },
  cancel_reason: {
    type: "string",
    required: false
  },
  cancelled_by: {
    type: "string",
    required: false
  }
});

module.exports = MasterOrder;
