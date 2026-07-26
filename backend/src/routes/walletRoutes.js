const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const paymentController = require("../controllers/paymentController");
const { verifyToken } = require("../middlewares/authMiddleware");
const { noCache } = require("../middlewares/responseCache");

// Accessible by any logged-in user
router.get(
  "/history",
  verifyToken,
  noCache,
  walletController.getWalletHistory
);
router.get("/balance", verifyToken, noCache, walletController.getWalletBalance);

// Wallet Deposit
router.post("/deposit/create", verifyToken, paymentController.createDepositOrder);
router.post("/deposit/verify", verifyToken, paymentController.verifyDeposit);

module.exports = router;