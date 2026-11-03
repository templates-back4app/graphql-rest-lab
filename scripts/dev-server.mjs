// File: scripts/dev-server.mjs · local parse-server ^7 with the Postgres adapter, the same Cloud Code as a
// Back4app deploy, AND the auto-generated GraphQL API mounted locally (parse-server's ParseGraphQLServer) so
// the whole REST-vs-GraphQL matrix proves out locally before any live run.
//   npm run dev:server → REST    http://localhost:1353/parse
//                        GraphQL http://localhost:1353/graphql
//                        database postgres://localhost:5433/gql_dev
// Imported by the tests, which start their own instance on a free port and the database gql_test.
// Needs a Postgres listening on 5433 (brew: postgresql@17 — the same instance the sibling labs use; distinct
// database names). The database is created with `createdb` if missing.
//
// LOCAL GraphQL ≠ LIVE availability: that this server mounts /graphql says nothing about the live plan.
// Phase 0 (the coordinator's step) owns the live story; the build diary records the one live datapoint
// observed so far (2026-11-03 coordinator probe) and what is still unverified.
//
// Setup gate: cloud/config.js ships DISABLED (SETUP_ENABLED and SETUP_TOKEN_SHA256 both unset). The LOCAL
// server turns the helpers on with the fixed local token below — not secrets here, the server only listens on
// localhost. Tests that prove the disabled/tokenless halves override these variables in their own processes
// BEFORE importing this module.
import express from 'express';
import { execFileSync } from 'node:child_process';
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LOCAL, ROOT, loadDotEnv, sha256hex } from './lib/env.mjs';

const PG_BIN = [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);

export function ensureDatabase(databaseURI) {
  const u = new URL(databaseURI);
  const dbName = u.pathname.replace(/^\//, '');
  const dir = PG_BIN.find((d) => existsSync(path.join(d, 'createdb')));
  if (!dir) { console.warn(`createdb not found in ${PG_BIN.join(', ')} (set PG_BIN) — assuming ${dbName} exists`); return; }
  const common = ['-h', u.hostname, '-p', u.port || '5432', ...(u.username ? ['-U', u.username] : [])];
  const list = execFileSync(path.join(dir, 'psql'), [...common, '-lqt'], { encoding: 'utf8' });
  if (list.split('\n').some((l) => l.split('|')[0].trim() === dbName)) return;
  execFileSync(path.join(dir, 'createdb'), [...common, dbName], { stdio: 'inherit' });
  console.log(`created database ${dbName}`);
}

/** Starts parse-server + express + the GraphQL endpoint. Returns { server, http, url, graphqlUrl, close() }. */
export async function startServer({ port = LOCAL.PORT, databaseURI = LOCAL.DATABASE_URL, quiet = false } = {}) {
  // Local default: administrative helpers ON with the fixed local token (see header). ??= so a test process
  // that set SETUP_ENABLED='0' or a different token keeps its value.
  process.env.SETUP_ENABLED ??= '1';
  process.env.SETUP_TOKEN_SHA256 ??= sha256hex(LOCAL.SETUP_TOKEN);

  ensureDatabase(databaseURI);
  const serverURL = `http://localhost:${port}/parse`;
  const graphqlUrl = `http://localhost:${port}/graphql`;
  const { ParseServer, ParseGraphQLServer } = await import('parse-server'); // after the env defaults above

  const parseOptions = {
    appId: LOCAL.APP_ID,
    javascriptKey: LOCAL.JS_KEY,
    restAPIKey: LOCAL.REST_KEY,
    masterKey: LOCAL.MASTER_KEY,
    serverURL,
    databaseURI,
    cloud: path.join(ROOT, 'cloud', 'main.js'),
    appName: 'graphql-rest-lab (local)',
    // Mirrors the Back4app settings that matter for the matrix; any difference found on the live run is a
    // finding for docs/evidence/local-vs-live.md (live phase).
    allowClientClassCreation: false,
    enableAnonymousUsers: false, // personas sign up with username/password; "anonymous" = no session at all
    enforcePrivateUsers: true,
    allowExpiredAuthDataToken: false,
    masterKeyIps: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
    logLevel: quiet ? 'error' : (process.env.PARSE_LOG_LEVEL || 'info'),
    silent: quiet,
    verbose: process.env.PARSE_VERBOSE === '1',
  };
  const server = new ParseServer(parseOptions);
  // graphQLPublicIntrospection: OSS parse-server 7 DEFAULTS to refusing introspection for non-master callers
  // ("Introspection is not allowed", HTTP 403 — observed locally 2026-11-03), while the live Back4app endpoint
  // ANSWERED an anonymous-key introspection probe (coordinator, 2026-11-03). The local server mirrors the
  // observed live behavior so P8 records what introspection reveals; the OSS-default divergence itself is a
  // finding, recorded in the parity evidence and the build diary, and Phase 0 re-verifies the live side.
  const graphQLServer = new ParseGraphQLServer(server, { graphQLPath: '/graphql', graphQLPublicIntrospection: true });

  const app = express();
  app.disable('x-powered-by');
  // COUNT_REQUESTS=1 (budget inventory, amendment C4): count every HTTP request this in-process server
  // handles, split REST vs GraphQL, and append one JSON line per server lifetime to
  // docs/notes/.request-counts.jsonl, tagged with the process that started it. `npm run budget` reads them.
  let requestCount = null;
  if (process.env.COUNT_REQUESTS === '1') {
    requestCount = { total: 0, graphql: 0 };
    app.use((req, _res, next) => { requestCount.total++; if (req.path.startsWith('/graphql')) requestCount.graphql++; next(); });
  }
  if (!quiet) {
    app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`); next(); });
  }
  app.use('/parse', server.app);
  graphQLServer.applyGraphQL(app); // the auto-generated GraphQL API, same mount the platform exposes live
  // Listen first: start() probes serverURL over HTTP and warns "Unable to connect" if nothing answers yet.
  const http = await new Promise((resolve) => { const h = app.listen(port, () => resolve(h)); });
  await server.start();
  const startedAt = Date.now();
  if (!quiet) console.log(`parse-server ${version()} · REST ${serverURL} · GraphQL ${graphqlUrl} · db ${databaseURI} · cloud/main.js mounted`);
  return {
    server, http, url: serverURL, graphqlUrl, databaseURI,
    close: async () => {
      // parse-server probes serverURL/health ~1 s after mount; a suite faster than that would log a spurious warning.
      await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (Date.now() - startedAt))));
      await new Promise((r) => { http.close(r); if (http.closeAllConnections) http.closeAllConnections(); });
      await server.handleShutdown();
      if (requestCount) {
        const dir = path.join(ROOT, 'docs', 'notes');
        mkdirSync(dir, { recursive: true });
        appendFileSync(path.join(dir, '.request-counts.jsonl'),
          JSON.stringify({ suite: path.basename(process.argv[1] || 'unknown'), requests: requestCount.total, graphql: requestCount.graphql, at: new Date().toISOString() }) + '\n');
      }
    },
  };
}

function version() {
  try { return createRequire(import.meta.url)('parse-server/package.json').version; } catch { return ''; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts', 'dev-server.mjs')) {
  loadDotEnv();
  startServer({ databaseURI: process.env.DATABASE_URL || LOCAL.DATABASE_URL }).catch((e) => { console.error(e); process.exit(1); });
}
