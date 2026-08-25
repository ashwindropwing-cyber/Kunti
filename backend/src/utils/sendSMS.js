const axios = require("axios");

const TWOFACTOR_BASE_URL = "https://2factor.in/API/V1";

/**
 * Sends an OTP SMS via 2Factor.in (Primary) with fallback to other gateways.
 * The 2Factor configuration in .env:
 *   - `TWOFACTOR_API_KEY` (or `TWO_FACTOR_API_KEY`)
 *   - `TWOFACTOR_TEMPLATE_NAME` (optional, default: "OTP1")
 *
 * For testing and developer visibility, the OTP code is ALWAYS logged to console.
 */
exports.sendSMS = async (phone, message) => {
  try {
    const cleanPhone = (phone || "").toString().replace(/\D/g, "").slice(-10);
    const otpMatch = (message || "").match(/\d{4,6}/);
    const otp = otpMatch ? otpMatch[0] : "";

    // 🔑 ALWAYS display OTP in logs for testing and debugging
    console.log(`[AUTH] 🔑 OTP for +91${cleanPhone}: ${otp} (Message: "${message}")`);

    const apiKey = process.env.TWOFACTOR_API_KEY || process.env.TWO_FACTOR_API_KEY;

    if (!apiKey) {
      console.warn("⚠️ [2Factor] TWOFACTOR_API_KEY not configured in .env. SMS simulated in logs.");
      return;
    }

    if (!cleanPhone || cleanPhone.length !== 10) {
      console.error(`❌ [2Factor] Invalid 10-digit Indian phone number: "${phone}"`);
      return;
    }

    if (!otp) {
      console.warn(`⚠️ [2Factor] No numeric OTP found in message: "${message}"`);
      return;
    }

    const templateName = process.env.TWOFACTOR_TEMPLATE_NAME || "OTP1";
    // 2Factor URL format: https://2factor.in/API/V1/{api_key}/SMS/{phone}/{otp}/{template_name}
    const url = `${TWOFACTOR_BASE_URL}/${apiKey}/SMS/${cleanPhone}/${otp}/${templateName}`;

    console.log(`[SMS 2FACTOR] 📤 Sending OTP ${otp} to +91${cleanPhone} via 2Factor.in...`);

    const response = await axios.get(url, { timeout: 12000 });

    if (response.data && response.data.Status === "Success") {
      console.log(`[SMS 2FACTOR] ✅ SMS sent successfully to +91${cleanPhone} (Session: ${response.data.Details})`);
    } else {
      console.warn(`⚠️ [SMS 2FACTOR] Template response:`, response.data);
      // Try fallback direct SMS route if template was not found or failed
      try {
        const fallbackUrl = `${TWOFACTOR_BASE_URL}/${apiKey}/SMS/+91${cleanPhone}/${otp}`;
        const fallbackRes = await axios.get(fallbackUrl, { timeout: 12000 });
        if (fallbackRes.data && fallbackRes.data.Status === "Success") {
          console.log(`[SMS 2FACTOR] ✅ SMS sent via direct route to +91${cleanPhone}`);
        }
      } catch (fbErr) {
        console.warn(`⚠️ [SMS 2FACTOR] Direct route fallback error:`, fbErr.message);
      }
    }
  } catch (error) {
    const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`⚠️ [SMS 2FACTOR] Error sending SMS: ${errorMsg}`);
  }
};