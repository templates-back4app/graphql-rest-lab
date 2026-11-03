// File: scripts/lib/stats.mjs · Node 22 ESM · shared by the measurement scripts and tests.
// House measurement rules, encoded once: latency = 20 warm-ups discarded + 100 timed runs, p50/p95 and error
// count; evidence files carry the label of the target they actually ran against ('back4app' only for the real
// live host). Paired design (brief amendment C1): within a session the two protocols ALTERNATE run by run on
// the same shape, and the verdicts are judged on the PER-RUN PAIRED DIFFERENCES, not two independent p50s.
import crypto from 'node:crypto';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';

export const WARMUPS_DEFAULT = 20;
export const RUNS_DEFAULT = 100;
export const POLITE_RPS = 16; // the polite client ceiling every measurement respects (token bucket)

export const runPrefix = () => 'zz' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

export function percentile(sortedXs, p) {
  if (!sortedXs.length) return NaN;
  const idx = Math.min(sortedXs.length - 1, Math.max(0, Math.ceil((p / 100) * sortedXs.length) - 1));
  return sortedXs[idx];
}

export function stats(xs) {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    p50: percentile(s, 50),
    p90: percentile(s, 90),
    p95: percentile(s, 95),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

export const fmtStats = (st, unit = 'ms') => st.n
  ? `n=${st.n} p50=${st.p50.toFixed(1)} p95=${st.p95.toFixed(1)} min=${st.min.toFixed(1)} max=${st.max.toFixed(1)} ${unit}`
  : 'n=0';

export const targetLabel = (env) => (env.name === 'back4app' ? 'back4app' : env.name === 'local-test' ? 'local-test' : 'local');

export function csvFile(name, env, header) {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, 'docs', 'evidence', `${name}-${targetLabel(env)}-${date}.csv`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, header + '\n'); // one run per file+date: a re-run REPLACES, never appends mixed sessions
  return { file, row: (line) => appendFileSync(file, line + '\n'), rel: path.relative(ROOT, file) };
}

export function evidenceMd(name, env) {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, 'docs', 'evidence', `${name}-${targetLabel(env)}-${date}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  return { file, write: (text) => writeFileSync(file, text), rel: path.relative(ROOT, file) };
}

/** The environment line every evidence file carries. */
export function environmentLine(env, extra = '') {
  return `target=${env.name} serverURL=${env.SERVER_URL} graphqlURL=${env.GRAPHQL_URL} node=${process.version} date=${new Date().toISOString()} ${extra}`.trim();
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Token bucket: `await bucket.take()` before each request to stay under `ratePerSecond`. */
export function tokenBucket(ratePerSecond) {
  const interval = 1000 / ratePerSecond;
  let next = performance.now();
  return {
    async take() {
      const now = performance.now();
      if (next < now) next = now;
      const wait = next - now;
      next += interval;
      if (wait > 0) await sleep(wait);
    },
  };
}
