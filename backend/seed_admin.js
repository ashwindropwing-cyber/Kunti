require("dotenv").config();
const bcrypt = require("bcryptjs");
const { User, Wallet } = require("./src/models");

async function seedAdmin() {
    try {
        console.log("Seeding Admin User...");
        const hashedPassword = await bcrypt.hash("admin123", 10);
        const [admin, created] = await User.findOrCreate({
            where: { phone: "9999999999" },
            defaults: { 
                name: "Super Admin", 
                email: "admin@tind.com", 
                password: hashedPassword, 
                role: "ADMIN" 
            }
        });
        
        await Wallet.findOrCreate({ where: { user_id: admin.id } });
        
        if (created) {
            console.log("Admin User Created Successfully!");
        } else {
            console.log("Admin User already exists.");
        }
        process.exit(0);
    } catch (error) {
        console.error("Error Seeding Admin:", error);
        process.exit(1);
    }
}

seedAdmin();
