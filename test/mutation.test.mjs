// File: test/mutation.test.mjs — S5 (owner-authorized OBJECT update, amendment S2) and the error rule
// (amendment S4): a GraphQL `errors` array on HTTP 200 is a FAILED run; the reset makes every run a real
// state change; a non-owner write fails on BOTH protocols and the database proves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { CELLS, GQL, resetOrderStatus, toGlobalId, MUTATION_FROM, MUTATION_TO } from '../scripts/lib/shapes.mjs';
import { resolveBobTargets } from '../scripts/lib/parity.mjs';

test('S5 mutation path', async (t) => {
  const h = await harness({ suite: 'mutation' });
  t.after(() => h.close());
  const ctx = await h.buildCtx();

  await t.test('owner mutation succeeds both ways, state read back, reset makes the next run real', async () => {
    for (const id of ['s5-rest', 's5-gql']) {
      const out = await CELLS[id].run(h.c, ctx);
      assert.equal(out.canonical.updated, true, id);
      const after = await h.inspect('Order', { objectId: ctx.orderId });
      assert.equal(after[0].status, MUTATION_TO, id);
      await resetOrderStatus(h.c, ctx);
      const reset = await h.inspect('Order', { objectId: ctx.orderId });
      assert.equal(reset[0].status, MUTATION_FROM, id);
      h.record({ id: `M5-${id}`, protocol: id.includes('gql') ? 'graphql' : 'rest', persona: 'alice (owner)', attempt: 'mutate + read-back + reset', status: 200, code: '—', body: 'updated:true', state: `db ${MUTATION_TO} then reset to ${MUTATION_FROM}` });
    }
  });

  await t.test('object-level only: the owner may update OTHER fields of the own row too (no field-level claim)', async () => {
    const r = await h.c.rest('PUT', `/classes/Order/${ctx.orderId}`, { session: ctx.session, body: { customerName: 'renamed by owner' } });
    assert.equal(r.status, 200);
    const after = await h.inspect('Order', { objectId: ctx.orderId });
    assert.equal(after[0].customerName, 'renamed by owner');
    await h.c.rest('PUT', `/classes/Order/${ctx.orderId}`, { session: ctx.session, body: { customerName: 'Customer 0000' } });
    h.record({ id: 'M5-object-level', protocol: 'rest', persona: 'alice (owner)', attempt: 'update a non-status field of own order', status: 200, code: '—', body: 'succeeds — the policy is OBJECT-level; field-level rules would need server-side validation (out of scope, stated in the article)', state: 'field changed and restored' });
  });

  await t.test('amendment S4: GraphQL errors on HTTP 200 are a failed run (recorder marks it)', async () => {
    const { bobOrder } = await resolveBobTargets(h.inspect, h.sizes.orders);
    const r = await h.c.gql(GQL.s5, { id: bobOrder.gid, status: MUTATION_TO }, { session: ctx.session });
    assert.equal(r.status, 200);                 // the HTTP layer says fine…
    assert.ok(r.errors && r.errors.length > 0);  // …the GraphQL layer says no
    assert.equal(r.rec.failed, true, 'the recorder must count this as a FAILED run despite HTTP 200');
    const state = await h.inspect('Order', { objectId: bobOrder.objectId });
    assert.equal(state[0].status, MUTATION_FROM);
    h.record({ id: 'M5-errors-on-200', protocol: 'graphql', persona: 'alice (non-owner)', attempt: "updateOrder on bob's order", status: 200, code: r.errors[0].extensions && r.errors[0].extensions.code, body: 'HTTP 200 + errors array → counted as FAILED run', state: `bob's order unchanged (${state[0].status})` });
  });

  await t.test('gid sanity: toGlobalId matches the API (used by the mutation shapes)', async () => {
    assert.equal(ctx.orderGid, toGlobalId('Order', ctx.orderId));
  });
});
