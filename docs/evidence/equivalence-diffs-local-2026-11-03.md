# Equivalence diffs — LOCAL run

target=local serverURL=http://localhost:1353/parse graphqlURL=http://localhost:1353/graphql node=v25.8.1 date=2026-11-03T12:41:13.848Z listRows=100 deepPage=10

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
| s1-rest | 1 | 269 | 0 | 676 | 1430 | 269/2106 |
| s1-gql | 1 | 298 | 244 | 247 | 1354 | 542/1601 |
| s2-rest-naive | 22 | 6296 | 0 | 14832 | 7581 | 6296/22413 |
| s2-rest-include2 | 2 | 737 | 0 | 1352 | 7061 | 737/8413 |
| s2-rest-include1 | 1 | 553 | 0 | 678 | 13684 | 553/14362 |
| s2-gql | 1 | 298 | 467 | 247 | 2110 | 765/2357 |
| s3-rest-full | 1 | 287 | 0 | 680 | 143549 | 287/144229 |
| s3-rest-keys | 1 | 312 | 0 | 678 | 16332 | 312/17010 |
| s3-gql | 1 | 298 | 193 | 248 | 9453 | 491/9701 |
| s4-rest-page1 | 1 | 312 | 0 | 678 | 16332 | 312/17010 |
| s4-gql-page1 | 1 | 298 | 284 | 249 | 13124 | 582/13373 |
| s4-rest-deep-offset | 1 | 321 | 0 | 678 | 16332 | 321/17010 |
| s4-gql-deep-cursor | 1 | 298 | 310 | 249 | 13529 | 608/13778 |
| s4-rest-deep-cumulative | 10 | 3208 | 0 | 6780 | 163968 | 3208/170748 |
| s4-gql-deep-cumulative | 10 | 2980 | 3070 | 2490 | 135525 | 6050/138015 |
| s5-rest | 1 | 319 | 20 | 673 | 40 | 339/713 |
| s5-gql | 1 | 298 | 222 | 244 | 80 | 520/324 |

One equivalence pass = 73 HTTP requests (context build and S5 resets included) — counted into the budget inventory.
