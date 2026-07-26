require("dotenv").config();
const bcrypt = require("bcryptjs");
const {
    User, Rider, Wallet, WalletTransaction, WithdrawalRequest,
    MasterOrder, OrderItem, Review, ChatMessage, RadiusChangeRequest, Seller, Product, CustomerAddress
} = require("./src/models");

async function seedRider() {
    try {
        console.log("🚀 Seeding Custom Demo Data for Rider: 8056314298...");

        // 1. Clean existing records for this phone number to ensure idempotency
        let user = await User.findOne({ where: { phone: "8056314298" } });
        let riderId = "";

        if (user) {
            console.log(`🧹 Found existing user with phone 8056314298. Cleaning up linked records...`);
            
            const rider = await Rider.findOne({ where: { user_id: user.id } });
            if (rider) {
                riderId = rider.id;
                // Delete Radius Change Requests
                await RadiusChangeRequest.destroy({ where: { rider_id: rider.id } });
                // Delete reviews for rider
                await Review.destroy({ where: { rider_id: rider.id } });
                // Delete Rider record
                await rider.destroy();
            }

            // Delete Wallet & Transactions
            await Wallet.destroy({ where: { user_id: user.id } });
            await WalletTransaction.destroy({ where: { user_id: user.id } });
            await WithdrawalRequest.destroy({ where: { user_id: user.id } });

            // Delete Chat Messages sent or received by this rider user
            await ChatMessage.destroy({ where: { sender_id: user.id } });
            await ChatMessage.destroy({ where: { receiver_id: user.id } });

            // Clean up Orders assigned to this rider or offered to this rider
            if (riderId) {
                const orders = await MasterOrder.findAll({ 
                    where: { 
                        rider_id: riderId
                    } 
                });
                for (const o of orders) {
                    await OrderItem.destroy({ where: { master_order_id: o.id } });
                    await o.destroy();
                }

                const offeredOrders = await MasterOrder.findAll({
                    where: {
                        offered_rider_id: riderId
                    }
                });
                for (const o of offeredOrders) {
                    await OrderItem.destroy({ where: { master_order_id: o.id } });
                    await o.destroy();
                }
            }
            
            await user.destroy();
            console.log(`🧹 Cleanup complete.`);
        }

        // 2. Create the Rider User
        console.log("👤 Creating Rider User record...");
        const hashedPassword = await bcrypt.hash("admin123", 10);
        user = await User.create({
            name: "Ramesh Kumar",
            email: "ramesh.rider@tind.com",
            password: hashedPassword,
            phone: "8056314298",
            role: "RIDER"
        });

        // 3. Create the Rider profile
        console.log("🛵 Creating Rider Profile...");
        const rider = await Rider.create({
            user_id: user.id,
            is_available: true,
            vehicle_type: "Bike",
            vehicle_number: "KA-03-HA-1234",
            address: "No 12, 5th Cross, HSR Layout Sector 6, Bangalore",
            license_number: "DL-1420110012345",
            aadhar_number: "123456789012",
            date_of_birth: "1995-08-15",
            rating: 4.8,
            rating_count: 12,
            current_lat: 12.9348,
            current_lng: 77.6250,
            cod_limit: 1500,
            is_verified: true,
            delivery_radius_km: 5
        });
        riderId = rider.id;

        // 4. Create the Wallet for Rider
        console.log("💳 Creating Rider Wallet...");
        await Wallet.create({
            user_id: user.id,
            available_balance: 750, // Available for withdrawal or COD adjustment
            pending_balance: 150,   // Active order delivery fee in transit
            total_earned: 2900,
            total_withdrawn: 2000
        });

        // 5. Create Wallet Transactions
        console.log("📈 Seeding Wallet Transactions...");
        // Previous successful withdrawal transaction
        await WalletTransaction.create({
            user_id: user.id,
            type: "WITHDRAWAL",
            amount: 2000,
            source: "BANK_TRANSFER",
            description: "Withdrawal request processed successfully to Bank Account",
            status: "SUCCESS",
            reference_id: "TXN_WDR_998877"
        });

        // Delivery earnings credits
        await WalletTransaction.create({
            user_id: user.id,
            type: "CREDIT",
            amount: 1500,
            source: "ORDER_DELIVERY",
            description: "Earnings from 30 order deliveries in past week",
            status: "SUCCESS",
            reference_id: "TXN_EARN_W1"
        });

        await WalletTransaction.create({
            user_id: user.id,
            type: "CREDIT",
            amount: 1250,
            source: "ORDER_DELIVERY",
            description: "Earnings from 25 order deliveries this week",
            status: "SUCCESS",
            reference_id: "TXN_EARN_W2"
        });

        // 6. Create Withdrawal Requests
        console.log("🏦 Seeding Withdrawal Requests...");
        // Past approved withdrawal
        await WithdrawalRequest.create({
            user_id: user.id,
            amount: 2000,
            status: "APPROVED",
            account_name: "Ramesh Kumar",
            account_number: "918056314298",
            ifsc: "PYTM0123456",
            bank_name: "Paytm Payments Bank",
            razorpay_payout_id: "pout_FD123456",
            retry_count: 0
        });

        // Current pending withdrawal request
        await WithdrawalRequest.create({
            user_id: user.id,
            amount: 300,
            status: "PENDING",
            account_name: "Ramesh Kumar",
            account_number: "918056314298",
            ifsc: "PYTM0123456",
            bank_name: "Paytm Payments Bank",
            retry_count: 0
        });

        // 7. Create Radius Change Request
        console.log("📡 Seeding Radius Change Request...");
        await RadiusChangeRequest.create({
            user_id: user.id,
            rider_id: riderId,
            rider_name: "Ramesh Kumar",
            current_radius: 5,
            new_radius: 7,
            reason: "I have a new high-speed electric scooter, can cover longer distances quickly.",
            status: "PENDING"
        });

        // 8. Retrieve/Create references for linking orders (Customer 8056314297 and Seller)
        console.log("🔗 Querying database for Customer and Seller references...");
        let customerUser = await User.findOne({ where: { phone: "8056314297" } });
        if (!customerUser) {
            console.log("👤 Customer 8056314297 not found. Creating fallback...");
            customerUser = await User.create({
                name: "Ashwin Prasad",
                email: "ashwin.customer@tind.com",
                password: hashedPassword,
                phone: "8056314297",
                role: "CUSTOMER"
            });
        }

        // Get address for order linking
        let address = await CustomerAddress.findOne({ where: { user_id: customerUser.id } });
        if (!address) {
            address = await CustomerAddress.create({
                user_id: customerUser.id,
                label: "Home",
                house_no: "No 45, 2nd Cross",
                area: "Koramangala 3rd Block",
                city: "Bangalore",
                state: "Karnataka",
                pincode: "560034",
                latitude: 12.9348,
                longitude: 77.6250,
                name: "Ashwin Prasad (Home)",
                phone_number: "8056314297",
                is_default: true
            });
        }

        // Find or create Seller reference
        const sellers = await Seller.findAll({});
        let sellerId = "";
        if (sellers.length > 0) {
            sellerId = sellers[0].id;
        } else {
            const dummySellerUser = await User.create({
                name: "BoAt Audio Store Owner",
                email: "boat.owner@tind.com",
                password: hashedPassword,
                phone: "8056314296",
                role: "SELLER"
            });
            const dummySeller = await Seller.create({
                user_id: dummySellerUser.id,
                shop_name: "BoAt Audio Store",
                latitude: 12.9350,
                longitude: 77.6240,
                is_approved: true
            });
            sellerId = dummySeller.id;
        }

        // Find product
        let products = await Product.findAll({ where: { seller_id: sellerId } });
        if (products.length === 0) {
            const { Category } = require("./src/models");
            let category = await Category.findOne({});
            if (!category) {
                category = await Category.create({
                    name: "Audio Accessories",
                    banner_image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400",
                    is_active: true
                });
            }
            const p1 = await Product.create({
                name: "boAt Airdopes 131",
                seller_id: sellerId,
                category_id: category.id,
                mrp: 1999,
                selling_price: 999,
                quantity: 100,
                image_url: "https://images.unsplash.com/photo-1608156639585-b3a032ef9689?w=400",
                description: "Wireless Bluetooth earbuds with massive battery backup.",
                is_active: true
            });
            products = [p1];
        }
        const prod = products[0];

        // 9. Create Orders
        console.log("📦 Creating Master Orders...");

        // Order 1: DELIVERED Order
        console.log("  - DELIVERED Order");
        const orderDelivered = await MasterOrder.create({
            customer_id: customerUser.id,
            seller_id: sellerId,
            rider_id: riderId,
            delivery_address_id: address.id,
            total_amount: prod.selling_price + 45 + 10, // Selling price + delivery fee + tip
            delivery_fee: 45,
            payment_method: "ONLINE",
            is_paid: true,
            payment_status: "PAID",
            delivered_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
            seller_amount: prod.selling_price * 0.9,
            commission_amount: prod.selling_price * 0.1,
            commission_percentage: 10,
            is_settled: true,
            status: "DELIVERED",
            distance_fee: 45,
            rider_tip: 10
        });

        await OrderItem.create({
            master_order_id: orderDelivered.id,
            product_id: prod.id,
            quantity: 1,
            price_at_purchase: prod.selling_price
        });

        // Add customer review for rider on DELIVERED Order
        await Review.create({
            user_id: customerUser.id,
            master_order_id: orderDelivered.id,
            review_type: "RIDER",
            rider_id: riderId,
            rating: 5,
            comment: "Ramesh was polite and delivered the product right on time!"
        });

        // Order 2: ACCEPTED/ACTIVE Order (Rider has accepted it, currently delivering)
        console.log("  - ACCEPTED Active Order (COD)");
        const orderActive = await MasterOrder.create({
            customer_id: customerUser.id,
            seller_id: sellerId,
            rider_id: riderId,
            delivery_address_id: address.id,
            total_amount: prod.selling_price + 40,
            delivery_fee: 40,
            payment_method: "COD",
            is_paid: false,
            payment_status: "PENDING",
            seller_amount: prod.selling_price * 0.9,
            commission_amount: prod.selling_price * 0.1,
            commission_percentage: 10,
            is_settled: false,
            status: "ACCEPTED",
            distance_fee: 40,
            rider_tip: 0
        });

        await OrderItem.create({
            master_order_id: orderActive.id,
            product_id: prod.id,
            quantity: 1,
            price_at_purchase: prod.selling_price
        });

        // Order 3: PENDING Order Offer (Offered to this rider, pending accept/reject)
        console.log("  - PENDING Offered Order (ONLINE)");
        const orderOffered = await MasterOrder.create({
            customer_id: customerUser.id,
            seller_id: sellerId,
            offered_rider_id: riderId, // Offered specifically to this rider
            delivery_address_id: address.id,
            total_amount: prod.selling_price + 50,
            delivery_fee: 50,
            payment_method: "ONLINE",
            is_paid: true,
            payment_status: "PAID",
            seller_amount: prod.selling_price * 0.9,
            commission_amount: prod.selling_price * 0.1,
            commission_percentage: 10,
            is_settled: false,
            status: "PENDING",
            distance_fee: 50,
            rider_tip: 0
        });

        await OrderItem.create({
            master_order_id: orderOffered.id,
            product_id: prod.id,
            quantity: 1,
            price_at_purchase: prod.selling_price
        });

        // 10. Add Chat Messages for Active Order
        console.log("💬 Creating Chat Messages...");
        await ChatMessage.create({
            room_id: `room_${orderActive.id}`,
            sender_id: user.id, // RIDER (Ramesh)
            receiver_id: customerUser.id, // CUSTOMER (Ashwin)
            sender_role: "RIDER",
            text: "Hello Ashwin, I have picked up your order from the shop and I am on my way.",
            is_read: true
        });

        await ChatMessage.create({
            room_id: `room_${orderActive.id}`,
            sender_id: customerUser.id, // CUSTOMER (Ashwin)
            receiver_id: user.id, // RIDER (Ramesh)
            sender_role: "CUSTOMER",
            text: "Awesome, thank you! Please call me when you reach the main gate.",
            is_read: false
        });

        console.log("✅ Custom data for Rider 8056314298 seeded successfully! 🚀");
        process.exit(0);
    } catch (e) {
        console.error("❌ Seeding failed:", e);
        process.exit(1);
    }
}

seedRider();
