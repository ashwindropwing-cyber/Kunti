/**
 * Bulk-fetches documents using Firestore's "in" operator (which is limited to 30 items per query)
 * by chunking the query array and executing them in parallel.
 * 
 * @param {object} Model - The FirebaseModel instance/class (e.g., User, Product)
 * @param {string} key - The field name to filter by (e.g., 'id', 'user_id')
 * @param {Array} values - The list of values to search for
 * @param {object} extraWhere - Extra where conditions to merge
 * @returns {Promise<Array>} The list of found documents
 */
async function chunkedFindAll(Model, key, values, extraWhere = {}) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  if (uniqueValues.length === 0) return [];
  
  const CHUNK_SIZE = 30;
  const promises = [];
  
  for (let i = 0; i < uniqueValues.length; i += CHUNK_SIZE) {
    const chunk = uniqueValues.slice(i, i + CHUNK_SIZE);
    promises.push(
      Model.findAll({
        where: {
          ...extraWhere,
          [key]: { in: chunk }
        }
      })
    );
  }
  
  const results = await Promise.all(promises);
  return results.flat();
}

module.exports = {
  chunkedFindAll
};
