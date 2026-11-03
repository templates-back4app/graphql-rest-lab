// File: test/pagination.test.mjs — amendment S3: the cursor's implementation is VERIFIED (decoded), the deep
// page is reached by known-cursor AND cumulatively, all mechanisms land on the same rows, and the stable sort
// uses the objectId tie-breaker on duplicate skus (checked with a deliberately duplicated pair).
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { CELLS, GQL, harvestDeepCursor, decodeCursor } from '../scripts/lib/shapes.mjs';

test('S4 pagination mechanics', async (t) => {
  const h = await harness({ suite: 'pagination' });
  t.after(() => h.close());
  const ctx = await h.buildCtx({ listRows: 10, deepPage: 3 });

  const harvest = await harvestDeepCursor(h.c, ctx);

  await t.test('cursor decodes to graphql-relay arrayconnection:<offset> (offset-encoded, not keyset)', () => {
    const d = decodeCursor(harvest.deepCursor);
    assert.match(d.kind, /^offset-encoded/);
    assert.equal(d.offset, ctx.listRows * (ctx.deepPage - 1) - 1); // last row BEFORE the deep page
    h.record({ id: 'C1', protocol: 'graphql', persona: 'alice', attempt: 'decode endCursor', status: '—', code: '—', body: `${d.decoded} → ${d.kind}`, state: `offset=${d.offset}` });
  });

  await t.test('known-cursor, known-offset and both cumulative paths land on the same rows', async () => {
    const offset = (await CELLS['s4-rest-deep-offset'].run(h.c, ctx)).canonical;
    const cursor = (await CELLS['s4-gql-deep-cursor'].run(h.c, ctx)).canonical;
    const cumR = (await CELLS['s4-rest-deep-cumulative'].run(h.c, ctx)).canonical;
    const cumG = (await CELLS['s4-gql-deep-cumulative'].run(h.c, ctx)).canonical;
    assert.equal(offset.length, ctx.listRows);
    assert.deepEqual(cursor, offset);
    assert.deepEqual(cumR, offset);
    assert.deepEqual(cumG, offset);
    h.record({ id: 'C2', protocol: 'both', persona: 'alice', attempt: 'deep page: known cursor/offset vs cumulative', status: '—', code: '—', body: `4 mechanisms, identical ${offset.length} rows`, state: 'reported separately in M4' });
  });

  await t.test('request counts: known = 1, cumulative = deepPage (derived, not declared)', async () => {
    for (const [id, expected] of [['s4-rest-deep-offset', 1], ['s4-gql-deep-cursor', 1], ['s4-rest-deep-cumulative', ctx.deepPage], ['s4-gql-deep-cumulative', ctx.deepPage]]) {
      const before = h.c.records.length;
      await CELLS[id].run(h.c, ctx);
      assert.equal(h.c.records.length - before, expected, id);
    }
  });

  await t.test('stable sort: objectId tie-breaker orders duplicate skus identically on both protocols', async (tt) => {
    if (h.liveSkip(tt, 'needs master-key writes to plant duplicate-sku rows')) return;
    const dup = [];
    for (let i = 0; i < 2; i++) {
      const r = await h.api.request('POST', '/classes/Product', { master: true, body: { name: `dup ${i}`, sku: 'ZZ-DUP', priceCents: 1, seedTag: 'zzdup' } });
      assert.equal(r.status, 201);
      dup.push(r.json.objectId);
    }
    const rest = await h.c.rest('GET', `/classes/Product?where=${encodeURIComponent(JSON.stringify({ sku: 'ZZ-DUP' }))}&order=sku,objectId&keys=sku`, { session: ctx.session });
    const gql = await h.c.gql('query { products(where: { sku: { equalTo: "ZZ-DUP" } }, order: [sku_ASC, objectId_ASC]) { edges { node { objectId } } } }', {}, { session: ctx.session });
    const restIds = rest.json.results.map((r) => r.objectId);
    const gqlIds = gql.data.products.edges.map((e) => e.node.objectId);
    assert.deepEqual(restIds, [...dup].sort());
    assert.deepEqual(gqlIds, restIds);
    for (const id of dup) await h.api.request('DELETE', `/classes/Product/${id}`, { master: true });
    h.record({ id: 'C3', protocol: 'both', persona: 'alice', attempt: 'duplicate sku, order=sku,objectId', status: '—', code: '—', body: 'identical row order both ways', state: 'tie-breaker effective' });
  });
});
