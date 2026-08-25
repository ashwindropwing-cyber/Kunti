const { Op } = require("sequelize");
const User = require("../models/user");
const Rider = require("../models/rider");
const OTP = require("../models/otp");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSMS } = require("../utils/sendSMS");
const { checkCooldown } = require("../utils/otpCooldown");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined in environment");
}

// OTP generator — uses cryptographically secure random number
const generateOTP = () =>
  crypto.randomInt(100000, 999999).toString();

/**
 * SEND REGISTER OTP
 */
exports.sendRegisterOTP = asyncHandler(async (req, res) => {
  let { phone } = req.body;
  phone = phone?.toString().trim();

  if (!phone) return ApiResponse.error(res, "Phone number required", 400);

  if (await checkCooldown(phone)) {
    return ApiResponse.error(res, "Please wait 45 seconds before requesting OTP again", 429);
  }

  const existingUser = await User.findOne({ where: { phone } });
  if (existingUser) return ApiResponse.error(res, "User already exists", 400);

  const otpCode = generateOTP();
  console.log(`[AUTH] 🔑 Register OTP for ${phone}: ${otpCode}`);

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  await sendSMS(phone, `Your Kunti registration OTP is ${otpCode}. Valid for 5 minutes.`);

  return ApiResponse.success(res, null, "OTP sent successfully");
});


/**
 * VERIFY REGISTER OTP
 */
exports.verifyRegisterOTP = asyncHandler(async (req, res) => {
  let { phone, otp, name, password, role } = req.body;

  phone = phone?.toString().trim();
  otp = otp?.toString().trim();

  if (!phone || !otp || !name || !role) {
    return ApiResponse.error(res, "Missing required fields (phone, otp, name, role)", 400);
  }

  // Password complexity: minimum 6 characters
  if (password && password.length < 6) {
    return ApiResponse.error(res, "Password must be at least 6 characters long", 400);
  }

  const allowedRoles = ["CUSTOMER", "SELLER"];
  if (!allowedRoles.includes(role)) {
    return ApiResponse.error(res, "Invalid role", 403);
  }

  const existingUser = await User.findOne({ where: { phone } });
  if (existingUser) return ApiResponse.error(res, "User already exists", 400);

  const otpRecord = await OTP.findOne({ where: { phone } });
  if (!otpRecord) return ApiResponse.error(res, "OTP not found", 400);

  if (otpRecord.expires_at < new Date()) {
    return ApiResponse.error(res, "OTP expired", 400);
  }

  if (otpRecord.attempts >= 5) {
    return ApiResponse.error(res, "Too many incorrect attempts", 429);
  }

  if (otpRecord.otp !== otp) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    return ApiResponse.error(res, "Invalid OTP", 400);
  }

  const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

  const user = await User.create({
    name,
    phone,
    password: hashedPassword,
    role,
  });
  await OTP.destroy({ where: { phone } });

  const token = jwt.sign(
    { id: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return ApiResponse.success(
    res,
    {
      token,
      role: user.role,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    },
    "Registration successful",
    201
  );
});

/**
 * LOGIN
 */
exports.login = asyncHandler(async (req, res) => {
  let { phone, password } = req.body;

  phone = phone?.toString().trim();

  if (!phone || !password) {
    return ApiResponse.error(res, "Phone and password required", 400);
  }

  const user = await User.findOne({ where: { phone } });
  if (!user) return ApiResponse.error(res, "User not found", 400);

  if (user.role === "RIDER") {
    return ApiResponse.error(res, "Rider must login using OTP", 403);
  }

  if (!user.password) {
    return ApiResponse.error(
      res,
      "This account was created without a password. Please use OTP login.",
      401
    );
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) return ApiResponse.error(res, "Invalid credentials", 400);

  const token = jwt.sign(
    { id: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );



  return ApiResponse.success(res, {
    token,
    role: user.role,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
    },
  }, "Login successful");
});



/**
 * SEND SELLER OTP (Login)
 */
exports.sendSellerOTP = asyncHandler(async (req, res) => {
  let { phone } = req.body;
  phone = phone?.toString().trim();

  if (!phone) return ApiResponse.error(res, "Phone required", 400);

  const user = await User.findOne({ where: { phone } });
  if (!user || user.role !== "SELLER") {
    return ApiResponse.error(res, "user not found , please register first", 404);
  }

  if (await checkCooldown(phone)) {
    return ApiResponse.error(res, "Please wait 45 seconds before requesting OTP again", 429);
  }

  const otpCode = generateOTP();
  console.log(`[AUTH] 🔑 Seller Login OTP for ${phone}: ${otpCode}`);

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  await sendSMS(phone, `Your Kunti seller login OTP is ${otpCode}. Valid for 5 minutes.`);

  return ApiResponse.success(res, null, "OTP sent to seller");
});


/**
 * VERIFY SELLER OTP (Login)
 */
exports.verifySellerOTP = asyncHandler(async (req, res) => {
  let { phone, otp } = req.body;

  phone = phone?.toString().trim();
  otp = otp?.toString().trim();

  if (!phone || !otp) {
    return ApiResponse.error(res, "Phone and OTP required", 400);
  }

  const record = await OTP.findOne({ where: { phone } });

  if (!record || record.expires_at < new Date()) {
    return ApiResponse.error(res, "Invalid or expired OTP", 400);
  }

  if (record.attempts >= 5) {
    return ApiResponse.error(res, "Too many incorrect attempts", 429);
  }

  if (record.otp !== otp) {
    record.attempts += 1;
    await record.save();
    return ApiResponse.error(res, "Invalid OTP", 400);
  }

  const user = await User.findOne({ where: { phone } });

  if (!user || user.role !== "SELLER") {
    return ApiResponse.error(res, "Seller account not found", 404);
  }

  await OTP.destroy({ where: { phone } });

  const token = jwt.sign(
    { id: user.id, role: "SELLER" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return ApiResponse.success(res, {
    token,
    role: "SELLER",
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
    },
  }, "Seller login successful");
});

/**
 * FORGOT PASSWORD
 */
exports.forgotPassword = asyncHandler(async (req, res) => {
  let { phone } = req.body;
  phone = phone?.toString().trim();

  const user = await User.findOne({ where: { phone } });

  if (!user || user.role === "RIDER") {
    return ApiResponse.error(res, "Not allowed", 403);
  }

  if (await checkCooldown(phone)) {
    return ApiResponse.error(res, "Please wait 45 seconds before requesting OTP again", 429);
  }

  const otpCode = generateOTP();
  console.log(`[AUTH] 🔑 Forgot Password OTP for ${phone}: ${otpCode}`);

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  await sendSMS(phone, `Your Kunti password reset OTP is ${otpCode}. Valid for 5 minutes.`);

  return ApiResponse.success(res, null, "OTP sent for password reset");
});


/**
 * RESET PASSWORD
 */
exports.resetPassword = asyncHandler(async (req, res) => {
  let { phone, otp, new_password } = req.body;

  phone = phone?.toString().trim();
  otp = otp?.toString().trim();

  if (!phone || !otp || !new_password) {
    return ApiResponse.error(res, "All fields required", 400);
  }

  const record = await OTP.findOne({ where: { phone } });

  if (!record || record.expires_at < new Date()) {
    return ApiResponse.error(res, "Invalid or expired OTP", 400);
  }

  if (record.attempts >= 5) {
    return ApiResponse.error(res, "Too many incorrect attempts", 429);
  }

  if (record.otp !== otp) {
    record.attempts += 1;
    await record.save();
    return ApiResponse.error(res, "Invalid OTP", 400);
  }

  // Password complexity: minimum 6 characters
  if (new_password.length < 6) {
    return ApiResponse.error(res, "Password must be at least 6 characters long", 400);
  }

  const hashed = await bcrypt.hash(new_password, 10);

  // BUG-M3 FIX: Target single user instead of updating all users with matching phone
  const user = await User.findOne({ where: { phone } });
  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }
  user.password = hashed;
  await user.save();
  await OTP.destroy({ where: { phone } });

  return ApiResponse.success(res, null, "Password reset successful");
});

/**
 * ADMIN LOGIN (by Email or Phone + Password)
 */
exports.adminLogin = asyncHandler(async (req, res) => {
  let { email, username, phone, password } = req.body;
  const identifier = (email || username || phone || "").toString().trim();
  const rawPassword = (password || "").toString().trim();

  if (!identifier || !rawPassword) {
    return ApiResponse.error(res, "Email/username and password required", 400);
  }

  const { Op } = require("sequelize");
  const whereClause = {
    role: "ADMIN",
    [Op.or]: [
      { email: identifier },
      { email: `${identifier.toLowerCase()}@kunti.com` },
      { email: `${identifier.toLowerCase()}@dropwinggroups.com` },
      { phone: identifier },
      { name: identifier }
    ]
  };

  let user = await User.findOne({ where: whereClause });

  if (!user && (identifier.toLowerCase() === "admin" || identifier.toLowerCase() === "admin@kunti.com")) {
    user = await User.findOne({ where: { role: "ADMIN" } });
  }

  if (!user) {
    return ApiResponse.error(res, "Invalid admin credentials", 401);
  }

  const isMatch = await bcrypt.compare(rawPassword, user.password);
  if (!isMatch) {
    return ApiResponse.error(res, "Invalid admin credentials", 401);
  }

  const token = jwt.sign(
    { id: user.id, role: "ADMIN" },
    JWT_SECRET,
    { expiresIn: "30d" }
  );

  return ApiResponse.success(res, {
    token,
    role: "ADMIN",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
  }, "Admin login successful");
});


/**
 * UNIFIED SEND OTP (Customer / Seller / Admin)
 */
exports.sendOTP = asyncHandler(async (req, res) => {
  let { phone, role } = req.body;
  phone = phone?.toString().trim();
  if (!phone) return ApiResponse.error(res, "Phone number required", 400);

  // If requesting login as RIDER, verify they are registered by Admin
  if (role === "RIDER") {
    const riderUser = await User.findOne({ where: { phone, role: "RIDER" } });
    if (!riderUser) {
      return ApiResponse.error(
        res,
        "User not found. Please contact admin to register your rider account.",
        404
      );
    }
  }

  const otpCode = generateOTP();

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 10 * 60 * 1000),
  });

  console.log(`[AUTH] 🔑 Customer/User Login OTP for ${phone}: ${otpCode}`);

  await sendSMS(phone, `Your Kunti verification OTP is ${otpCode}. Valid for 10 minutes.`);

  return ApiResponse.success(res, null, "OTP sent successfully");
});


/**
 * UNIFIED VERIFY OTP
 */
exports.verifyOTP = asyncHandler(async (req, res) => {
  let { phone, otp, role } = req.body;
  phone = phone?.toString().trim();
  otp = otp?.toString().trim();

  if (!phone || !otp) return ApiResponse.error(res, "Phone and OTP required", 400);

  const record = await OTP.findOne({ where: { phone } });
  if (!record || record.otp !== otp) {
    if (process.env.NODE_ENV !== "production" && otp === "123456") {
      // Dev bypass
    } else {
      return ApiResponse.error(res, "Invalid or expired OTP", 400);
    }
  }

  // Check OTP expiry
  if (record && record.expires_at < new Date()) {
    return ApiResponse.error(res, "OTP has expired", 400);
  }

  // Check attempt limit
  if (record && record.attempts >= 5) {
    return ApiResponse.error(res, "Too many incorrect attempts", 429);
  }

  let user = await User.findOne({ where: { phone } });
  if (!user) {
    if (role === "RIDER") {
      return ApiResponse.error(
        res,
        "User not found. Please contact admin to register your rider account.",
        404
      );
    }
    // SECURITY: Auto-created users are always CUSTOMER
    const safeRole = "CUSTOMER";
    user = await User.create({
      phone,
      name: `User_${phone.slice(-4)}`,
      role: safeRole
    });
  } else if (role === "RIDER" && user.role !== "RIDER") {
    return ApiResponse.error(
      res,
      "User not registered as Rider. Please contact admin.",
      403
    );
  }

  let { fcm_token } = req.body;
  if (fcm_token) {
    user.fcm_token = fcm_token.toString().trim();
    await user.save();
    try {
      const Rider = require("../models/rider");
      const rider = await Rider.findOne({ where: { user_id: user.id } });
      if (rider) {
        rider.fcm_token = fcm_token.toString().trim();
        await rider.save();
      }
    } catch (_) {}
  }

  // Clean up OTP after successful verification
  await OTP.destroy({ where: { phone } });

  const token = jwt.sign(
    { id: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: "30d" }
  );

  return ApiResponse.success(res, {
    token,
    role: user.role,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role
    }
  }, "OTP verified successfully");
});

// Helper: robustly find rider user by phone across all formats and profile associations
const findRiderUser = async (rawPhone) => {
  if (!rawPhone) return null;
  const cleaned = rawPhone.toString().trim();
  const digitsOnly = cleaned.replace(/\D/g, "");
  const last10 = digitsOnly.slice(-10);

  const phoneVariants = [
    cleaned,
    digitsOnly,
    last10,
    `+91${last10}`,
    `91${last10}`,
    `+91 ${last10}`,
  ].filter(Boolean);

  // 1. Try finding in User table by matching any phone variant
  let user = await User.findOne({
    where: {
      phone: { [Op.in]: phoneVariants },
    },
  });

  // 2. Fallback: match by last 10 digits using LIKE
  if (!user && last10.length === 10) {
    user = await User.findOne({
      where: {
        phone: { [Op.like]: `%${last10}` },
      },
    });
  }

  // 3. Fallback: search Rider table for license or aadhar
  if (!user) {
    const rider = await Rider.findOne({
      where: {
        [Op.or]: [
          { aadhar_number: { [Op.in]: phoneVariants } },
          { license_number: { [Op.in]: phoneVariants } },
        ],
      },
    });
    if (rider && rider.user_id) {
      user = await User.findByPk(rider.user_id);
    }
  }

  if (!user) return null;

  // 4. Verify user has RIDER role or a Rider profile
  const riderProfile = await Rider.findOne({ where: { user_id: user.id } });
  const isRider = user.role === "RIDER" || user.role === "rider" || Boolean(riderProfile);

  if (isRider) {
    if (user.role !== "RIDER") {
      user.role = "RIDER";
      await user.save();
    }
    return { user, rider: riderProfile };
  }

  return null;
};

/**
 * RIDER SPECIFIC SEND OTP
 */
exports.sendRiderOTP = asyncHandler(async (req, res) => {
  let { phone } = req.body;
  phone = phone?.toString().trim();
  if (!phone) return ApiResponse.error(res, "Phone number required", 400);

  const riderData = await findRiderUser(phone);
  if (!riderData) {
    return ApiResponse.error(
      res,
      "Rider account not found. Please contact admin to register your rider account.",
      404
    );
  }

  const { user } = riderData;
  const digitsOnly = phone.replace(/\D/g, "");
  const last10 = digitsOnly.slice(-10);

  const otpCode = generateOTP();

  // Create OTP record for all phone representations so verification always succeeds
  const phonesToStore = [...new Set([user.phone, phone, digitsOnly, last10].filter(Boolean))];
  for (const p of phonesToStore) {
    await OTP.destroy({ where: { phone: p } });
    await OTP.create({
      phone: p,
      otp: otpCode,
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    });
  }

  console.log(`[AUTH] 🔑 Rider Login OTP for ${user.phone} (${phone}): ${otpCode}`);

  await sendSMS(phone, `Your Kunti Rider login OTP is ${otpCode}. Valid for 10 minutes.`);

  return ApiResponse.success(res, null, "OTP sent successfully");
});


/**
 * RIDER SPECIFIC VERIFY OTP
 */
exports.verifyRiderOTP = asyncHandler(async (req, res) => {
  let { phone, otp, fcm_token } = req.body;
  phone = phone?.toString().trim();
  otp = otp?.toString().trim();

  if (!phone || !otp) return ApiResponse.error(res, "Phone and OTP required", 400);

  const riderData = await findRiderUser(phone);
  if (!riderData) {
    return ApiResponse.error(
      res,
      "Rider account not found. Please contact admin to register your rider account.",
      404
    );
  }

  const { user, rider } = riderData;
  const digitsOnly = phone.replace(/\D/g, "");
  const last10 = digitsOnly.slice(-10);

  const phonesToCheck = [...new Set([user.phone, phone, digitsOnly, last10].filter(Boolean))];
  const record = await OTP.findOne({ where: { phone: { [Op.in]: phonesToCheck } } });

  if (!record || record.otp !== otp) {
    if (process.env.NODE_ENV !== "production" && otp === "123456") {
      // Dev bypass
    } else {
      return ApiResponse.error(res, "Invalid or expired OTP", 400);
    }
  }

  if (record && record.expires_at < new Date()) {
    return ApiResponse.error(res, "OTP has expired", 400);
  }

  if (fcm_token) {
    user.fcm_token = fcm_token.toString().trim();
    await user.save();
    if (rider) {
      rider.fcm_token = fcm_token.toString().trim();
      await rider.save();
    }
  }

  for (const p of phonesToCheck) {
    await OTP.destroy({ where: { phone: p } });
  }

  const token = jwt.sign(
    { id: user.id, role: "RIDER" },
    JWT_SECRET,
    { expiresIn: "30d" }
  );

  return ApiResponse.success(res, {
    token,
    role: "RIDER",
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: "RIDER",
    },
    role_data: rider,
  }, "Rider OTP verified successfully");
});

/**
 * UPDATE FCM TOKEN (Authenticated - All Roles)
 */
exports.updateFcmToken = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const fcmToken = req.body?.fcm_token?.toString().trim();

  if (!fcmToken) {
    return ApiResponse.error(res, "fcm_token is required", 400);
  }

  const user = await User.findByPk(userId);
  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  user.fcm_token = fcmToken;
  await user.save();

  // If user is a rider, also update Rider record
  try {
    const Rider = require("../models/rider");
    const rider = await Rider.findOne({ where: { user_id: userId } });
    if (rider) {
      rider.fcm_token = fcmToken;
      await rider.save();
    }
  } catch (_) {}

  console.log(`[FCM] Token updated for user ${userId} (${user.role})`);
  return ApiResponse.success(res, { fcm_token: fcmToken }, "FCM token updated successfully");
});


