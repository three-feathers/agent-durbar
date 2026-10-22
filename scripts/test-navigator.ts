/** Keyboard navigator (spec 074, issue #548): levels, start letters, number picks, matching, chat numbers, the shortcut and its clash
 *  check. `npm run test:navigator`. Pure module; runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
type Item = { kind: string; id?: string; label: string; hint?: string; kw?: string; n?: number; no?: number; to?: string };
type Level = { kind: string; floor?: string; folder?: string; q?: string; active?: number };
type Snap = { floors: { id: string; name: string }[]; folders: { id: string; name: string; floor: string; hint?: string }[]; chats: { id: string; name: string; folder: string; no: number; hint?: string }[] };
type Combo = { mod?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean; code: string; sup?: boolean };
type Ev = Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const N = require(path.join(ROOT, 'src', 'renderer', 'navigator.js')) as {
  rank: (items: Item[], q: string) => Item[];
  assignNumbers: (m: Record<string, number>, ids: string[]) => Record<string, number>;
  pruneNumbers: (m: Record<string, number>, ids: string[]) => Record<string, number>;
  loadNumbers: (j: unknown) => Record<string, number>;
  levelItems: (s: Snap, l: Level) => Item[];
  parseStart: (q: string) => { level: string; q: string } | null;
  pickNumber: (items: Item[], d: string) => { item: Item; unique: boolean } | null;
  view: (s: Snap, l: Level) => { go?: { level: string; q: string }; items?: Item[]; active?: number; auto?: Item | null; digits?: string };
  pick: (s: Snap, i: Item) => { push?: Level; open?: string } | null;
  push: (st: Level[], l: Level) => Level[];
  back: (st: Level[]) => Level[] | false;
  crumbs: (s: Snap, st: Level[]) => string[];
  DEFAULT_COMBO: Combo;
  comboFromEvent: (e: Ev, mac: boolean) => Combo | null;
  comboMatches: (e: Ev, c: Combo, mac: boolean) => boolean;
  comboParts: (c: Combo) => string[];
  clashOf: (c: Combo, mac: boolean) => string;
  loadCombo: (j: unknown, mac: boolean) => Combo;
  sameCombo: (a: Combo, b: Combo) => boolean;
};

// ---- matching: the palette's order (spec 052 FR-042), now shared ----
const items: Item[] = [{ kind: 'x', label: 'Frontend app' }, { kind: 'x', label: 'api' }, { kind: 'x', label: 'My api tests' }, { kind: 'x', label: 'core', kw: 'apis' }];
assert.deepStrictEqual(N.rank(items, 'api').map((x) => x.label), ['api', 'My api tests', 'core'], 'start, word start, then hint words');
assert.deepStrictEqual(N.rank(items, '').map((x) => x.label), items.map((x) => x.label), 'empty filter keeps the order');
assert.deepStrictEqual(N.rank(items, 'END').map((x) => x.label), ['Frontend app'], 'anywhere, any case');

// ---- chat numbers (FR-011) ----
let m = N.assignNumbers({}, ['a', 'b', 'c']);
assert.deepStrictEqual(m, { a: 1, b: 2, c: 3 }, 'numbers in the order sessions appear');
m = N.assignNumbers(m, ['c', 'a', 'b', 'd']);
assert.deepStrictEqual(m, { a: 1, b: 2, c: 3, d: 4 }, 'existing numbers never change, whatever the order');
m = N.pruneNumbers(m, ['a', 'c', 'd']);
assert.deepStrictEqual(m, { a: 1, c: 3, d: 4 }, 'a removed session frees its number');
m = N.assignNumbers(m, ['a', 'c', 'd', 'e', 'f']);
assert.deepStrictEqual(m, { a: 1, c: 3, d: 4, e: 2, f: 5 }, 'a new session takes the lowest free number');
// restart: the saved map comes back, the restored sessions keep their numbers even if they load in another order
const saved = JSON.stringify(m);
let r = N.loadNumbers(saved);
r = N.assignNumbers(r, ['f', 'e', 'new']);
assert.strictEqual(r.f, 5); assert.strictEqual(r.e, 2);
assert.strictEqual(r.new, 6, 'numbers of sessions not loaded yet stay reserved until the office has loaded');
r = N.pruneNumbers(r, ['f', 'e', 'new']);
assert.deepStrictEqual(N.assignNumbers(r, ['f', 'e', 'new', 'x']).x, 1, 'after the prune, freed numbers are reused');
// damaged or hostile saved data
assert.deepStrictEqual(N.loadNumbers('not json'), {});
assert.deepStrictEqual(N.loadNumbers('[1,2]'), {});
assert.deepStrictEqual(N.loadNumbers({ a: 1, b: 1, c: 0, d: 2.5, e: '3', f: 10000, ['x'.repeat(201)]: 4, g: 7 }), { a: 1, g: 7 }, 'only whole numbers 1..9999, each once, short ids');
const big: Record<string, number> = {}; for (let i = 1; i <= 600; i++) big['s' + i] = i;
assert.strictEqual(Object.keys(N.loadNumbers(big)).length, 500, 'at most 500 entries');

// ---- levels (FR-003..FR-008) ----
const snap1: Snap = {
  floors: [{ id: 'ground', name: 'Ground floor' }],
  folders: [{ id: 'r1', name: 'api', floor: 'ground' }, { id: 'r2', name: 'core', floor: 'ground' }, { id: 'r3', name: 'frontend', floor: 'ground' }],
  chats: [{ id: 's1', name: 'Asha', folder: 'r1', no: 1 }, { id: 's2', name: 'Ben', folder: 'r1', no: 3 }, { id: 's3', name: 'Cy', folder: 'r2', no: 2 }, { id: 's4', name: 'Di', folder: 'r3', no: 31 }],
};
const snap2: Snap = { ...snap1, floors: [{ id: 'ground', name: 'Ground floor' }, { id: 'up', name: 'Upstairs' }], folders: [{ id: 'r1', name: 'api', floor: 'ground' }, { id: 'r2', name: 'core', floor: 'up' }, { id: 'r3', name: 'frontend', floor: 'up' }] };
const start: Level = { kind: 'start', q: '' };
// one floor: the start level lists the folders (D3), after the Folders and Chats rows
let it = N.levelItems(snap1, start);
assert.deepStrictEqual(it.map((x) => x.kind + ':' + x.label), ['go:Folders', 'go:Chats', 'folder:api', 'folder:core', 'folder:frontend']);
assert.deepStrictEqual(it.filter((x) => x.kind === 'folder').map((x) => x.n), [1, 2, 3], 'folders are numbered by position');
assert.strictEqual(it[2].hint, '2 chats');
// two floors on: the start level lists the floors
it = N.levelItems(snap2, start);
assert.deepStrictEqual(it.map((x) => x.kind + ':' + x.label + ':' + (x.n ?? '')), ['go:Folders:', 'go:Chats:', 'floor:Ground floor:1', 'floor:Upstairs:2']);
assert.strictEqual(it[3].hint, '2 folders');
// a floor's folders, numbered from 1 again
assert.deepStrictEqual(N.levelItems(snap2, { kind: 'folders', floor: 'up' }).map((x) => x.label + x.n), ['core1', 'frontend2']);
assert.deepStrictEqual(N.levelItems(snap2, { kind: 'folders' }).map((x) => x.label), ['api', 'core', 'frontend'], 'F lists every folder');
// agents carry their chat number, the chats level sorts by it
assert.deepStrictEqual(N.levelItems(snap1, { kind: 'agents', folder: 'r1' }).map((x) => x.label + x.n), ['Asha1', 'Ben3']);
assert.deepStrictEqual(N.levelItems(snap1, { kind: 'chats' }).map((x) => x.n), [1, 2, 3, 31]);

// start letters (FR-004 / D4)
assert.deepStrictEqual(N.parseStart('c 3'), { level: 'chats', q: '3' });
assert.deepStrictEqual(N.parseStart('C3'), { level: 'chats', q: '3' });
assert.deepStrictEqual(N.parseStart('c '), { level: 'chats', q: '' });
assert.deepStrictEqual(N.parseStart('f api'), { level: 'folders', q: 'api' });
assert.deepStrictEqual(N.parseStart('f2'), { level: 'folders', q: '2' });
assert.strictEqual(N.parseStart('core'), null, '"c" + a letter is filter text');
assert.strictEqual(N.parseStart('fro'), null, '"f" + a letter is filter text');
assert.strictEqual(N.parseStart('c'), null, 'a lone letter waits');
assert.deepStrictEqual(N.view(snap1, { kind: 'start', q: 'c3' }), { go: { level: 'chats', q: '3' } });
assert.deepStrictEqual(N.view(snap1, { kind: 'start', q: 'co' }).items!.map((x) => x.label), ['core'], 'filtering "co" at start finds the folder');
assert.deepStrictEqual(N.view(snap1, { kind: 'start', q: 'c' }).items!.map((x) => x.label).slice(0, 2), ['Chats', 'core'], '"c" then Enter picks the Chats row');
assert.strictEqual(N.view(snap1, { kind: 'start', q: 'f' }).items![0].label, 'Folders', '"f" then Enter picks the Folders row');

// number picks (FR-006): unique opens at once, a prefix of a longer number waits for Enter, a missing one finds nothing
const chatsLv: Level = { kind: 'chats', q: '' };
let v = N.view(snap1, { ...chatsLv, q: '2' });
assert.strictEqual(v.auto && v.auto.id, 's3', 'chat 2 is unique: open at once');
v = N.view(snap1, { ...chatsLv, q: '3' });
assert.strictEqual(v.auto, null, 'chat 3 and 31: wait for Enter');
assert.deepStrictEqual(v.items!.map((x) => x.n), [3, 31]); assert.strictEqual(v.items![v.active!].n, 3, 'chat 3 highlighted');
v = N.view(snap1, { ...chatsLv, q: '31' });
assert.strictEqual(v.auto && v.auto.id, 's4');
v = N.view(snap1, { ...chatsLv, q: '7' });
assert.deepStrictEqual(v.items, []); assert.strictEqual(v.auto, null, 'no chat 7');
v = N.view(snap2, { kind: 'start', q: '2' });
assert.strictEqual(v.auto && v.auto.label, 'Upstairs', 'a floor by its number');
v = N.view(snap1, { kind: 'agents', folder: 'r1', q: '3' });
assert.strictEqual(v.auto && v.auto.id, 's2', 'the agent level picks by chat number');
assert.deepStrictEqual(N.pickNumber([{ kind: 'x', label: 'a', n: 1 }], 'x'), null);

// picks (FR-008): floor -> folders, folder with two chats -> agents, with one chat -> open, chat -> open, rows -> their level
assert.deepStrictEqual(N.pick(snap2, { kind: 'floor', id: 'up', label: 'Upstairs' }), { push: { kind: 'folders', floor: 'up', q: '' } });
assert.deepStrictEqual(N.pick(snap1, { kind: 'folder', id: 'r1', label: 'api' }), { push: { kind: 'agents', folder: 'r1', q: '' } });
assert.deepStrictEqual(N.pick(snap1, { kind: 'folder', id: 'r2', label: 'core' }), { open: 's3' }, 'one session: open it');
assert.deepStrictEqual(N.pick(snap1, { kind: 'chat', id: 's4', label: 'Di' }), { open: 's4' });
assert.deepStrictEqual(N.pick(snap1, { kind: 'go', to: 'chats', label: 'Chats' }), { push: { kind: 'chats', q: '' } });

// the stack and Escape (FR-007): back restores the level below as it was; false at the start level (close)
let st: Level[] = [{ kind: 'start', q: 'up', active: 1 }];
st = N.push(st, { kind: 'folders', floor: 'up' });
st = N.push(st, { kind: 'agents', folder: 'r2' });
assert.deepStrictEqual(N.crumbs(snap2, st), ['Go to', 'Upstairs', 'core']);
let b = N.back(st); assert.ok(b && b.length === 2 && b[1].kind === 'folders');
b = N.back(b as Level[]); assert.ok(b && b.length === 1 && b[0].q === 'up' && b[0].active === 1, 'the start level comes back with its filter');
assert.strictEqual(N.back(b as Level[]), false, 'Escape at the start level closes');
assert.deepStrictEqual(N.crumbs(snap1, [start, { kind: 'chats' }]), ['Go to', 'Chats']);

// ---- the shortcut (FR-002, FR-017) ----
const D = N.DEFAULT_COMBO;
assert.deepStrictEqual(N.comboParts(D), ['mod', 'J']);
assert.ok(N.comboMatches({ code: 'KeyJ', ctrlKey: true }, D, false), 'Ctrl+J on Windows and Linux');
assert.ok(N.comboMatches({ code: 'KeyJ', metaKey: true }, D, true), '⌘J on a Mac');
assert.ok(!N.comboMatches({ code: 'KeyJ', ctrlKey: true }, D, true), 'Ctrl+J is not ⌘J on a Mac');
assert.ok(!N.comboMatches({ code: 'KeyJ', metaKey: true }, D, false), 'Super+J is not the shortcut elsewhere');
assert.ok(!N.comboMatches({ code: 'KeyJ', ctrlKey: true, shiftKey: true }, D, false), 'extra Shift does not match');
assert.ok(!N.comboMatches({ code: 'KeyJ', ctrlKey: true, isComposing: true }, D, false), 'not while composing (IME)');
assert.ok(N.comboMatches({ code: 'KeyJ', ctrlKey: true }, D, false) && !N.comboMatches({ code: 'KeyK', ctrlKey: true }, D, false), 'by key position (code)');
assert.strictEqual(N.comboFromEvent({ code: 'ShiftLeft', shiftKey: true }, false), null, 'a modifier alone is not a combination');
assert.deepStrictEqual(N.comboFromEvent({ code: 'KeyG', ctrlKey: true, shiftKey: true }, false), { mod: true, ctrl: false, alt: false, shift: true, code: 'KeyG', sup: false });
assert.deepStrictEqual(N.comboParts({ mod: true, shift: true, code: 'Space' }), ['shift', 'mod', 'Space']);
assert.deepStrictEqual(N.comboParts({ ctrl: true, alt: true, code: 'Comma' }), ['ctrl', 'alt', ',']);

// ---- the clash check (FR-014) ----
const ok = (c: Combo, mac: boolean) => N.clashOf(c, mac) === '';
assert.ok(ok(D, false) && ok(D, true), 'the default is free on every OS');
assert.ok(ok({ mod: true, shift: true, code: 'KeyG' }, false) && ok({ mod: true, shift: true, code: 'KeyG' }, true), 'Ctrl/⌘+Shift+G is free');
assert.ok(ok({ alt: true, code: 'KeyJ' }, false), 'Alt+J is allowed on Windows and Linux');
assert.ok(ok({ mod: true, code: 'F6' }, false));
const refused: [Combo, boolean, RegExp][] = [
  [{ mod: true, code: 'KeyK' }, false, /command palette/], [{ mod: true, code: 'KeyK' }, true, /command palette/],
  [{ mod: true, code: 'KeyC' }, false, /Copy/], [{ mod: true, code: 'KeyV' }, true, /Paste/], [{ mod: true, shift: true, code: 'KeyZ' }, false, /Redo/],
  [{ mod: true, code: 'KeyO' }, false, /Add folder/], [{ mod: true, shift: true, code: 'KeyA' }, true, /Needs you/],
  [{ mod: true, code: 'Backquote' }, false, /previous chat/], [{ ctrl: true, code: 'Backquote' }, true, /previous chat/], [{ mod: true, code: 'Comma' }, true, /Settings/],
  [{ alt: true, code: 'KeyA' }, false, /Allow once/], [{ mod: true, alt: true, code: 'KeyD' }, true, /Deny/],
  [{ mod: true, code: 'Space' }, true, /Spotlight/], [{ mod: true, code: 'Space' }, false, /input methods/], [{ ctrl: true, code: 'Space' }, true, /input sources/],
  [{ mod: true, ctrl: true, code: 'Space' }, true, /Emoji/], [{ mod: true, alt: true, code: 'Space' }, true, /Finder/], [{ mod: true, shift: true, code: 'Space' }, false, /input-method/],
  [{ alt: true, code: 'Tab' }, false, /letter, a digit/], [{ alt: true, code: 'F4' }, false, /closing the window/], [{ alt: true, code: 'Space' }, false, /window menu/],
  [{ mod: true, code: 'KeyH' }, true, /Hide/], [{ mod: true, code: 'KeyQ' }, false, /Quit/], [{ mod: true, code: 'KeyW' }, true, /Close window/],
  [{ mod: true, shift: true, code: 'Digit4' }, true, /screenshots/], [{ mod: true, ctrl: true, code: 'KeyQ' }, true, /locking/],
  [{ code: 'KeyJ' }, false, /Ctrl or Alt/], [{ shift: true, code: 'KeyJ' }, true, /⌘, ⌃ or ⌥/], [{ code: 'F5' }, false, /Ctrl or Alt/],
  [{ mod: true, code: 'KeyJ', sup: true }, false, /Super/], [{ mod: true, code: 'ArrowUp' }, false, /letter, a digit/], [{ mod: true, code: 'Escape' }, false, /letter, a digit/],
  [{ alt: true, code: 'KeyJ' }, true, /accented/], [{ mod: true, alt: true, code: 'KeyJ' }, false, /AltGr/], [{ mod: true, alt: true, code: 'F2' }, false, /consoles/],
];
for (const [c, mac, re] of refused) {
  const why = N.clashOf(c, mac);
  assert.ok(why && re.test(why), `${JSON.stringify(c)} on ${mac ? 'a Mac' : 'Windows/Linux'} is refused for ${re}: got "${why}"`);
}
assert.ok(ok({ mod: true, alt: true, shift: true, code: 'KeyJ' }, false), 'Ctrl+Alt+Shift+J does not type a character');

// ---- saved shortcut ----
assert.deepStrictEqual(N.loadCombo(null, false), D);
assert.deepStrictEqual(N.loadCombo('{bad', true), D);
assert.deepStrictEqual(N.loadCombo(JSON.stringify({ mod: true, code: 'KeyK' }), false), D, 'a combination that is not allowed falls back to the default');
assert.deepStrictEqual(N.loadCombo(JSON.stringify({ mod: true, shift: true, code: 'KeyG', extra: 'x' }), false), { mod: true, ctrl: false, alt: false, shift: true, code: 'KeyG' });
assert.deepStrictEqual(N.loadCombo(JSON.stringify({ ctrl: true, code: 'KeyJ' }), false), D, 'the Mac Control flag is dropped elsewhere (then nothing is left)');
assert.ok(N.sameCombo({ mod: true, code: 'KeyJ' }, D) && !N.sameCombo({ mod: true, shift: true, code: 'KeyJ' }, D));

// ---- wiring that a unit test can see ----
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.indexOf('src="navigator.js"') > 0 && html.indexOf('src="navigator.js"') < html.indexOf('src="app.js"'), 'index.html loads navigator.js before app.js');
assert.ok(/'navigator\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets.js copies navigator.js');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
assert.ok(/const NAV=window\.DurbarNav/.test(app) && /NAV\.rank\(palAll\(/.test(app), 'Ctrl+K uses the shared matching');

console.log('navigator tests passed');
