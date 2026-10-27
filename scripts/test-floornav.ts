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
type Open = { office?: boolean; dialog?: boolean; menu?: boolean };
type Action = { go?: 'next' | 'prev'; scroll?: 1 | -1 } | null;
const N = require(path.join(R, 'floornav.js')) as {
  screens(f: unknown): boolean;
  nextOn(f: unknown, cur: unknown, dir: unknown): string | null;
  nearestOn(f: unknown, cur: unknown, before?: unknown): string | null;
  keyAction(e: Ev, t: unknown, s?: Scroll, o?: Open): Action;
  keyEligible(e: Ev, t: unknown, s?: Scroll, o?: Open): 'next' | 'prev' | null;
  announceText(f: unknown, n: unknown, m: unknown): string;
  place(f: unknown, id: string): { n: number; m: number } | null;
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
eq(N.nextOn(f4, 'a', 'next'), 'b', 'PageDown from the first');
eq(N.nextOn(f4, 'b', 'next'), 'd', 'PageDown skips a floor that is off');
eq(N.nextOn(f4, 'd', 'next'), null, 'PageDown at the last floor: nothing (no wrap)');
eq(N.nextOn(f4, 'd', 'prev'), 'b', 'PageUp skips a floor that is off');
eq(N.nextOn(f4, 'b', 'prev'), 'a', 'PageUp to the first');
eq(N.nextOn(f4, 'a', 'prev'), null, 'PageUp at the first floor: nothing (no wrap)');
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
eq(N.keyEligible(down, body), 'next', 'PageDown outside text');
eq(N.keyEligible(up, body), 'prev', 'PageUp outside text');
eq(N.keyEligible({ key: 'Enter' }, body), null, 'another key');
eq(N.keyEligible({ key: 'ArrowDown' }, body), null, 'an arrow key');
for (const m of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey', 'isComposing', 'repeat', 'defaultPrevented']) eq(N.keyEligible({ ...down, [m]: true }, body), null, `${m}: the key is not ours`);
for (const sel of ['input', 'textarea', 'select', '[contenteditable]', '[role="textbox"]', '[role="combobox"]', '[role="listbox"]', '[role="menu"]', '[role="dialog"]']) eq(N.keyEligible(down, inside(sel)), null, `inside ${sel}: the key keeps its meaning`);
eq(N.keyEligible(down, { closest: () => null, isContentEditable: true }), null, 'a contenteditable by property');
eq(N.keyEligible(down, null), 'next', 'no focused element (the page): ours');
eq(N.keyEligible(down, body, {}, { office: false }), null, 'not in the office view');
eq(N.keyEligible(down, body, {}, { dialog: true }), null, 'under a dialog or the palette');
eq(N.keyEligible(down, body, {}, { menu: true }), null, 'with a menu open');
eq(N.keyEligible(down, body, {}, { office: true, dialog: false, menu: false }), 'next', 'office view, nothing open');
// the scroll rule: a floor screen that scrolls scrolls first, and changes floor only from an edge
eq(N.keyAction(down, body, { scrolls: true, atTop: true, atBottom: false }), { scroll: 1 }, 'scrolling floor, not at the bottom: PageDown scrolls');
eq(N.keyAction(down, body, { scrolls: true, atTop: false, atBottom: true }), { go: 'next' }, 'scrolling floor, at the bottom: PageDown changes floor');
eq(N.keyAction(up, body, { scrolls: true, atTop: false, atBottom: true }), { scroll: -1 }, 'scrolling floor, not at the top: PageUp scrolls');
eq(N.keyAction(up, body, { scrolls: true, atTop: true, atBottom: false }), { go: 'prev' }, 'scrolling floor, at the top: PageUp changes floor');
eq(N.keyAction(down, body, { scrolls: true, atTop: true, atBottom: true }), { go: 'next' }, 'a screen with no room to scroll counts as at both edges');
eq(N.keyAction(down, body, { scrolls: false, atTop: false, atBottom: false }), { go: 'next' }, 'a screen that does not scroll: the edges do not matter');
eq(N.keyEligible(down, body, { scrolls: true, atTop: true, atBottom: false }), null, 'keyEligible: null while the screen can still scroll');
eq(N.keyEligible(down, body, { scrolls: true, atTop: false, atBottom: true }), 'next', 'keyEligible: next from the bottom edge');
eq(N.keyEligible(up, body, { scrolls: true, atTop: false, atBottom: true }), null, 'keyEligible: PageUp at the bottom edge scrolls, not a floor change');
eq(N.keyAction(down, inside('input'), { scrolls: true, atTop: true, atBottom: false }), null, 'in a text field the scroll rule is not ours either');
eq(N.keyAction(down, body, { scrolls: true, atTop: true, atBottom: false }, { dialog: true }), null, 'under a dialog the screen does not scroll by our hand');

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
const shared = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'floors.ts'), 'utf8');
ok(!/floornav|curFloor|durbar\.floor\b/i.test(shared), 'src/shared/floors.ts is unchanged by the floor screens');

console.log(`floornav tests: ${n} checks ok`);
