const Wallet = require("../models/wallet");
const WalletTransaction = require("../models/walletTransaction");
const MasterOrder = require("../models/masterOrder");
const Rider = require("../models/rider");
const WithdrawalRequest = require("../models/withdrawalRequest");

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function getDerivedWalletForRider(userId, wallet) {
  let walletDoc = wallet;
  if (!walletDoc) {
    walletDoc = await Wallet.findOne({ where: { user_id: userId } });
  }

  const availableBalance = toNumber(walletDoc?.available_balance);
  const totalEarned = toNumber(walletDoc?.total_earned);

  // Calculate COD collected but not settled
  const rider = await Rider.findOne({ where: { user_id: userId } });
  let codCollected = 0;
  let activeCodCount = 0;

  if (rider) {
    // Only load unsettled COD orders for the rider
    const unsettledCodOrders = await MasterOrder.findAll({
      where: {
        rider_id: rider.id,
        payment_method: "COD",
        is_settled: false,
      },
    });

    unsettledCodOrders.forEach((o) => {
      if (o.cod_collected) {
        codCollected += toNumber(o.total_amount);
      }
      if (
        !o.cod_collected &&
        (o.status === "ASSIGNED" || o.status === "OUT_FOR_DELIVERY")
      ) {
        activeCodCount++;
      }
    });
  }

  return {
    available_balance: availableBalance,
    total_earned: totalEarned,
    cod_collected: codCollected,
    active_cod_order_count: activeCodCount,
  };
}


// ===============================
// GET WALLET + TRANSACTION HISTORY
// ===============================
exports.getWalletHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let wallet = await Wallet.findOne({
      where: { user_id: userId },
    });

    if (!wallet) {
      wallet = await Wallet.create({
        user_id: userId,
        available_balance: 0,
        pending_balance: 0,
        total_earned: 0,
        total_withdrawn:0,
      });
    }

    // FirebaseModel doesn't support findAndCountAll, use findAll + in-memory pagination
    const allTransactions = await WalletTransaction.findAll({
      where: { user_id: userId },
    });

    // Sort by createdAt descending in memory
    allTransactions.sort((a, b) => {
      const dateA = a.createdAt instanceof Date ? a.createdAt :
        (a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate() : new Date(a.createdAt || 0));
      const dateB = b.createdAt instanceof Date ? b.createdAt :
        (b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate() : new Date(b.createdAt || 0));
      return dateB - dateA;
    });

    const count = allTransactions.length;
    const rows = allTransactions.slice(offset, offset + limit);

    let derived = null;
    if (req.user.role === "RIDER") {
      derived = await getDerivedWalletForRider(userId);
      if (derived) {
        wallet.available_balance = derived.available_balance;
        wallet.total_earned = derived.total_earned;
        await wallet.save();
      }
    }

    const availableBal = wallet.available_balance;

    let lockedBalance = 0;
    let withdrawableBalance = availableBal;

    // BUG-H1 FIX: "[Op.in]" is a string literal, not a Sequelize operator.
    // Fetch all and filter in-memory, which is reliable with the FirebaseModel ORM.
    const allWithdrawals = await WithdrawalRequest.findAll({
      where: { user_id: userId },
    });
    const pendingWithdrawals = allWithdrawals.filter(
      w => ["PENDING", "PROCESSING"].includes(w.status)
    );

    const pendingSettlement = pendingWithdrawals.reduce(
      (sum, w) => sum + toNumber(w.amount),
      0
    );

    const PlatformSettings = require("../models/platformSettings");
    const settingsList = await PlatformSettings.findAll({
      where: { key: "min_withdrawal_amount" }
    });
    const minWithdrawSetting = settingsList.length > 0 ? settingsList[settingsList.length - 1] : null;
    const minWithdrawAmount = minWithdrawSetting ? parseFloat(minWithdrawSetting.value) : 500;

    const response = {
      available_balance: availableBal,
      withdrawable_balance: withdrawableBalance,
      locked_balance: lockedBalance,
      pending_balance: toNumber(wallet.pending_balance),
      pending_settlement: pendingSettlement,
      cod_collected: derived?.cod_collected ?? 0,
      active_cod_order_count: derived?.active_cod_order_count ?? 0,
      total_earned: derived?.total_earned ?? toNumber(wallet.total_earned),
      total_withdrawn: toNumber(wallet.total_withdrawn),
      min_withdrawal_amount: minWithdrawAmount,
      total_transactions: count,
      current_page: page,
      total_pages: Math.ceil(count / limit),
      transactions: rows.map((tx) => ({
        ...(typeof tx.toJSON === "function" ? tx.toJSON() : tx),
        amount: toNumber(tx.amount),
      })),
    };

    return res.json(response);

  } catch (error) {
    console.error("Wallet history error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ===============================
// GET WALLET BALANCE ONLY
// ===============================
exports.getWalletBalance = async (req, res) => {
  try {
    let wallet = await Wallet.findOne({
      where: { user_id: req.user.id },
    });

    if (!wallet) {
      wallet = await Wallet.create({
        user_id: req.user.id,
        available_balance: 0,
        pending_balance: 0,
        total_earned: 0,
        total_withdrawn:0,
      });
    }

    let derived = null;
    if (req.user.role === "RIDER") {
      derived = await getDerivedWalletForRider(req.user.id);
      if (derived) {
        wallet.available_balance = derived.available_balance;
        wallet.total_earned = derived.total_earned;
        await wallet.save();
      }
    }

    const availableBal = wallet.available_balance;

    let lockedBalance = 0;
    let withdrawableBalance = availableBal;

    // BUG-H1 FIX: "[Op.in]" is a string literal, not a Sequelize operator.
    // Fetch all and filter in-memory, which is reliable with the FirebaseModel ORM.
    const allUserWithdrawals = await WithdrawalRequest.findAll({
      where: { user_id: req.user.id },
    });
    const pendingWithdrawals = allUserWithdrawals.filter(
      w => ["PENDING", "PROCESSING"].includes(w.status)
    );

    const pendingSettlement = pendingWithdrawals.reduce(
      (sum, w) => sum + toNumber(w.amount),
      0
    );

    const PlatformSettings = require("../models/platformSettings");
    const settingsList = await PlatformSettings.findAll({
      where: { key: "min_withdrawal_amount" }
    });
    const minWithdrawSetting = settingsList.length > 0 ? settingsList[settingsList.length - 1] : null;
    const minWithdrawAmount = minWithdrawSetting ? parseFloat(minWithdrawSetting.value) : 500;

    const response = {
      available_balance: availableBal,
      withdrawable_balance: withdrawableBalance,
      locked_balance: lockedBalance,
      pending_balance: toNumber(wallet.pending_balance),
      pending_settlement: pendingSettlement,
      cod_collected: derived?.cod_collected ?? 0,
      active_cod_order_count: derived?.active_cod_order_count ?? 0,
      total_earned: derived?.total_earned ?? toNumber(wallet.total_earned),
      total_withdrawn: toNumber(wallet.total_withdrawn),
      min_withdrawal_amount: minWithdrawAmount,
    };

    return res.json(response);

  } catch (error) {
    console.error("Get wallet balance error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
