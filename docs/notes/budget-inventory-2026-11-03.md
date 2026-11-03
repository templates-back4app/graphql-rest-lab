# Budget inventory — counted, two columns (amendment C4) — 2026-11-03

Derived from: cloud/config.js constants (P=1000, O=200, I=20), the measure.mjs session structure
(20 warm-ups + 100 runs per cell), and the per-cell request counts RECORDED from
executed shapes (docs/notes/cell-request-counts.json, target=local, 2026-11-03T12:41:13.848Z).

**HTTP requests** = connections the client opens. **Billable operations** = what the plan may meter — NOT
assumed equal: a seedData call creates up to 250 rows server-side, and one GraphQL POST
here can carry two root fields. The metering rules for both are on the Phase 0 checklist; live Plan Usage lags
about a day, so the operator checks it the day AFTER a live session.

| Phase | What | HTTP requests | Billable operations (counted upper bound) | Note |
|---|---|---|---|---|
| seed | personas (2 signups or logins) | 2 | 2 | public REST signup |
| seed | seedData Cloud calls (1000 products + 200 orders + 4000 items + 1 audit) | 23 | 23 calls + 5201 server-side writes | SEAM(Phase 0): how server-side saveAll writes meter on the plan is unverified |
| seed | setupSchema (idempotent apply) | 1 | 1 call + schema ops | SEAM(Phase 0): schema-API metering unverified |
| seed | pre-seed inspect (testInspect count) | 1 | 1 |  |
| phaseA | equivalence pass (context build, all cells once, S5 state checks + resets) | 73 | 73 HTTP; GraphQL POSTs carry up to 2 root fields | SEAM(Phase 0): multi-operation GraphQL POST metering unverified |
| phaseA | measurement session, 20+100 per cell (m1: 240 · m2: 3120 · m3: 360 · m4: 2880 · m5: 480) | 7080 | 7080 | per-cell per-run request counts from executed shapes (sidecar), not declared |
| phaseA | session baseline open+close (S1 REST, drift control) | 240 | 240 |  |
| phaseA | session overhead (context, gate re-run, cursor harvest 9 pages) | 87 | ≈ same | counted from the overhead recorder at run time; see measurement summary |
| phaseA | parity matrix P1–P10 (both protocols, positive controls, state read-backs) | 28 | 28 | recorded from the executed run |
| contingency | drift re-runs (budget for 1 full session repeat) | 7320 | 7320 | house rule: a drifted session is discarded and re-run |

**Total (numeric HTTP lines): ≈ 14855 HTTP requests** for one complete seed + Phase A matrix + one
measurement session + one contingency re-run. The live effort estimate is re-derived from THIS table at Phase 0
exit (amendment C4). Sources: counted loops in scripts/seed.mjs and scripts/measure.mjs; recorded sidecar;
parity evidence file.
