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
 *   - the lobby (spec 024): missing, sticking out of the floor, overlapping a room or the door plates, not holding its 5 places, a place or slot
 *     sticking out of its tile, a walking figure that is not standing on a slot once the walks have settled, or more figures than empty chairs.
 *   - floors (spec 033, `simfloors=1`): with two or more floors on, a room header or door plate without its floor tag; with one floor on,
 *     any floor tag; the top bar controls overlapping each other or sticking out of the window (the Floors button must fit at 1280x800);
 *     a 40-character floor name (renamed through the panel) breaking a room header, a plate or the top bar; a floor that is off with agents
 *     waiting for you that does not say so on its row in the Floors panel, or that shows it anywhere else (pills, button) (FR-010, issue #122).
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

/* runs inside the page; returns {problems:[...], info:{...}} */
function pageCheck(expanded) {
  const T = 0.5;
  const stage = document.getElementById('stage'), floor = document.getElementById('floor');
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const name = (e) => {
    const id = e.dataset && (e.dataset.id || e.dataset.door || e.dataset.more);
    const p = e.closest('.unit'), pid = p && p.dataset.key;
    return (e.className && typeof e.className === 'string' ? e.className.split(' ').slice(0, 2).join('.') : e.tagName) + (id ? '[' + id + ']' : pid ? '{' + pid + '}' : '');
  };
  const problems = [];
  const items = [...stage.querySelectorAll('.desk, .helper, .more, .helpers, .plate, .place')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
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
    if (places.length !== 5) problems.push(`lobby has ${places.length} places, not 5`);
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
  const btn = document.getElementById('floorsBtn').textContent;
  if (btn !== 'Floors 2/3') problems.push(`button changed: ${btn}`);
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
  const rows = [];
  const load = async (query, w, h) => {
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: Object.fromEntries(new URLSearchParams(query)) });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    await sleep(500);
    /* spec 024: agents go to the lobby after 600 ms and the walk takes about 1 s: wait until somebody is there and nobody is walking */
    try { await ctx.waitFor(`!!document.querySelector('.place.busy')`, 4000); await ctx.waitFor(`!document.querySelector('.walker.walking')`, 4000); await sleep(150); } catch (e) { /* nobody visits in this layout: the checks below still run */ }
  };
  const run = async (label, query, w, h, shot) => {
    await load(query, w, h);
    const res = await ctx.js(`(${pageCheck.toString()})(false)`);
    total++;
    const bad = res.problems.length;
    if (bad) { failed++; console.log(`FAIL ${label}: ${res.problems.slice(0, 6).join('; ')}${bad > 6 ? ` (+${bad - 6} more)` : ''}`); }
    rows.push({ label, ...res.info, problems: bad });
    if (shotsDir && shot) await ctx.shot(path.join(shotsDir, `${prefix}-${shot}.png`));
    /* expand the first "+N more" in place and check again (overlap must still be 0) */
    const more = await ctx.js(`(()=>{const m=document.querySelector('#stage .more[aria-expanded="false"]');if(!m)return false;m.click();return true})()`);
    if (more) {
      await sleep(400);
      const r2 = await ctx.js(`(${pageCheck.toString()})(true)`);
      total++;
      if (r2.problems.length) { failed++; console.log(`FAIL ${label} +expanded: ${r2.problems.slice(0, 6).join('; ')}`); }
    }
  };
  for (const sim of SIMS) {
    for (const [w, h] of SIZES) {
      const base = `sim=${sim}&simfreeze=1`;
      await load(base, w, h);
      const names = await ctx.js(`[...document.querySelectorAll('#stage .room-name')].map(e=>e.textContent.trim())`);
      const tag = `sim${sim}-${w}x${h}`;
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
      let r = await ctx.js(`(${pageCheck.toString()})(false)`); total++;
      if (r.problems.length) { failed++; console.log(`FAIL ${tag} Close all click: ${r.problems.join('; ')}`); }
      await ctx.js(`document.getElementById('openAll').click()`); await sleep(500);
      r = await ctx.js(`(${pageCheck.toString()})(false)`); total++;
      if (r.problems.length) { failed++; console.log(`FAIL ${tag} Open all click: ${r.problems.join('; ')}`); }
    }
  }
  /* spec 033: floors on/off (3, 2 and 1 floors on), with and without closed doors, both sizes */
  for (const [w, h] of SIZES) {
    const cases = [
      ['3 floors on', 'sim=15&simfreeze=1&simfloors=1', true],
      ['2 floors on', 'sim=15&simfreeze=1&simfloors=1&floorsoff=Personal', true],
      ['1 floor on', 'sim=15&simfreeze=1&simfloors=1&floorsoff=Personal,Client%20A', false],
      ['3 floors on, 2 doors closed', 'sim=15&simfreeze=1&simfloors=1&closed=blog,infra-notes', true],
      ['2 floors on, 1 door closed', 'sim=15&simfreeze=1&simfloors=1&floorsoff=Client%20A&closed=mcp-swiss', true],
      ['40-char floor name', 'sim=15&simfreeze=1&simfloors=1&closed=infra-notes', true, 'long'],
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
        const r1 = await ctx.js(`(${pageCheck.toString()})(false)`); total++;
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
