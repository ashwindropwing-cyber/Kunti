/**
 * Stuck Order Recovery Job
 * 
 * Safety net for orders that get stuck in PLACED status:
 * 1. For orders older than 30 minutes, automatically cancels them,
 *    restores product stock, and refunds the customer's wallet (if paid ONLINE).
 * 2. For orders older than 8 minutes but under 30 minutes with no rider assigned
 *    and no active offer, resets their rejection list and re-dispatches them.
 * 
 * Runs every 5 minutes.
 */
const cron = require("node-cron");
const MasterOrder = require("../models/masterOrder");

const STUCK_THRESHOLD_MIN = 8;
const AUTO_CANCEL_THRESHOLD_MIN = 30;
const BATCH_LIMIT = 20;

cron.schedule("*/5 * * * *", async () => {
  try {
    const nowMs = Date.now();
    const stuckCutoff = new Date(nowMs - STUCK_THRESHOLD_MIN * 60 * 1000);
    const cancelCutoff = new Date(nowMs - AUTO_CANCEL_THRESHOLD_MIN * 60 * 1000);

    // Fetch all PLACED orders (simple single-field query to avoid Firestore index issues)
    const placedOrders = await MasterOrder.findAll({
      where: { status: "PLACED" },
    });

    const getOrderCreatedAt = (order) => {
      return order.createdAt instanceof Date
        ? order.createdAt
        : (order.createdAt && typeof order.createdAt.toDate === "function"
          ? order.createdAt.toDate()
          : new Date(order.createdAt));
    };

    // Lazy-load to avoid circular dependency
    const orderController = require("../controllers/orderController");

    // 1️⃣ Auto-cancel orders older than 30 minutes
    const ordersToCancel = placedOrders.filter((order) => {
      const createdAt = getOrderCreatedAt(order);
      return createdAt < cancelCutoff;
    });

    for (const order of ordersToCancel) {
      try {
        console.log(`🔧 [StuckOrderRecovery] Auto-cancelling order ${order.id} due to no rider accepting for 30 minutes.`);
        await orderController.executeOrderCancellation(
          order,
          "No riders accepted the order within 30 minutes",
          "SYSTEM"
        );
      } catch (err) {
        console.error(`🔧 [StuckOrderRecovery] Failed to auto-cancel order ${order.id}:`, err.message);
      }
    }

    // 2️⃣ Re-dispatch orders older than 8 minutes but newer than 30 minutes
    const stuckOrders = placedOrders.filter((order) => {
      // Must not have a rider assigned
      if (order.rider_id) return false;

      // Must not have an active offer (someone is currently deciding)
      if (order.offered_rider_id) return false;

      // For ONLINE and WALLET orders, they must be successfully paid to be recovered/dispatched
      if (["ONLINE", "WALLET"].includes(order.payment_method) && order.payment_status !== "PAID") return false;

      const createdAt = getOrderCreatedAt(order);
      return createdAt < stuckCutoff && createdAt >= cancelCutoff;
    }).slice(0, BATCH_LIMIT);

    if (stuckOrders.length === 0) return;

    console.log(`🔧 [StuckOrderRecovery] Found ${stuckOrders.length} stuck orders. Re-dispatching...`);

    for (const order of stuckOrders) {
      try {
        const createdAt = getOrderCreatedAt(order);
        const ageMin = Math.round((Date.now() - createdAt.getTime()) / 60000);
        console.log(`🔧 [StuckOrderRecovery] Re-dispatching order ${order.id} (age: ${ageMin}min). Resetting rejected rider list.`);
        
        // Reset the rejected rider IDs so they can be offered/notified again
        order.rider_rejected_ids = JSON.stringify([]);
        await order.save();

        await orderController.dispatchOrderToRiders(order.id, false);
      } catch (err) {
        console.error(`🔧 [StuckOrderRecovery] Failed to re-dispatch order ${order.id}:`, err.message);
      }
    }
  } catch (error) {
    console.error("🔧 [StuckOrderRecovery] Cron error:", error.message);
  }
});
