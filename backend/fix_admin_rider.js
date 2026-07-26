const fs = require('fs');
let content = fs.readFileSync('src/controllers/adminController.js', 'utf8');

// Remove SellerBankAccount from getRiderById
content = content.replace(/const bankAccount = await SellerBankAccount\.findOne\(\{ where: \{ user_id: rider\.user_id \} \}\);\n/, 'const bankAccount = null;\n');

fs.writeFileSync('src/controllers/adminController.js', content);
console.log("adminController rider fixed");
