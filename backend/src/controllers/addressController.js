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
      address_type,
      house_no,
      address_line1,
      area,
      address_line2,
      landmark,
      city,
      state,
      pincode,
      latitude,
      longitude,
      is_default,
      name,
      phone_number,
    } = req.body;

    const User = require("../models/user");
    const userDoc = await User.findOne({ where: { id: userId } });
    if (userDoc) {
      if (!name) name = userDoc.name || "Customer";
      if (!phone_number) phone_number = userDoc.phone || "";
    } else {
      if (!name) name = "Customer";
      if (!phone_number) phone_number = "";
    }

    const finalLine1 = (address_line1 || house_no || "").trim();
    const finalLine2 = (address_line2 || area || "").trim();
    const finalType = (address_type || label || "HOME").toUpperCase();
    const finalCity = (city || "Kolkata").trim();
    const finalState = (state || "West Bengal").trim();
    const finalPincode = (pincode || "700001").toString().trim();

    if (!finalLine1 || !finalLine2) {
      return res.status(400).json({ message: "Address line 1 (house no) and line 2 (area) are required" });
    }

    const lat = latitude !== undefined && latitude !== null ? parseFloat(latitude) : 0.0;
    const lng = longitude !== undefined && longitude !== null ? parseFloat(longitude) : 0.0;

    const count = await CustomerAddress.count({
      where: { user_id: userId },
    });

    const isDef = is_default === true || is_default === "true" || count === 0;

    if (isDef) {
      await CustomerAddress.update(
        { is_default: false },
        { where: { user_id: userId } }
      );
    }

    const address = await CustomerAddress.create({
      user_id: userId,
      address_line1: finalLine1,
      address_line2: finalLine2,
      landmark: landmark || "",
      city: finalCity,
      pincode: finalPincode,
      latitude: isNaN(lat) ? 0.0 : lat,
      longitude: isNaN(lng) ? 0.0 : lng,
      address_type: finalType,
      is_default: isDef,
    });

    const formatted = {
      ...address.toJSON(),
      house_no: address.address_line1,
      area: address.address_line2,
      label: address.address_type,
      name,
      phone_number,
      state: finalState,
    };

    return res.status(201).json({
      message: "Address saved successfully",
      address: formatted,
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

    const formatted = addresses.map(addr => {
      const data = addr.toJSON();
      return {
        ...data,
        house_no: data.address_line1,
        area: data.address_line2,
        label: data.address_type,
      };
    });

    return res.json(formatted);

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

    let {
      label,
      address_type,
      house_no,
      address_line1,
      area,
      address_line2,
      landmark,
      city,
      state,
      pincode,
      latitude,
      longitude,
      is_default,
    } = req.body;

    const finalLine1 = (address_line1 || house_no || address.address_line1 || "").trim();
    const finalLine2 = (address_line2 !== undefined ? address_line2 : (area !== undefined ? area : address.address_line2) || "").trim();
    const finalType = (address_type || label || address.address_type || "HOME").toUpperCase();
    const finalCity = (city || address.city || "Kolkata").trim();
    const finalPincode = (pincode !== undefined ? pincode : (address.pincode || "700001")).toString().trim();
    const finalLandmark = landmark !== undefined ? landmark : (address.landmark || "");

    const updateData = {
      address_line1: finalLine1,
      address_line2: finalLine2,
      landmark: finalLandmark,
      city: finalCity,
      pincode: finalPincode,
      address_type: finalType,
    };

    if (latitude !== undefined && latitude !== null) {
      const lat = parseFloat(latitude);
      if (!isNaN(lat)) updateData.latitude = lat;
    }

    if (longitude !== undefined && longitude !== null) {
      const lng = parseFloat(longitude);
      if (!isNaN(lng)) updateData.longitude = lng;
    }

    if (is_default !== undefined) {
      const isDef = is_default === true || is_default === "true";
      updateData.is_default = isDef;
      if (isDef) {
        await CustomerAddress.update(
          { is_default: false },
          { where: { user_id: userId } }
        );
      }
    }

    await address.update(updateData);

    const formatted = {
      ...address.toJSON(),
      house_no: address.address_line1,
      area: address.address_line2,
      label: address.address_type,
      state: state || "West Bengal",
    };

    return res.json({
      message: "Address updated successfully",
      address: formatted,
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