const FirebaseModel = require("./firebaseModel");

const User = new FirebaseModel("users", {
  name: {
    type: "string",
    required: true
  },
  phone: {
    type: "string",
    required: true
  },
  email: {
    type: "string",
    required: false
  },
  password: {
    type: "string",
    required: false
  },
  role: {
    type: "string",
    required: true
  }
});

module.exports = User;
