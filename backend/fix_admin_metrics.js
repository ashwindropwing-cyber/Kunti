const fs = require('fs');
let content = fs.readFileSync('src/controllers/adminController.js', 'utf8');

// Remove ContactChangeRequest require
content = content.replace(/const ContactChangeRequest = require\([^)]+\);\n/g, '');

// In getDashboardMetrics, remove Seller and SellerRadiusChangeRequest
// We'll just replace the whole getDashboardMetrics to be safe
content = content.replace(/exports\.getDashboardMetrics[\s\S]*?(?=\n\nexports\.createRiderByAdmin)/, `exports.getDashboardMetrics = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    totalRiders,
    totalOrders,
    totalProducts,
    pendingRiders,
    pendingWithdrawals,
  ] = await Promise.all([
    User.count(),
    Rider.count(),
    MasterOrder.count(),
    Product.count(),
    Rider.count({ where: { is_approved: false } }),
    WithdrawalRequest.count({ where: { status: "PENDING" } }),
  ]);

  const totalPendingApprovals =
    pendingRiders +
    pendingWithdrawals;

  return ApiResponse.success(res, {
    overview: {
      users: totalUsers,
      riders: totalRiders,
      orders: totalOrders,
      products: totalProducts,
    },
    pending_approvals: {
      total: totalPendingApprovals,
      riders: pendingRiders,
      withdrawals: pendingWithdrawals,
    },
  });
});`);

// In getAllReviews, remove seller logic
content = content.replace(/const sellerIds = reviews\.map\(r => r\.seller_id\)\.filter\(Boolean\);[\s\S]*?const riderMap = riders\.reduce/g, `const riderMap = riders.reduce`);
content = content.replace(/chunkedFindAll\(Seller, "id", sellerIds\),/g, '');
content = content.replace(/const sellerMap = sellers\.reduce\(\(m, s\) => \{ m\[s\.id\] = s; return m; \}, \{\}\);\n/g, '');
content = content.replace(/const sellerUserIds = sellers\.map\(s => s\.user_id\)\.filter\(Boolean\);\n/g, '');
content = content.replace(/\.\.\.sellerUserIds, /g, '');
content = content.replace(/let seller = null;[\s\S]*?Seller: seller,/g, 'Seller: null,');

fs.writeFileSync('src/controllers/adminController.js', content);
console.log("adminController fixed");
