const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

router.post("/payment", paymentController.handleWebhook);
router.post("/payout", paymentController.handlePayoutWebhook);
module.exports = router;
