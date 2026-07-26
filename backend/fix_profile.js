const fs = require('fs');
let content = fs.readFileSync('src/controllers/profileController.js', 'utf8');

// Remove seller logic from getProfile
content = content.replace(/if \(user\.role === "SELLER"\) \{[\s\S]*?\}[\s\n]*/, '');

// Remove seller logic from updateProfile
content = content.replace(/\} else if \(user\.role === "SELLER"\) \{[\s\S]*?\}\n/, '}');

fs.writeFileSync('src/controllers/profileController.js', content);
console.log("profileController fixed");
