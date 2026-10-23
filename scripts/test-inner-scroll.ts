/** Focus and scroll never move the page (spec 052 FR-176, FR-055; issue #638): `npm run test:innerscroll`.
 *  The pure parts of src/renderer/innerscroll.js, `reveal`/`focus`/`pin` on a small fake DOM, and a static rule over the renderer:
 *  no `scrollIntoView` anywhere and no `focus()` in app.js that can scroll (only `window.focus()` and `focus({preventScroll:true})`).
 *  Runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'src', 'renderer');
type Box = { top: number; bottom: number; left: number; right: number };
type Opts = { block?: string; inline?: string; margin?: number; scroller?: unknown; reveal?: boolean };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const S = require(path.join(DIR, 'innerscroll.js')) as {
  PINNED: string;
  delta: (r: Partial<Box>, s: Partial<Box>, block: string, margin?: number, axis?: string) => number;
  reveal: (el: unknown, o?: Opts) => void;
  focus: (el: unknown, o?: Opts) => void;
  resetPinned: (els: unknown[]) => number;
  pin: (doc: unknown) => void;
};

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };

t('delta: start, center and nearest, both axes', () => {
  const view = { top: 100, bottom: 500, left: 0, right: 300 };
  assert.strictEqual(S.delta({ top: 700, bottom: 760 }, view, 'start', 12), 588);
  assert.strictEqual(S.delta({ top: 700, bottom: 760 }, view, 'center'), 430);
  assert.strictEqual(S.delta({ top: 200, bottom: 260 }, view, 'nearest'), 0, 'already inside: no scroll');
  assert.strictEqual(S.delta({ top: 40, bottom: 80 }, view, 'nearest'), -60, 'above: its top to the top');
  assert.strictEqual(S.delta({ top: 520, bottom: 560 }, view, 'nearest'), 60, 'below: its bottom to the bottom');
  assert.strictEqual(S.delta({ top: 450, bottom: 1450 }, view, 'nearest'), 350, 'taller than the view: its start lines up');
  assert.strictEqual(S.delta({ left: 280, right: 340 }, view, 'nearest', 0, 'x'), 40, 'x axis');
  assert.strictEqual(S.delta({}, {}, 'nearest'), 0, 'missing numbers count as 0');
});

t('resetPinned puts scrolled containers back to 0 and counts them', () => {
  const a = { scrollTop: 89, scrollLeft: 0 }, b = { scrollTop: 0, scrollLeft: 0 }, c = { scrollTop: 0, scrollLeft: 7 };
  assert.strictEqual(S.resetPinned([a, b, c, null]), 2);
  assert.deepStrictEqual([a, b, c].map((x) => [x.scrollTop, x.scrollLeft]), [[0, 0], [0, 0], [0, 0]]);
});

/* a fake DOM: html > body > .workspace > #panel > .panel-in > #chat (overflow auto) > card > button */
const PIN = S.PINNED.split(',');
class El {
  scrollTop = 0; scrollLeft = 0; focused: unknown = null; isConnected = true;
  constructor(public sel: string, public parentElement: El | null, public box: Box, public ov = 'visible') {}
  matches(q: string) { return q.split(',').includes(this.sel); }
  getClientRects() { return [this.box]; }
  getBoundingClientRect() { return this.box; }
  focus(o?: unknown) { this.focused = o === undefined ? 'bare' : o; }
}
const box = (top: number, bottom: number): Box => ({ top, bottom, left: 0, right: 800 });
const g = globalThis as unknown as { getComputedStyle: (e: El) => { overflowX: string; overflowY: string } };
g.getComputedStyle = (e: El) => ({ overflowX: e.ov, overflowY: e.ov });
const html = new El('html', null, box(0, 800), 'hidden');
const body = new El('body', html, box(0, 800), 'hidden');
const ws = new El('.workspace', body, box(0, 800));
const panel = new El('#panel', ws, box(0, 800), 'hidden');
const pin = new El('.panel-in', panel, box(0, 800), 'hidden');
const chat = new El('#chat', pin, box(100, 600), 'auto');
const card = new El('.note', chat, box(900, 1000));
const opt = new El('.q-opt', card, box(950, 980));
const frame = [html, body, ws, panel, pin];

t('the fake frame is the pinned list', () => { for (const e of frame) assert.ok(PIN.includes(e.sel), e.sel); assert.ok(!PIN.includes('#chat')); });

t('reveal scrolls the chat only, never the frame', () => {
  S.reveal(card, { block: 'center' });
  assert.strictEqual(chat.scrollTop, 600);
  assert.ok(frame.every((e) => e.scrollTop === 0 && e.scrollLeft === 0));
  chat.scrollTop = 0;
  S.reveal(card, { block: 'center', scroller: pin }); // a pinned scroller passed by mistake is refused
  assert.ok(frame.every((e) => e.scrollTop === 0));
});

t('focus never focuses with scrolling, then reveals in the inner scroller (or not, with reveal:false)', () => {
  chat.scrollTop = 0;
  S.focus(opt);
  assert.deepStrictEqual(opt.focused, { preventScroll: true });
  assert.strictEqual(chat.scrollTop, 380);
  chat.scrollTop = 0; opt.focused = null;
  S.focus(opt, { reveal: false });
  assert.deepStrictEqual(opt.focused, { preventScroll: true });
  assert.strictEqual(chat.scrollTop, 0);
  assert.ok(frame.every((e) => e.scrollTop === 0));
  S.focus(null); // no element: nothing happens
});

t('pin: a scroll on a pinned container (or the page) is put back; an inner scroller keeps its place', () => {
  const handlers: ((e: { target: unknown }) => void)[] = [];
  const doc = { scrollingElement: html, documentElement: html, body, addEventListener: (type: string, fn: (e: { target: unknown }) => void, o: { capture: boolean }) => { assert.strictEqual(type, 'scroll'); assert.ok(o.capture); handlers.push(fn); } };
  html.scrollTop = 15;
  S.pin(doc);
  assert.strictEqual(html.scrollTop, 0, 'pin resets the page at once');
  assert.strictEqual(handlers.length, 1);
  html.scrollTop = 89; handlers[0]({ target: doc });
  assert.strictEqual(html.scrollTop, 0, 'the page scrolled (target document): back to 0');
  pin.scrollTop = 40; handlers[0]({ target: pin });
  assert.strictEqual(pin.scrollTop, 0, '.panel-in scrolled: back to 0');
  chat.scrollTop = 300; handlers[0]({ target: chat });
  assert.strictEqual(chat.scrollTop, 300, 'the chat keeps its scroll');
  S.pin(doc);
  assert.strictEqual(handlers.length, 1, 'pin installs one listener only');
});

/* the static rule: strip comments, then look for calls that scroll every ancestor */
const code = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
export function scrollingCalls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/[\w$\])]*\.scrollIntoView\s*\(/g)) out.push(m[0]);
  for (const m of src.matchAll(/([\w$]*)\.focus\s*\(([^)]*)\)/g)) {
    if (m[1] === 'window' || m[1] === 'SCROLL' || m[1] === 'DurbarScroll') continue; // the window, and the helper itself
    if (/^\s*\{\s*preventScroll\s*:\s*true\s*\}\s*$/.test(m[2])) continue;
    out.push(m[0]);
  }
  return out;
}

t('the static rule catches a bare focus(), a focus with other options and scrollIntoView', () => {
  assert.deepStrictEqual(scrollingCalls(`a.focus();b.focus({preventScroll:true});window.focus();c.scrollIntoView({block:'center'});d.focus({ preventScroll : false })`),
    ['c.scrollIntoView(', 'a.focus()', 'd.focus({ preventScroll : false })']);
});

t('app.js: no focus() that scrolls and no scrollIntoView (FR-176)', () => {
  assert.deepStrictEqual(scrollingCalls(code('app.js')), [], 'use focusIn(el) or SCROLL.reveal(el) (innerscroll.js)');
});

t('no renderer file calls scrollIntoView (FR-055, FR-176)', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'innerscroll.js');
  assert.ok(files.length > 10);
  for (const f of files) assert.deepStrictEqual(scrollingCalls(code(f)).filter((c) => c.includes('scrollIntoView')), [], f);
});

t('innerscroll.js is loaded before the scripts that use it', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const at = (f: string) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at('innerscroll.js') > 0 && at('innerscroll.js') < at('screens.js') && at('innerscroll.js') < at('app.js'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8').includes(`'innerscroll.js'`), 'copy-assets ships it');
});

console.log(`inner scroll: ${n} checks passed`);
