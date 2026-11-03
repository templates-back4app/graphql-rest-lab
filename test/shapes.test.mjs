// File: test/shapes.test.mjs — the fixed screen shapes (amendment S1): every scenario's REST and GraphQL
// responses, normalized, diff EMPTY; request counts are DERIVED from executed code and recorded as evidence
// rows, never declared. Small dataset (35 products, 3 orders × 20 items; listRows 10, deepPage 3): the
// mechanics are size-independent, the published 1,000-row figures come from the measurement runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, config } from './helpers.mjs';
import { runEquivalence } from '../scripts/equivalence.mjs';
import { CELLS, totals } from '../scripts/lib/shapes.mjs';

test('S1–S5 equivalence + derived request counts', async (t) => {
  const h = await harness({ suite: 'shapes' });
  t.after(() => h.close());
  const ctx = await h.buildCtx();

  const { ok, screens, cells } = await runEquivalence(h.c, ctx, { inspect: h.inspect });
  assert.equal(ok, true, JSON.stringify(screens.filter((s) => s.diffs.length), null, 2));
  for (const s of screens) {
    h.record({ id: `S-${s.screen.replace(/\s+/g, '')}`, protocol: 'both', persona: 'alice', attempt: `equivalence diff vs ${s.reference}`, status: '—', code: '—', body: s.diffs.length === 0 ? 'diff empty' : 'DIFFS', state: s.compared.join(', ') });
  }

  await t.test('request counts come from execution: naive = 2 + one per item line', () => {
    const items = cells['s2-gql'].canonical.items.length; // what the screen actually DRAWS (capped at listRows)
    assert.equal(items, Math.min(config.ITEMS_PER_ORDER, ctx.listRows));
    assert.equal(cells['s2-gql'].canonical.count, config.ITEMS_PER_ORDER); // the count is the full child count
    assert.equal(cells['s2-rest-naive'].requests, 2 + items);
    assert.equal(cells['s2-rest-include2'].requests, 2);
    assert.equal(cells['s2-rest-include1'].requests, 1);
    assert.equal(cells['s2-gql'].requests, 1);
    h.record({ id: 'S-counts', protocol: 'both', persona: 'alice', attempt: 'S2 request counts derived from runs', status: '—', code: '—', body: `naive=${cells['s2-rest-naive'].requests} include2=2 include1=1 gql=1 (items=${items})`, state: 'counts recorded, not declared' });
  });

  await t.test('S2 GraphQL is one HTTP POST carrying two root fields (no reverse connection assumed)', async () => {
    const before = h.c.records.length;
    await CELLS['s2-gql'].run(h.c, ctx);
    const recs = h.c.records.slice(before);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].protocol, 'graphql');
    assert.equal(totals(recs).failed, false);
  });

  await t.test('byte accounting: wire totals are socket-attested and ≥ headers+body both directions', () => {
    for (const [id, cell] of Object.entries(cells)) {
      const tt = cell.totals;
      assert.equal(tt.wireAttested, true, id);
      assert.ok(tt.wireUp >= tt.reqHeaderBytes + tt.reqBodyBytes, `${id}: wireUp ${tt.wireUp} < ${tt.reqHeaderBytes + tt.reqBodyBytes}`);
      assert.ok(tt.wireDown >= tt.respHeaderBytes + tt.respBodyBytes, `${id}: wireDown`);
    }
  });
});
