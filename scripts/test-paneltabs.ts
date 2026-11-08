/**
 * Spec 094 T040 (FR-001, FR-003): the chat panel's tablist module. `npm run test:paneltabs`.
 * Pure helpers of src/renderer/paneltabs.js, plus the sources that wire it. No Electron; the behaviour in the window is the Browser drivers.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const src = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
interface Tab { id: string; elId: string; label: string; controls: string }
interface PT {
  tabKey(key: string, index: number, count: number): number;
  tabsFor(own?: { browser?: boolean }): Tab[];
  listLabel(tabs: Tab[]): string;
  nextTab(tabs: Tab[], index: number, e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): Tab | null;
  tabsHTML(tabs: Tab[], selected: string): string;
  setSelected(tabs: Tab[], selected: string, doc: unknown): void;
  wire(tabs: Tab[], choose: (t: Tab, o?: { focus?: boolean }) => void, doc: unknown): void;
  focusTab(tab: Tab | undefined, doc: unknown): void;
  byId(tabs: Tab[], id: string): Tab | undefined;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const P: PT = require(path.join(ROOT, 'src', 'renderer', 'paneltabs.js'));

// roving tabindex: wraps, Home and End, nothing for other keys
assert.strictEqual(P.tabKey('ArrowRight', 0, 2), 1);
assert.strictEqual(P.tabKey('ArrowRight', 1, 2), 0, 'wraps');
assert.strictEqual(P.tabKey('ArrowLeft', 0, 2), 1, 'wraps');
assert.strictEqual(P.tabKey('Home', 1, 3), 0);
assert.strictEqual(P.tabKey('End', 0, 3), 2);
for (const k of ['Enter', ' ', 'a', 'Escape', 'ArrowDown', 'Tab']) assert.strictEqual(P.tabKey(k, 0, 2), -1, `${k} is not a tab key`);
assert.strictEqual(P.tabKey('ArrowRight', 0, 0), -1);

// tabsFor: Chat first, Browser only when offered
assert.deepStrictEqual(P.tabsFor().map((t) => t.id), ['chat']);
assert.deepStrictEqual(P.tabsFor({ browser: false }).map((t) => t.id), ['chat'], 'an owner that says false adds no tab (Terminal will go through this gate)');
assert.deepStrictEqual(P.tabsFor({ browser: true }).map((t) => t.id), ['chat', 'browser']);
assert.deepStrictEqual(P.tabsFor({ browser: true }).map((t) => t.elId), ['tabChat', 'tabBrowser'], 'element ids the drivers and styles use');
assert.strictEqual(P.listLabel(P.tabsFor({ browser: true })), 'Chat or browser');
assert.strictEqual(P.listLabel(P.tabsFor()), 'Chat');

// nextTab: modifiers leave the key alone
const two = P.tabsFor({ browser: true });
assert.strictEqual(P.nextTab(two, 0, { key: 'ArrowRight' })?.id, 'browser');
assert.strictEqual(P.nextTab(two, 0, { key: 'End' })?.id, 'browser');
for (const m of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) assert.strictEqual(P.nextTab(two, 0, { key: 'ArrowRight', [m]: true }), null, `${m} is not ours`);
assert.strictEqual(P.nextTab(two, 0, { key: 'Enter' }), null);

// the markup: one tab stop, on the selected tab
const html = P.tabsHTML(two, 'chat');
assert.ok(/id="panelTabs" role="tablist" aria-label="Chat or browser"/.test(html));
assert.ok(/class="ptab" id="tabChat" role="tab" type="button" aria-selected="true" aria-controls="chat" tabindex="0">Chat</.test(html));
assert.ok(/id="tabBrowser" role="tab" type="button" aria-selected="false" aria-controls="browserPane" tabindex="-1">Browser</.test(html));
assert.strictEqual((P.tabsHTML(two, 'browser').match(/tabindex="0"/g) ?? []).length, 1, 'exactly one tab stop');
assert.ok(/id="tabBrowser"[^>]*aria-selected="true"[^>]*tabindex="0"/.test(P.tabsHTML(two, 'browser')));

// the whole tablist is byte-identical to the one browserpane.js wrote before T040 (PR claim, now compared)
assert.strictEqual(P.tabsHTML(two, 'chat'),
  '<div class="ptabs" id="panelTabs" role="tablist" aria-label="Chat or browser">'
  + '<button class="ptab" id="tabChat" role="tab" type="button" aria-selected="true" aria-controls="chat" tabindex="0">Chat</button>'
  + '<button class="ptab" id="tabBrowser" role="tab" type="button" aria-selected="false" aria-controls="browserPane" tabindex="-1">Browser</button></div>', 'tablist markup, byte for byte');

// byId: by id, never by position
assert.strictEqual(P.byId(two, 'chat')?.elId, 'tabChat', 'byId finds Chat by its id, not by position'); assert.strictEqual(P.byId(two, 'browser')?.elId, 'tabBrowser', 'byId finds Browser by its id, not by position');
assert.strictEqual(P.byId(two, 'terminal'), undefined, 'an id with no tab is undefined, not Browser');

// the DOM half, on a fake document: selected state, click and key rules, focus
{
  interface FakeEl { id: string; attrs: Record<string, string>; tabIndex: number; focused: unknown[]; onclick?: () => void; onkeydown?: (e: unknown) => void; setAttribute(k: string, v: string): void; focus(o: unknown): void }
  const mk = (ids: string[]) => {
    const els: Record<string, FakeEl> = {};
    for (const id of ids) els[id] = { id, attrs: {}, tabIndex: 99, focused: [], setAttribute(k, v) { this.attrs[k] = v; }, focus(o) { this.focused.push(o); } };
    return { els, doc: { getElementById: (id: string) => els[id] || null } };
  };
  const f = mk(['tabChat', 'tabBrowser']);
  P.setSelected(two, 'browser', f.doc);
  assert.deepStrictEqual([f.els.tabChat.attrs['aria-selected'], f.els.tabBrowser.attrs['aria-selected']], ['false', 'true'], 'setSelected: aria-selected as strings');
  assert.deepStrictEqual([f.els.tabChat.tabIndex, f.els.tabBrowser.tabIndex], [-1, 0], 'setSelected: the one tab stop moves with the selection');
  assert.doesNotThrow(() => P.setSelected(two, 'chat', mk(['tabChat']).doc), 'setSelected on a page with no Browser tab element does nothing for it (the old code threw and aborted mount)');

  const chosen: { id: string; o?: { focus?: boolean } }[] = [];
  const g = mk(['tabChat', 'tabBrowser']);
  P.wire(two, (tab, o) => chosen.push({ id: tab.id, o }), g.doc);
  g.els.tabBrowser.onclick?.();
  assert.deepStrictEqual(chosen.pop(), { id: 'browser', o: undefined }, 'a click chooses its tab and asks for no focus move');
  const ev = (key: string, extra: Record<string, boolean> = {}) => { const e = { key, ...extra, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } }; return e; };
  const right = ev('ArrowRight'); g.els.tabChat.onkeydown?.(right);
  assert.deepStrictEqual(chosen.pop(), { id: 'browser', o: { focus: true } }, 'ArrowRight chooses the next tab and moves focus');
  assert.deepStrictEqual([right.prevented, right.stopped], [1, 1], 'and the key is neither scrolled nor seen by the page\'s other key listeners');
  const left = ev('ArrowLeft'); g.els.tabChat.onkeydown?.(left); assert.strictEqual(chosen.pop()?.id, 'browser', 'ArrowLeft wraps');
  for (const k of [ev('Enter'), ev('ArrowRight', { shiftKey: true }), ev('ArrowRight', { ctrlKey: true })]) { g.els.tabChat.onkeydown?.(k); assert.deepStrictEqual([chosen.length, k.prevented, k.stopped], [0, 0, 0], `${k.key} is left alone`); }
  const h = mk(['tabChat']);
  assert.doesNotThrow(() => P.wire(two, () => undefined, h.doc), 'wire on a missing tab element does nothing');
  assert.ok(typeof h.els.tabChat.onclick === 'function' && typeof h.els.tabChat.onkeydown === 'function', 'wire on a missing tab element still wires the tabs that exist');
  assert.deepStrictEqual(Object.keys(h.els), ['tabChat'], 'and creates nothing for the missing one');

  P.focusTab(P.byId(two, 'browser'), f.doc);
  assert.deepStrictEqual([f.els.tabBrowser.focused, f.els.tabChat.focused], [[{ preventScroll: true }], []], 'focusTab focuses that tab without scrolling');
  assert.doesNotThrow(() => P.focusTab(P.byId(two, 'terminal'), f.doc), 'focusTab for an id with no tab does nothing (select() with an unknown id must not throw)');
  assert.deepStrictEqual([f.els.tabBrowser.focused.length, f.els.tabChat.focused.length], [1, 0], 'select() with an unknown id leaves focus where it was: no tab is focused or moved');
}

// the page path: paneltabs.js sets window.DurbarPanelTabs and browserpane.js, loaded after it, reads it (a rename of the global would leave no DurbarBrowserPane)
{
  const vm = require('vm') as typeof import('vm');
  const ctx = vm.createContext({}) as Record<string, unknown>; ctx.self = ctx;
  vm.runInContext(src('src/renderer/paneltabs.js'), ctx, { filename: 'paneltabs.js' });
  assert.strictEqual(typeof (ctx.DurbarPanelTabs as PT | undefined)?.tabsHTML, 'function', 'paneltabs.js defines window.DurbarPanelTabs');
  vm.runInContext(src('src/renderer/browserpane.js'), ctx, { filename: 'browserpane.js' });
  const bp = ctx.DurbarBrowserPane as { tabsHTML(): string } | undefined;
  assert.ok(bp && bp.tabsHTML() === P.tabsHTML(two, 'chat'), 'browserpane.js loads after it and draws the same tablist');
}

// wiring: the browser pane uses the module and no longer carries its own tablist code
const bp = src('src/renderer/browserpane.js');
assert.ok(/PT\.tabsHTML\(PANEL_TABS/.test(bp) && /PT\.wire\(PANEL_TABS/.test(bp) && /PT\.setSelected\(PANEL_TABS/.test(bp), 'browserpane.js draws, wires and selects through paneltabs.js');
assert.ok(!/class="ptab"|role="tablist" aria-label="Chat or browser"/.test(bp), 'no tablist markup left in browserpane.js');
assert.ok(/PT\.wire\(PANEL_TABS,\(t,o\)=>select\(t\.id,o\)\)/.test(bp) && /PT\.setSelected\(PANEL_TABS,tab\)/.test(bp) && /PT\.focusTab\(PT\.byId\(PANEL_TABS,tab\)\)/.test(bp), 'the choice, the selection and the focus pass the tab and its options through unchanged');
assert.ok(!/'Browser'/.test(bp), 'the Browser tab\'s word is the tablist module\'s label, not a second literal in render()');
const html5 = src('src/renderer/index.html');
assert.ok(html5.indexOf('paneltabs.js') > 0 && html5.indexOf('paneltabs.js') < html5.indexOf('browserpane.js'), 'paneltabs.js loads before browserpane.js');
assert.ok(/'paneltabs\.js'/.test(src('scripts/copy-assets.js')), 'paneltabs.js is copied to dist');
console.log('paneltabs: ok');
