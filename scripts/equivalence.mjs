// File: scripts/equivalence.mjs · Node 22 ESM
// The equivalence gate (brief §4.3): for every screen, both protocols' responses are normalized to the
// canonical screen data and DIFFED; a scenario may be timed only after its diff is empty. This script writes
// the diff evidence (docs/evidence/equivalence-diffs-<target>-<date>.md) AND the per-cell request-count /
// byte inventory the budget and the article quote (docs/notes/cell-request-counts.json) — counts derived
// from executing the fixed shapes in scripts/lib/shapes.mjs, never declared (amendment S1).
// Usage: node scripts/equivalence.mjs [--local|--live] — exported as runEquivalence() for measure.mjs (the
// timing gate) and the tests.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, LOCAL, target, args } from './lib/env.mjs';
import { makeTransport } from './lib/transport.mjs';
import { makeRecorder, buildContext, harvestDeepCursor, decodeCursor, resetOrderStatus, totals, CELLS, MUTATION_TO, MUTATION_FROM } from './lib/shapes.mjs';
import { makeClient } from './lib/rest.mjs';
import { evidenceMd, environmentLine, targetLabel } from './lib/stats.mjs';

const stable = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val))
  ? Object.fromEntries(Object.keys(val).sort().map((kk) => [kk, val[kk]])) : val, 2);

/** First structural difference between two canonical values, or null when equal. */
export function firstDiff(a, b, p = '$') {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== typeof b) return { path: p, a, b };
  if (typeof a !== 'object') return Object.is(a, b) ? null : { path: p, a, b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path: p, a: typeof a, b: typeof b };
  if (Array.isArray(a)) {
    if (a.length !== b.length) return { path: `${p}.length`, a: a.length, b: b.length };
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { const d = firstDiff(a[k], b[k], `${p}.${k}`); if (d) return d; }
  return null;
}

/**
 * runEquivalence(c, ctx, { inspect }) → { ok, screens, cells }
 *   c: a shapes recorder. inspect(className, where) → rows (state read-backs for S5; master locally,
 *   testInspect live). Every screen's cells are executed once; canonicals diffed against the screen's GraphQL
 *   cell; S5 is checked on database STATE (mutation applied, then reset) rather than response shape.
 */
export async function runEquivalence(c, ctx, { inspect }) {
  const cells = {}; // id → { requests, totals, canonical }
  const run = async (id) => {
    const before = c.records.length;
    const out = await CELLS[id].run(c, ctx);
    const recs = c.records.slice(before);
    const t = totals(recs);
    if (t.failed) throw new Error(`cell ${id} had a failed request: ${JSON.stringify(recs.filter((r) => r.failed).map((r) => ({ status: r.status, gqlErrors: r.gqlErrors })))}`);
    cells[id] = { requests: t.requests, totals: t, canonical: out.canonical };
    return out;
  };

  await resetOrderStatus(c, ctx); // S2 cells read Order.status: start every equivalence pass from MUTATION_FROM
  const screens = [];

  // S1 — one object, both ways.
  await run('s1-rest'); await run('s1-gql');
  screens.push({ screen: 'S1', reference: 's1-gql', compared: ['s1-rest'], diffs: diffAgainst(cells, 's1-gql', ['s1-rest']) });

  // S2 — all REST variants must draw the same screen the GraphQL nested query draws.
  await run('s2-rest-naive'); await run('s2-rest-include2'); await run('s2-rest-include1'); await run('s2-gql');
  screens.push({ screen: 'S2', reference: 's2-gql', compared: ['s2-rest-naive', 's2-rest-include2', 's2-rest-include1'], diffs: diffAgainst(cells, 's2-gql', ['s2-rest-naive', 's2-rest-include2', 's2-rest-include1']) });

  // S3 — list, 3 fields.
  await run('s3-rest-full'); await run('s3-rest-keys'); await run('s3-gql');
  screens.push({ screen: 'S3', reference: 's3-gql', compared: ['s3-rest-full', 's3-rest-keys'], diffs: diffAgainst(cells, 's3-gql', ['s3-rest-full', 's3-rest-keys']) });

  // S4 — page 1 and the deep page, every mechanism must land on the same rows (stable sort, objectId tie-breaker).
  const harvest = await harvestDeepCursor(c, ctx);
  await run('s4-rest-page1'); await run('s4-gql-page1');
  await run('s4-rest-deep-offset'); await run('s4-gql-deep-cursor');
  await run('s4-rest-deep-cumulative'); await run('s4-gql-deep-cumulative');
  screens.push({ screen: 'S4 page 1', reference: 's4-gql-page1', compared: ['s4-rest-page1'], diffs: diffAgainst(cells, 's4-gql-page1', ['s4-rest-page1']) });
  screens.push({
    screen: 'S4 deep page', reference: 's4-gql-deep-cursor',
    compared: ['s4-rest-deep-offset', 's4-rest-deep-cumulative', 's4-gql-deep-cumulative'],
    diffs: diffAgainst(cells, 's4-gql-deep-cursor', ['s4-rest-deep-offset', 's4-rest-deep-cumulative', 's4-gql-deep-cumulative']),
    cursor: decodeCursor(harvest.deepCursor),
  });

  // S5 — state equivalence: each protocol's mutation must leave the SAME database state (status flipped),
  // verified by read-back, then reset by a real owner write so the next run is a real state change.
  const s5 = [];
  for (const id of ['s5-rest', 's5-gql']) {
    const out = await run(id);
    const rows = await inspect('Order', { objectId: ctx.orderId });
    const state = rows[0] ? rows[0].status : null;
    s5.push({ id, responseOk: !!(out.canonical && out.canonical.updated), stateAfter: state, stateOk: state === MUTATION_TO });
    await resetOrderStatus(c, ctx);
    const after = await inspect('Order', { objectId: ctx.orderId });
    if (!after[0] || after[0].status !== MUTATION_FROM) throw new Error(`S5 reset failed for ${id}`);
  }
  screens.push({ screen: 'S5', reference: 'database state', compared: ['s5-rest', 's5-gql'], diffs: s5.filter((r) => !r.responseOk || !r.stateOk).map((r) => ({ path: r.id, a: r, b: `status must be ${MUTATION_TO}` })), s5 });

  const ok = screens.every((s) => s.diffs.length === 0);
  return { ok, screens, cells };
}

function diffAgainst(cells, refId, ids) {
  const out = [];
  for (const id of ids) {
    const d = firstDiff(cells[id].canonical, cells[refId].canonical);
    if (d) out.push({ cell: id, ...d });
  }
  return out;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const env = target(a);
  const transport = makeTransport(env);
  const c = makeRecorder(transport, env);
  const api = makeClient(env, { retry: env.name === 'back4app' });
  const setupToken = env.SETUP_TOKEN || LOCAL.SETUP_TOKEN;
  const creds = JSON.parse(readFileSync(path.join(ROOT, '.credentials.local.json'), 'utf8'));
  const ctx = await buildContext(c, env, { alice: creds.alice });
  const inspect = async (className, where) => {
    const r = await api.call('testInspect', { className, where, setupToken });
    if (!r.ok) throw new Error(`testInspect failed: ${JSON.stringify(r.error)}`);
    return r.result.results;
  };

  const { ok, screens, cells } = await runEquivalence(c, ctx, { inspect });
  transport.close();

  const md = evidenceMd('equivalence-diffs', env);
  const fmt = (n) => (n == null ? '—' : String(n));
  const cellRows = Object.entries(cells).map(([id, v]) =>
    `| ${id} | ${v.requests} | ${fmt(v.totals.reqHeaderBytes)} | ${fmt(v.totals.reqBodyBytes)} | ${fmt(v.totals.respHeaderBytes)} | ${fmt(v.totals.respBodyBytes)} | ${v.totals.wireAttested ? `${v.totals.wireUp}/${v.totals.wireDown}` : 'not attested'} |`).join('\n');
  md.write(`# Equivalence diffs — ${targetLabel(env).toUpperCase()} run

${environmentLine(env, `listRows=${ctx.listRows} deepPage=${ctx.deepPage}`)}

Gate (brief §4.3): a scenario is timed only after both protocols' normalized responses diff EMPTY. Result:
**${ok ? 'ALL DIFFS EMPTY — every scenario may be timed' : 'DIFFS FOUND — the failing scenarios must not be timed'}**.

| Screen | Reference cell | Compared cells | Diff |
|---|---|---|---|
${screens.map((s) => `| ${s.screen} | ${s.reference} | ${s.compared.join(', ')} | ${s.diffs.length === 0 ? 'empty' : s.diffs.map((d) => `${d.cell || d.path}: ${d.path} ${JSON.stringify(d.a)}≠${JSON.stringify(d.b)}`).join('; ').slice(0, 300)} |`).join('\n')}

S4 cursor (amendment S3 — verified, not assumed): \`${JSON.stringify(screens.find((s) => s.cursor)?.cursor)}\`

## Per-cell request counts and bytes (derived from executing the fixed shapes — never declared)

Headers are counted per request, repeats included. "wire" figures are socket-attested transport deltas
(status line + headers + framing + body, identity encoding); body figures are decoded body bytes.

| Cell | HTTP requests | req header B | req body B | resp header B | resp body B (decoded) | wire up/down B |
|---|---|---|---|---|---|---|
${cellRows}

One equivalence pass = ${c.records.length} HTTP requests (context build and S5 resets included) — counted into the budget inventory.
`);
  // The sidecar the budget inventory derives per-cell request counts from (same numbers as the table above).
  mkdirSync(path.join(ROOT, 'docs', 'notes'), { recursive: true });
  writeFileSync(path.join(ROOT, 'docs', 'notes', 'cell-request-counts.json'), stable({
    target: targetLabel(env), date: new Date().toISOString(), listRows: ctx.listRows, deepPage: ctx.deepPage,
    equivalencePassRequests: c.records.length,
    cells: Object.fromEntries(Object.entries(cells).map(([id, v]) => [id, { requests: v.requests, respBodyBytes: v.totals.respBodyBytes, wireUp: v.totals.wireUp, wireDown: v.totals.wireDown }])),
  }) + '\n');
  console.log(`${ok ? 'equivalence: all diffs empty' : 'equivalence: DIFFS FOUND'} → ${md.rel} (+ docs/notes/cell-request-counts.json)`);
  process.exit(ok ? 0 : 1);
}
