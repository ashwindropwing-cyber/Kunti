const { firestore } = require("../config/firebase");

class FirebaseModel {
  constructor(collectionName, schema = null) {
    this.collection = firestore.collection(collectionName);
    this.name = collectionName;
    this.schema = schema;
  }

  validateAndCoerce(data, isCreate = false) {
    if (!this.schema) return data;
    const result = { ...data };

    for (const [key, rules] of Object.entries(this.schema)) {
      // 1. Apply defaults on create
      if (isCreate && result[key] === undefined && rules.default !== undefined) {
        result[key] = typeof rules.default === 'function' ? rules.default() : rules.default;
      }

      // 2. Check required fields
      if (isCreate && rules.required && result[key] === undefined) {
        throw new Error(`[FirebaseModel] Validation Error: '${key}' is required in ${this.name}`);
      }

      // If it's an update and they are trying to null out a required field
      if (!isCreate && rules.required && result[key] === null) {
        throw new Error(`[FirebaseModel] Validation Error: '${key}' cannot be set to null in ${this.name}`);
      }

      // 3. Type Coercion (if value is provided)
      if (result[key] !== undefined && result[key] !== null) {
        if (rules.type === 'number') {
          const parsed = parseFloat(result[key]);
          if (!isNaN(parsed)) result[key] = parsed;
        } else if (rules.type === 'boolean') {
          if (typeof result[key] === 'string') {
            result[key] = result[key] === 'true' || result[key] === '1';
          } else {
            result[key] = Boolean(result[key]);
          }
        } else if (rules.type === 'string') {
          result[key] = String(result[key]);
        }
      }
    }

    // Firestore does not accept undefined values, strip them out
    for (const key of Object.keys(result)) {
      if (result[key] === undefined) {
        delete result[key];
      }
    }

    return result;
  }

  _wrapDoc(doc) {
    if (!doc) return null;
    const data = doc.data ? doc.data() : doc; // Handle both DocumentSnapshot and plain data
    const id = doc.id || data.id;
    const self = this;

    const wrapped = {
      id,
      ...data,
      // 🛠️ Compatibility with Sequelize-style code
      toJSON: function () {
        const { toJSON, save, destroy, update, ...plain } = this;
        return plain;
      },
      save: async function () {
        const { id, toJSON, save, destroy, update, ...updateData } = this;
        const validatedUpdate = self.validateAndCoerce(updateData, false);
        await self.collection.doc(id).update({ ...validatedUpdate, updatedAt: new Date() });
      },
      destroy: async function () {
        await self.collection.doc(id).delete();
      },
      update: async function (newData) {
        const validatedNewData = self.validateAndCoerce(newData, false);
        await self.collection.doc(id).update({ ...validatedNewData, updatedAt: new Date() });
        Object.assign(this, validatedNewData);
      }
    };
    return wrapped;
  }

  async findOne(query) {
    let q = this.collection;
    const { admin } = require("../config/firebase");
    if (query.where) {
      Object.keys(query.where).forEach((key) => {
        const val = query.where[key];
        const targetKey = key === "id" ? admin.firestore.FieldPath.documentId() : key;

        if (val && typeof val === "object" && !Array.isArray(val)) {
          Object.keys(val).forEach((op) => {
            if (op === "ne" || op === "[Op.ne]") q = q.where(targetKey, "!=", val[op]);
            else if (op === "gte" || op === "[Op.gte]") q = q.where(targetKey, ">=", val[op]);
            else if (op === "gt" || op === "[Op.gt]") q = q.where(targetKey, ">", val[op]);
            else if (op === "lte" || op === "[Op.lte]") q = q.where(targetKey, "<=", val[op]);
            else if (op === "lt" || op === "[Op.lt]") q = q.where(targetKey, "<", val[op]);
            else if (op === "in" || op === "[Op.in]") q = q.where(targetKey, "in", val[op]);
            else if (op === "notIn" || op === "[Op.notIn]") q = q.where(targetKey, "not-in", val[op]);
          });
        } else if (Array.isArray(val)) {
          q = q.where(targetKey, "in", val);
        } else {
          q = q.where(targetKey, "==", val);
        }
      });
    }

    let snapshot;
    try {
      snapshot = await q.limit(1).get();
    } catch (error) {
      if (error.code === 9 && error.message.includes("index")) {
        console.warn(`⚠️ [FirebaseModel] Missing index for findOne on ${this.name}. Falling back to in-memory filtering. Details: ${error.message}`);
        let docs = [];
        try {
          snapshot = await this.collection.get();
          docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        } catch (fallbackError) {
          throw fallbackError;
        }

        if (query?.where) {
          const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : v);
          docs = docs.filter((doc) => {
            return Object.entries(query.where).every(([key, val]) => {
              const docVal = key === "id" ? doc.id : toDate(doc[key]);

              if (val && typeof val === "object" && !Array.isArray(val)) {
                return Object.entries(val).every(([op, opVal]) => {
                  const compareVal = toDate(opVal);
                  if (op === "lt" || op === "[Op.lt]") return docVal < compareVal;
                  if (op === "gt" || op === "[Op.gt]") return docVal > compareVal;
                  if (op === "lte" || op === "[Op.lte]") return docVal <= compareVal;
                  if (op === "gte" || op === "[Op.gte]") return docVal >= compareVal;
                  if (op === "ne" || op === "[Op.ne]") return docVal != compareVal;
                  if (op === "in" || op === "[Op.in]") {
                    return Array.isArray(opVal) && opVal.includes(docVal);
                  }
                  if (op === "notIn" || op === "[Op.notIn]") {
                    return Array.isArray(opVal) && !opVal.includes(docVal);
                  }
                  if (op === "iLike" || op === "[Op.iLike]" || op === "like" || op === "[Op.like]") {
                    if (typeof docVal !== "string" || typeof opVal !== "string") return false;
                    const cleanCompare = opVal.replace(/^%|%$/g, "").toLowerCase();
                    return docVal.toLowerCase().includes(cleanCompare);
                  }
                  return true;
                });
              } else if (Array.isArray(val)) {
                return val.includes(docVal);
              }
              return docVal == toDate(val);
            });
          });
        }

        if (query?.order) {
          query.order.forEach(([field, direction]) => {
            docs.sort((a, b) => {
              const valA = field === "id" ? a.id : a[field];
              const valB = field === "id" ? b.id : b[field];
              if (direction.toUpperCase() === "DESC") return valA < valB ? 1 : -1;
              return valA > valB ? 1 : -1;
            });
          });
        }

        if (docs.length === 0) return null;
        return this._wrapDoc(docs[0]);
      } else {
        throw error;
      }
    }

    if (snapshot.empty) return null;
    return this._wrapDoc(snapshot.docs[0]);
  }

  async findAll(query = {}) {
    const { admin } = require("../config/firebase");

    // Helper: Build a Firestore query from filters
    const _buildFilteredQuery = (baseQ, whereClause) => {
      let q = baseQ;
      if (!whereClause) return q;
      Object.keys(whereClause).forEach((key) => {
        const val = whereClause[key];
        const targetKey = key === "id" ? admin.firestore.FieldPath.documentId() : key;
        if (val && typeof val === "object" && !Array.isArray(val)) {
          Object.keys(val).forEach((op) => {
            if (op === "ne" || op === "[Op.ne]") q = q.where(targetKey, "!=", val[op]);
            else if (op === "gte" || op === "[Op.gte]") q = q.where(targetKey, ">=", val[op]);
            else if (op === "gt" || op === "[Op.gt]") q = q.where(targetKey, ">", val[op]);
            else if (op === "lte" || op === "[Op.lte]") q = q.where(targetKey, "<=", val[op]);
            else if (op === "lt" || op === "[Op.lt]") q = q.where(targetKey, "<", val[op]);
            else if (op === "in" || op === "[Op.in]") q = q.where(targetKey, "in", val[op]);
            else if (op === "notIn" || op === "[Op.notIn]") q = q.where(targetKey, "not-in", val[op]);
          });
        } else if (Array.isArray(val)) {
          q = q.where(targetKey, "in", val);
        } else {
          q = q.where(targetKey, "==", val);
        }
      });
      return q;
    };

    // Helper: In-memory filter, sort, offset, limit
    const _inMemoryProcess = (docs, qr) => {
      let result = docs;
      if (qr.where) {
        const toDate = (v) => (v && typeof v.toDate === 'function' ? v.toDate() : v);
        result = result.filter((doc) => {
          return Object.entries(qr.where).every(([key, val]) => {
            const docVal = key === "id" ? doc.id : toDate(doc[key]);
            if (val && typeof val === "object" && !Array.isArray(val)) {
              return Object.entries(val).every(([op, opVal]) => {
                const compareVal = toDate(opVal);
                if (op === "lt" || op === "[Op.lt]") return docVal < compareVal;
                if (op === "gt" || op === "[Op.gt]") return docVal > compareVal;
                if (op === "lte" || op === "[Op.lte]") return docVal <= compareVal;
                if (op === "gte" || op === "[Op.gte]") return docVal >= compareVal;
                if (op === "ne" || op === "[Op.ne]") return docVal != compareVal;
                if (op === "in" || op === "[Op.in]") return Array.isArray(opVal) && opVal.includes(docVal);
                if (op === "notIn" || op === "[Op.notIn]") return Array.isArray(opVal) && !opVal.includes(docVal);
                if (op === "iLike" || op === "[Op.iLike]" || op === "like" || op === "[Op.like]") {
                  if (typeof docVal !== "string" || typeof opVal !== "string") return false;
                  const cleanCompare = opVal.replace(/^%|%$/g, "").toLowerCase();
                  return docVal.toLowerCase().includes(cleanCompare);
                }
                return true;
              });
            } else if (Array.isArray(val)) {
              return val.includes(docVal);
            }
            return docVal == toDate(val);
          });
        });
      }
      if (qr.order) {
        qr.order.forEach(([field, direction]) => {
          result.sort((a, b) => {
            let valA = a[field];
            let valB = b[field];
            if (direction.toUpperCase() === 'DESC') return valA < valB ? 1 : -1;
            return valA > valB ? 1 : -1;
          });
        });
      }
      if (qr.offset) result = result.slice(qr.offset);
      if (qr.limit) result = result.slice(0, qr.limit);
      return result;
    };

    // Check if we need to force in-memory processing (e.g. for iLike)
    let forceInMemory = false;
    if (query.where) {
      for (const val of Object.values(query.where)) {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          for (const op of Object.keys(val)) {
            if (op === "iLike" || op === "[Op.iLike]" || op === "like" || op === "[Op.like]") {
              forceInMemory = true;
              break;
            }
          }
        }
        if (forceInMemory) break;
      }
    }

    if (forceInMemory) {
      let snapshot = await this.collection.get();
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs = _inMemoryProcess(docs, query);
      return docs.map(data => this._wrapDoc(data));
    }

    // Build full query
    let q = _buildFilteredQuery(this.collection, query.where);

    if (query.order) {
      query.order.forEach((orderArr) => {
        const [field, direction] = orderArr;
        q = q.orderBy(field, direction.toLowerCase());
      });
    }
    if (query.limit) q = q.limit(query.limit);
    if (query.offset) q = q.offset(query.offset);

    let snapshot;
    try {
      snapshot = await q.get();
    } catch (error) {
      if (error.code === 9 && error.message.includes("index")) {
        console.warn(`⚠️ [FirebaseModel] Missing index for findAll on ${this.name}. Falling back to in-memory filtering. Details: ${error.message}`);
        let docs = [];

        // Attempt 1: Use just the first simple equality filter
        const equalityEntries = query.where
          ? Object.entries(query.where).filter(
              ([, val]) => !(val && typeof val === "object" && !Array.isArray(val))
            )
          : [];

        if (equalityEntries.length > 0) {
          try {
            const [firstKey, firstVal] = equalityEntries[0];
            const targetKey = firstKey === "id" ? admin.firestore.FieldPath.documentId() : firstKey;
            const partialQ = this.collection.where(targetKey, "==", firstVal);
            snapshot = await partialQ.get();
            docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          } catch (_) {
            // Attempt 2: Full collection
            snapshot = await this.collection.get();
            docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          }
        } else {
          // No simple equality filters, must fetch entire collection
          snapshot = await this.collection.get();
          docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        docs = _inMemoryProcess(docs, query);
        return docs.map(data => this._wrapDoc(data));
      }
      throw error;
    }

    return snapshot.docs.map((doc) => this._wrapDoc(doc));
  }

  async findByPk(id) {
    if (!id) return null;
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return null;
    return this._wrapDoc(doc);
  }

  async create(data) {
    const validatedData = this.validateAndCoerce(data, true);
    const docRef = await this.collection.add({
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const doc = await docRef.get();
    return this._wrapDoc(doc);
  }

  async count(query = {}) {
    // Check if we need to force in-memory processing
    let forceInMemory = false;
    if (query.where) {
      for (const val of Object.values(query.where)) {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          for (const op of Object.keys(val)) {
            if (op === "iLike" || op === "[Op.iLike]" || op === "like" || op === "[Op.like]") {
              forceInMemory = true;
              break;
            }
          }
        }
        if (forceInMemory) break;
      }
    }

    if (forceInMemory) {
      let snapshot = await this.collection.get();
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : v);
      docs = docs.filter((doc) => {
        return Object.entries(query.where).every(([key, val]) => {
          const docVal = key === "id" ? doc.id : toDate(doc[key]);
          if (val && typeof val === "object" && !Array.isArray(val)) {
            return Object.entries(val).every(([op, opVal]) => {
              const compareVal = toDate(opVal);
              if (op === "lt" || op === "[Op.lt]") return docVal < compareVal;
              if (op === "gt" || op === "[Op.gt]") return docVal > compareVal;
              if (op === "lte" || op === "[Op.lte]") return docVal <= compareVal;
              if (op === "gte" || op === "[Op.gte]") return docVal >= compareVal;
              if (op === "ne" || op === "[Op.ne]") return docVal != compareVal;
              if (op === "in" || op === "[Op.in]") return Array.isArray(opVal) && opVal.includes(docVal);
              if (op === "notIn" || op === "[Op.notIn]") return Array.isArray(opVal) && !opVal.includes(docVal);
              if (op === "iLike" || op === "[Op.iLike]" || op === "like" || op === "[Op.like]") {
                if (typeof docVal !== "string" || typeof compareVal !== "string") return false;
                const cleanCompare = compareVal.replace(/^%|%$/g, "").toLowerCase();
                return docVal.toLowerCase().includes(cleanCompare);
              }
              return true;
            });
          } else if (Array.isArray(val)) {
            return val.includes(docVal);
          }
          return docVal == toDate(val);
        });
      });
      return docs.length;
    }

    let q = this.collection;
    const { admin } = require("../config/firebase");
    if (query.where) {
      Object.keys(query.where).forEach((key) => {
        const val = query.where[key];
        const targetKey = key === "id" ? admin.firestore.FieldPath.documentId() : key;

        if (val && typeof val === "object" && !Array.isArray(val)) {
          Object.keys(val).forEach((op) => {
            if (op === "ne" || op === "[Op.ne]") q = q.where(targetKey, "!=", val[op]);
            else if (op === "gte" || op === "[Op.gte]") q = q.where(targetKey, ">=", val[op]);
            else if (op === "gt" || op === "[Op.gt]") q = q.where(targetKey, ">", val[op]);
            else if (op === "lte" || op === "[Op.lte]") q = q.where(targetKey, "<=", val[op]);
            else if (op === "lt" || op === "[Op.lt]") q = q.where(targetKey, "<", val[op]);
            else if (op === "in" || op === "[Op.in]") q = q.where(targetKey, "in", val[op]);
            else if (op === "notIn" || op === "[Op.notIn]") q = q.where(targetKey, "not-in", val[op]);
          });
        } else if (Array.isArray(val)) {
          q = q.where(targetKey, "in", val);
        } else {
          q = q.where(targetKey, "==", val);
        }
      });
    }
    const snapshot = await q.count().get();
    return snapshot.data().count;
  }

  async findAndCountAll(query = {}) {
    const rows = await this.findAll(query);
    const count = await this.count({ where: query.where });
    return { count, rows };
  }

  async update(data, query) {
    const validatedData = this.validateAndCoerce(data, false);
    const docs = await this.findAll(query);
    const { firestore } = require("../config/firebase");
    const batch = firestore.batch();
    docs.forEach((doc) => {
      const ref = this.collection.doc(doc.id);
      batch.update(ref, { ...validatedData, updatedAt: new Date() });
    });

    await batch.commit();
    return docs.length;
  }

  async destroy(query) {
    const docs = await this.findAll(query);
    const { firestore } = require("../config/firebase");
    const batch = firestore.batch();
    docs.forEach((doc) => {
      const ref = this.collection.doc(doc.id);
      batch.delete(ref);
    });
    await batch.commit();
    return docs.length;
  }

  async findOrCreate(query = {}) {
    let doc = await this.findOne({ where: query.where });
    if (doc) return [doc, false];
    const newData = { ...query.where, ...(query.defaults || {}) };
    doc = await this.create(newData);
    return [doc, true];
  }

}

module.exports = FirebaseModel;
