const fs = require('fs');
const file = 'src/controllers/adminController.js';
let content = fs.readFileSync(file, 'utf8');

const toRemove = [
  'exports.approveSeller',
  'exports.rejectSeller',
  'exports.getApprovedSellers',
  'exports.getPendingSellers',
  'exports.verifySellerBankAccount',
  'exports.getSellerBankAccounts'
];

toRemove.forEach(fnName => {
  const regex = new RegExp(fnName + '\\s*=\\s*asyncHandler\\(async[\\s\\S]*?\\}\\);', 'g');
  content = content.replace(regex, '');
});

fs.writeFileSync(file, content);
console.log("Done");
