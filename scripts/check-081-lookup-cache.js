/* Spec 081 FR-466 (issue 2059): Chromium's HTTP cache in real Electron, through the real request factory. Not in `npm test` (it
   starts Electron). Run it under the Electron lock after `npm run build`:

     el.sh xvfb-run -a node scripts/check-081-lookup-cache.js

   A server on 127.0.0.1 (ephemeral port) answers every request with `Cache-Control: max-age=3600` and a counter in the body; no
   request leaves the machine. Through `electronRequestFactory()` (net.request on the default session, the layer `makeLookupGet`
   builds on) two GETs in a row are made with the options `makeLookupGet` passes: without `cache` the second one must be answered
   from the cache (the server sees one request: the bug), with `cache: 'no-store'` the server must see two. `makeLookupGet` itself
   refuses a loopback address (FR-026's allow-list; no host exception is added), so its option is asserted in
   `scripts/test-updatecheck.ts`, and this script proves what Electron does with that option. */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

function get(factory, url, extra) {
  return new Promise((resolve, reject) => {
    const req = factory({ method: 'GET', url, redirect: 'manual', credentials: 'omit', useSessionCookies: false, ...extra });
    req.on('response', (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const { app } = require('electron');
  const fs = require('fs');
  const os = require('os');
  const http = require('http');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-081-cache-'));
  app.setPath('userData', tmp);
  await app.whenReady();
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'max-age=3600' });
    res.end(`v${hits}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const netget = require(path.join(ROOT, 'dist', 'main', 'netget.js'));
  const factory = netget.electronRequestFactory();
  const result = {};
  try {
    for (const [name, extra] of [['default', {}], ['no-store', { cache: 'no-store' }]]) {
      hits = 0;
      const a = await get(factory, `${base}/${name}`, extra);
      const b = await get(factory, `${base}/${name}`, extra);
      result[name] = { answers: [a, b], serverHits: hits };
    }
  } catch (e) { result.error = String(e && e.stack); }
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = !result.error && result.default.serverHits === 1 && result['no-store'].serverHits === 2 && result['no-store'].answers[1] === 'v2';
  console.log('081-lookup-cache ' + JSON.stringify(result));
  console.log(ok ? '081-lookup-cache: ok (cache answers the second GET without the option; no-store reaches the server twice)' : '081-lookup-cache: FAILED');
  app.exit(ok ? 0 : 1);
}
main();
