const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CouponUsage = sequelize.define(
  "CouponUsage",
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
    coupon_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    master_order_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: "coupon_usages",
    timestamps: true,
  }
);

module.exports = CouponUsage;
