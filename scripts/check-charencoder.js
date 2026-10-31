/*
 * The sandboxed encoder window (spec 096 FR-022..FR-026, T033) on synthetic sheets, and the simulator's fake generator (FR-070, T038). No AI credits, no network.
 *   - a transparent sheet and a flat-background sheet give four frames that pass webpcheck, with points inside the bounds;
 *   - a background too uneven to key out, a bleeding panel, undecodable bytes, a size unlike the header's and a non-square sheet are refused, each with its own sentence;
 *   - the window is sandboxed with no Node, its CSP is the spec's, nothing is left after each job, a timeout, a crash and a cancel refuse;
 *   - the session cancels every web request (a local server sees none);
 *   - a hostile page in the real window: inline script, fetch, remote image, remote script and worker each raise a CSP violation, a navigation is refused or ends the window, window.open is refused, no webview, no
 *     permission, no WebRTC UDP. `devTools: false` is checked in `test:charencoder`'s source test only: a hidden window did not open DevTools here either way.
 *
 *   npm run check:ui -- --only check-charencoder     (builds first)
 */
const assert = require('assert');
const http = require('http');
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { helpers } = require('./driver-helpers');
const { sheetPng, encodePng } = require('./fakes/png-sheet');

const DIST = path.join(__dirname, '..', 'dist');
const { createEncoderWindow, encodeSheet, encoderSession, loadEncoderPage, ENCODER_PARTITION } = require(path.join(DIST, 'main', 'charencoder.js'));
const { checkImage } = require(path.join(DIST, 'shared', 'imagecheck.js'));
const { checkFrames, stripChunks, webpInfo } = require(path.join(DIST, 'shared', 'webpcheck.js'));
const { ENCODER_REFUSALS, ENCODER_FAILED, isStoredFace } = require(path.join(DIST, 'shared', 'charrules.js'));

module.exports = async (ctx) => {
  const H = helpers(ctx);
  // the permission handlers have no getter: caught on their way in, before the encoder's first job sets them
  const permission = {};
  const ses = session.fromPartition(ENCODER_PARTITION);
  for (const [name, key] of [['setPermissionRequestHandler', 'request'], ['setPermissionCheckHandler', 'check']]) {
    const real = ses[name].bind(ses);
    ses[name] = (fn) => { permission[key] = fn; return real(fn); };
  }
  const others = () => BrowserWindow.getAllWindows().filter((w) => w !== ctx.win);
  const encode = (bytes, opts) => { const h = checkImage(bytes); assert.ok(h.ok, 'the fixture passes the header check'); return encodeSheet(bytes, h, opts); };
  const noneLeft = (what) => assert.strictEqual(others().length, 0, `${what}: the encoder window is gone`);

  // --- the guards: a page that turned hostile attacks the real window, in its own script, with a user gesture so a popup is not stopped by anything but the guard ---
  {
    let hits = 0;
    const server = http.createServer((req, res) => { hits++; res.end('x'); });
    server.on('connection', (s) => s.resume());
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const base = `http://127.0.0.1:${server.address().port}`;
    const win = createEncoderWindow();
    const wc = win.webContents;
    assert.strictEqual(typeof permission.request, 'function', 'a permission request handler is set');
    assert.strictEqual(typeof permission.check, 'function', 'a permission check handler is set');
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      let answer = null;
      permission.request(null, p, (v) => { answer = v; });
      assert.strictEqual(answer, false, `${p}: a request is refused`);
      assert.strictEqual(permission.check(null, p), false, `${p}: a check is refused`);
    }
    await loadEncoderPage(wc);
    const prefs = wc.getLastWebPreferences();
    assert.notStrictEqual(prefs.webviewTag, true, 'no webview tag');
    assert.strictEqual(await wc.executeJavaScript(`typeof customElements.get('webview')`), 'undefined', 'no webview element in the page');
    assert.strictEqual(wc.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp', 'no WebRTC UDP around the session');
    const seen = await wc.executeJavaScript(`(async()=>{
      const violations=[];
      document.addEventListener('securitypolicyviolation',(e)=>violations.push(e.effectiveDirective));
      const load=(el)=>new Promise((res)=>{el.onload=()=>res('loaded');el.onerror=()=>res('blocked');});
      const out={};
      const inline=document.createElement('script');inline.textContent='window.__inlineRan=1';document.head.appendChild(inline);
      out.inline=window.__inlineRan===1?'ran':'blocked';
      out.fetch=await fetch(${JSON.stringify(base + '/fetch')}).then(()=>'loaded',()=>'blocked');
      const img=new Image();const imgDone=load(img);img.src=${JSON.stringify(base + '/x.png')};out.image=await imgDone;
      /* the control: what the CSP allows still works, so "blocked" above is the CSP's answer and not a broken probe */
      const okImg=new Image();const okDone=load(okImg);okImg.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';out.dataImage=await okDone;
      const sc=document.createElement('script');const scDone=load(sc);sc.src=${JSON.stringify(base + '/x.js')};document.head.appendChild(sc);out.script=await scDone;
      out.worker=await new Promise((res)=>{try{const w=new Worker(URL.createObjectURL(new Blob(['postMessage(1)'],{type:'text/javascript'})));w.onmessage=()=>res('ran');w.onerror=()=>res('blocked');}catch(e){res('blocked');}});
      out.notification=typeof Notification==='undefined'?'none':Notification.permission;
      for(let i=0;i<500&&violations.length<5;i++)await new Promise((r)=>setTimeout(r,10));
      out.violations=violations.slice().sort();
      return out;})()`, true);
    assert.strictEqual(seen.inline, 'blocked', 'an inline script does not run');
    assert.strictEqual(seen.fetch, 'blocked', 'fetch is blocked');
    assert.strictEqual(seen.image, 'blocked', 'a remote image is blocked');
    assert.strictEqual(seen.script, 'blocked', 'a remote script is blocked');
    assert.strictEqual(seen.worker, 'blocked', 'a worker is blocked');
    assert.strictEqual(seen.dataImage, 'loaded', 'the control: a data: image loads');
    assert.notStrictEqual(seen.notification, 'granted', 'no notification permission');
    for (const d of ['connect-src', 'img-src', 'worker-src']) assert.ok(seen.violations.includes(d), `the CSP itself refused ${d}: ${seen.violations}`);
    assert.strictEqual(seen.violations.filter((d) => d.startsWith('script-src')).length, 2, `the CSP itself refused the inline and the remote script: ${seen.violations}`);
    assert.strictEqual(hits, 0, 'the local server saw nothing from the page');
    const url = `${base}/asked-through-the-session`;
    assert.notStrictEqual(await ses.fetch(url).then(() => 'answered', () => 'failed'), 'answered', 'the session cancels a request the CSP never sees');
    assert.strictEqual(hits, 0, 'the local server saw nothing from the session');
    // window.open, with a user gesture
    const before = BrowserWindow.getAllWindows().length;
    assert.strictEqual(await wc.executeJavaScript(`String(window.open('about:blank'))`, true), 'null', 'window.open gives nothing');
    assert.strictEqual(BrowserWindow.getAllWindows().length, before, 'and no window');
    // a same-document move is harmless and stays
    await wc.executeJavaScript(`location.hash='h';0`);
    assert.strictEqual(win.isDestroyed(), false, 'a hash change does not end the window');
    // any other document ends the window: first a navigation that makes no request and fires no will-navigate, and would drop the CSP
    const ended = (w) => new Promise((res) => { w.once('closed', () => res('closed')); setTimeout(() => res('still open'), 10_000); });
    let gone = ended(win);
    void wc.executeJavaScript(`location.href='about:blank?navigated';0`, true).catch(() => undefined); // not awaited: its answer dies with the page
    assert.strictEqual(await gone, 'closed', 'a navigation with no request ends the window');
    // then one with a request
    const win2 = createEncoderWindow();
    await loadEncoderPage(win2.webContents);
    gone = ended(win2);
    void win2.webContents.executeJavaScript(`location.href=${JSON.stringify(base + '/away')};0`, true).catch(() => undefined);
    assert.strictEqual(await gone, 'closed', 'a navigation with a request ends the window');
    assert.strictEqual(hits, 0, 'the local server saw no navigation');
    // will-navigate on its own, before the page is written: refused, the blank page stays
    const win3 = createEncoderWindow();
    const wc3 = win3.webContents;
    await wc3.loadURL('about:blank');
    const asked = new Promise((res) => { wc3.once('will-navigate', () => res(true)); setTimeout(() => res(false), 10_000); });
    const settled = new Promise((res) => { wc3.once('did-fail-load', () => res('failed')); wc3.once('did-navigate', () => res('navigated')); setTimeout(() => res('stayed'), 2000); });
    await wc3.executeJavaScript(`location.href=${JSON.stringify(base + '/away')};0`, true);
    assert.ok(await asked, 'the navigation was tried (the check is not empty)');
    assert.strictEqual(await settled, 'stayed', 'will-navigate refuses it');
    assert.strictEqual(wc3.getURL(), 'about:blank');
    win3.destroy();
    await new Promise((res) => server.close(res));
    noneLeft('the attacks');
  }

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
  // a window that ends for any reason (the navigation guard above) ends its job
  app.once('browser-window-created', (_e, w) => { w.webContents.once('did-finish-load', () => w.destroy()); });
  r = await Promise.race([encode(big, { timeoutMs: 600_000 }), new Promise((res) => setTimeout(() => res('still waiting'), 60_000))]);
  assert.ok(r !== 'still waiting' && !r.ok && r.error === ENCODER_FAILED, 'a window gone refuses');
  noneLeft('window gone');
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
    out.pinClosed=await b.characterPin('/closed/folder',saved.id);out.pinBadKey=await b.characterPin('relative',saved.id);out.pinUnknown=await b.characterPin('~/work/blog','my-ffffffffffff');
    out.pin=await b.characterPin('~/work/blog/',saved.id);out.clearClosed=await b.characterPin('/closed/folder',null);out.del=await b.characterDelete(saved.id);out.after=await b.characterList();
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
  assert.ok(!sim.pinClosed.ok && !sim.pinBadKey.ok && !sim.pinUnknown.ok && sim.clearClosed.ok, 'the simulator pins like main: ' + JSON.stringify([sim.pinClosed, sim.pinBadKey, sim.pinUnknown, sim.clearClosed]));
  assert.ok(sim.pin.ok && sim.del.ok && sim.del.pinsRemoved === 1 && sim.after.length === 0, 'delete removes the character and counts its pin');
  assert.strictEqual(sim.ideas, 24);
  const caps = Object.fromEntries(sim.caps);
  assert.strictEqual(caps.codex, true, 'the simulator\'s Codex has imageGen');
  assert.ok(sim.caps.filter(([id]) => id !== 'codex').every(([, v]) => v === false), 'the others do not');
  console.log('check-charencoder: ok');
};
