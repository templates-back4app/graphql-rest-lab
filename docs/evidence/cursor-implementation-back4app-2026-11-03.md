# S4 cursor implementation — verified on BACK4APP (amendment S3)

target=back4app serverURL=https://parseapi.back4app.com graphqlURL=https://parseapi.back4app.com/graphql node=v25.8.1 date=2026-11-03T13:00:30.273Z listRows=100 deepPage=10

| Cursor | base64 decodes to | Kind | Offset |
|---|---|---|---|
| page 1, first edge | `arrayconnection:0` | offset-encoded (graphql-relay arrayconnection) | 0 |
| page 1, last edge | `arrayconnection:99` | offset-encoded (graphql-relay arrayconnection) | 99 |
| endCursor before deep page 10 | `arrayconnection:899` | offset-encoded (graphql-relay arrayconnection) | 899 |

Verdict on THIS target: **the auto-generated cursor is OFFSET-ENCODED (graphql-relay `arrayconnection:<offset>`) — a GraphQL cursor here is NOT evidence of keyset pagination, and deep-page cost claims must not assume keyset behavior.**

Scope: this verifies the cursor FORMAT on this target and dataset. The live target's cursors are re-verified
in the live phase (Phase 0 checklist); pagination conclusions are scoped to the tested 1,000-row dataset.
All paginated queries use the stable sort sku ascending + objectId tie-breaker.
