// File: scripts/lib/margins.mjs · Node 22 ESM
// PRE-REGISTERED equivalence margins (brief amendment C2) — the single source the diary quotes and the
// measurement harness applies. DO NOT edit after a measurement session has run against a target: a changed
// margin invalidates that target's verdicts (re-run the session instead). The build diary carries the dated
// MARGINS-REGISTERED entry; scripts/measure.mjs REFUSES to run while that entry is missing, so Phase A
// measurement cannot start before the margins exist (amendment: Phase A entry criteria).
//
// Verdict rule, per metric, per cell pair (REST vs GraphQL on the same shape, paired by run index):
//   d_i = metric(GraphQL run i) − metric(REST run i)   (signed; positive = GraphQL costlier)
//   DIFFERENCE   if |median(d)| > margin
//   TIE          if |median(d)| ≤ margin AND p90(|d|) ≤ 2 × margin  (the spread sits inside the margin too)
//   INCONCLUSIVE otherwise — reported as such, a first-class outcome, never rounded to a winner.
// Margins are stated in absolute units AND as a % of the session's own baseline (the S1 REST shape, measured
// in the same session — amendment C1: never a prior lab's number).

export const MARGINS = {
  // Wall time: a paired-median gap within 5 ms, or within 5% of the session baseline p50, whichever is
  // LARGER, is a tie. On loopback (baseline p50 ≈ a few ms) the 5 ms floor dominates and the diary labels
  // every wall-time figure loopback-only; on the live path (~430 ms prior observations) the 5% term dominates.
  wallMs: { abs: 5, pctOfBaselineP50: 5 },
  // Bytes are deterministic per shape (fixed dataset, identity encoding): the margin only absorbs
  // protocol-irrelevant jitter (date headers, request-id headers, token lengths).
  bytes: { abs: 200, pct: 2 },
  // Request counts are exact by construction; any difference is a difference.
  requests: { abs: 0, pct: 0 },
};

export function wallMarginMs(baselineP50) {
  return Math.max(MARGINS.wallMs.abs, (MARGINS.wallMs.pctOfBaselineP50 / 100) * (baselineP50 || 0));
}

export function byteMargin(smallerBytes) {
  return Math.max(MARGINS.bytes.abs, (MARGINS.bytes.pct / 100) * (smallerBytes || 0));
}

/** verdict(pairedDiffs, margin) → 'difference' | 'tie' | 'inconclusive' (rule above). */
export function verdict(pairedDiffs, margin) {
  if (!pairedDiffs.length) return 'inconclusive';
  const s = [...pairedDiffs].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  const absSorted = pairedDiffs.map(Math.abs).sort((a, b) => a - b);
  const p90abs = absSorted[Math.min(absSorted.length - 1, Math.ceil(0.9 * absSorted.length) - 1)];
  if (Math.abs(median) > margin) return 'difference';
  if (p90abs <= 2 * margin) return 'tie';
  return 'inconclusive';
}

/** Drift control (house rule + amendment C1): the session's first cell re-run at the end must sit within
 *  max(5 ms, 10%) of its opening p50, or the whole session is marked drifted and must be discarded. */
export const DRIFT = { absMs: 5, pct: 10 };
export function drifted(openP50, closeP50) {
  const margin = Math.max(DRIFT.absMs, (DRIFT.pct / 100) * openP50);
  return Math.abs(closeP50 - openP50) > margin;
}
