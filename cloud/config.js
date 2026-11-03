// File: cloud/config.js · CommonJS · Parse Server 7.x (Back4app runs Cloud Code on Node 19 — no Node 20+ only
// features here). Tunables, the schema definition, the deterministic seed-data generators and the switches,
// shared by cloud/main.js, the scripts and the tests. Upload this file together with main.js and guards.js.
//
// This lab has NO client-facing Cloud functions and NO hooks on the data classes: the subject under test is
// the two AUTO-GENERATED APIs (REST and GraphQL) themselves, so any server-side code on the data path would
// change what is being measured. The only Cloud functions are the setup-gated administrative helpers in
// main.js (schema, seeding, state read-back, cleanup), needed because the live phase keeps the master key in
// the dashboard.
'use strict';

// ---------------------------------------------------------------------------------------------------------
// Switches (house pattern: the DEFAULT DEPLOYMENT disables the administrative helpers — both values ship
// unset, so a fresh upload answers SETUP_DISABLED until the operator deliberately turns them on)
// ---------------------------------------------------------------------------------------------------------

// Administrative helpers (setupSchema, seedData, testInspect, testCleanup in cloud/main.js). They run with
// the master key on behalf of a caller that holds (a) this flag turned on AND (b) the raw setup token whose
// SHA-256 hex is configured below — checked server-side on every call. Turn on via the Cloud Code environment
// (SETUP_ENABLED=1), or edit the fallback after the `||` before uploading; turn OFF the same way when the
// live run is over, re-upload, Deploy, and verify: setupSchema must answer SETUP_DISABLED.
// Read PER CALL (a function, not a load-time constant): the gate always reflects the current environment.
function setupEnabled() {
  return (process.env.SETUP_ENABLED || '0') === '1';
}

// SHA-256 hex of the raw setup token (generate one: `openssl rand -hex 24`, hash it:
// `printf '%s' "<token>" | shasum -a 256`). The raw token never lands in this repo or on the server — only
// its hash does, and callers pass the raw token as the `setupToken` parameter. Empty = no token configured =
// every administrative call refuses (SETUP_TOKEN_UNSET), even while SETUP_ENABLED is true.
function setupTokenSha256() {
  return (process.env.SETUP_TOKEN_SHA256 || '').toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------
// Tunables — the dataset and screen sizes the article's claims are scoped to. Changing one here changes the
// lab, the budget inventory (scripts/budget-inventory.mjs derives its counts from these) and the wording the
// article may use ("the tested 1,000 rows").
// ---------------------------------------------------------------------------------------------------------

const PRODUCTS = 1000;        // Product rows (S3 list + S4 pagination are scoped to exactly this many)
const ORDERS = 200;           // Order rows; all but one owned by the measuring persona (alice)
const ITEMS_PER_ORDER = 20;   // OrderItem rows per order — makes the S2 N+1 shape real
const LIST_ROWS = 100;        // S3: rows per list screen; S4: rows per page
const DEEP_PAGE = 10;         // S4: the deep page measured (skip = (DEEP_PAGE-1)*LIST_ROWS = 900 on 1,000 rows)
const SEED_BATCH_MAX = 250;   // seedData: rows created per Cloud call (caller loops; keeps live calls < timeout)
const DELETE_PAGE_SIZE = 200; // rows deleted per query page in testCleanup
const SEED_TAG = 'seed-v1';   // every seeded row carries it; testCleanup deletes by it and nothing else
const MUTATION_FROM = 'processing'; // S5: the state seedData/reset writes …
const MUTATION_TO = 'shipped';      // … and the state the measured mutation writes (reset between runs)

// ---------------------------------------------------------------------------------------------------------
// Deterministic seed data. ONE generator for both seed paths (scripts/seed.mjs with the master key locally,
// cloud/main.js seedData on the live backend), so the two targets hold byte-identical field values and the
// byte measurements are comparable. No randomness: row i is a pure function of i.
// ---------------------------------------------------------------------------------------------------------

const LOREM = 'Measured, not asserted: the same screen fetched both ways from one backend tells you more than any benchmark of someone else’s. ';
function longText(i, approxBytes) {
  // ~1 KB deterministic description; row index worked in so no two rows compress identically.
  let out = 'Product ' + i + ' — ';
  while (out.length < approxBytes) out += LOREM;
  return out.slice(0, approxBytes);
}

const CATEGORIES = ['anvils', 'rockets', 'springs', 'magnets', 'paint', 'tools', 'decoys', 'balloons'];

function productData(i) {
  const n = String(i).padStart(4, '0');
  return {
    // The screen fields (S3 draws name, sku, priceCents):
    name: 'ACME Item ' + n,
    sku: 'ACME-' + n,                       // unique, sortable: the S4 stable sort key (tie-breaker objectId)
    priceCents: 199 + (i % 900) * 10,
    // The over-fetching payload (deliberately wide rows make field selection measurable):
    description: longText(i, 1024),
    stock: (i * 7) % 500,
    imageUrl: 'https://example.invalid/img/' + n + '.png',
    category: CATEGORIES[i % CATEGORIES.length],
    brand: 'ACME',
    weightGrams: 50 + (i % 200) * 25,
    widthMm: 10 + (i % 90),
    heightMm: 10 + ((i * 3) % 90),
    depthMm: 10 + ((i * 7) % 90),
    material: i % 2 === 0 ? 'steel' : 'carbon',
    warrantyMonths: 12 + (i % 4) * 12,
    seedTag: SEED_TAG,
  };
}

function orderData(i) {
  const n = String(i).padStart(4, '0');
  return {
    number: 'ORD-' + n,
    status: MUTATION_FROM,
    totalCents: 1000 + (i % 100) * 250,
    placedAt: { __type: 'Date', iso: new Date(Date.UTC(2026, 8, 1 + (i % 30), 12, 0, 0)).toISOString() },
    customerName: 'Customer ' + n,
    seedTag: SEED_TAG,
  };
}

/** Item j of order i points at product (i*ITEMS_PER_ORDER + j) % PRODUCTS — every item a distinct product
 *  within its order, so the naive S2 shape really needs one Product request per item. */
function itemData(i, j, productCount) {
  return {
    qty: 1 + ((i + j) % 5),
    unitCents: 199 + (((i * ITEMS_PER_ORDER + j) % 900) * 10),
    productIndex: (i * ITEMS_PER_ORDER + j) % productCount,
    seedTag: SEED_TAG,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Schema: fields, class-level permissions, indexes. One definition for the local parse-server (Postgres) and
// for Back4app (MongoDB), applied by scripts/setup.mjs (master key) or the Cloud function setupSchema.
//
// Write policy (brief amendment S2 — narrowed, object-level, no field-level claim): the ONLY client write the
// backend allows is an UPDATE to an Order OBJECT by the row's owner — CLP update requiresAuthentication, then
// the row ACL (owner read+write, nobody else) decides. Field-level rules would need server-side validation,
// which is deliberately out of scope: the subject is the two auto-generated APIs, so no hook narrows what the
// owner may write to their own row. Everything else: reads need a session; writes are master-only.
// ---------------------------------------------------------------------------------------------------------

const CLP_MASTER_ONLY = {};  // nobody but the master key
const CLP_AUTHENTICATED = { requiresAuthentication: true };
const pointerTo = function (targetClass) { return { type: 'Pointer', targetClass: targetClass }; };

function readableAuthenticated(extra) {
  return Object.assign({
    find: CLP_AUTHENTICATED, get: CLP_AUTHENTICATED, count: CLP_AUTHENTICATED,
    create: CLP_MASTER_ONLY, update: CLP_MASTER_ONLY, delete: CLP_MASTER_ONLY, addField: CLP_MASTER_ONLY,
  }, extra || {});
}

const CLP_ALL_MASTER = {
  find: CLP_MASTER_ONLY, get: CLP_MASTER_ONLY, count: CLP_MASTER_ONLY,
  create: CLP_MASTER_ONLY, update: CLP_MASTER_ONLY, delete: CLP_MASTER_ONLY, addField: CLP_MASTER_ONLY,
};

const SCHEMA = [
  {
    className: 'Product',
    why: 'wide rows (S3 over-fetching is measurable); reads need a session, rows are world-readable to signed-in users; no client writes.',
    fields: {
      name: { type: 'String' },
      sku: { type: 'String' },
      priceCents: { type: 'Number' },
      description: { type: 'String' },
      stock: { type: 'Number' },
      imageUrl: { type: 'String' },
      category: { type: 'String' },
      brand: { type: 'String' },
      weightGrams: { type: 'Number' },
      widthMm: { type: 'Number' },
      heightMm: { type: 'Number' },
      depthMm: { type: 'Number' },
      material: { type: 'String' },
      warrantyMonths: { type: 'Number' },
      seedTag: { type: 'String' },
    },
    classLevelPermissions: readableAuthenticated(),
    indexes: { product_sku: { sku: 1 }, product_seedtag: { seedTag: 1 } },
  },
  {
    className: 'Order',
    why: 'owner-ACLed rows: the owner reads and may update the OBJECT (S5 mutation path, amendment S2); other users see nothing (P3). OrderItem holds the pointers; Order has NO reverse collection field (amendment S1).',
    fields: {
      number: { type: 'String' },
      status: { type: 'String' },   // MUTATION_FROM → MUTATION_TO and back (reset between runs)
      totalCents: { type: 'Number' },
      placedAt: { type: 'Date' },
      customerName: { type: 'String' },
      owner: pointerTo('_User'),
      seedTag: { type: 'String' },
    },
    classLevelPermissions: readableAuthenticated({ update: CLP_AUTHENTICATED }), // row ACL decides WHO (owner only)
    indexes: { order_number: { number: 1 }, order_seedtag: { seedTag: 1 } },
  },
  {
    className: 'OrderItem',
    why: 'one row per order line; pointers to Order and Product (the direction is the point: screens must assemble the parent from here). Rows readable by any signed-in user so P4 can test whether a relation traversal (REST include / GraphQL nested selection) leaks an Order the caller cannot read.',
    fields: {
      order: pointerTo('Order'),
      product: pointerTo('Product'),
      qty: { type: 'Number' },
      unitCents: { type: 'Number' },
      seedTag: { type: 'String' },
    },
    classLevelPermissions: readableAuthenticated(),
    indexes: { orderitem_order: { order: 1 }, orderitem_seedtag: { seedTag: 1 } },
  },
  {
    className: 'AuditLog',
    why: 'master-key-only class for the parity matrix (P6): both APIs must refuse any client access.',
    fields: {
      action: { type: 'String' },
      detail: { type: 'String' },
      seedTag: { type: 'String' },
    },
    classLevelPermissions: CLP_ALL_MASTER,
    indexes: {},
  },
];

module.exports = {
  // Lazy getters: see setupEnabled()/setupTokenSha256() above.
  get SETUP_ENABLED() { return setupEnabled(); },
  get SETUP_TOKEN_SHA256() { return setupTokenSha256(); },
  PRODUCTS: PRODUCTS,
  ORDERS: ORDERS,
  ITEMS_PER_ORDER: ITEMS_PER_ORDER,
  LIST_ROWS: LIST_ROWS,
  DEEP_PAGE: DEEP_PAGE,
  SEED_BATCH_MAX: SEED_BATCH_MAX,
  DELETE_PAGE_SIZE: DELETE_PAGE_SIZE,
  SEED_TAG: SEED_TAG,
  MUTATION_FROM: MUTATION_FROM,
  MUTATION_TO: MUTATION_TO,
  productData: productData,
  orderData: orderData,
  itemData: itemData,
  SCHEMA: SCHEMA,
};
