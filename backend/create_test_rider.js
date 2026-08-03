require("dotenv").config();
const { User, Rider, Otp, sequelize } = require("./src/models");

async function createTestRider() {
  try {
    await sequelize.authenticate();
    console.log("Connected to Hostinger DB ✅");

    const phone = "9999999999";
    const name = "test rider";
    const otpCode = "123456";

    // 1. Create or Update User
    let user = await User.findOne({ where: { phone } });
    if (user) {
      console.log("Updating existing user to Rider...");
      user.name = name;
      user.role = "RIDER";
      await user.save();
    } else {
      console.log("Creating new Rider User...");
      user = await User.create({
        name,
        phone,
        role: "RIDER"
      });
    }

    // 2. Create or Update Rider Record
    let rider = await Rider.findOne({ where: { user_id: user.id } });
    if (!rider) {
      rider = await Rider.create({
        user_id: user.id,
        vehicle_type: "Bike",
        vehicle_number: "WB-02-AB-9999",
        is_verified: true,
        is_available: true,
        rating: 5.0
      });
      console.log("Rider details record created ✅");
    } else {
      rider.is_verified = true;
      rider.is_available = true;
      await rider.save();
      console.log("Rider details record updated ✅");
    }

    // 3. Set Default OTP 123456 with long expiry for testing
    await Otp.destroy({ where: { phone } });
    const futureExpiry = new Date();
    futureExpiry.setFullYear(futureExpiry.getFullYear() + 5); // 5 years expiry

    await Otp.create({
      phone,
      otp: otpCode,
      attempts: 0,
      expires_at: futureExpiry
    });
    console.log("Default OTP 123456 configured in DB ✅");

    console.log("\n--------------------------------------------------");
    console.log("🚴 RIDER ACCOUNT READY:");
    console.log("  Name:", user.name);
    console.log("  Phone:", user.phone);
    console.log("  Role:", user.role);
    console.log("  Default OTP:", otpCode);
    console.log("  User ID:", user.id);
    console.log("  Rider ID:", rider.id);
    console.log("--------------------------------------------------\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating rider account:", error);
    process.exit(1);
  }
}

createTestRider();
