const cron = require("node-cron");
const { Op } = require("sequelize");
const { MasterOrder, sequelize } = require("../models");
const { restoreOrderInventoryAndCoupon } = require("../controllers/orderController");

const PAYMENT_TIMEOUT_MIN = 15;

cron.schedule("*/10 * * * *", async () => {
  console.log("🔍 Checking unpaid ONLINE orders...");
  try {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - PAYMENT_TIMEOUT_MIN * 60 * 1000);

    const expiredOrders = await MasterOrder.findAll({
      where: {
        payment_method: "ONLINE",
        payment_status: "PENDING",
        status: "PLACED",
        createdAt: { [Op.lt]: cutoffTime },
      },
    });

    for (const order of expiredOrders) {
      try {
        console.log(`⏳ Auto-cancelling unpaid order ${order.order_number}`);
        await sequelize.transaction(async (t) => {
          order.status = "CANCELLED";
          order.payment_status = "FAILED";
          order.cancelled_by = "SYSTEM";
          order.cancel_reason = "Payment timeout (unpaid online order)";
          await order.save({ transaction: t });
          await restoreOrderInventoryAndCoupon(order, t);
        });
      } catch (error) {
        console.error(`Auto-cancel error for order ${order.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error("Auto cancel job error:", error.message);
  }
});
