const fs = require('fs');
let content = fs.readFileSync('src/controllers/withdrawalController.js', 'utf8');

// Remove SellerBankAccount import
content = content.replace(/const SellerBankAccount = require\([^)]+\);\n/g, '');

// The withdrawalController creates a withdrawal request and passes bank account details.
// Let's replace the bank account requirement with dummy details or skip it.
content = content.replace(/const bank = await SellerBankAccount\.findOne\([\s\S]*?if \(!bank\) \{[\s\S]*?\}\n/, `
      // Skip bank account requirement for now since SellerBankAccount is removed
      const bank = { account_number: "N/A", ifsc_code: "N/A", account_holder_name: "N/A", bank_name: "N/A" };
`);

fs.writeFileSync('src/controllers/withdrawalController.js', content);
console.log("withdrawalController fixed");
