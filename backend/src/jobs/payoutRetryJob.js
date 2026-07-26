const cron = require("node-cron");


const WithdrawalRequest = require("../models/withdrawalRequest");
const { processPayout } = require("../services/payoutService");

const RETRY_DELAY_MINUTES = 5;
const BATCH_LIMIT = 20; // prevent heavy load

cron.schedule("*/10 * * * *", async () => {
  console.log("🔄 Running payout retry job...");

  try {
    const now = new Date();
    const retryTime = new Date(now.getTime() - RETRY_DELAY_MINUTES * 60 * 1000);

    // Use simple single-field query to avoid Firestore composite index requirement
    const allFailedRetry = await WithdrawalRequest.findAll({
      where: { status: "FAILED_RETRY" },
    });

    // Filter and sort in-memory
    const withdrawals = allFailedRetry
      .filter((w) => {
        const updatedAt = w.updatedAt instanceof Date ? w.updatedAt :
          (w.updatedAt && typeof w.updatedAt.toDate === 'function' ? w.updatedAt.toDate() : new Date(w.updatedAt));
        return updatedAt < retryTime;
      })
      .sort((a, b) => {
        const dateA = a.updatedAt instanceof Date ? a.updatedAt : new Date(a.updatedAt);
        const dateB = b.updatedAt instanceof Date ? b.updatedAt : new Date(b.updatedAt);
        return dateA - dateB;
      })
      .slice(0, BATCH_LIMIT);


    for (const withdrawal of withdrawals) {
      try {
        console.log("Retrying withdrawal:", withdrawal.id);

        const { firestore } = require("../config/firebase");
        let withdrawalObj = null;

        // 🔒 Lock status to PROCESSING inside a Firestore transaction before processing
        try {
          await firestore.runTransaction(async (dbTx) => {
            const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawal.id);
            const snap = await dbTx.get(withdrawalRef);
            if (!snap.exists) throw new Error("Withdrawal not found");
            const data = snap.data();
            if (data.status !== "FAILED_RETRY") {
              throw new Error("Withdrawal status is not FAILED_RETRY");
            }

            dbTx.update(withdrawalRef, {
              status: "PROCESSING",
              updatedAt: new Date()
            });

            const txQuery = firestore.collection("wallet_transactions")
              .where("reference_id", "==", withdrawal.id)
              .limit(1);
            const txSnap = await dbTx.get(txQuery);
            if (!txSnap.empty) {
              dbTx.update(txSnap.docs[0].ref, {
                status: "PROCESSING",
                updatedAt: new Date()
              });
            }

            withdrawalObj = { id: withdrawal.id, ...data, status: "PROCESSING" };
          });
        } catch (lockErr) {
          console.log(`Withdrawal ${withdrawal.id} already processed or status changed:`, lockErr.message);
          continue;
        }

        // 🚀 processPayout executed safely OUTSIDE transaction blocks
        const payout = await processPayout(withdrawalObj);

        if (payout.id && payout.id.startsWith("pout_MOCK")) {
          const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawal.id);
          await firestore.runTransaction(async (dbTx) => {
            const withdrawalSnap = await dbTx.get(withdrawalRef);
            if (!withdrawalSnap.exists) return;
            const withdrawalData = withdrawalSnap.data();

            dbTx.update(withdrawalRef, {
              status: "SUCCESS",
              razorpay_payout_id: payout.id,
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
              .where("reference_id", "==", withdrawal.id)
              .limit(1);
            const txSnap = await dbTx.get(txQuery);
            if (!txSnap.empty) {
              dbTx.update(txSnap.docs[0].ref, {
                status: "SUCCESS",
                description: `Withdrawal payout successful (Mock Mode): ₹${withdrawalData.amount}`,
                updatedAt: new Date()
              });
            }
          });
          console.log("✅ Retry success (Mock Mode Auto-reconciled):", withdrawal.id);
        } else {
          const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawal.id);
          await withdrawalRef.update({
            razorpay_payout_id: payout.id,
            updatedAt: new Date()
          });
          console.log("✅ Retry success (Initiated):", withdrawal.id);
        }

      } catch (error) {
        console.log("❌ Retry failed:", withdrawal.id, error.message);
        try {
          const { firestore } = require("../config/firebase");
          
          // 🔒 Update retry count or finalize failure and refund inside a transaction
          await firestore.runTransaction(async (dbTx) => {
            const withdrawalRef = firestore.collection("withdrawal_requests").doc(withdrawal.id);
            const snap = await dbTx.get(withdrawalRef);
            if (!snap.exists) return;
            const data = snap.data();

            const maxRetries = Number(data.max_retries) || 3;
            const currentRetries = Number(data.retry_count) || 0;

            if (currentRetries < maxRetries) {
              dbTx.update(withdrawalRef, {
                retry_count: currentRetries + 1,
                status: "FAILED_RETRY",
                updatedAt: new Date()
              });

              const txQuery = firestore.collection("wallet_transactions")
                .where("reference_id", "==", withdrawal.id)
                .limit(1);
              const txSnap = await dbTx.get(txQuery);
              if (!txSnap.empty) {
                dbTx.update(txSnap.docs[0].ref, {
                  status: "FAILED_RETRY",
                  updatedAt: new Date()
                });
              }
            } else {
              dbTx.update(withdrawalRef, {
                status: "FAILED",
                failure_reason: error.message,
                updatedAt: new Date()
              });

              if (!data.wallet_refunded) {
                const walletQuery = firestore.collection("wallets")
                  .where("user_id", "==", data.user_id)
                  .limit(1);
                const walletSnap = await dbTx.get(walletQuery);
                if (!walletSnap.empty) {
                  const walletDoc = walletSnap.docs[0];
                  const walletData = walletDoc.data();
                  const currentBal = parseFloat(walletData.available_balance) || 0;
                  
                  dbTx.update(walletDoc.ref, {
                    available_balance: currentBal + parseFloat(data.amount),
                    updatedAt: new Date()
                  });
                }

                const refundTxRef = firestore.collection("wallet_transactions").doc();
                dbTx.set(refundTxRef, {
                  user_id: data.user_id,
                  type: "CREDIT",
                  amount: parseFloat(data.amount),
                  source: "REFUND",
                  description: `Withdrawal payout failed: ${error.message}`,
                  status: "SUCCESS",
                  createdAt: new Date(),
                  updatedAt: new Date()
                });

                dbTx.update(withdrawalRef, {
                  wallet_refunded: true,
                  updatedAt: new Date()
                });
              }

              const txQuery = firestore.collection("wallet_transactions")
                .where("reference_id", "==", withdrawal.id)
                .limit(1);
              const txSnap = await dbTx.get(txQuery);
              if (!txSnap.empty) {
                dbTx.update(txSnap.docs[0].ref, {
                  status: "FAILED",
                  description: `Withdrawal failed: ${error.message}`,
                  updatedAt: new Date()
                });
              }
            }
          });
        } catch (dbErr) {
          console.error("Failed to update status on retry error:", dbErr.message);
        }
      }
    }


  } catch (error) {
    console.error("Payout retry cron error:", error);
  }
});
