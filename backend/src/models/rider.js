const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Rider = sequelize.define(
  "Rider",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    vehicle_type: {
      type: DataTypes.STRING,
      defaultValue: "Bike",
    },
    vehicle_number: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    is_available: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    rating: {
      type: DataTypes.FLOAT,
      defaultValue: 5.0,
    },
    rating_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    fcm_token: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    emergency_contact: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bank_details: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    acceptance_rate: {
      type: DataTypes.FLOAT,
      defaultValue: 100.0,
    },
    completion_rate: {
      type: DataTypes.FLOAT,
      defaultValue: 100.0,
    },
  },
  {
    tableName: "riders",
    timestamps: true,
  }
);

module.exports = Rider;
