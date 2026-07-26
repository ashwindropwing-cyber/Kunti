const OTP = require("../models/otp");

exports.checkCooldown = async (phone) => {
  const lastOtp = await OTP.findOne({
    where: { phone },
    order: [["createdAt", "DESC"]],
  });

  if (!lastOtp) return false;

  const diff =
    (Date.now() - new Date(lastOtp.createdAt).getTime()) / 1000;

  return diff < 45; // 45 sec cooldown
};