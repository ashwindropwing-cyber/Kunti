const fs = require('fs');
let content = fs.readFileSync('src/controllers/authController.js', 'utf8');

// Remove Seller logic from verifyOTP (login)
content = content.replace(/if \(user\.role === "SELLER"\) \{[\s\S]*?\}\n/, '');

// Remove seller registration
content = content.replace(/\/\/ ── Seller Registration ──[\s\S]*?(?=\/\/ ── Export All Functions ──)/, '');

fs.writeFileSync('src/controllers/authController.js', content);
console.log("authController seller logic removed");
