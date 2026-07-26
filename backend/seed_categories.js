require("dotenv").config();
const { Category } = require("./src/models");

async function seedCategories() {
    try {
        console.log("Seeding Categories...");
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

        for (const cat of categories) {
            await Category.findOrCreate({ 
                where: { name: cat.name }, 
                defaults: cat 
            });
        }
        
        console.log("Categories Seeded Successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Error Seeding Categories:", error);
        process.exit(1);
    }
}

seedCategories();
