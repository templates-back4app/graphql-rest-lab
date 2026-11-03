// File: scripts/cursor-verify.mjs · Node 22 ESM
// Amendment S3: what the auto-generated GraphQL cursor ACTUALLY is — offset-encoded or keyset — is verified
// before any pagination claim. This script decodes real cursors from the target and demonstrates the
// behavioral consequence (an offset cursor addresses a POSITION, not a row: rows inserted/removed before the
// cursor shift what it points at — demonstrated here only by decoding; the row-shift experiment would mutate
// the dataset and is deliberately left out of the shared-dataset run). Writes
// docs/evidence/cursor-implementation-<target>-<date>.md.
// Usage: node scripts/cursor-verify.mjs [--local|--live]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, target, args } from './lib/env.mjs';
import { makeTransport } from './lib/transport.mjs';
import { makeRecorder, buildContext, harvestDeepCursor, decodeCursor, GQL } from './lib/shapes.mjs';
import { evidenceMd, environmentLine, targetLabel } from './lib/stats.mjs';

const a = args();
const env = target(a);
const transport = makeTransport(env);
const c = makeRecorder(transport, env);
const creds = JSON.parse(readFileSync(path.join(ROOT, '.credentials.local.json'), 'utf8'));
const ctx = await buildContext(c, env, { alice: creds.alice });

// First page: decode the first and last edge cursors.
const page1 = await c.gql(GQL.s4page, { first: ctx.listRows, after: null }, { session: ctx.session });
if (page1.rec.failed) { console.error('page 1 failed', page1.errors); process.exit(1); }
const edges = page1.data.products.edges;
const samples = [
  { which: 'page 1, first edge', ...decodeCursor(edges[0].cursor) },
  { which: 'page 1, last edge', ...decodeCursor(edges[edges.length - 1].cursor) },
];
const harvest = await harvestDeepCursor(c, ctx);
samples.push({ which: `endCursor before deep page ${ctx.deepPage}`, ...decodeCursor(harvest.deepCursor) });
transport.close();

const allOffset = samples.every((s) => s.kind.startsWith('offset-encoded'));
const md = evidenceMd('cursor-implementation', env);
md.write(`# S4 cursor implementation — verified on ${targetLabel(env).toUpperCase()} (amendment S3)

${environmentLine(env, `listRows=${ctx.listRows} deepPage=${ctx.deepPage}`)}

| Cursor | base64 decodes to | Kind | Offset |
|---|---|---|---|
${samples.map((s) => `| ${s.which} | \`${s.decoded}\` | ${s.kind} | ${s.offset ?? '—'} |`).join('\n')}

Verdict on THIS target: **${allOffset
    ? 'the auto-generated cursor is OFFSET-ENCODED (graphql-relay `arrayconnection:<offset>`) — a GraphQL cursor here is NOT evidence of keyset pagination, and deep-page cost claims must not assume keyset behavior'
    : 'cursors did NOT decode to the graphql-relay offset format — inspect before any pagination claim'}.**

Scope: this verifies the cursor FORMAT on this target and dataset. The live target's cursors are re-verified
in the live phase (Phase 0 checklist); pagination conclusions are scoped to the tested ${ctx.listRows * ctx.deepPage >= 1000 ? '1,000' : String(ctx.listRows * ctx.deepPage)}-row dataset.
All paginated queries use the stable sort sku ascending + objectId tie-breaker.
`);
console.log(`cursor: ${allOffset ? 'offset-encoded (verified)' : 'UNEXPECTED format'} → ${md.rel}`);
