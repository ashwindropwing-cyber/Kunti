const FirebaseModel = require("./firebaseModel");

const RiderDocument = new FirebaseModel("rider_documents", {
  rider_id: {
    type: "string",
    required: true
  },
  document_type: {
    type: "string",
    required: true
  },
  document_urls: {
    type: "array",
    required: true
  },
  status: {
    type: "string",
    required: false,
    default: "PENDING"
  },
  rejection_reason: {
    type: "string",
    required: false
  },
  verified_at: {
    type: "string",
    required: false
  }
});

module.exports = RiderDocument;
