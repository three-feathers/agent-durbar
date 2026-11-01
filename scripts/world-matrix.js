/*
 * World matrix (spec 098 FR-051, FR-054, FR-056; tasks T040): every `present` world moment x every world, one picture and one
 * check result per cell. Simulator only (no AI credits, no network). Pictures and `matrix.json` go to `out/world-matrix/`
 * (git-ignored) and nowhere else: never `docs/`, and this driver is not in shots-docs (FR-054).
 *
 *   npm run build && node scripts/world-matrix.js [--size 1280x800[,1440x900]] [--worlds photo,cave] [--forced-colors] [--out DIR]
 *   node scripts/world-matrix.js --selftest      the checks against fixture pages (a good root passes; each defect fails)
 *
 *   --size           window sizes (default both: 1440x900,1280x800); --forced-colors always runs at 1280x800 (FR-050)
 *   --worlds         world ids from the registry (default all); passed to the page as the `world` query option, which the Real
 *                    office world switch of spec 097 reads. Until a page reads it, every world shows the same flat rendering.
 *   --forced-colors  emulate `forced-colors: active` (world art may be hidden there, text must stay: 097 FR-051)
 *
 * Per cell: wait with `until()` for the moment's root `[data-surface=<id>]` (never a fixed sleep), then, on that root only:
 * text under 10.5 px, two text or control boxes overlapping, a text pair under 4.5:1 (3:1 for large text), a picture behind text.
 * A cell's checks FAIL the run only when its state is `built` or `fallback-flat` (FR-056); `designed` and `missing` cells are
 * shot and reported. A present moment with no scene below, or whose root never appears, always fails: a surface that cannot be
 * found must not pass. A `planned` moment has no root yet and is listed as skipped.
 *
 * Adding a scene: when a moment is flipped to `present` (T011), add its simulator URL options (and an optional page action to
 * reach it) to SCENES. The driver names any present moment that has none.
 *
 * `matrix.json` keeps one run per (size, forced colours): another invocation into the same folder replaces its own run and keeps
 * the others, so the weekly job's separate invocations end in one file.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const REGISTRY = path.join(ROOT, 'docs', 'experience', 'world-moments.json');
const DEFAULT_OUT = path.join(ROOT, 'out', 'world-matrix');
const SIZES = ['1440x900', '1280x800'];
const FORCED_SIZE = '1280x800';
const MIN_PX = 10.5;
const CHECKED_STATES = new Set(['built', 'fallback-flat']);

/* moment id -> { query: simulator URL options, act: optional page code that reaches the scene }. Literal data, no user text. */
const SCENES = {
  'office-floor': { query: { sim: '15' } },
  lobby: { query: { sim: '15' } },
  'boss-bank-post-coffee': { query: { sim: '15' } },
  'desk-card': { query: { sim: '15' } },
  walk: { query: { sim: '15' } },
  'lift-panel': { query: { sim: '15', simfloors: '1' } },
  'all-floors': { query: { sim: '15', simfloors: '1' } },
};

/* Runs inside the page: the checks on one moment root. Returns { found, problems }. Self-contained (it is sent as source). */
function rootCheck(selector, minPx) {
  const root = document.querySelector(selector);
  if (!root) return { found: false, problems: [`no element matches ${selector}`] };
  { const b = root.getBoundingClientRect(), cs = getComputedStyle(root); if (!(b.width > 0 && b.height > 0) || cs.visibility === 'hidden' || cs.display === 'none') return { found: false, problems: [`${selector} is on the page but hidden`] }; } /* a hidden root has nothing to check: it must not pass as clean */
  const problems = [];
  const visible = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (e) => (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '')).slice(0, 40);
  const hasOwnText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const textEls = [root, ...root.querySelectorAll('*')].filter((e) => !e.closest('svg') && hasOwnText(e) && visible(e));
  /* 1. text size, per root */
  for (const e of textEls) {
    const px = parseFloat(getComputedStyle(e).fontSize);
    if (px < minPx) problems.push(`text ${px}px < ${minPx}px: ${label(e)} "${e.textContent.trim().slice(0, 24)}"`);
  }
  /* 2. overlap of text and control boxes (neither contains the other) */
  const boxes = [...new Set([...textEls, ...root.querySelectorAll('button, a[href], input, select, textarea, img')].filter(visible))];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.contains(b) || b.contains(a)) continue;
    const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left), oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (ox > 0.5 && oy > 0.5) problems.push(`overlap ${label(a)} x ${label(b)} by ${ox.toFixed(1)}x${oy.toFixed(1)}px`);
  }
  /* 3. contrast against the nearest opaque background; a picture behind text is a failure */
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const backdrop = (e) => {
    const stack = [];
    for (let n = e; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { picture: true };
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  for (const e of textEls) {
    const cs = getComputedStyle(e);
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = backdrop(e);
    if (bg.picture) { problems.push(`picture behind text: ${label(e)} "${e.textContent.trim().slice(0, 24)}"`); continue; }
    const f = fg.a < 1 ? over(fg, bg) : fg;
    const l1 = lum(f), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) problems.push(`contrast ${ratio.toFixed(2)}:1 < ${need}:1: ${label(e)} "${e.textContent.trim().slice(0, 24)}"`);
  }
  return { found: true, problems };
}

function readRegistry(file) {
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!reg || !Array.isArray(reg.moments) || !reg.worlds) throw new Error('registry: moments or worlds missing');
  return reg;
}

/* What to run: present moments x chosen worlds; planned moments are skipped. Pure, so the unit test and the driver agree. */
function plan(reg, worldsWanted) {
  const worlds = Object.keys(reg.worlds);
  const chosen = worldsWanted && worldsWanted.length ? worldsWanted : worlds;
  const unknown = chosen.filter((w) => !worlds.includes(w));
  if (unknown.length) throw new Error(`unknown world: ${unknown.join(', ')} (registry has ${worlds.join(', ')})`);
  const cells = [];
  for (const m of reg.moments) for (const w of chosen) cells.push({ moment: m.id, world: w, state: m.worlds[w], code: m.code });
  return cells;
}

/* Merge one run into an existing matrix.json: a run is replaced by the same (size, forced) key, others are kept. */
function mergeRun(existing, run) {
  const runs = ((existing && existing.runs) || []).filter((r) => !(r.size === run.size && r.forcedColors === run.forcedColors));
  runs.push(run);
  runs.sort((a, b) => (a.size + a.forcedColors).localeCompare(b.size + b.forcedColors));
  return { version: 1, runs };
}

/* A cell's verdict: only built and fallback-flat cells fail on their checks (FR-056); a root or scene that cannot be found always fails. */
function verdict(cell, result) {
  if (cell.code !== 'present') return { status: 'skipped', note: 'planned: no root yet' };
  if (result.noScene) return { status: 'fail', note: 'present moment has no scene in SCENES' };
  if (!result.found) return { status: 'fail', note: 'root never appeared' };
  if (!result.problems.length) return { status: 'ok' };
  return CHECKED_STATES.has(cell.state) ? { status: 'fail' } : { status: 'reported', note: `${cell.state}: shown flat, not failed` };
}

async function driver(ctx) {
  const { helpers, jsLiteral } = require('./driver-helpers');
  const H = helpers(ctx);
  const out = process.env.WORLD_MATRIX_OUT || DEFAULT_OUT;
  if (path.resolve(out).startsWith(path.join(ROOT, 'docs') + path.sep)) throw new Error('refusing to write under docs/');
  fs.mkdirSync(out, { recursive: true });
  const forced = process.env.WORLD_MATRIX_FORCED === '1';
  const sizes = forced ? [FORCED_SIZE] : (process.env.WORLD_MATRIX_SIZE || SIZES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of sizes) if (!/^\d{3,4}x\d{3,4}$/.test(s)) throw new Error(`bad size: ${s}`);
  const reg = readRegistry(process.env.WORLD_MATRIX_REGISTRY || REGISTRY);
  const worlds = (process.env.WORLD_MATRIX_WORLDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cells = plan(reg, worlds);
  const dbg = ctx.win.webContents.debugger;
  let failed = 0;
  const file = path.join(out, 'matrix.json');
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { existing = null; }
  try {
    if (forced) { if (!dbg.isAttached()) dbg.attach('1.3'); await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }); }
    for (const size of sizes) {
      const [w, h] = size.split('x').map(Number);
      const run = { size, forcedColors: forced, cells: [] };
      for (const c of cells) {
        const rec = { moment: c.moment, world: c.world, state: c.state, code: c.code, picture: null, problems: [] };
        if (c.code === 'present') {
          const scene = SCENES[c.moment];
          if (!scene) verdictInto(rec, { noScene: true });
          else {
            await H.load({ w, h, query: { ...scene.query, simfreeze: '1', world: c.world }, ready: 'fit', settle: false });
            if (scene.act) await ctx.js(scene.act);
            const sel = `[data-surface="${c.moment}"]`; /* ids are kebab-case (registry schema, FR-011) */
            await H.until(`(()=>{const e=document.querySelector(${jsLiteral(sel)});return !!e&&e.getClientRects().length>0;})()`, 10000);
            await H.settle();
            const result = await ctx.js(`(${rootCheck.toString()})(${jsLiteral(sel)}, ${MIN_PX})`);
            const name = `${c.moment}-${c.world}-${size}${forced ? '-forced' : ''}.png`;
            await ctx.shot(path.join(out, name));
            rec.picture = name;
            verdictInto(rec, result);
          }
        } else verdictInto(rec, { found: false, problems: [] });
        if (rec.status === 'fail') { failed++; console.log(`FAIL ${rec.moment} / ${rec.world} @ ${size}${forced ? ' forced' : ''}: ${rec.note || rec.problems.slice(0, 6).join('; ')}`); }
        else if (rec.status === 'reported') console.log(`  reported ${rec.moment} / ${rec.world} @ ${size}: ${rec.problems.length} problem(s), ${rec.note}`);
        run.cells.push(rec);
      }
      existing = mergeRun(existing, run);
      const n = (s) => run.cells.filter((x) => x.status === s).length;
      console.log(`world matrix ${size}${forced ? ' forced-colors' : ''}: ${n('ok')} ok, ${n('fail')} failed, ${n('reported')} reported, ${n('skipped')} skipped (planned)`);
    }
  } finally {
    if (forced) { await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined); dbg.detach(); }
  }
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
  if (failed) fs.writeFileSync(process.env.OFFICE_FAIL_MARKER, String(failed));
  function verdictInto(rec, result) { const v = verdict(rec, { problems: [], ...result }); rec.problems = result.problems || []; rec.status = v.status; if (v.note) rec.note = v.note; }
}

/* --selftest: the checks against fixture pages. A defect must fail, a clean root must pass, a missing root must not pass. */
const GOOD = '<main data-surface="fx" style="font:14px sans-serif;background:#fff;color:#111;width:400px"><p>Hello there</p><button style="display:block;margin-top:20px">Go</button></main>';
const FIXTURES = {
  good: { html: GOOD, expect: 0 },
  'text too small': { html: GOOD.replace('<p>', '<p style="font-size:9px">'), expect: /text 9px/ },
  overlap: { html: '<main data-surface="fx" style="font:14px sans-serif;color:#111;background:#fff;position:relative;height:80px"><p style="position:absolute;top:0;left:0;margin:0">Alpha text</p><p style="position:absolute;top:4px;left:10px;margin:0">Beta text</p></main>', expect: /overlap/ },
  'low contrast': { html: GOOD.replace('<p>', '<p style="color:#bbb">'), expect: /contrast/ },
  'picture behind text': { html: GOOD.replace('<p>', '<p style="background-image:linear-gradient(red,blue)">'), expect: /picture behind text/ },
  'missing root': { html: GOOD.replace('data-surface="fx"', 'data-surface="other"'), expect: 'missing' },
  'hidden root (display)': { html: GOOD.replace('data-surface="fx" style="', 'data-surface="fx" style="display:none;'), expect: 'missing' },
  'hidden root (parent)': { html: '<div style="display:none">' + GOOD + '</div>', expect: 'missing' },
  'hidden root (visibility)': { html: GOOD.replace('data-surface="fx" style="', 'data-surface="fx" style="visibility:hidden;'), expect: 'missing' },
};
async function selftest(ctx) {
  const results = [];
  for (const [name, f] of Object.entries(FIXTURES)) {
    await ctx.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset=utf-8><body style="margin:8px">${f.html}`));
    const r = await ctx.js(`(${rootCheck.toString()})('[data-surface="fx"]', ${MIN_PX})`);
    const ok = f.expect === 'missing' ? r.found === false && r.problems.length === 1
      : f.expect === 0 ? r.found && r.problems.length === 0
      : r.found && r.problems.some((p) => f.expect.test(p));
    /* the verdict layer: a missing root fails even in a designed cell; a defect fails a built cell and is only reported in a designed one */
    const vBuilt = verdict({ code: 'present', state: 'built' }, r).status, vDesigned = verdict({ code: 'present', state: 'designed' }, r).status;
    const wantBuilt = f.expect === 0 ? 'ok' : 'fail', wantDesigned = f.expect === 0 ? 'ok' : f.expect === 'missing' ? 'fail' : 'reported';
    const ok2 = vBuilt === wantBuilt && vDesigned === wantDesigned;
    console.log(`${ok && ok2 ? '  ok  ' : 'FAIL '} selftest ${name}: ${r.problems.join('; ') || 'no problems'} (built ${vBuilt}, designed ${vDesigned})`);
    results.push(ok && ok2);
  }
  if (verdict({ code: 'present', state: 'built' }, { noScene: true }).status !== 'fail') results.push(false);
  if (verdict({ code: 'planned', state: 'missing' }, { found: false, problems: [] }).status !== 'skipped') results.push(false);
  console.log(`world matrix selftest: ${results.filter(Boolean).length}/${results.length}`);
  if (results.includes(false)) fs.writeFileSync(process.env.OFFICE_FAIL_MARKER, 'selftest');
}

module.exports = (ctx) => (process.env.WORLD_MATRIX_SELFTEST === '1' ? selftest(ctx) : driver(ctx))
  .catch((e) => { console.log('FAIL ' + (e && e.message)); fs.writeFileSync(process.env.OFFICE_FAIL_MARKER, 'error'); });
Object.assign(module.exports, { rootCheck, plan, mergeRun, verdict });

if (require.main === module) {
  const { spawnSync } = require('child_process');
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const known = new Set(['--size', '--worlds', '--forced-colors', '--out', '--selftest']);
  const bad = argv.filter((a, i) => a.startsWith('-') && !known.has(a));
  if (bad.length) { console.error(`unknown option: ${bad[0]}`); process.exit(2); }
  if (!fs.existsSync(INDEX) && !argv.includes('--selftest')) { console.error('dist/ missing: run npm run build first'); process.exit(2); }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-matrix-'));
  const marker = path.join(userData, 'matrix.fail');
  const env = { ...process.env, DURBAR_DRIVER: __filename, DURBAR_USER_DATA: userData, OFFICE_FAIL_MARKER: marker, DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' };
  if (val('--size')) env.WORLD_MATRIX_SIZE = val('--size');
  if (val('--worlds')) env.WORLD_MATRIX_WORLDS = val('--worlds');
  if (val('--out')) env.WORLD_MATRIX_OUT = path.resolve(val('--out'));
  if (argv.includes('--forced-colors')) env.WORLD_MATRIX_FORCED = '1';
  if (argv.includes('--selftest')) env.WORLD_MATRIX_SELFTEST = '1';
  const electron = require('electron');
  const args = ['.', '--no-sandbox', '--force-prefers-reduced-motion'];
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const r = useXvfb ? spawnSync('xvfb-run', ['-a', electron, ...args], { cwd: ROOT, env, stdio: 'inherit' }) : spawnSync(electron, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (r.error) { console.error(r.error.message); process.exit(2); }
  process.exit(fs.existsSync(marker) ? 1 : r.status === 0 ? 0 : r.status || 1);
}
