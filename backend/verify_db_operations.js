require("dotenv").config();
const { sequelize, Category, Product, User, Rider, Coupon } = require("./src/models");

async function verifyDatabaseReflection() {
  console.log("==================================================");
  console.log("🚀 Testing Hostinger MySQL Data Operations...");
  console.log("==================================================");

  try {
    await sequelize.authenticate();
    console.log("1. Connected to Database ✅");

    // 2. Add Category
    const categoryName = "Kolkata Special Rolls " + Date.now();
    const category = await Category.create({
      name: categoryName,
      description: "Delicious authentic Kolkata rolls category",
      image_url: "https://example.com/category_rolls.jpg",
      is_active: true,
      display_order: 1
    });
    console.log("2. Added Category to DB ✅ ID:", category.id, "Name:", category.name);

    // 3. Add Product in Category
    const product = await Product.create({
      category_id: category.id,
      name: "Double Chicken Egg Roll " + Date.now(),
      description: "Authentic spicy chicken egg roll",
      price: 180,
      discount_price: 150,
      food_type: "non-veg",
      is_veg: false,
      is_available: true,
      stock_quantity: 50
    });
    console.log("3. Added Product to DB ✅ ID:", product.id, "Name:", product.name);

    // 4. Add Rider (User + Rider)
    const riderPhone = "99" + Math.floor(10000000 + Math.random() * 90000000);
    const riderUser = await User.create({
      name: "Demo Test Rider",
      phone: riderPhone,
      email: `rider_${Date.now()}@kunti.com`,
      role: "RIDER"
    });

    const rider = await Rider.create({
      user_id: riderUser.id,
      vehicle_type: "Bike",
      vehicle_number: "WB-02-AB-1234",
      is_verified: true,
      is_available: true,
      rating: 4.9
    });
    console.log("4. Added Rider to DB ✅ User ID:", riderUser.id, "Rider ID:", rider.id, "Phone:", riderUser.phone);

    // 5. Add Coupon
    const couponCode = "KUNTI" + Math.floor(100 + Math.random() * 900);
    const coupon = await Coupon.create({
      code: couponCode,
      description: "Get 20% off on all Kolkata rolls",
      discount_type: "PERCENTAGE",
      discount_value: 20,
      max_discount_amount: 50,
      min_order_amount: 199,
      is_active: true
    });
    console.log("5. Added Coupon to DB ✅ ID:", coupon.id, "Code:", coupon.code);

    console.log("\n==================================================");
    console.log("🔍 QUERYING HOSTINGER DB TO VERIFY REFLECTION...");
    console.log("==================================================");

    const fetchedCategory = await Category.findByPk(category.id, { include: ["products"] });
    console.log("\n--- Verified Category & Linked Product ---");
    console.log("Category Name:", fetchedCategory.name);
    console.log("Linked Products Count:", fetchedCategory.products.length);
    console.log("Linked Product Name:", fetchedCategory.products[0].name, "Price: ₹", fetchedCategory.products[0].price);

    const fetchedRider = await Rider.findByPk(rider.id, { include: ["user"] });
    console.log("\n--- Verified Rider Record ---");
    console.log("Rider Name:", fetchedRider.user.name);
    console.log("Rider Vehicle:", fetchedRider.vehicle_type, `(${fetchedRider.vehicle_number})`);
    console.log("Rider Phone:", fetchedRider.user.phone);

    const fetchedCoupon = await Coupon.findByPk(coupon.id);
    console.log("\n--- Verified Coupon Record ---");
    console.log("Coupon Code:", fetchedCoupon.code);
    console.log("Discount:", fetchedCoupon.discount_value + "%");

    console.log("\n🎉 ALL DATA SUCCESSFULLY REFLECTED IN HOSTINGER MYSQL DB! ✅");
    process.exit(0);

  } catch (error) {
    console.error("❌ ERROR testing database reflection:", error);
    process.exit(1);
  }
}

verifyDatabaseReflection();
