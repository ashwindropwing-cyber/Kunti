require("dotenv").config();
const bcrypt = require("bcryptjs");
const { User, Wallet, sequelize } = require("./src/models");
const { Op } = require("sequelize");

async function setAdmin() {
  try {
    await sequelize.authenticate();
    console.log("Connected to Database ✅");

    const email = process.argv[2] || "admin@kunti.com";
    const rawPassword = process.argv[3] || "admin123";
    const phone = process.argv[4] || "9999999999";
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    let admin = await User.findOne({
      where: {
        [Op.or]: [
          { email: email },
          { email: "admin" },
          { email: "admin@kunti.com" },
          { phone: phone }
        ]
      }
    });

    if (admin) {
      console.log("Found existing admin record. Updating credentials...");
      admin.name = "Restaurant Admin";
      admin.email = email;
      admin.phone = phone;
      admin.password = hashedPassword;
      admin.role = "ADMIN";
      await admin.save();
      console.log("✅ Admin User Updated Successfully!");
    } else {
      console.log("Creating new Admin User...");
      admin = await User.create({
        name: "Restaurant Admin",
        email: email,
        phone: phone,
        password: hashedPassword,
        role: "ADMIN"
      });
      console.log("✅ Admin User Created Successfully!");
    }

    if (Wallet) {
      await Wallet.findOrCreate({ where: { user_id: admin.id } });
    }

    const isMatch = await bcrypt.compare(rawPassword, admin.password);
    console.log("\n==================================================");
    console.log("🔑 ADMIN CREDENTIALS ACTIVE IN DATABASE:");
    console.log("  Username / Email :", admin.email);
    console.log("  Phone Number     :", admin.phone);
    console.log("  Password         :", rawPassword);
    console.log("  Password Verified:", isMatch ? "YES ✅" : "NO ❌");
    console.log("  Role             :", admin.role);
    console.log("==================================================\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error setting admin credentials:", error);
    process.exit(1);
  }
}

setAdmin();
