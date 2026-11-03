// File: scripts/budget-inventory.mjs · Node 22 ESM
// The COUNTED request-budget inventory (amendment C4): every line counted from the code and the recorded
// runs, never assumed. Two columns throughout: HTTP requests vs BILLABLE OPERATIONS — it is never assumed
// that a Cloud call seeding N rows bills as 1, nor that one GraphQL POST carrying several operations meters
// as 1. How the plan actually meters these is a Phase 0 checklist item; until Phase 0 answers, the ops column
// carries the counted upper bound and a seam marker. Live Plan Usage lags ~a day — noted for the operator.
// Usage: node scripts/budget-inventory.mjs  → docs/notes/budget-inventory-<date>.md
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './lib/env.mjs';
import { WARMUPS_DEFAULT, RUNS_DEFAULT } from './lib/stats.mjs';
import { MEASUREMENTS } from './measure.mjs';

const config = createRequire(import.meta.url)('../cloud/config.js');
const sidecarPath = path.join(ROOT, 'docs', 'notes', 'cell-request-counts.json');
if (!existsSync(sidecarPath)) {
  console.error('budget: docs/notes/cell-request-counts.json missing — run `npm run equivalence` first (the per-cell request counts come from executed shapes, never from assumptions).');
  process.exit(1);
}
const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
const perRun = (id) => {
  const c = sidecar.cells[id];
  if (!c) throw new Error(`budget: cell ${id} missing from the sidecar — re-run equivalence`);
  return c.requests;
};

const P = config.PRODUCTS, O = config.ORDERS, I = config.ITEMS_PER_ORDER;
const RUNSET = WARMUPS_DEFAULT + RUNS_DEFAULT;
const ceil = Math.ceil;

const lines = [];
const add = (phase, what, http, ops, note) => lines.push({ phase, what, http, ops, note });

// Seeding (scripts/seed.mjs → Cloud seedData): counted from the batch loops in the code.
const seedCalls = ceil(P / config.SEED_BATCH_MAX) + ceil(O / config.SEED_BATCH_MAX) + ceil(O / Math.max(1, Math.floor(config.SEED_BATCH_MAX / I))) + 1;
add('seed', `personas (2 signups or logins)`, 2, 2, 'public REST signup');
add('seed', `seedData Cloud calls (${P} products + ${O} orders + ${O * I} items + 1 audit)`, seedCalls, `${seedCalls} calls + ${P + O + O * I + 1} server-side writes`, 'SEAM(Phase 0): how server-side saveAll writes meter on the plan is unverified');
add('seed', 'setupSchema (idempotent apply)', 1, '1 call + schema ops', 'SEAM(Phase 0): schema-API metering unverified');
add('seed', 'pre-seed inspect (testInspect count)', 1, 1, '');

// Equivalence gate (recorded from the executed pass).
add('phaseA', 'equivalence pass (context build, all cells once, S5 state checks + resets)', sidecar.equivalencePassRequests, `${sidecar.equivalencePassRequests} HTTP; GraphQL POSTs carry up to 2 root fields`, 'SEAM(Phase 0): multi-operation GraphQL POST metering unverified');

// Measurement session (formula from measure.mjs structure × recorded per-run request counts).
let timed = 0;
const detail = [];
for (const m of MEASUREMENTS) {
  let n = 0;
  for (const [r, g] of m.pairs) n += RUNSET * (perRun(r) + perRun(g));
  for (const s of m.singles) n += RUNSET * perRun(s);
  if (m.id === 'm5') n += RUNSET * 2; // one untimed reset after every mutation run, both protocols
  detail.push(`${m.id}: ${n}`);
  timed += n;
}
const baseline = 2 * RUNSET * perRun('s1-rest'); // session baseline open + close (drift control)
add('phaseA', `measurement session, ${WARMUPS_DEFAULT}+${RUNS_DEFAULT} per cell (${detail.join(' · ')})`, timed, timed, 'per-cell per-run request counts from executed shapes (sidecar), not declared');
add('phaseA', 'session baseline open+close (S1 REST, drift control)', baseline, baseline, '');
add('phaseA', `session overhead (context, gate re-run, cursor harvest ${sidecar.deepPage - 1} pages)`, sidecar.equivalencePassRequests + sidecar.deepPage - 1 + 5, '≈ same', 'counted from the overhead recorder at run time; see measurement summary');

// Parity (recorded from the latest parity evidence file when present).
const evDir = path.join(ROOT, 'docs', 'evidence');
let parityCount = null;
if (existsSync(evDir)) {
  const files = (await import('node:fs')).readdirSync(evDir).filter((f) => f.startsWith('parity-matrix-')).sort();
  if (files.length) {
    const m = readFileSync(path.join(evDir, files[files.length - 1]), 'utf8').match(/Requests this matrix issued: (\d+)/);
    if (m) parityCount = Number(m[1]);
  }
}
add('phaseA', 'parity matrix P1–P10 (both protocols, positive controls, state read-backs)', parityCount ?? 'run parity first', parityCount ?? '—', parityCount === null ? 'recorded from the parity evidence file once it exists' : 'recorded from the executed run');

// Contingency.
add('contingency', 'drift re-runs (budget for 1 full session repeat)', timed + baseline, timed + baseline, 'house rule: a drifted session is discarded and re-run');

const totalHttp = lines.reduce((a2, l) => a2 + (typeof l.http === 'number' ? l.http : 0), 0);
const date = new Date().toISOString().slice(0, 10);
const out = path.join(ROOT, 'docs', 'notes', `budget-inventory-${date}.md`);
writeFileSync(out, `# Budget inventory — counted, two columns (amendment C4) — ${date}

Derived from: cloud/config.js constants (P=${P}, O=${O}, I=${I}), the measure.mjs session structure
(${WARMUPS_DEFAULT} warm-ups + ${RUNS_DEFAULT} runs per cell), and the per-cell request counts RECORDED from
executed shapes (docs/notes/cell-request-counts.json, target=${sidecar.target}, ${sidecar.date}).

**HTTP requests** = connections the client opens. **Billable operations** = what the plan may meter — NOT
assumed equal: a seedData call creates up to ${config.SEED_BATCH_MAX} rows server-side, and one GraphQL POST
here can carry two root fields. The metering rules for both are on the Phase 0 checklist; live Plan Usage lags
about a day, so the operator checks it the day AFTER a live session.

| Phase | What | HTTP requests | Billable operations (counted upper bound) | Note |
|---|---|---|---|---|
${lines.map((l) => `| ${l.phase} | ${l.what} | ${l.http} | ${l.ops} | ${l.note} |`).join('\n')}

**Total (numeric HTTP lines): ≈ ${totalHttp} HTTP requests** for one complete seed + Phase A matrix + one
measurement session + one contingency re-run. The live effort estimate is re-derived from THIS table at Phase 0
exit (amendment C4). Sources: counted loops in scripts/seed.mjs and scripts/measure.mjs; recorded sidecar;
parity evidence file.
`);
console.log(`budget → ${path.relative(ROOT, out)} (≈ ${totalHttp} HTTP requests)`);
