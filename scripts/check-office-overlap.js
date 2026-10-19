/*
 * Office layout check (spec 001 FR-021, T025): no overlaps, no clipping, no floor overflow.
 *
 *   npm run check:office                       (builds, then runs this file under Electron; xvfb-run on Linux without DISPLAY)
 *   OFFICE_SHOTS=/path/dir npm run check:office  also saves a screenshot per combination as <dir>/<prefix>-sim15-1440x900-closed3-....png
 *   OFFICE_QUICK=1 npm run check:office        a smaller matrix (sizes x sims x 0/1/3/all closed, one subset each)
 *
 * Runs against the simulator only (no AI credits). For SIM=12 and SIM=15, at 1440x900 and 1280x800, with 0, 1, 3, 4 and all
 * rooms closed (every subset of 1 and 3 rooms, plus `?closed=` by room name), and again after expanding a `+N more` chip,
 * it measures the rendered boxes and fails (exit code 1) on:
 *   - two boxes intersecting (desk cards, helper tiles, `+N more`/`Show fewer` chips, helper strips, door plates; tolerance 0.5px),
 *   - a box sticking out of its room / door row / floor (clipped by the floor's overflow:hidden),
 *   - a unit that does not contain its own desk and helpers,
 *   - a helper strip with a background, border or a height that is not its content's (the 2026-10-16 `.strip` collision),
 *   - the floor scrolling or the page overflowing (stage data-fit must be ok), text below 10.5px,
 *   - the lobby (spec 024): missing, sticking out of the floor, overlapping a room or the door plates, not holding its places (5 plus the custom ones, spec 024 FR-026), more than one row of tiles, a missing Add button below 8 tiles or one at 8, a place or slot
 *     sticking out of its tile, a walking figure that is not standing on a slot once the walks have settled, or more figures than empty chairs.
 *   - room headers (spec 001 FR-023/FR-024, also `simrooms=solo`: one agent per folder): two header parts overlapping, or one leaving its header;
 *   - the chat panel (spec 005 SC-001): for every main agent, Copilot-only and mixed kinds, no page overflow and the header's chips and
 *     buttons inside the window without overlapping;
 *   - floors (spec 033, `simfloors=1`): with two or more floors on, a room header or door plate without its floor tag; with one floor on,
 *     any floor tag; the top bar controls overlapping each other or sticking out of the window (the Floors button must fit at 1280x800);
 *     a 40-character floor name (renamed through the panel) breaking a room header, a plate or the top bar; a floor that is off with agents
 *     waiting for you that does not say so on its row in the Floors panel, or that shows it anywhere else (pills, button) (FR-010, issue #122).
 *
 * Fonts: CI runs on Ubuntu, where `system-ui` is DejaVu Sans, which is wider than the macOS fonts (PR #124: the top bar fitted on a
 * Mac and overflowed in CI). To measure like CI on any machine, point OFFICE_FONT_FILE at DejaVuSans.ttf (and optionally
 * OFFICE_FONT_BOLD at DejaVuSans-Bold.ttf, OFFICE_FONT_MONO at DejaVuSansMono.ttf); every page then uses only those fonts:
 *   OFFICE_FONT_FILE=/path/DejaVuSans.ttf OFFICE_FONT_BOLD=/path/DejaVuSans-Bold.ttf OFFICE_FONT_MONO=/path/DejaVuSansMono.ttf npm run check:office
 * On Linux the same effect comes from a fontconfig with only DejaVu and Liberation (Vikram's recipe in PR #124):
 *   printf '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/usr/share/fonts/truetype/dejavu</dir><dir>/usr/share/fonts/truetype/liberation</dir><cachedir>/tmp/fc-cache</cachedir><include ignore_missing="yes">/etc/fonts/conf.d</include></fontconfig>' > /tmp/fonts.conf
 *   FONTCONFIG_FILE=/tmp/fonts.conf npm run check:office
 * The font files are handed to the page as data (FontFace), so the app's CSP is not touched.
 * An expanded `+N more` is allowed to scroll the floor (the spec says it expands in place) but must still not overlap.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const SIZES = [[1440, 900], [1280, 800]];
const SIMS = [12, 15];
const TOL = 0.5;
/* A value as a JavaScript literal that is safe to splice into code run in the page: JSON, with the characters that could end a
   script or a string in some contexts escaped (CodeQL js/bad-code-sanitization; the recommended escaping). */
const UNSAFE = { '<': '\\u003C', '>': '\\u003E', '/': '\\u002F', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const jsLiteral = (v) => JSON.stringify(v).replace(/[<>/\u2028\u2029]/g, (c) => UNSAFE[c]);

/* runs inside the page; returns {problems:[...], info:{...}} */
function pageCheck(expanded, expectPlaces) {
  const T = 0.5;
  const stage = document.getElementById('stage'), floor = document.getElementById('floor');
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const name = (e) => {
    const id = e.dataset && (e.dataset.id || e.dataset.door || e.dataset.more);
    const p = e.closest('.unit'), pid = p && p.dataset.key;
    return (e.className && typeof e.className === 'string' ? e.className.split(' ').slice(0, 2).join('.') : e.tagName) + (id ? '[' + id + ']' : pid ? '{' + pid + '}' : '');
  };
  const problems = [];
  const items = [...stage.querySelectorAll('.desk, .helper, .more, .helpers, .plate, .place, .place-add')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.contains(b) || b.contains(a)) continue; /* a strip contains its tiles */
    /* `full` density tucks the helper column 2px under its own desk's connector on purpose; its tiles are still checked */
    const own = (x, y) => x.classList.contains('desk') && y.classList.contains('helpers') && x.closest('.unit') === y.closest('.unit');
    if (own(a, b) || own(b, a)) continue;
    const p = R(a), q = R(b);
    const ox = Math.min(p.r, q.r) - Math.max(p.x, q.x), oy = Math.min(p.b, q.b) - Math.max(p.y, q.y);
    if (ox > T && oy > T) problems.push(`overlap ${name(a)} x ${name(b)} by ${ox.toFixed(1)}x${oy.toFixed(1)}px`);
  }
  const fr = R(floor), cs = getComputedStyle(floor);
  const fx0 = fr.x + parseFloat(cs.paddingLeft) - 1, fx1 = fr.r - parseFloat(cs.paddingRight) + 1, fy1 = fr.b - parseFloat(cs.paddingBottom) + 1;
  const inside = (e, box, what) => {
    const p = R(e);
    if (p.x < box.x - 1 || p.r > box.r + 1 || p.y < box.y - 1 || p.b > box.b + 1) problems.push(`${name(e)} sticks out of ${what} (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.r.toFixed(0)},${p.b.toFixed(0)} vs ${box.x.toFixed(0)},${box.y.toFixed(0)},${box.r.toFixed(0)},${box.b.toFixed(0)})`);
  };
  stage.querySelectorAll('.room').forEach((room) => {
    inside(room, { x: fx0, y: -1e9, r: fx1, b: expanded ? 1e9 : fy1 }, 'the floor');
    room.querySelectorAll('.desk, .helper, .more, .helpers').forEach((e) => inside(e, R(room), 'its room ' + room.dataset.key));
  });
  stage.querySelectorAll('.doors').forEach((d) => { inside(d, { x: fx0, y: -1e9, r: fx1, b: expanded ? 1e9 : fy1 }, 'the floor'); d.querySelectorAll('.plate').forEach((e) => inside(e, R(d), 'the door row')); });
  stage.querySelectorAll('.unit').forEach((u) => u.querySelectorAll('.desk, .helper, .more, .helpers').forEach((e) => inside(e, R(u), 'its unit ' + u.dataset.key)));
  /* lobby (spec 024 FR-004, FR-009) */
  const lobby = stage.querySelector('.lobby');
  if (!lobby) problems.push('no lobby in the office');
  else {
    const L = R(lobby);
    inside(lobby, { x: fx0, y: -1e9, r: fx1, b: expanded ? 1e9 : fy1 }, 'the floor');
    stage.querySelectorAll('.room, .doors').forEach((e) => {
      const p = R(e), ox = Math.min(p.r, L.r) - Math.max(p.x, L.x), oy = Math.min(p.b, L.b) - Math.max(p.y, L.y);
      if (ox > T && oy > T) problems.push(`lobby overlaps ${name(e)} by ${ox.toFixed(1)}x${oy.toFixed(1)}px`);
    });
    const places = [...lobby.querySelectorAll('.place')];
    if (places.length !== expectPlaces) problems.push(`lobby has ${places.length} places, not ${expectPlaces}`);
    /* spec 024 FR-022: custom places make tiles narrower, never a second row; the Add button is there below 8 tiles and gone at 8 */
    const tops = new Set(places.map((pl) => Math.round(R(pl).y)));
    if (tops.size > 1) problems.push(`lobby tiles are on ${tops.size} rows, not one`);
    if (L.h > 38) problems.push(`lobby is ${L.h.toFixed(0)}px tall, not 36`);
    const addBtns = lobby.querySelectorAll('.place-add');
    if (addBtns.length !== (places.length < 8 ? 1 : 0)) problems.push(`${addBtns.length} Add buttons with ${places.length} places`);
    addBtns.forEach((b) => { inside(b, L, 'the lobby'); if (!b.getAttribute('aria-label')) problems.push('the Add button has no accessible name'); });
    places.forEach((pl) => { const n = pl.querySelector('.pn'); if (!n || !pl.getAttribute('aria-label').startsWith(n.textContent + ':') || !pl.title.startsWith(n.textContent + ':')) problems.push(`place ${pl.dataset.place}: its full name is not in the tooltip and the label`); });
    places.forEach((pl) => { inside(pl, L, 'the lobby'); pl.querySelectorAll('.pic, .pn, .prow, .slot').forEach((e) => inside(e, R(pl), 'its place ' + pl.dataset.place)); });
    const slots = [...lobby.querySelectorAll('.slot.on')].map(R);
    const walkers = [...document.querySelectorAll('#walkers .walker')];
    walkers.forEach((w) => {
      const b = R(w), cx = (b.x + b.r) / 2, cy = (b.y + b.b) / 2;
      if (!slots.some((q) => Math.abs((q.x + q.r) / 2 - cx) < 4 && Math.abs((q.y + q.b) / 2 - cy) < 4)) problems.push(`a walking figure is not on a slot (${cx.toFixed(0)},${cy.toFixed(0)})`);
    });
    /* an empty chair means its agent is at a place (a visitor listed in a tile); a closed room keeps its visitors in the lobby on purpose */
    const who = places.map((pl) => pl.getAttribute('aria-label')).join(', ');
    document.querySelectorAll('#stage .desk.is-away').forEach((d) => { const n = d.querySelector('.name'); if (n && !who.includes(n.textContent.trim())) problems.push(`empty chair of ${n.textContent.trim()} but nobody of that name is at a place`); });
  }
  /* spec 001 FR-025 (T031): a desk name longer than three characters shows at least three of them */
  stage.querySelectorAll('.desk .l1 .name').forEach((n) => {
    const full = n.textContent.trim(); if ([...full].length <= 3 || !n.getClientRects().length) return;
    if (n.scrollWidth <= n.clientWidth + 0.5) return; /* not cut */
    const probe = n.cloneNode(false); probe.textContent = [...full].slice(0, 3).join('') + '…';
    Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', overflow: 'visible', minWidth: '0', maxWidth: 'none', width: 'auto' });
    n.parentNode.appendChild(probe); const need = probe.getBoundingClientRect().width; probe.remove();
    if (n.clientWidth + 0.5 < need) problems.push(`desk name "${full}" shows fewer than three characters (${n.clientWidth}px, needs ${need.toFixed(0)}px)`);
  });
  /* spec 001 FR-023 (T030): a room header's parts (door, name, path, dots, +, MCP, AIU, plant, floor tag) never overlap or leave the header */
  stage.querySelectorAll('.room-head').forEach((hd) => {
    const H = R(hd), key = (hd.closest('.room') || {}).dataset?.key || '?';
    const parts = [...hd.children].filter((e) => e.getClientRects().length && R(e).w > 0 && getComputedStyle(e).visibility !== 'hidden');
    parts.forEach((e) => { const p = R(e), slack = e.classList.contains('door') ? 5 : 1; /* the door hangs 4px left on purpose */ if (p.x < H.x - slack || p.r > H.r + 1) problems.push(`header part ${name(e)} sticks out of the header of ${key}`); });
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const p = R(parts[i]), q = R(parts[j]);
      const ox = Math.min(p.r, q.r) - Math.max(p.x, q.x), oy = Math.min(p.b, q.b) - Math.max(p.y, q.y);
      if (ox > T && oy > T) problems.push(`header of ${key}: ${name(parts[i])} overlaps ${name(parts[j])} by ${ox.toFixed(1)}px`);
    }
  });
  stage.querySelectorAll('.helpers').forEach((s) => {
    if (!s.classList.contains('hstrip')) return;
    const st = getComputedStyle(s), sr = R(s);
    if (st.backgroundColor !== 'rgba(0, 0, 0, 0)' || st.backgroundImage !== 'none') problems.push(`helper strip ${name(s)} has a background (${st.backgroundColor})`);
    if (parseFloat(st.borderBottomWidth) > 0) problems.push(`helper strip ${name(s)} has a border`);
    let bottom = sr.y; [...s.children].forEach((c) => { bottom = Math.max(bottom, R(c).b); });
    if (Math.abs(sr.b - bottom) > 1.5) problems.push(`helper strip ${name(s)} is ${sr.h.toFixed(0)}px tall but its content ends at ${(bottom - sr.y).toFixed(0)}px`);
  });
  const de = document.documentElement;
  if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1) problems.push(`page overflows (${de.scrollWidth}x${de.scrollHeight} in ${innerWidth}x${innerHeight})`);
  if (!expanded) {
    if (stage.dataset.fit !== 'ok' || floor.classList.contains('scrolls')) problems.push(`floor scrolls (fit=${stage.dataset.fit})`);
    if (floor.scrollHeight > floor.clientHeight + 1 || floor.scrollWidth > floor.clientWidth + 1) problems.push(`floor overflows (${floor.scrollWidth}x${floor.scrollHeight} in ${floor.clientWidth}x${floor.clientHeight})`);
  } else if (floor.scrollWidth > floor.clientWidth + 1) problems.push('floor overflows horizontally');
  let minFont = 99;
  stage.querySelectorAll('*').forEach((e) => { if (!e.children.length && e.textContent.trim() && e.getClientRects().length) minFont = Math.min(minFont, parseFloat(getComputedStyle(e).fontSize)); });
  if (minFont < 10.5) problems.push(`text below 10.5px (${minFont}px)`);
  const stageH = R(stage).h;
  return {
    problems,
    info: { d: stage.dataset.d, h: stage.dataset.h, fit: stage.dataset.fit, stageH: Math.round(stageH), floorH: Math.round(floor.clientHeight), desks: stage.querySelectorAll('.desk').length, plates: stage.querySelectorAll('.plate').length, rooms: stage.querySelectorAll('.room').length, minFont },
  };
}

/* spec 033: floor tags and the top bar; runs inside the page after pageCheck */
function floorsCheck(expectTags) {
  const problems = [];
  const stage = document.getElementById('stage');
  const boxes = [...stage.querySelectorAll('.room-head, .plate')];
  boxes.forEach((b) => {
    const t = b.querySelector('.floor-tag');
    if (expectTags && !t) problems.push('no floor tag in ' + (b.querySelector('.room-name, b') || b).textContent.trim());
    if (!expectTags && t) problems.push('floor tag shown with one floor on');
    if (t && t.getClientRects().length && parseFloat(getComputedStyle(t).fontSize) < 10.5) problems.push('floor tag below 10.5px');
  });
  const ctl = [...document.querySelectorAll('.topbar button, .topbar select, .topbar .tgl')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const R = (e) => e.getBoundingClientRect();
  ctl.forEach((e) => { const b = R(e); if (b.right > innerWidth + 0.5 || b.left < -0.5) problems.push(`top bar control sticks out: ${(e.id || e.textContent).trim().slice(0, 20)}`); });
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    if (ctl[i].contains(ctl[j]) || ctl[j].contains(ctl[i])) continue;
    const p = R(ctl[i]), q = R(ctl[j]);
    const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left), oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (ox > 0.5 && oy > 0.5) problems.push(`top bar overlap ${(ctl[i].id || ctl[i].textContent).trim().slice(0, 16)} x ${(ctl[j].id || ctl[j].textContent).trim().slice(0, 16)}`);
  }
  const btn = document.getElementById('floorsBtn');
  if (!btn || btn.hidden) problems.push('Floors button missing');
  /* every room header keeps the floor tag and the + / MCP buttons inside it (a long tag shrinks, it never pushes them out;
     the door button sits on the room's edge on purpose and is not checked) */
  stage.querySelectorAll('.room-head').forEach((h) => {
    const hb = R(h);
    [...h.querySelectorAll('.floor-tag, .room-new, .room-mcp, .room-dots, .room-aiu')].forEach((c) => { const b = R(c); if (b.width && (b.right > hb.right + 0.5 || b.left < hb.left - 0.5)) problems.push(`room header part sticks out: ${(c.className || c.tagName).toString().slice(0, 20)}`); });
  });
  return problems;
}

/* spec 033 FR-010 (issue #122): the off floor's row says what waits there; nothing else changes */
function offAttentionCheck() {
  const problems = [];
  const pop = document.getElementById('floorsPop');
  if (pop.hidden) document.getElementById('floorsBtn').click();
  const att = document.querySelector('#floorsPop [data-att="f-personal"]');
  const text = att && !att.hidden ? att.textContent : '';
  if (!/^Off, .*\d+ (waiting|errors?|at credit limit)/.test(text)) problems.push(`no attention text on the off floor's row (got "${text}")`);
  if (document.querySelector('#floorsPop [data-att="ground"]:not([hidden])')) problems.push('attention text on a floor that is on');
  const btn = document.getElementById('floorsBtn').textContent.trim();
  if (btn !== '2/3') problems.push(`button changed: ${btn}`);
  if (/waiting|error/i.test(btn)) problems.push('attention shown on the button');
  document.getElementById('floorsBtn').click();
  return problems;
}

function subsets(list, k) {
  const out = [];
  const rec = (start, cur) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let i = start; i < list.length; i++) { cur.push(list[i]); rec(i + 1, cur); cur.pop(); } };
  rec(0, []);
  return out;
}

async function driver(ctx) {
  const quick = process.env.OFFICE_QUICK === '1';
  const shotsDir = process.env.OFFICE_SHOTS || '';
  const prefix = process.env.OFFICE_SHOT_PREFIX || 'office';
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  const sleep = ctx.sleep;
  let total = 0, failed = 0;
  /* CI shards (spec 008 delta 2026-10-19): OFFICE_SHARDS=n OFFICE_SHARD=k runs every n-th unit (one window size of one block)
     starting at k, so n parallel jobs cover the whole check. Unset: everything, as before. */
  const SHARDS = Math.max(1, Number(process.env.OFFICE_SHARDS) || 1), SHARD = Number(process.env.OFFICE_SHARD) || 0;
  let unit = 0;
  const mine = () => unit++ % SHARDS === SHARD;
  if (SHARDS > 1) console.log(`check:office: shard ${SHARD + 1} of ${SHARDS}`);
  let expectPlaces = 5; /* spec 024 FR-026: five built-in places plus simplaces=N custom ones, read from the query of the page just loaded */
  const rows = [];
  /* optional CI-like fonts (see the header): read once, handed to every page as data */
  const fontB64 = (k) => (process.env[k] ? fs.readFileSync(process.env[k]).toString('base64') : '');
  const FONTS = { regular: fontB64('OFFICE_FONT_FILE'), bold: fontB64('OFFICE_FONT_BOLD'), mono: fontB64('OFFICE_FONT_MONO') };
  if (FONTS.regular) console.log('check:office: forcing the fonts from OFFICE_FONT_FILE' + (FONTS.bold ? ' (+bold)' : '') + (FONTS.mono ? ' (+mono)' : ''));
  const forceFonts = async (w, h) => {
    if (!FONTS.regular) return;
    await ctx.js(`(async()=>{const buf=b=>{const s=atob(b),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a.buffer;};
      const add=async(b,fam,o)=>{if(!b)return;const f=new FontFace(fam,buf(b),o);await f.load();document.fonts.add(f);};
      await add(${JSON.stringify(FONTS.regular)},'CheckSans',{weight:'100 599'});
      await add(${JSON.stringify(FONTS.bold || FONTS.regular)},'CheckSans',{weight:'600 900'});
      await add(${JSON.stringify(FONTS.mono || FONTS.regular)},'CheckMono',{});
      const st=document.createElement('style');st.textContent='*{font-family:CheckSans!important}.room-path,.mono,.lcell.mono,.folder,code,pre,kbd{font-family:CheckMono!important}';document.head.appendChild(st);})()`);
    /* the layout is cached by size: nudge the window so the office is laid out again with the new font */
    ctx.win.setContentSize(w - 1, h); await sleep(150); ctx.win.setContentSize(w, h); await sleep(300);
  };
  /* spec 036 FR-005: the theme under test travels in the page address (theme=, usertheme=); after every load the theme on
     screen must be the one asked for, or the run fails (it once measured Clean Office for every theme). */
  const userTheme = process.env.OFFICE_USER_THEME ? JSON.parse(fs.readFileSync(process.env.OFFICE_USER_THEME, 'utf8')) : null;
  const wantTheme = userTheme ? userTheme.id : (process.env.OFFICE_THEME || '');
  const themeQuery = (wantTheme ? '&theme=' + encodeURIComponent(wantTheme) : '') + (userTheme ? '&usertheme=' + encodeURIComponent(JSON.stringify(userTheme)) : '');
  if (wantTheme) console.log('check:office: theme ' + wantTheme + (userTheme ? ' (user theme from ' + path.basename(process.env.OFFICE_USER_THEME) + ')' : ''));
  const load = async (query, w, h) => {
    expectPlaces = 5 + Number((/(?:^|&)simplaces=([0-3])(?:&|$)/.exec(query) || [])[1] || 0);
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: Object.fromEntries(new URLSearchParams(query + themeQuery)) });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    if (wantTheme) {
      try { await ctx.waitFor(`window.THEME&&window.THEME.current().id===${JSON.stringify(wantTheme)}`, 5000); } catch (e) { /* reported below */ }
      const on = await ctx.js(`({id:window.THEME.current().id,ui:document.documentElement.dataset.ui||'clean',want:(window.THEME.current().manifest||{}).ui||'clean'})`);
      if (on.id !== wantTheme || on.ui !== on.want) throw new Error(`theme ${wantTheme} was not applied (on screen: ${on.id}, data-ui ${on.ui})`);
    }
    await forceFonts(w, h);
    await sleep(500);
    /* spec 024: agents go to the lobby after 600 ms and the walk takes about 1 s: wait until somebody is there and nobody is walking */
    try { await ctx.waitFor(`!!document.querySelector('.place.busy')`, 4000); await ctx.waitFor(`!document.querySelector('.walker.walking')`, 4000); await sleep(150); } catch (e) { /* nobody visits in this layout: the checks below still run */ }
  };
  const run = async (label, query, w, h, shot) => {
    await load(query, w, h);
    const res = await ctx.js(`(${pageCheck.toString()})(false, ${expectPlaces})`);
    total++;
    const bad = res.problems.length;
    if (bad) { failed++; console.log(`FAIL ${label}: ${res.problems.slice(0, 6).join('; ')}${bad > 6 ? ` (+${bad - 6} more)` : ''}`); }
    rows.push({ label, ...res.info, problems: bad });
    if (shotsDir && shot) await ctx.shot(path.join(shotsDir, `${prefix}-${shot}.png`));
    /* expand the first "+N more" in place and check again (overlap must still be 0) */
    const more = await ctx.js(`(()=>{const m=document.querySelector('#stage .more[aria-expanded="false"]');if(!m)return false;m.click();return true})()`);
    if (more) {
      await sleep(400);
      const r2 = await ctx.js(`(${pageCheck.toString()})(true, ${expectPlaces})`);
      total++;
      if (r2.problems.length) { failed++; console.log(`FAIL ${label} +expanded: ${r2.problems.slice(0, 6).join('; ')}`); }
    }
  };
  for (const sim of SIMS) {
    for (const [w, h] of SIZES) {
      if (!mine()) continue;
      const base = `sim=${sim}&simfreeze=1`;
      await load(base, w, h);
      /* spec 033 FR-007: with only the Ground floor the top bar is as before (no Floors button) */
      total++;
      if (!(await ctx.js(`document.getElementById('floorsBtn').hidden`))) { failed++; console.log(`FAIL sim${sim}-${w}x${h}: Floors button shown with one floor`); }
      const names = await ctx.js(`[...document.querySelectorAll('#stage .room-name')].map(e=>e.textContent.trim())`);
      const themeTag = process.env.OFFICE_THEME ? process.env.OFFICE_THEME + ' ' : '';
      const tag = `${themeTag}sim${sim}-${w}x${h}`;
      const combos = [{ n: 0, closed: [] }];
      for (let k = 1; k < names.length; k++) {
        let subs = subsets(names, k);
        if (k !== 1 && k !== 3 && subs.length > 3) subs = subs.slice(0, 3);
        if (quick) subs = subs.slice(0, 1);
        subs.forEach((s) => combos.push({ n: k, closed: s }));
      }
      combos.push({ n: names.length, closed: names });
      let shotted = new Set();
      for (const c of combos) {
        const q = base + (c.closed.length ? '&closed=' + c.closed.map(encodeURIComponent).join(',') : '');
        const key = c.n === names.length ? 'all' : String(c.n);
        const wantShot = !shotted.has(key) ? `${tag}-closed${key}` : '';
        if (wantShot) shotted.add(key);
        await run(`${tag} closed=${c.n}${c.closed.length ? ' [' + c.closed.join(',') + ']' : ''}`, q, w, h, wantShot);
      }
      /* interactive: Close all / Open all, and a single door */
      await load(base, w, h);
      await ctx.js(`document.getElementById('closeAll').click()`); await sleep(500);
      let r = await ctx.js(`(${pageCheck.toString()})(false, ${expectPlaces})`); total++;
      if (r.problems.length) { failed++; console.log(`FAIL ${tag} Close all click: ${r.problems.join('; ')}`); }
      await ctx.js(`document.getElementById('openAll').click()`); await sleep(500);
      r = await ctx.js(`(${pageCheck.toString()})(false, ${expectPlaces})`); total++;
      if (r.problems.length) { failed++; console.log(`FAIL ${tag} Open all click: ${r.problems.join('; ')}`); }
    }
  }
  /* spec 024 FR-026: the same base cases with three custom places (24-character names in the real run of shots-024-custom.js; the simulator seeds
     Database, Ticket desk and a 24-character name) so the lobby has 8 tiles. No extra room-closing combinations: none, the first room, the first three, all. */
  for (const sim of SIMS) {
    for (const [w, h] of SIZES) {
      if (!mine()) continue;
      const base = `sim=${sim}&simfreeze=1&simplaces=3`;
      await load(base, w, h);
      const names = await ctx.js(`[...document.querySelectorAll('#stage .room-name')].map(e=>e.textContent.trim())`);
      const tag = `places3 sim${sim}-${w}x${h}`;
      const cases = [[], names.slice(0, 1), names.slice(0, 3), names];
      for (const closed of cases) {
        const qy = base + (closed.length ? '&closed=' + closed.map(encodeURIComponent).join(',') : '');
        await run(`${tag} closed=${closed.length}`, qy, w, h, closed.length === 0 ? `${tag}-closed0` : '');
      }
    }
  }
  /* spec 001/002 deltas 2026-10-18 (issue #126): main agents with session titles (one long enough to be ellipsized), both sizes;
     the run fails when no title reached a card, so it cannot pass on a page without titles */
  for (const [w, h] of SIZES) {
    for (const sim of [12, 15]) {
      if (!mine()) continue;
      await run(`titles sim${sim}-${w}x${h}`, `sim=${sim}&simfreeze=1&simtitles=1`, w, h, sim === 15 ? `titles-sim15-${w}x${h}` : '');
      const shown = await ctx.js(`[...document.querySelectorAll('#stage .desk .name')].some((n)=>n.textContent==='Fix login bug')`);
      total++;
      if (!shown) { failed++; console.log(`FAIL titles sim${sim}-${w}x${h}: no session title on any card`); }
    }
  }
  /* spec 033: floors on/off (3, 2 and 1 floors on), with and without closed doors, both sizes */
  for (const [w, h] of SIZES) {
    if (!mine()) continue;
    const cases = [
      ['3 floors on', 'sim=15&simfreeze=1&simfloors=1', true],
      ['2 floors on', 'sim=15&simfreeze=1&simfloors=1&floorsoff=Personal', true],
      ['1 floor on', 'sim=15&simfreeze=1&simfloors=1&floorsoff=Personal,Client%20A', false],
      ['3 floors on, 2 doors closed', 'sim=15&simfreeze=1&simfloors=1&closed=blog,infra-notes', true],
      ['2 floors on, 1 door closed', 'sim=15&simfreeze=1&simfloors=1&floorsoff=Client%20A&closed=mcp-swiss', true],
      ['40-char floor name', 'sim=15&simfreeze=1&simfloors=1&closed=infra-notes', true, 'long'],
      /* spec 024 FR-026 with spec 033: floors on and three custom places together (8 lobby tiles); same assertions as every other case (pageCheck + floorsCheck) */
      ['3 floors on, 3 custom places', 'sim=15&simfreeze=1&simfloors=1&simplaces=3', true],
      ['2 floors on, 3 custom places, 1 door closed', 'sim=15&simfreeze=1&simfloors=1&simplaces=3&floorsoff=Personal&closed=mcp-swiss', true],
      ['1 floor on, 3 custom places', 'sim=15&simfreeze=1&simfloors=1&simplaces=3&floorsoff=Personal,Client%20A', false],
    ];
    for (const [label, q, tags, extra] of cases) {
      const tag = `floors ${w}x${h} ${label}`;
      if (extra === 'long') {
        /* rename Client A to the longest allowed name through the panel and its dialog, then check the office again */
        await load(q, w, h);
        await ctx.js(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));document.getElementById('floorsBtn').click();await w(100);
          document.querySelector('#floorsPop [data-fl="rename"][data-floor="f-clienta0"]').click();await w(100);
          document.getElementById('mdIn').value='Client A with a very long floor name 40!';
          [...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Rename').click();await w(200);
          document.getElementById('floorsBtn').click();await w(300);})()`);
        await sleep(400);
        const r1 = await ctx.js(`(${pageCheck.toString()})(false, ${expectPlaces})`); total++;
        if (r1.problems.length) { failed++; console.log(`FAIL ${tag}: ${r1.problems.slice(0, 6).join('; ')}`); }
        const named = await ctx.js(`[...document.querySelectorAll('#stage .floor-tag')].some(t=>t.textContent.length===40)`);
        if (!named) { failed++; console.log(`FAIL ${tag}: the 40-character name is not on a tag`); }
        rows.push({ label: tag, ...r1.info, problems: r1.problems.length });
        if (shotsDir) await ctx.shot(path.join(shotsDir, `${prefix}-floors-${w}x${h}-long-name.png`));
      } else await run(tag, q, w, h, shotsDir ? `floors-${w}x${h}-${label.replace(/[^a-z0-9]+/gi, '-')}` : '');
      const fp = await ctx.js(`(${floorsCheck.toString()})(${tags})`);
      total++;
      if (fp.length) { failed++; console.log(`FAIL ${tag}: ${fp.slice(0, 6).join('; ')}`); }
      if (/floorsoff=Personal(&|$)/.test(q)) {
        const ap = await ctx.js(`(${offAttentionCheck.toString()})()`);
        total++;
        if (ap.length) { failed++; console.log(`FAIL ${tag} off-floor attention: ${ap.join('; ')}`); }
      }
    }
  }
  /* spec 001 FR-023/FR-024 (T030): many folders with one agent each (simrooms=solo), with and without a closed door, both sizes */
  for (const [w, h] of SIZES) {
    for (const sim of SIMS) {
      if (!mine()) continue;
      await run(`solo sim${sim}-${w}x${h}`, `sim=${sim}&simfreeze=1&simrooms=solo`, w, h, shotsDir ? `solo-sim${sim}-${w}x${h}` : '');
      const names = await ctx.js(`[...document.querySelectorAll('#stage .room-name')].map(e=>e.textContent.trim())`);
      await run(`solo sim${sim}-${w}x${h} closed=1`, `sim=${sim}&simfreeze=1&simrooms=solo&closed=${encodeURIComponent(names[0] || '')}`, w, h, '');
      const tip = await ctx.js(`[...document.querySelectorAll('#stage .room-name')].every((n)=>(n.title||'').startsWith(n.textContent.replace(/…$/,'')))`);
      total++;
      if (!tip) { failed++; console.log(`FAIL solo sim${sim}-${w}x${h}: a room name has no full-name tooltip`); }
    }
  }
  /* spec 012 T018 (FR-068): Claude-like, Codex-like and basic agents beside Copilot. No floors here, so no floor-tag checks; the toolbar stays on one row */
  for (const [w, h] of SIZES) {
    if (!mine()) continue;
    const tag = `kinds ${w}x${h} mixed kinds`;
    await run(tag, 'sim=15&simfreeze=1&simkinds=mixed', w, h, shotsDir ? `kinds-${w}x${h}-mixed` : '');
    const row = await ctx.js(`(()=>{const t=[...document.querySelectorAll('#liveBar > button, #liveBar > select')].filter(e=>e.getClientRects().length).map(e=>Math.round(e.getBoundingClientRect().top));return {min:Math.min(...t),max:Math.max(...t),n:t.length}})()`);
    total++;
    if (row.max - row.min > 3) { failed++; console.log(`FAIL ${tag}: the toolbar wraps ${JSON.stringify(row)}`); }
    /* spec 012 FR-120: Claude chosen in the toolbar, its first model has efforts; the whole top bar stays inside the window */
    await ctx.js(`(async()=>{const s=document.getElementById('kindSel');s.value='claude';s.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,400));return true})()`);
    const fit = await ctx.js(`(()=>{const els=[...document.querySelectorAll('header button, header select, header .tgl, header .seg')].filter(e=>e.getClientRects().length);const r=els.map(e=>e.getBoundingClientRect());return {right:Math.max(...r.map(x=>x.right)),win:innerWidth,models:!document.getElementById('modelSel').hidden}})()`);
    total++;
    if (fit.right > fit.win + 0.5 || !fit.models) { failed++; console.log(`FAIL ${tag} claude chosen: top bar leaves the window or has no model list ${JSON.stringify(fit)}`); }
    const row2 = await ctx.js(`(()=>{const t=[...document.querySelectorAll('#liveBar > button, #liveBar > select')].filter(e=>e.getClientRects().length).map(e=>Math.round(e.getBoundingClientRect().top));return {min:Math.min(...t),max:Math.max(...t)}})()`);
    total++;
    if (row2.max - row2.min > 3) { failed++; console.log(`FAIL ${tag} claude chosen: the toolbar wraps ${JSON.stringify(row2)}`); }
  }
  /* spec 005 SC-001 / T025: the chat panel of every main agent at both sizes, Copilot-only and mixed kinds: no page overflow,
     the header's chips and buttons inside the window and not overlapping each other */
  const chatCheck = () => {
    const P = [], R = (e) => e.getBoundingClientRect(), T = 0.5;
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 1) P.push(`page overflows horizontally (${de.scrollWidth} > ${innerWidth})`);
    const groups = [...document.querySelectorAll('#panelHead .actions, #panelHead .ph-meta')];
    for (const g of groups) {
      const kids = [...g.children].filter((c) => c.getClientRects().length && R(c).width > 0);
      for (const c of kids) { const r = R(c); if (r.left < -1 || r.right > innerWidth + 1) P.push(`${c.id || c.className.split(' ')[0]} leaves the window (${Math.round(r.left)}-${Math.round(r.right)})`); }
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = R(kids[i]), b = R(kids[j]); const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > T && oy > T) P.push(`${kids[i].id || kids[i].className.split(' ')[0]} overlaps ${kids[j].id || kids[j].className.split(' ')[0]}`);
      }
    }
    const strip = document.getElementById('stripList');
    if (strip && R(strip).right > innerWidth + 1) P.push('the agent strip leaves the window');
    return P;
  };
  for (const [w, h] of SIZES) {
    for (const q of ['sim=15&simfreeze=1', 'sim=15&simfreeze=1&simkinds=mixed', 'sim=12&simfreeze=1&simtitles=1']) {
      if (!mine()) continue;
      await load(q, w, h);
      const ids = await ctx.js(`[...document.querySelectorAll('#stage .desk')].map((d)=>d.dataset.id)`);
      let bad = 0;
      for (const id of ids) {
        await ctx.js(`(async()=>{const d=document.querySelector('#stage .desk[data-id="${id}"]');if(d)d.click();await new Promise(r=>setTimeout(r,250));return true})()`);
        const p = await ctx.js(`(${chatCheck.toString()})()`);
        total++;
        if (p.length) { failed++; bad++; if (bad <= 3) console.log(`FAIL chat ${w}x${h} ${q} agent ${id}: ${p.slice(0, 4).join('; ')}`); }
        await ctx.js(`(async()=>{const b=document.getElementById('backBtn');if(b)b.click();await new Promise(r=>setTimeout(r,120));return true})()`);
      }
      rows.push({ label: `chat ${w}x${h} ${q}`, d: 'chat', h: '-', rooms: '-', plates: '-', desks: ids.length, stageH: 0, floorH: 0, minFont: '-', problems: bad });
    }
  }

  /* spec 005 FR-017 / T026: the card menu of a working main agent offers Stop and End session, a helper does not, and the menu fits the window */
  const openCardMenu = (id) => ctx.js(`(async()=>{const m=document.getElementById('modeMenu');if(m)m.remove();const d=document.querySelector('#stage [data-id="${id}"]');if(!d)return null;const r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.right-4,clientY:r.bottom-4}));await new Promise(r=>setTimeout(r,200));const mm=document.getElementById('modeMenu');if(!mm)return {open:false};const b=mm.getBoundingClientRect();return {open:true,stop:!!mm.querySelector('[data-op="stop"]'),end:!!mm.querySelector('[data-op="end"]'),fits:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,minFont:Math.min(...[...mm.querySelectorAll('b,small,p')].map(e=>parseFloat(getComputedStyle(e).fontSize)))}})()`);
  for (const [w, h] of SIZES) {
    if (!mine()) continue;
    await load('sim=15&simfreeze=1', w, h);
    const ids = await ctx.js(`(()=>({w:[...document.querySelectorAll('#stage .desk.is-working:not(.is-away), #stage .desk.is-thinking:not(.is-away)')].map(d=>d.dataset.id),hp:[...document.querySelectorAll('#stage .helper')].map(d=>d.dataset.id)}))()`);
    let bad = 0; const say = (m) => { bad++; failed++; console.log(`FAIL card menu ${w}x${h}: ${m}`); };
    total++; if (!ids.w.length) say('no working main agent to open the menu on');
    for (const id of ids.w.slice(0, 3)) {
      const r = await openCardMenu(id); total++;
      if (!r || !r.open) say(`menu did not open on ${id}`);
      else if (!r.stop || !r.end) say(`missing Stop/End on working agent ${id} ${JSON.stringify(r)}`);
      else if (!r.fits) say(`menu leaves the window on ${id}`);
      else if (r.minFont < 10.5) say(`menu text below 10.5px on ${id}`);
    }
    for (const id of ids.hp.slice(0, 2)) {
      const r = await openCardMenu(id); total++;
      if (r && r.open && (r.stop || r.end)) say(`helper ${id} has Stop/End`);
    }
    await ctx.js(`(()=>{const m=document.getElementById('modeMenu');if(m)m.remove();return true})()`);
    rows.push({ label: `card menu ${w}x${h}`, d: 'menu', h: '-', rooms: '-', plates: '-', desks: ids.w.length, stageH: 0, floorH: 0, minFont: '-', problems: bad });
  }

  /* spec 006 FR-023 (T031): the Previous sessions search box at both sizes: shown with 2+ entries, filters by title ignoring case and accents,
     "N of M" while a query is active, "No sessions match", Escape clears; the panel stays inside the window */
  for (const [w, h] of SIZES) {
    if (!mine()) continue;
    const tag = `previous-sessions search ${w}x${h}`;
    await load('sim=15&simfreeze=1', w, h);
    const ids = await ctx.js(`[...document.querySelectorAll('#stage .desk')].map((d)=>d.dataset.id)`);
    let found = false;
    for (const id of ids) {
      await ctx.js(`(async()=>{const d=document.querySelector('#stage .desk[data-id="${id}"]');if(d)d.click();await new Promise(r=>setTimeout(r,350));return true})()`);
      found = await ctx.js(`!!document.getElementById('prevQ')&&!document.getElementById('prevQ').closest('[hidden]')`);
      if (found) break;
      await ctx.js(`(async()=>{const b=document.getElementById('backBtn');if(b)b.click();await new Promise(r=>setTimeout(r,120));return true})()`);
    }
    const P = [];
    if (!found) P.push('no agent shows the search box (the simulator folder has Copilot sessions and VS Code chats)');
    else {
      const type = (q) => ctx.js(`(async()=>{const i=document.getElementById('prevQ');i.focus();i.value=${jsLiteral(q)};i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,80));
        return {rows:[...document.querySelectorAll('#prevLists .prev-row b')].map(b=>b.textContent),heads:[...document.querySelectorAll('#prevLists .prev-h')].map(x=>x.textContent.replace(/\\s+/g,' ')),empty:[...document.querySelectorAll('#prevLists .prev-nomatch')].length}})()`);
      const all = await type('');
      if (all.rows.length < 3 || /\d of \d/.test(all.heads.join(' '))) P.push(`empty query: ${JSON.stringify(all)}`);
      const a1 = await type('EXPLICACION');
      if (a1.rows.length !== 1 || !/Explicaci/.test(a1.rows[0]) || !/0 of 2/.test(a1.heads[0]) || !/1 of 2/.test(a1.heads[1]) || a1.empty !== 1) P.push(`accent/case query: ${JSON.stringify(a1)}`);
      const none = await type('zzzz');
      if (none.rows.length || none.empty !== 2 || !/0 of 2/.test(none.heads[0]) || !/0 of 2/.test(none.heads[1])) P.push(`no-match query: ${JSON.stringify(none)}`);
      await type('explicacion');
      if (shotsDir) await ctx.shot(path.join(shotsDir, `${prefix}-prevsearch-${w}x${h}.png`));
      await ctx.js(`document.getElementById('prevQ').focus()`);
      ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await sleep(250);
      const cleared = await ctx.js(`({v:document.getElementById('prevQ')&&document.getElementById('prevQ').value,rows:document.querySelectorAll('#prevLists .prev-row').length})`);
      if (cleared.v !== '' || cleared.rows < 3) P.push(`Escape did not clear the query: ${JSON.stringify(cleared)}`);
      const box = !(await ctx.js(`!!document.getElementById('prev')&&!!document.getElementById('prevQ')`)) ? null : await ctx.js(`(()=>{const r=document.getElementById('prev').getBoundingClientRect(),q=document.getElementById('prevQ').getBoundingClientRect(),de=document.documentElement;return {right:r.right,qr:q.right,ql:q.left,qh:q.height,w:innerWidth,sw:de.scrollWidth,fs:parseFloat(getComputedStyle(document.getElementById('prevQ')).fontSize)}})()`);
      if (!box) P.push('the search box is gone after Escape (the panel closed)');
      else if (box.right > box.w + 1 || box.qr > box.w + 1 || box.ql < -1 || box.sw > box.w + 1 || box.fs < 10.5) P.push(`layout: ${JSON.stringify(box)}`);
    }
    total++;
    if (P.length) { failed++; console.log(`FAIL ${tag}: ${P.join('; ')}`); }
    rows.push({ label: tag, d: 'prev', h: '-', rooms: '-', plates: '-', desks: ids.length, stageH: 0, floorH: 0, minFont: '-', problems: P.length });
  }

  console.log('\nlayout summary (density/helpers shown, stage height vs floor):');
  rows.forEach((r) => console.log(`  ${r.problems ? 'FAIL' : 'ok  '} ${r.label.padEnd(60)} ${String(r.d).padEnd(5)} h=${r.h} rooms=${r.rooms} plates=${r.plates} desks=${r.desks} stage ${r.stageH}/${r.floorH}px minFont=${r.minFont}`));
  console.log(`\noffice check: ${total - failed}/${total} checks passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  if (failed) fs.writeFileSync(path.join(os.tmpdir(), 'durbar-office-check.fail'), String(failed));
}

module.exports = driver;

if (require.main === module) {
  const { spawnSync } = require('child_process');
  if (!fs.existsSync(INDEX)) { console.error('dist/ missing: run npm run build first'); process.exit(2); }
  const marker = path.join(os.tmpdir(), 'durbar-office-check.fail');
  try { fs.rmSync(marker); } catch (_) { /* none */ }
  const electron = require('electron'); /* path to the binary */
  const env = { ...process.env, DURBAR_DRIVER: __filename, DURBAR_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-check-')), DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' };
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const args = ['.', '--no-sandbox'];
  const r = useXvfb ? spawnSync('xvfb-run', ['-a', electron, ...args], { cwd: ROOT, env, stdio: 'inherit' }) : spawnSync(electron, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (r.error) { console.error(r.error.message); process.exit(2); }
  process.exit(fs.existsSync(marker) ? 1 : r.status === 0 ? 0 : r.status || 1);
}
