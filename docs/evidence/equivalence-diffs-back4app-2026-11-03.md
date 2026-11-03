# Equivalence diffs — BACK4APP run

target=back4app serverURL=https://parseapi.back4app.com graphqlURL=https://parseapi.back4app.com/graphql node=v25.8.1 date=2026-11-03T12:58:05.528Z listRows=100 deepPage=10

Gate (brief §4.3): a scenario is timed only after both protocols' normalized responses diff EMPTY. Result:
**ALL DIFFS EMPTY — every scenario may be timed**.

| Screen | Reference cell | Compared cells | Diff |
|---|---|---|---|
| S1 | s1-gql | s1-rest | empty |
| S2 | s2-gql | s2-rest-naive, s2-rest-include2, s2-rest-include1 | empty |
| S3 | s3-gql | s3-rest-full, s3-rest-keys | empty |
| S4 page 1 | s4-gql-page1 | s4-rest-page1 | empty |
| S4 deep page | s4-gql-deep-cursor | s4-rest-deep-offset, s4-rest-deep-cumulative, s4-gql-deep-cumulative | empty |
| S5 | database state | s5-rest, s5-gql | empty |

S4 cursor (amendment S3 — verified, not assumed): `{"raw":"YXJyYXljb25uZWN0aW9uOjg5OQ==","decoded":"arrayconnection:899","kind":"offset-encoded (graphql-relay arrayconnection)","offset":899}`

## Per-cell request counts and bytes (derived from executing the fixed shapes — never declared)

Headers are counted per request, repeats included. "wire" figures are socket-attested transport deltas
(status line + headers + framing + body, identity encoding); body figures are decoded body bytes.

| Cell | HTTP requests | req header B | req body B | resp header B | resp body B (decoded) | wire up/down B |
|---|---|---|---|---|---|---|
| s1-rest | 1 | 315 | 0 | 1160 | 1430 | 315/2590 |
| s1-gql | 1 | 350 | 244 | 1082 | 1354 | 594/2436 |
| s2-rest-naive | 22 | 7308 | 0 | 25020 | 7581 | 7308/32601 |
| s2-rest-include2 | 2 | 829 | 0 | 2320 | 7061 | 829/9381 |
| s2-rest-include1 | 1 | 599 | 0 | 1162 | 13684 | 599/14846 |
| s2-gql | 1 | 350 | 467 | 1082 | 2110 | 817/3192 |
| s3-rest-full | 1 | 333 | 0 | 1164 | 143549 | 333/144713 |
| s3-rest-keys | 1 | 358 | 0 | 1162 | 16332 | 358/17494 |
| s3-gql | 1 | 350 | 193 | 1083 | 9453 | 543/10536 |
| s4-rest-page1 | 1 | 358 | 0 | 1162 | 16332 | 358/17494 |
| s4-gql-page1 | 1 | 350 | 284 | 1084 | 13124 | 634/14208 |
| s4-rest-deep-offset | 1 | 367 | 0 | 1162 | 16332 | 367/17494 |
| s4-gql-deep-cursor | 1 | 350 | 310 | 1084 | 13529 | 660/14613 |
| s4-rest-deep-cumulative | 10 | 3668 | 0 | 11620 | 163968 | 3668/175588 |
| s4-gql-deep-cumulative | 10 | 3500 | 3070 | 10840 | 135525 | 6570/146365 |
| s5-rest | 1 | 365 | 20 | 1134 | 40 | 385/1174 |
| s5-gql | 1 | 350 | 222 | 1056 | 80 | 572/1136 |

One equivalence pass = 73 HTTP requests (context build and S5 resets included) — counted into the budget inventory.
