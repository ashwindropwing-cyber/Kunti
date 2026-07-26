const fs = require('fs');
let content = fs.readFileSync('src/routes/adminRoutes.js', 'utf8');

// Remove CONTACT CHANGE REQUESTS block
content = content.replace(/\/\/ CONTACT CHANGE REQUESTS[\s\S]*?(?=\/\/ RADIUS CHANGE REQUESTS)/, '');

// Remove RADIUS CHANGE REQUESTS block
content = content.replace(/\/\/ RADIUS CHANGE REQUESTS[\s\S]*?(?=\/\/ USER MANAGEMENT)/, '');

fs.writeFileSync('src/routes/adminRoutes.js', content);
console.log("adminRoutes cleaned");

let controller = fs.readFileSync('src/controllers/adminController.js', 'utf8');
controller = controller.replace(/\/\/ CONTACT CHANGE REQUESTS \(ADMIN\)[\s\S]*?(?=\/\/ SELLER RADIUS CHANGE REQUESTS|\/\/ REVIEWS MANAGEMENT|\/\/ USER MANAGEMENT)/i, '');
controller = controller.replace(/\/\/ SELLER RADIUS CHANGE REQUESTS \(ADMIN\)[\s\S]*?(?=\/\/ REVIEWS MANAGEMENT|\/\/ USER MANAGEMENT)/i, '');

fs.writeFileSync('src/controllers/adminController.js', controller);
console.log("adminController cleaned");
