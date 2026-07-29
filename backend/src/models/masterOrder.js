const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const MasterOrder = sequelize.define(
  "MasterOrder",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    order_number: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    address_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    rider_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    subtotal: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    discount_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    coupon_code: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    delivery_fee: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    tax_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    total_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    payment_method: {
      type: DataTypes.STRING,
      defaultValue: "COD", // 'COD', 'ONLINE'
    },
    payment_status: {
      type: DataTypes.STRING,
      defaultValue: "PENDING", // 'PENDING', 'PAID', 'FAILED'
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "PLACED", // 'PLACED' → 'ACCEPTED' → 'PREPARING' → 'ASSIGNED' → 'OUT_FOR_DELIVERY' → 'DELIVERED' | 'CANCELLED'
    },
    razorpay_order_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    razorpay_payment_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    delivery_address: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    order_type: {
      type: DataTypes.STRING,
      defaultValue: "DELIVERY", // 'DELIVERY' | 'DINE_IN'
      allowNull: false,
    },
    table_number: {
      type: DataTypes.STRING,
      allowNull: true, // only for DINE_IN orders
    },
    is_paid: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    cod_collected: {
      type: DataTypes.BOOLEAN,
      defaultValue: false, // true after admin confirms cash collected from rider
    },
    delivery_otp: {
      type: DataTypes.STRING(4),
      allowNull: true,
    },
  },
  {
    tableName: "master_orders",
    timestamps: true,
  }
);

module.exports = MasterOrder;
