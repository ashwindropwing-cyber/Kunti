const FirebaseModel = require("./firebaseModel");

const OrderItem = new FirebaseModel("order_items", {
  master_order_id: {
    type: "string",
    required: true
  },
  product_id: {
    type: "string",
    required: true
  },
  quantity: {
    type: "number",
    required: true
  },
  price_at_purchase: {
    type: "number",
    required: true
  },
  has_replacement_request: {
    type: "boolean",
    required: false,
    default: false
  }
});

module.exports = OrderItem;
