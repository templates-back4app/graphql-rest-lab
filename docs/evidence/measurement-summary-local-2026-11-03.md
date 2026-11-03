# Measurement summary M1–M5 — LOCAL session

target=local serverURL=http://localhost:1353/parse graphqlURL=http://localhost:1353/graphql node=v25.8.1 date=2026-11-03T12:47:14.020Z runs=100 warmups=20

**LOOPBACK-ONLY WALL TIMES.** This is a localhost parse-server: every millisecond figure here proves the harness and the paired design, and says NOTHING about the live platform (whose own baseline the live session measures). Request counts and decoded-byte figures ARE meaningful (same code, same dataset shapes).

Session baseline (S1 REST shape): open p50 1.27 ms / close p50 1.57 ms — drift within tolerance (max(5 ms, 10%)).
Verdicts use the PRE-REGISTERED margins (scripts/lib/margins.mjs; diary entry MARGINS-REGISTERED): tie only inside the margin, inconclusive retained as a first-class outcome. Paired design: protocols alternate run by run; the judged quantity is the per-run paired difference (GraphQL − REST).

## M1 — S1 single-object

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s1-rest | 100 | 0 | 1.89 | 3.75 | 1 | 1430 | 2106 |
| s1-gql | 100 | 0 | 2.97 | 5.33 | 1 | 1354 | 1601 |

Paired verdict s1-rest vs s1-gql (optimized vs optimized): wall median Δ 1.10 ms (margin ±5.00) → **tie** (loopback-only); decoded body bytes median Δ -76 B (margin ±200) → **tie**; requests 1 vs 1 → **tie**.

## M2 — S2 nested-screen

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s2-rest-include1 | 100 | 0 | 3.76 | 6.85 | 1 | 13684 | 14362 |
| s2-gql | 100 | 0 | 4.59 | 7.92 | 1 | 2110 | 2357 |
| s2-rest-naive (anti-pattern shape) | 100 | 0 | 27.66 | 35.42 | 22 | 7581 | 22413 |
| s2-rest-include2 | 100 | 0 | 6.96 | 9.60 | 2 | 7061 | 8413 |

Paired verdict s2-rest-include1 vs s2-gql (optimized vs optimized): wall median Δ 0.58 ms (margin ±5.00) → **tie** (loopback-only); decoded body bytes median Δ -11574 B (margin ±200) → **difference**; requests 1 vs 1 → **tie**.

## M3 — S3 field-selection

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s3-rest-keys | 100 | 0 | 3.57 | 5.63 | 1 | 16332 | 17010 |
| s3-gql | 100 | 0 | 4.78 | 8.47 | 1 | 9453 | 9701 |
| s3-rest-full (anti-pattern shape) | 100 | 0 | 4.23 | 5.47 | 1 | 143549 | 144229 |

Paired verdict s3-rest-keys vs s3-gql (optimized vs optimized): wall median Δ 1.56 ms (margin ±5.00) → **tie** (loopback-only); decoded body bytes median Δ -6879 B (margin ±200) → **difference**; requests 1 vs 1 → **tie**.

## M4 — S4 pagination

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s4-rest-page1 | 100 | 0 | 2.48 | 5.09 | 1 | 16332 | 17010 |
| s4-gql-page1 | 100 | 0 | 4.02 | 7.58 | 1 | 13124 | 13373 |
| s4-rest-deep-offset | 100 | 0 | 8.63 | 12.19 | 1 | 16332 | 17010 |
| s4-gql-deep-cursor | 100 | 0 | 10.90 | 14.82 | 1 | 13529 | 13778 |
| s4-rest-deep-cumulative | 100 | 0 | 33.13 | 44.97 | 10 | 163968 | 170748 |
| s4-gql-deep-cumulative | 100 | 0 | 49.67 | 61.93 | 10 | 135525 | 138015 |

Paired verdict s4-rest-page1 vs s4-gql-page1 (optimized vs optimized): wall median Δ 1.70 ms (margin ±5.00) → **tie** (loopback-only); decoded body bytes median Δ -3208 B (margin ±262) → **difference**; requests 1 vs 1 → **tie**.

Paired verdict s4-rest-deep-offset vs s4-gql-deep-cursor (optimized vs optimized): wall median Δ 2.16 ms (margin ±5.00) → **tie** (loopback-only); decoded body bytes median Δ -2803 B (margin ±271) → **difference**; requests 1 vs 1 → **tie**.

Paired verdict s4-rest-deep-cumulative vs s4-gql-deep-cumulative (optimized vs optimized): wall median Δ 14.34 ms (margin ±5.00) → **difference** (loopback-only); decoded body bytes median Δ -28443 B (margin ±2711) → **difference**; requests 10 vs 10 → **tie**.

## M5 — S5 mutation

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s5-rest | 100 | 0 | 1.62 | 4.17 | 1 | 40 | 713 |
| s5-gql | 100 | 0 | 3.14 | 5.76 | 1 | 80 | 324 |

Paired verdict s5-rest vs s5-gql (optimized vs optimized): wall median Δ 0.93 ms (margin ±5.00) → **tie** (loopback-only); decoded body bytes median Δ 40 B (margin ±200) → **tie**; requests 1 vs 1 → **tie**.

Anti-pattern cells (naive 1+N, full-row list) illustrate a request/payload SHAPE both protocols are compared against; no REST-vs-GraphQL conclusion is drawn from them (amendment S5).

Requests issued by this session: 7080 timed + 322 overhead (context, equivalence gate, cursor harvest, S5 resets, drift bookkeeping) — both columns feed the budget inventory.
Errors across all cells: 0.
