require("dotenv").config();
const bcrypt = require("bcryptjs");
const { User, Wallet, sequelize } = require("./src/models");
const { Op } = require("sequelize");

async function createAdmin() {
  try {
    await sequelize.authenticate();
    console.log("Connected to Hostinger DB ✅");

    const username = "drop";
    const rawPassword = "drop123";
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    // Search for existing admin with email or phone 'drop' or 'drop@dropwinggroups.com'
    let admin = await User.findOne({
      where: {
        [Op.or]: [
          { email: "drop" },
          { email: "drop@dropwinggroups.com" },
          { phone: "drop" },
          { phone: "9876543210" }
        ]
      }
    });

    if (admin) {
      console.log("Found existing admin record. Updating credentials...");
      admin.name = "Drop Admin";
      admin.email = "drop";
      admin.password = hashedPassword;
      admin.role = "ADMIN";
      await admin.save();
      console.log("✅ Admin User Updated Successfully!");
    } else {
      console.log("Creating new Admin User...");
      admin = await User.create({
        name: "Drop Admin",
        email: "drop",
        phone: "9876543210",
        password: hashedPassword,
        role: "ADMIN"
      });
      console.log("✅ Admin User Created Successfully!");
    }

    if (Wallet) {
      await Wallet.findOrCreate({ where: { user_id: admin.id } });
    }

    // Verify Password match
    const isMatch = await bcrypt.compare(rawPassword, admin.password);
    console.log("\n--------------------------------------------------");
    console.log("🔑 ADMIN CREDENTIALS VERIFIED:");
    console.log("  Username / Email:", admin.email);
    console.log("  Password:", rawPassword);
    console.log("  Password Match:", isMatch ? "YES ✅" : "NO ❌");
    console.log("  Role:", admin.role);
    console.log("--------------------------------------------------\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating admin user:", error);
    process.exit(1);
  }
}

createAdmin();
