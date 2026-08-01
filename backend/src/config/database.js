const { Sequelize } = require("sequelize");
const path = require("path");

const dbDialect = process.env.DB_DIALECT || "postgres";

let sequelize;

if (process.env.DATABASE_URL) {
  // Production PostgreSQL connection string (e.g. Render / Heroku / Supabase / AWS RDS)
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    protocol: "postgres",
    logging: process.env.NODE_ENV !== "production" ? console.log : false,
    dialectOptions: process.env.DB_SSL === "true" ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : {}
  });
} else if (dbDialect === "postgres") {
  // PostgreSQL environment configuration
  sequelize = new Sequelize(
    process.env.DB_NAME || "kunti_db",
    process.env.DB_USER || "postgres",
    process.env.DB_PASSWORD || "postgres",
    {
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT || 5432,
      dialect: "postgres",
      logging: process.env.NODE_ENV !== "production" ? console.log : false,
      dialectOptions: process.env.DB_SSL === "true" ? {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      } : {},
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
    }
  );
} else {
  // SQLite fallback for standalone local testing
  const storagePath = process.env.DB_STORAGE || path.resolve(__dirname, "../../data/database.sqlite");
  const fs = require("fs");
  const dataDir = path.dirname(storagePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: storagePath,
    logging: process.env.NODE_ENV !== "production" ? console.log : false,
  });
}

module.exports = sequelize;
