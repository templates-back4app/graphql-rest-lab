// File: scripts/measure.mjs · Node 22 ESM
// The measurement harness, M1–M5, under the house protocol + the amendments:
//   · 20 warm-ups discarded, 100 timed runs per cell, p50/p95, error count per cell, token-bucket pacing
//     BETWEEN runs (never inside a cell: a screen fetch is one user action), raw per-run CSVs in docs/evidence/.
//   · PAIRED DESIGN (C1): REST and GraphQL alternate run by run on the same shape; verdicts are judged on the
//     per-run paired differences against the PRE-REGISTERED margins (scripts/lib/margins.mjs) — this script
//     REFUSES to run until the build diary carries the dated MARGINS-REGISTERED entry.
//   · The session measures its OWN baseline (the S1 REST shape) at open and re-runs it at close as the drift
//     control; every latency verdict quotes that baseline, never a prior lab's number.
//   · Equivalence gate: the full diff (scripts/equivalence.mjs) runs first; any non-empty diff aborts.
//   · S5 resets the mutated state after EVERY timed run (real owner write, untimed, counted separately).
//   · A GraphQL `errors` array / missing data / non-2xx is a FAILED run even on HTTP 200: excluded from the
//     stats, counted in the cell's error column, and the session exits non-zero.
//   · Optimized-vs-optimized only (S5 amendment): the naive 1+N and full-row cells are measured and shown as
//     the anti-pattern both protocols are compared against, but no REST-vs-GraphQL verdict uses them.
// Usage: node scripts/measure.mjs [--local|--live] [--runs 100] [--warmups 20] [--rps N] [--only m1,m3]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, LOCAL, target, args } from './lib/env.mjs';
import { makeTransport } from './lib/transport.mjs';
import { makeRecorder, buildContext, harvestDeepCursor, resetOrderStatus, totals, CELLS } from './lib/shapes.mjs';
import { makeClient } from './lib/rest.mjs';
import { runEquivalence } from './equivalence.mjs';
import { csvFile, evidenceMd, environmentLine, stats, tokenBucket, targetLabel, WARMUPS_DEFAULT, RUNS_DEFAULT, POLITE_RPS } from './lib/stats.mjs';
import { wallMarginMs, byteMargin, verdict, drifted, MARGINS, DRIFT } from './lib/margins.mjs';

export const MEASUREMENTS = [
  { id: 'm1', name: 'single-object', screen: 'S1', pairs: [['s1-rest', 's1-gql']], singles: [] },
  { id: 'm2', name: 'nested-screen', screen: 'S2', pairs: [['s2-rest-include1', 's2-gql']], singles: ['s2-rest-naive', 's2-rest-include2'] },
  { id: 'm3', name: 'field-selection', screen: 'S3', pairs: [['s3-rest-keys', 's3-gql']], singles: ['s3-rest-full'] },
  { id: 'm4', name: 'pagination', screen: 'S4', pairs: [['s4-rest-page1', 's4-gql-page1'], ['s4-rest-deep-offset', 's4-gql-deep-cursor'], ['s4-rest-deep-cumulative', 's4-gql-deep-cumulative']], singles: [] },
  { id: 'm5', name: 'mutation', screen: 'S5', pairs: [['s5-rest', 's5-gql']], singles: [] },
];

export function assertMarginsRegistered() {
  const diary = path.join(ROOT, 'docs', 'notes', 'build-diary.md');
  if (!existsSync(diary) || !readFileSync(diary, 'utf8').includes('MARGINS-REGISTERED')) {
    throw new Error('Pre-registered equivalence margins missing: docs/notes/build-diary.md must carry the dated MARGINS-REGISTERED entry BEFORE any measurement (amendment C2). Not running.');
  }
}

/** One timed execution of a cell: wall time around the whole screen fetch, totals from its requests. */
async function timedRun(c, ctx, cellId, overhead) {
  const cell = CELLS[cellId];
  const before = c.records.length;
  const t0 = performance.now();
  let threw = null;
  try { await cell.run(c, ctx); } catch (e) { threw = e; }
  const ms = performance.now() - t0;
  const recs = c.records.slice(before);
  const t = totals(recs);
  const failed = !!threw || t.failed || recs.length === 0;
  if (cell.mutates) await resetOrderStatus(overhead, ctx); // real state change restored before the next run (untimed)
  return { ms, failed, requests: t.requests, wireUp: t.wireUp, wireDown: t.wireDown, respBodyBytes: t.respBodyBytes, reqBytes: t.reqHeaderBytes + t.reqBodyBytes, respHeaderBytes: t.respHeaderBytes, wireAttested: t.wireAttested };
}

async function pace(bucket, n) { for (let k = 0; k < n; k++) await bucket.take(); }

/** Unpaired cell: warmups discarded + runs timed. */
async function runSingle(c, ctx, overhead, cellId, { warmups, runs, bucket, onRow }) {
  const out = [];
  let lastCount = 1;
  for (let i = 0; i < warmups + runs; i++) {
    await pace(bucket, lastCount);
    const r = await timedRun(c, ctx, cellId, overhead);
    lastCount = Math.max(1, r.requests);
    if (i >= warmups) { out.push(r); onRow && onRow(cellId, i - warmups, '-', r); }
  }
  return out;
}

/** Paired cells: within each iteration both protocols run back-to-back, order ALTERNATING run by run. */
async function runPair(c, ctx, overhead, [restId, gqlId], { warmups, runs, bucket, onRow }) {
  const rest = []; const gql = []; const pairedWallDiff = [];
  let lastCount = 2;
  for (let i = 0; i < warmups + runs; i++) {
    await pace(bucket, lastCount);
    const order = i % 2 === 0 ? [restId, gqlId] : [gqlId, restId];
    const results = {};
    for (const id of order) results[id] = await timedRun(c, ctx, id, overhead);
    lastCount = Math.max(1, results[restId].requests + results[gqlId].requests);
    if (i >= warmups) {
      const k = i - warmups;
      rest.push(results[restId]); gql.push(results[gqlId]);
      onRow && onRow(restId, k, order[0] === restId ? 'first' : 'second', results[restId]);
      onRow && onRow(gqlId, k, order[0] === gqlId ? 'first' : 'second', results[gqlId]);
      if (!results[restId].failed && !results[gqlId].failed) pairedWallDiff.push(results[gqlId].ms - results[restId].ms);
    }
  }
  return { rest, gql, pairedWallDiff };
}

const okOnly = (xs, f) => xs.filter((r) => !r.failed).map(f);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export async function runMeasurementSession({ env, alice, runs = RUNS_DEFAULT, warmups = WARMUPS_DEFAULT, rps, only, inspect, quiet = false, listRows, deepPage }) {
  assertMarginsRegistered();
  const log = quiet ? () => {} : console.log;
  const transport = makeTransport(env);
  const c = makeRecorder(transport, env);          // timed traffic
  const overhead = makeRecorder(transport, env);   // prep, equivalence, resets, drift bookkeeping (counted, untimed)
  const bucket = tokenBucket(rps ?? (env.name === 'back4app' ? POLITE_RPS : 100));
  const ctx = await buildContext(overhead, env, { alice, listRows, deepPage });

  // Gate: every scenario's diff must be empty before anything is timed (brief §4.3).
  const eq = await runEquivalence(overhead, ctx, { inspect });
  if (!eq.ok) { transport.close(); throw new Error('equivalence gate FAILED — diffs are not empty; nothing was timed. Run scripts/equivalence.mjs for the report.'); }
  log('equivalence gate: all diffs empty — timing may start');
  await harvestDeepCursor(overhead, ctx); // the known cursor for s4-gql-deep-cursor (prep, untimed)

  const chosen = MEASUREMENTS.filter((m) => !only || only.includes(m.id));
  const summary = { env, runs, warmups, measurements: [], errors: 0 };
  const sessionCsv = {};
  const onRowFor = (m) => (cellId, runIdx, orderInPair, r) => {
    sessionCsv[m.id].row([m.id, cellId, runIdx, orderInPair, r.failed ? 1 : 0, r.ms.toFixed(2), r.requests, r.reqBytes, r.respHeaderBytes, r.respBodyBytes, r.wireAttested ? r.wireUp : '', r.wireAttested ? r.wireDown : ''].join(','));
  };

  // Session baseline (C1): the S1 REST shape, measured by THIS session — margins and drift are judged on it.
  const driftCsv = csvFile('drift-controls', env, 'phase,run,ms,failed');
  const baselineRows = [];
  const baseline = async (phase) => {
    const rows = [];
    let last = 1;
    for (let i = 0; i < warmups + runs; i++) {
      await pace(bucket, last);
      const r = await timedRun(c, ctx, 's1-rest', overhead);
      last = Math.max(1, r.requests);
      if (i >= warmups) { rows.push(r); driftCsv.row(`${phase},${i - warmups},${r.ms.toFixed(2)},${r.failed ? 1 : 0}`); }
    }
    return stats(okOnly(rows, (r) => r.ms));
  };
  log(`baseline (S1 REST shape), ${warmups}+${runs} runs …`);
  const baseOpen = await baseline('open');
  baselineRows.push(baseOpen);
  const marginMs = wallMarginMs(baseOpen.p50);
  log(`baseline p50=${baseOpen.p50.toFixed(2)} ms → wall-time margin ±${marginMs.toFixed(2)} ms (pre-registered rule: max(${MARGINS.wallMs.abs} ms, ${MARGINS.wallMs.pctOfBaselineP50}% of baseline p50))`);

  for (const m of chosen) {
    sessionCsv[m.id] = csvFile(`${m.id}-${m.name}`, env, 'measurement,cell,run,orderInPair,failed,ms,requests,reqBytes,respHeaderBytes,respBodyBytes,wireUp,wireDown');
    const entry = { ...m, cells: {}, pairsOut: [] };
    for (const pair of m.pairs) {
      log(`${m.id} paired ${pair[0]} vs ${pair[1]} …`);
      const { rest, gql, pairedWallDiff } = await runPair(c, ctx, overhead, pair, { warmups, runs, bucket, onRow: onRowFor(m) });
      const cellStats = (id, rows) => {
        const st = stats(okOnly(rows, (r) => r.ms));
        const errors = rows.filter((r) => r.failed).length;
        summary.errors += errors;
        return { id, wall: st, errors, requests: median(okOnly(rows, (r) => r.requests)), respBodyBytes: median(okOnly(rows, (r) => r.respBodyBytes)), wireDown: median(okOnly(rows, (r) => r.wireDown)), wireUp: median(okOnly(rows, (r) => r.wireUp)) };
      };
      const R = cellStats(pair[0], rest); const G = cellStats(pair[1], gql);
      entry.cells[pair[0]] = R; entry.cells[pair[1]] = G;
      const byteDiffs = rest.map((r, i) => (!r.failed && gql[i] && !gql[i].failed) ? gql[i].respBodyBytes - r.respBodyBytes : null).filter((x) => x !== null);
      entry.pairsOut.push({
        pair,
        wall: { medianPairedDiffMs: median(pairedWallDiff), marginMs, verdict: verdict(pairedWallDiff, marginMs), n: pairedWallDiff.length },
        bytes: { medianPairedDiffB: median(byteDiffs), marginB: byteMargin(Math.min(R.respBodyBytes, G.respBodyBytes)), verdict: verdict(byteDiffs, byteMargin(Math.min(R.respBodyBytes, G.respBodyBytes))) },
        requests: { rest: R.requests, gql: G.requests, verdict: R.requests === G.requests ? 'tie' : 'difference' },
      });
    }
    for (const id of m.singles) {
      log(`${m.id} single ${id} …`);
      const rows = await runSingle(c, ctx, overhead, id, { warmups, runs, bucket, onRow: onRowFor(m) });
      const st = stats(okOnly(rows, (r) => r.ms));
      const errors = rows.filter((r) => r.failed).length;
      summary.errors += errors;
      entry.cells[id] = { id, wall: st, errors, requests: median(okOnly(rows, (r) => r.requests)), respBodyBytes: median(okOnly(rows, (r) => r.respBodyBytes)), wireDown: median(okOnly(rows, (r) => r.wireDown)), wireUp: median(okOnly(rows, (r) => r.wireUp)), antiPattern: !!CELLS[id].antiPattern };
    }
    summary.measurements.push(entry);
  }

  log(`drift control: baseline re-run …`);
  const baseClose = await baseline('close');
  baselineRows.push(baseClose);
  summary.baseline = { open: baseOpen, close: baseClose, drifted: drifted(baseOpen.p50, baseClose.p50), rule: `max(${DRIFT.absMs} ms, ${DRIFT.pct}%)` };
  summary.requestsIssued = { timed: c.records.length, overhead: overhead.records.length };
  transport.close();
  return summary;
}

export function writeSummary(env, s) {
  const md = evidenceMd('measurement-summary', env);
  const local = targetLabel(env) === 'local';
  const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  let body = `# Measurement summary M1–M5 — ${targetLabel(env).toUpperCase()} session

${environmentLine(env, `runs=${s.runs} warmups=${s.warmups}`)}

${local ? '**LOOPBACK-ONLY WALL TIMES.** This is a localhost parse-server: every millisecond figure here proves the harness and the paired design, and says NOTHING about the live platform (whose own baseline the live session measures). Request counts and decoded-byte figures ARE meaningful (same code, same dataset shapes).' : ''}

Session baseline (S1 REST shape): open p50 ${f(s.baseline.open.p50, 2)} ms / close p50 ${f(s.baseline.close.p50, 2)} ms — drift ${s.baseline.drifted ? '**EXCEEDED — session invalid, discard and re-run**' : `within tolerance (${s.baseline.rule})`}.
Verdicts use the PRE-REGISTERED margins (scripts/lib/margins.mjs; diary entry MARGINS-REGISTERED): tie only inside the margin, inconclusive retained as a first-class outcome. Paired design: protocols alternate run by run; the judged quantity is the per-run paired difference (GraphQL − REST).

`;
  for (const m of s.measurements) {
    body += `## ${m.id.toUpperCase()} — ${m.screen} ${m.name}\n\n| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |\n|---|---|---|---|---|---|---|---|\n`;
    for (const cell of Object.values(m.cells)) {
      body += `| ${cell.id}${cell.antiPattern ? ' (anti-pattern shape)' : ''} | ${cell.wall.n} | ${cell.errors} | ${f(cell.wall.p50, 2)} | ${f(cell.wall.p95, 2)} | ${cell.requests} | ${cell.respBodyBytes} | ${cell.wireDown ?? '—'} |\n`;
    }
    for (const p of m.pairsOut) {
      body += `\nPaired verdict ${p.pair[0]} vs ${p.pair[1]} (optimized vs optimized): wall median Δ ${f(p.wall.medianPairedDiffMs, 2)} ms (margin ±${f(p.wall.marginMs, 2)}) → **${p.wall.verdict}**${local ? ' (loopback-only)' : ''}; decoded body bytes median Δ ${f(p.bytes.medianPairedDiffB, 0)} B (margin ±${f(p.bytes.marginB, 0)}) → **${p.bytes.verdict}**; requests ${p.requests.rest} vs ${p.requests.gql} → **${p.requests.verdict}**.\n`;
    }
    body += '\n';
  }
  body += `Anti-pattern cells (naive 1+N, full-row list) illustrate a request/payload SHAPE both protocols are compared against; no REST-vs-GraphQL conclusion is drawn from them (amendment S5).

Requests issued by this session: ${s.requestsIssued.timed} timed + ${s.requestsIssued.overhead} overhead (context, equivalence gate, cursor harvest, S5 resets, drift bookkeeping) — both columns feed the budget inventory.
Errors across all cells: ${s.errors}${s.errors ? ' — **a session with unexplained errors is not quotable**' : ''}.
`;
  md.write(body);
  return md.rel;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const env = target(a);
  const api = makeClient(env, { retry: env.name === 'back4app' });
  const setupToken = env.SETUP_TOKEN || LOCAL.SETUP_TOKEN;
  const creds = JSON.parse(readFileSync(path.join(ROOT, '.credentials.local.json'), 'utf8'));
  const inspect = async (className, where) => {
    const r = await api.call('testInspect', { className, where, setupToken });
    if (!r.ok) throw new Error(`testInspect failed: ${JSON.stringify(r.error)}`);
    return r.result.results;
  };
  const summary = await runMeasurementSession({
    env, alice: creds.alice, inspect,
    runs: a.runs ? Number(a.runs) : undefined,
    warmups: a.warmups !== undefined ? Number(a.warmups) : undefined,
    rps: a.rps ? Number(a.rps) : undefined,
    only: a.only ? String(a.only).split(',') : undefined,
  });
  const rel = writeSummary(env, summary);
  console.log(`measurement summary → ${rel}`);
  if (summary.baseline.drifted) { console.error('DRIFT EXCEEDED — session must be discarded and re-run.'); process.exit(1); }
  if (summary.errors) { console.error(`${summary.errors} failed run(s) — investigate before quoting.`); process.exit(1); }
}
