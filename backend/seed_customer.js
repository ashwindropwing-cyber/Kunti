require("dotenv").config();
const bcrypt = require("bcryptjs");
const {
    User, CustomerAddress, Wallet, Cart, CartItem, Wishlist,
    MasterOrder, OrderItem, Review, RefundRequest, ChatMessage,
    WalletTransaction, Seller, Product, Rider
} = require("./src/models");

async function seedCustomer() {
    try {
        console.log("🚀 Seeding Custom Demo Data for Customer: 8056314297...");

        // 1. Clean existing records for this phone number to ensure idempotency
        let user = await User.findOne({ where: { phone: "8056314297" } });
        if (user) {
            console.log(`🧹 Found existing user with phone 8056314297. Cleaning up linked records...`);
            
            // Delete Carts & Cart Items
            const cart = await Cart.findOne({ where: { user_id: user.id } });
            if (cart) {
                await CartItem.destroy({ where: { cart_id: cart.id } });
                await cart.destroy();
            }
            
            // Delete Wishlists, Addresses, Wallets, Transactions, Reviews, Refunds, Chat
            await Wishlist.destroy({ where: { user_id: user.id } });
            await CustomerAddress.destroy({ where: { user_id: user.id } });
            await Wallet.destroy({ where: { user_id: user.id } });
            await WalletTransaction.destroy({ where: { user_id: user.id } });
            await Review.destroy({ where: { user_id: user.id } });
            await RefundRequest.destroy({ where: { user_id: user.id } });
            await ChatMessage.destroy({ where: { sender_id: user.id } });
            await ChatMessage.destroy({ where: { receiver_id: user.id } });
            
            // Delete Master Orders and Order Items
            const orders = await MasterOrder.findAll({ where: { customer_id: user.id } });
            for (const o of orders) {
                await OrderItem.destroy({ where: { master_order_id: o.id } });
                await o.destroy();
            }
            
            await user.destroy();
            console.log(`🧹 Cleanup complete.`);
        }

        // 2. Create the Customer User
        console.log("👤 Creating User record...");
        const hashedPassword = await bcrypt.hash("admin123", 10);
        user = await User.create({
            name: "Ashwin Prasad",
            email: "ashwin.customer@tind.com",
            password: hashedPassword,
            phone: "8056314297",
            role: "CUSTOMER"
        });

        // 3. Create Customer Addresses (Home and Work)
        console.log("🏠 Creating Customer Addresses...");
        const homeAddr = await CustomerAddress.create({
            user_id: user.id,
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

        const workAddr = await CustomerAddress.create({
            user_id: user.id,
            label: "Work",
            house_no: "Prestige Tech Park, Block C",
            area: "Marathahalli",
            city: "Bangalore",
            state: "Karnataka",
            pincode: "560103",
            latitude: 12.9436,
            longitude: 77.6974,
            name: "Ashwin Prasad (Office)",
            phone_number: "8056314297",
            is_default: false
        });

        // 4. Create the Wallet
        console.log("💳 Creating Wallet...");
        await Wallet.create({
            user_id: user.id,
            available_balance: 1200, // E.g., loaded credits or refund balance
            pending_balance: 0,
            total_earned: 0,
            total_withdrawn: 0
        });

        // 5. Query reference Sellers, Riders, and Products to link
        console.log("🔗 Querying database for reference products, sellers, and riders...");
        const sellers = await Seller.findAll({});
        const riders = await Rider.findAll({});
        
        let sellerId = "";
        let sellerUserId = "";
        let riderId = "";
        let riderUserId = "";

        if (sellers.length > 0) {
            sellerId = sellers[0].id;
            sellerUserId = sellers[0].user_id;
        } else {
            // Create fallback seller
            const dummySellerUser = await User.create({
                name: "BoAt Audio Store Owner",
                email: "boat.owner@tind.com",
                password: hashedPassword,
                phone: "8056314296",
                role: "SELLER"
            });
            sellerUserId = dummySellerUser.id;
            const dummySeller = await Seller.create({
                user_id: sellerUserId,
                shop_name: "BoAt Audio Store",
                latitude: 12.9350,
                longitude: 77.6240,
                is_approved: true
            });
            sellerId = dummySeller.id;
        }

        if (riders.length > 0) {
            riderId = riders[0].id;
            riderUserId = riders[0].user_id;
        } else {
            // Create fallback rider
            const dummyRiderUser = await User.create({
                name: "Rider Delivery Boy",
                email: "delivery.boy@tind.com",
                password: hashedPassword,
                phone: "8800000001",
                role: "RIDER"
            });
            riderUserId = dummyRiderUser.id;
            const dummyRider = await Rider.create({
                user_id: riderUserId,
                is_available: true,
                vehicle_type: "Bicycle",
                vehicle_number: "N/A",
                is_verified: true
            });
            riderId = dummyRider.id;
        }

        let products = await Product.findAll({ where: { seller_id: sellerId } });
        if (products.length === 0) {
            // Create fallback products
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
            const p2 = await Product.create({
                name: "boAt Bassheads 225",
                seller_id: sellerId,
                category_id: category.id,
                mrp: 999,
                selling_price: 499,
                quantity: 80,
                image_url: "https://images.unsplash.com/photo-1613040809024-b4ef7ba99bc3?w=400",
                description: "Super extra bass wired earphones.",
                is_active: true
            });
            products = [p1, p2];
        }

        const prod1 = products[0];
        const prod2 = products[1] || products[0];

        // 6. Create Cart and Cart Items
        console.log("🛒 Seeding Active Cart items...");
        const cart = await Cart.create({ user_id: user.id });
        await CartItem.create({
            cart_id: cart.id,
            product_id: prod1.id,
            quantity: 1
        });
        await CartItem.create({
            cart_id: cart.id,
            product_id: prod2.id,
            quantity: 2
        });

        // 7. Create Wishlists
        console.log("❤️ Seeding Wishlist items...");
        await Wishlist.create({
            user_id: user.id,
            product_id: prod1.id
        });
        await Wishlist.create({
            user_id: user.id,
            product_id: prod2.id
        });

        // 8. Create Orders
        console.log("📦 Creating Master Orders history...");

        // Order 1: Delivered Order
        const order1 = await MasterOrder.create({
            customer_id: user.id,
            seller_id: sellerId,
            rider_id: riderId,
            delivery_address_id: homeAddr.id,
            total_amount: prod1.selling_price + 40,
            delivery_fee: 40,
            payment_method: "ONLINE",
            is_paid: true,
            payment_status: "PAID",
            delivered_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
            seller_amount: prod1.selling_price * 0.9,
            commission_amount: prod1.selling_price * 0.1,
            commission_percentage: 10,
            is_settled: true,
            status: "DELIVERED",
            distance_fee: 40,
            rider_tip: 20
        });
        await OrderItem.create({
            master_order_id: order1.id,
            product_id: prod1.id,
            quantity: 1,
            price_at_purchase: prod1.selling_price
        });

        // Add reviews for Order 1
        console.log("⭐ Seeding Reviews for delivered items...");
        await Review.create({
            user_id: user.id,
            master_order_id: order1.id,
            review_type: "SELLER",
            seller_id: sellerId,
            rating: 5,
            comment: "Excellent experience ordering from this shop! Highly professional and fast support."
        });
        await Review.create({
            user_id: user.id,
            master_order_id: order1.id,
            review_type: "PRODUCT",
            product_id: prod1.id,
            rating: 5,
            comment: "Fantastic sound quality. Well packaged and perfectly authentic boat product!"
        });
        await Review.create({
            user_id: user.id,
            master_order_id: order1.id,
            review_type: "RIDER",
            rider_id: riderId,
            rating: 4,
            comment: "Fast delivery, though driver took a small detour."
        });

        // Order 2: Active / Processing Order
        const order2 = await MasterOrder.create({
            customer_id: user.id,
            seller_id: sellerId,
            rider_id: riderId,
            delivery_address_id: homeAddr.id,
            total_amount: prod2.selling_price + 40,
            delivery_fee: 40,
            payment_method: "COD",
            is_paid: false,
            payment_status: "PENDING",
            seller_amount: prod2.selling_price * 0.9,
            commission_amount: prod2.selling_price * 0.1,
            commission_percentage: 10,
            is_settled: false,
            status: "PENDING",
            distance_fee: 40,
            rider_tip: 0
        });
        await OrderItem.create({
            master_order_id: order2.id,
            product_id: prod2.id,
            quantity: 1,
            price_at_purchase: prod2.selling_price
        });

        // Order 3: Cancelled Order with Refund Request
        const order3 = await MasterOrder.create({
            customer_id: user.id,
            seller_id: sellerId,
            rider_id: riderId,
            delivery_address_id: workAddr.id,
            total_amount: prod1.selling_price + 40,
            delivery_fee: 40,
            payment_method: "ONLINE",
            is_paid: true,
            payment_status: "PAID",
            seller_amount: prod1.selling_price * 0.9,
            commission_amount: prod1.selling_price * 0.1,
            commission_percentage: 10,
            is_settled: false,
            status: "CANCELLED",
            distance_fee: 40,
            rider_tip: 0
        });
        await OrderItem.create({
            master_order_id: order3.id,
            product_id: prod1.id,
            quantity: 1,
            price_at_purchase: prod1.selling_price
        });

        console.log("💸 Submitting Refund request for cancelled order...");
        await RefundRequest.create({
            user_id: user.id,
            master_order_id: order3.id,
            reason: "Incorrect color choice. Want to reorder black model.",
            amount: prod1.selling_price + 40,
            status: "PENDING"
        });

        // 9. Add Chat Messages
        console.log("💬 Creating Customer-Rider Chat History...");
        await ChatMessage.create({
            room_id: `room_${order1.id}`,
            sender_id: riderUserId,
            receiver_id: user.id,
            sender_role: "RIDER",
            text: "Hi Ashwin, I have picked up your order and I am on my way.",
            is_read: true
        });
        await ChatMessage.create({
            room_id: `room_${order1.id}`,
            sender_id: user.id,
            receiver_id: riderUserId,
            sender_role: "CUSTOMER",
            text: "Thanks! Please leave it with the security guard at the gate if I am not around.",
            is_read: true
        });

        console.log("✅ Custom data for Customer 8056314297 seeded successfully! 🚀");
        process.exit(0);
    } catch (e) {
        console.error("❌ Seeding failed:", e);
        process.exit(1);
    }
}

seedCustomer();
