const { Sequelize } = require("sequelize");
const path = require("path");
const fs = require("fs");

const dbDialect = process.env.DB_DIALECT || "postgres";

function createSqliteSequelize() {
  const storagePath = process.env.DB_STORAGE || path.resolve(__dirname, "../../data/database.sqlite");
  const dataDir = path.dirname(storagePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return new Sequelize({
    dialect: "sqlite",
    storage: storagePath,
    logging: process.env.NODE_ENV !== "production" ? console.log : false,
  });
}

let sequelize;

if (process.env.USE_SQLITE === "true" || process.env.DB_DIALECT === "sqlite") {
  sequelize = createSqliteSequelize();
} else if (process.env.DATABASE_URL) {
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
} else {
  const dialect = process.env.DB_DIALECT || "mysql";
  const defaultPort = dialect === "mysql" || dialect === "mariadb" ? 3306 : 5432;
  sequelize = new Sequelize(
    process.env.DB_NAME || "kunti_db",
    process.env.DB_USER || "postgres",
    process.env.DB_PASSWORD || "postgres",
    {
      host: process.env.DB_HOST || "127.0.0.1",
      port: parseInt(process.env.DB_PORT || defaultPort, 10),
      dialect: dialect,
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
}

module.exports = sequelize;
