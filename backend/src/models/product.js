const FirebaseModel = require("./firebaseModel");

const Product = new FirebaseModel("products", {
  category_id: {
    type: "string",
    required: true
  },
  name: {
    type: "string",
    required: true
  },
  mrp: {
    type: "number",
    required: true
  },
  selling_price: {
    type: "number",
    required: true
  },
  image_url: {
    type: "string",
    required: false
  },
  quantity: {
    type: "number",
    required: true,
    default: 0
  },
  description: {
    type: "string",
    required: false
  },
  is_active: {
    type: "boolean",
    required: false,
    default: true
  },
  rating: {
    type: "number",
    required: false,
    default: 0
  },
  rating_count: {
    type: "number",
    required: false,
    default: 0
  }
});

module.exports = Product;
