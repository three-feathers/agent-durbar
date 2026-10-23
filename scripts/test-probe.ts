/**
 * The office layout search's trial helpers (spec 001 FR-033): `svgHollow` keeps every outer <svg> tag and drops what is inside,
 * `styleSplit` separates style attributes, and the app and styles keep the conditions the in-place update relies on.
 * `npm run test:probe`. No credits spent. The layouts themselves are compared in the browser (spec 001 FR-033 verification).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const { svgHollow, styleSplit } = require(path.join(R, 'probe.js')) as {
  svgHollow: (h: string) => string;
  styleSplit: (h: string) => { bare: string; vals: string[] };
};

// no svg: unchanged
assert.strictEqual(svgHollow('<div class="a">x</div>'), '<div class="a">x</div>');
assert.strictEqual(svgHollow(''), '');
// the outer tag and its attributes stay, the drawing goes
assert.strictEqual(svgHollow('<b><svg class="scene" viewBox="0 0 10 10" data-sig="x"><g><rect/></g></svg></b>'), '<b><svg class="scene" viewBox="0 0 10 10" data-sig="x"></svg></b>');
// nested svg is part of the drawing
assert.strictEqual(svgHollow('<svg a="1"><svg b="2"><path/></svg><circle/></svg><i>t</i>'), '<svg a="1"></svg><i>t</i>');
// a self-closing svg, alone and nested
assert.strictEqual(svgHollow('<svg a="1"/><p>x</p>'), '<svg a="1"/><p>x</p>');
assert.strictEqual(svgHollow('<svg a="1"><svg b="2"/><g/></svg>|'), '<svg a="1"></svg>|');
// several in a row, text between them kept
assert.strictEqual(svgHollow('a<svg x="1"><g/></svg>b<svg y="2"><g/></svg>c'), 'a<svg x="1"></svg>b<svg y="2"></svg>c');
// unclosed: the rest is left as it is (never throws, never loops)
assert.strictEqual(svgHollow('<svg x="1"><g>'), '<svg x="1"><g>');
assert.strictEqual(svgHollow('<svg'), '<svg');
// linear time on a large input
{
  const big = '<div>' + '<span><svg class="s" viewBox="0 0 1 1"><g><path d="M0 0"/></g></svg></span>'.repeat(20000) + '</div>';
  const t = Date.now();
  const out = svgHollow(big);
  assert.ok(Date.now() - t < 2000, 'svgHollow is linear');
  assert.strictEqual((out.match(/<svg/g) || []).length, 20000);
  assert.ok(!out.includes('<path'));
}

// styleSplit: values in document order, the rest without them
{
  const a = styleSplit('<section class="room" style="--w:700;--min:200px" aria-label="x"><div class="units" style="--cols:3"></div></section>');
  assert.deepStrictEqual(a.vals, ['--w:700;--min:200px', '--cols:3']);
  assert.strictEqual(a.bare, '<section class="room" aria-label="x"><div class="units"></div></section>');
  const b = styleSplit('<section class="room" style="--w:480;--min:200px" aria-label="x"><div class="units" style="--cols:2"></div></section>');
  assert.strictEqual(a.bare, b.bare, 'two column counts differ only in style values');
  // data-style or text that only looks like a style attribute is not taken
  const c = styleSplit('<i data-style="a">style="b"</i>');
  assert.deepStrictEqual(c.vals, []);
}

// the app: every trial goes through probeSet (hollowed), and the probe's memory is cleared with it
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const cl = app.slice(app.indexOf('function chooseLayout('), app.indexOf('let layoutKey='));
assert.ok(cl.length > 100, 'chooseLayout found');
assert.ok(!/probe\.innerHTML=stageHTML\(/.test(cl), 'no trial parses the full drawings');
assert.ok((cl.match(/probeSet\(probe,stageHTML\(/g) || []).length >= 3, 'trials use probeSet');
assert.ok(/probe\.innerHTML='';\s*probePrev=null;/.test(cl), 'the probe and its memory are cleared together');
const ps = app.slice(app.indexOf('function probeSet('), app.indexOf('function chooseLayout('));
assert.ok(/^function probeSet\(probe,html\)\{\s*html=svgHollow\(html\);/.test(ps), 'probeSet hollows every trial first');
assert.ok(/probe\.innerHTML=html; probePrev=bare;/.test(ps), 'a full replace remembers what the probe holds');
// probe.js is loaded before app.js and packaged
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
assert.ok(html.indexOf('src="probe.js"') > 0 && html.indexOf('src="probe.js"') < html.indexOf('src="app.js"'), 'probe.js before app.js');
assert.ok(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8').includes("'probe.js'"), 'probe.js is copied');

// styles: --w, --min and --cols do not inherit, and only the element that carries them reads them
const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8').split(/\r?\n/);
for (const p of ['w', 'min', 'cols']) {
  assert.ok(css.some((l) => new RegExp(`@property --${p}\\{syntax:"\\*";inherits:false\\}`).test(l)), `--${p} is registered as not inherited`);
  const users = css.filter((l) => new RegExp(`var\\(--${p}[,)]`).test(l));
  for (const l of users) assert.ok(/^\.room\{|\.units\{/.test(l.trim()) || /^\.stage:not\(\[data-d="full"\]\) \.units(-in)?\{/.test(l.trim()), `--${p} read only by .room / .units / .units-in (spec 001 FR-053: the desk grid beside squeezed desks carries its own --cols): ${l.slice(0, 80)}`);
}
for (const f of fs.readdirSync(R).filter((x) => /\.(css|js)$/.test(x) && x !== 'styles.css')) {
  const s = fs.readFileSync(path.join(R, f), 'utf8');
  assert.ok(!/var\(--(w|min|cols)[,)]/.test(s), `${f} must not read --w, --min or --cols (they do not inherit)`);
}

// ---- spec 001 FR-041, FR-042, FR-046: grown desks. Which trials run and which result wins (pure); the real fit is measured in the page ----
type Res = { c: number; f: number; h: number } | null;
const G = require(path.join(R, 'probe.js')) as {
  GROW: { MIN: number; MAX: number; STEP: number; TWO_LINES: number };
  largest: (fits: (f: number) => boolean, lo: number, hi: number, step?: number) => number | null;
  better: (a: Res, b: Res) => boolean;
  pick: (cols: number[], lo: number, trial: (c: number, f: number) => { fits: boolean; h: number }) => Res;
};
assert.deepStrictEqual([G.GROW.MIN, G.GROW.MAX, G.GROW.STEP], [1, 2.5, 0.1], 'grows from 1.0 to 2.5 in 0.1 steps (owner: up to about 2.5x)');
{
  // largest: the largest step that fits, on the grid; null when even the smallest does not; never above the cap
  let calls = 0;
  const upTo = (lim: number) => (f: number) => { calls++; return f <= lim + 1e-9; };
  assert.strictEqual(G.largest(upTo(1.73), 1.1, 2.5), 1.7);
  assert.strictEqual(G.largest(upTo(9), 1.1, 2.5), 2.5, 'capped at 2.5');
  assert.strictEqual(G.largest(upTo(1.1), 1.1, 2.5), 1.1);
  assert.strictEqual(G.largest(upTo(1.05), 1.1, 2.5), null, 'does not fit one step up: no growth');
  for (let lim = 1.1; lim <= 2.5; lim += 0.1) assert.strictEqual(G.largest(upTo(lim), 1.1, 2.5), Math.round(lim * 10) / 10, `limit ${lim.toFixed(1)}`);
  calls = 0; G.largest(upTo(1.84), 1.1, 2.5); assert.ok(calls <= 6, `binary search: ${calls} trials for 15 steps`);
  // every f it tries is on the 0.1 grid (no 1.7000000000000002)
  const seen: number[] = []; G.largest((f) => { seen.push(f); return f <= 2; }, 1.1, 2.5);
  assert.ok(seen.every((f) => Math.abs(f * 10 - Math.round(f * 10)) < 1e-9 && String(f).length <= 3), `steps on the grid: ${seen.join(', ')}`);
}
{
  // better: larger f; same f: fills more height (4 px tolerance); then fewer columns
  assert.ok(G.better({ c: 1, f: 2, h: 100 }, { c: 3, f: 1.9, h: 800 }), 'larger f wins');
  assert.ok(G.better({ c: 3, f: 2, h: 700 }, { c: 2, f: 2, h: 600 }), 'same f: more height filled');
  assert.ok(G.better({ c: 2, f: 2, h: 600 }, { c: 3, f: 2, h: 602 }), 'same f, same height: fewer columns');
  assert.ok(!G.better(null, { c: 1, f: 1.1, h: 1 }) && G.better({ c: 1, f: 1.1, h: 1 }, null), 'anything beats nothing');
}
// A simple box model of the office (not the app's layout: a test double for the probe). Rooms are flex items of basis
// cols*262+(cols-1)*10+32 px, packed into rows; a room is 40 px of header plus rows of (92*f + 12) px desks; a 40 px lobby; 12 px gaps.
// A desk column is at most 400*f px wide (so wider rooms do not help).
function model(aw: number, ah: number, rooms: number[]) {
  return (c: number, f: number) => {
    const rs = rooms.map((n) => { const cols = Math.min(n, c); return { w: cols * 262 + (cols - 1) * 10 + 32, h: 40 + Math.ceil(n / cols) * (92 * f + 12) + 20 }; });
    if (rs.some((r) => r.w > aw)) return { fits: false, h: 1e9 };
    let total = 40, rowW = 0, rowH = 0;
    for (const r of rs) { if (rowW && rowW + 12 + r.w > aw) { total += rowH + 12; rowW = 0; rowH = 0; } rowW += (rowW ? 12 : 0) + r.w; rowH = Math.max(rowH, r.h); }
    total += rowH;
    return { fits: total <= ah, h: total };
  };
}
const split = (n: number, k: number) => { const out = Array(k).fill(0); for (let i = 0; i < n; i++) out[Math.min(k - 1, Math.floor((i * k) / n))]++; return out.filter((x) => x > 0); };
for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
  const aw = w - 32, ah = h - 100;
  for (const k of [1, 2, 3]) {
    let prev = Infinity;
    for (const n of [1, 2, 4, 6, 10, 15]) {
      if (n < k) continue;
      const rooms = split(n, k), maxCap = Math.max(1, Math.min(Math.max(...rooms), Math.floor((aw - 32 + 10) / 272)));
      const cols: number[] = []; for (let c = maxCap; c >= 1; c--) cols.push(c);
      const r = G.pick(cols, 1.1, model(aw, ah, rooms));
      const f = r ? r.f : 1;
      assert.ok(f <= prev + 1e-9, `${w}x${h}, ${k} folders: f grew from ${prev} to ${f} at ${n} agents`);
      assert.ok(f >= 1 && f <= 2.5, `${w}x${h} ${n}/${k}: f ${f} in range`);
      if (r) { assert.ok(model(aw, ah, rooms)(r.c, r.f).fits, `${w}x${h} ${n}/${k}: the pick fits`); assert.ok(!model(aw, ah, rooms)(r.c, Math.round((r.f + 0.1) * 10) / 10).fits || r.f === 2.5, `${w}x${h} ${n}/${k}: one step larger does not fit (the largest)`); }
      if (n <= 2) assert.strictEqual(f, 2.5, `${w}x${h}: ${n} agents in ${k} folders grow to the cap`);
      prev = f;
    }
  }
}
// the app: the grow search runs after the candidates, only after `full` or `roomy`, never with a forced density; the probe is reset
{
  const cl2 = app.slice(app.indexOf('function chooseLayout('), app.indexOf('let layoutKey='));
  assert.ok(/if\(res&&res\.fit&&!FORCE_DENSITY&&\(res\.d==='full'\|\|res\.d==='roomy'\)\)\{\s*const g=growSearch\(sizing,aw,ah,openOnly,GR\.MIN\+GR\.STEP\);/.test(cl2), 'grow only after full or roomy, one step up at least');
  assert.ok(cl2.indexOf('growSearch(sizing') > cl2.indexOf('for(const [d,hcap,side] of cands)') && cl2.indexOf('growSearch(sizing') < cl2.indexOf('Leftover floor space'), 'after the candidates, before the helper boost');
  assert.ok(/probe\.innerHTML='';\s*probePrev=null;\s*LIVE_SIDE=false;\s*GROW=0;\s*setGrow\(probe,0\);/.test(cl2), 'the probe drops the grow factor with its content');
  const gs = app.slice(app.indexOf('function growSearch('), app.indexOf('let layoutKey='));
  assert.ok(/window\.DurbarProbe\.pick\(cols,lo,/.test(gs) && /probeSet\(probe,stageHTML\(sizing,'roomy',aw,c\)\)/.test(gs), 'growSearch uses pick and probeSet');
  assert.ok(/GROW=0; setGrow\(probe,0\);\s*return best;/.test(gs), 'growSearch resets the probe');
  // review of #532: a grown render leaves GROW on; each search starts with it off, before any candidate is probed
  const cl = app.slice(app.indexOf('function chooseLayout('), app.indexOf('function growSearch('));
  const reset = cl.indexOf('GROW=0; setGrow(probe,0);');
  assert.ok(reset > 0 && reset < cl.indexOf('for(const [d,hcap,side] of cands)') && reset < cl.indexOf('probe.innerHTML=svgHollow'), 'chooseLayout starts with GROW off');
  // styles: the grown rules exist and keep text sizes (no font-size in them)
  const grown = css.filter((l) => l.includes('[data-grow'));
  assert.ok(grown.length >= 5, 'grown desk rules');
  assert.ok(grown.every((l) => !/font-size/.test(l)), 'grown desks keep the text sizes');
  assert.ok(grown.some((l) => /height:calc\(var\(--ch\) \* var\(--gf,1\)\)/.test(l)), 'the card height scales with --gf');
}
// ---- spec 001 FR-047, FR-048 (owner 2026-10-22): columns on a wide grown desk. More information, never longer lines ----
{
  type Cols = { n: number; main: number; reply: number; side: number };
  const P = require(path.join(R, 'probe.js')) as { GCOL: { GAP: number; MAIN: number[]; MAIN3: number[]; REPLY: number[]; SIDE: number[] }; grownCols: (room: number, o?: { reply?: boolean }) => Cols };
  const C = P.GCOL;
  assert.ok(C.MAIN[1] <= 450 && C.REPLY[1] <= 420 && C.SIDE[1] <= 320 && C.MAIN[0] + C.SIDE[0] + C.GAP - 1 <= 460, 'the measure: main <= 450 px (also a single column, below the two-column threshold, stays under 460 px), reply <= 420 px, facts <= 320 px (about 80-85 characters at 11.5-12 px)');
  const two = C.MAIN[0] + C.SIDE[0] + C.GAP, three = C.MAIN3[0] + C.REPLY[0] + C.SIDE[0] + 2 * C.GAP;
  // thresholds: one column below `two`, two from it, three from `three` (only with a reply to show)
  assert.deepStrictEqual(P.grownCols(two - 1, { reply: true }), { n: 1, main: two - 1, reply: 0, side: 0 }, 'narrow: the single-column grown desk');
  assert.strictEqual(P.grownCols(two, {}).n, 2, 'two columns from the threshold');
  assert.strictEqual(P.grownCols(three - 1, { reply: true }).n, 2, 'just under three: two');
  assert.strictEqual(P.grownCols(three, { reply: true }).n, 3, 'three columns with a reply');
  assert.strictEqual(P.grownCols(5000, {}).n, 2, 'no reply to show: never a reply column');
  assert.strictEqual(P.grownCols(5000).n, 2, 'no options: no reply column');
  assert.deepStrictEqual(P.grownCols(5000, { reply: true }), { n: 3, main: C.MAIN[1], reply: C.REPLY[1], side: C.SIDE[1] }, 'very wide: every column at its measure, the rest stays outside the desk');
  assert.deepStrictEqual(P.grownCols(0, { reply: true }), { n: 1, main: 0, reply: 0, side: 0 }, 'nothing');
  assert.deepStrictEqual(P.grownCols(NaN as unknown as number), { n: 1, main: 0, reply: 0, side: 0 }, 'not a number');
  // every width: the columns fit the room, stay within their measure, and the count never drops as the room grows
  for (const reply of [false, true]) {
    let prevN = 1;
    for (let w = 200; w <= 2400; w += 7) {
      const c = P.grownCols(w, { reply });
      const used = c.main + (c.n > 1 ? C.GAP + c.side : 0) + (c.n === 3 ? C.GAP + c.reply : 0);
      assert.ok(used <= w, `${w}${reply ? ' reply' : ''}: ${used} px used`);
      assert.ok(c.n >= prevN, `${w}${reply ? ' reply' : ''}: ${c.n} columns after ${prevN}`);
      if (c.n > 1) {
        assert.ok(c.main >= C.MAIN[0] && c.main <= C.MAIN[1], `${w}: main ${c.main}`);
        assert.ok(c.side >= C.SIDE[0] && c.side <= (c.n === 2 && reply ? C.REPLY[1] : C.SIDE[1]), `${w}: side ${c.side}`);
      }
      if (c.n === 3) assert.ok(c.reply >= C.REPLY[0] && c.reply <= C.REPLY[1] && c.main >= C.MAIN3[0], `${w}: reply ${c.reply}, main ${c.main}`);
      prevN = c.n;
    }
  }
  // the page: the render pass uses it on grown cards, and the probe never shows the side (the height does not depend on it)
  assert.ok(/function setGrownCols\(card\)\{[\s\S]*?window\.DurbarProbe\.grownCols\(room,\{reply:gx\.dataset\.rep==='1'\}\)/.test(app), 'setGrownCols uses grownCols');
  assert.ok(/if\(layout\.grow\)\{stage\.querySelectorAll\('\.desk\.card'\)\.forEach\(setGrownCols\);stage\.querySelectorAll\('\.desk\.card \.intent'\)\.forEach\(fitLines\);/.test(app), 'columns before the whole-line fit, only when grown');
  assert.ok(css.some((l) => /^\.desk\.card \.gx\{display:none\}/.test(l)), 'the side is hidden without data-gc (and in the probe)');
  assert.ok(css.filter((l) => /\.gx|gx-/.test(l)).every((l) => !/font-size:(\d+(\.\d+)?)px/.test(l) || parseFloat(/font-size:(\d+(\.\d+)?)px/.exec(l)![1]) >= 10.5), 'side text at least 10.5 px');
}
// spec 001 FR-086..FR-088 (issue #619): the spare height of a drawn office grows the room rows first (at most cap x the shortest), then
// even gaps above, between and below the rows; the 10 px row gap is a floor; never taller than the floor
{
  const { spreadRows } = require(path.join(R, 'probe.js')) as {
    spreadRows: (lines: { h: number; room: boolean }[], avail: number, gap: number, cap: number) => { rx: number; top: number; rowGap: number };
  };
  type Line = { h: number; room: boolean };
  const lay = (lines: Line[], r: { rx: number; top: number; rowGap: number }) => {
    const used = r.top + lines.reduce((t, l) => t + l.h + (l.room ? r.rx : 0), 0) + (lines.length - 1) * r.rowGap;
    return used;
  };
  const owner: Line[] = [{ h: 296, room: true }, { h: 58, room: false }, { h: 296, room: true }]; // 4 one-agent rooms, 2 rows, the lobby between
  // nothing to spare: nothing changes
  assert.deepStrictEqual(spreadRows(owner, 670, 10, 0.2), { rx: 0, top: 0, rowGap: 10 });
  assert.deepStrictEqual(spreadRows(owner, 500, 10, 0.2), { rx: 0, top: 0, rowGap: 10 }, 'an office that does not fit is left alone');
  assert.deepStrictEqual(spreadRows([], 800, 10, 0.2), { rx: 0, top: 0, rowGap: 10 });
  assert.deepStrictEqual(spreadRows(owner, NaN, 10, 0.2), { rx: 0, top: 0, rowGap: 10 });
  // a little to spare: the rooms take it all (rows grow first), the gaps stay
  assert.deepStrictEqual(spreadRows(owner, 690, 10, 0.2), { rx: 10, top: 0, rowGap: 10 });
  // 1440x900 (floor 828): the rooms grow to their cap (20% of 296 = 59), the rest is four even gaps of 15
  {
    const r = spreadRows(owner, 828, 10, 0.2);
    assert.strictEqual(r.rx, 59, `rx ${r.rx}`);
    assert.ok(Math.abs(r.top - 15) < 0.02 && Math.abs(r.rowGap - 15) < 0.02, JSON.stringify(r));
    assert.ok(Math.abs(828 - lay(owner, r) - 15) < 0.1, 'the gap below the last row is the even gap');
  }
  // no room row (only the lobby and the door plates): even gaps only
  {
    const r = spreadRows([{ h: 58, room: false }, { h: 40, room: false }], 400, 10, 0.2);
    assert.strictEqual(r.rx, 0);
    assert.ok(Math.abs(r.top - r.rowGap) < 0.02 && Math.abs(400 - lay([{ h: 58, room: false }, { h: 40, room: false }], r) - r.top) < 0.1, JSON.stringify(r));
  }
  // properties over many shapes
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 4000; k++) {
    const n = 1 + Math.floor(rnd() * 5), lines: Line[] = [];
    for (let i = 0; i < n; i++) lines.push({ h: 40 + Math.floor(rnd() * 300), room: rnd() < 0.7 });
    const used = lines.reduce((t, l) => t + l.h, 0) + (n - 1) * 10, avail = used + Math.floor(rnd() * 600) - 40;
    const r = spreadRows(lines, avail, 10, 0.2), rooms = lines.filter((l) => l.room), minRoom = Math.min(...rooms.map((l) => l.h));
    const tag = `${JSON.stringify(lines)} in ${avail}: ${JSON.stringify(r)}`;
    if (avail <= used) { assert.deepStrictEqual(r, { rx: 0, top: 0, rowGap: 10 }, tag); continue; }
    const total = lay(lines, r), bottom = avail - total;
    assert.ok(total <= avail + 1e-6, `taller than the floor: ${tag}`);
    assert.ok(r.rx >= 0 && (!rooms.length ? r.rx === 0 : r.rx <= 0.2 * minRoom + 1e-6), `room growth over the cap: ${tag}`);
    assert.ok(r.rowGap >= 10 - 1e-6 && r.top >= 0, `gaps: ${tag}`);
    // rooms first: a gap above 0 at the top only once the rooms reached their cap (or there are no rooms), up to rounding
    if (rooms.length && r.top > rooms.length) assert.ok(r.rx >= Math.floor(0.2 * minRoom) - 1e-6, `gaps before the rooms grew: ${tag}`);
    // even: the bottom gap is the top gap, and the gap between rows is the same once it is above 10
    assert.ok(Math.abs(bottom - r.top) <= 1, `bottom ${bottom} against top ${r.top}: ${tag}`);
    if (r.rowGap > 10 + 1e-6 && n > 1) assert.ok(Math.abs(r.rowGap - r.top) <= 1, `uneven gaps: ${tag}`);
    assert.ok(bottom <= Math.max(10, r.rowGap) + 1, `too much at the bottom: ${tag}`);
  }
  // the page: renderOffice spreads the drawn office only when it fits, after drawing; the CSS splits a room's extra above and below its desks
  assert.ok(/function spreadOffice\(stage,on\)\{[\s\S]*?window\.DurbarProbe\.spreadRows\(/.test(app), 'spreadOffice uses spreadRows');
  assert.ok(/spreadOffice\(stage,!!layout\.fit\)/.test(app), 'renderOffice spreads the office it drew');
  assert.ok(css.some((l) => /^\.stage\[data-spread\] \.room>\.room-head\{margin-bottom:calc\(var\(--rx\) \/ 2\)\}/.test(l)), 'a grown room keeps its header at the top');
}
console.log('test-probe: ok');
