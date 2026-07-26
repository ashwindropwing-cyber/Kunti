const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const PlatformSettings = sequelize.define(
  "PlatformSettings",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      defaultValue: "string", // 'string', 'number', 'boolean', 'json'
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "platform_settings",
    timestamps: true,
  }
);

module.exports = PlatformSettings;
