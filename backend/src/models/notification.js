const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    target_audience: {
      type: DataTypes.STRING,
      defaultValue: "ALL", // 'CUSTOMERS', 'RIDERS', 'ALL'
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true, // Specific user target, or null for broadcast
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    sent_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    tableName: "notifications",
    timestamps: true,
  }
);

module.exports = Notification;
