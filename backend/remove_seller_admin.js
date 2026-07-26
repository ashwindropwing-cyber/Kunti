const fs = require('fs');
const file = 'src/controllers/adminController.js';
let content = fs.readFileSync(file, 'utf8');

const toRemove = [
  'exports.getSellerBankAccounts',
  'exports.getAllSellers',
  'exports.getSellerById',
  'exports.createSellerByAdmin',
  'exports.updateSellerByAdmin',
  'exports.deleteSellerByAdmin',
  'exports.getSellerRadiusRequests',
  'exports.approveSellerRadiusChange',
  'exports.rejectSellerRadiusChange'
];

toRemove.forEach(fnName => {
  // Regex to remove the function block: exports.fnName = asyncHandler(async ...);
  // It handles everything until the next exports. or end of file
  // Need to be careful with closing braces.
  const regex = new RegExp(fnName + '\\s*=\\s*asyncHandler\\(async[\\s\\S]*?\\}\\);', 'g');
  content = content.replace(regex, '');
});

fs.writeFileSync(file, content);
console.log("Done");
