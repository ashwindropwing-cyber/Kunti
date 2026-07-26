const razorpay = require("../config/razorpay");
const crypto = require("crypto");
const MasterOrder = require("../models/masterOrder");
const WithdrawalRequest = require("../models/withdrawalRequest");
const Wallet = require("../models/wallet");
const WalletTransaction = require("../models/walletTransaction");
const { admin, isFirebaseReady } = require("../config/firebase");

const orderController = require("./orderController");
const asyncHandler = require("../utils/AsyncHandler");

// ===============================
// CREATE RAZORPAY ORDER
// ===============================
exports.createPaymentOrder = async (req, res) => {
  try {
    const { master_order_id } = req.body;

    const order = await MasterOrder.findByPk(master_order_id);

    if (!order)
      return res.status(404).json({ message: "Order not found" });

    // BUG-C3 FIX: Verify the authenticated user owns this order
    if (order.customer_id !== req.user.id) {
      return res.status(403).json({ message: "Access denied: this order does not belong to you" });
    }

    if (order.payment_method !== "ONLINE")
      return res.status(400).json({
        message: "Payment not required for COD orders",
      });

    if (order.payment_status === "PAID")
      return res.status(400).json({
        message: "Order already paid",
      });

    // BUG-11 FIX: If a Razorpay order creation failed after the Firestore transaction
    // committed (order placed, stock decremented, cart cleared) the order is stuck with
    // payment_status=PENDING and no razorpay_order_id. Allow creating a new Razorpay
    // order in this case so the customer can complete payment without needing support.
    if (order.razorpay_order_id) {
      return res.status(400).json({
        message: "Payment order already created. Use retryPayment if expired.",
        razorpay_order_id: order.razorpay_order_id,
        amount: Math.round(parseFloat(order.total_amount) * 100),
        key: process.env.RAZORPAY_KEY_ID,
      });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(parseFloat(order.total_amount) * 100),
      currency: "INR",
      receipt: order.id,
    });

    order.razorpay_order_id = razorpayOrder.id;
    order.payment_status = "PENDING";
    await order.save();

    return res.json({
      razorpay_order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });

  } catch (error) {
    console.error("Create payment order error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ===============================
// VERIFY PAYMENT
// ===============================
exports.verifyPayment = async (req, res) => {
  try {
    const {
      master_order_id,              // ✅ ADDED: Our internal order ID
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    // ✅ Find order using either our order_id or razorpay_order_id
    let order;

    if (master_order_id) {
      order = await MasterOrder.findByPk(master_order_id);
    } else if (razorpay_order_id) {
      order = await MasterOrder.findOne({
        where: { razorpay_order_id }
      });
    }

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // BUG-C3 FIX: Verify the authenticated user owns this order
    if (order.customer_id !== req.user.id) {
      return res.status(403).json({ message: "Access denied: this order does not belong to you" });
    }

    if (order.payment_method !== "ONLINE") {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    if (order.payment_status === "PAID") {
      await orderController.dispatchOrderToRiders(order.id, false);
      return res.json({ message: "Payment already verified" });
    }

    // Verify razorpay_order_id matches to prevent replay attack across different orders
    if (!order.razorpay_order_id || order.razorpay_order_id !== razorpay_order_id) {
      return res.status(400).json({
        message: "Payment verification failed - razorpay_order_id mismatch",
      });
    }

    // 🔐 Generate expected signature
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    // BUG-C7 FIX: Use timing-safe comparison to prevent side-channel attacks
    const sigBuffer = Buffer.from(generatedSignature, "hex");
    const receivedBuffer = Buffer.from(razorpay_signature || "", "hex");
    if (sigBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(sigBuffer, receivedBuffer)) {
      console.log("❌ Signature mismatch:");
      console.log("   EXPECTED:", generatedSignature);
      console.log("   RECEIVED:", razorpay_signature);

      order.status = "PAYMENT_EXPIRED";
      order.payment_status = "FAILED";
      order.payment_expired_at = new Date();
      await order.save();

      return res.status(400).json({
        message: "Payment verification failed - Invalid signature",
      });
    }

    const { firestore } = require("../config/firebase");
    let needsDispatch = false;

    try {
      await firestore.runTransaction(async (dbTx) => {
        const orderRef = firestore.collection("master_orders").doc(order.id);
        const orderSnap = await dbTx.get(orderRef);
        if (!orderSnap.exists) {
          throw new Error("Order not found");
        }
        const orderData = orderSnap.data();

        if (orderData.payment_status === "PAID") {
          return; // Already verified
        }

        // Verify duplicate payment ID to prevent replay attacks
        const duplicateQuery = firestore.collection("master_orders")
          .where("payment_id", "==", razorpay_payment_id)
          .limit(1);
        const duplicateSnap = await dbTx.get(duplicateQuery);
        if (!duplicateSnap.empty) {
          const dupDoc = duplicateSnap.docs[0];
          if (dupDoc.id !== order.id) {
            throw new Error("This payment has already been verified for another order");
          }
        }

        const updateFields = {
          is_paid: true,
          payment_id: razorpay_payment_id,
          payment_status: "PAID",
          updatedAt: new Date()
        };

        if (orderData.status === "PAYMENT_EXPIRED") {
          updateFields.status = "PLACED";
          order.status = "PLACED";
        }

        dbTx.update(orderRef, updateFields);

        needsDispatch = true;
      });
    } catch (txError) {
      console.error("Payment verification transaction failed:", txError.message);
      return res.status(400).json({ message: txError.message });
    }

    // Dispatch to riders — wrapped in try-catch so rider dispatch failures
    // don't cause 500 errors after successful payment verification
    if (needsDispatch) {
      try {
        await orderController.dispatchOrderToRiders(order.id);
      } catch (dispatchError) {
        console.error("⚠️ Rider dispatch failed after payment verification (non-fatal):", dispatchError.message);
      }
    } else {
      try {
        await orderController.dispatchOrderToRiders(order.id, false);
      } catch (dispatchError) {
        console.error("⚠️ Rider dispatch failed after payment verification (non-fatal):", dispatchError.message);
      }
    }

    console.log(`✅ Payment verified for order ${order.id}`);

    return res.json({
      message: "Payment verified successfully",
      master_order_id: order.id,
    });

  } catch (error) {
    console.error("❌ Payment verification error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const refundController = require("./refundController");

// ===============================
// REQUEST REFUND (CUSTOMER)
// ===============================
exports.requestRefund = async (req, res) => {
  return refundController.requestRefund(req, res);
};

// ===============================
// PROCESS REFUND REQUEST (ADMIN)
// ===============================
exports.processRefundRequest = async (req, res) => {
  // Map refund_request_id to req.params.id for updateRefundStatus
  req.params = { ...req.params, id: req.body.refund_request_id };
  return refundController.updateRefundStatus(req, res);
};

// ===============================
// GET ALL REFUND REQUESTS (ADMIN)
// ===============================
exports.getAllRefundRequests = async (req, res) => {
  return refundController.getAllRefunds(req, res);
};


// ===============================
// RETRY PAYMENT
// ===============================
exports.retryPayment = async (req, res) => {
  try {
    const { master_order_id } = req.body;

    const order = await MasterOrder.findByPk(master_order_id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // BUG-C4 FIX: Verify the authenticated user owns this order
    if (order.customer_id !== req.user.id) {
      return res.status(403).json({ message: "Access denied: this order does not belong to you" });
    }

    if (order.status !== "PAYMENT_EXPIRED") {
      return res.status(400).json({
        message: "Retry not allowed",
      });
    }

    const RETRY_WINDOW_MIN = 10;

    const retryDeadline = new Date(
      new Date(order.payment_expired_at).getTime() +
      RETRY_WINDOW_MIN * 60 * 1000
    );

    if (new Date() > retryDeadline) {
      return res.status(400).json({
        message: "Retry window expired",
      });
    }


    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(order.total_amount * 100),
      currency: "INR",
      receipt: order.id,
    });

    order.razorpay_order_id = razorpayOrder.id;
    order.payment_status = "PENDING";
    order.status = "PLACED";
    await order.save();

    return res.json({
      message: "Retry payment initiated",
      razorpay_order_id: razorpayOrder.id,
      key: process.env.RAZORPAY_KEY_ID,
    });

  } catch (error) {
    console.error("Retry payment error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ===============================
// WEBHOOK HANDLER
// ===============================
exports.handleWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ message: "Invalid webhook payload format" });
    }

    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const razorpaySignature = req.headers["x-razorpay-signature"];

    // BUG-C7 FIX: Use timing-safe comparison to prevent side-channel attacks
    const sigBuf = Buffer.from(generatedSignature, "hex");
    const recBuf = Buffer.from(razorpaySignature || "", "hex");
    if (sigBuf.length !== recBuf.length || !crypto.timingSafeEqual(sigBuf, recBuf))
      return res.status(400).json({ message: "Invalid webhook signature" });

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch (parseError) {
      return res.status(400).json({ message: "Invalid webhook JSON payload" });
    }

    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity;
      const { firestore } = require("../config/firebase");

      let isDeposit = payment.notes?.type === "wallet_deposit";
      let userId = payment.notes?.user_id;

      if (!isDeposit && payment.order_id) {
        try {
          const orderDetails = await razorpay.orders.fetch(payment.order_id);
          if (orderDetails && orderDetails.notes?.type === "wallet_deposit") {
            isDeposit = true;
            userId = orderDetails.notes?.user_id;
          }
        } catch (fetchError) {
          console.error("Failed to fetch order details from Razorpay:", fetchError.message);
        }
      }

      if (isDeposit && userId) {
        const depositAmount = parseFloat(payment.amount) / 100;
        const paymentId = payment.id;

        try {
          await firestore.runTransaction(async (dbTx) => {
            const txQuery = firestore.collection("wallet_transactions")
              .where("reference_id", "==", paymentId)
              .limit(1);
            const txSnap = await dbTx.get(txQuery);
            if (!txSnap.empty) {
              throw new Error("Deposit already processed");
            }

            const walletQuery = firestore.collection("wallets")
              .where("user_id", "==", userId)
              .limit(1);
            const walletSnap = await dbTx.get(walletQuery);
            
            let walletRef;
            let newBalance;
            
            if (walletSnap.empty) {
              walletRef = firestore.collection("wallets").doc();
              newBalance = depositAmount;
              const walletData = {
                user_id: userId,
                available_balance: newBalance,
                pending_balance: 0,
                total_earned: 0,
                total_withdrawn: 0,
                createdAt: new Date(),
                updatedAt: new Date()
              };
              dbTx.set(walletRef, walletData);
            } else {
              const walletDoc = walletSnap.docs[0];
              walletRef = walletDoc.ref;
              const walletData = walletDoc.data();
              newBalance = (parseFloat(walletData.available_balance) || 0) + depositAmount;
              dbTx.update(walletRef, {
                available_balance: newBalance,
                updatedAt: new Date()
              });
            }

            const txRef = firestore.collection("wallet_transactions").doc();

            dbTx.set(txRef, {
              user_id: userId,
              type: "CREDIT",
              amount: depositAmount,
              source: "DEPOSIT",
              description: "Wallet deposit via Razorpay (Webhook)",
              reference_id: paymentId,
              status: "SUCCESS",
              createdAt: new Date(),
              updatedAt: new Date()
            });
          });

          console.log(`✅ Webhook: Deposit of ₹${depositAmount} successful for user ${userId}`);

          // Send FCM to Customer about Wallet Deposit Credit
          try {
            const User = require("../models/user");
            const userDoc = await User.findByPk(userId);
            const customerFcm = userDoc?.fcm_token?.toString().trim();
            if (customerFcm && isFirebaseReady) {
              const depositTitle = "Wallet Credited! 💸";
              const depositBody = `₹${depositAmount.toFixed(2)} has been successfully added to your wallet.`;

              await admin.messaging().send({
                token: customerFcm,
                notification: { title: depositTitle, body: depositBody },
                data: {
                  type: "WALLET_CREDITED",
                  amount: String(depositAmount),
                  source: "DEPOSIT"
                },
                android: {
                  priority: "high",
                  notification: {
                    sound: "default",
                    channelId: "customer_notifications",
                    clickAction: "FLUTTER_NOTIFICATION_CLICK",
                  },
                },
                apns: {
                  headers: {
                    "apns-priority": "10",
                  },
                  payload: {
                    aps: {
                      sound: "default",
                      badge: 1,
                    },
                  },
                },
              });
              console.log(`[FCM] Sent wallet deposit credit notification to customer ${userId}`);
            }
          } catch (fcmError) {
            console.error("[FCM] Failed to send wallet deposit notification:", fcmError.message);
          }
        } catch (txError) {
          console.error("Webhook deposit transaction failed:", txError.message);
        }
      } else {
        let needsDispatch = false;
        let orderId = "";

        try {
          await firestore.runTransaction(async (dbTx) => {
            const orderQuery = firestore.collection("master_orders")
              .where("razorpay_order_id", "==", payment.order_id)
              .limit(1);
            const orderSnap = await dbTx.get(orderQuery);
            if (orderSnap.empty) return;

            const orderDoc = orderSnap.docs[0];
            const orderData = orderDoc.data();
            orderId = orderDoc.id;

            if (orderData.payment_status === "PAID") {
              return; // Already paid
            }

            // Verify duplicate payment ID to prevent replay attacks
            const duplicateQuery = firestore.collection("master_orders")
              .where("payment_id", "==", payment.id)
              .limit(1);
            const duplicateSnap = await dbTx.get(duplicateQuery);
            if (!duplicateSnap.empty) {
              const dupDoc = duplicateSnap.docs[0];
              if (dupDoc.id !== orderDoc.id) {
                throw new Error("This payment has already been verified for another order");
              }
            }

            const updateFields = {
              is_paid: true,
              payment_status: "PAID",
              payment_id: payment.id,
              updatedAt: new Date()
            };

            if (orderData.status === "PAYMENT_EXPIRED") {
              updateFields.status = "PLACED";
            }

            dbTx.update(orderDoc.ref, updateFields);

            needsDispatch = true;
          });

          if (needsDispatch && orderId) {
            await orderController.dispatchOrderToRiders(orderId);
          }
        } catch (txError) {
          console.error("Webhook payment capture transaction failed:", txError.message);
        }
      }
    }

    if (event.event === "payment.failed") {
      const payment = event.payload.payment.entity;

      const order = await MasterOrder.findOne({
        where: { razorpay_order_id: payment.order_id },
      });

      if (order) {
        order.is_paid = false;
        order.status = "PAYMENT_EXPIRED";
        order.payment_status = "FAILED";
        order.payment_expired_at = new Date();
        await order.save();
      }
    }

    return res.json({ status: "Webhook processed" });

  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
// ===============================
// PAYOUT WEBHOOK HANDLER
// ===============================
exports.handlePayoutWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ message: "Invalid webhook payload format" });
    }

    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const razorpaySignature = req.headers["x-razorpay-signature"];

    // BUG-C7 FIX: Use timing-safe comparison to prevent side-channel attacks
    const pSigBuf = Buffer.from(generatedSignature, "hex");
    const pRecBuf = Buffer.from(razorpaySignature || "", "hex");
    if (pSigBuf.length !== pRecBuf.length || !crypto.timingSafeEqual(pSigBuf, pRecBuf)) {
      return res.status(400).json({ message: "Invalid signature" });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch (parseError) {
      return res.status(400).json({ message: "Invalid webhook JSON payload" });
    }

    if (
      event.event === "payout.processed" ||
      event.event === "payout.failed" ||
      event.event === "payout.reversed"
    ) {
      const payout = event.payload.payout.entity;
      const { firestore } = require("../config/firebase");

      await firestore.runTransaction(async (dbTx) => {
        const withdrawalQuery = firestore.collection("withdrawal_requests")
          .where("razorpay_payout_id", "==", payout.id)
          .limit(1);
        const withdrawalSnap = await dbTx.get(withdrawalQuery);
        
        if (withdrawalSnap.empty) {
          throw new Error("Withdrawal request not found");
        }

        const withdrawalDoc = withdrawalSnap.docs[0];
        const withdrawalData = withdrawalDoc.data();

        // 🔒 Prevent duplicate processing
        if (withdrawalData.status === "SUCCESS" || withdrawalData.status === "FAILED") {
          return; // Already reconciled
        }

        const currentRetry = Number(withdrawalData.retry_count) || 0;
        const maxRetries = Number(withdrawalData.max_retries) || 3;

        // ✅ Payout Success
        if (event.event === "payout.processed") {
          dbTx.update(withdrawalDoc.ref, {
            status: "SUCCESS",
            updatedAt: new Date()
          });

          const walletQuery = firestore.collection("wallets")
            .where("user_id", "==", withdrawalData.user_id)
            .limit(1);
          const walletSnap = await dbTx.get(walletQuery);
          if (!walletSnap.empty) {
            const walletDoc = walletSnap.docs[0];
            const walletData = walletDoc.data();
            const currentWithdrawn = parseFloat(walletData.total_withdrawn) || 0;
            
            dbTx.update(walletDoc.ref, {
              total_withdrawn: currentWithdrawn + parseFloat(withdrawalData.amount),
              updatedAt: new Date()
            });
          }

          const txQuery = firestore.collection("wallet_transactions")
            .where("reference_id", "==", withdrawalDoc.id)
            .limit(1);
          const txSnap = await dbTx.get(txQuery);
          if (!txSnap.empty) {
            dbTx.update(txSnap.docs[0].ref, {
              status: "SUCCESS",
              description: `Withdrawal payout successful: ₹${withdrawalData.amount}`,
              updatedAt: new Date()
            });
          } else {
            const txRef = firestore.collection("wallet_transactions").doc();
            dbTx.set(txRef, {
              user_id: withdrawalData.user_id,
              type: "DEBIT",
              amount: parseFloat(withdrawalData.amount),
              source: "WITHDRAWAL",
              description: "Seller withdrawal payout",
              status: "SUCCESS",
              reference_id: withdrawalDoc.id,
              createdAt: new Date(),
              updatedAt: new Date()
            });
          }
        }

        // ❌ Payout Failed or Reversed
        if (event.event === "payout.failed" || event.event === "payout.reversed") {
          const isReversed = event.event === "payout.reversed";

          if (!isReversed && currentRetry < maxRetries) {
            dbTx.update(withdrawalDoc.ref, {
              retry_count: currentRetry + 1,
              status: "FAILED_RETRY",
              updatedAt: new Date()
            });

            const txQuery = firestore.collection("wallet_transactions")
              .where("reference_id", "==", withdrawalDoc.id)
              .limit(1);
            const txSnap = await dbTx.get(txQuery);
            if (!txSnap.empty) {
              dbTx.update(txSnap.docs[0].ref, {
                status: "FAILED_RETRY",
                updatedAt: new Date()
              });
            }
          } else {
            // BUG-06 FIX: Merge both updates to withdrawalDoc into a single call.
            // In Firestore transactions, calling transaction.update() twice on the same
            // document ref causes the second call to overwrite the first — so
            // wallet_refunded: true would have silently dropped status: "FAILED".
            const failureUpdate = {
              status: "FAILED",
              failure_reason: isReversed ? "Payout reversed by bank" : (payout.failure_reason || "Razorpay payout failed"),
              updatedAt: new Date()
            };

            if (!withdrawalData.wallet_refunded) {
              const walletQuery = firestore.collection("wallets")
                .where("user_id", "==", withdrawalData.user_id)
                .limit(1);
              const walletSnap = await dbTx.get(walletQuery);
              if (!walletSnap.empty) {
                const walletDoc = walletSnap.docs[0];
                const walletData = walletDoc.data();
                const currentBal = parseFloat(walletData.available_balance) || 0;

                dbTx.update(walletDoc.ref, {
                  available_balance: currentBal + parseFloat(withdrawalData.amount),
                  updatedAt: new Date()
                });
              }

              const refundTxRef = firestore.collection("wallet_transactions").doc();
              dbTx.set(refundTxRef, {
                user_id: withdrawalData.user_id,
                type: "CREDIT",
                amount: parseFloat(withdrawalData.amount),
                source: "REFUND",
                description: isReversed ? "Withdrawal payout reversed refund" : "Withdrawal payout failed refund",
                status: "SUCCESS",
                createdAt: new Date(),
                updatedAt: new Date()
              });

              // Include wallet_refunded in the same update as status FAILED (merged, not two separate calls)
              failureUpdate.wallet_refunded = true;
            }

            // Single atomic update on withdrawal document
            dbTx.update(withdrawalDoc.ref, failureUpdate);

            const txQuery = firestore.collection("wallet_transactions")
              .where("reference_id", "==", withdrawalDoc.id)
              .limit(1);
            const txSnap = await dbTx.get(txQuery);
            if (!txSnap.empty) {
              dbTx.update(txSnap.docs[0].ref, {
                status: "FAILED",
                description: isReversed ? "Withdrawal failed: Payout reversed by bank" : "Withdrawal failed: Razorpay payout failed",
                updatedAt: new Date()
              });
            }
          }
        }
      });
    }

    return res.json({ status: "Payout webhook processed" });
  } catch (error) {
    console.error("Payout webhook error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ===============================
// CREATE DEPOSIT ORDER (WALLET)
// ===============================
exports.createDepositOrder = asyncHandler(async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // BUG-H3 FIX: Cap maximum deposit amount to prevent abuse
    const MAX_DEPOSIT_AMOUNT = 50000;
    if (parseFloat(amount) > MAX_DEPOSIT_AMOUNT) {
      return res.status(400).json({ message: `Maximum deposit amount is ₹${MAX_DEPOSIT_AMOUNT}` });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(parseFloat(amount) * 100),
      currency: "INR",
      receipt: `dep_${Date.now()}_${userId.toString().slice(-8)}`,
      notes: {
        type: "wallet_deposit",
        user_id: userId,
      },
    });

    return res.json({
      razorpay_order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Create deposit order error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// ===============================
// VERIFY DEPOSIT (WALLET)
// ===============================
exports.verifyDeposit = asyncHandler(async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount
    } = req.body;

    const userId = req.user.id;

    // 🔐 Generate expected signature
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    // BUG-C7 FIX: Use timing-safe comparison to prevent side-channel attacks
    const dSigBuf = Buffer.from(generatedSignature, "hex");
    const dRecBuf = Buffer.from(razorpay_signature || "", "hex");
    if (dSigBuf.length !== dRecBuf.length || !crypto.timingSafeEqual(dSigBuf, dRecBuf)) {
      return res.status(400).json({
        message: "Payment verification failed - Invalid signature",
      });
    }

    let verifiedAmount = parseFloat(amount);

    // BUG-03 FIX: Removed `razorpay_payment_id.startsWith("pay_MOCK")` bypass.
    // Previously anyone could send pay_MOCK<anything> to skip amount verification
    // and credit arbitrary amounts. Now only the hardcoded dummy account number
    // (used in local dev) skips verification.
    if (process.env.RAZORPAY_ACCOUNT_NUMBER !== "2323230044556677") {
      try {
        const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
        if (!paymentDetails || paymentDetails.status !== "captured") {
          return res.status(400).json({ message: "Deposit payment was not successfully captured" });
        }

        const actualPaidAmount = parseFloat(paymentDetails.amount) / 100; // Razorpay uses paise
        if (Math.abs(actualPaidAmount - parseFloat(amount)) > 0.01) {
          return res.status(400).json({ message: "Deposit amount verification mismatch" });
        }

        verifiedAmount = actualPaidAmount;
      } catch (razorpayError) {
        console.error("Razorpay payment fetch error:", razorpayError.message);
        return res.status(400).json({ message: "Failed to verify deposit payment with Razorpay: " + razorpayError.message });
      }
    }

    const { firestore } = require("../config/firebase");
    let finalBalance = 0;

    await firestore.runTransaction(async (dbTx) => {
      // 1. Check if deposit is already processed to prevent replay attacks / double credit
      const txQuery = firestore.collection("wallet_transactions")
        .where("reference_id", "==", razorpay_payment_id)
        .limit(1);
      const txSnap = await dbTx.get(txQuery);
      if (!txSnap.empty) {
        throw new Error("Deposit already processed");
      }

      // 2. Fetch Wallet document or create on the fly
      const walletQuery = firestore.collection("wallets")
        .where("user_id", "==", userId)
        .limit(1);
      const walletSnap = await dbTx.get(walletQuery);
      
      let walletRef;
      let walletData;
      const depositAmount = verifiedAmount;
      let newBalance;

      if (walletSnap.empty) {
        walletRef = firestore.collection("wallets").doc();
        newBalance = depositAmount;
        walletData = {
          user_id: userId,
          available_balance: newBalance,
          pending_balance: 0,
          total_earned: 0,
          total_withdrawn: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        dbTx.set(walletRef, walletData);
      } else {
        const walletDoc = walletSnap.docs[0];
        walletRef = walletDoc.ref;
        const existingData = walletDoc.data();
        newBalance = (parseFloat(existingData.available_balance) || 0) + depositAmount;
        dbTx.update(walletRef, {
          available_balance: newBalance,
          updatedAt: new Date()
        });
      }
      finalBalance = newBalance;

      const txRef = firestore.collection("wallet_transactions").doc();

      dbTx.set(txRef, {
        user_id: userId,
        type: "CREDIT",
        amount: depositAmount,
        source: "DEPOSIT",
        description: "Wallet deposit via Razorpay",
        reference_id: razorpay_payment_id,
        status: "SUCCESS",
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    const depositAmount = verifiedAmount;

    // Send FCM to Customer about Wallet Deposit Credit
    try {
      const User = require("../models/user");
      const userDoc = await User.findByPk(userId);
      const customerFcm = userDoc?.fcm_token?.toString().trim();
      if (customerFcm && isFirebaseReady) {
        const depositTitle = "Wallet Credited! 💸";
        const depositBody = `₹${depositAmount.toFixed(2)} has been successfully added to your wallet.`;

        await admin.messaging().send({
          token: customerFcm,
          notification: { title: depositTitle, body: depositBody },
          data: {
            type: "WALLET_CREDITED",
            amount: String(depositAmount),
            source: "DEPOSIT"
          },
          android: {
            priority: "high",
            notification: {
              sound: "default",
              channelId: "customer_notifications",
              clickAction: "FLUTTER_NOTIFICATION_CLICK",
            },
          },
          apns: {
            headers: {
              "apns-priority": "10",
            },
            payload: {
              aps: {
                sound: "default",
                badge: 1,
              },
            },
          },
        });
        console.log(`[FCM] Sent wallet deposit credit notification to customer ${userId}`);
      }
    } catch (fcmError) {
      console.error("[FCM] Failed to send wallet deposit notification:", fcmError.message);
    }

    return res.json({
      message: "Deposit successful",
      balance: finalBalance
    });

  } catch (error) {
    console.error("Verify deposit error:", error);
    if (error.message === "Deposit already processed") {
      return res.status(400).json({ message: error.message });
    }
    if (error.message === "Wallet not found") {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: "Server error" });
  }
});
