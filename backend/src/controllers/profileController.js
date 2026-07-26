const User = require("../models/user");
const Rider = require("../models/rider");
const Wallet = require("../models/wallet");
const OTP = require("../models/otp");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSMS } = require("../utils/sendSMS");
const { checkCooldown } = require("../utils/otpCooldown");

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

exports.getProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const user = await User.findByPk(userId);

  if (!user) {
    return ApiResponse.error(res, "User not found", 404);
  }

  let extraData = null;
  let documents = [];



  if (user.role === "RIDER") {
    extraData = await Rider.findOne({
      where: { user_id: userId },
    });
    
    // Auto-create missing rider profile if user has RIDER role
    if (!extraData) {
      console.log(`[Profile Controller] Auto-creating missing rider profile for user ${userId}`);
      extraData = await Rider.create({
        user_id: userId,
        vehicle_type: "Bike",
        vehicle_number: "",
        is_verified: false,
        is_available: false,
        delivery_radius_km: 5.0
      });
    }

    if (extraData) {
      const RiderDocument = require("../models/riderDocument");
      const docs = await RiderDocument.findAll({ where: { rider_id: extraData.id } });
      documents = docs.map((d) => ({
        type: d.document_type,
        file_path: d.document_url,
        status: (d.status === "VERIFIED" || d.status === "APPROVED") ? "VERIFIED" : d.status === "REJECTED" ? "REJECTED" : "UPLOADED"
      }));
    }
  }

  const wallet = await Wallet.findOne({
    where: { user_id: userId },
  });

  return ApiResponse.success(res, {
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
    },
    role_data: extraData,
    documents,
    wallet: wallet
      ? {
          available_balance: toNumber(wallet.available_balance),
          pending_balance: toNumber(wallet.pending_balance),
        }
      : null,
  });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, otp } = req.body;
  const userId = req.user.id;

  const user = await User.findByPk(userId);
  if (!user) return ApiResponse.error(res, "User not found", 404);

  if (name) {
    user.name = name;
  }

  if (phone && phone !== user.phone) {
    // Check if phone is already taken by another user
    const existingUser = await User.findOne({ where: { phone } });
    if (existingUser) {
      return ApiResponse.error(res, "Phone number is already in use by another account", 400);
    }

    if (otp) {
      // VERIFY OTP
      const record = await OTP.findOne({ where: { phone } });

      if (!record || record.expires_at < new Date()) {
        return ApiResponse.error(res, "Invalid or expired OTP", 400);
      }

      if (record.otp !== otp) {
        record.attempts = (record.attempts || 0) + 1;
        await record.save();
        return ApiResponse.error(res, "Incorrect OTP", 400);
      }

      user.phone = phone;
      await OTP.destroy({ where: { phone } });
    } else {
      // SEND OTP
      if (await checkCooldown(phone)) {
        return ApiResponse.error(res, "Please wait before requesting another OTP", 429);
      }

      const otpCode = generateOTP();
      if (process.env.NODE_ENV !== "production") {
        console.log(`[PROFILE] Phone Update OTP for ${phone}: ${otpCode}`);
      }
      await OTP.destroy({ where: { phone } });
      await OTP.create({
        phone,
        otp: otpCode,
        attempts: 0,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      });

      await sendSMS(phone, `Your OTP for phone update is ${otpCode}. Valid for 5 minutes.`);

      await user.save();
      return ApiResponse.success(res, { otp_required: true }, "OTP sent to new phone number");
    }
  }

  if (req.body.email !== undefined) {
    user.email = req.body.email;
  }

  let extraData = null;
  let documents = [];

  if (user.role === "RIDER") {
    let rider = await Rider.findOne({ where: { user_id: userId } });
    if (!rider) {
      rider = await Rider.create({
        user_id: userId,
        vehicle_type: req.body.vehicle_type,
        vehicle_number: req.body.vehicle_number,
        address: req.body.address,
        license_number: req.body.license_number,
        aadhar_number: req.body.aadhar_number,
        date_of_birth: req.body.date_of_birth,
        profile_picture_url: req.file ? req.file.path : undefined,
        is_verified: false,
        is_available: false,
        delivery_radius_km: parseFloat(req.body.delivery_radius_km) || 5.0,
        rating: 0.0,
        rating_count: 0
      });
    } else {
      console.log("[Profile Controller] Updating existing rider profile for user:", userId);
      
      // If a reason is provided, this is a profile edit request
      if (req.body.reason) {
        const pendingUpdate = {
          data: {
            name: name || user.name,
            email: req.body.email !== undefined ? req.body.email : user.email,
            vehicle_type: req.body.vehicle_type !== undefined ? req.body.vehicle_type : rider.vehicle_type,
            vehicle_number: req.body.vehicle_number !== undefined ? req.body.vehicle_number : rider.vehicle_number,
            address: req.body.address !== undefined ? req.body.address : rider.address,
            license_number: req.body.license_number !== undefined ? req.body.license_number : rider.license_number,
            aadhar_number: req.body.aadhar_number !== undefined ? req.body.aadhar_number : rider.aadhar_number,
            date_of_birth: req.body.date_of_birth !== undefined ? req.body.date_of_birth : rider.date_of_birth,
            delivery_radius_km: req.body.delivery_radius_km !== undefined ? parseFloat(req.body.delivery_radius_km) : rider.delivery_radius_km,
            profile_picture_url: req.file ? req.file.path : rider.profile_picture_url
          },
          reason: req.body.reason,
          status: "PENDING",
          timestamp: new Date().toISOString()
        };
        rider.pending_profile_update = pendingUpdate;
        await rider.save();
        return ApiResponse.success(res, { role_data: rider }, "Profile update requested. Awaiting admin approval.");
      }

      if (req.body.vehicle_type !== undefined) rider.vehicle_type = req.body.vehicle_type;
      if (req.body.vehicle_number !== undefined) rider.vehicle_number = req.body.vehicle_number;
      if (req.body.address !== undefined) rider.address = req.body.address;
      if (req.body.license_number !== undefined) rider.license_number = req.body.license_number;
      if (req.body.aadhar_number !== undefined) rider.aadhar_number = req.body.aadhar_number;
      if (req.body.date_of_birth !== undefined) rider.date_of_birth = req.body.date_of_birth;
      if (req.file) rider.profile_picture_url = req.file.path;
      if (req.body.delivery_radius_km !== undefined) rider.delivery_radius_km = parseFloat(req.body.delivery_radius_km) || 5.0;
      
      console.log("[Profile Controller] Values before save:", {
        id: rider.id,
        vehicle_type: rider.vehicle_type,
        vehicle_number: rider.vehicle_number
      });
      
      await rider.save();
    }
    extraData = rider;

    const RiderDocument = require("../models/riderDocument");
    const docs = await RiderDocument.findAll({ where: { rider_id: rider.id } });
    documents = docs.map((d) => ({
      type: d.document_type,
      file_path: d.document_url,
      status: (d.status === "VERIFIED" || d.status === "APPROVED") ? "verified" : d.status === "REJECTED" ? "rejected" : "uploaded"
    }));
  }
  await user.save();

  const wallet = await Wallet.findOne({ where: { user_id: userId } });

  return ApiResponse.success(res, {
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
    },
    role_data: extraData,
    documents,
    wallet: wallet
      ? {
          available_balance: toNumber(wallet.available_balance),
          pending_balance: toNumber(wallet.pending_balance),
        }
      : null,
  }, "Profile updated");
});
