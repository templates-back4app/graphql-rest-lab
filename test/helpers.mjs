// File: test/helpers.mjs · shared by the node:test suites. Raw REST + raw GraphQL over the instrumented
// transport — no SDK: every matrix row records exactly what crossed the network.
//
// Target: an in-process parse-server (scripts/dev-server.mjs) on a free port with the database
// postgres://localhost:5433/gql_test, purged at the start of every suite file, GraphQL mounted at /graphql.
// For the LIVE run (the coordinator does this, later — nothing in Phase A calls any remote backend):
//
//   TEST_SERVER_URL=https://parseapi.back4app.com GRAPHQL_URL=https://parseapi.back4app.com/graphql npm test
//
// which loads the keys from .env.live (APP_ID, JS_KEY, REST_KEY, SETUP_TOKEN — never the master key), uses the
// token-gated Cloud helpers instead of master-key REST, and SKIPS, with a printed reason, the parts that need
// direct master/database access. Every object a run creates carries the per-execution zz… RUN prefix in its
// usernames, so parallel or crashed runs never collide and testCleanup can only ever sweep its own run.
import { createServer } from 'node:net';
import crypto from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LOCAL, ROOT, loadDotEnv } from '../scripts/lib/env.mjs';
import { makeClient, parseCloudError } from '../scripts/lib/rest.mjs';
import { applySchema } from '../scripts/setup.mjs';
import { seedAll } from '../scripts/seed.mjs';
import { makeTransport } from '../scripts/lib/transport.mjs';
import { makeRecorder, buildContext } from '../scripts/lib/shapes.mjs';

export { parseCloudError };
export const config = createRequire(import.meta.url)('../cloud/config.js');
export const RUN = 'zz' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
export const unique = (prefix) => `${RUN}_${prefix}_${crypto.randomBytes(3).toString('hex')}`;
export const password = () => 'Pw-' + crypto.randomBytes(9).toString('base64url');

export const TARGET = !process.env.TEST_SERVER_URL ? 'local'
  : /back4app\.com/.test(process.env.TEST_SERVER_URL) ? 'back4app' : 'remote-rehearsal';
const ROWS_FILE = path.join(ROOT, 'docs', 'evidence', `.rows-${TARGET}.jsonl`);

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer(); s.unref();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Starts (or attaches to) the server, applies the schema, purges (local) and seeds a SMALL dataset. */
export async function harness({ suite, products = 35, orders = 3, seed = true } = {}) {
  let env; let handle = null; let isLocal = true;
  if (process.env.TEST_SERVER_URL) {
    isLocal = false;
    loadDotEnv(path.join(ROOT, '.env.live'));
    loadDotEnv();
    env = {
      name: TARGET,
      APP_ID: process.env.APP_ID, JS_KEY: process.env.JS_KEY || '', REST_KEY: process.env.REST_KEY || '',
      MASTER_KEY: process.env.MASTER_KEY || '', SETUP_TOKEN: process.env.SETUP_TOKEN || '',
      SERVER_URL: process.env.TEST_SERVER_URL.replace(/\/+$/, ''),
      GRAPHQL_URL: (process.env.GRAPHQL_URL || process.env.TEST_SERVER_URL.replace(/\/+$/, '').replace(/\/parse$/, '') + '/graphql'),
    };
    if (!env.APP_ID) throw new Error('TEST_SERVER_URL is set but APP_ID is missing — fill .env.live first.');
    if (!env.SETUP_TOKEN) throw new Error('live run needs SETUP_TOKEN in .env.live (the raw administrative token).');
  } else {
    loadDotEnv();
    const { startServer } = await import('../scripts/dev-server.mjs');
    const port = await freePort();
    handle = await startServer({ port, databaseURI: process.env.TEST_DATABASE_URL || 'postgres://localhost:5433/gql_test', quiet: true });
    env = { ...LOCAL, name: 'local-test', SERVER_URL: handle.url, GRAPHQL_URL: handle.graphqlUrl };
  }
  const api = makeClient(env, { retry: !isLocal });
  const canMaster = !!env.MASTER_KEY;
  const setupToken = env.SETUP_TOKEN || LOCAL.SETUP_TOKEN;

  if (canMaster) {
    await applySchema(env);
  } else {
    const setup = await api.call('setupSchema', { allowRerun: true, setupToken });
    if (!setup.ok) throw new Error(`setupSchema failed: ${JSON.stringify(setup.error)}`);
  }
  if (isLocal) {
    for (const cls of ['OrderItem', 'Order', 'Product', 'AuditLog', '_Session', '_User']) {
      await api.request('DELETE', `/purge/${cls}`, { master: true });
    }
  }

  let seeded = null; let personas = null;
  if (seed) {
    personas = {
      alice: { username: unique('alice'), password: password() },
      bob: { username: unique('bob'), password: password() },
    };
    seeded = await seedAll(api, env, { products, orders, personas });
  }

  const transport = makeTransport(env);
  const c = makeRecorder(transport, env);

  const h = {
    env, api, isLocal, canMaster, setupToken, c, transport, seeded, personas,
    suite: suite || 'suite', sizes: { products, orders },

    /** State read-back: master key locally, the gated testInspect live — same contract either way. */
    async inspect(className, where) {
      const r = await api.call('testInspect', { className, where, setupToken });
      if (!r.ok) throw new Error(`testInspect failed: ${JSON.stringify(r.error)}`);
      return r.result.results;
    },

    async buildCtx({ listRows = 10, deepPage = 3 } = {}) {
      return buildContext(c, env, { alice: personas.alice, listRows, deepPage });
    },

    liveSkip(t, reason) {
      if (canMaster) return false;
      t.skip(`live run: ${reason}`);
      return true;
    },

    /** One evidence-matrix row (id sorts the table: G1, P2a, S3, …). */
    record(row) {
      mkdirSync(path.dirname(ROWS_FILE), { recursive: true });
      appendFileSync(ROWS_FILE, JSON.stringify({ suite: h.suite, at: new Date().toISOString(), ...row }) + '\n');
    },

    async close() {
      transport.close();
      if (!isLocal) await api.call('testCleanup', { seedTag: config.SEED_TAG, runPrefix: RUN, setupToken });
      if (handle) await handle.close();
    },
  };
  return h;
}
