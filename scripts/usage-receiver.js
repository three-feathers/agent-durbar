#!/usr/bin/env node
/*
 * Spec 008 FR-181: a tiny local receiver for Claude Code's OpenTelemetry metrics (OTLP/HTTP JSON), node:http only.
 *
 *   DURBAR_USAGE_MACHINE=linux node scripts/usage-receiver.js [--port 4318] [--dir <folder>]
 *
 * Listens on 127.0.0.1 only, `POST /v1/metrics`. Adds the documented token and cost metrics up per UTC day, model and token type
 * (and per main/subagent source) and writes only those sums to `<dir>/usage-<machine>.json` (default dir `<home>/.durbar-usage`).
 * Every attribute except `type`, `model` and `query_source` is dropped unread, so no email, user, account, organization or session id
 * can be kept (usage-lib.js). The machine label is the one you set, never the host name. No dependency, no outgoing connection.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const lib = require('./usage-lib');

const MAX_BODY = 1024 * 1024; // bytes on the wire and after gunzip
const DEFAULT_PORT = 4318;
const LOOPBACK = '127.0.0.1';

function defaultDir() { return path.join(os.homedir(), '.durbar-usage'); }

function parseArgs(argv, env = process.env) {
  const o = { port: env.DURBAR_USAGE_PORT !== undefined ? env.DURBAR_USAGE_PORT : DEFAULT_PORT, dir: env.DURBAR_USAGE_DIR || defaultDir(), machine: env.DURBAR_USAGE_MACHINE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '--dir') {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument ${a}`);
  }
  const port = Number(o.port);
  if (!/^\d{1,5}$/.test(String(o.port)) || port > 65535) throw new Error('--port must be 0..65535');
  o.port = port;
  o.machine = lib.checkMachine(o.machine);
  return o;
}

/** Write `text` to `file` through a temporary file in the same folder, then rename (atomic on one volume); owner-only where the OS has modes. */
function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* none */ }
    throw e;
  }
}

/** The state stored in `file`, so a restart carries on; a missing file starts empty; an unreadable or wrong one throws (it is never overwritten). */
function loadState(file, machine) {
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > lib.MAX_FILE_BYTES) throw new Error(`${path.basename(file)} is not a usage file`);
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return lib.emptyState(machine);
    throw e;
  }
  const st = lib.validateState(JSON.parse(text), path.basename(file));
  if (st.machine !== machine) throw new Error(`${path.basename(file)} belongs to machine "${st.machine}"`);
  return st;
}

/** `handle(rawBuffer, contentEncoding)` -> `{status, body}`; pure apart from the file write. */
function createService(opts) {
  fs.mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
  const file = path.join(opts.dir, `usage-${opts.machine}.json`);
  const state = loadState(file, opts.machine);
  const now = opts.now || Date.now;
  function handle(buf, encoding) {
    if (buf.length > MAX_BODY) return { status: 413, body: { error: 'body too large' } };
    let raw = buf;
    const enc = String(encoding || 'identity').toLowerCase();
    if (enc === 'gzip') {
      try { raw = zlib.gunzipSync(buf, { maxOutputLength: MAX_BODY }); } catch { return { status: 413, body: { error: 'bad or too large gzip body' } }; }
    } else if (enc !== 'identity') return { status: 415, body: { error: 'content-encoding must be identity or gzip' } };
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { return { status: 400, body: { error: 'body is not JSON' } }; }
    // ingest into a copy, so a body that throws half-way changes nothing
    const trial = JSON.parse(JSON.stringify(state));
    let res;
    try { res = lib.ingest(trial, parsed, now()); } catch { return { status: 400, body: { error: 'not an OTLP metrics body' } }; }
    if (res.tokens + res.costs > 0) {
      try { atomicWrite(file, JSON.stringify(trial) + '\n'); } catch { return { status: 500, body: { error: 'could not write the usage file' } }; }
      state.days = trial.days;
    }
    return { status: 200, body: {} };
  }
  return { handle, file, state };
}

function createServer(opts) {
  const svc = createService(opts);
  const server = http.createServer((req, res) => {
    const reply = (status, body, close = false) => {
      res.writeHead(status, close ? { 'content-type': 'application/json', connection: 'close' } : { 'content-type': 'application/json' });
      res.end(JSON.stringify(body), close ? () => req.destroy() : undefined); // an oversize body is not read on: the socket goes once the answer is out
    };
    const url = (req.url || '').split('?')[0];
    if (url !== '/v1/metrics') { req.resume(); return reply(404, { error: 'not found' }); }
    if (req.method !== 'POST') { req.resume(); return reply(405, { error: 'POST only' }); }
    // a web page cannot send this content type to us without a preflight we never answer; Host must be loopback (DNS rebinding)
    if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) { req.resume(); return reply(415, { error: 'application/json only' }); }
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(req.headers.host || ''))) { req.resume(); return reply(403, { error: 'loopback host only' }); }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY) return void reply(413, { error: 'body too large' }, true);
    const chunks = []; let size = 0; let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) { over = true; reply(413, { error: 'body too large' }, true); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (over) return; const r = svc.handle(Buffer.concat(chunks), req.headers['content-encoding']); reply(r.status, r.body); });
    req.on('error', () => { /* the client went away */ });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, svc };
}

/** The one place that binds: loopback only, never another interface. */
function listen(server, port, cb) { server.listen(port, LOOPBACK, cb); }

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`usage-receiver: ${e.message}`); process.exit(2); }
  let made;
  try { made = createServer(o); } catch (e) { console.error(`usage-receiver: ${e.message}`); process.exit(1); }
  made.server.on('error', (e) => { console.error(`usage-receiver: ${e.code || e.message}`); process.exit(1); });
  listen(made.server, o.port, () => {
    console.log(`usage-receiver: machine "${o.machine}", listening on 127.0.0.1:${made.server.address().port}, writing ${made.svc.file}`);
  });
}

module.exports = { listen, parseArgs, createServer, createService, atomicWrite, loadState, defaultDir, MAX_BODY, DEFAULT_PORT };
if (require.main === module) main();
