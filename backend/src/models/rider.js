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
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    license_number: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    aadhar_number: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    date_of_birth: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    profile_picture_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    delivery_radius_km: {
      type: DataTypes.FLOAT,
      defaultValue: 5.0,
    },
    cod_limit: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    current_lat: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    current_lng: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    notifications: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    pending_profile_update: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    order_notifications_enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
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
