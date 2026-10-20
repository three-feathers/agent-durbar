/*
 * macOS title bar geometry check (spec 052 FR-105, issue #345).
 *
 *   npm run check:mac-titlebar                       (builds, then runs this file under Electron; xvfb-run on Linux without DISPLAY)
 *   MAC_TITLEBAR_SHOTS=/path/dir npm run check:mac-titlebar   also saves a screenshot per state and size
 *
 * Simulator only (no AI credits, no real Mac). It forces html[data-platform="darwin"] (the preload sets it only on a Mac), opens each
 * state at 1440x900 and 1280x800 and models what Electron does with `-webkit-app-region`: the window drags where an element is `drag`
 * and no element is `no-drag`, z-order ignored. Per state it fails on:
 *   - no draggable part in the top 40px band (outside the 78px traffic-light room), or, in a chat, less than 40px of continuous grab width;
 *     states under a modal overlay (dialogs, palette, shortcut sheet, inbox) are exempt from this one: an overlay blocks dragging (FR-105);
 *   - a clickable element in the traffic-light box (x<78, y<40) outside full screen (an overlay's own backdrop is not counted: the native
 *     traffic lights sit above the page; a control inside a dialog is);
 *   - a clickable element over an effective drag region (it could not be clicked on a Mac).
 * It exits non-zero on a failure and also when the driver itself throws or does not finish (a marker file decides, Electron exits 0 after
 * a driver error). The real traffic-light position, SF fonts, double-click zoom and real full screen are not covered (see the spec).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const TL = { x: 78, y: 40 }; /* traffic-light box: the hiddenInset default, not measured on a Mac */
const MIN_CHAT_GRAB = 40;
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
  let bandDrag = 0, grab = 0;
  for (let y = 1.5; y < Math.min(H, 160); y += 3) {
    let run = 0;
    for (let x = 1; x < W; x += 2) { /* whole pixels: a hit test at x.5 rounds up, so 77.5 would hit a control starting at 78 */
      const top = document.elementFromPoint(x, y), c = clickOf(top);
      const d = draggable(x, y);
      if (y < TLY && x >= (full ? 0 : TLX)) { if (d) { bandDrag++; run += 2; grab = Math.max(grab, run); } else run = 0; }
      if (c && d) { const k = nm(c); const o = inDrag.get(k) || { el: k, pts: 0, rect: rr(c.getBoundingClientRect()) }; o.pts++; inDrag.set(k, o); }
      if (!full && x < TLX && y < TLY && c && !(c.classList.contains('dlg-ov') && c === top)) { const k = nm(c); const o = underTL.get(k) || { el: k, pts: 0, rect: rr(c.getBoundingClientRect()) }; o.pts++; underTL.set(k, o); }
    }
  }
  return {
    full, bandDrag, grab, back: (() => { const b = document.getElementById('backBtn'); return b ? b.getBoundingClientRect().left : null; })(),
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
  const click = (sel) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e){e.click();return true}return false})()`);
  const must = async (sel) => { if (!(await click(sel))) throw new Error(`missing control ${sel}`); await ctx.sleep(150); };
  const reset = async () => {
    await js(`(()=>{document.querySelectorAll('.dlg-ov').forEach(d=>d.remove());try{window.DurbarScreens.isOpen()&&window.DurbarScreens.close()}catch(e){};if(document.body.classList.contains('panel-open')){const b=document.getElementById('backBtn');if(b)b.click()};const m=document.getElementById('topMoreMenu');if(m)m.hidden=true;['foldersPop','floorsPop'].forEach(i=>{const e=document.getElementById(i);if(e)e.hidden=true});delete document.documentElement.dataset.fullscreen;const vo=document.getElementById('vOffice');if(vo&&document.body.classList.contains('list-mode'))vo.click();['restoreStrip','awayStrip'].forEach(i=>{const s=document.getElementById(i);if(s)s.hidden=true})})()`);
    await ctx.sleep(350);
  };
  const openChat = async () => {
    await js(`document.querySelector('#stage .desk[data-id]').click()`);
    await ctx.sleep(900);
    if (!(await js(`document.body.classList.contains('panel-open')`))) throw new Error('the chat did not open');
  };
  const showRestore = () => js(`(()=>{const s=document.getElementById('restoreStrip');s.innerHTML='<span class="ns-ic">!</span><span class="ns-t"><b>Allow all was restored</b> for 2 agents.</span><span class="ns-act"><button class="btn sm">Switch back to Ask first</button><button class="btn sm">Keep</button></span>';s.hidden=false})()`);
  const showAway = () => js(`(()=>{const a=document.getElementById('awayStrip');a.innerHTML='<span class="ns-ic">i</span><span class="ns-t"><b>Since you were away</b>: 2 scheduled prompts did not run.</span><span class="ns-act"><button class="btn sm">Run missed now</button><button class="btn sm">Dismiss</button></span>';a.hidden=false})()`);
  const fullScreen = () => js(`document.documentElement.dataset.fullscreen=''`);
  /* kind: chat = at least MIN_CHAT_GRAB of continuous grab width; modal = under an overlay, dragging is blocked on purpose; plain = some drag */
  const rec = async (name, size, kind) => {
    await ctx.sleep(600);
    const m = await js(`(${measure.toString()})(${TL.x},${TL.y})`);
    const why = [];
    if (kind === 'chat' ? m.grab < MIN_CHAT_GRAB : kind === 'plain' && m.bandDrag === 0) why.push(`grab area ${m.grab}px${kind === 'chat' ? ` (< ${MIN_CHAT_GRAB})` : ' (none)'}`);
    if (m.clickUnderTL.length) why.push('clickable under the traffic lights: ' + m.clickUnderTL.map((c) => c.el + JSON.stringify(c.rect)).join(', '));
    if (m.clickInDrag.length) why.push('clickable over a drag region: ' + m.clickInDrag.map((c) => c.el + JSON.stringify(c.rect)).join(', '));
    results.push({ name, size, ok: !why.length });
    console.log(`[mac-titlebar] ${why.length ? 'FAIL' : 'ok  '} ${size} ${name.padEnd(20)} grab=${m.grab}px backBtn=${m.back} drag: ${m.drags.join(' | ') || '-'}${why.length ? '\n    ' + why.join('\n    ') : ''}`);
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
    await must('#settingsBtn'); await rec('settings', size, 'plain'); await reset();
    await must('#toolsBtn'); await rec('tools', size, 'plain'); await reset();
    await openChat(); await rec('chat', size, 'chat');
    await showRestore(); await rec('chat-restoreStrip', size, 'chat'); await reset(); await openChat();
    await showAway(); await rec('chat-awayStrip', size, 'chat'); await reset(); await openChat();
    await showRestore(); await showAway(); await rec('chat-both-strips', size, 'chat'); await reset(); await openChat();
    await js(`window.DurbarScreens.openSettings()`); await rec('chat-settings', size, 'plain');
    await js(`window.DurbarScreens.close()`); await ctx.sleep(300);
    await js(`window.DurbarScreens.openTools(null)`); await rec('chat-tools', size, 'plain');
    await js(`window.DurbarScreens.close()`); await ctx.sleep(300);
    await showRestore(); await js(`window.DurbarScreens.openSettings()`); await rec('chat-strip-settings', size, 'plain'); await js(`window.DurbarScreens.close()`); await reset(); await openChat();
    key('K', ['control']); await rec('chat-palette', size, 'modal'); await reset(); await openChat();
    await fullScreen(); await rec('chat-fullscreen', size, 'chat'); await reset();
    await fullScreen(); await rec('office-fullscreen', size, 'plain'); await reset();
    key('K', ['control']); await rec('palette', size, 'modal'); await reset();
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
  const { spawnSync } = require('child_process');
  if (!fs.existsSync(INDEX)) { console.error('dist/ missing: run npm run build first'); process.exit(2); }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mactb-'));
  const electron = require('electron'); /* path to the binary */
  const env = { ...process.env, DURBAR_DRIVER: __filename, DURBAR_USER_DATA: userData, MAC_TITLEBAR_DIR: userData, DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' };
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const args = ['.', '--no-sandbox'];
  const opts = { cwd: ROOT, env, stdio: 'inherit', timeout: 5 * 60 * 1000 };
  const r = useXvfb ? spawnSync('xvfb-run', ['-a', electron, ...args], opts) : spawnSync(electron, args, opts);
  if (r.error) { console.error(r.error.message); process.exit(2); }
  const passed = fs.existsSync(path.join(userData, 'pass')), failed = fs.existsSync(path.join(userData, 'fail'));
  if (failed || !passed || r.status !== 0) { console.error(failed ? 'mac-titlebar check FAILED' : 'mac-titlebar check did not finish (no pass marker)'); process.exit(1); }
}
