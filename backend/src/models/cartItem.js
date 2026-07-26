const FirebaseModel = require("./firebaseModel");

const CartItem = new FirebaseModel("cart_items", {
  cart_id: {
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
  }
});

module.exports = CartItem;
