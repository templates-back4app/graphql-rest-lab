# graphql-rest-lab

Companion lab for the Back4app blog post **“GraphQL vs REST Performance: The Same App Screens, Tested”**
(slug `graphql-or-rest-same-backend-measured`). The same five app screens are fetched through the platform's
auto-generated **GraphQL** API and its **REST** API — same backend, same dataset, same transport — and every
difference in **request counts, bytes and wall time** is measured under pre-registered equivalence margins,
never asserted. Same family as `tenant-lab` and `chat-lab`.

**Status: Phase A (local).** Everything here runs against a local parse-server ^7 that mounts the
auto-generated GraphQL endpoint (`ParseGraphQLServer`) next to REST. Local GraphQL availability says nothing
about the live plan — **Phase 0 (a live feasibility gate, run by the owner/coordinator) decides the live
story** and can still reshape the post. One live datapoint exists (2026-11-03: the live `/graphql` endpoint
answered introspection on a Free-plan backend); everything else live is an open seam — grep `SEAM(Phase 0)`
and see `docs/notes/build-diary.md`.

## The design in one paragraph

ACME's storefront admin: `Product` (1,000 deliberately wide rows), `Order` (200, owner-ACLed),
`OrderItem` (20 per order, holding pointers to `Order` and `Product` — `Order` has **no reverse collection
field**), `AuditLog` (master-key-only). Five screens: S1 product detail (one object), S2 order detail
(parent + children + product names + count), S3 product list drawing 3 fields, S4 paging 1,000 rows at
100/page, S5 “mark an order shipped” (the only client write: **owner-authorized object update** — no
field-level claim). The exact retrieval paths both APIs use are **fixed as working code**
(`scripts/lib/shapes.mjs`), diff-verified before anything is timed, and request counts are derived from
execution — never declared.

## Layout

```
cloud/            config.js (schema, tunables, seed generators, setup gate) · guards.js (GUARDS registry)
                  main.js (ONLY setup-gated admin helpers: setupSchema, seedData, testInspect, testCleanup —
                  the data path has NO hooks and NO functions: the subject is the two auto-generated APIs)
scripts/          dev-server.mjs (REST :1353/parse + GraphQL :1353/graphql, Postgres 5433/gql_dev)
                  setup.mjs · seed.mjs · equivalence.mjs · parity.mjs · cursor-verify.mjs · measure.mjs
                  budget-inventory.mjs · evidence.mjs
scripts/lib/      transport.mjs (instrumented client: socket-attested wire bytes, identity encoding)
                  shapes.mjs (THE fixed screen shapes + recorder) · parity.mjs (P1–P10) · margins.mjs
                  (pre-registered margins & verdict rule) · stats.mjs · rest.mjs · env.mjs
test/             node:test suites (own in-process server per file, db gql_test, zz… run prefixes)
docs/evidence/    dated, target-labeled outputs (equivalence diffs, parity matrix, cursor note, m1–m5 CSVs,
                  drift controls, measurement summary, test matrix)
docs/notes/       build-diary.md (margins, seams, findings) · budget-inventory-<date>.md · cell-request-counts.json
```

## Quickstart (local)

Needs Node ≥22 and a Postgres on 5433 (`brew install postgresql@17`; the sibling labs share it).

```bash
npm install
npm run dev:server          # REST http://localhost:1353/parse · GraphQL http://localhost:1353/graphql
npm run setup -- --local    # classes, CLPs, indexes
npm run seed  -- --local    # 1,000 products, 200 orders, 4,000 items; personas → .credentials.local.json
npm run equivalence -- --local   # the gate: all diffs must be empty; records per-cell request counts
npm run parity      -- --local   # P1–P10, both protocols
npm run cursor      -- --local   # decode the auto-generated cursor (offset vs keyset — verified)
npm run measure     -- --local   # M1–M5, paired design; wall times are LOOPBACK-ONLY
npm run budget                   # counted two-column request/operation inventory
npm test                         # full suite on its own in-process server (db gql_test)
```

## Measurement protocol (the short version; margins in `scripts/lib/margins.mjs` + diary)

20 warm-ups discarded, 100 timed runs per cell; **paired design** — the two protocols alternate run by run on
the same shape and verdicts are judged on per-run paired differences; each session measures its **own
baseline** (the S1 REST shape) and re-runs it at close as the drift control; token-bucket pacing between runs
only; a GraphQL `errors` array or partial `data` **fails the run even on HTTP 200**; S5 resets state after
every run; "tie" exists only inside the pre-registered margin, and **inconclusive is a first-class outcome**.
Optimized-vs-optimized only: the naive 1+N and full-row cells are anti-pattern references, never REST's
representative. Bytes: socket-attested **wire** figures + **decoded body bytes**, headers counted per request.

## Guarantees and limits (do not overstate them)

- Local wall-time figures are loopback-only harness proof. The published latency story comes from the live
  session (coordinator, after Phase 0), which measures its own baseline.
- The cursor finding (offset-encoded `arrayconnection:N`) is verified on the LOCAL target; the live format is
  re-verified in Phase 0 before any live pagination claim. Pagination conclusions are scoped to the tested
  1,000 rows.
- The write policy is object-level (owner ACL). No field-level protection exists or is claimed; that would
  need server-side validation, deliberately out of scope here.
- Empty-`where` counts are ANALYZE estimates on the Postgres adapter (see diary) — every count in this lab
  filters.
- Admin helpers run only with `SETUP_ENABLED=1` **and** the SHA-256-checked setup token; the default
  deployment ships with both unset and refuses everything.

## Live phase (THE COORDINATOR'S STEP — nothing in Phase A calls a remote backend)

Phase 0 checklist first (live backend, dated note in `docs/evidence/`): exact GraphQL URL + required headers;
session riding `X-Parse-Session-Token` identically; schema coverage of custom classes/pointers/counts/cursor
pagination; introspection posture (OSS default differs — see diary); live cursor format; how the plan meters
`/batch` and multi-operation GraphQL POSTs (Plan Usage lags ~a day). Then:

```bash
# .env.live: APP_ID, JS_KEY, REST_KEY, SERVER_URL, GRAPHQL_URL, SETUP_TOKEN (never the master key, never committed)
# Back4app dashboard: Cloud Code → upload cloud/main.js, cloud/config.js, cloud/guards.js → Deploy
#   (verify with a REQUEST, never the dialog — see the sibling labs' deploy quirk); set the Cloud Code env
#   SETUP_ENABLED=1 and SETUP_TOKEN_SHA256=<sha256 of the token>; turn both OFF again after the run.
npm run setup       -- --live
npm run seed        -- --live
npm run equivalence -- --live
npm run parity      -- --live
npm run cursor      -- --live
npm run measure     -- --live          # 16 req/s pacing; re-run on drift
TEST_SERVER_URL=https://parseapi.back4app.com GRAPHQL_URL=https://parseapi.back4app.com/graphql npm test
npm run budget
```

MIT · Back4app Engineering
