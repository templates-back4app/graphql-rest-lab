// File: test/measure-smoke.test.mjs — the measurement harness end to end on a tiny run: margins marker
// required, equivalence gate passed, paired alternation produced paired diffs, drift control recorded, CSVs
// and summary written (labeled local-test, gitignored), zero errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { harness } from './helpers.mjs';
import { runMeasurementSession, assertMarginsRegistered } from '../scripts/measure.mjs';
import { ROOT } from '../scripts/lib/env.mjs';

test('measurement session smoke run (m1 + m5, 1+3 runs)', async (t) => {
  const h = await harness({ suite: 'measure-smoke' });
  t.after(() => h.close());

  assertMarginsRegistered(); // throws if the diary lost its MARGINS-REGISTERED entry — Phase A entry criterion

  const summary = await runMeasurementSession({
    env: h.env, alice: h.personas.alice, inspect: h.inspect,
    runs: 3, warmups: 1, rps: 1000, only: ['m1', 'm5'], quiet: true,
    listRows: 10, deepPage: 3,
  });

  assert.equal(summary.errors, 0);
  assert.equal(summary.measurements.length, 2);
  const m1 = summary.measurements[0];
  assert.equal(m1.pairsOut[0].wall.n, 3, 'three paired diffs');
  assert.ok(['tie', 'difference', 'inconclusive'].includes(m1.pairsOut[0].wall.verdict));
  assert.equal(m1.pairsOut[0].requests.rest, 1);
  assert.equal(m1.pairsOut[0].requests.gql, 1);
  assert.ok(Number.isFinite(summary.baseline.open.p50) && Number.isFinite(summary.baseline.close.p50));
  assert.equal(typeof summary.baseline.drifted, 'boolean');

  const date = new Date().toISOString().slice(0, 10);
  for (const name of [`m1-single-object-local-test-${date}.csv`, `m5-mutation-local-test-${date}.csv`, `drift-controls-local-test-${date}.csv`]) {
    const f = path.join(ROOT, 'docs', 'evidence', name);
    assert.ok(existsSync(f), name);
    assert.ok(readFileSync(f, 'utf8').split('\n').filter(Boolean).length > 3, `${name} has rows`);
  }
  // S5 really mutated and reset: the order must be back at the FROM state after the session.
  const ctxOrder = await h.inspect('Order', { number: 'ORD-0000' });
  assert.equal(ctxOrder[0].status, 'processing');
  h.record({ id: 'M-smoke', protocol: 'both', persona: 'alice', attempt: 'tiny measurement session (m1, m5)', status: '—', code: '—', body: `verdict m1 wall: ${m1.pairsOut[0].wall.verdict}; errors 0; drift ${summary.baseline.drifted}`, state: 'CSVs + paired diffs + drift rows written (local-test label)' });
});
