# Setup Guide: Tind Support Gmail & SMTP Credentials

This document provides step-by-step instructions on how to create a dedicated support email account for Tind using Google Gmail and configure the SMTP credentials on the backend.

---

## Step 1: Create a Dedicated Tind Support Gmail Account

For professional communication and branding, it is best to create a dedicated Google Account for notifications and support rather than using a personal email.

1. Go to the [Google Account Creation Page](https://accounts.google.com/signup).
2. Choose **"For work or my business"** or **"For my personal use"** (a personal use account is free and works perfectly for standard SMTP volumes).
3. Choose a professional email address, for example:
   * `support.tind@gmail.com`
   * `tind.notifications@gmail.com`
   * `tind.app.alerts@gmail.com`
4. Complete the sign-up steps (name, password, recovery phone, and email).

---

## Step 2: Enable 2-Step Verification & Generate an App Password

Google blocks standard username/password sign-in attempts from external applications (like your Node.js backend) to prevent unauthorized access. To bypass this securely, you must generate an **App Password**.

1. Go to the [Google Account Portal](https://myaccount.google.com/) for your newly created support account.
2. Select **Security** from the left-hand navigation menu.
3. Scroll down to the **"How you sign in to Google"** section.
4. Click on **2-Step Verification** and follow the prompts to turn it **ON** (this requires linking a mobile number).
5. Once 2-Step Verification is active, go back to the **Security** page.
6. Click on **2-Step Verification** again, scroll all the way to the bottom of the page, and select **App passwords**.
7. Enter a descriptive name for the password (e.g., `Tind Backend Server`) and click **Create**.
8. A modal will appear showing a unique **16-character code** (e.g., `abcd efgh ijkl mnop`).
9. **Copy this code immediately.** You will not be able to view it again once you close the window.

---

## Step 3: Configure the Backend Environment File

Open your backend environment file **[.env](file:///c:/Source/tind-backend/backend/.env)** and configure the variables under the SMTP section using the code you copied (remove any spaces in the App Password):

```env
# ─── SMTP Email Integration ───────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tind.notifications@gmail.com
SMTP_PASS=abcdefghijklmnop
SMTP_FROM="Tind Support" <tind.notifications@gmail.com>
```

### Explanation of Fields:
* **`SMTP_HOST`**: Set to `smtp.gmail.com` (Google's SMTP server).
* **`SMTP_PORT`**: Set to `587` (the secure port for TLS communication).
* **`SMTP_USER`**: Your newly created Gmail address.
* **`SMTP_PASS`**: The 16-character App Password generated in Step 2.
* **`SMTP_FROM`**: The sender display name and email address that users will see in their inboxes.

---

## Step 4: Verification & Logs

When your server is running, you can verify that SMTP is set up correctly:
* In **Development mode (`NODE_ENV=development`)**: If `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are configured, the backend will send real emails and log:
  ```text
  ✉️  [Email] Sent successfully: <message-id> to recipient@example.com
  ```
* If any of the variables are missing, it will print a test log to the console with the email details instead of sending the email.
