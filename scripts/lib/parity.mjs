// File: scripts/lib/parity.mjs · Node 22 ESM
// The parity matrix (brief §5, P1–P10), executed against REST AND GraphQL: security is tested, not assumed.
// Each case records verbatim status/code/body-summary both ways plus a leak assertion (no foreign field value
// in the body) and, for the positive controls, a database state read-back. "Refusal parity" means the same
// caller LEARNS the same amount both ways — not necessarily the same status code, which P9 records honestly.
import { createRequire } from 'node:module';
import { GQL, MUTATION_TO, MUTATION_FROM, toGlobalId } from './shapes.mjs';

const config = createRequire(import.meta.url)('../../cloud/config.js');

const snip = (t) => String(t ?? '').replace(/\s+/g, ' ').slice(0, 160);

function restRow(r) {
  return { status: r.status, code: (r.json && r.json.code) ?? null, body: snip(r.text) };
}
function gqlRow(r) {
  const e = r.errors && r.errors[0];
  return {
    status: r.status,
    code: e ? ((e.extensions && e.extensions.code) ?? null) : null,
    body: e ? snip(e.message) : snip(JSON.stringify(r.data)),
    httpOkWithErrors: r.status === 200 && !!e, // GraphQL's 200-with-errors convention, recorded when observed
  };
}

/**
 * runParity(c, env, world) → rows[]
 *   c: shapes recorder · world: { ctx (alice's, from buildContext), bob: {token}, bobOrder: {objectId, gid,
 *   number, customerName}, bobItem: {objectId, gid}, inspect(className, where) }.
 */
export async function runParity(c, env, world) {
  const { ctx, bobOrder, bobItem, inspect } = world;
  const rows = [];
  const push = (id, protocol, persona, attempt, data, { expected, ok, leak = null, state = '—' }) => {
    rows.push({ id, protocol, persona, attempt, ...data, expected, ok, leak, state });
  };
  const noLeak = (text) => !text.includes(bobOrder.number) && !text.includes(bobOrder.customerName);

  // P1 — anonymous find on Product (no session at all; the shared app-id/key headers are still sent).
  const p1r = await c.rest('GET', '/classes/Product?limit=1');
  push('P1', 'rest', 'anonymous', 'find Product', restRow(p1r), { expected: 'refused (session required)', ok: p1r.status !== 200 });
  const p1g = await c.gql(GQL.s3, { first: 1 });
  push('P1', 'graphql', 'anonymous', 'find Product', gqlRow(p1g), { expected: 'refused (session required)', ok: p1g.rec.failed && (!p1g.data || !p1g.data.products) });

  // P2 — invalid session token.
  const p2r = await c.rest('GET', '/classes/Product?limit=1', { session: 'r:invalid-token-000000' });
  push('P2', 'rest', 'invalid session', 'find Product', restRow(p2r), { expected: 'refused (209)', ok: p2r.status !== 200 });
  const p2g = await c.gql(GQL.s3, { first: 1 }, { session: 'r:invalid-token-000000' });
  push('P2', 'graphql', 'invalid session', 'find Product', gqlRow(p2g), { expected: 'refused (209)', ok: p2g.rec.failed });

  // P3 — user A reaches for the Order row ACL'd to user B: by id, by where, by GraphQL filter.
  const p3a = await c.rest('GET', `/classes/Order/${bobOrder.objectId}`, { session: ctx.session });
  push('P3', 'rest', 'alice', "GET bob's order by id", restRow(p3a), { expected: 'not found (101), no data', ok: p3a.status === 404 && noLeak(p3a.text), leak: !noLeak(p3a.text) });
  const p3b = await c.rest('GET', `/classes/Order?where=${encodeURIComponent(JSON.stringify({ number: bobOrder.number }))}`, { session: ctx.session });
  push('P3', 'rest', 'alice', "find bob's order by where", { ...restRow(p3b), body: `results:${(p3b.json && p3b.json.results && p3b.json.results.length) ?? '—'}` }, { expected: 'zero rows', ok: p3b.status === 200 && p3b.json.results.length === 0 });
  const p3c = await c.gql('query($id: ID!) { order(id: $id) { objectId number customerName } }', { id: bobOrder.gid }, { session: ctx.session });
  push('P3', 'graphql', 'alice', "order(id:) on bob's order", gqlRow(p3c), { expected: 'not found / null, no data', ok: (!p3c.data || !p3c.data.order) && noLeak(p3c.text), leak: !noLeak(p3c.text) });
  const p3d = await c.gql('query($n: String!) { orders(where: { number: { equalTo: $n } }, first: 5) { count edges { node { objectId number } } } }', { n: bobOrder.number }, { session: ctx.session });
  const p3dEdges = p3d.data && p3d.data.orders ? p3d.data.orders.edges.length : null;
  push('P3', 'graphql', 'alice', "orders(where:) filter on bob's order", { ...gqlRow(p3d), body: `edges:${p3dEdges} count:${p3d.data && p3d.data.orders ? p3d.data.orders.count : '—'}` }, { expected: 'zero rows, identically', ok: p3dEdges === 0 && noLeak(p3d.text) });

  // P4 — reaching B's row THROUGH the relation: the OrderItem row is readable; its order pointer must not
  // expand into data alice cannot read directly.
  const p4r = await c.rest('GET', `/classes/OrderItem/${bobItem.objectId}?include=order`, { session: ctx.session });
  const p4rExpanded = !!(p4r.json && p4r.json.order && p4r.json.order.number !== undefined);
  push('P4', 'rest', 'alice', "GET bob's OrderItem include=order", { ...restRow(p4r), body: `order field: ${p4rExpanded ? 'EXPANDED' : snip(JSON.stringify(p4r.json && p4r.json.order))}` }, { expected: 'pointer data not returned', ok: p4r.status === 200 && !p4rExpanded && noLeak(p4r.text), leak: !noLeak(p4r.text) });
  const p4g = await c.gql('query($id: ID!) { orderItem(id: $id) { objectId qty order { objectId number customerName } } }', { id: bobItem.gid }, { session: ctx.session });
  const p4gOrder = p4g.data && p4g.data.orderItem ? p4g.data.orderItem.order : undefined;
  push('P4', 'graphql', 'alice', "orderItem(id:) { order { … } } on bob's item", { ...gqlRow(p4g), body: `nested order: ${p4gOrder && p4gOrder.number ? 'EXPANDED' : snip(JSON.stringify(p4gOrder))}` }, { expected: 'pointer data not returned', ok: !(p4gOrder && p4gOrder.number) && noLeak(p4g.text), leak: !noLeak(p4g.text) });

  // P5 — write to a class whose client writes are denied (create Product as alice).
  const p5r = await c.rest('POST', '/classes/Product', { session: ctx.session, body: { name: 'intruder', sku: 'HACK-0001' } });
  push('P5', 'rest', 'alice', 'create Product', restRow(p5r), { expected: 'refused', ok: p5r.status !== 200 && p5r.status !== 201 });
  const p5g = await c.gql('mutation { createProduct(input: { fields: { name: "intruder", sku: "HACK-0002" } }) { product { objectId } } }', {}, { session: ctx.session });
  push('P5', 'graphql', 'alice', 'createProduct mutation', gqlRow(p5g), { expected: 'refused', ok: p5g.rec.failed });
  const p5state = await inspect('Product', { sku: 'HACK-0001' });
  const p5state2 = await inspect('Product', { sku: 'HACK-0002' });
  rows[rows.length - 1].state = rows[rows.length - 2].state = `intruder rows in db: ${p5state.length + p5state2.length}`;

  // P6 — any access to the master-key-only AuditLog.
  const p6r = await c.rest('GET', '/classes/AuditLog?limit=1', { session: ctx.session });
  push('P6', 'rest', 'alice', 'find AuditLog', restRow(p6r), { expected: 'refused', ok: p6r.status !== 200 });
  const p6g = await c.gql('query { auditLogs(first: 1) { edges { node { objectId action } } } }', {}, { session: ctx.session });
  push('P6', 'graphql', 'alice', 'auditLogs query', gqlRow(p6g), { expected: 'refused', ok: p6g.rec.failed || !(p6g.data && p6g.data.auditLogs && p6g.data.auditLogs.edges.length) });

  // P7 — update an Order the caller does not own (object-level policy, amendment S2).
  const p7r = await c.rest('PUT', `/classes/Order/${bobOrder.objectId}`, { session: ctx.session, body: { status: MUTATION_TO } });
  push('P7', 'rest', 'alice', "update bob's order", restRow(p7r), { expected: 'refused', ok: p7r.status !== 200 });
  const p7g = await c.gql(GQL.s5, { id: bobOrder.gid, status: MUTATION_TO }, { session: ctx.session });
  push('P7', 'graphql', 'alice', "updateOrder on bob's order", gqlRow(p7g), { expected: 'refused', ok: p7g.rec.failed });
  const p7state = await inspect('Order', { objectId: bobOrder.objectId });
  rows[rows.length - 1].state = rows[rows.length - 2].state = `bob's order status: ${p7state[0] && p7state[0].status}`;
  const p7ok = p7state[0] && p7state[0].status === MUTATION_FROM;
  rows[rows.length - 1].ok = rows[rows.length - 1].ok && p7ok;
  rows[rows.length - 2].ok = rows[rows.length - 2].ok && p7ok;

  // P8 — introspection (GraphQL-only structural difference; REST has no equivalent). Reported as a
  // difference, not a vulnerability claim, unless it reveals DATA (the leak check above covers data).
  const intro = 'query { __schema { types { name kind } } }';
  const customNames = (r) => {
    const types = r.data && r.data.__schema ? r.data.__schema.types.map((t) => t.name) : [];
    return ['Product', 'Order', 'OrderItem', 'AuditLog'].filter((n) => types.includes(n));
  };
  const p8a = await c.gql(intro, {});
  push('P8', 'graphql', 'anonymous', 'introspection __schema', { ...gqlRow(p8a), body: p8a.rec.failed ? gqlRow(p8a).body : `custom classes revealed: ${customNames(p8a).join(', ') || 'none'}` }, { expected: 'to measure (recorded, not asserted)', ok: true });
  const p8b = await c.gql(intro, {}, { session: ctx.session });
  push('P8', 'graphql', 'alice', 'introspection __schema', { ...gqlRow(p8b), body: p8b.rec.failed ? gqlRow(p8b).body : `custom classes revealed: ${customNames(p8b).join(', ') || 'none'}` }, { expected: 'to measure (recorded, not asserted)', ok: true });
  push('P8', 'rest', '—', 'no REST equivalent of introspection', { status: null, code: null, body: 'structural difference: REST exposes no schema query to clients' }, { expected: 'recorded as a difference', ok: true });

  // P9 — error-shape comparison: P1's refusal verbatim both ways (status, Parse code, body).
  push('P9', 'rest', 'anonymous', 'P1 refusal verbatim', restRow(p1r), { expected: 'recorded verbatim', ok: true });
  push('P9', 'graphql', 'anonymous', 'P1 refusal verbatim', gqlRow(p1g), { expected: "recorded verbatim (incl. GraphQL's 200-with-errors convention if observed)", ok: true });

  // P10 — positive controls: the permitted operation succeeds, body checked field-by-field, state read back.
  const own = await c.rest('GET', `/classes/Order/${ctx.orderId}`, { session: ctx.session });
  const expect0 = config.orderData(0);
  const bodyOkR = own.status === 200 && own.json.number === expect0.number && own.json.customerName === expect0.customerName && own.json.totalCents === expect0.totalCents;
  push('P10', 'rest', 'alice', 'read own order (field-by-field)', restRow(own), { expected: 'succeeds, fields match seed', ok: bodyOkR });
  const owng = await c.gql('query($id: ID!) { order(id: $id) { number customerName totalCents } }', { id: ctx.orderGid }, { session: ctx.session });
  const g = owng.data && owng.data.order;
  const bodyOkG = !!g && g.number === expect0.number && g.customerName === expect0.customerName && g.totalCents === expect0.totalCents;
  push('P10', 'graphql', 'alice', 'read own order (field-by-field)', gqlRow(owng), { expected: 'succeeds, fields match seed', ok: bodyOkG });
  for (const [proto, doMutate] of [
    ['rest', () => c.rest('PUT', `/classes/Order/${ctx.orderId}`, { session: ctx.session, body: { status: MUTATION_TO } })],
    ['graphql', () => c.gql(GQL.s5, { id: ctx.orderGid, status: MUTATION_TO }, { session: ctx.session })],
  ]) {
    const r = await doMutate();
    const st = await inspect('Order', { objectId: ctx.orderId });
    const mutated = st[0] && st[0].status === MUTATION_TO;
    push('P10', proto, 'alice (owner)', 'mutate own order + state read-back', proto === 'rest' ? restRow(r) : gqlRow(r), { expected: `db status becomes ${MUTATION_TO}`, ok: mutated, state: `status after: ${st[0] && st[0].status}` });
    await c.rest('PUT', `/classes/Order/${ctx.orderId}`, { session: ctx.session, body: { status: MUTATION_FROM } }); // reset
  }

  return rows;
}

/** Resolves bob's order and one of its items (the P3/P4 targets) via testInspect/master read-backs. */
export async function resolveBobTargets(inspect, totalOrders) {
  const number = config.orderData(totalOrders - 1).number;
  const orders = await inspect('Order', { number });
  if (!orders[0]) throw new Error(`parity: bob's order ${number} not found — reseed`);
  const o = orders[0];
  const items = await inspect('OrderItem', { order: { __type: 'Pointer', className: 'Order', objectId: o.objectId } });
  if (!items[0]) throw new Error("parity: bob's order has no items — reseed");
  return {
    bobOrder: { objectId: o.objectId, gid: toGlobalId('Order', o.objectId), number: o.number, customerName: o.customerName },
    bobItem: { objectId: items[0].objectId, gid: toGlobalId('OrderItem', items[0].objectId) },
  };
}
