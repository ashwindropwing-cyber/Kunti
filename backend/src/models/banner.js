const FirebaseModel = require("./firebaseModel");

const Banner = new FirebaseModel("banners", {
  image_url: {
    type: "string",
    required: true
  },
  title: {
    type: "string",
    required: false
  },
  redirect_url: {
    type: "string",
    required: false
  },
  display_order: {
    type: "number",
    required: false,
    default: 0
  },
  is_active: {
    type: "boolean",
    required: false,
    default: true
  }
});

module.exports = Banner;
