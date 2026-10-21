/*
 * macOS title bar geometry check (spec 052 FR-138, issue #345).
 *
 *   npm run check:mac-titlebar                       (builds, then runs this file under Electron; xvfb-run on Linux without DISPLAY)
 *   MAC_TITLEBAR_SHOTS=/path/dir npm run check:mac-titlebar   also saves a screenshot per state and size
 *
 * Simulator only (no AI credits, no real Mac). It forces html[data-platform="darwin"] (the preload sets it only on a Mac), opens each
 * state at 1440x900 and 1280x800 and models what Electron does with `-webkit-app-region`: the window drags where an element is `drag`
 * and no element is `no-drag`, z-order ignored. Per state it fails on:
 *   - no draggable part in the top 40px band (outside the 78px traffic-light room), or, in a chat, no grab block of at least 32px wide and
 *     24px tall (continuous drag, starting in the band); states under a modal overlay (dialogs, palette, shortcut sheet, inbox) are exempt
 *     from this one: an overlay blocks dragging (FR-138);
 *   - a clickable element whose box overlaps the traffic-light box (x<78, y<40, by rectangle, not by sampling) outside full screen (an
 *     overlay's own backdrop is not counted: the native traffic lights sit above the page; a control inside a dialog is);
 *   - a screen header over a chat whose title is not on the centred content column (FR-097) at widths above 990px;
 *   - the top bar's rows (one row at wide sizes, two when it wraps): the first row's items start at x>=78, a wrapped row at the normal padding (the room is for the first row only);
 *   - a clickable element over an effective drag region (it could not be clicked on a Mac).
 * It exits non-zero on a failure and also when the driver itself throws or does not finish (a marker file decides, Electron exits 0 after
 * a driver error). The real traffic-light position, SF fonts, double-click zoom and real full screen are not covered (see the spec).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { jsLiteral } = require('./check-office-overlap.js'); /* every value put into page code goes through it */

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const TL = { x: 78, y: 40 }; /* traffic-light box: the hiddenInset default, not measured on a Mac */
const MIN_CHAT_GRAB = 32; /* px wide, with 24px of height */
const SIZES = [[1440, 900], [1280, 800]];

/* runs in the page */
function measure(TLX, TLY) {
  const W = innerWidth, H = innerHeight, full = document.documentElement.hasAttribute('data-fullscreen');
  const reg = (e) => { const cs = getComputedStyle(e); return cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('app-region') || ''; };
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const nm = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const rr = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  const drags = [], nods = [];
  for (const e of document.querySelectorAll('body *')) {
    const v = reg(e);
    if ((v !== 'drag' && v !== 'no-drag') || !vis(e)) continue;
    (v === 'drag' ? drags : nods).push({ e, r: e.getBoundingClientRect() });
  }
  const inR = (x, y, r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  const near = (x, y, r) => x >= r.left - 1 && x < r.right + 1 && y >= r.top - 1 && y < r.bottom + 1;
  const draggable = (x, y) => drags.some((d) => inR(x, y, d.r)) && !nods.some((n) => near(x, y, n.r));
  const CLICK = 'button,a[href],input,select,textarea,summary,label,[role="button"],[role="menuitem"],[role="option"],[tabindex]:not([tabindex="-1"]),.dlg-ov';
  const clickOf = (el) => el && el.closest && el.closest(CLICK);
  const inDrag = new Map(), underTL = new Map();
  let bandDrag = 0;
  const X0 = full ? 0 : TLX, STEP = 2, NY = Math.floor(Math.min(H, 160) / STEP), NX = Math.floor(W / STEP);
  const grid = []; /* grid[j][i]: draggable at whole pixel (i*2+1, j*2+1) */
  for (let j = 0; j < NY; j++) {
    const row = [], y = j * STEP + 1;
    for (let i = 0; i < NX; i++) {
      const x = i * STEP + 1;
      const top = document.elementFromPoint(x, y), c = clickOf(top);
      const d = draggable(x, y);
      row.push(d);
      if (y < TLY && x >= X0 && d) bandDrag++;
      if (c && d) { const k = nm(c); const o = inDrag.get(k) || { el: k, pts: 0, rect: rr(c.getBoundingClientRect()) }; o.pts++; inDrag.set(k, o); }
    }
    grid.push(row);
  }
  /* the largest run of x where 24px of height (13 rows) is draggable all the way, starting in the band */
  let grab = 0;
  for (let j0 = 0; j0 * STEP < TLY && j0 + 13 <= NY; j0++) {
    let run = 0;
    for (let i = 0; i < NX; i++) {
      let ok = i * STEP + 1 >= X0;
      for (let j = j0; ok && j < j0 + 13; j++) if (!grid[j][i]) ok = false;
      if (ok) { run += STEP; if (run > grab) grab = run; } else run = 0;
    }
  }
  /* clickable elements by box: any visible one that is on top where it overlaps the traffic-light box */
  if (!full) {
    for (const e of document.querySelectorAll(CLICK)) {
      if (e.classList.contains('dlg-ov') || !vis(e)) continue;
      const r = e.getBoundingClientRect();
      const x1 = Math.max(r.left, 0), x2 = Math.min(r.right, TLX), y1 = Math.max(r.top, 0), y2 = Math.min(r.bottom, TLY);
      if (x2 - x1 <= 0.5 || y2 - y1 <= 0.5) continue;
      const top = document.elementFromPoint(Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2));
      if (!top || !e.contains(top)) continue; /* covered by something else there */
      const k = nm(e); underTL.set(k, { el: k, pts: 1, rect: rr(r) });
    }
  }
  /* the top bar: the first row starts at x>=78 and a wrapped row at the normal padding */
  let topbar = null;
  const tb = document.querySelector('header.topbar');
  if (tb && vis(tb) && !full) {
    const kids = [...tb.children].filter(vis).map((e) => e.getBoundingClientRect());
    const t0 = Math.min(...kids.map((r) => r.top));
    const first = kids.filter((r) => r.top < t0 + 10), rest = kids.filter((r) => r.top >= t0 + 10);
    topbar = { rows: rest.length ? 2 : 1, firstMin: Math.round(Math.min(...first.map((r) => r.left))), restMin: rest.length ? Math.round(Math.min(...rest.map((r) => r.left))) : null };
  }
  /* a screen header over a chat: its title is on the centred column of FR-097 */
  let head = null;
  const h2 = document.querySelector('#screen:not([hidden]) .scr-head h2');
  if (h2 && document.body.classList.contains('panel-open') && W > 990) head = { left: h2.getBoundingClientRect().left, want: (W - 880) / 2 + 24 };
  return {
    full, bandDrag, grab, topbar, head,
    drags: drags.filter((d) => !(d.e.parentElement && reg(d.e.parentElement) === 'drag')).map((d) => nm(d.e) + ' ' + JSON.stringify(rr(d.r))),
    clickInDrag: [...inDrag.values()], clickUnderTL: [...underTL.values()],
  };
}

async function run(ctx) {
  const SHOTS = process.env.MAC_TITLEBAR_SHOTS;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const js = (c) => ctx.js(c);
  const results = [];
  const key = (k, mods) => { const w = ctx.win.webContents; for (const type of ['keyDown', 'char', 'keyUp']) w.sendInputEvent({ type, keyCode: k, modifiers: mods || [] }); };
  const click = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(e){e.click();return true}return false})()`);
  const must = async (sel) => { if (!(await click(sel))) throw new Error(`missing control ${sel}`); await ctx.sleep(150); };
  const reset = async () => {
    await js(`(()=>{document.querySelectorAll('.dlg-ov').forEach(d=>d.remove());try{window.DurbarScreens.isOpen()&&window.DurbarScreens.close()}catch(e){};if(document.body.classList.contains('panel-open')){const b=document.getElementById('backBtn');if(b)b.click()};const m=document.getElementById('topMoreMenu');if(m)m.hidden=true;['foldersPop','floorsPop','defaultsPop'].forEach(i=>{const e=document.getElementById(i);if(e)e.hidden=true});delete document.documentElement.dataset.fullscreen;const vo=document.getElementById('vOffice');if(vo&&document.body.classList.contains('list-mode'))vo.click();['restoreStrip','awayStrip'].forEach(i=>{const s=document.getElementById(i);if(s)s.hidden=true})})()`);
    await ctx.sleep(350);
  };
  const openChat = async () => {
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ctx.sleep(900);
    if (!(await js(`document.body.classList.contains('panel-open')`))) throw new Error('the chat did not open');
  };
  const showRestore = () => js(`(()=>{const s=document.getElementById('restoreStrip');s.innerHTML='<span class="ns-ic">!</span><span class="ns-t"><b>Allow all was restored</b> for 2 agents.</span><span class="ns-act"><button class="btn sm">Switch back to Ask first</button><button class="btn sm">Keep</button></span>';s.hidden=false})()`);
  /* the same markup as renderAwayStrip in app.js (one missed prompt with its own "Run missed now", then Dismiss) */
  const showAway = () => js(`(()=>{const a=document.getElementById('awayStrip');a.innerHTML='<span class="ns-ic" aria-hidden="true">i</span><span class="ns-t"><b>Since you were away</b> (2 h): 1 scheduled prompt did not run while the app was closed.</span><span class="aw-list"><span class="aw-it" data-sched="x"><span class="aw-w"><b>demo-folder</b>: \u201Csummarise the open issues\u201D</span><button class="btn" type="button" data-awrun="x">Run missed now</button></span></span><span class="ns-act"><button class="btn" type="button" data-aw="close">Dismiss</button></span>';a.hidden=false})()`);
  const fullScreen = () => js(`document.documentElement.dataset.fullscreen=''`);
  /* kind: chat = at least MIN_CHAT_GRAB of continuous grab width; modal = under an overlay, dragging is blocked on purpose; plain = some drag */
  const rec = async (name, size, kind) => {
    await ctx.sleep(600);
    const m = await js(`(${measure.toString()})(${jsLiteral(TL.x)},${jsLiteral(TL.y)})`);
    const why = [];
    if (kind === 'chat' ? m.grab < MIN_CHAT_GRAB : kind === 'plain' && m.bandDrag === 0) why.push(`grab block ${m.grab}px wide${kind === 'chat' ? ` (< ${MIN_CHAT_GRAB}, 24px tall needed)` : ' (none)'}`);
    if (m.topbar && !m.full && m.topbar.firstMin < TL.x - 1) why.push(`top bar first row starts at x=${m.topbar.firstMin} (< ${TL.x})`);
    if (m.topbar && m.topbar.rows === 2 && m.topbar.restMin > 30) why.push(`top bar second row starts at x=${m.topbar.restMin} (the room is for the first row only)`);
    if (m.head && Math.abs(m.head.left - m.head.want) > 1) why.push(`screen title at x=${Math.round(m.head.left)}, the centred column is at x=${Math.round(m.head.want)} (FR-097)`);
    if (m.clickUnderTL.length) why.push('clickable under the traffic lights: ' + m.clickUnderTL.map((c) => c.el + JSON.stringify(c.rect)).join(', '));
    if (m.clickInDrag.length) why.push('clickable over a drag region: ' + m.clickInDrag.map((c) => c.el + JSON.stringify(c.rect)).join(', '));
    results.push({ name, size, ok: !why.length });
    console.log(`[mac-titlebar] ${why.length ? 'FAIL' : 'ok  '} ${size} ${name.padEnd(20)} grab=${m.grab}px rows=${m.topbar ? m.topbar.rows : '-'} drag: ${m.drags.join(' | ') || '-'}${why.length ? '\n    ' + why.join('\n    ') : ''}`);
    if (SHOTS) { ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 }); await ctx.sleep(150); await ctx.shot(path.join(SHOTS, `052-mac-${name}-${size}.png`)); }
  };

  for (const [w, h] of SIZES) {
    const size = `${w}x${h}`;
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1' } });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    await ctx.sleep(1500);
    await js(`document.documentElement.dataset.platform='darwin'`);
    await ctx.sleep(400);
    await js(`['restoreStrip','awayStrip'].forEach(i=>{document.getElementById(i).hidden=true})`);
    await rec('office', size, 'plain');
    await showRestore(); await rec('office-restoreStrip', size, 'plain'); await reset();
    await must('#vList'); await rec('list', size, 'plain'); await must('#vOffice');
    await must('#foldersBtn'); await rec('folders-popover', size, 'plain'); await reset();
    await must('#defaultsBtn'); await rec('defaults-popover', size, 'plain'); await reset();
    /* spec 052 FR-162: + Folder and + Workspace are plain buttons (no menu); the office state above covers them */
    await must('#settingsBtn'); await rec('settings', size, 'plain'); await reset();
    await must('#toolsBtn'); await rec('tools', size, 'plain'); await reset();
    await openChat(); await rec('chat', size, 'chat');
    await showRestore(); await rec('chat-restoreStrip', size, 'chat'); await reset(); await openChat();
    await showAway(); await rec('chat-awayStrip', size, 'chat'); await reset(); await openChat();
    await showRestore(); await showAway(); await rec('chat-both-strips', size, 'chat'); await reset(); await openChat();
    await js(`window.DurbarScreens.openSettings()`); await rec('chat-settings', size, 'chat');
    await js(`window.DurbarScreens.close()`); await ctx.sleep(300);
    await js(`window.DurbarScreens.openTools(null)`); await rec('chat-tools', size, 'chat');
    await js(`window.DurbarScreens.close()`); await ctx.sleep(300);
    await showRestore(); await js(`window.DurbarScreens.openSettings()`); await rec('chat-strip-settings', size, 'chat'); await js(`window.DurbarScreens.close()`); await reset(); await openChat();
    key('K', [process.platform === 'darwin' ? 'meta' : 'control']); await rec('chat-palette', size, 'modal'); await reset(); await openChat();
    await fullScreen(); await rec('chat-fullscreen', size, 'chat'); await reset();
    await fullScreen(); await rec('office-fullscreen', size, 'plain'); await reset();
    key('K', [process.platform === 'darwin' ? 'meta' : 'control']); await rec('palette', size, 'modal'); await reset();
    await must('#topMoreBtn'); await must('#kbdHelpBtn'); await rec('kbd-sheet', size, 'modal'); await reset();
    await must('#inboxBtn'); await rec('inbox', size, 'modal'); await reset();
    await js(`(()=>{const d=document.createElement('div');d.className='dlg-ov';d.id='auditDlg';d.innerHTML='<div class="dlg wide" role="dialog" aria-modal="true"><h3>Set up Claude Code</h3><div class="dbody">'+'<p>step line</p>'.repeat(60)+'</div><div class="dbtn"><button class="btn">Cancel</button><button class="btn primary">Next</button></div></div>';document.body.appendChild(d)})()`);
    await rec('tall-dialog', size, 'modal'); await reset();
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\nmac-titlebar check: ${results.length - bad.length}/${results.length} states passed, ${bad.length} failed`);
  if (bad.length) throw new Error(`${bad.length} state(s) failed: ${bad.map((b) => b.size + ' ' + b.name).join(', ')}`);
  return results.length;
}

/* Electron catches a driver error and exits 0, so the outcome goes through two marker files that the runner reads. */
async function driver(ctx) {
  const dir = process.env.MAC_TITLEBAR_DIR;
  const mark = (name, text) => { if (dir) fs.writeFileSync(path.join(dir, name), String(text)); };
  try {
    if (!process.env.DURBAR_SIM || !process.env.DURBAR_USER_DATA || !dir) throw new Error('refusing to run: DURBAR_SIM, DURBAR_USER_DATA and MAC_TITLEBAR_DIR must be set (simulator and a scratch profile only)');
    const n = await run(ctx);
    mark('pass', n);
    console.log('[mac-titlebar] all checks passed');
  } catch (err) {
    console.error('[mac-titlebar] FAILED:', err && err.stack ? err.stack : err);
    mark('fail', err && err.message ? err.message : 'driver error');
    process.exitCode = 1;
  }
}

module.exports = driver;

if (require.main === module) {
  const { spawn } = require('child_process');
  if (!fs.existsSync(INDEX)) { console.error('dist/ missing: run npm run build first'); process.exit(2); }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mactb-'));
  const electron = require('electron'); /* path to the binary */
  // a clean environment: no DURBAR_OPEN / DURBAR_PERM / DURBAR_SHOT or other dev switch from the caller can point the run at real folders
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('DURBAR_')) delete env[k];
  Object.assign(env, { DURBAR_DRIVER: __filename, DURBAR_USER_DATA: userData, MAC_TITLEBAR_DIR: userData, DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' });
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const args = ['.', '--no-sandbox'];
  const win = process.platform === 'win32';
  // its own process group (outside Windows), so a timeout stops xvfb-run, Electron and its helpers, and only those
  const child = useXvfb ? spawn('xvfb-run', ['-a', electron, ...args], { cwd: ROOT, env, stdio: 'inherit', detached: !win }) : spawn(electron, args, { cwd: ROOT, env, stdio: 'inherit', detached: !win });
  const stop = (sig) => { try { win ? child.kill(sig) : process.kill(-child.pid, sig); } catch (e) { /* already gone */ } };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stop('SIGTERM'); setTimeout(() => stop('SIGKILL'), 5000).unref(); }, 5 * 60 * 1000);
  const done = (code) => {
    clearTimeout(timer);
    const passed = fs.existsSync(path.join(userData, 'pass')), failed = fs.existsSync(path.join(userData, 'fail'));
    fs.rmSync(userData, { recursive: true, force: true });
    if (timedOut) { console.error('mac-titlebar check timed out'); process.exit(1); }
    if (failed || !passed || code !== 0) { console.error(failed ? 'mac-titlebar check FAILED' : 'mac-titlebar check did not finish (no pass marker)'); process.exit(1); }
  };
  child.on('error', (e) => { clearTimeout(timer); fs.rmSync(userData, { recursive: true, force: true }); console.error(e.message); process.exit(2); });
  child.on('exit', (code) => done(code));
}
