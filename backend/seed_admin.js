require("dotenv").config();
const bcrypt = require("bcryptjs");
const { User, Wallet } = require("./src/models");

async function seedAdmin() {
    try {
        console.log("Seeding Admin User...");
        const hashedPassword = await bcrypt.hash("drop123", 10);
        let admin = await User.findOne({
            where: {
                [require("sequelize").Op.or]: [
                    { email: "dropwing" },
                    { email: "dropwing@dropwinggroups.com" },
                    { phone: "9999999999" }
                ]
            }
        });

        if (admin) {
            admin.email = "dropwing@dropwinggroups.com";
            admin.password = hashedPassword;
            admin.role = "ADMIN";
            admin.name = "Dropwing Admin";
            await admin.save();
            console.log("Admin User Updated Successfully!");
        } else {
            admin = await User.create({
                name: "Dropwing Admin",
                email: "dropwing@dropwinggroups.com",
                phone: "9999999999",
                password: hashedPassword,
                role: "ADMIN"
            });
            console.log("Admin User Created Successfully!");
        }
        
        await Wallet.findOrCreate({ where: { user_id: admin.id } });
        process.exit(0);
    } catch (error) {
        console.error("Error Seeding Admin:", error);
        process.exit(1);
    }
}

seedAdmin();
