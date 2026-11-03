// File: test/setup-tokenless.test.mjs — SETUP_ENABLED on but NO token hash configured: every administrative
// call refuses with SETUP_TOKEN_UNSET (an unset hash refuses everything; the flag alone is not enough).
process.env.SETUP_ENABLED = '1';
process.env.SETUP_TOKEN_SHA256 = '';
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';

test('helpers answer SETUP_TOKEN_UNSET while no token hash is configured', async (t) => {
  const h = await harness({ suite: 'setup-tokenless', seed: false });
  t.after(() => h.close());
  if (h.liveSkip(t, 'live gate configuration is fixed by the operator')) return;
  const r = await h.api.call('setupSchema', { allowRerun: true, setupToken: h.setupToken });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SETUP_TOKEN_UNSET', JSON.stringify(r.error));
  h.record({ id: 'G6', protocol: 'rest', persona: 'operator (flag on, no hash configured)', attempt: 'setupSchema', status: r.status, code: r.error.code, body: 'refused', state: 'nothing ran' });
});
