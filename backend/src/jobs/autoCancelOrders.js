const cron = require("node-cron");
const MasterOrder = require("../models/masterOrder");
const OrderItem = require("../models/orderItem");
const Product = require("../models/product");


const PAYMENT_TIMEOUT_MIN = 10;
const RETRY_WINDOW_MIN = 10;

cron.schedule("*/10 * * * *", async () => {
  console.log("🔍 Checking unpaid ONLINE orders...");
  try {
    const now = new Date();

    // 1️⃣ Initial timeout → Move to PAYMENT_EXPIRED
    // Use simple single-field query to avoid Firestore composite index requirement
    const placedOnlineOrders = await MasterOrder.findAll({
      where: { payment_method: "ONLINE" },
    });

    // Filter in-memory for compound conditions
    const expiredPendingOrders = placedOnlineOrders.filter((order) => {
      if (order.payment_status !== "PENDING" || order.status !== "PLACED") return false;
      const createdAt = order.createdAt instanceof Date ? order.createdAt :
        (order.createdAt && typeof order.createdAt.toDate === 'function' ? order.createdAt.toDate() : new Date(order.createdAt));
      return createdAt < new Date(now.getTime() - PAYMENT_TIMEOUT_MIN * 60 * 1000);
    });

    for (const order of expiredPendingOrders) {
      try {
        const lockedOrder = await MasterOrder.findByPk(order.id);

        if (
          !lockedOrder ||
          lockedOrder.payment_method !== "ONLINE" ||
          lockedOrder.payment_status !== "PENDING" ||
          lockedOrder.status !== "PLACED"
        ) {
          continue;
        }

        console.log(`⏳ Marking order ${lockedOrder.id} as PAYMENT_EXPIRED`);
        lockedOrder.status = "PAYMENT_EXPIRED";
        lockedOrder.payment_status = "FAILED";
        lockedOrder.payment_expired_at = new Date();
        await lockedOrder.save();
      } catch (error) {
        console.error("Auto cancel step-1 error:", error);
      }
    }


    // 2️⃣ Retry window expired → Final cancel + restore stock
    // Use simple query and filter in-memory to avoid Firestore composite index
    const paymentExpiredOrders = await MasterOrder.findAll({
      where: { status: "PAYMENT_EXPIRED" },
    });

    const fullyExpiredOrders = paymentExpiredOrders.filter((order) => {
      if (!order.payment_expired_at) return false;
      const expiredAt = order.payment_expired_at instanceof Date ? order.payment_expired_at :
        (order.payment_expired_at && typeof order.payment_expired_at.toDate === 'function' ? order.payment_expired_at.toDate() : new Date(order.payment_expired_at));
      return expiredAt < new Date(now.getTime() - RETRY_WINDOW_MIN * 60 * 1000);
    });

    for (const order of fullyExpiredOrders) {
      try {
        const lockedOrder = await MasterOrder.findByPk(order.id);

        if (!lockedOrder || lockedOrder.status !== "PAYMENT_EXPIRED") {
          continue;
        }

        console.log(`❌ Permanently cancelling order ${lockedOrder.id}`);
        const orderController = require("../controllers/orderController");
        await orderController.executeOrderCancellation(lockedOrder, "Payment session timeout", "SYSTEM");
      } catch (error) {
        console.error("Auto cancel step-2 error:", error);
      }
    }

  } catch (error) {
    console.error("Auto cancel error:", error);
  }
});
