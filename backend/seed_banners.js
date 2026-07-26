require("dotenv").config();
const { Banner } = require("./src/models");

async function seedBanners() {
    try {
        console.log("Seeding Banners...");
        const banners = [
            { title: "Summer Sale 50% Off", image_url: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&q=80&w=1200", display_order: 1, is_active: true },
            { title: "Organic Fresh Groceries", image_url: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=1200", display_order: 2, is_active: true },
            { title: "Next-Gen Audio Experience", image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=1200", display_order: 3, is_active: true },
            { title: "Winter Collection", image_url: "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&q=80&w=1200", display_order: 4, is_active: true },
            { title: "Smart Home Devices", image_url: "https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&q=80&w=1200", display_order: 5, is_active: true }
        ];

        for (const b of banners) {
            await Banner.findOrCreate({ 
                where: { title: b.title }, 
                defaults: b 
            });
        }
        
        console.log("Banners Seeded Successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Error Seeding Banners:", error);
        process.exit(1);
    }
}

seedBanners();
