const cron = require("node-cron");
const { Op } = require("sequelize");
const { MasterOrder, sequelize } = require("../models");
const { restoreOrderInventoryAndCoupon } = require("../controllers/orderController");

const AUTO_CANCEL_THRESHOLD_MIN = 60; // Auto-cancel unaccepted orders after 60 min

cron.schedule("*/15 * * * *", async () => {
  try {
    const cutoffTime = new Date(Date.now() - AUTO_CANCEL_THRESHOLD_MIN * 60 * 1000);

    const stuckOrders = await MasterOrder.findAll({
      where: {
        status: "PLACED",
        createdAt: { [Op.lt]: cutoffTime },
      },
    });

    for (const order of stuckOrders) {
      try {
        console.log(`🔧 [StuckOrderRecovery] Auto-cancelling unaccepted order ${order.order_number}`);
        await sequelize.transaction(async (t) => {
          order.status = "CANCELLED";
          order.cancelled_by = "SYSTEM";
          order.cancel_reason = "Order unaccepted past threshold (auto-recovery)";
          await order.save({ transaction: t });
          await restoreOrderInventoryAndCoupon(order, t);
        });
      } catch (err) {
        console.error(`🔧 [StuckOrderRecovery] Error cancelling order ${order.id}:`, err.message);
      }
    }
  } catch (error) {
    console.error("🔧 [StuckOrderRecovery] Job error:", error.message);
  }
});
