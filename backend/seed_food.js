require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

// ─── Inline DB credentials from Hostinger (override env) ─────────────────────
process.env.DB_DIALECT   = "mysql";
process.env.DB_HOST      = "srv1495.hstgr.io";
process.env.DB_PORT      = "3306";
process.env.DB_NAME      = "u247884947_Kunti";
process.env.DB_USER      = "u247884947_kuntiadmin";
process.env.DB_PASSWORD  = "Fenixasolutions@123";
// ─────────────────────────────────────────────────────────────────────────────

const { sequelize, Category, Product } = require("./src/models");

// ─── Food Categories ──────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    name: "Rolls & Wraps",
    image_url: "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&q=80&w=800",
    description: "Crispy and flavorful rolls with fresh fillings",
    display_order: 1,
  },
  {
    name: "Biryani & Rice",
    image_url: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&q=80&w=800",
    description: "Fragrant and hearty rice dishes",
    display_order: 2,
  },
  {
    name: "Burgers & Sandwiches",
    image_url: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&q=80&w=800",
    description: "Loaded burgers and fresh sandwiches",
    display_order: 3,
  },
  {
    name: "Pizza",
    image_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=800",
    description: "Stone-baked pizzas with bold toppings",
    display_order: 4,
  },
  {
    name: "Starters & Snacks",
    image_url: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&q=80&w=800",
    description: "Crispy snacks and appetizers",
    display_order: 5,
  },
  {
    name: "Chinese",
    image_url: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&q=80&w=800",
    description: "Indo-Chinese favourites with a desi twist",
    display_order: 6,
  },
  {
    name: "Desserts & Sweets",
    image_url: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&q=80&w=800",
    description: "Indulgent sweets and desserts",
    display_order: 7,
  },
  {
    name: "Beverages",
    image_url: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&q=80&w=800",
    description: "Refreshing drinks, juices and shakes",
    display_order: 8,
  },
];

// ─── Food Products ────────────────────────────────────────────────────────────
const PRODUCTS = [
  // Rolls & Wraps
  { catName: "Rolls & Wraps", name: "Paneer Tikka Roll", description: "Soft roomali roti wrapped around smoky grilled paneer with mint chutney and onions", price: 149, discount_price: 129, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&q=80&w=600" },
  { catName: "Rolls & Wraps", name: "Chicken Seekh Roll", description: "Juicy seekh kebab wrapped in flaky paratha with green chutney", price: 169, discount_price: 149, is_veg: false, food_type: "nonVeg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&q=80&w=600" },
  { catName: "Rolls & Wraps", name: "Egg Roll", description: "Classic Kolkata-style egg roll with onions, cucumber and ketchup", price: 89, discount_price: 79, is_veg: false, food_type: "egg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1565299507177-b0ac66763828?auto=format&fit=crop&q=80&w=600" },
  { catName: "Rolls & Wraps", name: "Veg Kathi Roll", description: "Crispy paratha stuffed with mixed veggies, paneer and spices", price: 119, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&q=80&w=600" },
  { catName: "Rolls & Wraps", name: "Mutton Keema Roll", description: "Spiced minced mutton wrapped in layered paratha — a hearty treat", price: 199, discount_price: 179, is_veg: false, food_type: "nonVeg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&q=80&w=600" },

  // Biryani & Rice
  { catName: "Biryani & Rice", name: "Chicken Dum Biryani", description: "Slow-cooked basmati rice with tender chicken, saffron and fried onions", price: 249, discount_price: 219, is_veg: false, food_type: "nonVeg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&q=80&w=600" },
  { catName: "Biryani & Rice", name: "Veg Biryani", description: "Aromatic basmati rice layered with seasonal vegetables and whole spices", price: 189, discount_price: 169, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?auto=format&fit=crop&q=80&w=600" },
  { catName: "Biryani & Rice", name: "Mutton Biryani", description: "Rich and tender mutton pieces slow-cooked with basmati rice", price: 299, discount_price: 269, is_veg: false, food_type: "nonVeg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&q=80&w=600" },
  { catName: "Biryani & Rice", name: "Egg Fried Rice", description: "Wok-tossed basmati rice with eggs, soy sauce and spring onions", price: 149, discount_price: null, is_veg: false, food_type: "egg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&q=80&w=600" },
  { catName: "Biryani & Rice", name: "Paneer Biryani", description: "Fragrant basmati with marinated paneer, rose water and mint", price: 219, discount_price: 199, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?auto=format&fit=crop&q=80&w=600" },

  // Burgers & Sandwiches
  { catName: "Burgers & Sandwiches", name: "Classic Chicken Burger", description: "Crispy fried chicken patty with lettuce, tomato and house sauce", price: 159, discount_price: 139, is_veg: false, food_type: "nonVeg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&q=80&w=600" },
  { catName: "Burgers & Sandwiches", name: "Aloo Tikki Burger", description: "Spiced potato tikki with tamarind chutney and crispy onions", price: 89, discount_price: 79, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=600" },
  { catName: "Burgers & Sandwiches", name: "Paneer Burger", description: "Grilled paneer patty with fresh veggies and chipotle mayo", price: 129, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=600" },
  { catName: "Burgers & Sandwiches", name: "Club Sandwich", description: "Triple-decker with chicken, egg, cheese, lettuce and tomato", price: 199, discount_price: 179, is_veg: false, food_type: "nonVeg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&q=80&w=600" },
  { catName: "Burgers & Sandwiches", name: "Veg Grilled Sandwich", description: "Grilled with cheese, onion, tomato, capsicum and green chutney", price: 99, discount_price: 89, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&q=80&w=600" },

  // Pizza
  { catName: "Pizza", name: "Margherita Pizza", description: "Classic tomato base with fresh mozzarella and basil", price: 259, discount_price: 229, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&q=80&w=600" },
  { catName: "Pizza", name: "Chicken BBQ Pizza", description: "Smoky BBQ chicken with caramelised onions and bell peppers", price: 319, discount_price: 289, is_veg: false, food_type: "nonVeg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=600" },
  { catName: "Pizza", name: "Paneer Tikka Pizza", description: "Zesty tikka paneer with onions, peppers and tandoori base", price: 299, discount_price: 269, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&q=80&w=600" },
  { catName: "Pizza", name: "Double Cheese Pizza", description: "Extra mozzarella and cheddar on a garlic butter base", price: 279, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=600" },

  // Starters & Snacks
  { catName: "Starters & Snacks", name: "Veg Momos (8 pcs)", description: "Steamed dumplings stuffed with spiced cabbage and carrots, served with red chutney", price: 99, discount_price: 89, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&q=80&w=600" },
  { catName: "Starters & Snacks", name: "Chicken Momos (8 pcs)", description: "Juicy chicken dumplings with a hint of ginger and garlic", price: 129, discount_price: 109, is_veg: false, food_type: "nonVeg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&q=80&w=600" },
  { catName: "Starters & Snacks", name: "Samosa (2 pcs)", description: "Crispy golden samosas with spiced potato filling and tamarind chutney", price: 49, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&q=80&w=600" },
  { catName: "Starters & Snacks", name: "French Fries", description: "Golden crispy fries with a side of ketchup and mayo", price: 79, discount_price: 69, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&q=80&w=600" },
  { catName: "Starters & Snacks", name: "Chicken Wings (6 pcs)", description: "Crispy fried wings tossed in spicy buffalo sauce", price: 199, discount_price: 179, is_veg: false, food_type: "nonVeg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&q=80&w=600" },

  // Chinese
  { catName: "Chinese", name: "Veg Hakka Noodles", description: "Wok-fried noodles with vegetables in a savory sauce", price: 139, discount_price: 119, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&q=80&w=600" },
  { catName: "Chinese", name: "Chicken Chowmein", description: "Stir-fried chicken noodles with peppers and spring onions", price: 169, discount_price: 149, is_veg: false, food_type: "nonVeg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&q=80&w=600" },
  { catName: "Chinese", name: "Gobi Manchurian", description: "Crispy cauliflower florets tossed in a sweet and spicy sauce", price: 149, discount_price: 129, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&q=80&w=600" },
  { catName: "Chinese", name: "Chicken Manchurian", description: "Juicy chicken balls in tangy Manchurian gravy", price: 189, discount_price: 169, is_veg: false, food_type: "nonVeg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&q=80&w=600" },
  { catName: "Chinese", name: "Spring Rolls (4 pcs)", description: "Golden fried rolls stuffed with noodles and crispy veggies", price: 119, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&q=80&w=600" },

  // Desserts & Sweets
  { catName: "Desserts & Sweets", name: "Gulab Jamun (4 pcs)", description: "Soft milk-solid dumplings soaked in rose-flavoured sugar syrup", price: 79, discount_price: 69, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&q=80&w=600" },
  { catName: "Desserts & Sweets", name: "Chocolate Brownie", description: "Dense fudgy chocolate brownie served warm with vanilla ice cream", price: 129, discount_price: 109, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&q=80&w=600" },
  { catName: "Desserts & Sweets", name: "Rasmalai (2 pcs)", description: "Soft chenna dumplings soaked in creamy saffron milk", price: 89, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&q=80&w=600" },
  { catName: "Desserts & Sweets", name: "Vanilla Ice Cream", description: "Creamy vanilla ice cream, served in a cup or cone", price: 69, discount_price: 59, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1501443762994-82bd5dace89a?auto=format&fit=crop&q=80&w=600" },

  // Beverages
  { catName: "Beverages", name: "Mango Lassi", description: "Thick and creamy mango yogurt drink, chilled to perfection", price: 79, discount_price: 69, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&q=80&w=600" },
  { catName: "Beverages", name: "Fresh Lime Soda", description: "Zesty lime juice with soda, mint and a hint of masala", price: 59, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&q=80&w=600" },
  { catName: "Beverages", name: "Cold Coffee", description: "Smooth cold brew coffee blended with milk and ice cream", price: 99, discount_price: 89, is_veg: true, food_type: "veg", is_bestseller: true, image_url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&q=80&w=600" },
  { catName: "Beverages", name: "Fresh Orange Juice", description: "Freshly squeezed orange juice, served chilled", price: 79, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&q=80&w=600" },
  { catName: "Beverages", name: "Masala Chai", description: "Hot spiced ginger tea with cardamom and milk", price: 39, discount_price: null, is_veg: true, food_type: "veg", is_bestseller: false, image_url: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&q=80&w=600" },
];

async function seed() {
  try {
    console.log("🔗 Connecting to database...");
    await sequelize.authenticate();
    console.log("✅ Connected!\n");

    // ── 1. CLEAR all tables ──────────────────────────────────────────────────
    console.log("🧹 Clearing database...");
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0;");

    const tablesToClear = [
      "coupon_usages", "coupons", "notifications", "reviews",
      "wishlists", "cart_items", "carts", "order_items",
      "master_orders", "customer_addresses", "products", "categories",
      "banners", "platform_settings", "otps", "riders", "users",
    ];

    for (const table of tablesToClear) {
      try {
        await sequelize.query(`TRUNCATE TABLE \`${table}\`;`);
        console.log(`   ✓ Cleared ${table}`);
      } catch (e) {
        console.log(`   ⚠️  Skipped ${table}: ${e.message}`);
      }
    }

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1;");
    console.log("✅ Database cleared.\n");

    // ── 2. SEED Categories ───────────────────────────────────────────────────
    console.log("🍽️  Seeding food categories...");
    const catMap = {};
    for (const cat of CATEGORIES) {
      const record = await Category.create({ ...cat, is_active: true });
      catMap[cat.name] = record;
      console.log(`   ✓ ${cat.name}`);
    }
    console.log(`✅ ${CATEGORIES.length} categories seeded.\n`);

    // ── 3. SEED Products ─────────────────────────────────────────────────────
    console.log("🥘  Seeding food items...");
    for (const p of PRODUCTS) {
      const category = catMap[p.catName];
      if (!category) {
        console.warn(`   ⚠️  Category not found for: ${p.name}`);
        continue;
      }
      await Product.create({
        category_id:    category.id,
        name:           p.name,
        description:    p.description,
        price:          p.price,
        discount_price: p.discount_price || null,
        image_url:      p.image_url,
        is_veg:         p.is_veg,
        food_type:      p.food_type,
        is_bestseller:  p.is_bestseller,
        is_available:   true,
        stock_quantity: Math.floor(Math.random() * 50) + 20,
        rating:         +(3.5 + Math.random() * 1.5).toFixed(1),
        rating_count:   Math.floor(Math.random() * 200) + 10,
      });
      console.log(`   ✓ ${p.name}`);
    }
    console.log(`✅ ${PRODUCTS.length} food items seeded.\n`);

    console.log("🎉 Done! Database cleared and seeded successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error.message);
    if (error.parent) console.error("   DB Error:", error.parent.message);
    process.exit(1);
  }
}

seed();
