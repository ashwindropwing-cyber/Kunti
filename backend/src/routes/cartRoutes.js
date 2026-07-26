const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");

router.post("/add", verifyToken, allowRoles("CUSTOMER"), cartController.addToCart);
router.get("/", verifyToken, allowRoles("CUSTOMER"), cartController.getCart);
router.delete("/remove/:productId", verifyToken, allowRoles("CUSTOMER"), cartController.removeFromCart);
router.delete("/clear", verifyToken, allowRoles("CUSTOMER"), cartController.clearCart);
router.patch ("/update",verifyToken, allowRoles("CUSTOMER"), cartController.updateQuantity);
module.exports = router;