// File: test/setup-disabled.test.mjs — the DEFAULT deployment: SETUP_ENABLED off. Every administrative helper
// must refuse with SETUP_DISABLED even when the caller holds the correct token. Own process: the env is set
// BEFORE dev-server.mjs (whose ??= respects it) loads Cloud Code.
process.env.SETUP_ENABLED = '0';
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';

test('all four helpers answer SETUP_DISABLED while the flag is off', async (t) => {
  const h = await harness({ suite: 'setup-disabled', seed: false });
  t.after(() => h.close());
  if (h.liveSkip(t, 'the live default-deployment check is part of the live phase teardown')) return;
  for (const [name, params] of [
    ['setupSchema', { allowRerun: true }],
    ['seedData', { kind: 'audit' }],
    ['testInspect', { className: 'Product', where: {} }],
    ['testCleanup', { seedTag: 'seed-v1' }],
  ]) {
    const r = await h.api.call(name, { ...params, setupToken: h.setupToken });
    assert.equal(r.ok, false, name);
    assert.equal(r.error.code, 'SETUP_DISABLED', `${name}: ${JSON.stringify(r.error)}`);
    h.record({ id: 'G5', protocol: 'rest', persona: 'operator (correct token, flag off)', attempt: name, status: r.status, code: r.error.code, body: 'refused', state: 'nothing ran' });
  }
});
