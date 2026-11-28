/* Spec 118 T507 (FR-006; spec 076 FR-155, FR-156): the update request's own session, proven in real Electron through a recording proxy.
   Not in `npm test` (it starts Electron); Linux only (the system proxy is set through the environment, which Chromium reads on a
   desktop other than GNOME or KDE). Run it under the Electron lock after `npm run build`:

     el.sh xvfb-run -a node scripts/check-118-update-session.js

   It is not the app: it loads the built `dist/main/netget.js` in a bare Electron main process, with a temporary user-data folder.
   A tiny proxy on 127.0.0.1 (an ephemeral port) records each request line and its User-Agent and answers 502, so no request
   reaches GitHub or any other host; Chromium's host resolver also refuses every name (`--host-resolver-rules`), so a request that
   skipped the proxy fails instead of going out. Two Electron runs:
     system           the system proxy from the environment (https_proxy), as spec 076 FR-155's default `system` mode;
     default-setproxy `setProxy` on the default session only (the mechanism FR-155 names for an organization's proxy).
   In each, the existing spec 081 version lookup (default session) and the update request (`updateFeedGet()`) are made once.
   Pass: the proxy saw `CONNECT api.github.com:443` with exactly `User-Agent: AgentDurbar` and nothing else from the update session,
   and the lookup's connect line too. The default session of this bare Electron also fetches a spell checker dictionary
   (redirector.gvt1.com): printed, not asserted (it is not the update session). */
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SLUG = 'three-feathers/agent-durbar';
const LIST = `https://api.github.com/repos/${SLUG}/releases?per_page=30`;
const LOOKUP = 'https://downloads.claude.ai/claude-code-releases/stable';

async function child() {
  const { app, session } = require('electron');
  const fs = require('fs');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-t507-'));
  app.setPath('userData', tmp);
  await app.whenReady();
  const out = { phase: process.env.T507_PHASE };
  try {
    if (out.phase === 'default-setproxy') await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${process.env.T507_PORT}` });
    const netget = require(path.join(ROOT, 'dist', 'main', 'netget.js'));
    out.defaultResolves = await session.defaultSession.resolveProxy(LIST);
    out.lookup = await netget.makeLookupGet(netget.electronRequestFactory())(LOOKUP, { method: 'GET', maxBytes: 64, timeoutMs: 10000 })
      .then((r) => ({ kind: r.kind, status: r.status }), (e) => ({ error: String(e && e.message) }));
    out.update = await netget.updateFeedGet()(LIST, SLUG);
    out.updateResolves = await session.fromPartition(netget.UPDATE_PARTITION).resolveProxy(LIST);
  } catch (e) {
    out.error = String(e && e.stack);
  }
  process.stdout.write('T507-RESULT ' + JSON.stringify(out) + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(0);
}

function startProxy() {
  const net = require('net');
  const lines = [];
  const server = net.createServer((s) => {
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.slice(0, end).split('\r\n');
      const ua = head.find((h) => /^user-agent:/i.test(h));
      const cookie = head.find((h) => /^cookie:/i.test(h));
      lines.push({ line: head[0], ua: ua ? ua.slice(ua.indexOf(':') + 1).trim() : undefined, cookie: Boolean(cookie) });
      s.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });
    s.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, lines, close: () => server.close() })));
}

function runPhase(phase, port) {
  const { spawn } = require('child_process');
  const env = { ...process.env, T507_PHASE: phase, T507_PORT: String(port), T507_CHILD: '1' };
  for (const k of ['XDG_CURRENT_DESKTOP', 'DESKTOP_SESSION', 'GNOME_DESKTOP_SESSION_ID', 'KDE_FULL_SESSION', 'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY',
    'http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  if (phase === 'system') { env.https_proxy = `http://127.0.0.1:${port}`; env.http_proxy = env.https_proxy; }
  const args = ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', __filename];
  return new Promise((resolve) => {
    const p = spawn(require('electron'), args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), 60000);
    p.on('close', () => {
      clearTimeout(t);
      const m = out.match(/^T507-RESULT (.*)$/m);
      resolve(m ? JSON.parse(m[1]) : { phase, error: 'no result line' });
    });
  });
}

async function main() {
  const assert = require('assert');
  if (process.platform !== 'linux') { console.log('check-118-update-session: Linux only (the system proxy is set through the environment)'); return; }
  let failed = 0;
  for (const phase of ['system', 'default-setproxy']) {
    const proxy = await startProxy();
    const r = await runPhase(phase, proxy.port);
    proxy.close();
    console.log(`[${phase}] proxy 127.0.0.1:${proxy.port}; default session resolves ${r.defaultResolves}; update session resolves ${r.updateResolves}`);
    console.log(`[${phase}] lookup (default session): ${JSON.stringify(r.lookup)}; update request: ${JSON.stringify(r.update)}`);
    for (const l of proxy.lines) console.log(`[${phase}] proxy saw: ${l.line} | User-Agent: ${l.ua === undefined ? '(none)' : l.ua}${l.cookie ? ' | Cookie: (present)' : ''}`);
    try {
      assert.ok(!r.error, `${phase}: the child ran (${r.error})`);
      const upd = proxy.lines.filter((l) => l.line === 'CONNECT api.github.com:443 HTTP/1.1');
      assert.strictEqual(upd.length, 1, `${phase}: the proxy saw the update request's connect line once (a skipped proxy helper fails here)`);
      assert.strictEqual(upd[0].ua, 'AgentDurbar', `${phase}: the update connect line carries exactly User-Agent: AgentDurbar (default session or default User-Agent fails here)`);
      assert.deepStrictEqual(proxy.lines.filter((l) => l.ua === 'AgentDurbar').map((l) => l.line), ['CONNECT api.github.com:443 HTTP/1.1'],
        `${phase}: the update session made no other request (a new session's spell checker dictionary fetch fails here)`);
      assert.ok(proxy.lines.some((l) => l.line === 'CONNECT downloads.claude.ai:443 HTTP/1.1'), `${phase}: the default session's version lookup went through the same proxy`);
      assert.ok(!proxy.lines.some((l) => l.cookie), `${phase}: no Cookie header on any line the proxy saw`);
      assert.deepStrictEqual(r.update, { ok: false, reason: 'network' }, `${phase}: the update request ended as network (502 from the proxy), nothing fetched`);
      assert.strictEqual(r.updateResolves, r.defaultResolves, `${phase}: the update session resolves the same proxy as the default session`);
      console.log(`[${phase}] ok`);
    } catch (e) {
      failed++;
      console.log(`[${phase}] FAIL: ${e.message}`);
    }
  }
  if (failed) { console.log('check-118-update-session: FAILED'); process.exit(1); }
  console.log('check-118-update-session: all checks passed');
}

if (process.env.T507_CHILD === '1' && process.versions.electron) child();
else main().catch((e) => { console.error(e); process.exit(1); });
