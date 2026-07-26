const fs = require('fs');
const artifactPath = '/home/ashwin/.gemini/antigravity-ide/brain/12a07b4a-eac4-48ed-92d5-117e4d099e2d/task.md';
let content = fs.readFileSync(artifactPath, 'utf8');

// Mark remaining task 3 as done
content = content.replace(/- \[\/\] Remove remaining unused seller-specific endpoints from `adminController.js`/, '- [x] Remove remaining unused seller-specific endpoints from `adminController.js`');
content = content.replace(/- \[\/\] Identify and clean up lingering `Seller` and `SellerBankAccount` models in controllers./, '- [x] Identify and clean up lingering `Seller` and `SellerBankAccount` models in controllers.');

fs.writeFileSync(artifactPath, content);
console.log("task.md updated");
