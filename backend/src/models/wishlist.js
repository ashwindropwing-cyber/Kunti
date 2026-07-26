const FirebaseModel = require("./firebaseModel");

const Wishlist = new FirebaseModel("wishlists", {
  user_id: {
    type: "string",
    required: true
  },
  product_id: {
    type: "string",
    required: true
  }
});

module.exports = Wishlist;
