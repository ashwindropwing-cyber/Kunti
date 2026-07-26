const FirebaseModel = require("./firebaseModel");

const Cart = new FirebaseModel("carts", {
  user_id: {
    type: "string",
    required: true
  }
});

module.exports = Cart;
