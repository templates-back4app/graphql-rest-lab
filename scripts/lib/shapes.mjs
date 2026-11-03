// File: scripts/lib/shapes.mjs · Node 22 ESM
// THE FIXED SCREEN SHAPES (brief amendment S1): the exact requests each protocol makes for each of the five
// screens, as WORKING CODE — the request counts and retrieval paths come from executing this file and are
// recorded per cell, never declared ("no 1+20 assumptions"). The equivalence diff, the parity run and the
// measurement harness all execute THESE cells; nothing times a shape this file does not define. Fixed before
// anything is benchmarked; verified by test/shapes.test.mjs (normalized responses of both protocols diffed).
//
// Relation model (amendment S1): OrderItem holds pointers to Order and Product; Order has NO reverse
// collection field. So both protocols must assemble the Order screen FROM OrderItem:
//   REST    — a query on OrderItem with `where` on the order pointer (+ include / keys / count=1).
//   GraphQL — the auto-generated schema exposes no reverse connection on Order; the working path is ONE HTTP
//             POST whose document carries TWO root fields: order(id:…) and a filtered orderItems(where:…).
// GraphQL object ids: the relay global id (base64 "ClassName:objectId"). buildContext() COMPUTES it and then
// VERIFIES it against the id the API itself returns — a mismatch fails context building, so no shape ever
// runs on an assumed id scheme.
import { createRequire } from 'node:module';
import { parseHeaders } from './transport.mjs';

const config = createRequire(import.meta.url)('../../cloud/config.js');

export const MUTATION_FROM = config.MUTATION_FROM;
export const MUTATION_TO = config.MUTATION_TO;

// ---------------------------------------------------------------------------------------------------------
// Recorder: wraps a transport; every cell run goes through it so request counts and byte totals are DERIVED
// from what actually crossed the socket.
// ---------------------------------------------------------------------------------------------------------

export function makeRecorder(transport, env) {
  const records = [];

  async function rest(method, path, { session, body } = {}) {
    const headers = parseHeaders(env, { session });
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await transport.raw(method, env.SERVER_URL + path, { headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const rec = { protocol: 'rest', method, path, ...summarize(r), failed: r.status < 200 || r.status >= 300 };
    records.push(rec);
    return { ...r, rec };
  }

  async function gql(query, variables, { session } = {}) {
    const headers = { ...parseHeaders(env, { session }), 'Content-Type': 'application/json' };
    const r = await transport.raw('POST', env.GRAPHQL_URL, { headers, body: JSON.stringify({ query, variables }) });
    // Amendment S4: a GraphQL `errors` array or missing data is a FAILED run even on HTTP 200.
    const failed = r.status !== 200 || !r.json || Array.isArray(r.json.errors) && r.json.errors.length > 0 || !r.json.data;
    const rec = { protocol: 'graphql', method: 'POST', path: '/graphql', ...summarize(r), failed, gqlErrors: r.json && r.json.errors ? r.json.errors.map((e) => e.message) : [] };
    records.push(rec);
    return { ...r, data: r.json ? r.json.data : null, errors: (r.json && r.json.errors) || null, rec };
  }

  function summarize(r) {
    return {
      status: r.status, ms: r.ms,
      wireUp: r.wire.up, wireDown: r.wire.down, wireAttested: r.wire.attested,
      reqHeaderBytes: r.bytes.requestHeaders, reqBodyBytes: r.bytes.requestBody,
      respHeaderBytes: r.bytes.responseHeaders, respBodyBytes: r.bytes.responseBody,
      contentEncoding: r.contentEncoding,
    };
  }

  return { records, rest, gql };
}

/** Totals over one cell run — requests, both directions, headers counted per request (repeats included). */
export function totals(records) {
  const t = { requests: records.length, wireUp: 0, wireDown: 0, wireAttested: true, reqHeaderBytes: 0, reqBodyBytes: 0, respHeaderBytes: 0, respBodyBytes: 0, failed: records.some((r) => r.failed) };
  for (const r of records) {
    t.wireUp += r.wireUp ?? 0; t.wireDown += r.wireDown ?? 0;
    if (!r.wireAttested) t.wireAttested = false;
    t.reqHeaderBytes += r.reqHeaderBytes ?? 0; t.reqBodyBytes += r.reqBodyBytes ?? 0;
    t.respHeaderBytes += r.respHeaderBytes ?? 0; t.respBodyBytes += r.respBodyBytes ?? 0;
  }
  return t;
}

// ---------------------------------------------------------------------------------------------------------
// Normalizers → canonical screen data (what the screen draws), diffable across protocols.
// ---------------------------------------------------------------------------------------------------------

const PRODUCT_FIELDS = ['name', 'sku', 'priceCents', 'description', 'stock', 'imageUrl', 'category', 'brand',
  'weightGrams', 'widthMm', 'heightMm', 'depthMm', 'material', 'warrantyMonths'];

const isoOf = (v) => (v && typeof v === 'object' && v.__type === 'Date') ? v.iso : v ?? null;

function canonProduct(o) {
  const out = { objectId: o.objectId };
  for (const f of PRODUCT_FIELDS) out[f] = o[f] ?? null;
  return out;
}

const canonListRow = (o) => ({ objectId: o.objectId, name: o.name ?? null, sku: o.sku ?? null, priceCents: o.priceCents ?? null });

function canonOrder(o) {
  return { objectId: o.objectId, number: o.number ?? null, status: o.status ?? null, totalCents: o.totalCents ?? null, placedAt: isoOf(o.placedAt), customerName: o.customerName ?? null };
}

const byObjectId = (a, b) => (a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------
// GraphQL documents — the fixed query texts (their byte size is part of what is measured).
// ---------------------------------------------------------------------------------------------------------

export const GQL = {
  s1: `query ProductDetail($id: ID!) { product(id: $id) { objectId ${PRODUCT_FIELDS.join(' ')} } }`,
  s2: `query OrderScreen($orderGid: ID!, $orderObjectId: ID!, $first: Int!) {
  order(id: $orderGid) { objectId number status totalCents placedAt customerName }
  orderItems(where: { order: { have: { objectId: { equalTo: $orderObjectId } } } }, order: [objectId_ASC], first: $first) {
    count
    edges { node { objectId qty unitCents product { name } } }
  }
}`,
  s3: `query ProductList($first: Int!) {
  products(order: [sku_ASC, objectId_ASC], first: $first) {
    edges { node { objectId name sku priceCents } }
  }
}`,
  s4page: `query ProductPage($first: Int!, $after: String) {
  products(order: [sku_ASC, objectId_ASC], first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { cursor node { objectId name sku priceCents } }
  }
}`,
  s5: `mutation ShipOrder($id: ID!, $status: String!) {
  updateOrder(input: { id: $id, fields: { status: $status } }) { order { objectId status } }
}`,
};

const restListKeys = 'keys=name,sku,priceCents';
const orderPointerWhere = (orderId) => encodeURIComponent(JSON.stringify({ order: { __type: 'Pointer', className: 'Order', objectId: orderId } }));

// ---------------------------------------------------------------------------------------------------------
// The cells. Each returns { canonical } (plus cell-specific extras); request counts and bytes come from the
// recorder. ctx: { session, productId, productGid, orderId, orderGid, listRows, deepPage, deepCursor? }.
// ---------------------------------------------------------------------------------------------------------

export const CELLS = {
  // S1 — product detail: one object, full row (a detail screen draws everything). Factor: per-request
  // protocol overhead. REST sends no request body; GraphQL sends the query text (counted, H5).
  's1-rest': {
    screen: 'S1', protocol: 'rest', pairedWith: 's1-gql', baseline: true,
    async run(c, ctx) {
      const r = await c.rest('GET', `/classes/Product/${ctx.productId}`, { session: ctx.session });
      return { canonical: r.json ? canonProduct(r.json) : null };
    },
  },
  's1-gql': {
    screen: 'S1', protocol: 'graphql', pairedWith: 's1-rest',
    async run(c, ctx) {
      const r = await c.gql(GQL.s1, { id: ctx.productGid }, { session: ctx.session });
      return { canonical: r.data && r.data.product ? canonProduct(r.data.product) : null };
    },
  },

  // S2 — order detail (parent + children + product names + item count). The request counts below are NOT
  // declared anywhere: they are whatever records.length says after a run.
  's2-rest-naive': {
    screen: 'S2', protocol: 'rest', antiPattern: true, // request-SHAPE illustration, never REST's representative
    async run(c, ctx) {
      const order = await c.rest('GET', `/classes/Order/${ctx.orderId}`, { session: ctx.session });
      const items = await c.rest('GET', `/classes/OrderItem?where=${orderPointerWhere(ctx.orderId)}&order=objectId&limit=${ctx.listRows}&count=1&keys=qty,unitCents,product`, { session: ctx.session });
      const rows = [];
      for (const it of (items.json && items.json.results) || []) {
        const prod = await c.rest('GET', `/classes/Product/${it.product.objectId}?keys=name`, { session: ctx.session }); // one request per line: the N+1 shape
        rows.push({ objectId: it.objectId, qty: it.qty, unitCents: it.unitCents, productName: prod.json ? prod.json.name : null });
      }
      return { canonical: s2Canonical(order.json, items.json ? items.json.count : null, rows) };
    },
  },
  's2-rest-include2': {
    screen: 'S2', protocol: 'rest',
    async run(c, ctx) { // parent GET + ONE OrderItem query with include=product (the shape §4.3(b) sketches)
      const order = await c.rest('GET', `/classes/Order/${ctx.orderId}`, { session: ctx.session });
      const items = await c.rest('GET', `/classes/OrderItem?where=${orderPointerWhere(ctx.orderId)}&order=objectId&limit=${ctx.listRows}&count=1&include=product&keys=qty,unitCents,product.name`, { session: ctx.session });
      const rows = ((items.json && items.json.results) || []).map((it) => ({ objectId: it.objectId, qty: it.qty, unitCents: it.unitCents, productName: it.product ? it.product.name : null }));
      return { canonical: s2Canonical(order.json, items.json ? items.json.count : null, rows) };
    },
  },
  's2-rest-include1': {
    screen: 'S2', protocol: 'rest', pairedWith: 's2-gql',
    async run(c, ctx) { // fewest requests REST allows here: include BOTH pointers; the parent rides inside every
      // item (byte cost measured). Only possible because this screen's order always has ≥ 1 item.
      const items = await c.rest('GET', `/classes/OrderItem?where=${orderPointerWhere(ctx.orderId)}&order=objectId&limit=${ctx.listRows}&count=1&include=order,product&keys=qty,unitCents,order.number,order.status,order.totalCents,order.placedAt,order.customerName,product.name`, { session: ctx.session });
      const list = (items.json && items.json.results) || [];
      const rows = list.map((it) => ({ objectId: it.objectId, qty: it.qty, unitCents: it.unitCents, productName: it.product ? it.product.name : null }));
      return { canonical: s2Canonical(list.length ? list[0].order : null, items.json ? items.json.count : null, rows) };
    },
  },
  's2-gql': {
    screen: 'S2', protocol: 'graphql', pairedWith: 's2-rest-include1',
    async run(c, ctx) { // ONE HTTP POST, TWO root fields (no reverse connection on Order — amendment S1)
      const r = await c.gql(GQL.s2, { orderGid: ctx.orderGid, orderObjectId: ctx.orderId, first: ctx.listRows }, { session: ctx.session });
      if (!r.data || !r.data.order || !r.data.orderItems) return { canonical: null };
      const rows = r.data.orderItems.edges.map(({ node }) => ({ objectId: node.objectId, qty: node.qty, unitCents: node.unitCents, productName: node.product ? node.product.name : null }));
      return { canonical: s2Canonical(r.data.order, r.data.orderItems.count, rows) };
    },
  },

  // S3 — product list, `listRows` rows, the screen draws 3 fields. Factor: bytes per response.
  's3-rest-full': {
    screen: 'S3', protocol: 'rest', antiPattern: true, // the over-fetching cell (REST's own keys= solves it)
    async run(c, ctx) {
      const r = await c.rest('GET', `/classes/Product?order=sku,objectId&limit=${ctx.listRows}`, { session: ctx.session });
      return { canonical: ((r.json && r.json.results) || []).map(canonListRow) };
    },
  },
  's3-rest-keys': {
    screen: 'S3', protocol: 'rest', pairedWith: 's3-gql',
    async run(c, ctx) { // REST HAS field selection and the post says so
      const r = await c.rest('GET', `/classes/Product?order=sku,objectId&limit=${ctx.listRows}&${restListKeys}`, { session: ctx.session });
      return { canonical: ((r.json && r.json.results) || []).map(canonListRow) };
    },
  },
  's3-gql': {
    screen: 'S3', protocol: 'graphql', pairedWith: 's3-rest-keys',
    async run(c, ctx) {
      const r = await c.gql(GQL.s3, { first: ctx.listRows }, { session: ctx.session });
      return { canonical: r.data && r.data.products ? r.data.products.edges.map(({ node }) => canonListRow(node)) : null };
    },
  },

  // S4 — pagination. Stable sort everywhere: sku ascending, objectId tie-breaker (amendment S3). Deep-page
  // cells distinguish "page ten with an ALREADY-KNOWN cursor/offset" from "navigating pages 1..10
  // CUMULATIVELY" and are reported separately. All conclusions scoped to the tested dataset size.
  's4-rest-page1': {
    screen: 'S4', protocol: 'rest', pairedWith: 's4-gql-page1',
    async run(c, ctx) {
      const r = await c.rest('GET', `/classes/Product?order=sku,objectId&limit=${ctx.listRows}&${restListKeys}`, { session: ctx.session });
      return { canonical: ((r.json && r.json.results) || []).map(canonListRow) };
    },
  },
  's4-rest-deep-offset': {
    screen: 'S4', protocol: 'rest', pairedWith: 's4-gql-deep-cursor',
    async run(c, ctx) { // the deep page with an already-known offset: one request, skip=(deepPage-1)*rows
      const skip = (ctx.deepPage - 1) * ctx.listRows;
      const r = await c.rest('GET', `/classes/Product?order=sku,objectId&limit=${ctx.listRows}&skip=${skip}&${restListKeys}`, { session: ctx.session });
      return { canonical: ((r.json && r.json.results) || []).map(canonListRow) };
    },
  },
  's4-rest-deep-cumulative': {
    screen: 'S4', protocol: 'rest', pairedWith: 's4-gql-deep-cumulative',
    async run(c, ctx) { // navigating pages 1..deepPage: deepPage sequential requests
      let rows = [];
      for (let p = 0; p < ctx.deepPage; p++) {
        const r = await c.rest('GET', `/classes/Product?order=sku,objectId&limit=${ctx.listRows}&skip=${p * ctx.listRows}&${restListKeys}`, { session: ctx.session });
        rows = ((r.json && r.json.results) || []).map(canonListRow);
      }
      return { canonical: rows };
    },
  },
  's4-gql-page1': {
    screen: 'S4', protocol: 'graphql', pairedWith: 's4-rest-page1',
    async run(c, ctx) {
      const r = await c.gql(GQL.s4page, { first: ctx.listRows, after: null }, { session: ctx.session });
      return { canonical: pageRows(r), pageInfo: pageInfoOf(r) };
    },
  },
  's4-gql-deep-cursor': {
    screen: 'S4', protocol: 'graphql', pairedWith: 's4-rest-deep-offset',
    async run(c, ctx) { // the deep page with an ALREADY-KNOWN cursor (harvested once, outside the timed cell)
      if (!ctx.deepCursor) throw new Error('ctx.deepCursor missing — run harvestDeepCursor(ctx) first');
      const r = await c.gql(GQL.s4page, { first: ctx.listRows, after: ctx.deepCursor }, { session: ctx.session });
      return { canonical: pageRows(r), pageInfo: pageInfoOf(r) };
    },
  },
  's4-gql-deep-cumulative': {
    screen: 'S4', protocol: 'graphql', pairedWith: 's4-rest-deep-cumulative',
    async run(c, ctx) { // navigating pages 1..deepPage by following endCursor: deepPage sequential requests
      let after = null; let rows = null;
      for (let p = 0; p < ctx.deepPage; p++) {
        const r = await c.gql(GQL.s4page, { first: ctx.listRows, after }, { session: ctx.session });
        rows = pageRows(r);
        const info = pageInfoOf(r);
        after = info ? info.endCursor : null;
        if (!after) break;
      }
      return { canonical: rows };
    },
  },

  // S5 — the mutation: mark an order shipped. Policy (amendment S2): owner-authorized OBJECT update — the row
  // ACL lets the owner write the object; no field-level rule exists or is claimed. The cell is the mutation
  // ONLY; state read-back and the between-runs reset (back to MUTATION_FROM, a real client write by the same
  // owner) happen outside the timed cell and are counted separately in the budget inventory.
  's5-rest': {
    screen: 'S5', protocol: 'rest', pairedWith: 's5-gql', mutates: true,
    async run(c, ctx) {
      const r = await c.rest('PUT', `/classes/Order/${ctx.orderId}`, { session: ctx.session, body: { status: MUTATION_TO } });
      return { canonical: { updated: r.status === 200 } };
    },
  },
  's5-gql': {
    screen: 'S5', protocol: 'graphql', pairedWith: 's5-rest', mutates: true,
    async run(c, ctx) {
      const r = await c.gql(GQL.s5, { id: ctx.orderGid, status: MUTATION_TO }, { session: ctx.session });
      return { canonical: { updated: !!(r.data && r.data.updateOrder && r.data.updateOrder.order && r.data.updateOrder.order.status === MUTATION_TO) } };
    },
  },
};

function s2Canonical(order, count, rows) {
  if (!order) return null;
  return { order: canonOrder(order), count: count ?? null, items: [...rows].sort(byObjectId) };
}

const pageRows = (r) => (r.data && r.data.products ? r.data.products.edges.map(({ node }) => canonListRow(node)) : null);
const pageInfoOf = (r) => (r.data && r.data.products ? r.data.products.pageInfo : null);

// ---------------------------------------------------------------------------------------------------------
// Context building and helpers around the cells
// ---------------------------------------------------------------------------------------------------------

export const toGlobalId = (className, objectId) => Buffer.from(`${className}:${objectId}`, 'utf8').toString('base64');

/**
 * buildContext(recorder, env, { alice: {username,password}, listRows?, deepPage? }) → ctx
 * Signs in, resolves the screen targets by their seeded natural keys, computes the relay global ids and
 * VERIFIES them against the ids the GraphQL API itself returns (no assumed id scheme — amendment S1 spirit).
 * Every request it makes goes through the recorder too, so prep traffic lands in the budget inventory.
 */
export async function buildContext(c, env, { alice, listRows, deepPage } = {}) {
  const listN = listRows ?? config.LIST_ROWS;
  const deepN = deepPage ?? config.DEEP_PAGE;
  const login = await c.rest('POST', '/login', { body: { username: alice.username, password: alice.password } });
  if (login.status !== 200) throw new Error(`login ${alice.username} failed: ${login.status} ${login.text}`);
  const session = login.json.sessionToken;

  const prod = await c.rest('GET', `/classes/Product?where=${encodeURIComponent(JSON.stringify({ sku: config.productData(0).sku }))}&keys=sku&limit=1`, { session });
  const productId = prod.json.results[0] && prod.json.results[0].objectId;
  const ord = await c.rest('GET', `/classes/Order?where=${encodeURIComponent(JSON.stringify({ number: config.orderData(0).number }))}&keys=number&limit=1`, { session });
  const orderId = ord.json.results[0] && ord.json.results[0].objectId;
  if (!productId || !orderId) throw new Error('context: seeded Product/Order rows not found — run `npm run seed` against this target first');

  // Verify the relay global-id scheme against the API itself (one GraphQL query; recorded like everything else).
  const probe = await c.gql(
    'query VerifyIds($sku: String!, $number: String!) { products(where: { sku: { equalTo: $sku } }, first: 1) { edges { node { id objectId } } } orders(where: { number: { equalTo: $number } }, first: 1) { edges { node { id objectId } } } }',
    { sku: config.productData(0).sku, number: config.orderData(0).number }, { session });
  if (probe.rec.failed) throw new Error(`context: id-verification query failed: ${JSON.stringify(probe.errors || probe.status)}`);
  const pNode = probe.data.products.edges[0] && probe.data.products.edges[0].node;
  const oNode = probe.data.orders.edges[0] && probe.data.orders.edges[0].node;
  if (!pNode || pNode.objectId !== productId || pNode.id !== toGlobalId('Product', productId)) {
    throw new Error(`context: relay id scheme mismatch for Product (api id=${pNode && pNode.id}) — fix toGlobalId before any shape runs`);
  }
  if (!oNode || oNode.objectId !== orderId || oNode.id !== toGlobalId('Order', orderId)) {
    throw new Error(`context: relay id scheme mismatch for Order (api id=${oNode && oNode.id}) — fix toGlobalId before any shape runs`);
  }

  return {
    session, username: alice.username,
    productId, productGid: pNode.id,
    orderId, orderGid: oNode.id,
    listRows: listN, deepPage: deepN,
    deepCursor: null, // harvestDeepCursor(c, ctx) fills it
  };
}

/** Walks pages 1..deepPage-1 ONCE to learn the cursor that precedes the deep page (prep, outside timed cells),
 *  and returns what the cursor DECODES to, so the offset-vs-keyset question is answered by evidence. */
export async function harvestDeepCursor(c, ctx) {
  let after = null; let decoded = [];
  for (let p = 0; p < ctx.deepPage - 1; p++) {
    const r = await c.gql(GQL.s4page, { first: ctx.listRows, after }, { session: ctx.session });
    if (r.rec.failed) throw new Error(`harvestDeepCursor: page ${p + 1} failed: ${JSON.stringify(r.errors)}`);
    const info = pageInfoOf(r);
    after = info.endCursor;
    decoded.push(decodeCursor(after));
    if (!info.hasNextPage) break;
  }
  ctx.deepCursor = after;
  return { deepCursor: after, decodedTrail: decoded };
}

/** What a cursor actually is (amendment S3: verified, not assumed). graphql-relay's array connections encode
 *  base64("arrayconnection:<offset>") — i.e. OFFSET-ENCODED. Whatever this returns is the record. */
export function decodeCursor(cursor) {
  if (typeof cursor !== 'string') return { raw: cursor, decoded: null, kind: 'absent' };
  let text = null;
  try { text = Buffer.from(cursor, 'base64').toString('utf8'); } catch { /* not base64 */ }
  const m = text && text.match(/^arrayconnection:(\d+)$/);
  return {
    raw: cursor,
    decoded: text,
    kind: m ? 'offset-encoded (graphql-relay arrayconnection)' : 'NOT offset-encoded — inspect before claiming keyset',
    offset: m ? Number(m[1]) : null,
  };
}

/** The between-runs reset for S5: a REAL client write by the owner (REST PUT), so every timed run performs a
 *  real state change (amendment S4). Runs through the recorder passed in — measure.mjs uses a separate
 *  recorder so resets are counted but never timed into the cell. */
export async function resetOrderStatus(c, ctx) {
  const r = await c.rest('PUT', `/classes/Order/${ctx.orderId}`, { session: ctx.session, body: { status: MUTATION_FROM } });
  if (r.status !== 200) throw new Error(`resetOrderStatus failed: ${r.status} ${r.text}`);
}
