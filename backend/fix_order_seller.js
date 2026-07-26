const fs = require('fs');
let content = fs.readFileSync('src/controllers/orderController.js', 'utf8');

// The seller notification block is inside `_notifyStatusChange` function
// Let's remove the block
content = content.replace(/\/\/ 2\. Seller Notification \(specifically for CANCELLATIONS\)[\s\S]*?(?=\/\/ 3\. Rider Notification)/, '');

fs.writeFileSync('src/controllers/orderController.js', content);
console.log("orderController seller notification removed");
