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
 *   - a screen header over a chat whose title is not where FR-097 puts it (the centred content column; for Settings, which has a section list, the list-and-page block, at least 78 outside full screen) at widths above 990px;
 *   - a screen title that starts under the traffic lights (x<78, y<40, outside full screen), also in the narrow windows (991..1208, 760..990
 *     and under 760 px wide; spec 052 FR-138 delta 2026-11-11);
 *   - the top bar's rows (one row at wide sizes, two when it wraps): the first row's items start at x>=78, a wrapped row at the normal padding (the room is for the first row only);
 *   - a clickable element over an effective drag region (it could not be clicked on a Mac).
 * It exits non-zero on a failure and also when the driver itself throws or does not finish (a marker file decides, Electron exits 0 after
 * a driver error). It also double-clicks the open screen's title (Settings, Tools, alone and over a chat) with real input: the page must
 * take it as a title-bar double-click (and, on a Mac, send window:titleDoubleClick once). The real traffic-light position, SF fonts, the
 * window's actual zoom and real full screen are not covered (see the spec).
 */
'use strict';
const fs = require('fs');
const { buildProblem } = require('./ensure-electron'); // spec 008 FR-211: one shared build check
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const TL = { x: 78, y: 40 }; /* traffic-light box: the hiddenInset default, not measured on a Mac */
const MIN_CHAT_GRAB = 32; /* px wide, with 24px of height */
const SIZES = [[1440, 900], [1280, 800]];
/* spec 052 FR-138 (issues #1538, #1539, #1635): narrower windows, down to the app's minimum width (640, main.ts minWidth). Settings over a chat keeps the traffic-light room from 1208 px down (its title is at max(24, W/2 - 526) above that); every screen header must fit the window at NARROW_FIT. */
const NARROW = [[1208, 800], [1100, 800], [991, 800], [900, 800], [760, 800], [759, 800], [700, 800], [640, 800]];
const NARROW_FIT = 760; /* the Close-button and header-fit states run at this width and below */

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
  const navNow = !!document.querySelector('#screen:not([hidden]) .scr-nav');
  if (h2 && document.body.classList.contains('panel-open') && (W > 990 || (full && navNow))) {
    /* FR-097: a screen with a section list (.scr-nav: Settings) lines the title up with the list-and-page block, max(24, W/2 - 526); the
       others keep the 880px column. Outside full screen, with no notice strip above (which is the first row), the Mac room comes first: at least 78
       (FR-138, issue #1538). */
    const nav = !!document.querySelector('#screen:not([hidden]) .scr-nav');
    const strip = [...document.querySelectorAll('.notice-strip')].some(vis);
    head = { left: h2.getBoundingClientRect().left, want: nav ? (W < 760 ? 24 : Math.max(full || strip ? 24 : TLX, W / 2 - 526)) : (W - 880) / 2 + 24, nav };
  }
  /* a screen title at any width: where it starts, and how high (it is under the traffic lights when it is in the 78x40 box) */
  const t2 = document.querySelector('#screen:not([hidden]) .scr-head h2');
  const title = t2 && document.body.classList.contains('panel-open') ? { left: t2.getBoundingClientRect().left, top: t2.getBoundingClientRect().top } : null;
  return {
    full, bandDrag, grab, topbar, head, title,
    drags: drags.filter((d) => !(d.e.parentElement && reg(d.e.parentElement) === 'drag')).map((d) => nm(d.e) + ' ' + JSON.stringify(rr(d.r))),
    clickInDrag: [...inDrag.values()], clickUnderTL: [...underTL.values()],
  };
}

/* runs in the page: the header of the open screen against the window */
function measureHead() {
  const h = document.querySelector('#screen:not([hidden]) .scr-head');
  if (!h) return null;
  const rr = (r) => [Math.round(r.left), Math.round(r.right)];
  const close = document.getElementById('scrClose');
  return {
    W: document.documentElement.clientWidth,
    closeRight: close ? close.getBoundingClientRect().right : null,
    headScroll: h.scrollWidth - h.clientWidth,
    title: rr(h.querySelector('h2').getBoundingClientRect()),
    kids: [...h.children].map((e) => rr(e.getBoundingClientRect())),
    nav: !!document.querySelector('#screen:not([hidden]) .scr-nav'),
  };
}

async function run(ctx) {
  const SHOTS = process.env.MAC_TITLEBAR_SHOTS;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js, click } = H;
  const results = [];
  const key = (k, mods) => H.key(k, mods, { char: 'always', pause: 0 });
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
    if (m.head && Math.abs(m.head.left - m.head.want) > 1) why.push(`screen title at x=${Math.round(m.head.left)}, ${m.head.nav ? 'the list-and-page block' : 'the centred column'} is at x=${Math.round(m.head.want)} (FR-097)`);
    if (m.title && !m.full && m.title.left < TL.x - 1 && m.title.top < TL.y) why.push(`screen title at x=${Math.round(m.title.left)} is under the traffic lights (< ${TL.x}) at ${size}`);
    if (m.clickUnderTL.length) why.push('clickable under the traffic lights: ' + m.clickUnderTL.map((c) => c.el + JSON.stringify(c.rect)).join(', '));
    if (m.clickInDrag.length) why.push('clickable over a drag region: ' + m.clickInDrag.map((c) => c.el + JSON.stringify(c.rect)).join(', '));
    results.push({ name, size, ok: !why.length });
    console.log(`[mac-titlebar] ${why.length ? 'FAIL' : 'ok  '} ${size} ${name.padEnd(20)} grab=${m.grab}px rows=${m.topbar ? m.topbar.rows : '-'} drag: ${m.drags.join(' | ') || '-'}${why.length ? '\n    ' + why.join('\n    ') : ''}`);
    if (SHOTS) { ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 }); await ctx.sleep(150); await ctx.shot(path.join(SHOTS, `052-mac-${name}-${size}.png`)); }
  };

  /* spec 052 FR-085 (2026-11-15 delta): a real double-click (sendInputEvent, clickCount 1 then 2) on the open screen's title must be a
     title-bar double-click: the page's filter says yes for the element the dblclick hit, and on a Mac the page sends window:titleDoubleClick
     once. Main's own handler is swapped for a counter during the gesture, so the simulator window is not zoomed under the measurements. */
  const titleDbl = async (name, size) => {
    const label = `${name}-title-dblclick`;
    const why = [];
    await js(`(()=>{window.__titleDbl=null;if(!window.__titleDblArmed){window.__titleDblArmed=true;document.addEventListener('dblclick',e=>{window.__titleDbl={t:e.target,trusted:e.isTrusted}},true)}})()`);
    const c = await js(`(()=>{const h=document.querySelector('#screen:not([hidden]) .scr-head h2');if(!h)return null;const r=h.getBoundingClientRect();const x=Math.round(r.left+Math.min(r.width/2,24)),y=Math.round(r.top+r.height/2);const e=document.elementFromPoint(x,y);return {x,y,tab:h.getAttribute('tabindex'),hit:!!e&&(e===h||h.contains(e))}})()`);
    if (!c) why.push('no screen title found');
    else if (!c.hit) why.push(`the point ${c.x},${c.y} is not on the title`);
    let sent = 0;
    if (!why.length) {
      const { ipcMain } = require('electron');
      const CH = 'window:titleDoubleClick';
      const saved = ipcMain.listeners(CH);
      const count = () => { sent++; };
      ipcMain.removeAllListeners(CH); ipcMain.on(CH, count);
      try {
        const wc = ctx.win.webContents;
        const m = (type, extra) => wc.sendInputEvent({ type, x: c.x, y: c.y, button: 'left', ...extra });
        m('mouseMove'); m('mouseDown', { clickCount: 1 }); m('mouseUp', { clickCount: 1 }); m('mouseDown', { clickCount: 2 }); m('mouseUp', { clickCount: 2 });
        const mac = process.platform === 'darwin';
        let seen = null;
        for (const end = Date.now() + 3000; Date.now() < end;) {
          seen = await js(`(()=>{const d=window.__titleDbl;if(!d)return null;return {trusted:d.trusted,tag:d.t.tagName,send:window.DurbarKeys.shouldSendTitleDoubleClick(d.t)}})()`);
          if (seen && (!mac || !seen.send || sent > 0)) break;
          await ctx.sleep(50);
        }
        if (!seen) why.push('the page saw no dblclick');
        else {
          if (!seen.send) why.push(`the filter refuses the title (${seen.tag}, tabindex=${c.tab}): no zoom`);
          if (mac && seen.send && sent !== 1) why.push(`window:titleDoubleClick sent ${sent} times (1 wanted)`);
        }
      } finally { ipcMain.removeListener(CH, count); for (const l of saved) ipcMain.on(CH, l); }
    }
    results.push({ name: label, size, ok: !why.length });
    console.log(`[mac-titlebar] ${why.length ? 'FAIL' : 'ok  '} ${size} ${label} tabindex=${c ? c.tab : '-'} sent=${sent}${why.length ? '\n    ' + why.join('\n    ') : ''}`);
  };

  for (const [w, h] of SIZES) {
    const size = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit' }); // was a fixed 1500 ms; now waits for the page to stop changing (FR-096)
    await js(`document.documentElement.dataset.platform='darwin'`);
    await ctx.sleep(400);
    await js(`['restoreStrip','awayStrip'].forEach(i=>{document.getElementById(i).hidden=true})`);
    await rec('office', size, 'plain');
    await showRestore(); await rec('office-restoreStrip', size, 'plain'); await reset();
    await must('#vList'); await rec('list', size, 'plain'); await must('#vOffice');
    await must('#foldersBtn'); await rec('folders-popover', size, 'plain'); await reset();
    await must('#defaultsBtn'); await rec('defaults-popover', size, 'plain'); await reset();
    /* spec 052 FR-164: + Folder and + Workspace are plain buttons (no menu); the office state above covers them */
    await must('#settingsBtn'); await rec('settings', size, 'plain'); await titleDbl('settings', size); await reset();
    await must('#toolsBtn'); await rec('tools', size, 'plain'); await titleDbl('tools', size); await reset();
    await openChat(); await rec('chat', size, 'chat');
    await showRestore(); await rec('chat-restoreStrip', size, 'chat'); await reset(); await openChat();
    await showAway(); await rec('chat-awayStrip', size, 'chat'); await reset(); await openChat();
    await showRestore(); await showAway(); await rec('chat-both-strips', size, 'chat'); await reset(); await openChat();
    await js(`window.DurbarScreens.openSettings()`); await rec('chat-settings', size, 'chat'); await titleDbl('chat-settings', size);
    await js(`window.DurbarScreens.close()`); await ctx.sleep(300);
    await js(`window.DurbarScreens.openTools(null)`); await rec('chat-tools', size, 'chat'); await titleDbl('chat-tools', size);
    await js(`window.DurbarScreens.close()`); await ctx.sleep(300);
    await showRestore(); await js(`window.DurbarScreens.openSettings()`); await rec('chat-strip-settings', size, 'chat'); await js(`window.DurbarScreens.close()`); await reset(); await openChat();
    await key('K', [process.platform === 'darwin' ? 'meta' : 'control']); await H.until(`!!document.getElementById('palDlg')`); await rec('chat-palette', size, 'modal'); await reset(); await openChat();
    await fullScreen(); await rec('chat-fullscreen', size, 'chat'); await reset();
    await fullScreen(); await rec('office-fullscreen', size, 'plain'); await reset();
    await key('K', [process.platform === 'darwin' ? 'meta' : 'control']); await H.until(`!!document.getElementById('palDlg')`); await rec('palette', size, 'modal'); await reset();
    await must('#topMoreBtn'); await must('#kbdHelpBtn'); await rec('kbd-sheet', size, 'modal'); await reset();
    await must('#inboxBtn'); await rec('inbox', size, 'modal'); await reset();
    await js(`(()=>{const d=document.createElement('div');d.className='dlg-ov';d.id='auditDlg';d.innerHTML='<div class="dlg wide" role="dialog" aria-modal="true"><h3>Set up Claude Code</h3><div class="dbody">'+'<p>step line</p>'.repeat(60)+'</div><div class="dbtn"><button class="btn">Cancel</button><button class="btn primary">Next</button></div></div>';document.body.appendChild(d)})()`);
    await rec('tall-dialog', size, 'modal'); await reset();
  }
  /* spec 052 FR-138: the Close button of every screen header stays inside a narrow window, the title keeps its place under the traffic lights */
  /* condition waits, no fixed sleeps (FR-048b): a wait that runs out fails with its own label */
  const need = async (expr, label, ms = 4000) => { if (!(await H.until(expr, ms))) throw new Error(`${label}: not reached in ${ms} ms`); };
  /* the header's child boxes are the same on two reads in a row (polled every 50 ms): laid out at this window size */
  const HEAD_STILL = `(()=>{const h=document.querySelector('#screen:not([hidden]) .scr-head');if(!h)return false;const s=h.getBoundingClientRect().width+'|'+[...h.children].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom].map(Math.round).join(',')}).join(';');const same=window.__fr138Head===s;window.__fr138Head=s;return same})()`;
  const closeIn = async (name, size, W, ready) => {
    await need(`!document.getElementById('screen').hidden&&document.body.classList.contains('screen-open')&&!!document.getElementById('scrClose')&&(${ready.toString()})()`, `${size} ${name}: the screen is open on its view`);
    await js(`delete window.__fr138Head`);
    await need(HEAD_STILL, `${size} ${name}: the header is laid out`);
    const m = await js(`(${measureHead.toString()})()`);
    const why = [];
    if (!m) why.push('no screen header');
    else {
      if (m.closeRight === null) why.push('no Close button');
      else if (m.closeRight > W + 0.5) why.push(`Close right edge at x=${Math.round(m.closeRight)}, past the ${W}px window`);
      if (m.headScroll > 0) why.push(`header is ${m.headScroll}px wider than its box`);
      /* Settings (a section list) is left out of the title test: its title under the traffic lights in narrow windows is the open issues 1538 and 1539 */
      if (!m.nav && m.title[0] < TL.x - 1) why.push(`title at x=${m.title[0]} is under the traffic lights`);
    }
    results.push({ name, size, ok: !why.length });
    console.log(`[mac-titlebar] ${why.length ? 'FAIL' : 'ok  '} ${size} ${name.padEnd(20)} close.right=${m && m.closeRight !== null ? Math.round(m.closeRight) : '-'} kids=${m ? JSON.stringify(m.kids) : '-'}${why.length ? '\n    ' + why.join('\n    ') : ''}`);
    if (SHOTS) { await ctx.shot(path.join(SHOTS, `052-mac-${name}-${size}.png`)); }
  };
  for (const [w, h] of NARROW) {
    const size = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit' });
    await js(`document.documentElement.dataset.platform='darwin'`);
    /* the darwin rules apply: the top bar is a drag region (styles.css, FR-138) */
    await need(`getComputedStyle(document.querySelector('.topbar')).getPropertyValue('-webkit-app-region')==='drag'`, `${size}: the macOS title bar rules apply`);
    await js(`['restoreStrip','awayStrip'].forEach(i=>{document.getElementById(i).hidden=true})`);
    /* mutant (proves the check can fail): MAC_TITLEBAR_MUTANT=nowrap puts the header back to one row */
    if (process.env.MAC_TITLEBAR_MUTANT === 'nowrap') await js(`(()=>{const st=document.createElement('style');st.textContent='.scr-head{flex-wrap:nowrap !important}';document.head.appendChild(st)})()`);
    const W = await js(`document.documentElement.clientWidth`);
    if (W > w + 1 || W < w - 1) throw new Error(`the window is ${W}px wide, not ${w}`);
    if (w <= NARROW_FIT) {
    await openChat();
    for (const [name, open, ready] of [
      ['chat-tools', `window.DurbarScreens.openTools(null)`, () => !!document.querySelector('#tabTools[aria-selected="true"]')],
      ['chat-tools-cost', `window.DurbarScreens.openTools(null,'cost')`, () => !!document.querySelector('#tabCost[aria-selected="true"]')],
      ['chat-tools-activity', `window.DurbarScreens.openTools(null,'activity')`, () => !!document.querySelector('#tabActivity[aria-selected="true"]')&&!!document.querySelector('.scr-head.scr-wide')],
      ['chat-settings', `window.DurbarScreens.openSettings()`, () => !!document.querySelector('#screen:not([hidden]) .scr-nav')]]) {
      await js(open); await closeIn(name, size, W, ready);
      await js(`window.DurbarScreens.close()`);
      await need(`document.getElementById('screen').hidden&&!document.body.classList.contains('screen-open')&&document.body.classList.contains('panel-open')`, `${size} ${name}: the screen closed, the chat is still open`);
    }
    await reset();
    }
    await js(`['restoreStrip','awayStrip'].forEach(i=>{document.getElementById(i).hidden=true})`);
    await openChat();
    await js(`window.DurbarScreens.openSettings()`); await rec('chat-settings', size, 'chat');
    await js(`window.DurbarScreens.close()`); await ctx.sleep(300);
    await showRestore(); await js(`window.DurbarScreens.openSettings()`); await rec('chat-strip-settings', size, 'chat'); await js(`window.DurbarScreens.close()`); await reset();
    if (w === 900) { await openChat(); await fullScreen(); await js(`window.DurbarScreens.openSettings()`); await rec('chat-settings-fullscreen', size, 'chat'); await js(`window.DurbarScreens.close()`); await reset(); } /* full screen: no room, the title stays at 24 */
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
  { const noBuild = buildProblem(); if (noBuild) { console.error(noBuild); process.exit(2); } }
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
  /* 20 min (spec 052 FR-138, review of the narrow states): 57 states took 3m19s on a Mac at load 3 to 6 (about 3.5 s a state, start included)
     and 6m03s on a loaded Linux simulator; a hang is what this stops, not a slow run. It was 5 min for 42 states. */
  const LIMIT_MS = 20 * 60 * 1000;
  const timer = setTimeout(() => { timedOut = true; stop('SIGTERM'); setTimeout(() => stop('SIGKILL'), 5000).unref(); }, LIMIT_MS);
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
