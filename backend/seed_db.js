require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const {
    User, Seller, Category, Product, Rider, Wallet,
    Banner, SellerBankAccount, MasterOrder, OrderItem,
    CustomerAddress, WalletTransaction,
    Cart, CartItem, RiderDocument, PlatformSettings,
    RefundRequest, ChatMessage, Wishlist, ContactChangeRequest,
    RadiusChangeRequest, SellerRadiusChangeRequest, WithdrawalRequest, Review, Otp
} = require("./src/models");

async function seed() {
    try {
        console.log("🚀 Starting Massive Seeding to Firestore...");

        console.log("🧹 Clearing existing data...");
        const modelsToClear = [
            { model: User, name: 'User' }, { model: Seller, name: 'Seller' }, { model: Category, name: 'Category' }, { model: Product, name: 'Product' }, { model: Rider, name: 'Rider' }, { model: Wallet, name: 'Wallet' },
            { model: Banner, name: 'Banner' }, { model: SellerBankAccount, name: 'SellerBankAccount' }, { model: MasterOrder, name: 'MasterOrder' }, { model: OrderItem, name: 'OrderItem' },
            { model: CustomerAddress, name: 'CustomerAddress' }, { model: WalletTransaction, name: 'WalletTransaction' },
            { model: Cart, name: 'Cart' }, { model: CartItem, name: 'CartItem' }, { model: RiderDocument, name: 'RiderDocument' }, { model: PlatformSettings, name: 'PlatformSettings' },
            { model: RefundRequest, name: 'RefundRequest' }, { model: ChatMessage, name: 'ChatMessage' }, { model: Wishlist, name: 'Wishlist' }, { model: ContactChangeRequest, name: 'ContactChangeRequest' },
            { model: RadiusChangeRequest, name: 'RadiusChangeRequest' }, { model: SellerRadiusChangeRequest, name: 'SellerRadiusChangeRequest' }, { model: WithdrawalRequest, name: 'WithdrawalRequest' }, { model: Review, name: 'Review' },
            { model: Otp, name: 'Otp' }
        ];
        for (const item of modelsToClear) {
            await item.model.destroy({});
        }

        const hashedPassword = await bcrypt.hash("admin123", 10);

        // 1. Admin
        console.log("   - Seeding Admin...");
        const [admin] = await User.findOrCreate({
            where: { phone: "9999999999" },
            defaults: { name: "Super Admin", email: "admin@tind.com", password: hashedPassword, role: "ADMIN" }
        });
        await Wallet.findOrCreate({ where: { user_id: admin.id } });

        // 2. Platform Settings
        console.log("   - Seeding Platform Settings...");
        const settings = [
            { key: "delivery_fee_per_km", value: "12", type: "number", description: "Delivery fee per km" },
            { key: "platform_commission", value: "10", type: "number", description: "Default commission percentage" },
            { key: "support_email", value: "support@tind.com", type: "string", description: "Support Email" },
            { key: "app_version", value: "1.0.4", type: "string", description: "Current App Version" },
            { key: "maintenance_mode", value: "false", type: "boolean", description: "Maintenance Mode" }
        ];
        for (const s of settings) await PlatformSettings.findOrCreate({ where: { key: s.key }, defaults: s });

        // 3. Categories
        console.log("   - Seeding Categories...");
        const categories = [
            { name: "Fresh Fruits & Veg", banner_image: "https://images.unsplash.com/photo-1610348725531-843dff563e2c?auto=format&fit=crop&q=80&w=800", is_active: true },
            { name: "Electronics & Tech", banner_image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&q=80&w=800", is_active: true },
            { name: "Premium Fashion", banner_image: "https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&q=80&w=800", is_active: true },
            { name: "Home & Kitchen", banner_image: "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&q=80&w=800", is_active: true },
            { name: "Beverages & Snacks", banner_image: "https://images.unsplash.com/photo-1534073828943-f801091bb18c?auto=format&fit=crop&q=80&w=800", is_active: true },
            { name: "Personal Care", banner_image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&q=80&w=800", is_active: true },
            { name: "Books & Stationery", banner_image: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&q=80&w=800", is_active: true },
            { name: "Toys & Games", banner_image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?auto=format&fit=crop&q=80&w=800", is_active: true }
        ];
        const dbCategories = [];
        for (const cat of categories) {
            const [c] = await Category.findOrCreate({ where: { name: cat.name }, defaults: cat });
            dbCategories.push(c);
        }

        // 4. Banners
        const banners = [
            { title: "Summer Sale 50% Off", image_url: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&q=80&w=1200", display_order: 1, is_active: true },
            { title: "Organic Fresh Groceries", image_url: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=1200", display_order: 2, is_active: true },
            { title: "Next-Gen Audio Experience", image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=1200", display_order: 3, is_active: true },
            { title: "Winter Collection", image_url: "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&q=80&w=1200", display_order: 4, is_active: true },
            { title: "Smart Home Devices", image_url: "https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&q=80&w=1200", display_order: 5, is_active: true }
        ];
        for (const b of banners) await Banner.findOrCreate({ where: { title: b.title }, defaults: b });

        // 5. Sellers
        console.log("   - Seeding Sellers...");
        const sellerData = [
            { name: "Aman Gupta", shop: "BoAt Audio Store", cat: 1, phone: "8056314296" },
            { name: "Sneha Reddy", shop: "The Organic Farm", cat: 0 },
            { name: "Vikram Malhotra", shop: "Urban Threads", cat: 2 },
            { name: "Deepak Rawat", shop: "Modern Home Solutions", cat: 3 },
            { name: "Kavya Singh", shop: "Snack Time", cat: 4 },
            { name: "Rohan Das", shop: "Glow & Care", cat: 5 },
            { name: "Priya Sharma", shop: "Read & Write", cat: 6 },
            { name: "Anil Kumar", shop: "Playhouse Toys", cat: 7 }
        ];
        const dbSellers = [];
        for (let i = 0; i < sellerData.length; i++) {
            const s = sellerData[i];
            const phone = s.phone || ("98000000" + i.toString().padStart(2, '0'));
            const [u] = await User.findOrCreate({
                where: { phone },
                defaults: { name: s.name, email: `seller${i}@tind.com`, password: hashedPassword, role: "SELLER" }
            });
            await Wallet.findOrCreate({ where: { user_id: u.id }, defaults: { available_balance: 500 * (i + 1), total_earned: 1500 * (i + 1) } });
            const isApproved = i < sellerData.length - 2;
            const [seller] = await Seller.findOrCreate({
                where: { user_id: u.id },
                defaults: { shop_name: s.shop, latitude: 12.9 + (i * 0.01), longitude: 77.5 + (i * 0.01), is_approved: isApproved }
            });
            await SellerBankAccount.findOrCreate({
                where: { user_id: u.id },
                defaults: { account_name: s.name, account_number: "112233" + phone, ifsc: "ICIC0001234", bank_name: "ICICI Bank", is_verified: isApproved }
            });
            dbSellers.push({ ...seller, catIdx: s.cat, user_id: u.id });
        }

        // 6. Products
        console.log("   - Seeding Products...");
        const dbProducts = [];
        const genericImages = [
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=400",
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=400",
            "https://images.unsplash.com/photo-1542272604-787c3835535d?q=80&w=400",
            "https://images.unsplash.com/photo-1626074353765-517a681e40be?q=80&w=400",
            "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=400"
        ];
        for (let i = 0; i < dbSellers.length; i++) {
            const seller = dbSellers[i];
            for (let j = 0; j < 5; j++) {
                const price = Math.floor(Math.random() * 2000) + 100;
                const [prod] = await Product.findOrCreate({
                    where: { name: `Premium Product ${i}-${j}`, seller_id: seller.id },
                    defaults: {
                        category_id: dbCategories[seller.catIdx].id,
                        mrp: price + 500,
                        selling_price: price,
                        quantity: Math.floor(Math.random() * 100) + 10,
                        image_url: genericImages[(i + j) % genericImages.length],
                        description: `Amazing quality premium product ${i}-${j} from ${seller.shop_name}`,
                        is_active: true
                    }
                });
                dbProducts.push(prod);
            }
        }

        // 7. Riders
        console.log("   - Seeding Riders...");
        const dbRiders = [];
        for (let i = 0; i < 7; i++) {
            const phone = "88000000" + i.toString().padStart(2, '0');
            const [u] = await User.findOrCreate({
                where: { phone },
                defaults: { name: `Rider ${i}`, email: `rider${i}@tind.com`, password: hashedPassword, role: "RIDER" }
            });
            await Wallet.findOrCreate({ where: { user_id: u.id }, defaults: { available_balance: 100 * (i + 1), total_earned: 500 * (i + 1) } });
            
            const isVerified = i < 5;
            const [rider] = await Rider.findOrCreate({
                where: { user_id: u.id },
                defaults: { is_available: isVerified, current_lat: 12.9 + (i * 0.01), current_lng: 77.5 + (i * 0.01), cod_limit: 5000, is_verified: isVerified }
            });
            await RiderDocument.findOrCreate({
                where: { rider_id: rider.id, document_type: "DRIVING_LICENSE" },
                defaults: { document_urls: ["https://images.unsplash.com/photo-1621252179027-94459d278660?q=80&w=400"], status: isVerified ? "APPROVED" : "PENDING", verified_at: isVerified ? new Date().toISOString() : null }
            });
            if (!isVerified) {
                await RiderDocument.findOrCreate({
                    where: { rider_id: rider.id, document_type: "AADHAR_CARD" },
                    defaults: { document_urls: ["https://images.unsplash.com/photo-1589829085413-56de8ae18c73?q=80&w=400"], status: "PENDING", verified_at: null }
                });
            }
            dbRiders.push({ ...rider, user_id: u.id });
        }

        // 8. Customers
        console.log("   - Seeding Customers...");
        const dbCustomerUsers = [];
        const dbCustomerAddresses = [];
        for (let i = 0; i < 8; i++) {
            const phone = "90000000" + i.toString().padStart(2, '0');
            const [u] = await User.findOrCreate({
                where: { phone },
                defaults: { name: `Customer ${i}`, email: `customer${i}@tind.com`, password: hashedPassword, role: "CUSTOMER" }
            });
            await Wallet.findOrCreate({ where: { user_id: u.id } });
            const [addr] = await CustomerAddress.findOrCreate({
                where: { user_id: u.id },
                defaults: { user_id: u.id, label: "Home", house_no: `A-${i}`, area: `Area ${i}`, city: "Bangalore", state: "Karnataka", pincode: "560001", latitude: 12.9, longitude: 77.5, name: `Customer ${i}`, phone_number: phone, is_default: true }
            });
            dbCustomerUsers.push(u);
            dbCustomerAddresses.push(addr);
        }

        // 9. Carts & Wishlists
        console.log("   - Seeding Carts & Wishlists...");
        for (let i = 0; i < 4; i++) {
            const [cart] = await Cart.findOrCreate({ where: { user_id: dbCustomerUsers[i].id } });
            await CartItem.findOrCreate({ where: { cart_id: cart.id, product_id: dbProducts[i * 2].id }, defaults: { quantity: 2 } });
            await CartItem.findOrCreate({ where: { cart_id: cart.id, product_id: dbProducts[i * 2 + 1].id }, defaults: { quantity: 1 } });
            
            await Wishlist.findOrCreate({ where: { user_id: dbCustomerUsers[i].id, product_id: dbProducts[dbProducts.length - 1 - i].id } });
        }

        // 10. Orders and Transactions
        console.log("   - Seeding Orders, Items, and Wallet Transactions...");
        const orderStatuses = ["DELIVERED", "PENDING", "CANCELLED", "OUT_FOR_DELIVERY"];
        const paymentMethods = ["ONLINE", "COD"];
        
        for (let i = 0; i < 20; i++) {
            const cIdx = i % dbCustomerUsers.length;
            const sIdx = i % dbSellers.length;
            const rIdx = i % dbRiders.length;
            const status = orderStatuses[i % orderStatuses.length];
            const pMethod = paymentMethods[i % paymentMethods.length];
            
            const custUser = dbCustomerUsers[cIdx];
            const custAddr = dbCustomerAddresses[cIdx];
            const seller = dbSellers[sIdx];
            const rider = dbRiders[rIdx];

            // Assign 2 random products from this seller
            const sellerProds = dbProducts.filter(p => p.seller_id === seller.id);
            const p1 = sellerProds[0];
            const p2 = sellerProds[1] || sellerProds[0];
            const total_amount = p1.selling_price + p2.selling_price;
            const delivery_fee = 40;
            const comm = 10;
            const seller_amount = total_amount * 0.9;
            const commission_amount = total_amount * 0.1;

            const [order] = await MasterOrder.findOrCreate({
                where: { customer_id: custUser.id, seller_id: seller.id, status: status },
                defaults: {
                    rider_id: rider.id, delivery_address_id: custAddr.id, total_amount: total_amount + delivery_fee, delivery_fee,
                    payment_method: pMethod, payment_status: pMethod === "ONLINE" ? "PAID" : "PENDING", is_paid: pMethod === "ONLINE",
                    delivered_at: status === "DELIVERED" ? new Date().toISOString() : null,
                    seller_amount, commission_amount, commission_percentage: comm, is_settled: false, distance_fee: delivery_fee
                }
            });

            await OrderItem.findOrCreate({ where: { master_order_id: order.id, product_id: p1.id }, defaults: { quantity: 1, price_at_purchase: p1.selling_price } });
            await OrderItem.findOrCreate({ where: { master_order_id: order.id, product_id: p2.id }, defaults: { quantity: 1, price_at_purchase: p2.selling_price } });

            if (status === "DELIVERED") {
                await WalletTransaction.findOrCreate({ where: { user_id: seller.user_id, master_order_id: order.id, source: "ORDER_REVENUE" }, defaults: { type: "CREDIT", amount: seller_amount, description: `Revenue` } });
                await WalletTransaction.findOrCreate({ where: { user_id: rider.user_id, master_order_id: order.id, source: "DELIVERY_FEE" }, defaults: { type: "CREDIT", amount: delivery_fee, description: `Delivery fee` } });
                
                // Add Reviews
                await Review.findOrCreate({ where: { master_order_id: order.id, review_type: "SELLER" }, defaults: { user_id: custUser.id, seller_id: seller.id, rating: 5, comment: "Great!" }});
                await Review.findOrCreate({ where: { master_order_id: order.id, review_type: "RIDER" }, defaults: { user_id: custUser.id, rider_id: rider.id, rating: 4, comment: "Fast!" }});
                await Review.findOrCreate({ where: { master_order_id: order.id, review_type: "PRODUCT", product_id: p1.id }, defaults: { user_id: custUser.id, rating: 5, comment: "Loved it" }});

                // Chat Message
                await ChatMessage.findOrCreate({ where: { room_id: `room_${order.id}` }, defaults: { sender_id: rider.id, receiver_id: custUser.id, sender_role: "RIDER", text: "Delivered at door.", is_read: true }});
            }

            if (status === "CANCELLED") {
                await RefundRequest.findOrCreate({ where: { master_order_id: order.id }, defaults: { user_id: custUser.id, reason: "Defective", amount: total_amount + delivery_fee, status: "PENDING" }});
            }
        }

        // 10.5. Custom Seeding for Aman Gupta (8056314296)
        console.log("   - Seeding Custom Demo Data for Aman Gupta (BoAt Audio Store)...");
        const targetSeller = dbSellers[0]; // Aman Gupta
        const targetSellerProds = dbProducts.filter(p => p.seller_id === targetSeller.id);

        const customDemoOrders = [
            { status: "DELIVERED", pMethod: "ONLINE", rating: 5, comment: "Absolutely incredible bass! The battery life on these boAt Airdopes is insane. Recommended!", productIdx: 0, custIdx: 1, riderIdx: 0 },
            { status: "DELIVERED", pMethod: "COD", rating: 4, comment: "Great sound quality for the price. The delivery rider was also very polite.", productIdx: 1, custIdx: 2, riderIdx: 1 },
            { status: "DELIVERED", pMethod: "ONLINE", rating: 5, comment: "Super fast shipping, authentic product, sounds amazing!", productIdx: 2, custIdx: 3, riderIdx: 2 },
            { status: "CANCELLED", pMethod: "ONLINE", reason: "Ordered by mistake", productIdx: 0, custIdx: 4, riderIdx: 0 },
            { status: "PENDING", pMethod: "COD", productIdx: 1, custIdx: 5, riderIdx: 1 }
        ];

        for (let i = 0; i < customDemoOrders.length; i++) {
            const co = customDemoOrders[i];
            const custUser = dbCustomerUsers[co.custIdx % dbCustomerUsers.length];
            const custAddr = dbCustomerAddresses[co.custIdx % dbCustomerAddresses.length];
            const rider = dbRiders[co.riderIdx % dbRiders.length];
            const prod = targetSellerProds[co.productIdx % targetSellerProds.length];

            const total_amount = prod.selling_price;
            const delivery_fee = 40;
            const comm = 10;
            const seller_amount = total_amount * 0.9;
            const commission_amount = total_amount * 0.1;

            const [order] = await MasterOrder.findOrCreate({
                where: { customer_id: custUser.id, seller_id: targetSeller.id, total_amount: total_amount + delivery_fee, status: co.status },
                defaults: {
                    rider_id: rider.id, delivery_address_id: custAddr.id, total_amount: total_amount + delivery_fee, delivery_fee,
                    payment_method: co.pMethod, payment_status: co.pMethod === "ONLINE" ? "PAID" : "PENDING", is_paid: co.pMethod === "ONLINE",
                    delivered_at: co.status === "DELIVERED" ? new Date().toISOString() : null,
                    seller_amount, commission_amount, commission_percentage: comm, is_settled: false, distance_fee: delivery_fee
                }
            });

            await OrderItem.findOrCreate({ 
                where: { master_order_id: order.id, product_id: prod.id }, 
                defaults: { quantity: 1, price_at_purchase: prod.selling_price } 
            });

            if (co.status === "DELIVERED") {
                await WalletTransaction.findOrCreate({ 
                    where: { user_id: targetSeller.user_id, master_order_id: order.id, source: "ORDER_REVENUE" }, 
                    defaults: { type: "CREDIT", amount: seller_amount, description: `Custom demo order revenue` } 
                });
                
                await Review.findOrCreate({ 
                    where: { master_order_id: order.id, review_type: "SELLER" }, 
                    defaults: { user_id: custUser.id, seller_id: targetSeller.id, rating: co.rating, comment: co.comment }
                });

                await Review.findOrCreate({ 
                    where: { master_order_id: order.id, review_type: "PRODUCT", product_id: prod.id }, 
                    defaults: { user_id: custUser.id, rating: co.rating, comment: co.comment }
                });
            }

            if (co.status === "CANCELLED") {
                await RefundRequest.findOrCreate({ 
                    where: { master_order_id: order.id }, 
                    defaults: { user_id: custUser.id, reason: co.reason || "Defective", amount: total_amount + delivery_fee, status: "PENDING" }
                });
            }
        }

        // 11. Change Requests and Withdrawal Requests
        console.log("   - Seeding Requests & OTPs...");
        for (let i = 0; i < 3; i++) {
            await WithdrawalRequest.findOrCreate({ where: { user_id: dbSellers[i].user_id }, defaults: { amount: 1000 * (i+1), status: "PENDING", account_name: "Seller " + i, account_number: "11223344", ifsc: "ICIC0001", bank_name: "ICICI" }});
            await ContactChangeRequest.findOrCreate({ where: { user_id: dbSellers[i].user_id, seller_id: dbSellers[i].id }, defaults: { current_phone: "980000000" + i, new_phone: "9800000009", reason: "Lost sim", status: "PENDING" }});
            await SellerRadiusChangeRequest.findOrCreate({ where: { user_id: dbSellers[i].user_id, seller_id: dbSellers[i].id }, defaults: { current_radius: 10, new_radius: 20, reason: "Expansion", status: "PENDING" }});
            await RadiusChangeRequest.findOrCreate({ where: { user_id: dbRiders[i].user_id, rider_id: dbRiders[i].id }, defaults: { current_radius: 5, new_radius: 15, reason: "Got bike", status: "PENDING" }});
        }

        for (let i = 0; i < 5; i++) {
            await Otp.findOrCreate({ where: { phone: "910000000" + i }, defaults: { otp: "123456", expires_at: new Date(Date.now() + 10 * 60000).toISOString() }});
        }

        console.log("✅ Seeding completed successfully! 🚀");
        process.exit(0);
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }
}

seed();
