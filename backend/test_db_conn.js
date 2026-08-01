require("dotenv").config();
const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    logging: console.log,
    dialectOptions: {
      connectTimeout: 10000,
      ssl: process.env.DB_SSL === "true" ? { require: true, rejectUnauthorized: false } : false
    },
    pool: { max: 1, min: 0, acquire: 10000, idle: 5000 }
  }
);

(async () => {
  console.log("Connecting to PostgreSQL at:", process.env.DB_HOST, "Port:", process.env.DB_PORT, "DB:", process.env.DB_NAME);
  try {
    await sequelize.authenticate();
    console.log("SUCCESS: Connected to Hostinger PostgreSQL Database! ✅");
    process.exit(0);
  } catch (err) {
    console.error("ERROR connecting to DB: ❌", err.message);
    process.exit(1);
  }
})();

