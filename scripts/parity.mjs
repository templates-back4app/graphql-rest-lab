// File: scripts/parity.mjs · Node 22 ESM
// Runs the P1–P10 parity matrix (scripts/lib/parity.mjs) against the target, both protocols, and writes
// docs/evidence/parity-matrix-<target>-<date>.md. Any REST-vs-GraphQL access divergence is a finding (and
// article lead); the exit code is non-zero if any EXPECTED outcome failed.
// Usage: node scripts/parity.mjs [--local|--live]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, LOCAL, target, args } from './lib/env.mjs';
import { makeTransport } from './lib/transport.mjs';
import { makeRecorder, buildContext } from './lib/shapes.mjs';
import { makeClient } from './lib/rest.mjs';
import { runParity, resolveBobTargets } from './lib/parity.mjs';
import { evidenceMd, environmentLine, targetLabel } from './lib/stats.mjs';

const a = args();
const env = target(a);
const transport = makeTransport(env);
const c = makeRecorder(transport, env);
const api = makeClient(env, { retry: env.name === 'back4app' });
const setupToken = env.SETUP_TOKEN || LOCAL.SETUP_TOKEN;
const creds = JSON.parse(readFileSync(path.join(ROOT, '.credentials.local.json'), 'utf8'));

const inspect = async (className, where) => {
  const r = await api.call('testInspect', { className, where, setupToken });
  if (!r.ok) throw new Error(`testInspect failed: ${JSON.stringify(r.error)}`);
  return r.result.results;
};

const ctx = await buildContext(c, env, { alice: creds.alice });
// Count by seedTag, not with an empty where: the Postgres adapter answers an empty-where count with an
// ANALYZE-based ESTIMATE (0 on a freshly seeded table) — observed 2026-11-03, noted in the build diary.
const configMod = await import('node:module').then((m) => m.createRequire(import.meta.url)('../cloud/config.js'));
const totalOrders = (await api.call('testInspect', { className: 'Order', where: { seedTag: configMod.SEED_TAG }, count: true, setupToken })).result.count;
const { bobOrder, bobItem } = await resolveBobTargets(inspect, totalOrders);
const rows = await runParity(c, env, { ctx, bobOrder, bobItem, inspect });
transport.close();

const esc = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md = evidenceMd('parity-matrix', env);
md.write(`# Parity matrix P1–P10 — ${targetLabel(env).toUpperCase()} run (both protocols)

${environmentLine(env)}

House rule: every row records the response BODY assertion and (where it matters) the database state read-back,
not just the status code. Refusal parity = the same caller learns the same amount both ways; P9 records the
differing status/code shapes honestly. ${targetLabel(env) === 'local' ? '**Local evidence only** — the live run of this matrix is the live phase (after Phase 0) and produces its own file.' : ''}

| # | API | Persona | Attempt | HTTP | code | Body / observation | State | Expected | OK |
|---|---|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.protocol} | ${esc(r.persona)} | ${esc(r.attempt)} | ${r.status ?? '—'} | ${r.code ?? '—'} | ${esc(r.body)} | ${esc(r.state)} | ${esc(r.expected)} | ${r.ok ? 'yes' : '**NO**'} |`).join('\n')}

Requests this matrix issued: ${c.records.length} (counted into the budget inventory).
`);
const failed = rows.filter((r) => !r.ok);
console.log(`parity: ${rows.length} rows, ${failed.length} unexpected → ${md.rel}`);
for (const f of failed) console.error(`  UNEXPECTED ${f.id} ${f.protocol}: ${f.body}`);
process.exit(failed.length ? 1 : 0);
