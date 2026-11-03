// File: cloud/main.js · CommonJS · Parse Server 7.x (Back4app runs Cloud Code on Node 19: no Node 20+ only features)
//
// NO hooks, NO client-facing functions: the subject under test is the two AUTO-GENERATED APIs (REST and
// GraphQL), so nothing here may sit on the data path. The four functions below are administrative only —
// they exist because the live phase keeps the master key in the dashboard — and every one is gated by BOTH
// the SETUP_ENABLED flag and the server-checked SHA-256 setup token (cloud/config.js; house pattern from
// chat-lab, amendment B5 there). The default deployment ships with both unset: every call refuses.
//
// Error convention (same as the sibling repos): functions throw Parse.Error with a numeric Parse code and a
// JSON string message {"code":"SETUP_DISABLED","message":"…", …extra}. scripts/lib/rest.mjs parseCloudError()
// unwraps it.
'use strict';

const crypto = require('crypto');
const config = require('./config.js');
const guards = require('./guards.js');

const MASTER = { useMasterKey: true };
const PE = Parse.Error;

// ---------------------------------------------------------------------------------------------------------
// 1. Helpers
// ---------------------------------------------------------------------------------------------------------

function fail(code, message, extra, parseCode) {
  const payload = Object.assign({ code: code, message: message }, extra || {});
  throw new PE(parseCode || PE.VALIDATION_ERROR, JSON.stringify(payload));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function requireSetupEnabled() {
  if (!config.SETUP_ENABLED) {
    fail('SETUP_DISABLED', 'Administrative helpers are disabled (SETUP_ENABLED is off).', null, PE.OPERATION_FORBIDDEN);
  }
}

// The administrative credential, checked server-side on EVERY setup-guarded call, in addition to
// SETUP_ENABLED. The caller sends the raw token; only its SHA-256 is configured server-side. Constant-time
// comparison of the two digests; an unset hash refuses everything (the default deployment).
function requireSetupToken(request) {
  const supplied = request.params && request.params.setupToken;
  if (!config.SETUP_TOKEN_SHA256 || !/^[0-9a-f]{64}$/.test(config.SETUP_TOKEN_SHA256)) {
    fail('SETUP_TOKEN_UNSET', 'No administrative setup token is configured on this backend (SETUP_TOKEN_SHA256).', null, PE.OPERATION_FORBIDDEN);
  }
  if (typeof supplied !== 'string' || supplied.length < 16) {
    fail('SETUP_TOKEN_INVALID', 'This call requires the administrative setup token (parameter setupToken).', null, PE.OPERATION_FORBIDDEN);
  }
  const a = Buffer.from(sha256(supplied), 'hex');
  const b = Buffer.from(config.SETUP_TOKEN_SHA256, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    fail('SETUP_TOKEN_INVALID', 'This call requires the administrative setup token (parameter setupToken).', null, PE.OPERATION_FORBIDDEN);
  }
}

function userPointer(userId) {
  const u = new Parse.Object('_User');
  u.id = userId;
  return u;
}

async function fetchSchema(className) {
  try {
    const s = await new Parse.Schema(className).get();
    return s;
  } catch (e) {
    return null; // 103: class does not exist yet
  }
}

function addFieldsTo(schema, fields) {
  Object.keys(fields).forEach(function (name) {
    const spec = fields[name];
    if (spec.type === 'Pointer') schema.addPointer(name, spec.targetClass);
    else schema.addField(name, spec.type);
  });
}

function requireInt(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail('INVALID_ARGS', field + ' must be an integer in ' + min + '..' + max, { field: field });
  }
  return value;
}

function requireId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{8,32}$/.test(value)) {
    fail('INVALID_ARGS', field + ' must be an objectId', { field: field });
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------
// 2. Guard registration: the GUARDS table and the `define` wrapper
// ---------------------------------------------------------------------------------------------------------

const GUARDS = {
  setupSchema: 'setup',  // classes, CLPs, indexes — the schema in cloud/config.js
  seedData: 'setup',     // one batch of deterministic rows per call (caller loops; cloud/config.js generators)
  testInspect: 'setup',  // live runs: master-key state read-backs without the master key leaving the dashboard
  testCleanup: 'setup',  // delete ONLY what this lab seeded (seedTag) or run-prefixed test users (< 2 h old)
};

const registry = guards.createRegistry(GUARDS);

function define(name, spec) {
  registry.define(name, function (guard) {
    Parse.Cloud.define(name, async function (request) {
      // guard === 'setup' is the only kind in this lab (see cloud/guards.js).
      requireSetupEnabled();
      requireSetupToken(request);
      return spec.handler(request);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------
// 3. setupSchema — idempotent schema apply (same definition scripts/setup.mjs applies with the master key)
// ---------------------------------------------------------------------------------------------------------

// setupSchema({allowRerun?, setupToken}) → {classes:[…]}. Creates the classes with fields, CLPs and indexes,
// or brings existing ones up to date (fields and indexes added, CLPs re-applied, nothing removed). Idempotent.
// Tripwire: refuses once Product holds rows unless {allowRerun:true} — a stray call on an app with data should
// be noisy, not silent. It is not a security boundary: the setup gate is.
define('setupSchema', {
  handler: async function (request) {
    const p = request.params || {};
    const productCount = (await fetchSchema('Product')) ? await new Parse.Query('Product').count(MASTER) : 0;
    if (productCount >= 1 && p.allowRerun !== true) {
      fail('SETUP_LOCKED', 'Product already holds ' + productCount + ' rows; pass {allowRerun:true} to re-apply the schema.', { productCount: productCount });
    }
    const classes = [];
    for (const def of config.SCHEMA) {
      const have = await fetchSchema(def.className);
      const schema = new Parse.Schema(def.className);
      schema.setCLP(def.classLevelPermissions);
      if (!have) {
        addFieldsTo(schema, def.fields);
        Object.keys(def.indexes || {}).forEach(function (name) { schema.addIndex(name, def.indexes[name]); });
        await schema.save();
        classes.push({ className: def.className, action: 'created', newFields: Object.keys(def.fields), newIndexes: Object.keys(def.indexes || {}) });
        continue;
      }
      const newFields = {};
      Object.keys(def.fields).forEach(function (name) { if (!have.fields || !have.fields[name]) newFields[name] = def.fields[name]; });
      const haveIdx = have.indexes || {};
      const newIndexes = Object.keys(def.indexes || {}).filter(function (name) { return !haveIdx[name]; });
      addFieldsTo(schema, newFields);
      newIndexes.forEach(function (name) { schema.addIndex(name, def.indexes[name]); });
      await schema.update();
      classes.push({ className: def.className, action: 'updated', newFields: Object.keys(newFields), newIndexes: newIndexes });
    }
    return { classes: classes, productCount: productCount };
  },
});

// ---------------------------------------------------------------------------------------------------------
// 4. seedData — one deterministic batch per call (the generators live in cloud/config.js, shared with the
//    local scripts/seed.mjs, so local and live datasets are byte-identical in field values)
// ---------------------------------------------------------------------------------------------------------

// seedData({kind, from, count, ownerId?, otherOwnerId?, productIds?, setupToken}) → {created, ids?}
//   kind 'products': rows from..from+count-1 of productData(i). Returns their objectIds IN ORDER (the caller
//                    accumulates them; orders/items need them).
//   kind 'orders':   orderData(i); owner = ownerId except the LAST order (index ORDERS-1), owned by
//                    otherOwnerId with an ACL only that user can read — the P3/P4 foreign row.
//   kind 'items':    items for orders[from..from+count-1]; needs orderIds (same window) and productIds (all).
//   kind 'audit':    one master-only AuditLog row (P6 target).
// count ≤ SEED_BATCH_MAX per call: live Cloud calls must stay under the platform timeout; the caller loops.
define('seedData', {
  handler: async function (request) {
    const p = request.params || {};
    const kind = p.kind;
    if (kind === 'audit') {
      const row = new Parse.Object('AuditLog');
      row.set({ action: 'seed', detail: 'master-key-only parity target (P6)', seedTag: config.SEED_TAG });
      const acl = new Parse.ACL(); // nobody: master only
      row.setACL(acl);
      await row.save(null, MASTER);
      return { created: 1, ids: [row.id] };
    }
    const from = requireInt(p.from, 'from', 0, 1000000);
    const count = requireInt(p.count, 'count', 1, config.SEED_BATCH_MAX);

    if (kind === 'products') {
      const rows = [];
      for (let i = from; i < from + count; i++) {
        const o = new Parse.Object('Product');
        o.set(config.productData(i));
        // No row ACL: the CLP already requires a session; rows are world-readable to signed-in users.
        rows.push(o);
      }
      await Parse.Object.saveAll(rows, MASTER);
      return { created: rows.length, ids: rows.map(function (r) { return r.id; }) };
    }

    if (kind === 'orders') {
      const ownerId = requireId(p.ownerId, 'ownerId');
      const otherOwnerId = requireId(p.otherOwnerId, 'otherOwnerId');
      const total = requireInt(p.total, 'total', 1, 1000000); // which index is "the last order" (the foreign row)
      const rows = [];
      for (let i = from; i < from + count; i++) {
        const o = new Parse.Object('Order');
        const data = config.orderData(i);
        data.placedAt = new Date(data.placedAt.iso);
        o.set(data);
        const foreign = i === total - 1;
        const owner = foreign ? otherOwnerId : ownerId;
        o.set('owner', userPointer(owner));
        const acl = new Parse.ACL();
        acl.setReadAccess(owner, true);   // owner-only read: P3 expects other users to see NOTHING
        acl.setWriteAccess(owner, true);  // owner-authorized OBJECT update: the S5 mutation path (amendment S2)
        o.setACL(acl);
        rows.push(o);
      }
      await Parse.Object.saveAll(rows, MASTER);
      return { created: rows.length, ids: rows.map(function (r) { return r.id; }) };
    }

    if (kind === 'items') {
      const orderIds = p.orderIds;
      const productIds = p.productIds;
      if (!Array.isArray(orderIds) || orderIds.length !== count) fail('INVALID_ARGS', 'orderIds must hold exactly `count` ids', { field: 'orderIds' });
      if (!Array.isArray(productIds) || productIds.length < 1) fail('INVALID_ARGS', 'productIds must be a non-empty array', { field: 'productIds' });
      const rows = [];
      for (let k = 0; k < count; k++) {
        const i = from + k;
        for (let j = 0; j < config.ITEMS_PER_ORDER; j++) {
          const o = new Parse.Object('OrderItem');
          const data = config.itemData(i, j, productIds.length);
          const orderPtr = new Parse.Object('Order'); orderPtr.id = requireId(orderIds[k], 'orderIds[' + k + ']');
          const productPtr = new Parse.Object('Product'); productPtr.id = requireId(productIds[data.productIndex], 'productIds[…]');
          o.set({ qty: data.qty, unitCents: data.unitCents, seedTag: data.seedTag, order: orderPtr, product: productPtr });
          const acl = new Parse.ACL();
          acl.setPublicReadAccess(true); // CLP still requires a session; readable rows make P4 a real traversal test
          o.setACL(acl);
          rows.push(o);
        }
      }
      await Parse.Object.saveAll(rows, MASTER);
      return { created: rows.length };
    }

    fail('INVALID_ARGS', "kind must be 'products' | 'orders' | 'items' | 'audit'", { field: 'kind' });
  },
});

// ---------------------------------------------------------------------------------------------------------
// 5. testInspect — master-rights read of one whitelisted class, equality-where only (live state read-backs)
// ---------------------------------------------------------------------------------------------------------

const INSPECT_CLASSES = config.SCHEMA.map(function (d) { return d.className; }).concat(['_User']);

function decodeParam(value) {
  if (value instanceof Parse.Object || value instanceof Date) return value;
  return Parse._decode(null, value);
}

function queryFromWhere(className, where) {
  const q = new Parse.Query(className);
  Object.keys(where).forEach(function (key) {
    const value = decodeParam(where[key]);
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Parse.Object) && !(value instanceof Date)) {
      fail('INVALID_ARGS', 'where.' + key + ' must be a plain value or a REST-encoded pointer/date (no operators)', { field: 'where.' + key });
    }
    q.equalTo(key, value);
  });
  return q;
}

// testInspect({className, where?, limit?, count?, setupToken}) → {results:[toJSON…]} or {count}.
define('testInspect', {
  handler: async function (request) {
    const p = request.params || {};
    if (INSPECT_CLASSES.indexOf(p.className) === -1) {
      fail('INVALID_ARGS', 'className must be one of ' + INSPECT_CLASSES.join(', '), { field: 'className' });
    }
    const where = p.where === undefined ? {} : p.where;
    if (!where || typeof where !== 'object' || Array.isArray(where)) fail('INVALID_ARGS', 'where must be an object', { field: 'where' });
    const q = queryFromWhere(p.className, where);
    if (p.count === true) return { className: p.className, count: await q.count(MASTER) };
    const limit = p.limit === undefined ? 100 : p.limit;
    requireInt(limit, 'limit', 1, 1000);
    q.limit(limit);
    q.ascending('createdAt');
    const rows = await q.find(MASTER);
    return { className: p.className, results: rows.map(function (r) { return r.toJSON(); }) };
  },
});

// ---------------------------------------------------------------------------------------------------------
// 6. testCleanup — deletes ONLY what this lab created: seedTag-marked rows and run-prefixed test users
// ---------------------------------------------------------------------------------------------------------

async function deleteByQuery(makeQuery) {
  let deleted = 0;
  for (;;) {
    const q = makeQuery();
    q.limit(config.DELETE_PAGE_SIZE);
    const rows = await q.find(MASTER);
    if (!rows.length) return deleted;
    await Parse.Object.destroyAll(rows, MASTER);
    deleted += rows.length;
    if (rows.length < config.DELETE_PAGE_SIZE) return deleted;
  }
}

// testCleanup({seedTag?, runPrefix?, setupToken}) → {products, orders, items, audit, users}
//   seedTag:   deletes the seeded dataset rows carrying exactly that tag (items first, then orders/products).
//   runPrefix: deletes _User rows whose username starts with the per-execution zz… prefix AND are < 2 h old
//              (crashed-run safety: a prefix cannot sweep anything older or unprefixed).
define('testCleanup', {
  handler: async function (request) {
    const p = request.params || {};
    const out = { products: 0, orders: 0, items: 0, audit: 0, users: 0 };
    if (p.seedTag !== undefined) {
      if (typeof p.seedTag !== 'string' || p.seedTag.length < 4) fail('INVALID_ARGS', 'seedTag must be a string of 4+ characters', { field: 'seedTag' });
      out.items = await deleteByQuery(function () { return new Parse.Query('OrderItem').equalTo('seedTag', p.seedTag); });
      out.orders = await deleteByQuery(function () { return new Parse.Query('Order').equalTo('seedTag', p.seedTag); });
      out.products = await deleteByQuery(function () { return new Parse.Query('Product').equalTo('seedTag', p.seedTag); });
      out.audit = await deleteByQuery(function () { return new Parse.Query('AuditLog').equalTo('seedTag', p.seedTag); });
    }
    if (p.runPrefix !== undefined) {
      if (typeof p.runPrefix !== 'string' || !/^zz[a-z0-9]{6,}$/.test(p.runPrefix)) {
        fail('INVALID_ARGS', 'runPrefix must look like zz<base36 timestamp><hex> (see scripts/lib/stats.mjs runPrefix)', { field: 'runPrefix' });
      }
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      out.users = await deleteByQuery(function () {
        return new Parse.Query('_User').startsWith('username', p.runPrefix).greaterThan('createdAt', twoHoursAgo);
      });
    }
    return out;
  },
});

registry.assertAllRegistered();
