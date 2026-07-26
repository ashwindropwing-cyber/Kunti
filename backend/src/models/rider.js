const FirebaseModel = require("./firebaseModel");

const Rider = new FirebaseModel("riders", {
  user_id: {
    type: "string",
    required: true
  },
  is_available: {
    type: "boolean",
    required: false,
    default: false
  },
  vehicle_type: {
    type: "string",
    required: false
  },
  vehicle_number: {
    type: "string",
    required: false
  },
  address: {
    type: "string",
    required: false
  },
  license_number: {
    type: "string",
    required: false
  },
  aadhar_number: {
    type: "string",
    required: false
  },
  date_of_birth: {
    type: "string",
    required: false
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
  },
  cod_limit: {
    type: "number",
    required: false,
    default: 1000
  },
  fcm_token: {
    type: "string",
    required: false
  },
  order_notifications_enabled: {
    type: "boolean",
    required: false,
    default: true
  },
  profile_picture_url: {
    type: "string",
    required: false,
    default: "https://via.placeholder.com/150?text=No+Photo"
  },
  is_verified: {
    type: "boolean",
    required: false,
    default: false
  },
  pending_profile_update: {
    type: "object",
    required: false,
    default: null
  }
});

module.exports = Rider;
