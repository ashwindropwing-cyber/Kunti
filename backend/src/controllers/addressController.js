const CustomerAddress = require("../models/customerAddress");



// ===============================
// ADD ADDRESS
// ===============================
exports.saveAddress = async (req, res) => {
  const userId = req.user?.id || req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized user" });
  }
  try {

    let {
      label,
      house_no,
      area,
      landmark,
      city,
      state,
      pincode,
      latitude,
      longitude,
      name,
      phone_number,
    } = req.body;

    const User = require("../models/user");
    const userDoc = await User.findOne({ where: { id: userId } });
    if (userDoc) {
      if (!name) name = userDoc.name;
      if (!phone_number) phone_number = userDoc.phone;
    }

    house_no = house_no || "";

    // ✅ Validate required fields properly
    if (
      !label ||
      !area ||
      !city ||
      !state ||
      !pincode ||
      !name ||
      !phone_number ||
      latitude === undefined ||
      longitude === undefined
    ) {
      return res.status(400).json({ message: "Missing required fields (label, area, city, state, pincode, name, phone_number, latitude, longitude)" });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: "Invalid latitude or longitude" });
    }

    const address = await CustomerAddress.create({
      user_id: userId,
      label,
      house_no,
      area,
      landmark,
      city,
      state,
      pincode,
      latitude: lat,
      longitude: lng,
      name,
      phone_number,
      is_default: false,
    });

    // Auto set default if first address
    const count = await CustomerAddress.count({
      where: { user_id: userId },
    });

    if (count === 1) {
      address.is_default = true;
      await CustomerAddress.update({ is_default: true }, { where: { id: address.id } });
    }

    return res.status(201).json({
      message: "Address saved successfully",
      address,
    });

  } catch (error) {
    console.error("Save address error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};


// ===============================
// GET ALL ADDRESSES
// ===============================
exports.getAddresses = async (req, res) => {
  try {
    const addresses = await CustomerAddress.findAll({
      where: { user_id: req.user.id },
      order: [["createdAt", "DESC"]],
    });

    return res.json(addresses);

  } catch (error) {
    console.error("Get addresses error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ===============================
// UPDATE ADDRESS
// ===============================
exports.updateAddress = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { id } = req.params;

    const address = await CustomerAddress.findByPk(id);

    if (!address || address.user_id !== userId) {
      return res.status(404).json({ message: "Address not found" });
    }

    // Prevent changing ownership
    delete req.body.user_id;

    if (req.body.latitude !== undefined) {
      const lat = parseFloat(req.body.latitude);
      if (isNaN(lat)) {
        return res.status(400).json({ message: "Invalid latitude" });
      }
      req.body.latitude = lat;
    }

    if (req.body.longitude !== undefined) {
      const lng = parseFloat(req.body.longitude);
      if (isNaN(lng)) {
        return res.status(400).json({ message: "Invalid longitude" });
      }
      req.body.longitude = lng;
    }

    await address.update(req.body);

    return res.json({
      message: "Address updated successfully",
      address,
    });

  } catch (error) {
    console.error("Update address error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ===============================
// DELETE ADDRESS
// ===============================
exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { id } = req.params;

    const address = await CustomerAddress.findByPk(id);

    if (!address || address.user_id !== userId) {
      return res.status(404).json({ message: "Address not found" });
    }

    if (address.is_default) {
      // Find another address of this user to make default so they aren't default-less
      const allAddresses = await CustomerAddress.findAll({ where: { user_id: userId } });
      const otherAddress = allAddresses.find(addr => addr.id !== id);
      if (otherAddress) {
        otherAddress.is_default = true;
        await otherAddress.save();
      }
    }

    await CustomerAddress.destroy({ where: { id } });

    return res.json({ message: "Address deleted successfully" });

  } catch (error) {
    console.error("Delete address error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};


// ===============================
// SET DEFAULT ADDRESS
// ===============================
exports.setDefaultAddress = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { addressId } = req.body;

    if (!addressId) {
      return res.status(400).json({ message: "addressId is required" });
    }

    const address = await CustomerAddress.findByPk(addressId);

    if (!address || address.user_id !== userId) {
      return res.status(404).json({ message: "Address not found" });
    }

    // Update all user addresses to not default
    const userAddresses = await CustomerAddress.findAll({ where: { user_id: userId } });
    await Promise.all(userAddresses.map(addr => {
      if (addr.is_default) {
        return CustomerAddress.update({ is_default: false }, { where: { id: addr.id } });
      }
      return Promise.resolve();
    }));

    await CustomerAddress.update({ is_default: true }, { where: { id: addressId } });

    return res.json({ message: "Default address updated successfully" });

  } catch (error) {
    console.error("Set default error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};