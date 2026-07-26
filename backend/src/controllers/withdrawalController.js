const WithdrawalRequest = require("../models/withdrawalRequest");
const Wallet = require("../models/wallet");
const { processPayout } = require("../services/payoutService");
const WalletTransaction = require("../models/walletTransaction");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { sendEmail } = require("../utils/sendEmail");
const User = require("../models/user");

async function reconcileMockPayout(withdrawalId, payoutId) {
  const { firestore } = require("../config/firebase");
  await firestore.runTransaction(async (dbTx) => {
    const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawalId);
    const withdrawalSnap = await dbTx.get(withdrawalRef);
    if (!withdrawalSnap.exists) return;
    
    const withdrawalData = withdrawalSnap.data();
    
    dbTx.update(withdrawalRef, {
      status: "SUCCESS",
      razorpay_payout_id: payoutId,
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
      .where("reference_id", "==", withdrawalId)
      .limit(1);
    const txSnap = await dbTx.get(txQuery);
    if (!txSnap.empty) {
      dbTx.update(txSnap.docs[0].ref, {
        status: "SUCCESS",
        description: `Withdrawal payout successful: ₹${withdrawalData.amount}`,
        updatedAt: new Date()
      });
    }
  });
}


// ===============================
// REQUEST WITHDRAWAL
// ===============================
exports.requestWithdrawal = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;
  const { firestore } = require("../config/firebase");

  const wallet = await Wallet.findOne({
    where: { user_id: userId },
  });

  if (!wallet) {
    return ApiResponse.error(res, "Wallet not found", 400);
  }

  const withdrawAmount = parseFloat(amount);

  try {
    const { withdrawalId, withdrawalData } = await firestore.runTransaction(async (dbTransaction) => {
      // BUG-02 FIX: Query the Firestore wallet by user_id INSIDE the transaction.
      // Previously used firestore.collection("wallets").doc(wallet.id) where wallet.id
      // is the MySQL primary key — which does NOT match the Firestore auto-generated
      // document ID. This caused the transaction to lock and debit the wrong (nonexistent)
      // document. Using a user_id query inside the transaction also makes the balance
      // read atomic with the subsequent debit write, eliminating the race condition.
      const walletFsQuery = firestore.collection("wallets").where("user_id", "==", userId).limit(1);
      const walletFsSnap = await dbTransaction.get(walletFsQuery);
      if (walletFsSnap.empty) {
        throw new Error("Wallet not found in database");
      }
      const walletRef = walletFsSnap.docs[0].ref;
      const walletData = walletFsSnap.docs[0].data();

      let walletAvailableBalance = parseFloat(walletData.available_balance) || 0;
      let walletTotalEarned = parseFloat(walletData.total_earned) || 0;
      let walletPendingBalance = parseFloat(walletData.pending_balance) || 0;

      // Get minimum withdrawal setting
      const PlatformSettings = require("../models/platformSettings");
      const settingsList = await PlatformSettings.findAll({
        where: { key: "min_withdrawal_amount" }
      });
      const minWithdrawSetting = settingsList.length > 0 ? settingsList[settingsList.length - 1] : null;
      const minWithdrawAmount = minWithdrawSetting ? parseFloat(minWithdrawSetting.value) : 500;

      const isCustomer = req.user.role === "CUSTOMER";
      if (isNaN(withdrawAmount) || (withdrawAmount <= 0) || (!isCustomer && withdrawAmount < minWithdrawAmount)) {
        throw new Error(isCustomer ? "Amount must be greater than 0" : `Minimum withdrawal amount is ₹${minWithdrawAmount}`);
      }

      if (walletAvailableBalance < withdrawAmount) {
        throw new Error("Insufficient balance. Available: ₹" + walletAvailableBalance.toFixed(0));
      }

      
      // Skip bank account requirement for now since SellerBankAccount is removed
      const bank = { account_number: "N/A", ifsc_code: "N/A", account_holder_name: "N/A", bank_name: "N/A" };

      // Deduct balance and stage updates
      const newAvailableBalance = walletAvailableBalance - withdrawAmount;

      const withdrawalRef = firestore.collection("withdrawal_requests").doc();
      const transactionRef = firestore.collection("wallet_transactions").doc();

      const newWithdrawalData = {
        user_id: userId,
        amount: withdrawAmount,
        account_name: bank.account_name,
        account_number: bank.account_number,
        bank_name: bank.bank_name,
        ifsc: bank.ifsc,
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const newTransactionData = {
        user_id: userId,
        type: "DEBIT",
        amount: withdrawAmount,
        source: "WITHDRAWAL",
        description: `Withdrawal request for ₹${withdrawAmount}`,
        status: "PENDING",
        reference_id: withdrawalRef.id,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      dbTransaction.update(walletRef, {
        available_balance: newAvailableBalance,
        total_earned: walletTotalEarned,
        pending_balance: walletPendingBalance,
        updatedAt: new Date()
      });

      dbTransaction.set(withdrawalRef, newWithdrawalData);
      dbTransaction.set(transactionRef, newTransactionData);

      return {
        withdrawalId: withdrawalRef.id,
        withdrawalData: newWithdrawalData
      };
    });

    const isDirectPayout = req.user.role === "ADMIN" || req.user.role === "CUSTOMER";
    let withdrawalResult = { id: withdrawalId, ...withdrawalData };

    // 🚀 processPayout executed safely OUTSIDE transaction blocks
    if (isDirectPayout) {
      try {
        const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawalId);
        await withdrawalRef.update({
          status: "PROCESSING",
          updatedAt: new Date()
        });
        withdrawalResult.status = "PROCESSING";

        const txs = await WalletTransaction.findAll({
          where: { reference_id: withdrawalId }
        });
        if (txs.length > 0) {
          txs[0].status = "PROCESSING";
          await txs[0].save();
        }

        const payout = await processPayout(withdrawalResult);

        if (payout.id && payout.id.startsWith("pout_MOCK")) {
          await reconcileMockPayout(withdrawalId, payout.id);
          withdrawalResult.status = "SUCCESS";
          withdrawalResult.razorpay_payout_id = payout.id;
          return ApiResponse.success(res, withdrawalResult, "Withdrawal processed and payout initiated successfully (Mock Mode Auto-reconciled).");
        }

        await withdrawalRef.update({
          razorpay_payout_id: payout.id,
          updatedAt: new Date()
        });
        withdrawalResult.razorpay_payout_id = payout.id;

        return ApiResponse.success(res, withdrawalResult, "Withdrawal processed and payout initiated successfully.");
      } catch (payoutErr) {
        console.error("Direct Payout Failed:", payoutErr.message);
        const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawalId);

        if (req.user.role === "CUSTOMER") {
          // Find transaction record first to get its document ID
          const txs = await WalletTransaction.findAll({
            where: { reference_id: withdrawalId }
          });
          const txId = txs.length > 0 ? txs[0].id : null;

          await firestore.runTransaction(async (dbTx) => {
            // BUG-C5 FIX: Use user_id query instead of doc(wallet.id) — wallet.id is the MySQL PK, not the Firestore doc ID
            const walletQuery = firestore.collection("wallets").where("user_id", "==", req.user.id).limit(1);
            const walletSnap = await dbTx.get(walletQuery);
            if (!walletSnap.empty) {
              const walletDoc = walletSnap.docs[0];
              const currentBal = parseFloat(walletDoc.data().available_balance) || 0;
              dbTx.update(walletDoc.ref, {
                available_balance: currentBal + withdrawAmount,
                updatedAt: new Date()
              });
            }

            // Update withdrawal status to FAILED
            dbTx.update(withdrawalRef, {
              status: "FAILED",
              failure_reason: payoutErr.message,
              updatedAt: new Date()
            });

            // Update transaction status to FAILED
            if (txId) {
              const txRef = firestore.collection("wallet_transactions").doc(txId);
              dbTx.update(txRef, {
                status: "FAILED",
                description: `Withdrawal failed: ${payoutErr.message}`,
                updatedAt: new Date()
              });
            }
          });

          withdrawalResult.status = "FAILED";
          withdrawalResult.failure_reason = payoutErr.message;
          return ApiResponse.error(res, `Payout failed: ${payoutErr.message}`, 400);
        }

        // Revert back to PENDING for Admin
        await withdrawalRef.update({
          status: "PENDING",
          updatedAt: new Date()
        });
        withdrawalResult.status = "PENDING";
        return ApiResponse.error(res, `Payout failed: ${payoutErr.message}`, 400);
      }
    }

    return ApiResponse.success(res, withdrawalResult, "Withdrawal request submitted. Awaiting admin approval.");

  } catch (error) {
    console.error("Withdrawal Request Error:", error);
    return ApiResponse.error(res, error.message || "Withdrawal request failed", 400);
  }
});


// ===============================
// ADMIN APPROVE WITHDRAWAL
// ===============================
exports.approveWithdrawal = asyncHandler(async (req, res) => {
  const { withdrawal_id } = req.body;
  const { firestore } = require("../config/firebase");

  try {
    let withdrawalObj = null;

    // 🔒 Atomically change status to PROCESSING to prevent concurrent approvals
    await firestore.runTransaction(async (transaction) => {
      const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawal_id);
      const withdrawalSnap = await transaction.get(withdrawalRef);

      if (!withdrawalSnap.exists) {
        throw new Error("Invalid withdrawal request");
      }

      const withdrawalData = withdrawalSnap.data();

      if (withdrawalData.status !== "PENDING") {
        throw new Error("Withdrawal is no longer pending");
      }

      transaction.update(withdrawalRef, {
        status: "PROCESSING",
        updatedAt: new Date()
      });

      const txQuery = firestore.collection("wallet_transactions")
        .where("reference_id", "==", withdrawal_id)
        .limit(1);
      const txSnap = await transaction.get(txQuery);
      if (!txSnap.empty) {
        transaction.update(txSnap.docs[0].ref, {
          status: "PROCESSING",
          updatedAt: new Date()
        });
      }

      withdrawalObj = { id: withdrawal_id, ...withdrawalData, status: "PROCESSING" };
    });

    // 🚀 Execute processPayout safely OUTSIDE transaction block
    const payout = await processPayout(withdrawalObj);

    const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawal_id);
    const isMock = payout.id && payout.id.startsWith("pout_MOCK");

    if (isMock) {
      await reconcileMockPayout(withdrawal_id, payout.id);
      withdrawalObj.status = "SUCCESS";
    } else {
      await withdrawalRef.update({
        razorpay_payout_id: payout.id,
        updatedAt: new Date()
      });
    }
    withdrawalObj.razorpay_payout_id = payout.id;

    // Send Email Notification
    try {
      const user = await User.findByPk(withdrawalObj.user_id);
      if (user && user.email) {
        await sendEmail({
          to: user.email,
          subject: isMock ? "TIND Withdrawal Successful! 🎉" : "TIND Withdrawal Initiated! 💸",
          text: isMock
            ? `Your withdrawal request for ₹${parseFloat(withdrawalObj.amount).toFixed(2)} has been successfully processed.`
            : `Your withdrawal request for ₹${parseFloat(withdrawalObj.amount).toFixed(2)} has been approved and payout is being processed.`,
          html: `
            <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 600px; margin: auto; border: 1px solid #E5E7EB; border-radius: 16px; background-color: #FFFFFF;">
              <h2 style="color: #10B981; margin-bottom: 16px; font-weight: 800;">${isMock ? "WITHDRAWAL SUCCESSFUL! 🎉" : "WITHDRAWAL PROCESSING! 💸"}</h2>
              <p style="font-size: 16px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">${isMock ? "Your withdrawal request has been successfully processed and transferred to your bank account." : "Your withdrawal request has been approved and payout is currently being processed by the bank."}</p>
              <div style="background-color: #ECFDF5; padding: 16px; border-radius: 12px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 14px; color: #065F46;"><strong>Amount:</strong> ₹${parseFloat(withdrawalObj.amount).toFixed(2)}</p>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #065F46;"><strong>Bank Name:</strong> ${withdrawalObj.bank_name}</p>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #065F46;"><strong>Account Number:</strong> ${withdrawalObj.account_number ? ("****" + withdrawalObj.account_number.slice(-4)) : "****"}</p>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #065F46;"><strong>Status:</strong> ${isMock ? "Success" : "Processing (Payout Initiated)"}</p>
              </div>
              <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin: 0;">This is an automated notification from Tind. Please do not reply.</p>
            </div>
          `
        });
      }
    } catch (emailErr) {
      console.error("Failed to send withdrawal approval email:", emailErr.message);
    }

    return ApiResponse.success(res, withdrawalObj, isMock ? "Withdrawal approved and payout successful (Mock Mode Auto-reconciled)" : "Withdrawal approved and payout initiated");
  } catch (error) {
    console.error("❌ Withdrawal Approval Error:", error);
    try {
      // BUG-12 FIX: Revert BOTH MySQL AND Firestore when payout fails.
      // Previously only MySQL was reverted, leaving Firestore stuck in PROCESSING.
      const withdrawal = await WithdrawalRequest.findByPk(withdrawal_id);
      if (withdrawal && withdrawal.status === "PROCESSING" && !withdrawal.razorpay_payout_id) {
        // Revert MySQL
        withdrawal.status = "PENDING";
        await withdrawal.save();

        // Revert Firestore
        const { firestore: fs } = require("../config/firebase");
        await fs.collection("withdrawal_requests").doc(withdrawal_id).update({
          status: "PENDING",
          updatedAt: new Date()
        });

        const transaction = await WalletTransaction.findOne({
          where: { reference_id: withdrawal_id }
        });
        if (transaction && transaction.status === "PROCESSING") {
          transaction.status = "PENDING";
          await transaction.save();
        }
      }
    } catch (dbErr) {
      console.error("Failed to revert status to PENDING on error:", dbErr.message);
    }
    return ApiResponse.error(res, error.message || "Payout failed", 400);
  }
});


// ===============================
// MY WITHDRAWAL HISTORY
// ===============================
exports.getMyWithdrawals = asyncHandler(async (req, res) => {
  // Fetch without order to avoid Firestore composite index requirement
  const withdrawals = await WithdrawalRequest.findAll({
    where: { user_id: req.user.id },
  });
  // Sort in-memory by createdAt descending
  withdrawals.sort((a, b) => {
    const dateA = a.createdAt instanceof Date ? a.createdAt :
      (a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate() : new Date(a.createdAt || 0));
    const dateB = b.createdAt instanceof Date ? b.createdAt :
      (b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate() : new Date(b.createdAt || 0));
    return dateB - dateA;
  });
  return ApiResponse.success(res, withdrawals);
});

exports.getAllWithdrawals = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const whereCondition = {};
  if (status) {
    whereCondition.status = status;
  } else {
    whereCondition.status = "PENDING";
  }

  const withdrawals = await WithdrawalRequest.findAll({
    where: whereCondition,
    order: [["createdAt", "DESC"]],
  });

  return ApiResponse.success(res, withdrawals);
});
