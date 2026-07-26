const FirebaseModel = require("./firebaseModel");

const Review = new FirebaseModel("reviews", {
  user_id: {
    type: "string",
    required: true
  },
  master_order_id: {
    type: "string",
    required: true
  },
  review_type: {
    type: "string",
    required: true,
    default: "SELLER"
  },
  seller_id: {
    type: "string",
    required: false
  },
  rider_id: {
    type: "string",
    required: false
  },
  product_id: {
    type: "string",
    required: false
  },
  rating: {
    type: "number",
    required: true,
    default: 0
  },
  comment: {
    type: "string",
    required: false
  }
});

module.exports = Review;
