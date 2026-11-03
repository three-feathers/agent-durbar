/**
 * Floors as places, phase 1 (spec 092 FR-011, FR-012, FR-022, FR-023, FR-025): the pure rules of `src/renderer/floornav.js` (next floor that is on, no wrap,
 * the nearest floor after a change, which key presses change the floor, the scroll rule, the announcement text) and the source checks that keep the page
 * wired to them (one floor on is unchanged; the office model filters by the current floor; the layout cache knows the floor; no IPC or storage but one
 * localStorage key). `npm run test:floornav`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const R = path.join(ROOT, 'src', 'renderer');
type Floor = { id: string; name?: string; on: boolean };
type Ev = { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; isComposing?: boolean; repeat?: boolean; defaultPrevented?: boolean };
type Scroll = { scrolls?: boolean; atTop?: boolean; atBottom?: boolean };
type Open = { office?: boolean; dialog?: boolean; menu?: boolean; all?: boolean };
type Counts = { n: number; waiting: number; error: number; limit: number; reply: number; hidden: number };
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
type Action = { go?: 'next' | 'prev'; scroll?: 1 | -1 } | null;
const N = require(path.join(R, 'floornav.js')) as {
  screens(f: unknown): boolean;
  nextOn(f: unknown, cur: unknown, dir: unknown): string | null;
  nearestOn(f: unknown, cur: unknown, before?: unknown): string | null;
  keyAction(e: Ev, t: unknown, s?: Scroll, o?: Open): Action;
  keyEligible(e: Ev, t: unknown, s?: Scroll, o?: Open): 'next' | 'prev' | null;
  announceText(f: unknown, n: unknown, m: unknown): string;
  place(f: unknown, id: string): { n: number; m: number } | null;
  viewOf(v: unknown): 'all' | 'one';
  readView(store: () => Store | null): 'all' | 'one';
  writeView(store: () => Store | null, v: unknown): boolean;
  VIEW_KEY: string;
  announceAll(m: number): string;
  badgeCounts(f: unknown, items: unknown, cur: unknown, all?: boolean): Record<string, Counts>;
  badgeText(c: Counts | undefined | null): string;
  badgeNum(n: number): string;
  edgeSummary(items: unknown): { up: Counts | null; down: Counts | null };
  arriveEdge(go: string): string;
  topDown(floors: unknown): { f: { id: string }; n: number }[];
  storeysTopDown(rooms: unknown, rank: (r: string) => number): string[];
};
let n = 0;
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };

const fl = (spec: string): Floor[] => spec.split(' ').map((s) => ({ id: s.replace('!', ''), name: s.replace('!', '').toUpperCase(), on: !s.startsWith('!') })); // "a !b c": b is off

// ---- floor screens exist with two or more floors on (FR-001, FR-004) ----
ok(!N.screens(fl('a')), 'one floor: no screens');
ok(!N.screens(fl('a !b !c')), 'one floor on of three: no screens');
ok(N.screens(fl('a b')), 'two on: screens');
ok(!N.screens(fl('!a !b')), 'none on: no screens');
ok(!N.screens(null) && !N.screens(undefined) && !N.screens('x'), 'no floors support: no screens');

// ---- nextOn: the next floor that is on, no wrap (FR-011) ----
const f4 = fl('a b !c d');
eq(N.nextOn(f4, 'a', 'next'), 'b', 'PageUp from floor 1 (Q-D)');
eq(N.nextOn(f4, 'b', 'next'), 'd', 'PageUp skips a floor that is off');
eq(N.nextOn(f4, 'd', 'next'), null, 'PageUp at the top floor: nothing (no wrap)');
eq(N.nextOn(f4, 'd', 'prev'), 'b', 'PageDown skips a floor that is off');
eq(N.nextOn(f4, 'b', 'prev'), 'a', 'PageDown to floor 1');
eq(N.nextOn(f4, 'a', 'prev'), null, 'PageDown at floor 1: nothing (no wrap)');
eq(N.nextOn(f4, 'zz', 'next'), null, 'an unknown floor: nothing');
eq(N.nextOn(f4, 'a', 'sideways'), null, 'an unknown direction: nothing');
eq(N.nextOn(fl('a b !c'), 'b', 'next'), null, 'only floors that are off after it: nothing');
eq(N.nextOn(fl('!a b c'), 'c', 'prev'), 'b', 'a first floor that is off is skipped upwards');
eq(N.nextOn(fl('!a b c'), 'b', 'prev'), null, 'and nothing above the first one that is on');
eq(N.nextOn(f4, 'c', 'next'), 'd', 'from a floor that is off (it was just switched off): the next one that is on');
eq(N.nextOn(null, 'a', 'next'), null, 'no floors: nothing');

// ---- nearestOn: where the view goes after a change (FR-022, FR-023) ----
eq(N.nearestOn(fl('a b c'), 'b'), 'b', 'the current floor stays when it is on');
eq(N.nearestOn(fl('a !b c'), 'b'), 'c', 'switched off: the next floor that is on');
eq(N.nearestOn(fl('a b !c'), 'c'), 'b', 'switched off, nothing after it: the previous floor');
eq(N.nearestOn(fl('a !b !c'), 'b'), 'a', 'switched off, the ones after it are off too: the previous floor');
eq(N.nearestOn(fl('!a !b c'), 'a'), 'c', 'the first floor goes off: the next one that is on');
eq(N.nearestOn(fl('a b c'), null), 'a', 'no saved floor: the first floor that is on');
eq(N.nearestOn(fl('!a b c'), 'zz'), 'b', 'an unknown floor: the first floor that is on');
eq(N.nearestOn(fl('!a !b'), 'a'), null, 'no floor on: none');
eq(N.nearestOn(fl('a'), 'a'), 'a', 'one floor, on');
eq(N.nearestOn(fl('a !b'), 'b'), 'a', 'Only: the floor that is on');
eq(N.nearestOn(fl('a b d'), 'c', ['a', 'b', 'c', 'd']), 'd', 'a deleted floor: the floor that followed it');
eq(N.nearestOn(fl('a b'), 'c', ['a', 'b', 'c']), 'b', 'a deleted last floor: the one before it');
eq(N.nearestOn(fl('a !d e'), 'c', ['a', 'c', 'd', 'e']), 'e', 'a deleted floor: the next that is on, not one that is off');
eq(N.nearestOn(fl('!a !d b'), 'c', ['a', 'b', 'c', 'd']), 'b', 'a deleted floor with nothing on after it: the nearest on before it');
eq(N.nearestOn(fl('a b'), 'c', undefined), 'a', 'a deleted floor with no old order: the first floor that is on');
eq(N.nearestOn(fl('a b'), 'c', ['x', 'y']), 'a', 'a deleted floor missing from the old order: the first floor that is on');

// ---- place and announcement text (FR-012) ----
eq(N.place(fl('a !b c'), 'c'), { n: 2, m: 2 }, 'the place counts only floors that are on');
eq(N.place(fl('a !b c'), 'b'), null, 'a floor that is off has no place');
eq(N.announceText({ id: 'x', name: 'Client B' }, 2, 3), 'Floor Client B, 2 of 3', 'the announcement from a floor');
eq(N.announceText('Ground floor', 1, 3), 'Floor Ground floor, 1 of 3', 'the announcement from a name');

// ---- key presses (FR-011) ----
const body = { closest: () => null, isContentEditable: false };
const inside = (sel: string): { closest: (s: string) => unknown; isContentEditable: boolean } => ({ closest: (s: string) => (s.split(',').some((x) => x.trim().startsWith(sel)) ? {} : null), isContentEditable: false });
const down: Ev = { key: 'PageDown' }, up: Ev = { key: 'PageUp' };
eq(N.keyEligible(down, body), 'prev', 'PageDown outside text: the next number down (Q-D)');
eq(N.keyEligible(up, body), 'next', 'PageUp outside text: the next number up (Q-D)');
eq(N.keyEligible({ key: 'Enter' }, body), null, 'another key');
eq(N.keyEligible({ key: 'ArrowDown' }, body), null, 'an arrow key');
for (const m of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey', 'isComposing', 'repeat', 'defaultPrevented']) eq(N.keyEligible({ ...down, [m]: true }, body), null, `${m}: the key is not ours`);
for (const sel of ['input', 'textarea', 'select', '[contenteditable]', '[role="textbox"]', '[role="combobox"]', '[role="listbox"]', '[role="menu"]', '[role="dialog"]']) eq(N.keyEligible(down, inside(sel)), null, `inside ${sel}: the key keeps its meaning`);
eq(N.keyEligible(down, { closest: () => null, isContentEditable: true }), null, 'a contenteditable by property');
eq(N.keyEligible(down, null), 'prev', 'no focused element (the page): ours');
eq(N.keyEligible(down, body, {}, { office: false }), null, 'not in the office view');
eq(N.keyEligible(down, body, {}, { dialog: true }), null, 'under a dialog or the palette');
eq(N.keyEligible(down, body, {}, { menu: true }), null, 'with a menu open');
eq(N.keyEligible(down, body, {}, { office: true, dialog: false, menu: false }), 'prev', 'office view, nothing open');
// the scroll rule: a floor screen that scrolls scrolls first, and changes floor only from an edge
eq(N.keyAction(down, body, { scrolls: true, atTop: true, atBottom: false }), { scroll: 1 }, 'scrolling floor, not at the bottom: PageDown scrolls');
eq(N.keyAction(down, body, { scrolls: true, atTop: false, atBottom: true }), { go: 'prev' }, 'scrolling floor, at the bottom: PageDown changes floor');
eq(N.keyAction(up, body, { scrolls: true, atTop: false, atBottom: true }), { scroll: -1 }, 'scrolling floor, not at the top: PageUp scrolls');
eq(N.keyAction(up, body, { scrolls: true, atTop: true, atBottom: false }), { go: 'next' }, 'scrolling floor, at the top: PageUp changes floor');
eq(N.keyAction(down, body, { scrolls: true, atTop: true, atBottom: true }), { go: 'prev' }, 'a screen with no room to scroll counts as at both edges');
eq(N.keyAction(down, body, { scrolls: false, atTop: false, atBottom: false }), { go: 'prev' }, 'a screen that does not scroll: the edges do not matter');
eq(N.keyEligible(down, body, { scrolls: true, atTop: true, atBottom: false }), null, 'keyEligible: null while the screen can still scroll');
eq(N.keyEligible(down, body, { scrolls: true, atTop: false, atBottom: true }), 'prev', 'keyEligible: PageDown goes down from the bottom edge');
eq(N.keyEligible(up, body, { scrolls: true, atTop: false, atBottom: true }), null, 'keyEligible: PageUp at the bottom edge scrolls, not a floor change');
eq(N.keyAction(down, inside('input'), { scrolls: true, atTop: true, atBottom: false }), null, 'in a text field the scroll rule is not ours either');
eq(N.keyAction(down, body, { scrolls: true, atTop: true, atBottom: false }, { dialog: true }), null, 'under a dialog the screen does not scroll by our hand');

// ---- Q-D: natural numbering, floor 1 at the bottom (T050) ----
eq(N.keyEligible(up, body, { scrolls: true, atTop: true, atBottom: false }), 'next', 'PageUp from the top edge goes up the building');
eq(N.arriveEdge('next'), 'bottom', 'going up you arrive at the bottom edge of the floor above');
eq(N.arriveEdge('prev'), 'top', 'going down you arrive at the top edge of the floor below');
eq(N.topDown(fl('a b c')).map((x) => [x.f.id, x.n]), [['c', 3], ['b', 2], ['a', 1]], 'the lift from the top down: the highest number first, floor 1 last, numbers unchanged');
eq(N.topDown(null), [], 'the lift of no floors');
{
  const f3 = fl('a b c'), input = f3.map((x) => x.id).join();
  N.topDown(f3);
  eq(f3.map((x) => x.id).join(), input, 'topDown leaves the list as it was');
}
{
  const rank: Record<string, number> = { a1: 0, a2: 0, b1: 1, c1: 2, c2: 2 };
  const rooms = ['a1', 'a2', 'b1', 'c1', 'c2'];
  eq(N.storeysTopDown(rooms, (r) => rank[r]), ['c1', 'c2', 'b1', 'a1', 'a2'], 'All floors from the top down: floor 1 last, a floor keeps its own order');
  eq(rooms.join(), 'a1,a2,b1,c1,c2', 'storeysTopDown leaves the list as it was');
  eq(N.storeysTopDown(null, () => 0), [], 'no rooms');
}

// ---- phase 2: the All floors view (FR-031..FR-037) ----
eq(N.viewOf('all'), 'all', 'the stored value all is the All floors view');
for (const v of [null, undefined, '', 'one', 'ALL', ' all', 'true', 1, {}]) eq(N.viewOf(v), 'one', `a stored ${JSON.stringify(v)} is the one-floor default`);
eq(N.announceAll(3), 'All floors, 3 floors', 'the All floors announcement (FR-036)');
// FR-037, Paco's review of #849: the view's storage may throw (blocked site data, private mode): the default, never an error
const mem = (): Store & { d: Record<string, string> } => { const d: Record<string, string> = {}; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }; };
const m1 = mem();
eq(N.readView(() => m1), 'one', 'nothing stored: the one-floor default');
ok(N.writeView(() => m1, 'all') && m1.d[N.VIEW_KEY] === 'all' && N.VIEW_KEY === 'durbar.floorView', 'All is stored under durbar.floorView');
eq(N.readView(() => m1), 'all', 'and read back');
ok(N.writeView(() => m1, 'one') && !(N.VIEW_KEY in m1.d), 'the default removes the key (only an explicit all is ever stored)');
m1.d[N.VIEW_KEY] = 'sideways';
eq(N.readView(() => m1), 'one', 'a bad stored value: the default');
const boom = (): Store => ({ getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => { throw new Error('SecurityError'); } });
eq(N.readView(boom), 'one', 'a read that throws: the default');
eq(N.writeView(boom, 'all'), false, 'a write that throws is lost, not thrown');
eq(N.writeView(boom, 'one'), false, 'a remove that throws is lost, not thrown');
eq(N.readView(() => { throw new Error('localStorage is not available'); }), 'one', 'reaching the storage throws: the default');
eq(N.writeView(() => { throw new Error('localStorage is not available'); }, 'all'), false, 'reaching the storage throws on write: lost');
eq(N.readView(() => null), 'one', 'no storage: the default');
// FR-034: in the All floors view PageUp/PageDown never change floor or view; they only scroll a screen that scrolls
const ALL: Open = { all: true };
eq(N.keyAction(down, body, { scrolls: false }, ALL), null, 'All view, nothing to scroll: PageDown does nothing');
eq(N.keyAction(up, body, { scrolls: false }, ALL), null, 'All view, nothing to scroll: PageUp does nothing');
eq(N.keyAction(down, body, { scrolls: true, atTop: true, atBottom: false }, ALL), { scroll: 1 }, 'All view, a screen that scrolls: PageDown scrolls');
eq(N.keyAction(up, body, { scrolls: true, atTop: false, atBottom: true }, ALL), { scroll: -1 }, 'All view: PageUp scrolls');
eq(N.keyAction(down, body, { scrolls: true, atTop: false, atBottom: true }, ALL), null, 'All view, at the bottom edge: no floor change');
eq(N.keyAction({ ...down, repeat: true }, body, { scrolls: true, atTop: true, atBottom: false }, ALL), null, 'All view, a held key: not ours');
eq(N.keyAction(down, inside('input'), { scrolls: true, atTop: true }, ALL), null, 'All view, in a text field: the key keeps its meaning');

// ---- phase 2: lift badges (FR-014, FR-015, FR-016) and the edge rows (FR-028) ----
const f3 = fl('a b !c');
const it = (id: string, floor: string, kind: string, hidden = false) => ({ id, floor, kind, hidden });
const items = [it('1', 'a', 'waiting'), it('2', 'b', 'waiting'), it('3', 'b', 'error'), it('4', 'b', 'reply'), it('5', 'c', 'error'), it('6', 'b', 'limit', true), it('2', 'b', 'error')];
const bc = N.badgeCounts(f3, items, 'a');
eq(Object.keys(bc), ['b'], 'no badge on the current floor nor on a floor that is off (FR-016)');
eq(bc.b, { n: 4, waiting: 1, error: 1, limit: 1, reply: 1, hidden: 1 }, 'each agent once, by kind (FR-015)');
eq(N.badgeCounts(f3, items, 'a', true), {}, 'the All floors view: no badge on any floor (FR-035)');
eq(Object.keys(N.badgeCounts(f3, items, null)).sort(), ['a', 'b'], 'with no current floor every floor that is on has its badge');
eq(N.badgeCounts(f3, [it('9', 'b', 'sleepy'), null, 7, { floor: 'b' }], 'a'), {}, 'unknown kinds and bad items count nothing');
eq(N.badgeCounts(null, items, 'a'), {}, 'no floors: nothing');
eq(N.badgeText(bc.b), '1 waiting, 1 error, 1 limit reached, 1 new reply', 'the words of a badge');
eq(N.badgeText({ n: 3, waiting: 2, error: 0, limit: 0, reply: 0, hidden: 0 } as Counts), '2 waiting', 'one kind');
eq(N.badgeText({ n: 2, waiting: 0, error: 2, limit: 0, reply: 0, hidden: 0 } as Counts), '2 errors', 'errors in the plural');
eq(N.badgeText(undefined), '', 'nothing: no words');
eq([N.badgeNum(1), N.badgeNum(9), N.badgeNum(10), N.badgeNum(42)], ['1', '9', '9+', '9+'], '9+ past nine');
const c1 = { n: 1, waiting: 1, error: 0, limit: 0, reply: 0, hidden: 0 }, c2 = { n: 2, waiting: 0, error: 2, limit: 0, reply: 0, hidden: 0 };
eq(N.edgeSummary([{ pos: 'above', counts: c1 }, { pos: 'in', counts: c2 }, { pos: 'below', counts: c2 }, { pos: 'below', counts: c1 }]),
  { up: { n: 1, waiting: 1, error: 0, limit: 0, reply: 0, hidden: 0 }, down: { n: 3, waiting: 1, error: 2, limit: 0, reply: 0, hidden: 0 } }, 'out-of-view badges are summed per edge');
eq(N.edgeSummary([{ pos: 'in', counts: c1 }]), { up: null, down: null }, 'every badge in view: no edge row');
eq(N.edgeSummary(null), { up: null, down: null }, 'nothing: no edge row');

// ---- the page is wired to the rules (source checks) ----
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const assets = fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8');
ok(/<script src="floornav\.js"><\/script>/.test(html) && html.indexOf('<script src="floornav.js">') < html.indexOf('<script src="app.js">'), 'floornav.js is loaded before app.js');
ok(/'floornav\.js'/.test(assets), 'floornav.js is copied into the build');
ok(/const FLOOR_PREF='durbar\.floor'/.test(app) && (app.match(/localStorage\.(get|set)Item\(FLOOR_PREF/g) || []).length === 2, 'the current floor is one localStorage key, read once and written once (FR-022)');
ok(/if\(!roomShown\(r\)\|\|!onScreen\(r\)\|\|\(ui\.ws!=='all'&&ui\.ws!==r\.id\)\)return;/.test(app), 'officeModel keeps only the rooms of the current floor (FR-001)');
ok(/const onScreen=r=>\{const c=curFloorId\(\);if\(c==null\)return true;/.test(app), 'with fewer than two floors on every room is on screen (FR-004)');
ok(/lobbyOn\(\),floorTagsOn\(\)&&floorsOnList\(\)\.map\(f=>f\.id\+':'\+f\.name\),curFloorId\(\),/.test(app), 'the layout cache is keyed by the current floor');
ok(/DurbarFloorNav\.keyAction\(e,e\.target,scroll,open\)/.test(app) && /\[role="dialog"\]/.test(app) && /modalOpen\(\)/.test(app), 'the key handler asks floornav and tells it about dialogs and menus');
ok(/function syncCurFloor\(before,was\)/.test(app) && /syncCurFloor\(before,was\);\s*\n\s*afterFloorsChange\(\)/.test(app), 'a floors change moves the current floor before the office is drawn (FR-023)');
ok(/\(of\?' \('\+DurbarCutText\.cutText\(of\.name,16\)\+'\)'/.test(app) && !/of\?' \('\+of\.name\+'\)'/.test(app), 'the lobby visitor menu cuts a floor name to 16 characters like the tile label (a 40-character name stays short)');
ok(!/bridge\.[a-zA-Z]*[Ff]loor/.test(fs.readFileSync(path.join(R, 'floornav.js'), 'utf8')), 'floornav.js has no bridge call');
// the series adds no IPC channel, preload or main-process floors code (FR-024)
ok(/let floorView=window\.DurbarFloorNav\.readView\(VIEW_STORE\)/.test(app) && /FN\.writeView\(VIEW_STORE,v\)/.test(app) && !/localStorage\.(get|set|remove)Item\(['"]durbar\.floorView/.test(app), 'the view is read and written only through floornav (a storage that throws is the default, FR-037)');
ok(/const curFloorId=\(\)=>oneFloorView\(\)\?/.test(app), 'in the All floors view there is no current floor shown: the pre-092 path (FR-031)');
ok(/all:allFloorsView\(\)\}/.test(app), 'the key handler tells floornav about the All floors view (FR-034)');
ok(/if\(!model\.length&&oneFloorView\(\)&&/.test(app), 'the empty-floor line is for the one-floor view only (FR-035)');
ok(/role="toolbar" aria-label="Floors" aria-orientation="vertical"/.test(html), 'the lift is a vertical toolbar named Floors (FR-006)');
const shared = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'floors.ts'), 'utf8');
ok(!/floornav|curFloor|durbar\.floor\b/i.test(shared), 'src/shared/floors.ts is unchanged by the floor screens');

console.log(`floornav tests: ${n} checks ok`);
