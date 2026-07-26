const FirebaseModel = require("./firebaseModel");

const Category = new FirebaseModel("categories", {
  name: {
    type: "string",
    required: true
  },
  banner_image: {
    type: "string",
    required: false
  },
  icon: {
    type: "string",
    required: false
  },
  is_active: {
    type: "boolean",
    required: false,
    default: true
  }
});

module.exports = Category;
