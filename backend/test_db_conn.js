require("dotenv").config();
const { Sequelize } = require("sequelize");

const dialect = process.env.DB_DIALECT || "mysql";
const defaultPort = dialect === "mysql" || dialect === "mariadb" ? 3306 : 5432;
const port = parseInt(process.env.DB_PORT || defaultPort, 10);

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: port,
    dialect: dialect,
    logging: console.log,
    dialectOptions: {
      connectTimeout: 10000,
      ssl: process.env.DB_SSL === "true" ? { require: true, rejectUnauthorized: false } : false
    },
    pool: { max: 1, min: 0, acquire: 10000, idle: 5000 }
  }
);

(async () => {
  console.log(`Connecting to ${dialect.toUpperCase()} at:`, process.env.DB_HOST, "Port:", port, "DB:", process.env.DB_NAME);
  try {
    await sequelize.authenticate();
    console.log("SUCCESS: Connected to Hostinger Database via Sequelize! ✅");
    process.exit(0);
  } catch (err) {
    console.error("ERROR connecting to DB: ❌", err);
    process.exit(1);
  }
})();

