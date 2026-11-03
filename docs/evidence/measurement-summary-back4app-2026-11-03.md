# Measurement summary M1–M5 — BACK4APP session

target=back4app serverURL=https://parseapi.back4app.com graphqlURL=https://parseapi.back4app.com/graphql node=v25.8.1 date=2026-11-03T14:00:06.511Z runs=100 warmups=20



Session baseline (S1 REST shape): open p50 399.37 ms / close p50 399.67 ms — drift within tolerance (max(5 ms, 10%)).
Verdicts use the PRE-REGISTERED margins (scripts/lib/margins.mjs; diary entry MARGINS-REGISTERED): tie only inside the margin, inconclusive retained as a first-class outcome. Paired design: protocols alternate run by run; the judged quantity is the per-run paired difference (GraphQL − REST).

## M1 — S1 single-object

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s1-rest | 100 | 0 | 396.84 | 474.37 | 1 | 1430 | 2590 |
| s1-gql | 100 | 0 | 409.49 | 502.55 | 1 | 1354 | 2436 |

Paired verdict s1-rest vs s1-gql (optimized vs optimized): wall median Δ 12.57 ms (margin ±19.97) → **inconclusive**; decoded body bytes median Δ -76 B (margin ±200) → **tie**; requests 1 vs 1 → **tie**.

## M2 — S2 nested-screen

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s2-rest-include1 | 100 | 0 | 431.57 | 516.32 | 1 | 13684 | 14846 |
| s2-gql | 100 | 0 | 423.68 | 520.11 | 1 | 2110 | 3192 |
| s2-rest-naive (anti-pattern shape) | 100 | 0 | 8918.90 | 9314.98 | 22 | 7581 | 32601 |
| s2-rest-include2 | 100 | 0 | 805.03 | 902.83 | 2 | 7061 | 9381 |

Paired verdict s2-rest-include1 vs s2-gql (optimized vs optimized): wall median Δ -8.47 ms (margin ±19.97) → **inconclusive**; decoded body bytes median Δ -11574 B (margin ±200) → **difference**; requests 1 vs 1 → **tie**.

## M3 — S3 field-selection

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s3-rest-keys | 100 | 0 | 416.25 | 497.36 | 1 | 16332 | 17494 |
| s3-gql | 100 | 0 | 415.62 | 494.92 | 1 | 9453 | 10536 |
| s3-rest-full (anti-pattern shape) | 100 | 0 | 529.06 | 595.31 | 1 | 143549 | 144713 |

Paired verdict s3-rest-keys vs s3-gql (optimized vs optimized): wall median Δ -1.07 ms (margin ±19.97) → **inconclusive**; decoded body bytes median Δ -6879 B (margin ±200) → **difference**; requests 1 vs 1 → **tie**.

## M4 — S4 pagination

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s4-rest-page1 | 100 | 0 | 414.02 | 493.58 | 1 | 16332 | 17494 |
| s4-gql-page1 | 100 | 0 | 422.18 | 511.01 | 1 | 13124 | 14208 |
| s4-rest-deep-offset | 100 | 0 | 423.72 | 495.00 | 1 | 16332 | 17494 |
| s4-gql-deep-cursor | 100 | 0 | 426.94 | 489.93 | 1 | 13529 | 14613 |
| s4-rest-deep-cumulative | 100 | 0 | 4449.56 | 4940.13 | 10 | 163968 | 175588 |
| s4-gql-deep-cumulative | 100 | 0 | 4523.43 | 4915.47 | 10 | 135525 | 146365 |

Paired verdict s4-rest-page1 vs s4-gql-page1 (optimized vs optimized): wall median Δ 12.09 ms (margin ±19.97) → **inconclusive**; decoded body bytes median Δ -3208 B (margin ±262) → **difference**; requests 1 vs 1 → **tie**.

Paired verdict s4-rest-deep-offset vs s4-gql-deep-cursor (optimized vs optimized): wall median Δ 3.51 ms (margin ±19.97) → **inconclusive**; decoded body bytes median Δ -2803 B (margin ±271) → **difference**; requests 1 vs 1 → **tie**.

Paired verdict s4-rest-deep-cumulative vs s4-gql-deep-cumulative (optimized vs optimized): wall median Δ 40.37 ms (margin ±19.97) → **difference**; decoded body bytes median Δ -28443 B (margin ±2711) → **difference**; requests 10 vs 10 → **tie**.

## M5 — S5 mutation

| Cell | runs ok | errors | wall p50 ms | wall p95 ms | req/run | resp body B (decoded, median) | wire down B (median) |
|---|---|---|---|---|---|---|---|
| s5-rest | 100 | 0 | 399.27 | 454.50 | 1 | 40 | 1174 |
| s5-gql | 100 | 0 | 401.60 | 443.13 | 1 | 80 | 1136 |

Paired verdict s5-rest vs s5-gql (optimized vs optimized): wall median Δ 2.60 ms (margin ±19.97) → **tie**; decoded body bytes median Δ 40 B (margin ±200) → **tie**; requests 1 vs 1 → **tie**.

Anti-pattern cells (naive 1+N, full-row list) illustrate a request/payload SHAPE both protocols are compared against; no REST-vs-GraphQL conclusion is drawn from them (amendment S5).

Requests issued by this session: 7080 timed + 322 overhead (context, equivalence gate, cursor harvest, S5 resets, drift bookkeeping) — both columns feed the budget inventory.
Errors across all cells: 0.
