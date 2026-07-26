#!/bin/bash
# 1. Add getAdminAllOrders controller
sed -i '/exports.getSellerOrderDetails = async (req, res) => {/i \
exports.getAdminAllOrders = async (req, res) => { \
  try { \
    const { page = 1, limit = 100, status } = req.query; \
    const offset = (parseInt(page) - 1) * parseInt(limit); \
    let whereCondition = {}; \
    if (status && status !== "ALL") { \
      whereCondition.status = status; \
    } \
    const { count, rows } = await MasterOrder.findAndCountAll({ \
      where: whereCondition, \
      include: [ \
        { model: Seller, attributes: ["id", "shop_name"] }, \
        { \
          model: OrderItem, \
          include: [{ model: Product, attributes: ["id", "name", "image_url", "selling_price"] }] \
        }, \
        { \
          model: Rider, \
          attributes: ["id"], \
          include: [{ model: User, attributes: ["name", "phone"] }] \
        } \
      ], \
      order: [["createdAt", "DESC"]], \
      limit: parseInt(limit), \
      offset \
    }); \
    return res.json({ \
      total_orders: count, \
      total_pages: Math.ceil(count / parseInt(limit)), \
      orders: rows \
    }); \
  } catch (error) { \
    console.error(error); \
    return res.status(500).json({ message: "Server error" }); \
  } \
}; \
\
' src/controllers/orderController.js

# 2. Add /admin/all to orderRoutes
sed -i '/\/\/ Assign rider/i \
router.get("/admin/all", verifyToken, allowRoles("ADMIN"), orderController.getAdminAllOrders);\n' src/routes/orderRoutes.js

# 3. Add getAdminAllProducts controller
sed -i '/exports.getNearbyProducts = async (req, res) => {/i \
exports.getAdminAllProducts = async (req, res) => { \
  try { \
    const { page = 1, limit = 100, search } = req.query; \
    const offset = (parseInt(page) - 1) * parseInt(limit); \
    let whereCondition = {}; \
    if (search) { \
      whereCondition.name = { [require("sequelize").Op.iLike]: `%${search}%` }; \
    } \
    const { count, rows } = await Product.findAndCountAll({ \
      where: whereCondition, \
      include: [ \
        { model: Seller, attributes: ["id", "shop_name"] }, \
        { model: Category, attributes: ["id", "name"] } \
      ], \
      order: [["createdAt", "DESC"]], \
      limit: parseInt(limit), \
      offset \
    }); \
    const formatted = rows.map((p) => { \
      const discount = p.mrp > p.selling_price ? Math.round(((p.mrp - p.selling_price) / p.mrp) * 100) : 0; \
      return { \
        product_id: p.id, \
        name: p.name, \
        category_name: p.Category ? p.Category.name : "", \
        mrp: p.mrp, \
        selling_price: p.selling_price, \
        discount_percent: discount, \
        quantity: p.quantity, \
        image_url: p.image_url, \
        seller: { id: p.seller_id, shop_name: p.Seller ? p.Seller.shop_name : "" } \
      }; \
    }); \
    return res.json({ total: count, products: formatted }); \
  } catch (err) { \
    console.error(err); \
    return res.status(500).json({ message: "Server error" }); \
  } \
}; \
\
' src/controllers/productController.js

# 4. Add /admin/all to productRoutes
sed -i '/\/\/ CUSTOMER → Nearby products/i \
router.get("/admin/all", verifyToken, allowRoles("ADMIN"), productController.getAdminAllProducts);\n' src/routes/productRoutes.js

