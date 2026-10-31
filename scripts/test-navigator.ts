/** Keyboard navigator (spec 074, issue #548): levels, start letters, number picks, matching, chat numbers, the shortcut and its clash
 *  check. `npm run test:navigator`. Pure module; runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
type Item = { kind: string; id?: string; label: string; hint?: string; kw?: string; n?: number; no?: number; to?: string };
type Level = { kind: string; floor?: string; folder?: string; q?: string; active?: number };
type Snap = { floors: { id: string; name: string }[]; folders: { id: string; name: string; floor: string; hint?: string }[]; chats: { id: string; name: string; folder: string; no: number; hint?: string }[] };
type Combo = { mod?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean; code: string; sup?: boolean; typed?: string };
type Ev = Partial<{ code: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat: boolean }>;
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
  takenBy: (c: Combo, mac: boolean) => [string, string, string?] | null;
  textSafeKey: (e: Ev, mac: boolean, ctx: Ctx) => string;
};
type Ctx = Partial<{ editable: boolean; log: boolean; selected: boolean; dialog: boolean }>;

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
// 2026-10-23 (issue #587): the default is Ctrl+F / ⌘F ("F for floor"); it was Ctrl+J / ⌘J
assert.deepStrictEqual(N.comboParts(D), ['mod', 'F']);
assert.ok(N.comboMatches({ code: 'KeyF', ctrlKey: true }, D, false), 'Ctrl+F on Windows and Linux');
assert.ok(N.comboMatches({ code: 'KeyF', metaKey: true }, D, true), '⌘F on a Mac');
assert.ok(!N.comboMatches({ code: 'KeyF', ctrlKey: true }, D, true), 'Ctrl+F is not ⌘F on a Mac');
assert.ok(!N.comboMatches({ code: 'KeyF', metaKey: true }, D, false), 'Super+F is not the shortcut elsewhere');
assert.ok(!N.comboMatches({ code: 'KeyF', ctrlKey: true, shiftKey: true }, D, false), 'extra Shift does not match');
assert.ok(!N.comboMatches({ code: 'KeyF', ctrlKey: true, isComposing: true }, D, false), 'not while composing (IME)');
assert.ok(N.comboMatches({ code: 'KeyF', ctrlKey: true }, D, false) && !N.comboMatches({ code: 'KeyK', ctrlKey: true }, D, false), 'by key position (code)');
assert.ok(!N.comboMatches({ code: 'KeyJ', key: 'j', ctrlKey: true }, D, false) && !N.comboMatches({ code: 'KeyJ', key: 'j', metaKey: true }, D, true), 'Ctrl+J / ⌘J no longer opens Go to (no alias)');
assert.ok(N.clashOf({ mod: true, code: 'KeyJ' }, false) === '' && N.clashOf({ mod: true, code: 'KeyJ' }, true) === '', 'Ctrl+J / ⌘J is free to record now');
assert.ok(N.comboMatches({ code: 'KeyF', key: 'u', metaKey: true }, D, true), 'Mac Dvorak: ⌘ at F types U, nobody\'s, so the default works there');
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
// spec 080 FR-130: the browser's tab keys are taken (Ctrl+T, ⌘T); Ctrl+Tab cannot be recorded at all (Tab is not a recordable key), and TAKEN names it too
refused.push([{ mod: true, code: 'KeyT' }, false, /New browser tab/], [{ mod: true, code: 'KeyT' }, true, /New browser tab/], [{ mod: true, code: 'KeyW' }, false, /closes a browser tab/]);
for (const mac of [false, true]) for (const shift of [false, true]) assert.ok(N.clashOf({ ctrl: mac, mod: !mac, shift, code: 'Tab' }, mac) !== '', `Ctrl+${shift ? 'Shift+' : ''}Tab is refused (mac=${mac})`);
{
  const navSrc0 = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'navigator.js'), 'utf8');
  assert.ok(/\['ctrl\+Tab','Switching browser tabs'\]/.test(navSrc0) && /\['ctrl\+shift\+Tab','Switching browser tabs'\]/.test(navSrc0), 'TAKEN names Ctrl+Tab and Ctrl+Shift+Tab (FR-130)');
}
for (const [c, mac, re] of refused) {
  const why = N.clashOf(c, mac);
  assert.ok(why && re.test(why), `${JSON.stringify(c)} on ${mac ? 'a Mac' : 'Windows/Linux'} is refused for ${re}: got "${why}"`);
}
assert.ok(ok({ mod: true, alt: true, shift: true, code: 'KeyJ' }, false), 'Ctrl+Alt+Shift+J does not type a character');

// review 2026-10-23 (fjcabello, PR #552): Mac text-editing Control keys, IBus keys on Linux, Schedules (#560)
for (const L of 'ABDEFHKLNOPTVY') {
  for (const shift of [false, true]) {
    const why = N.clashOf({ ctrl: true, shift, code: 'Key' + L }, true);
    assert.ok(/edits text/.test(why) && why.includes(L), `⌃${shift ? '⇧' : ''}${L} on a Mac is a text-editing key: got "${why}"`);
  }
}
assert.ok(ok({ ctrl: true, code: 'KeyG' }, true) && ok({ ctrl: true, code: 'KeyJ' }, true), '⌃G and ⌃J are not text-editing keys');
assert.ok(ok({ mod: true, ctrl: true, code: 'KeyE' }, true), '⌃⌘E is not the text key ⌃E');
assert.ok(/Unicode input/.test(N.clashOf({ mod: true, shift: true, code: 'KeyU' }, false)), 'Ctrl+Shift+U is IBus Unicode input');
assert.ok(/emoji input/.test(N.clashOf({ mod: true, shift: true, code: 'KeyE' }, false)), 'Ctrl+Shift+E is IBus emoji input');
assert.ok(ok({ mod: true, shift: true, code: 'KeyU' }, true), '⇧⌘U is free on a Mac');
for (const mac of [false, true]) assert.ok(/Schedules/.test(N.clashOf({ mod: true, shift: true, code: 'KeyS' }, mac)), 'Ctrl/⌘+Shift+S is reserved for Schedules (#560)');

// FR-017 (2026-10-23): the typed letter counts too. Dvorak: the key labelled C is at the position of I (code KeyI, key "c").
const dvC: Ev = { code: 'KeyI', key: 'c', ctrlKey: true };
const rec = N.comboFromEvent(dvC, false)!;
assert.deepStrictEqual(rec, { mod: true, ctrl: false, alt: false, shift: false, code: 'KeyI', sup: false, typed: 'KeyC' }, 'the recorded combination keeps the typed letter');
let whyDv = N.clashOf(rec, false);
assert.ok(/types C/.test(whyDv) && /Copy/.test(whyDv), `Dvorak Ctrl+C is refused as Copy: got "${whyDv}"`);
whyDv = N.clashOf(N.comboFromEvent({ code: 'KeyS', key: 'o', metaKey: true }, true)!, true);
assert.ok(/types O/.test(whyDv) && /Add folder/.test(whyDv), `Dvorak ⌘O (position S, free there) is refused as Add folder: got "${whyDv}"`);
assert.ok(!('typed' in N.comboFromEvent({ code: 'KeyJ', key: 'j', ctrlKey: true }, false)!), 'QWERTY: no typed letter when it is the position');
assert.ok(ok(N.comboFromEvent({ code: 'KeyB', key: 'X', ctrlKey: true, shiftKey: true }, false)!, false), 'Dvorak Ctrl+Shift+X (position B) is free');
const ctrlI: Combo = { mod: true, code: 'KeyI' };
assert.ok(N.comboMatches({ code: 'KeyI', key: 'i', ctrlKey: true }, ctrlI, false), 'QWERTY: Ctrl+I matches');
assert.ok(!N.comboMatches(dvC, ctrlI, false), 'Dvorak: the press types C, so Copy keeps it');
const DJ: Combo = { mod: true, code: 'KeyJ' }; /* the old default, now a shortcut a user may pick */
assert.ok(!N.comboMatches({ code: 'KeyJ', key: 'h', metaKey: true }, DJ, true), 'Mac Dvorak: ⌘ at J types H (Hide), left to macOS');
assert.ok(N.comboMatches({ code: 'KeyJ', key: 'h', ctrlKey: true }, DJ, false), 'Linux/Windows Dvorak: Ctrl+H is nobody\'s, so Ctrl+J still works');
assert.ok(N.comboMatches({ code: 'KeyF', key: 'F', ctrlKey: true }, D, false), 'an upper-case key is the same letter');

// every Ctrl/⌘ shortcut of the global keydown handler in app.js is refused (so Go to cannot take one over)
const HANDLER_START = "document.addEventListener('keydown',e=>{\n  /* spec 052 FR-035";
/* Scans the handler's source (CRLF turned into LF first: Windows checks the file out with CRLF) and returns the number
   of combinations checked against TAKEN; throws when one is free or when a Ctrl/mod line yields no key at all. */
function scanHandler(raw: string): number {
  const src = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const start = src.indexOf(HANDLER_START);
  assert.ok(start > 0, 'found the global keydown handler');
  const end = src.indexOf('\n});\n', start);
  const body = src.slice(start, end > 0 ? end : undefined);
  let n = 0;
  for (const line of body.split('\n')) {
    if (!/^\s*if\(/.test(line) || /KEYS\.chatKeyDown|NAV\.comboMatches/.test(line)) continue;
    const viaMod = /\bmod&&/.test(line), viaCtrl = /(^|[^!])\be\.ctrlKey&&/.test(line);
    if (!viaMod && !viaCtrl) continue;
    /* a modifier the line requires (e.shiftKey&&), refuses (!e.shiftKey) or leaves open (both are checked) */
    const states = (k: string) => (new RegExp('(^|[^!])e\\.' + k + '&&').test(line) ? [true] : new RegExp('!e\\.' + k).test(line) ? [false] : [false, true]);
    /* positions (e.code==='KeyG') and typed letters (e.key==='g', e.key.toLowerCase()==='g'); the letter's position on QWERTY is checked too */
    const codes = [...line.matchAll(/e\.code==='((?:Key|Digit)[A-Z0-9]|Backquote)'/g)].map((x) => x[1]);
    const keys = [...line.matchAll(/e\.key(?:\.to(?:Lower|Upper)Case\(\))?==='([A-Za-z0-9`])'/g)].map((x) => x[1]);
    for (const k of keys) codes.push(/[A-Za-z]/.test(k) ? 'Key' + k.toUpperCase() : /\d/.test(k) ? 'Digit' + k : 'Backquote');
    assert.ok(codes.length > 0, `a Ctrl/mod shortcut line yields a code or a key letter: ${line.trim().slice(0, 100)}`);
    for (const mac of [false, true]) {
      if (mac && /!IS_MAC&&/.test(line)) continue;
      for (const code of new Set(codes)) for (const shift of states('shiftKey')) for (const alt of states('altKey')) {
        const c: Combo = viaMod || !mac ? { mod: true, shift, alt, code } : { ctrl: true, shift, alt, code };
        assert.ok(N.clashOf(c, mac) !== '', `the handler's ${JSON.stringify(c)} on ${mac ? 'a Mac' : 'Windows/Linux'} is in TAKEN`);
        n++;
      }
    }
  }
  return n;
}
{
  /* normalised to LF first: a Windows checkout is already CRLF, and turning that into CRLF again gives \r\r\n */
  const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const n = scanHandler(appSrc);
  assert.ok(n >= 12, `checked the handler's shortcuts (${n})`);
  assert.strictEqual(scanHandler(appSrc.replace(/\n/g, '\r\n')), n, 'CRLF checkout (Windows) scans the same');
  assert.strictEqual(scanHandler('\uFEFF' + appSrc.replace(/\n/g, '\r\n')), n, 'a BOM and CRLF scan the same');
  /* mutation: a shortcut planted into the handler is found, whether it matches by code or only by key */
  const plant = (cond: string) => appSrc.replace(HANDLER_START, HANDLER_START + `\n  if(${cond}){e.preventDefault();return;}`);
  const planted = (cond: string) => { try { scanHandler(plant(cond)); return false; } catch { return true; } };
  assert.ok(planted("mod&&e.shiftKey&&!e.altKey&&e.code==='KeyG'"), 'planted e.code Ctrl+Shift+G is found');
  assert.ok(planted("mod&&e.shiftKey&&!e.altKey&&(e.key==='G'||e.key==='g')"), 'planted e.key-only Ctrl+Shift+G is found');
  assert.ok(planted("mod&&e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='g'"), 'planted e.key.toLowerCase() Ctrl+Shift+G is found');
  assert.ok(planted("e.ctrlKey&&!e.altKey&&someOther(e)"), 'a Ctrl line with no key at all is flagged');
  assert.ok(!planted("mod&&!e.shiftKey&&!e.altKey&&e.key==='k'"), 'a shortcut that is already taken (Ctrl+K) passes');
}

// ---- spec 083 FR-026 / spec 074 FR-085: Ctrl+Shift+M (⇧⌘M) is the Notes drawer: taken, scanned, and a saved Go to combination equal to it keeps working ----
{
  for (const mac of [false, true]) assert.ok(/Notes drawer/.test(N.clashOf({ mod: true, shift: true, code: 'KeyM' }, mac)), `${mac ? 'Mac' : 'Windows/Linux'}: Go to cannot record Ctrl+Shift+M (the Notes drawer)`);
  const navSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'navigator.js'), 'utf8');
  const appSrc2 = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/\['mod\+shift\+KeyM','the Notes drawer'\]/.test(navSrc), 'TAKEN has the Notes row');
  const line = appSrc2.split('\n').find((l) => /e\.code==='KeyM'/.test(l) && /toggleNotes/.test(l)) || '';
  assert.ok(/^\s*if\(mod&&e\.shiftKey&&!e\.altKey&&e\.code==='KeyM'&&ui\.selected&&notesOn\(/.test(line), `the handler has the Notes line: ${line.slice(0, 80)}`);
  // mutation: without the TAKEN row the combination is free, so the handler scan above (which reads that line) would fail
  const tmp = path.join(require('os').tmpdir(), 'durbar-nav-mut-' + process.pid + '.js');
  fs.writeFileSync(tmp, navSrc.replace(/\n\s*\['mod\+shift\+KeyM','the Notes drawer'\],[^\n]*/, ''));
  const N2 = require(tmp) as typeof N;
  fs.unlinkSync(tmp);
  assert.strictEqual(N2.clashOf({ mod: true, shift: true, code: 'KeyM' }, false), '', 'mutation: with the row removed, Ctrl+Shift+M is free (the scan would fail)');
  // the Go to key is checked before the Notes key in the handler: a saved Ctrl+Shift+M keeps working and the drawer key does nothing
  assert.ok(appSrc2.indexOf('NAV.comboMatches(e,NAV_KEY,IS_MAC)') > 0 && appSrc2.indexOf('NAV.comboMatches(e,NAV_KEY,IS_MAC)') < appSrc2.indexOf(line), 'Go to is matched before the Notes key');
  const saved = { mod: true, shift: true, code: 'KeyM' };
  assert.deepStrictEqual(N.loadCombo(JSON.stringify(saved), false), { mod: true, ctrl: false, alt: false, shift: true, code: 'KeyM' }, 'a saved Ctrl+Shift+M is kept');
  assert.deepStrictEqual(N.loadCombo(JSON.stringify(saved), true), { mod: true, ctrl: false, alt: false, shift: true, code: 'KeyM' }, 'and ⇧⌘M on a Mac');
  assert.ok(N.comboMatches({ code: 'KeyM', key: 'M', ctrlKey: true, shiftKey: true }, N.loadCombo(JSON.stringify(saved), false), false), 'it matches the press, so Go to answers it');
  assert.deepStrictEqual(N.loadCombo(JSON.stringify({ mod: true, shift: true, code: 'KeyN' }), false), D, 'another taken combination still falls back');
}

// ---- saved shortcut ----
assert.deepStrictEqual(N.loadCombo(null, false), D);
assert.deepStrictEqual(N.loadCombo('{bad', true), D);
assert.deepStrictEqual(N.loadCombo(JSON.stringify({ mod: true, code: 'KeyK' }), false), D, 'a combination that is not allowed falls back to the default');
assert.deepStrictEqual(N.loadCombo(JSON.stringify({ mod: true, shift: true, code: 'KeyG', extra: 'x' }), false), { mod: true, ctrl: false, alt: false, shift: true, code: 'KeyG' });
assert.deepStrictEqual(N.loadCombo(JSON.stringify({ ctrl: true, code: 'KeyJ' }), false), D, 'the Mac Control flag is dropped elsewhere (then nothing is left)');
assert.ok(N.sameCombo({ mod: true, code: 'KeyF' }, D) && !N.sameCombo({ mod: true, shift: true, code: 'KeyF' }, D));
assert.deepStrictEqual(N.loadCombo(JSON.stringify({ mod: true, code: 'KeyJ' }), true), { mod: true, ctrl: false, alt: false, shift: false, code: 'KeyJ' }, 'a saved Ctrl+J / ⌘J (someone\'s own choice) is kept');

// ---- 2026-10-23 (issue #587): Ctrl+A opens Needs you and Ctrl+Backspace goes back to the office, only outside text (FR-020, FR-021) ----
{
  const A = (mac: boolean, x: Ev = {}): Ev => Object.assign({ code: 'KeyA', key: 'a' }, mac ? { metaKey: true } : { ctrlKey: true }, x);
  const B = (mac: boolean, x: Ev = {}): Ev => Object.assign({ code: 'Backspace', key: 'Backspace' }, mac ? { metaKey: true } : { ctrlKey: true }, x);
  for (const mac of [false, true]) {
    const os = mac ? 'a Mac' : 'Windows/Linux';
    assert.strictEqual(N.textSafeKey(A(mac), mac, {}), 'inbox', `${os}: Ctrl/⌘+A outside text opens Needs you`);
    assert.strictEqual(N.textSafeKey(B(mac), mac, {}), 'office', `${os}: Ctrl/⌘+Backspace outside text goes back to the office`);
    for (const k of ['editable', 'selected', 'dialog'] as const) {
      assert.strictEqual(N.textSafeKey(A(mac), mac, { [k]: true }), '', `${os}: Ctrl/⌘+A stays Select all (${k})`);
      assert.strictEqual(N.textSafeKey(B(mac), mac, { [k]: true }), '', `${os}: Ctrl/⌘+Backspace keeps its text meaning (${k})`);
    }
    assert.strictEqual(N.textSafeKey(A(mac), mac, { log: true }), '', `${os}: Ctrl/⌘+A in the chat log selects the conversation`);
    assert.strictEqual(N.textSafeKey(B(mac), mac, { log: true }), 'office', `${os}: Ctrl/⌘+Backspace in the chat log goes back (no text there to lose)`);
    for (const x of [{ shiftKey: true }, { altKey: true }, { isComposing: true }] as Ev[]) {
      assert.strictEqual(N.textSafeKey(A(mac, x), mac, {}), '', `${os}: not with ${JSON.stringify(x)} (Ctrl+Shift+A is its own shortcut)`);
      assert.strictEqual(N.textSafeKey(B(mac, x), mac, {}), '', `${os}: Backspace not with ${JSON.stringify(x)}`);
    }
    assert.strictEqual(N.textSafeKey(A(mac, { ctrlKey: true, metaKey: true }), mac, {}), '', `${os}: never with both Ctrl and ⌘`);
    assert.strictEqual(N.textSafeKey({ code: 'KeyA', key: 'a' }, mac, {}), '', `${os}: A alone is not ours`);
    assert.strictEqual(N.textSafeKey({ code: 'Backspace', key: 'Backspace' }, mac, {}), '', `${os}: Backspace alone is not ours`);
    assert.strictEqual(N.textSafeKey(A(mac, { key: 'A' }), mac, {}), 'inbox', `${os}: upper-case A (Caps Lock) is the same key`);
    assert.strictEqual(N.textSafeKey(A(mac, { key: 'ф' }), mac, {}), 'inbox', `${os}: a non-Latin layout (key ф at A) counts by position`);
    assert.strictEqual(N.textSafeKey(A(mac, { key: 'q' }), mac, {}), '', `${os}: AZERTY (position A types q) is Ctrl+Q, not ours`);
    assert.strictEqual(N.textSafeKey(A(mac, { code: 'KeyQ', key: 'a' }), mac, {}), 'inbox', `${os}: AZERTY's A (position Q) is Ctrl+A`);
    assert.strictEqual(N.textSafeKey(A(mac, { code: 'KeyK', key: 'k' }), mac, {}), '', `${os}: other letters are not ours`);
  }
  assert.strictEqual(N.textSafeKey({ code: 'KeyA', key: 'a', ctrlKey: true }, true, {}), '', 'a Mac: ⌃A is the text key "line start", not ours');
  assert.strictEqual(N.textSafeKey({ code: 'Backspace', key: 'Backspace', ctrlKey: true }, true, {}), '', 'a Mac: ⌃⌫ is not ours');
  assert.strictEqual(N.textSafeKey({ code: 'KeyA', key: 'a', metaKey: true }, false, {}), '', 'Windows/Linux: Super+A is not ours');
  /* TAKEN names both, so Settings can never record them for Go to (FR-023) */
  for (const mac of [false, true]) {
    const a = N.takenBy({ mod: true, code: 'KeyA' }, mac), b = N.takenBy({ mod: true, code: 'Backspace' }, mac);
    assert.ok(a && /Select all/.test(a[1]) && /Needs you/.test(a[1]), `Ctrl/⌘+A is named Select all and Needs you: ${a && a[1]}`);
    assert.ok(b && /Back to the office/.test(b[1]), `Ctrl/⌘+Backspace is named Back to the office: ${b && b[1]}`);
    assert.ok(N.clashOf({ mod: true, code: 'Backspace' }, mac) !== '', 'and refused');
  }
}

// ---- wiring that a unit test can see ----
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.indexOf('src="navigator.js"') > 0 && html.indexOf('src="navigator.js"') < html.indexOf('src="app.js"'), 'index.html loads navigator.js before app.js');
assert.ok(/'navigator\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets.js copies navigator.js');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
assert.ok(/const NAV=window\.DurbarNav/.test(app) && /NAV\.rank\(palAll\(/.test(app), 'Ctrl+K uses the shared matching');
assert.ok(/NAV\.textSafeKey\(e,IS_MAC,/.test(app), 'the global handler asks textSafeKey before Ctrl+A or Ctrl+Backspace act');

console.log('navigator tests passed');
