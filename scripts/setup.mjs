// File: scripts/setup.mjs · Node 22 ESM
// Creates or updates the classes, class-level permissions and indexes. Idempotent: run it again after editing
// the schema in cloud/config.js. Two paths, same definition:
//   - MASTER_KEY available (the LOCAL dev server, whose fixed keys include one): schema REST API directly.
//   - no MASTER_KEY (Back4app, where the key stays in the dashboard): calls the Cloud function setupSchema
//     with the REST/JS key + the administrative setup token; Cloud Code must be deployed first and the gate
//     (SETUP_ENABLED + SETUP_TOKEN_SHA256) configured on the backend. LIVE RUNS ARE THE COORDINATOR'S STEP.
// Usage: npm run setup [-- --local] [-- --live] [-- --allow-rerun]
import { createRequire } from 'node:module';
import { target, args } from './lib/env.mjs';
import { makeClient } from './lib/rest.mjs';

const config = createRequire(import.meta.url)('../cloud/config.js');

export async function applySchema(targetEnv) {
  const client = makeClient(targetEnv, { retry: true });
  for (const def of config.SCHEMA) {
    const existing = await client.request('GET', `/schemas/${def.className}`, { master: true });
    if (existing.status === 200) {
      const have = existing.json;
      const newFields = {};
      for (const [name, spec] of Object.entries(def.fields)) if (!have.fields || !have.fields[name]) newFields[name] = spec;
      const haveIdx = have.indexes || {};
      const newIndexes = {};
      for (const [name, key] of Object.entries(def.indexes || {})) if (!haveIdx[name]) newIndexes[name] = key;
      const body = { className: def.className, fields: newFields, classLevelPermissions: def.classLevelPermissions };
      if (Object.keys(newIndexes).length) body.indexes = newIndexes;
      const r = await client.request('PUT', `/schemas/${def.className}`, { master: true, body });
      if (r.status !== 200) throw new Error(`schema ${def.className}: update failed ${r.status} ${JSON.stringify(r.json)}`);
    } else if (existing.status === 400 && existing.json && existing.json.code === 103) {
      const body = { className: def.className, fields: def.fields, classLevelPermissions: def.classLevelPermissions, indexes: def.indexes };
      const r = await client.request('POST', `/schemas/${def.className}`, { master: true, body });
      if (r.status !== 200 && r.status !== 201) throw new Error(`schema ${def.className}: create failed ${r.status} ${JSON.stringify(r.json)}`);
    } else {
      throw new Error(`schema ${def.className}: GET failed ${existing.status} ${JSON.stringify(existing.json)}`);
    }
  }
}

// The CLI part only runs when invoked directly (the tests import applySchema without side effects).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const env = target(a);
  const api = makeClient(env, { retry: true });
  let failures = 0;

  if (env.MASTER_KEY) {
    await applySchema(env);
    for (const def of config.SCHEMA) {
      const r = await api.request('GET', `/schemas/${def.className}`, { master: true });
      console.log(`schema ${def.className}: ok (${Object.keys((r.json && r.json.fields) || {}).length} fields, indexes: ${Object.keys((r.json && r.json.indexes) || {}).join(', ') || 'none'})`);
    }
  } else {
    console.log(`no MASTER_KEY — applying the schema through the Cloud function setupSchema at ${env.SERVER_URL}`);
    if (!env.SETUP_TOKEN) { console.error('SETUP_TOKEN missing (the raw administrative token; .env.live) — setupSchema will refuse without it.'); process.exit(1); }
    const r = await api.call('setupSchema', { allowRerun: !!a['allow-rerun'], setupToken: env.SETUP_TOKEN });
    if (!r.ok) {
      failures++;
      console.error(`setupSchema failed: HTTP ${r.status} ${JSON.stringify(r.error)}`);
      if (r.error.code === 'SETUP_DISABLED') console.error('SETUP_ENABLED is off on that backend (Cloud Code environment or cloud/config.js fallback).');
      if (r.error.code === 'SETUP_TOKEN_UNSET') console.error('No SETUP_TOKEN_SHA256 configured on that backend.');
      if (r.error.code === 'SETUP_TOKEN_INVALID') console.error('The SETUP_TOKEN does not match the configured hash.');
      if (/Invalid function/.test(r.error.message || '')) console.error('Cloud Code is not deployed — upload cloud/main.js, cloud/config.js, cloud/guards.js and Deploy; prove it with a request, never the dialog (house rule).');
    } else {
      for (const c of r.result.classes) console.log(`schema ${c.className}: ${c.action} (${c.newFields.length} new field(s), ${c.newIndexes.length} new index(es))`);
    }
  }
  process.exit(failures ? 1 : 0);
}
