const { RefundRequest, MasterOrder, OrderItem, User, Product, Wallet, WalletTransaction, Seller } = require("../models");
const { escapeHTML } = require("../utils/htmlEscape");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { sendEmail } = require("../utils/sendEmail");
const redisClient = require("../config/redis");
const { chunkedFindAll } = require("../utils/dbHelper");

async function clearOrderCaches(masterOrderId, userId) {
    try {
        if (redisClient) {
            await redisClient.del(`populated_order_${masterOrderId}`);
            await redisClient.del(`customer_orders_${userId}`);
        }
    } catch (err) {
        console.warn("Failed to clear order caches:", err.message);
    }
}

// ─── ADMIN: GET ALL REFUND REQUESTS ──────────────────────────────────────
exports.getAllRefunds = asyncHandler(async (req, res) => {
    const { status } = req.query;
    const where = {};
    if (status && status !== 'ALL') where.status = status;

    const requests = await RefundRequest.findAll({
        where,
        order: [["createdAt", "DESC"]]
    });

    const requestObjects = requests.map(request => {
        const reqObj = typeof request.toJSON === 'function' ? request.toJSON() : { ...request };
        
        // Parse images if they are stored as JSON string
        if (typeof reqObj.images === 'string') {
            try { reqObj.images = JSON.parse(reqObj.images); } catch (_) { reqObj.images = []; }
        }

        // Parse items if they are stored as JSON string
        if (typeof reqObj.items === 'string') {
            try { reqObj.items = JSON.parse(reqObj.items); } catch (_) { reqObj.items = []; }
        }
        
        return reqObj;
    });

    const userIds = requestObjects.map(r => r.user_id).filter(Boolean);
    const orderIds = requestObjects.map(r => r.master_order_id).filter(Boolean);
    
    let refundItemProductIds = [];
    requestObjects.forEach(r => {
        if (Array.isArray(r.items)) {
            r.items.forEach(item => {
                if (item.product_id) refundItemProductIds.push(item.product_id);
            });
        }
    });

    const [users, masterOrders, allOrderItems] = await Promise.all([
        chunkedFindAll(User, "id", userIds),
        chunkedFindAll(MasterOrder, "id", orderIds),
        chunkedFindAll(OrderItem, "master_order_id", orderIds)
    ]);

    const userMap = users.reduce((m, u) => { m[u.id] = u; return m; }, {});
    const orderMap = masterOrders.reduce((m, o) => { m[o.id] = o; return m; }, {});

    const orderItemsByOrder = allOrderItems.reduce((m, item) => {
        if (!m[item.master_order_id]) m[item.master_order_id] = [];
        m[item.master_order_id].push(item);
        return m;
    }, {});

    const orderItemProductIds = allOrderItems.map(item => item.product_id).filter(Boolean);
    const allProductIds = [...new Set([...refundItemProductIds, ...orderItemProductIds])];

    const products = await chunkedFindAll(Product, "id", allProductIds);
    const productMap = products.reduce((m, p) => { m[p.id] = p; return m; }, {});

    const populated = requestObjects.map((reqObj) => {
        if (Array.isArray(reqObj.items)) {
            reqObj.items = reqObj.items.map(item => {
                const product = productMap[item.product_id];
                return {
                    ...item,
                    Product: product ? { id: product.id, name: product.name, image_url: product.image_url } : null
                };
            });
        }

        const user = userMap[reqObj.user_id];
        if (user) reqObj.User = { id: user.id, name: user.name, phone: user.phone };

        const order = orderMap[reqObj.master_order_id];
        if (order) {
            reqObj.MasterOrder = { id: order.id, status: order.status, total_amount: order.total_amount, createdAt: order.createdAt };

            const items = orderItemsByOrder[order.id];
            if (items && items.length > 0) {
                reqObj.OrderItems = items.map(item => {
                    const product = productMap[item.product_id];
                    return {
                        ...item,
                        Product: product ? { name: product.name, image_url: product.image_url } : null
                    };
                });
            }
        }

        return reqObj;
    });

    return ApiResponse.success(res, populated);
});


// ─── ADMIN: UPDATE REFUND STATUS ─────────────────────────────────────────
exports.updateRefundStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, admin_note } = req.body;
    const { firestore } = require("../config/firebase");

    try {
        let refundObj = null;

        // 🔒 All database writes (credits/debits/status updates) executed atomically inside a transaction
        await firestore.runTransaction(async (dbTx) => {
            const refundRef = firestore.collection("refund_requests").doc(id);
            const refundSnap = await dbTx.get(refundRef);
            if (!refundSnap.exists) {
                throw new Error("Refund request not found");
            }
            const refundData = refundSnap.data();

            if (refundData.status !== "PENDING") {
                throw new Error("Refund request has already been processed");
            }

            if (status === "APPROVED") {
                const refundAmount = parseFloat(refundData.amount) || 0;

                if (refundAmount > 0) {
                    const orderRef = firestore.collection("master_orders").doc(refundData.master_order_id);
                    const orderSnap = await dbTx.get(orderRef);
                    if (!orderSnap.exists) {
                        throw new Error("Associated order not found");
                    }
                    const orderData = orderSnap.data();

                    let sellerDeduction = refundAmount;
                    let platformCommission = 0;

                    if (orderData.seller_id) {
                        const sellerRef = firestore.collection("sellers").doc(orderData.seller_id);
                        const sellerSnap = await dbTx.get(sellerRef);
                        if (sellerSnap.exists) {
                            const sellerData = sellerSnap.data();
                            const sellerUserId = sellerData.user_id;

                            let commissionPercent = 7;
                            if (orderData.commission_percentage !== undefined && orderData.commission_percentage !== null) {
                                commissionPercent = parseFloat(orderData.commission_percentage);
                            } else {
                                const orderCommission = parseFloat(orderData.commission_amount) || 0;
                                const orderSellerAmount = parseFloat(orderData.seller_amount) || 0;
                                const orderSubtotal = orderCommission + orderSellerAmount;
                                if (orderSubtotal > 0) {
                                    commissionPercent = (orderCommission / orderSubtotal) * 100;
                                } else {
                                    const commissionSettingQuery = firestore.collection("platform_settings")
                                        .where("key", "==", "platform_commission_percentage")
                                        .limit(1);
                                    const commissionSettingSnap = await dbTx.get(commissionSettingQuery);
                                    if (!commissionSettingSnap.empty) {
                                        commissionPercent = parseFloat(commissionSettingSnap.docs[0].data().value) || 7;
                                    }
                                }
                            }

                            platformCommission = Number(((refundAmount * commissionPercent) / 100).toFixed(2));
                            sellerDeduction = Number((refundAmount - platformCommission).toFixed(2));

                            // Fetch Seller Wallet
                            const sellerWalletQuery = firestore.collection("wallets")
                                .where("user_id", "==", sellerUserId)
                                .limit(1);
                            const sellerWalletSnap = await dbTx.get(sellerWalletQuery);
                            let sellerWalletRef;
                            let sellerWalletData;

                            if (sellerWalletSnap.empty) {
                                sellerWalletRef = firestore.collection("wallets").doc();
                                sellerWalletData = {
                                    user_id: sellerUserId,
                                    available_balance: 0,
                                    pending_balance: 0,
                                    total_earned: 0,
                                    total_withdrawn: 0,
                                    createdAt: new Date(),
                                    updatedAt: new Date()
                                };
                                dbTx.set(sellerWalletRef, sellerWalletData);
                            } else {
                                sellerWalletRef = sellerWalletSnap.docs[0].ref;
                                sellerWalletData = sellerWalletSnap.docs[0].data();
                            }

                            const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
                            let deliveredDate = null;
                            if (orderData.delivered_at) {
                                if (orderData.delivered_at instanceof Date) {
                                    deliveredDate = orderData.delivered_at;
                                } else if (typeof orderData.delivered_at.toDate === 'function') {
                                    deliveredDate = orderData.delivered_at.toDate();
                                } else if (orderData.delivered_at._seconds) {
                                    deliveredDate = new Date(orderData.delivered_at._seconds * 1000);
                                } else {
                                    deliveredDate = new Date(orderData.delivered_at);
                                }
                            }
                            const isWithinLockPeriod = deliveredDate && !isNaN(deliveredDate.getTime()) && deliveredDate.getTime() > twentyFourHoursAgo;

                            if (!isWithinLockPeriod) {
                                const sellerBal = parseFloat(sellerWalletData.available_balance) || 0;
                                if (sellerBal < sellerDeduction) {
                                    throw new Error(`Seller has insufficient wallet balance to cover this refund. Balance: ₹${sellerBal.toFixed(2)}, Required: ₹${sellerDeduction.toFixed(2)}`);
                                }
                            }

                            // Deduct from seller wallet (allow negative available balance to track debt)
                            dbTx.update(sellerWalletRef, {
                                available_balance: (parseFloat(sellerWalletData.available_balance) || 0) - sellerDeduction,
                                total_earned: (parseFloat(sellerWalletData.total_earned) || 0) - sellerDeduction,
                                updatedAt: new Date()
                            });

                            // Create DEBIT transaction for seller
                            const sellerTxRef = firestore.collection("wallet_transactions").doc();
                            dbTx.set(sellerTxRef, {
                                user_id: sellerUserId,
                                master_order_id: refundData.master_order_id,
                                type: "DEBIT",
                                amount: sellerDeduction,
                                source: "ORDER_REFUND",
                                description: `Deduction for refunded order #${refundData.master_order_id.substring(0, 8).toUpperCase()} (Refund: ₹${refundAmount.toFixed(2)} - Platform Commission: ₹${platformCommission.toFixed(2)})`,
                                status: "SUCCESS",
                                reference_id: id,
                                createdAt: new Date(),
                                updatedAt: new Date()
                            });
                        }
                    }

                    // Platform commission deduction from Admin Wallet
                    if (platformCommission > 0) {
                        const adminUserQuery = firestore.collection("users")
                            .where("role", "==", "ADMIN")
                            .limit(1);
                        const adminUserSnap = await dbTx.get(adminUserQuery);
                        if (!adminUserSnap.empty) {
                            const adminUserId = adminUserSnap.docs[0].id;
                            const adminWalletQuery = firestore.collection("wallets")
                                .where("user_id", "==", adminUserId)
                                .limit(1);
                            const adminWalletSnap = await dbTx.get(adminWalletQuery);
                            
                            let adminWalletRef;
                            let adminWalletBalance = 0;

                            if (adminWalletSnap.empty) {
                                adminWalletRef = firestore.collection("wallets").doc();
                                dbTx.set(adminWalletRef, {
                                    user_id: adminUserId,
                                    available_balance: -platformCommission,
                                    pending_balance: 0,
                                    total_earned: -platformCommission,
                                    total_withdrawn: 0,
                                    createdAt: new Date(),
                                    updatedAt: new Date()
                                });
                            } else {
                                const adminWalletDoc = adminWalletSnap.docs[0];
                                adminWalletRef = adminWalletDoc.ref;
                                adminWalletBalance = parseFloat(adminWalletDoc.data().available_balance) || 0;
                                dbTx.update(adminWalletRef, {
                                    available_balance: adminWalletBalance - platformCommission,
                                    updatedAt: new Date()
                                });
                            }

                            const adminTxRef = firestore.collection("wallet_transactions").doc();
                            dbTx.set(adminTxRef, {
                                user_id: adminUserId,
                                master_order_id: refundData.master_order_id,
                                type: "DEBIT",
                                amount: platformCommission,
                                source: "PLATFORM_COMMISSION",
                                description: `Forfeited commission for refunded order #${refundData.master_order_id.substring(0, 8).toUpperCase()}`,
                                status: "SUCCESS",
                                reference_id: id,
                                createdAt: new Date(),
                                updatedAt: new Date()
                            });
                        }
                    }

                    // Credit Customer Wallet
                    const customerWalletQuery = firestore.collection("wallets")
                        .where("user_id", "==", refundData.user_id)
                        .limit(1);
                    const customerWalletSnap = await dbTx.get(customerWalletQuery);
                    let customerWalletRef;
                    let customerWalletData;

                    if (customerWalletSnap.empty) {
                        customerWalletRef = firestore.collection("wallets").doc();
                        customerWalletData = {
                            user_id: refundData.user_id,
                            available_balance: 0,
                            pending_balance: 0,
                            total_earned: 0,
                            total_withdrawn: 0,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        };
                        dbTx.set(customerWalletRef, customerWalletData);
                    } else {
                        customerWalletRef = customerWalletSnap.docs[0].ref;
                        customerWalletData = customerWalletSnap.docs[0].data();
                    }

                    dbTx.update(customerWalletRef, {
                        available_balance: (parseFloat(customerWalletData.available_balance) || 0) + refundAmount,
                        total_earned: (parseFloat(customerWalletData.total_earned) || 0) + refundAmount,
                        updatedAt: new Date()
                    });

                    // Create CREDIT transaction for customer
                    const customerTxRef = firestore.collection("wallet_transactions").doc();
                    dbTx.set(customerTxRef, {
                        user_id: refundData.user_id,
                        master_order_id: refundData.master_order_id,
                        type: "CREDIT",
                        amount: refundAmount,
                        source: "REFUND",
                        description: `Refund for order #${refundData.master_order_id.substring(0, 8).toUpperCase()}`,
                        status: "SUCCESS",
                        reference_id: id,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }

            // Update refund request status
            const updateFields = {
                status: status,
                updatedAt: new Date()
            };
            if (admin_note) updateFields.admin_note = admin_note;
            if (["APPROVED", "REJECTED"].includes(status)) {
                updateFields.processed_at = new Date().toISOString();
            }

            dbTx.update(refundRef, updateFields);
            refundObj = { id, ...refundData, ...updateFields };
        });

        // Send Email Notification outside transaction block
        try {
            const customerUser = await User.findByPk(refundObj.user_id);
            if (customerUser && customerUser.email) {
                const isApproved = status === "APPROVED";
                const subject = isApproved ? "TIND Refund Approved! 💰" : "TIND Refund Request Rejected ⚠️";
                const bodyText = isApproved 
                    ? `Good news! Your refund request for Order #${refundObj.master_order_id.substring(0, 8).toUpperCase()} has been approved. The amount of ₹${parseFloat(refundObj.amount).toFixed(2)} has been credited to your TIND wallet.` 
                    : `Your refund request for Order #${refundObj.master_order_id.substring(0, 8).toUpperCase()} was rejected. Reason: ${admin_note || "Not specified"}`;
                const themeColor = isApproved ? "#10B981" : "#EF4444";
                const bgColor = isApproved ? "#ECFDF5" : "#FEE2E2";
                const textColor = isApproved ? "#065F46" : "#991B1B";

                await sendEmail({
                    to: customerUser.email,
                    subject: subject,
                    text: bodyText,
                    html: `
                        <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 600px; margin: auto; border: 1px solid #E5E7EB; border-radius: 16px; background-color: #FFFFFF;">
                            <h2 style="color: ${themeColor}; margin-bottom: 16px; font-weight: 800;">${isApproved ? "REFUND APPROVED" : "REFUND REJECTED"}</h2>
                            <p style="font-size: 16px; color: #4B5563; line-height: 1.5; margin-bottom: 24px;">${bodyText}</p>
                            <div style="background-color: ${bgColor}; padding: 16px; border-radius: 12px; margin-bottom: 24px;">
                                <p style="margin: 0; font-size: 14px; color: ${textColor};"><strong>Order ID:</strong> #${refundObj.master_order_id.substring(0, 8).toUpperCase()}</p>
                                <p style="margin: 4px 0 0 0; font-size: 14px; color: ${textColor};"><strong>Amount:</strong> ₹${parseFloat(refundObj.amount).toFixed(2)}</p>
                                <p style="margin: 4px 0 0 0; font-size: 14px; color: ${textColor};"><strong>Status:</strong> ${isApproved ? "Approved & Credited to Wallet" : "Rejected"}</p>
                                ${!isApproved && admin_note ? `<p style="margin: 4px 0 0 0; font-size: 14px; color: ${textColor};"><strong>Reason:</strong> ${escapeHTML(admin_note)}</p>` : ""}
                            </div>
                            <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin: 0;">This is an automated notification from Tind. Please do not reply.</p>
                        </div>
                    `
                });
            }
        } catch (emailErr) {
            console.error("Failed to send refund status email:", emailErr.message);
        }

        // Clear caches
        await clearOrderCaches(refundObj.master_order_id, refundObj.user_id);

        return ApiResponse.success(res, refundObj, `Refund ${status.toLowerCase()} successfully`);

    } catch (error) {
        console.error("Update Refund Status Error:", error);
        return ApiResponse.error(res, error.message || "Failed to update refund status", 400);
    }
});

// ─── CUSTOMER: REQUEST REFUND ────────────────────────────────────────────
exports.requestRefund = asyncHandler(async (req, res) => {
    const { master_order_id, reason, description, images, items } = req.body;
    const user_id = req.user.id;

    // Verify order belongs to user and is DELIVERED
    const order = await MasterOrder.findOne({
        where: { id: master_order_id, customer_id: user_id }
    });

    if (!order) return ApiResponse.error(res, "Order not found", 404);
    if (order.status !== 'DELIVERED') {
        return ApiResponse.error(res, "Refund can only be requested for delivered orders", 400);
    }

    if (order.delivered_at) {
        let deliveredDate = null;
        if (order.delivered_at instanceof Date) deliveredDate = order.delivered_at;
        else if (typeof order.delivered_at.toDate === 'function') deliveredDate = order.delivered_at.toDate();
        else deliveredDate = new Date(order.delivered_at);

        const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
        if (deliveredDate && !isNaN(deliveredDate.getTime()) && deliveredDate.getTime() < twentyFourHoursAgo) {
            return ApiResponse.error(res, "Refund can only be requested within 24 hours of delivery", 400);
        }
    }

    if (!reason || reason.trim() === '') {
        return ApiResponse.error(res, "Please provide a reason for the refund", 400);
    }

    // Fetch order items to match and calculate cost
    const orderItems = await OrderItem.findAll({ where: { master_order_id } });
    const orderItemsMap = new Map();
    orderItems.forEach(item => {
        orderItemsMap.set(item.product_id, item);
    });

    let finalItems = items;
    if (!finalItems || !Array.isArray(finalItems) || finalItems.length === 0) {
        if (orderItems.length === 0) {
            return ApiResponse.error(res, "No items found in the order to refund", 400);
        }
        finalItems = orderItems.map(item => ({
            product_id: item.product_id,
            quantity: item.quantity
        }));
    }

    let calculatedRefundAmount = 0;
    const refundItemsList = [];

    for (const reqItem of finalItems) {
        const { product_id, quantity } = reqItem;
        if (!product_id || !quantity || quantity <= 0) {
            return ApiResponse.error(res, "Invalid product or quantity specified", 400);
        }

        const originalItem = orderItemsMap.get(product_id);
        if (!originalItem) {
            return ApiResponse.error(res, `Product ${product_id} is not part of this order`, 400);
        }

        if (quantity > originalItem.quantity) {
            return ApiResponse.error(res, `Requested refund quantity for product exceeds purchased quantity (${originalItem.quantity})`, 400);
        }

        const price = parseFloat(originalItem.price_at_purchase) || 0;
        calculatedRefundAmount += price * quantity;

        refundItemsList.push({
            product_id,
            quantity,
            price_at_purchase: price
        });
    }

    // BUG-14 FIX: Cap refund at the original order total to prevent over-refund
    // from floating point drift, data corruption, or logic errors.
    const orderTotal = parseFloat(order.total_amount) || 0;
    if (calculatedRefundAmount > orderTotal) {
        console.warn(`[Refund] Calculated refund ₹${calculatedRefundAmount} exceeded order total ₹${orderTotal} for order ${master_order_id}. Capping.`);
        calculatedRefundAmount = orderTotal;
    }
    calculatedRefundAmount = Number(calculatedRefundAmount.toFixed(2));

    const { firestore } = require("../config/firebase");
    let refund = null;

    try {
        refund = await firestore.runTransaction(async (dbTx) => {
            // Check if a refund request already exists for this order
            const refundQuery = firestore.collection("refund_requests")
                .where("master_order_id", "==", master_order_id)
                .where("user_id", "==", user_id)
                .limit(1);
            const refundSnap = await dbTx.get(refundQuery);

            if (!refundSnap.empty) {
                throw new Error("A refund request already exists for this order");
            }

            const refundRef = firestore.collection("refund_requests").doc();
            const newRefundData = {
                id: refundRef.id,
                master_order_id,
                user_id,
                reason,
                description: description || "",
                images: JSON.stringify(images || []),
                items: JSON.stringify(refundItemsList),
                amount: calculatedRefundAmount,
                refund_method: "WALLET",
                status: "PENDING",
                createdAt: new Date(),
                updatedAt: new Date()
            };

            dbTx.set(refundRef, newRefundData);
            return newRefundData;
        });
    } catch (txError) {
        if (txError.message === "A refund request already exists for this order") {
            return ApiResponse.error(res, txError.message, 400);
        }
        console.error("Refund request creation transaction failed:", txError.message);
        return ApiResponse.error(res, "Failed to submit refund request: " + txError.message, 500);
    }

    // Clear caches
    await clearOrderCaches(master_order_id, user_id);

    return ApiResponse.success(res, refund, "Refund request submitted successfully", 201);
});

// ─── CUSTOMER: GET REFUND BY ORDER ────────────────────────────────────────
exports.getRefundByOrder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const user_id = req.user.id;

    const refund = await RefundRequest.findOne({
        where: { master_order_id: orderId, user_id: user_id }
    });

    if (!refund) {
        return ApiResponse.success(res, null, "No refund request found for this order");
    }

    const refundObj = typeof refund.toJSON === 'function' ? refund.toJSON() : { ...refund };

    // Parse images
    if (typeof refundObj.images === 'string') {
        try { refundObj.images = JSON.parse(refundObj.images); } catch (_) { refundObj.images = []; }
    }

    // Parse items
    if (typeof refundObj.items === 'string') {
        try { refundObj.items = JSON.parse(refundObj.items); } catch (_) { refundObj.items = []; }
    }

    if (Array.isArray(refundObj.items)) {
        refundObj.items = await Promise.all(refundObj.items.map(async (item) => {
            const product = await Product.findByPk(item.product_id);
            return {
                ...item,
                Product: product ? { id: product.id, name: product.name, image_url: product.image_url } : null
            };
        }));
    }

    return ApiResponse.success(res, refundObj);
});
