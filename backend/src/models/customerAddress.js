const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CustomerAddress = sequelize.define(
  "CustomerAddress",
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
    address_line1: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address_line2: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    landmark: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Kolkata",
    },
    pincode: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    latitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    longitude: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    address_type: {
      type: DataTypes.STRING,
      defaultValue: "HOME",
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    name: {
      type: DataTypes.VIRTUAL,
      get() {
        return this._name || "";
      },
      set(val) {
        this._name = val;
      }
    },
    phone_number: {
      type: DataTypes.VIRTUAL,
      get() {
        return this._phone_number || "";
      },
      set(val) {
        this._phone_number = val;
      }
    },
    state: {
      type: DataTypes.VIRTUAL,
      get() {
        return this._state || "West Bengal";
      },
      set(val) {
        this._state = val;
      }
    },
    house_no: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue("address_line1");
      },
      set(val) {
        this.setDataValue("address_line1", val);
      }
    },
    area: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue("address_line2");
      },
      set(val) {
        this.setDataValue("address_line2", val);
      }
    },
    label: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue("address_type");
      },
      set(val) {
        this.setDataValue("address_type", val);
      }
    },
  },
  {
    tableName: "customer_addresses",
    timestamps: true,
  }
);

module.exports = CustomerAddress;
