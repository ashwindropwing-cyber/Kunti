const razorpay = require("../config/razorpay");

exports.processPayout = async (withdrawal) => {
  try {

    if (!withdrawal) {
      throw new Error("Withdrawal object missing");
    }

    if (!process.env.RAZORPAY_ACCOUNT_NUMBER) {
      throw new Error("Razorpay Account Number (Virtual Account) is not configured in .env");
    }

    if (!withdrawal.account_number || !withdrawal.ifsc) {
      throw new Error("Invalid bank details for payout");
    }

    // 🔧 MOCK MODE for dummy credentials
    if (process.env.RAZORPAY_ACCOUNT_NUMBER === "2323230044556677") {
      console.log("⚠️  MOCK PAYOUT: Using dummy credentials. Returning fake success.");
      return { id: "pout_MOCK" + Date.now(), status: "processed" };
    }

    const amount = Math.round(parseFloat(withdrawal.amount) * 100);

    // idempotency key prevents duplicate payouts
    const idempotencyKey = `withdrawal_${withdrawal.id}`;

    const payout = await razorpay.payouts.create(
      {
        account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
        amount: amount,
        currency: "INR",

        mode: process.env.RAZORPAY_PAYOUT_MODE || "IMPS",

        purpose: "payout",

        reference_id: withdrawal.id,

        narration: `Withdrawal ${withdrawal.id}`,

        fund_account: {
          account_type: "bank_account",
          bank_account: {
            name: withdrawal.account_name,
            ifsc: withdrawal.ifsc,
            account_number: withdrawal.account_number,
          },
        },
      },
      {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      }
    );

    console.log("✅ Payout created:", payout.id);

    return payout;

  } catch (error) {

    if (error.response) {
      console.error("❌ Razorpay payout error:", {
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      console.error("❌ Payout service error:", error.message);
    }

    throw error;
  }
};