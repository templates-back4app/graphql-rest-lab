// File: scripts/lib/transport.mjs · Node 22 ESM
// The instrumented HTTP client every measured request goes through — BOTH protocols, so the transport is held
// constant (one node:http(s) agent, keep-alive, ONE socket, sequential requests, no automatic compression
// negotiation: `Accept-Encoding: identity` is sent explicitly on every request so the compression setting is a
// held factor, not noise).
//
// Byte counting (brief amendment S4):
//   wire.up / wire.down   — per-request deltas of the SOCKET's bytesWritten/bytesRead counters: transport-level
//                           figures that include status line, headers, framing and body as they crossed the
//                           socket. `wire.attested` is true only when the delta is attributable (same socket,
//                           sequential use); anything else must be labeled "decoded body bytes", never "wire".
//   bytes.requestHeaders  — exact bytes of the request head Node wrote (req._header).
//   bytes.requestBody     — body bytes sent (what the protocol itself costs in the request direction: the
//                           GraphQL query text, the REST JSON body; a REST GET sends 0).
//   bytes.responseHeaders — reconstructed from the status line + rawHeaders (exact for HTTP/1.1, no folding).
//   bytes.responseBody    — DECODED body bytes (Buffer length as received; identity encoding locally).
// Headers are counted PER REQUEST, repeats included — totals that ignore repeated headers are not produced.
import http from 'node:http';
import https from 'node:https';

/** makeTransport(env) → sequential instrumented client. NOT safe for concurrent use (by design: one socket). */
export function makeTransport(env) {
  const agents = new Map(); // origin → Agent with maxSockets 1 (sequential ⇒ per-request socket deltas attributable)
  const last = new WeakMap(); // socket → { read, written } counters at the end of the previous request
  let inFlight = false;

  function agentFor(url) {
    const u = new URL(url);
    const key = u.origin;
    if (!agents.has(key)) {
      const A = u.protocol === 'https:' ? https.Agent : http.Agent;
      agents.set(key, new A({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 }));
    }
    return { agent: agents.get(key), isHttps: u.protocol === 'https:', u };
  }

  /**
   * raw(method, url, { headers?, body? (string|Buffer) }) →
   *   { status, statusMessage, headers, rawHeaders, bodyBuffer, text, json, ms, wire, bytes }
   * Never throws on HTTP errors; throws on network failure.
   */
  function raw(method, url, { headers = {}, body } = {}) {
    if (inFlight) throw new Error('transport is sequential by design — await the previous request first');
    inFlight = true;
    const { agent, isHttps, u } = agentFor(url);
    const bodyBuf = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const h = { 'Accept-Encoding': 'identity', ...headers };
    if (bodyBuf) h['Content-Length'] = String(bodyBuf.length);
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      const req = (isHttps ? https : http).request({
        agent, method,
        hostname: u.hostname, port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        headers: h,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ms = performance.now() - t0;
          const bodyBuffer = Buffer.concat(chunks);
          // Node ≥20 may detach res.socket by 'end'; the request object keeps the reference (sequential use,
          // keep-alive agent, maxSockets 1 ⇒ the counters still belong to this request's exchange).
          const socket = res.socket || req.socket;
          let wire = { up: null, down: null, attested: false, reused: false };
          if (socket) {
            const prev = last.get(socket) || { read: 0, written: 0 };
            wire = {
              up: socket.bytesWritten - prev.written,
              down: socket.bytesRead - prev.read,
              attested: true,
              reused: prev.read > 0 || prev.written > 0,
            };
            last.set(socket, { read: socket.bytesRead, written: socket.bytesWritten });
          }
          // Response head, reconstructed exactly (HTTP/1.1: status line + `k: v\r\n` pairs + blank line).
          let respHead = `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\r\n`;
          for (let i = 0; i < res.rawHeaders.length; i += 2) respHead += `${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}\r\n`;
          respHead += '\r\n';
          const text = bodyBuffer.toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = null; }
          inFlight = false;
          resolve({
            status: res.statusCode, statusMessage: res.statusMessage,
            headers: res.headers, rawHeaders: res.rawHeaders,
            bodyBuffer, text, json, ms,
            contentEncoding: res.headers['content-encoding'] || 'identity',
            wire,
            bytes: {
              requestHeaders: req._header ? Buffer.byteLength(req._header, 'utf8') : null,
              requestBody: bodyBuf ? bodyBuf.length : 0,
              responseHeaders: Buffer.byteLength(respHead, 'utf8'),
              responseBody: bodyBuffer.length, // DECODED body bytes (identity locally; label stays "decoded")
            },
          });
        });
        res.on('error', (e) => { inFlight = false; reject(e); });
      });
      req.on('error', (e) => { inFlight = false; reject(e); });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });
  }

  function close() {
    for (const a of agents.values()) a.destroy();
    agents.clear();
  }

  return { raw, close, env };
}

/** The headers both protocols share: app id + JS key (the SAME key header on REST and GraphQL, so the key is
 *  not a varying factor) + optional session. Per-protocol extras (Content-Type on requests with a body) are
 *  added by the callers and show up, itemized, in the per-request byte counts. */
export function parseHeaders(env, { session } = {}) {
  const h = { 'X-Parse-Application-Id': env.APP_ID };
  if (env.JS_KEY) h['X-Parse-Javascript-Key'] = env.JS_KEY;
  else if (env.REST_KEY) h['X-Parse-REST-API-Key'] = env.REST_KEY;
  if (session) h['X-Parse-Session-Token'] = session;
  return h;
}
