const cron = require("node-cron");


const MasterOrder = require("../models/masterOrder");
const cloudinary = require("../config/cloudinary");
const BATCH_SIZE = 100;

// Runs daily at 3 AM — cleans up old POD images from Cloudinary to save storage
cron.schedule("0 3 * * *", async () => {
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // Fetch ALL delivered orders ONCE (not per-batch like before)
    const allDeliveredOrders = await MasterOrder.findAll({
      where: { status: "DELIVERED" }
    });

    // Filter in-memory to find orders with old POD images
    const eligibleOrders = allDeliveredOrders.filter(order => {
      if (!order.pod_image) return false;
      const deliveredAt = order.delivered_at instanceof Date ? order.delivered_at :
        (order.delivered_at && typeof order.delivered_at.toDate === 'function' ? order.delivered_at.toDate() : new Date(order.delivered_at));
      return deliveredAt < cutoff;
    });

    if (eligibleOrders.length === 0) {
      console.log("[POD Cleanup] No old POD images found.");
      return;
    }

    console.log(`[POD Cleanup] Found ${eligibleOrders.length} old POD images to clean up.`);

    // Process in batches to avoid overwhelming Cloudinary
    let cleaned = 0;
    for (let i = 0; i < eligibleOrders.length && i < BATCH_SIZE * 20; i++) {
      const order = eligibleOrders[i];
      const imageUrl = order.pod_image || "";
      const marker = "/upload/";
      const uploadIndex = imageUrl.indexOf(marker);

      if (uploadIndex === -1) continue;

      const publicIdWithExt = imageUrl
        .slice(uploadIndex + marker.length)
        .split("?")[0];
      const publicId = publicIdWithExt.replace(/\.[^/.]+$/, "");

      if (!publicId.startsWith("tind_pod/")) continue;

      try {
        await cloudinary.uploader.destroy(publicId, {
          resource_type: "image",
          type: "upload",
          invalidate: true,
        });
        order.pod_image = null;
        await order.save();
        cleaned++;
      } catch (error) {
        console.error("POD cleanup failed:", order.id, error.message);
      }
    }

    console.log(`[POD Cleanup] Cleaned ${cleaned} POD images.`);
  } catch (error) {
    console.error("POD cleanup cron error:", error);
  }
});
