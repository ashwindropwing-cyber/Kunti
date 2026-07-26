const axios = require("axios");

/**
 * Sends an OTP SMS using the Twilio REST API.
 * The Twilio credentials should be stored in the following environment variables:
 *   - `TWILIO_ACCOUNT_SID`
 *   - `TWILIO_AUTH_TOKEN`
 *   - `TWILIO_PHONE_NUMBER`
 *
 * In development mode (NODE_ENV !== "production") or if SMS_TEST_MODE is true,
 * the OTP is logged to the console instead of sending a real SMS.
 */
exports.sendSMS = async (phone, message) => {
  try {
    // Extract a 6‑digit OTP from the message text if present.
    const otpMatch = message.match(/\d{6}/);
    const otp = otpMatch ? otpMatch[0] : "";

    // 🧪 TEST MODE: Skip real SMS in development or for test numbers
    const isTestNumber = phone.startsWith("9000") || phone.startsWith("9111");
    const isTestMode = process.env.SMS_TEST_MODE === "true" || process.env.NODE_ENV !== "production";

    if (isTestMode || isTestNumber) {
      console.log(`🧪 [SMS TEST MODE] To: ${phone} | Message: "${message}" | OTP: ${otp || "N/A"}`);
      return; // Skip real API call
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone) {
      console.error("❌ Twilio configuration missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)");
      return;
    }

    // Twilio REST API expects urlencoded parameters
    const params = new URLSearchParams();
    params.append("To", phone);
    params.append("From", fromPhone);
    params.append("Body", message);

    const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      params.toString(),
      {
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (response.status === 201 || response.status === 200) {
      console.log("📩 SMS sent successfully via Twilio to", phone);
    } else {
      console.error("⚠️ Twilio SMS returned unexpected status:", response.status, response.data);
    }
  } catch (error) {
    const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error("⚠️ Twilio error sending SMS:", errorData);
    if (process.env.NODE_ENV !== "production") {
      console.log("📩 Fallback message (DEV):", message);
    }
  }
};