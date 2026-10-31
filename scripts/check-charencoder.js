/*
 * The sandboxed encoder window (spec 096 FR-022..FR-026, T033) on synthetic sheets, and the simulator's fake generator (FR-070, T038). No AI credits, no network.
 *   - a transparent sheet and a flat-background sheet give four frames that pass webpcheck, with points inside the bounds;
 *   - a background too uneven to key out, a bleeding panel, undecodable bytes, a size unlike the header's and a non-square sheet are refused, each with its own sentence;
 *   - the window is sandboxed with no Node, its CSP is the spec's, nothing is left after each job, a timeout, a crash and a cancel refuse;
 *   - the session cancels every web request (a local server sees none).
 *
 *   npm run check:ui -- --only check-charencoder     (builds first)
 */
const assert = require('assert');
const http = require('http');
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { helpers } = require('./driver-helpers');
const { sheetPng, encodePng } = require('./fakes/png-sheet');

const DIST = path.join(__dirname, '..', 'dist');
const { encodeSheet, encoderSession, ENCODER_PARTITION } = require(path.join(DIST, 'main', 'charencoder.js'));
const { checkImage } = require(path.join(DIST, 'shared', 'imagecheck.js'));
const { checkFrames, stripChunks, webpInfo } = require(path.join(DIST, 'shared', 'webpcheck.js'));
const { ENCODER_REFUSALS, ENCODER_FAILED, isStoredFace } = require(path.join(DIST, 'shared', 'charrules.js'));

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const others = () => BrowserWindow.getAllWindows().filter((w) => w !== ctx.win);
  const encode = (bytes, opts) => { const h = checkImage(bytes); assert.ok(h.ok, 'the fixture passes the header check'); return encodeSheet(bytes, h, opts); };
  const noneLeft = (what) => assert.strictEqual(others().length, 0, `${what}: the encoder window is gone`);

  // --- good sheets (FR-022..FR-025) ---
  for (const kind of ['transparent', 'flat']) {
    const r = await encode(sheetPng(kind));
    assert.ok(r.ok, `${kind}: encoded (${r.error || ''})`);
    const frames = [r.frames.working, r.frames.waiting, r.frames.resting, r.frames.blink];
    assert.deepStrictEqual(checkFrames(frames), [], `${kind}: the frames pass webpcheck`);
    for (const f of frames) {
      const info = webpInfo(f);
      assert.ok(info.alpha && info.chunks.includes('VP8X') && !info.chunks.includes('ICCP'), `${kind}: alpha kept, no ICC chunk: ${info.chunks}`);
    }
    for (const p of ['working', 'waiting', 'resting']) assert.ok(isStoredFace(r.face[p]), `${kind}: ${p} point ${r.face[p]} keeps the crop inside`);
    assert.ok(Math.abs(r.face.working[0] - 176) <= 12, `${kind}: the centred bust's point is near the middle: ${r.face.working}`);
    noneLeft(kind);
  }

  // --- refusals, each with its own sentence (FR-022, FR-024, FR-026; fail closed: coordinator's choice of 2026-10-31) ---
  const refused = async (what, bytes, want, header) => {
    const h = header || checkImage(bytes);
    const r = await encodeSheet(bytes, h);
    assert.ok(!r.ok, `${what}: refused`);
    assert.strictEqual(r.error, want, `${what}: the sentence`);
    noneLeft(what);
  };
  await refused('noisy background', sheetPng('noisy'), ENCODER_REFUSALS.background);
  await refused('bleeding panels', sheetPng('bleeding'), ENCODER_REFUSALS.separate);
  await refused('undecodable', sheetPng('undecodable'), ENCODER_REFUSALS.decode);
  await refused('a size unlike the header', sheetPng('transparent', 512), ENCODER_REFUSALS.size, { width: 1024, height: 1024 });
  await refused('not square', encodePng(1024, 512, new Uint8Array(1024 * 512 * 4)), ENCODER_REFUSALS.separate);

  // --- the window itself (FR-022): read while a job is open ---
  let seen = null;
  const onWin = (_e, w) => {
    w.webContents.once('did-finish-load', () => {
      seen = { prefs: w.webContents.getLastWebPreferences(), visible: w.isVisible(), partition: w.webContents.session === encoderSession() };
    });
  };
  app.on('browser-window-created', onWin);
  const inPage = new Promise((resolve) => {
    const once = (_e, w) => {
      app.removeListener('browser-window-created', once);
      // polled: the page exists only once main has written it, and the job's reply destroys the window
      const look = () => {
        if (w.isDestroyed()) return resolve(null);
        w.webContents.executeJavaScript(`({node:typeof require,proc:typeof process,bridge:Object.keys(window).filter(k=>/^(durbar|agentdurbar|electron|ipc)/i.test(k)&&k!=='DurbarCharEncoder'),csp:(document.querySelector('meta[http-equiv]')||{}).content||null,scripts:document.scripts.length,api:typeof DurbarCharEncoder})`)
          .then((v) => { if (v.api === 'object') resolve(v); else setTimeout(look, 5); }).catch(() => (w.isDestroyed() ? resolve(null) : setTimeout(look, 5)));
      };
      look();
    };
    app.on('browser-window-created', once);
  });
  const job = await encode(sheetPng('transparent'));
  app.removeListener('browser-window-created', onWin);
  assert.ok(job.ok, 'the watched job worked');
  assert.ok(seen, 'the watched window loaded');
  assert.strictEqual(seen.visible, false, 'hidden');
  assert.strictEqual(seen.partition, true, 'it uses the encoder session');
  assert.strictEqual(seen.prefs.sandbox, true, 'sandbox on');
  assert.strictEqual(seen.prefs.contextIsolation, true, 'context isolation on');
  assert.strictEqual(seen.prefs.nodeIntegration, false, 'no Node');
  const page = await inPage;
  assert.ok(page, 'the page was read during the job');
  assert.strictEqual(page.node, 'undefined', 'no require in the page');
  assert.strictEqual(page.proc, 'undefined', 'no process in the page');
  assert.deepStrictEqual(page.bridge, [], 'nothing is bridged into the page');
  assert.strictEqual(page.csp, "default-src 'none'; img-src data: blob:", 'the CSP is the spec\'s');
  assert.strictEqual(page.scripts, 0, 'the fixed page has no script tag');
  assert.strictEqual(ENCODER_PARTITION.startsWith('persist:'), false, 'the session is in memory');

  // --- a timeout, a crash and a cancel refuse, and leave nothing (FR-022) ---
  const big = sheetPng('flat');
  let r = await encode(big, { timeoutMs: 1 });
  assert.ok(!r.ok && r.error === ENCODER_FAILED, 'a timeout refuses');
  noneLeft('timeout');
  const crashed = new Promise((resolve) => {
    app.once('browser-window-created', (_e, w) => { w.webContents.once('did-finish-load', () => { w.webContents.forcefullyCrashRenderer(); resolve(true); }); });
  });
  // the crash itself must end the job: a limit far past this wait, so a missed crash fails here and not by the job's own time limit
  r = await Promise.race([encode(big, { timeoutMs: 600_000 }), new Promise((res) => setTimeout(() => res('still waiting'), 60_000))]);
  assert.notStrictEqual(r, 'still waiting', 'a crash ends the job at once');
  assert.ok(await crashed, 'the job window was crashed');
  assert.ok(!r.ok && r.error === ENCODER_FAILED, 'a crash refuses');
  noneLeft('crash');
  const ac = new AbortController();
  const cancelled = encode(big, { signal: ac.signal });
  ac.abort();
  r = await cancelled;
  assert.ok(!r.ok, 'a cancel refuses');
  noneLeft('cancel');

  // --- the session cancels every web request: a local server sees none (the CSP alone would hide this in the page, so it is asked through the session) ---
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.end('x'); });
  server.on('connection', (s) => s.resume());
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const answer = await encoderSession().fetch(url).then(() => 'answered', (e) => String(e.message || e));
  assert.notStrictEqual(answer, 'answered', 'the request failed');
  assert.strictEqual(hits, 0, 'the server saw no request');
  await new Promise((res) => server.close(res));

  // --- the simulator's fake generator goes through the renderer's bridge (FR-070, T038) ---
  await H.load({ w: 1280, h: 800, ready: 'fit', settle: false, query: { simkinds: 'mixed', simfast: '1' } });
  const sim = await H.js(`(async()=>{const b=window.__durbarSimUi.bridge();const out={};
    const gen=await b.characterGenerate('a tall woman with round glasses','codex');out.gen={ok:gen.ok,tryId:gen.tryId,face:gen.face,notes:gen.notes,took:gen.tookMs,sizes:Object.fromEntries(Object.entries(gen.frames||{}).map(([k,v])=>[k,v.length]))};
    out.frames=Object.fromEntries(Object.entries(gen.frames||{}).map(([k,v])=>[k,Array.from(v)]));
    out.short=await b.characterGenerate('a','codex');
    out.other=await b.characterGenerate('a tall woman','claude');
    const saved=await b.characterSave(gen.tryId,'  ');out.saved=saved;
    out.list=await b.characterList();
    out.again=await b.characterSave(gen.tryId,'x');
    out.bad=await b.characterRename(saved.id,'a\\u0007b');out.bad2=await b.characterRename('../x','b');
    out.rename=await b.characterRename(saved.id,'Greta <B>');
    const running=b.characterGenerate('another person entirely','codex');const c=await b.characterCancel();out.cancel={c,r:await running};
    out.pin=await b.characterPin('/w/a',saved.id);out.del=await b.characterDelete(saved.id);out.after=await b.characterList();
    out.ideas=(await b.characterIdeas()).length;
    const caps=(await b.listAdapters()).map(a=>[a.id,!!(a.capabilities&&a.capabilities.imageGen)]);out.caps=caps;
    return out;})()`);
  assert.ok(sim.gen.ok && /^[0-9a-f]+$/.test(sim.gen.tryId), 'the fake makes a character');
  const simFrames = ['working', 'waiting', 'resting', 'blink'].map((k) => stripChunks(Uint8Array.from(sim.frames[k])));
  assert.deepStrictEqual(checkFrames(simFrames), [], 'the fake frames pass webpcheck');
  assert.ok(sim.gen.face && Array.isArray(sim.gen.notes) && sim.gen.took >= 100, 'the fake waits, then answers like main');
  assert.ok(!sim.short.ok && !sim.other.ok, 'a short description and an adapter with no imageGen are refused');
  assert.ok(sim.saved.ok && /^my-[0-9a-f]{12}$/.test(sim.saved.id) && sim.saved.name === 'My character 1', 'an empty name gets My character N: ' + JSON.stringify(sim.saved));
  assert.strictEqual(sim.list.length, 1);
  assert.ok(!sim.again.ok, 'a try saves once');
  assert.ok(!sim.bad.ok && !sim.bad2.ok, 'a control character and an unknown id are refused');
  assert.strictEqual(sim.rename.name, 'Greta B', 'angle brackets are removed');
  assert.ok(sim.cancel.c.ok && !sim.cancel.r.ok && sim.cancel.r.cancelled, 'cancel with no id ends the running generation');
  assert.ok(sim.pin.ok && sim.del.ok && sim.del.pinsRemoved === 1 && sim.after.length === 0, 'delete removes the character and counts its pin');
  assert.strictEqual(sim.ideas, 24);
  const caps = Object.fromEntries(sim.caps);
  assert.strictEqual(caps.codex, true, 'the simulator\'s Codex has imageGen');
  assert.ok(sim.caps.filter(([id]) => id !== 'codex').every(([, v]) => v === false), 'the others do not');
  console.log('check-charencoder: ok');
};
