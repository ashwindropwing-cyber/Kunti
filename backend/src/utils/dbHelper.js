const { Op } = require("sequelize");

/**
 * Bulk-fetches records using Sequelize's `Op.in` operator.
 */
async function chunkedFindAll(Model, key, values, extraWhere = {}) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  if (uniqueValues.length === 0) return [];
  
  return await Model.findAll({
    where: {
      ...extraWhere,
      [key]: { [Op.in]: uniqueValues }
    }
  });
}

module.exports = {
  chunkedFindAll
};
