// File: test/guards.test.mjs — the GUARDS registry (mechanical backstop) and the setup gate's token half on a
// RUNNING server (enabled + correct/wrong/short token). The disabled and tokenless halves need a server whose
// environment differs and live in their own suite files (own processes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { harness, parseCloudError } from './helpers.mjs';

const { createRegistry } = createRequire(import.meta.url)('../cloud/guards.js');

test('registry: refuses unlisted functions, unknown guards, double registration, unregistered entries', () => {
  assert.throws(() => createRegistry({ x: 'nope' }), /unknown guard/);
  const reg = createRegistry({ a: 'setup', b: 'setup' });
  assert.throws(() => reg.define('zz', () => {}), /not listed in the GUARDS table/);
  reg.define('a', () => {});
  assert.throws(() => reg.define('a', () => {}), /registered twice/);
  assert.throws(() => reg.assertAllRegistered(), /never registered: b/);
  reg.define('b', () => {});
  reg.assertAllRegistered();
});

test('setup gate on a running (enabled) server', async (t) => {
  const h = await harness({ suite: 'guards', seed: false });
  t.after(() => h.close());

  await t.test('G1 wrong token → SETUP_TOKEN_INVALID, nothing happens', async () => {
    const r = await h.api.call('testInspect', { className: 'Product', where: {}, setupToken: 'wrong-token-wrong-token' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'SETUP_TOKEN_INVALID');
    h.record({ id: 'G1', protocol: 'rest', persona: 'operator (wrong token)', attempt: 'testInspect', status: r.status, code: r.error.code, body: 'refused', state: 'no read performed' });
  });

  await t.test('G2 short/missing token → SETUP_TOKEN_INVALID', async () => {
    const r = await h.api.call('testInspect', { className: 'Product', where: {} });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'SETUP_TOKEN_INVALID');
    h.record({ id: 'G2', protocol: 'rest', persona: 'operator (no token)', attempt: 'testInspect', status: r.status, code: r.error.code, body: 'refused', state: '—' });
  });

  await t.test('G3 correct token → the helper answers', async () => {
    const r = await h.api.call('testInspect', { className: 'Product', where: {}, setupToken: h.setupToken });
    assert.equal(r.ok, true, JSON.stringify(r));
    h.record({ id: 'G3', protocol: 'rest', persona: 'operator (correct token)', attempt: 'testInspect', status: 200, code: '—', body: `results array (${r.result.results.length})`, state: 'read-only' });
  });

  await t.test('G4 testCleanup refuses an unprefixed runPrefix (cannot sweep foreign users)', async () => {
    const r = await h.api.call('testCleanup', { runPrefix: 'alice', setupToken: h.setupToken });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'INVALID_ARGS');
    h.record({ id: 'G4', protocol: 'rest', persona: 'operator', attempt: 'testCleanup runPrefix=alice', status: r.status, code: r.error.code, body: 'refused: prefix must be zz…', state: 'no deletes' });
  });
});
