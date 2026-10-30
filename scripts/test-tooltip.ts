/**
 * The instant tooltip (spec 001 FR-187, issue #875): `src/renderer/tooltip.js`. The text of every status count (one agent, many, none; filter
 * on and off), `place` (below and centered, flipped above at the window's bottom, clamped inside the window, never over its anchor), and
 * source checks that keep the page wired to it (no native `title` text on the pills, the script is shipped and loaded, the hide paths exist).
 * `npm run test:tooltip`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
type Box = { left: number; top: number; right: number; bottom: number };
type Placed = { x: number; y: number; flipped: boolean };
const T = require(path.join(R, 'tooltip.js')) as {
  statusText(k: string, n: number, on?: boolean): string;
  place(a: Box, s: { w: number; h: number }, v: { w: number; h: number }, o?: { gap?: number; margin?: number }): Placed;
  GAP: number; MARGIN: number;
};
let n = 0;
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };

// ---- the text (the owner's example, singular and plural, filter on and off) ----
eq(T.statusText('idle', 7, false), 'Idle · 7 agents idle or paused. Click to show only these.', "the owner's example");
eq(T.statusText('idle', 7, true), 'Idle · 7 agents idle or paused. Click to show all.', 'the filter on says Click to show all');
eq(T.statusText('working', 1), 'Working · 1 agent working or thinking. Click to show only these.', 'one agent, no filter argument');
eq(T.statusText('working', 3), 'Working · 3 agents working or thinking. Click to show only these.', 'working');
eq(T.statusText('waiting', 1), 'Waiting · 1 agent waiting for you. Click to show only these.', 'waiting, one');
eq(T.statusText('waiting', 2, true), 'Waiting · 2 agents waiting for you. Click to show all.', 'waiting, two, filter on');
eq(T.statusText('error', 1), 'Error · 1 agent with an error. Click to show only these.', 'error, one');
eq(T.statusText('error', 4), 'Error · 4 agents with errors. Click to show only these.', 'error, many');
eq(T.statusText('error', 0), 'Error · 0 agents with errors. Click to show only these.', 'zero is plural');
eq(T.statusText('done', 2), 'Done · 2 agents done. Click to show only these.', 'done');
eq(T.statusText('done', 1, true), 'Done · 1 agent done. Click to show all.', 'done, one, filter on');
eq(T.statusText('idle', undefined as unknown as number), 'Idle · 0 agents idle or paused. Click to show only these.', 'a missing count reads 0');
eq(T.statusText('idle', -3), 'Idle · 0 agents idle or paused. Click to show only these.', 'a negative count reads 0');
eq(T.statusText('nope', 3), '', 'an unknown state has no text');
for (const k of ['working', 'waiting', 'idle', 'error', 'done']) {
  ok(T.statusText(k, 5).startsWith(k[0].toUpperCase() + k.slice(1) + ' · 5 agents '), k + ': starts with the state name and the count');
  ok(/\.$/.test(T.statusText(k, 5, true)) && !/title/.test(T.statusText(k, 5)), k + ': one sentence form');
}

// ---- placement ----
const V = { w: 1280, h: 800 }, S = { w: 240, h: 40 };
const overlaps = (a: Box, p: Placed, s: { w: number; h: number }): boolean => p.x < a.right && p.x + s.w > a.left && p.y < a.bottom && p.y + s.h > a.top;
const inside = (p: Placed, s: { w: number; h: number }, v: { w: number; h: number }): boolean => p.x >= T.MARGIN && p.y >= T.MARGIN && p.x + s.w <= v.w - T.MARGIN && p.y + s.h <= v.h - T.MARGIN;
{
  const a: Box = { left: 600, top: 10, right: 660, bottom: 36 };
  const p = T.place(a, S, V);
  eq(p, { x: 510, y: 36 + T.GAP, flipped: false }, 'below the anchor, centered, with the gap');
  ok(!overlaps(a, p, S) && inside(p, S, V), 'does not cover the anchor and is inside the window');
}
{
  const a: Box = { left: 2, top: 10, right: 40, bottom: 36 };
  const p = T.place(a, S, V);
  eq(p.x, T.MARGIN, 'clamped at the left edge');
  ok(!overlaps(a, p, S) && inside(p, S, V), 'a left-edge anchor: still inside and clear');
}
{
  const a: Box = { left: 1250, top: 10, right: 1278, bottom: 36 };
  const p = T.place(a, S, V);
  eq(p.x, V.w - S.w - T.MARGIN, 'clamped at the right edge');
  ok(!overlaps(a, p, S) && inside(p, S, V), 'a right-edge anchor: still inside and clear');
}
{
  const a: Box = { left: 600, top: 760, right: 660, bottom: 790 };
  const p = T.place(a, S, V);
  eq(p.flipped, true, 'flips above when the bottom would be passed');
  eq(p.y, 760 - T.GAP - S.h, 'above the anchor with the gap');
  ok(!overlaps(a, p, S) && inside(p, S, V), 'flipped: clear and inside');
}
{
  // the room above is positive but under the margin: not flipped there (that would put it within MARGIN of the top), clamped inside instead
  const v = { w: 400, h: 100 }, s = { w: 100, h: 40 };
  const a: Box = { left: 150, top: 50, right: 250, bottom: 70 };
  const up = a.top - T.GAP - s.h;
  ok(up > 0 && up < T.MARGIN, 'precondition: the room above is between 0 and the margin');
  const p = T.place(a, s, v);
  eq(p.flipped, false, 'not flipped into the top margin');
  eq(p.y, v.h - T.MARGIN - s.h, 'clamped at the bottom margin instead');
  ok(p.y >= T.MARGIN, 'never closer than the margin to the top');
}
{
  const small = { w: 100, h: 60 };
  const a: Box = { left: 10, top: 20, right: 60, bottom: 40 };
  const p = T.place(a, { w: 300, h: 50 }, small);
  ok(p.x >= T.MARGIN && p.y >= T.MARGIN, 'a window smaller than the tooltip still clamps to the margin');
}
// a sweep: every anchor on a top-bar-like row at both sizes stays inside the window and clear of the anchor
for (const v of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 640, h: 480 }]) {
  for (let left = 0; left + 40 <= v.w; left += 37) {
    const a: Box = { left, top: 8, right: left + 40, bottom: 34 };
    const p = T.place(a, S, v);
    ok(inside(p, S, v) && !overlaps(a, p, S), `${v.w}x${v.h}: anchor at ${left} is inside and clear`);
  }
}

// ---- the page is wired to it ----
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8');
const copy = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
const stats = app.slice(app.indexOf('function renderStats()'), app.indexOf('function renderFilter()'));
ok(/title=""/.test(stats) && !/title="Show only/.test(stats), 'the pills carry an empty title (the group title must not show on them), not the old words');
ok(/DurbarTip\.bind\(\$\('stats'\)/.test(stats) && /DurbarTip\.refresh\(\)/.test(stats), 'renderStats binds the pills and refreshes the tooltip after a redraw');
ok(/aria-label="\$\{l\}: \$\{c\[k\]\}"/.test(stats), 'the pill keeps an accessible name with the state and the count');
ok(html.includes('<script src="tooltip.js">') && html.indexOf('<script src="tooltip.js">') < html.indexOf('<script src="app.js">'), 'tooltip.js is loaded before app.js');
ok(/'tooltip\.js'/.test(copy), 'copy-assets ships tooltip.js');
ok(/\.app-tip\{[^}]*font-size:12px/.test(css) && /\.app-tip\[hidden\]\{display:none\}/.test(css), 'the tooltip is 12px and the hidden attribute hides it');
ok(!/\.app-tip\{[^}]*#[0-9a-fA-F]{3,8}\b/.test(css), 'colours are theme tokens, no literal');
const src = fs.readFileSync(path.join(R, 'tooltip.js'), 'utf8');
for (const [re, what] of [[/role.{0,6}tooltip/, 'role=tooltip'], [/aria-describedby/, 'aria-describedby'], [/key!=='Escape'/, 'Escape'], [/'scroll'/, 'scroll'], [/'blur'/, 'window blur'], [/'click'/, 'click'], [/focus-visible/, 'keyboard focus only'], [/isConnected/, 'a gone element']] as [RegExp, string][]) ok(re.test(src), 'tooltip.js handles ' + what);
console.log(`tooltip: ${n} checks passed`);
