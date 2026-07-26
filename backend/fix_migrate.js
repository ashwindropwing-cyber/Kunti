const fs = require('fs');
let content = fs.readFileSync('src/migrateWallets.js', 'utf8');

// Remove Seller require
content = content.replace(/const Seller = require\([^)]+\);\n/g, '');

// Remove Seller Settlement block
content = content.replace(/\/\/ 2\. Seller Settlement[\s\S]*?(?=\n\n      order\.is_settled = true;)/, '');

fs.writeFileSync('src/migrateWallets.js', content);
console.log("migrateWallets fixed");
