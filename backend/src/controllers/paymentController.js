const razorpay = require("../config/razorpay");
const crypto = require("crypto");
const { MasterOrder } = require("../models");
const orderController = require("./orderController");

// ===============================
// CREATE RAZORPAY ORDER
// ===============================
exports.createPaymentOrder = async (req, res) => {
  try {
    const { master_order_id } = req.body;

    const order = await MasterOrder.findByPk(master_order_id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: "Access denied: order does not belong to you" });
    }

    if (order.payment_method !== "ONLINE") {
      return res.status(400).json({ message: "Payment not required for COD orders" });
    }

    if (order.payment_status === "PAID") {
      return res.status(400).json({ message: "Order already paid" });
    }

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
    const { master_order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    let order;
    if (master_order_id) {
      order = await MasterOrder.findByPk(master_order_id);
    } else if (razorpay_order_id) {
      order = await MasterOrder.findOne({ where: { razorpay_order_id } });
    }

    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: "Access denied: order does not belong to you" });
    }

    if (order.payment_status === "PAID") {
      return res.json({ message: "Payment already verified" });
    }

    if (!order.razorpay_order_id || order.razorpay_order_id !== razorpay_order_id) {
      return res.status(400).json({ message: "Payment verification failed - razorpay_order_id mismatch" });
    }

    // Verify signature
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET || "dummysecret")
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    const sigBuffer = Buffer.from(generatedSignature, "hex");
    const receivedBuffer = Buffer.from(razorpay_signature || "", "hex");
    if (sigBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(sigBuffer, receivedBuffer)) {
      order.status = "CANCELLED";
      order.payment_status = "FAILED";
      await order.save();

      return res.status(400).json({ message: "Payment verification failed - Invalid signature" });
    }

    order.payment_status = "PAID";
    order.razorpay_payment_id = razorpay_payment_id;
    if (order.status === "PAYMENT_EXPIRED" || order.status === "PENDING") {
      order.status = "PLACED";
    }
    await order.save();

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

// ===============================
// RETRY PAYMENT
// ===============================
exports.retryPayment = async (req, res) => {
  try {
    const { master_order_id } = req.body;
    const order = await MasterOrder.findByPk(master_order_id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.user_id !== req.user.id) {
      return res.status(403).json({ message: "Access denied: order does not belong to you" });
    }

    if (order.payment_status === "PAID") {
      return res.status(400).json({ message: "Order is already paid" });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(order.total_amount * 100),
      currency: "INR",
      receipt: order.id,
    });

    order.razorpay_order_id = razorpayOrder.id;
    order.payment_status = "PENDING";
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
      .createHmac("sha256", secret || "dummysecret")
      .update(rawBody)
      .digest("hex");

    const razorpaySignature = req.headers["x-razorpay-signature"];
    const sigBuf = Buffer.from(generatedSignature, "hex");
    const recBuf = Buffer.from(razorpaySignature || "", "hex");
    if (sigBuf.length !== recBuf.length || !crypto.timingSafeEqual(sigBuf, recBuf)) {
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch (parseError) {
      return res.status(400).json({ message: "Invalid webhook JSON payload" });
    }

    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity;
      const order = await MasterOrder.findOne({ where: { razorpay_order_id: payment.order_id } });
      if (order) {
        order.payment_status = "PAID";
        order.razorpay_payment_id = payment.id;
        if (order.status === "PENDING" || order.status === "PAYMENT_EXPIRED") {
          order.status = "PLACED";
        }
        await order.save();
      }
    }

    if (event.event === "payment.failed") {
      const payment = event.payload.payment.entity;
      const order = await MasterOrder.findOne({ where: { razorpay_order_id: payment.order_id } });
      if (order) {
        order.payment_status = "FAILED";
        await order.save();
      }
    }

    return res.json({ status: "Webhook processed" });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
