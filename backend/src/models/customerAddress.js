const FirebaseModel = require("./firebaseModel");

const CustomerAddress = new FirebaseModel("customer_addresses", {
  user_id: {
    type: "string",
    required: true
  },
  label: {
    type: "string",
    required: true
  },
  house_no: {
    type: "string",
    required: true
  },
  area: {
    type: "string",
    required: true
  },
  landmark: {
    type: "string",
    required: false
  },
  city: {
    type: "string",
    required: true
  },
  state: {
    type: "string",
    required: true
  },
  pincode: {
    type: "string",
    required: true
  },
  latitude: {
    type: "number",
    required: true
  },
  longitude: {
    type: "number",
    required: true
  },
  name: {
    type: "string",
    required: true
  },
  phone_number: {
    type: "string",
    required: true
  },
  is_default: {
    type: "boolean",
    required: false,
    default: false
  }
});

module.exports = CustomerAddress;
