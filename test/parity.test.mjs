// File: test/parity.test.mjs — the P1–P10 parity matrix, both protocols, with positive controls and state
// read-backs. Every expected outcome must hold; P8/P9 are recorded observations (always "ok").
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { runParity, resolveBobTargets } from '../scripts/lib/parity.mjs';

test('parity matrix P1–P10 holds on both protocols', async (t) => {
  const h = await harness({ suite: 'parity' });
  t.after(() => h.close());
  const ctx = await h.buildCtx();
  const { bobOrder, bobItem } = await resolveBobTargets(h.inspect, h.sizes.orders);
  const rows = await runParity(h.c, h.env, { ctx, bobOrder, bobItem, inspect: h.inspect });
  for (const r of rows) {
    h.record({ id: r.id, protocol: r.protocol, persona: r.persona, attempt: r.attempt, status: r.status, code: r.code, body: r.body, state: r.state });
  }
  const failed = rows.filter((r) => !r.ok);
  assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
  // The leak assertion is the point of P3/P4: no response body carried bob's field values.
  assert.ok(rows.filter((r) => r.leak === false || r.leak === null).length === rows.length);
});
