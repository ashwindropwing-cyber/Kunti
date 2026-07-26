const express = require("express");
const router = express.Router();
const withdrawalController = require("../controllers/withdrawalController");
const { verifyToken, allowRoles } = require("../middlewares/authMiddleware");

// Any authenticated user (SELLER, RIDER, CUSTOMER) can request withdrawal
router.post(
  "/request",
  verifyToken,
  withdrawalController.requestWithdrawal
);

router.post(
  "/approve",
  verifyToken,
  allowRoles("ADMIN"),
  withdrawalController.approveWithdrawal
);

router.get(
  "/admin",
  verifyToken,
  allowRoles("ADMIN"),
  withdrawalController.getAllWithdrawals
);

router.get("/history", verifyToken, withdrawalController.getMyWithdrawals);

module.exports = router;