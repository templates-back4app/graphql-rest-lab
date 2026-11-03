# Parity matrix P1–P10 — LOCAL run (both protocols)

target=local serverURL=http://localhost:1353/parse graphqlURL=http://localhost:1353/graphql node=v25.8.1 date=2026-11-03T12:40:37.460Z

House rule: every row records the response BODY assertion and (where it matters) the database state read-back,
not just the status code. Refusal parity = the same caller learns the same amount both ways; P9 records the
differing status/code shapes honestly. **Local evidence only** — the live run of this matrix is the live phase (after Phase 0) and produces its own file.

| # | API | Persona | Attempt | HTTP | code | Body / observation | State | Expected | OK |
|---|---|---|---|---|---|---|---|---|---|
| P1 | rest | anonymous | find Product | 404 | 101 | {"code":101,"error":"Permission denied, user needs to be authenticated."} | — | refused (session required) | yes |
| P1 | graphql | anonymous | find Product | 200 | 101 | Permission denied, user needs to be authenticated. | — | refused (session required) | yes |
| P2 | rest | invalid session | find Product | 400 | 209 | {"code":209,"error":"Invalid session token"} | — | refused (209) | yes |
| P2 | graphql | invalid session | find Product | 400 | — |  | — | refused (209) | yes |
| P3 | rest | alice | GET bob's order by id | 404 | 101 | {"code":101,"error":"Object not found."} | — | not found (101), no data | yes |
| P3 | rest | alice | find bob's order by where | 200 | — | results:0 | — | zero rows | yes |
| P3 | graphql | alice | order(id:) on bob's order | 200 | 101 | Object not found. | — | not found / null, no data | yes |
| P3 | graphql | alice | orders(where:) filter on bob's order | 200 | — | edges:0 count:0 | — | zero rows, identically | yes |
| P4 | rest | alice | GET bob's OrderItem include=order | 200 | — | order field:  | — | pointer data not returned | yes |
| P4 | graphql | alice | orderItem(id:) { order { … } } on bob's item | 200 | — | nested order: null | — | pointer data not returned | yes |
| P5 | rest | alice | create Product | 400 | 119 | {"code":119,"error":"Permission denied for action create on class Product."} | intruder rows in db: 0 | refused | yes |
| P5 | graphql | alice | createProduct mutation | 200 | 119 | Permission denied for action create on class Product. | intruder rows in db: 0 | refused | yes |
| P6 | rest | alice | find AuditLog | 400 | 119 | {"code":119,"error":"Permission denied for action find on class AuditLog."} | — | refused | yes |
| P6 | graphql | alice | auditLogs query | 200 | 119 | Permission denied for action find on class AuditLog. | — | refused | yes |
| P7 | rest | alice | update bob's order | 404 | 101 | {"code":101,"error":"Object not found."} | bob's order status: processing | refused | yes |
| P7 | graphql | alice | updateOrder on bob's order | 200 | 101 | Object not found. | bob's order status: processing | refused | yes |
| P8 | graphql | anonymous | introspection __schema | 200 | — | custom classes revealed: Product, Order, OrderItem, AuditLog | — | to measure (recorded, not asserted) | yes |
| P8 | graphql | alice | introspection __schema | 200 | — | custom classes revealed: Product, Order, OrderItem, AuditLog | — | to measure (recorded, not asserted) | yes |
| P8 | rest | — | no REST equivalent of introspection | — | — | structural difference: REST exposes no schema query to clients | — | recorded as a difference | yes |
| P9 | rest | anonymous | P1 refusal verbatim | 404 | 101 | {"code":101,"error":"Permission denied, user needs to be authenticated."} | — | recorded verbatim | yes |
| P9 | graphql | anonymous | P1 refusal verbatim | 200 | 101 | Permission denied, user needs to be authenticated. | — | recorded verbatim (incl. GraphQL's 200-with-errors convention if observed) | yes |
| P10 | rest | alice | read own order (field-by-field) | 200 | — | {"objectId":"3YxOtKkg0L","createdAt":"2026-11-03T12:39:55.857Z","updatedAt":"2026-11-03T12:39:56.576Z","number":"ORD-0000","status":"processing","totalCents":10 | — | succeeds, fields match seed | yes |
| P10 | graphql | alice | read own order (field-by-field) | 200 | — | {"order":{"number":"ORD-0000","customerName":"Customer 0000","totalCents":1000}} | — | succeeds, fields match seed | yes |
| P10 | rest | alice (owner) | mutate own order + state read-back | 200 | — | {"updatedAt":"2026-11-03T12:40:37.454Z"} | status after: shipped | db status becomes shipped | yes |
| P10 | graphql | alice (owner) | mutate own order + state read-back | 200 | — | {"updateOrder":{"order":{"objectId":"3YxOtKkg0L","status":"shipped"}}} | status after: shipped | db status becomes shipped | yes |

Requests this matrix issued: 28 (counted into the budget inventory).
