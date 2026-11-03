# Build diary — graphql-rest-lab (Phase A, local only)

Companion lab for the blog post *GraphQL vs REST Performance: The Same App Screens, Tested*
(slug `graphql-or-rest-same-backend-measured`). Binding spec: brief v1 (2026-10-30) as amended by the
amendments file of the same date — the amendments win. House reference: tenant-lab, chat-lab.

## 2026-11-03 — scope of this phase

Phase A is LOCAL ONLY. The local dev server (parse-server ^7, Postgres 5433, port 1353) mounts the
auto-generated GraphQL endpoint via parse-server's own `ParseGraphQLServer`, so the whole matrix — shapes,
equivalence, parity, cursor format, measurement harness — proves out locally. **Local GraphQL availability
says NOTHING about the live platform. Only Phase 0 (the coordinator's step, on a live backend) decides the
live story**, and Phase 0 can still reshape or kill the post. Where the live outcome matters, this repo leaves
a marked seam: grep for `SEAM(Phase 0)` and see "Phase 0 seams" below.

## 2026-11-03 — live observation (coordinator probe; recorded, not produced by this repo)

Dated live datapoint, source **coordinator probe, 2026-11-03** (this repo made no live calls): POST
`https://parseapi.back4app.com/graphql` with App ID + REST key on a Free-plan backend (Parse Server 7.5.2)
answered the introspection query `{ __schema { queryType { name } } }` with
`{"data":{"__schema":{"queryType":{"name":"Query"}}}}`. Consequences:

- The live GraphQL endpoint EXISTS at that URL and is enabled on the current Free plan — the §9
  "endpoint unavailable ⇒ no post" kill-risk is retired.
- Introspection answered a non-master caller — see the divergence note below.
- Still UNVERIFIED (live phase, not Phase A): CLP/ACL/session parity over GraphQL, required headers in full,
  schema coverage of custom classes, the live cursor implementation, byte instrumentation on the live path,
  and how the plan meters batches / multi-operation GraphQL POSTs.

## 2026-11-03 — finding: introspection posture differs between OSS default and the live platform

Local observation (this repo, parse-server 7.5.4): `ParseGraphQLServer` by default REFUSES introspection for
non-master callers — `"Introspection is not allowed"`, HTTP 403 (`graphQLPublicIntrospection` option gates
it). The live endpoint ANSWERED introspection to an ordinary key (coordinator probe above). The local server
therefore sets `graphQLPublicIntrospection: true` to mirror the one observed live datapoint, so P8 records
what introspection reveals; the divergence itself is a P8/local-vs-live finding and the live posture is on the
Phase 0 checklist. SEAM(Phase 0).

## 2026-11-03 — fixed before benchmarking (amendment S1)

The nested-screen retrieval paths were written as working code first (`scripts/lib/shapes.mjs`) and
diff-verified (equivalence evidence). What the working code established, on the local target:

- GraphQL object ids are relay global ids, base64 `"ClassName:objectId"` — COMPUTED and then VERIFIED against
  the ids the API returns (`buildContext` fails on mismatch; no shape runs on an assumed id scheme).
- S2 GraphQL: no reverse connection on `Order`; the working path is ONE HTTP POST whose document carries TWO
  root fields (`order(id:)` + filtered `orderItems(where: {order: {have: {objectId: {equalTo}}}})`, with
  `count`).
- S2 REST: three working shapes — naive (GET order + items query + one GET per product line; the count is
  whatever the recorder says, never "1+20" by declaration), include2 (GET order + one items query with
  `include=product&count=1`), include1 (ONE items query with `include=order,product` — fewest requests REST
  allows here, possible only because the screen's order always has ≥1 item; the parent rides duplicated in
  every item, a byte cost the measurement shows).
- S4 cursor: decoded live from responses — base64 `arrayconnection:<offset>` (graphql-relay), i.e.
  **offset-encoded**, on the local target. A GraphQL cursor here is NOT evidence of keyset pagination. The
  LIVE cursor format is re-verified in Phase 0 before any live pagination claim. SEAM(Phase 0).
- S5 policy is object-level only (amendment S2): CLP `update: requiresAuthentication` + owner-only row ACL.
  No field-level claim is made, tested, or enforceable without server-side validation (out of scope, stated).

## 2026-11-03 — MARGINS-REGISTERED (amendment C2; BEFORE any measurement run)

Pre-registered equivalence margins, single source `scripts/lib/margins.mjs` (this entry quotes it; the code
is authoritative; neither moves after a session has run):

- **Wall time** (per paired cell, judged on per-run paired differences d_i = GraphQL_i − REST_i):
  margin = max(5 ms, 5% of the SESSION's own baseline p50) — the baseline is the S1 REST shape measured at
  session open by the same session (amendment C1; prior labs' floors are context, never the margin base).
  DIFFERENCE if |median(d)| > margin; TIE if |median(d)| ≤ margin AND p90(|d|) ≤ 2×margin; otherwise
  **INCONCLUSIVE** (kept as a first-class outcome).
- **Bytes** (decoded body bytes; wire bytes reported beside, socket-attested): margin = max(200 B, 2% of the
  smaller cell's figure). Same three-way rule.
- **Request counts**: margin 0 — exact; any difference is a difference.
- **Drift control**: baseline re-run at session close must sit within max(5 ms, 10%) of the opening p50, or
  the session is discarded and re-run.
- **Pacing**: token bucket BETWEEN runs only (a screen fetch is one user action; pacing inside a cell would
  corrupt the multi-request cells' wall times). Live rate 16 req/s average; local default 100/s.
- **Error rule** (amendment S4): a GraphQL `errors` array or missing/partial `data` is a FAILED run even on
  HTTP 200 — excluded from stats, counted in the error column, session exits non-zero.

`scripts/measure.mjs` refuses to run if this MARGINS-REGISTERED entry is missing from the diary.

## 2026-11-03 — measurement design notes

- Paired design: within each pair the protocol order ALTERNATES run by run (even i: REST first; odd i:
  GraphQL first), so ordering effects cancel in the paired differences.
- Optimized-vs-optimized only (amendment S5): verdict pairs are s1-rest/s1-gql, s2-rest-include1/s2-gql,
  s3-rest-keys/s3-gql, the three S4 pairs, s5-rest/s5-gql. `s2-rest-naive`, `s2-rest-include2` and
  `s3-rest-full` are measured and reported as the anti-pattern/reference shapes; no REST-vs-GraphQL sentence
  may be built on them.
- S4 deep page: *known-cursor/known-offset* (1 request) and *cumulative navigation* (page 1..10 sequential)
  are SEPARATE cells, reported separately (amendment S3). Stable sort everywhere: `sku` asc + `objectId`
  tie-breaker. All pagination conclusions scoped to the tested 1,000-row dataset.
- S5 resets the order status after EVERY timed run via a real owner REST write (untimed, counted), so every
  run performs a real state change.
- Byte labels: figures from the socket counters are "wire"; everything else is "decoded body bytes" and never
  called wire or compressed. Request AND response headers are counted per request, repeats included.
  Transport holds `Accept-Encoding: identity` on both protocols (compression is a held factor, not noise);
  whether the live path compresses regardless is a live-phase observation. SEAM(Phase 0).

## 2026-11-03 — budget (amendment C4)

The counted two-column inventory (HTTP requests vs billable operations) is generated by
`npm run budget` → `docs/notes/budget-inventory-<date>.md`, from code constants + the per-cell request counts
recorded by the equivalence run (never assumed). Standing seams: metering of server-side `saveAll` writes
inside one Cloud call, and of one GraphQL POST carrying two root fields, are Phase 0 checklist items; the ops
column carries counted upper bounds until then. Live Plan Usage lags ~a day — the operator reads it the day
after a session. SEAM(Phase 0).

## 2026-11-03 — quirk: empty-`where` counts are estimates on the Postgres adapter

Observed while wiring parity: `Parse.Query.count()` (and REST `count=1`) with an EMPTY where answers an
ANALYZE-based estimate on the Postgres adapter — 0 on a freshly seeded table — while any filtered count is
exact. Every count in this lab therefore filters (by `seedTag` or a pointer). The measured S2/S3 cells are
unaffected (their counts always carry a where). MongoDB (the live stack) may behave differently — the live
matrix re-checks it in passing. SEAM(Phase 0).

## Phase 0 seams (all of them, in one place)

| # | Seam | Where it is marked |
|---|---|---|
| 1 | Live GraphQL URL/headers/session parity (one datapoint exists: 2026-11-03 probe) | .env.example `GRAPHQL_URL`, env.mjs target(), this diary |
| 2 | Live CLP/ACL/session parity over GraphQL (P1–P7, P10 on the live backend) | parity evidence header; test-matrix "live-only" table |
| 3 | Live introspection posture (local OSS default ≠ observed live datapoint) | dev-server.mjs comment; P8 rows |
| 4 | Live cursor implementation (offset vs keyset re-verified before any live pagination claim) | cursor-verify evidence footer |
| 5 | Plan metering of batches / multi-op GraphQL POSTs; Plan Usage ~1-day lag | budget inventory columns + notes |
| 6 | Live compression behavior on both endpoints (transport pins identity; platform may override) | transport.mjs + this diary |
| 7 | Live wall-time story (loopback numbers are harness proof only; live session measures its own baseline) | measurement summary header |

## 2026-11-03 — local runs (what was executed, in order)

1. `npm run setup -- --local` → 4 classes, CLPs, indexes applied.
2. `npm run seed -- --local` → 1,000 products, 200 orders, 4,000 items, 1 audit row; personas alice/bob
   (passwords in `.credentials.local.json`, never printed, never committed).
3. `npm run equivalence -- --local` → all diffs empty; per-cell request counts recorded (see evidence).
4. `npm run parity -- --local` → P1–P10 both protocols (see evidence).
5. `npm run cursor -- --local` → offset-encoded cursors verified (see evidence).
6. `npm test` → full suite against an in-process server on `gql_test`; test matrix regenerated.
7. `npm run measure -- --local` → M1–M5 session, loopback-labeled; drift within tolerance (see summary).
8. `npm run budget` → counted inventory.

## 2026-11-03 — Phase A local results (headline observations; wall times LOOPBACK-ONLY)

Full session: `npm run measure -- --local`, 20+100 per cell, paired design, drift within tolerance
(baseline p50 1.27 → 1.57 ms), 0 errors across all cells. 7,080 timed + 322 overhead requests. Evidence:
`docs/evidence/measurement-summary-local-2026-11-03.md` + per-run CSVs. What the LOCAL data says:

- **Request counts (meaningful anywhere):** every optimized pair ties at 1 request per screen — including S2,
  where REST's `include=order,product` matches GraphQL's one POST; the naive shape measured 22 requests
  (2 + 20, derived from execution) and ~7× the optimized wall time even on loopback. Cumulative deep paging is
  10 requests on BOTH protocols.
- **Decoded body bytes (meaningful anywhere; same shapes, same dataset):** S2 GraphQL 2,110 B vs REST-include1
  13,684 B (the one-request REST shape pays for the parent duplicated into every item) vs REST-include2
  7,061 B at 2 requests — a real trade REST must choose that GraphQL doesn't; S3 full rows 143,549 B vs
  REST `keys=` 16,332 B vs GraphQL 9,453 B (field selection is the big lever and REST HAS it; the remaining
  REST overhead is createdAt/updatedAt/etc. that `keys=` cannot drop); S1 and S5 byte differences sit inside
  the 200 B margin → ties (H5's envelope-overhead flip did NOT appear at this schema's S1 size, locally).
  Header asymmetry worth noting for the article: this server's REST responses carried ~676 B of headers vs
  ~247 B on GraphQL responses, so WIRE totals can order differently than body totals (S1 wire down: REST
  2,106 B vs GraphQL 1,601 B — GraphQL smaller on the wire despite the envelope).
- **Wall time:** all optimized pairs tie inside the ±5 ms loopback margin except cumulative deep paging
  (GraphQL − REST median +14.3 ms over 10 requests, loopback-only; both mechanisms are offset-driven here —
  see the cursor evidence). Loopback verdicts prove the harness; the live session re-decides everything
  against its own baseline.
- Verdict counts, this session: ties 13, differences 5 (4 byte, 1 loopback wall), inconclusive 0.

Budget: `docs/notes/budget-inventory-2026-11-03.md` — ≈ 14.9K HTTP requests for seed + full matrix + one
session + one contingency re-run, counted (amendment C4); metering seams open for Phase 0.
