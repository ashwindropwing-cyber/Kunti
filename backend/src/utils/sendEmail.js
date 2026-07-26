const nodemailer = require("nodemailer");

/**
 * Robust utility to send email notifications.
 * Supports SMTP configuration via environment variables:
 *   - SMTP_HOST
 *   - SMTP_PORT
 *   - SMTP_USER
 *   - SMTP_PASS
 *   - SMTP_FROM (optional default sender)
 * 
 * Falls back to logging the email details in development/test environments.
 */
exports.sendEmail = async ({ to, subject, html, text }) => {
  try {
    if (!to) {
      console.error("[Email] Recipient 'to' is required but was undefined");
      return;
    }

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || `"Tind Notifications" <no-reply@tind.com>`;

    const isDev = process.env.NODE_ENV !== "production";

    // If SMTP credentials aren't provided, log to console in dev/test
    if (!host || !user || !pass) {
      console.log(`✉️  [EMAIL TEST MODE]
┌ To: ${to}
├ Subject: ${subject}
├ Text: ${text || "N/A"}
└ HTML Snippet: ${html ? html.substring(0, 150) + "..." : "N/A"}`);
      return;
    }

    // Configure transporter
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: parseInt(port) === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from,
      to,
      subject,
      text,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️  [Email] Sent successfully: ${info.messageId} to ${to}`);
    return info;
  } catch (error) {
    console.error("[Email] Failed to send email:", error.message || error);
  }
};
