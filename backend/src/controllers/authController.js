const User = require("../models/user");
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
  if (process.env.NODE_ENV !== "production") {
    console.log(`[AUTH] OTP for ${phone}: ${otpCode}`);
  }

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  await sendSMS(phone, `Your TIND registration OTP is ${otpCode}`);

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

  await Wallet.create({
    user_id: user.id,
    available_balance: 0,
    pending_balance: 0,
    total_earned: 0,
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
 * SEND RIDER OTP
 */
exports.sendRiderOTP = asyncHandler(async (req, res) => {
  let { phone } = req.body;
  phone = phone?.toString().trim();

  if (!phone) return ApiResponse.error(res, "Phone number is required", 400);

  // Check if rider exists
  const user = await User.findOne({ where: { phone, role: "RIDER" } });
  if (!user) {
    return ApiResponse.error(res, "user not found , please register first", 404);
  }

  if (await checkCooldown(phone)) {
    return ApiResponse.error(res, "Please wait 45 seconds before requesting OTP again", 429);
  }

  const otpCode = generateOTP();
  if (process.env.NODE_ENV !== "production") {
    console.log(`[AUTH] Login OTP for ${phone}: ${otpCode}`);
  }

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  await sendSMS(phone, `Your rider OTP is ${otpCode}. Valid for 5 minutes.`);

  return ApiResponse.success(res, null, "OTP sent successfully");
});

/**
 * VERIFY RIDER OTP
 */
exports.verifyRiderOTP = asyncHandler(async (req, res) => {
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

  if (!user) {
    return ApiResponse.error(res, "Rider account not found", 404);
  }

  if (user.role !== "RIDER") {
    return ApiResponse.error(res, "Access denied. Only riders can login here.", 403);
  }

  await OTP.destroy({ where: { phone } });

  const token = jwt.sign(
    { id: user.id, role: "RIDER" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  const Rider = require("../models/rider");

  let extraData = await Rider.findOne({ where: { user_id: user.id } });
  let documents = [];

  return ApiResponse.success(res, {
    token,
    role: "RIDER",
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
    },
    role_data: extraData,
    documents,
  }, "Rider login successful");
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
  if (process.env.NODE_ENV !== "production") {
    console.log(`[AUTH] Register OTP for ${phone}: ${otpCode}`);
  }

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  await sendSMS(phone, `Your TIND seller login OTP is ${otpCode}. Valid for 5 minutes.`);

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

  const sellerProfile = await Seller.findOne({
    where: { user_id: user.id },
  });

  return ApiResponse.success(res, {
    token,
    role: "SELLER",
    seller: sellerProfile ? {
      id: sellerProfile.id,
      is_approved: sellerProfile.is_approved,
    } : null,
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
  if (process.env.NODE_ENV !== "production") {
    console.log(`[AUTH] Forgot Password OTP for ${phone}: ${otpCode}`);
  }

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  await sendSMS(phone, `Reset OTP: ${otpCode}. Valid for 5 minutes.`);

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
  let { email, phone, password } = req.body;
  email = email?.toString().trim();
  phone = phone?.toString().trim();

  if ((!email && !phone) || !password) {
    return ApiResponse.error(res, "Email/phone and password required", 400);
  }

  const { Op } = require("sequelize");
  const whereClause = email
    ? {
        [Op.or]: [
          { email: email },
          { email: `${email}@dropwinggroups.com` },
          { phone: email }
        ]
      }
    : { phone };
  const user = await User.findOne({ where: whereClause });

  if (!user || user.role !== "ADMIN") {
    return ApiResponse.error(res, "Invalid admin credentials", 401);
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return ApiResponse.error(res, "Invalid admin credentials", 401);
  }

  const token = jwt.sign(
    { id: user.id, role: "ADMIN" },
    JWT_SECRET,
    { expiresIn: "7d" }
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
 * UNIFIED SEND OTP (Rider / Customer / Seller)
 */
exports.sendOTP = asyncHandler(async (req, res) => {
  let { phone } = req.body;
  phone = phone?.toString().trim();
  if (!phone) return ApiResponse.error(res, "Phone number required", 400);

  const otpCode = process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

  await OTP.destroy({ where: { phone } });
  await OTP.create({
    phone,
    otp: otpCode,
    attempts: 0,
    expires_at: new Date(Date.now() + 10 * 60 * 1000),
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`[AUTH] Unified OTP for ${phone}: ${otpCode}`);
  }

  // Never return OTP in response body in production
  const responseData = process.env.NODE_ENV !== "production" ? { otp: otpCode } : null;
  return ApiResponse.success(res, responseData, "OTP sent successfully");
});

/**
 * UNIFIED VERIFY OTP
 */
exports.verifyOTP = asyncHandler(async (req, res) => {
  let { phone, otp } = req.body;
  phone = phone?.toString().trim();
  otp = otp?.toString().trim();

  if (!phone || !otp) return ApiResponse.error(res, "Phone and OTP required", 400);

  const record = await OTP.findOne({ where: { phone } });
  if (!record || record.otp !== otp) {
    // Allow master test OTP in non-prod only
    if (process.env.NODE_ENV !== "production" && otp === "123456") {
      // Pass — dev/test bypass
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
    // SECURITY: Auto-created users are always CUSTOMER — never allow role escalation
    const safeRole = "CUSTOMER";
    user = await User.create({
      phone,
      name: `User_${phone.slice(-4)}`,
      role: safeRole
    });
  }

  // Clean up OTP after successful verification
  await OTP.destroy({ where: { phone } });

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
      role: user.role
    }
  }, "OTP verified successfully");
});