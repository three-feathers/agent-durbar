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

// wiring: the browser pane uses the module and no longer carries its own tablist code
const bp = src('src/renderer/browserpane.js');
assert.ok(/PT\.tabsHTML\(PANEL_TABS/.test(bp) && /PT\.wire\(PANEL_TABS/.test(bp) && /PT\.setSelected\(PANEL_TABS/.test(bp), 'browserpane.js draws, wires and selects through paneltabs.js');
assert.ok(!/class="ptab"|role="tablist" aria-label="Chat or browser"/.test(bp), 'no tablist markup left in browserpane.js');
const html5 = src('src/renderer/index.html');
assert.ok(html5.indexOf('paneltabs.js') > 0 && html5.indexOf('paneltabs.js') < html5.indexOf('browserpane.js'), 'paneltabs.js loads before browserpane.js');
assert.ok(/'paneltabs\.js'/.test(src('scripts/copy-assets.js')), 'paneltabs.js is copied to dist');
console.log('paneltabs: ok');
