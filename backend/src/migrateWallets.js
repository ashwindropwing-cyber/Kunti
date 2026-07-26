const { firestore, admin } = require("./config/firebase");
const MasterOrder = require("./models/masterOrder");
const Wallet = require("./models/wallet");
const WalletTransaction = require("./models/walletTransaction");
const Rider = require("./models/rider");

async function runMigration() {
  console.log("Starting wallet settlement migration...");
  try {
    const orders = await MasterOrder.findAll({
      where: { status: "DELIVERED" }
    });

    let settledCount = 0;

    for (const order of orders) {
      // If already settled, skip
      if (order.is_settled) continue;

      console.log(`Settling order ${order.id}...`);

      const totalOrderAmount = parseFloat(order.total_amount) || 0;
      const riderEarningFee = parseFloat(order.distance_fee) || 0;
      const riderTip = parseFloat(order.rider_tip) || 0;
      const sellerAmount = parseFloat(order.seller_amount) || 0;

      // 1. Rider Settlement
      if (order.rider_id) {
        const rider = await Rider.findByPk(order.rider_id);
        if (rider) {
          const riderUserId = rider.user_id;

          if (riderEarningFee > 0) {
            await WalletTransaction.create({
              user_id: riderUserId,
              type: "CREDIT",
              amount: riderEarningFee,
              source: "DELIVERY_EARNING",
              description: `Delivery fee for order ${order.id}`,
            });
          }

          if (riderTip > 0) {
            await WalletTransaction.create({
              user_id: riderUserId,
              type: "CREDIT",
              amount: riderTip,
              source: "RIDER_TIP",
              description: `Tip for order ${order.id}`,
            });
          }

          if (order.payment_method === "COD") {
            await WalletTransaction.create({
              user_id: riderUserId,
              type: "DEBIT",
              amount: totalOrderAmount,
              source: "COD_COLLECTED",
              description: `Cash collected for COD order ${order.id}`,
            });
          }

          // Fetch and update Rider Wallet Balance
          let riderWallet = await Wallet.findOne({ where: { user_id: riderUserId } });
          if (!riderWallet) {
            riderWallet = await Wallet.create({
              user_id: riderUserId,
              available_balance: 0,
              pending_balance: 0,
              total_earned: 0,
            });
          }

          let netChange = riderEarningFee + riderTip;
          if (order.payment_method === "COD") {
            netChange -= totalOrderAmount;
          }

          riderWallet.available_balance = parseFloat(riderWallet.available_balance) + netChange;
          riderWallet.total_earned = parseFloat(riderWallet.total_earned) + riderEarningFee + riderTip;
          await riderWallet.save();
        }
      }

      

      order.is_settled = true;
      await order.save();
      settledCount++;
    }

    console.log(`Migration complete. Settled ${settledCount} old orders.`);
  } catch (err) {
    console.error("Migration error:", err);
  }
}

runMigration();
