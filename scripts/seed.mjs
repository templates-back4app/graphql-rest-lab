// File: scripts/seed.mjs · Node 22 ESM
// Seeds the deterministic ACME dataset (cloud/config.js generators — the SAME code the Cloud function runs,
// so local and live datasets are byte-identical in field values): PRODUCTS products, ORDERS orders ×
// ITEMS_PER_ORDER items, 1 AuditLog row. All data writes go through the setup-gated Cloud function seedData —
// also locally — so the live path is proven before any live run. Personas (alice = the measuring owner,
// bob = the other user owning the ONE foreign order) sign up through the public REST signup; their generated
// passwords land in .credentials.local.json (gitignored) and are never printed.
// Usage: npm run seed [-- --local|--live] [-- --products N --orders N] [-- --force]
//   --force: testCleanup the previous seed (by seedTag) first. House rule: never against a backend you did
//   not create for this purpose.
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, LOCAL, target, args } from './lib/env.mjs';
import { makeClient } from './lib/rest.mjs';

const config = createRequire(import.meta.url)('../cloud/config.js');
const CRED_FILE = path.join(ROOT, '.credentials.local.json');

export function loadCredentials() {
  return existsSync(CRED_FILE) ? JSON.parse(readFileSync(CRED_FILE, 'utf8')) : {};
}

/** Test-suite path: sign `{username,password}` up (or in), never touching the credentials file. */
export async function signUpOrIn(api, { username, password }) {
  const r = await api.request('POST', '/users', { body: { username, password, email: `${username}@example.test` } });
  if (r.status === 201) return { username, password, objectId: r.json.objectId, token: r.json.sessionToken };
  const login = await api.request('POST', '/login', { body: { username, password } });
  if (login.status !== 200) throw new Error(`signUpOrIn ${username}: signup ${r.status}, login ${login.status}`);
  return { username, password, objectId: login.json.objectId, token: login.json.sessionToken };
}

/** Sign the persona in, or sign it up if it does not exist yet. Returns {username, objectId, token}. */
export async function ensurePersona(api, creds, name, username) {
  const have = creds[name];
  if (have && have.username === username) {
    const login = await api.request('POST', '/login', { body: { username, password: have.password } });
    if (login.status === 200) return { username, objectId: login.json.objectId, token: login.json.sessionToken };
  }
  const password = 'Pw-' + crypto.randomBytes(12).toString('base64url');
  const r = await api.request('POST', '/users', { body: { username, password, email: `${username}@example.test` } });
  if (r.status !== 201) throw new Error(`signup ${username} failed: ${r.status} ${JSON.stringify(r.json)} — if the user pre-exists with a lost password, clean it up first`);
  creds[name] = { username, password };
  writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2) + '\n');
  return { username, objectId: r.json.objectId, token: r.json.sessionToken };
}

/** Seeds everything through the gated Cloud function. Returns counts. Exported for the tests, which pass
 *  their own run-prefixed `personas` so the dev credentials file is never touched. */
export async function seedAll(api, env, { products, orders, personas } = {}) {
  const P = products ?? config.PRODUCTS;
  const O = orders ?? config.ORDERS;
  const setupToken = env.SETUP_TOKEN || LOCAL.SETUP_TOKEN;
  let alice; let bob;
  if (personas) {
    alice = await signUpOrIn(api, personas.alice);
    bob = await signUpOrIn(api, personas.bob);
  } else {
    const creds = loadCredentials();
    alice = await ensurePersona(api, creds, 'alice', 'alice_gql_lab');
    bob = await ensurePersona(api, creds, 'bob', 'bob_gql_lab');
  }

  const call = async (params) => {
    const r = await api.call('seedData', { ...params, setupToken });
    if (!r.ok) throw new Error(`seedData ${params.kind} failed: HTTP ${r.status} ${JSON.stringify(r.error)}`);
    return r.result;
  };

  const productIds = [];
  for (let from = 0; from < P; from += config.SEED_BATCH_MAX) {
    const count = Math.min(config.SEED_BATCH_MAX, P - from);
    productIds.push(...(await call({ kind: 'products', from, count })).ids);
  }

  const orderIds = [];
  for (let from = 0; from < O; from += config.SEED_BATCH_MAX) {
    const count = Math.min(config.SEED_BATCH_MAX, O - from);
    orderIds.push(...(await call({ kind: 'orders', from, count, total: O, ownerId: alice.objectId, otherOwnerId: bob.objectId })).ids);
  }

  // Items multiply by ITEMS_PER_ORDER per order: keep each Cloud call's row count under SEED_BATCH_MAX.
  const ordersPerCall = Math.max(1, Math.floor(config.SEED_BATCH_MAX / config.ITEMS_PER_ORDER));
  let items = 0;
  for (let from = 0; from < O; from += ordersPerCall) {
    const count = Math.min(ordersPerCall, O - from);
    items += (await call({ kind: 'items', from, count, orderIds: orderIds.slice(from, from + count), productIds })).created;
  }

  await call({ kind: 'audit' });
  return { products: productIds.length, orders: orderIds.length, items, audit: 1, alice, bob };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const env = target(a);
  const api = makeClient(env, { retry: env.name === 'back4app' });
  const setupToken = env.SETUP_TOKEN || LOCAL.SETUP_TOKEN;
  const t0 = performance.now();

  const existing = await api.call('testInspect', { className: 'Product', where: { seedTag: config.SEED_TAG }, count: true, setupToken });
  if (!existing.ok) { console.error(`testInspect failed: ${JSON.stringify(existing.error)} — is the server up and the gate configured?`); process.exit(1); }
  if (existing.result.count > 0) {
    if (!a.force) { console.error(`already seeded (${existing.result.count} products with seedTag ${config.SEED_TAG}); pass --force to wipe and reseed.`); process.exit(1); }
    const wiped = await api.call('testCleanup', { seedTag: config.SEED_TAG, setupToken });
    if (!wiped.ok) { console.error(`testCleanup failed: ${JSON.stringify(wiped.error)}`); process.exit(1); }
    console.log(`wiped previous seed: ${JSON.stringify(wiped.result)}`);
  }

  const sizes = { products: a.products ? Number(a.products) : undefined, orders: a.orders ? Number(a.orders) : undefined };
  const out = await seedAll(api, env, sizes);
  console.log(`seeded ${out.products} products, ${out.orders} orders, ${out.items} order items, ${out.audit} audit row in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log('personas alice_gql_lab / bob_gql_lab ready; passwords in .credentials.local.json (never print them)');
}
