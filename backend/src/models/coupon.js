const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Coupon = sequelize.define(
  "Coupon",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    discount_type: {
      type: DataTypes.ENUM("PERCENTAGE", "FIXED"),
      defaultValue: "PERCENTAGE",
      allowNull: false,
    },
    discount_value: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    max_discount_amount: {
      type: DataTypes.FLOAT,
      defaultValue: 0, // 0 = no cap for percentage, or cap limit in ₹
    },
    min_order_amount: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    usage_limit_per_user: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    total_usage_limit: {
      type: DataTypes.INTEGER,
      defaultValue: 1000,
    },
    used_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "coupons",
    timestamps: true,
  }
);

module.exports = Coupon;
