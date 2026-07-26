#!/bin/bash
sed -i 's|role: user.role,|role: user.role,\n      user: {\n        id: user.id,\n        name: user.name,\n        phone: user.phone,\n        role: user.role\n      }|g' src/controllers/authController.js
