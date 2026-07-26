const express = require("express");
const router = express.Router();
const addressController = require("../controllers/addressController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");

// Add address
router.post(
  "/save",
  verifyToken,
  allowRoles("CUSTOMER"),
  addressController.saveAddress
);

// Get all addresses
router.get(
  "/",
  verifyToken,
  allowRoles("CUSTOMER"),
  addressController.getAddresses
);

// Update address
router.put(
  "/:id",
  verifyToken,
  allowRoles("CUSTOMER"),
  addressController.updateAddress
);

// Delete address
router.delete(
  "/:id",
  verifyToken,
  allowRoles("CUSTOMER"),
  addressController.deleteAddress
);

// Set default address
router.patch(
  "/set-default",
  verifyToken,
  allowRoles("CUSTOMER"),
  addressController.setDefaultAddress
);

module.exports = router;