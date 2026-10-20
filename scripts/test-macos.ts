/** macOS conventions (spec 052 FR-083..FR-085): the app menu, ⌘ shortcuts and their labels, close-to-hide, Dock bounce. `npm run test:macos`. Runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { MenuItemConstructorOptions } from 'electron';
import { HELP_LINK_LABEL, SETTINGS_ACCELERATOR, appMenuTemplate, disposeOnQuit, hideOnClose, windowChrome } from '../src/main/appmenu';
import { shouldBounce, shouldFlash } from '../src/main/badge';

const ROOT = path.join(__dirname, '..', '..');
type Ev = Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const K = require(path.join(ROOT, 'src', 'renderer', 'keys.js')) as {
  isMac: (p: unknown) => boolean;
  modDown: (e: Ev, mac: boolean) => boolean;
  chatKeyDown: (e: Ev, mac: boolean) => boolean;
  chatParts: (k: string, mac: boolean) => string[];
  keyLabels: (p: string[], mac: boolean) => string[];
  keyText: (p: string[], mac: boolean) => string;
  ariaKeys: (p: string[], mac: boolean) => string;
  ariaFor: (v: string, mac: boolean) => string;
  textFor: (v: string, mac: boolean) => string;
};

// ---- FR-084: platform and modifier ----
assert.ok(K.isMac('MacIntel') && !K.isMac('Win32') && !K.isMac('Linux x86_64') && !K.isMac(undefined), 'isMac reads navigator.platform');
assert.ok(K.modDown({ metaKey: true }, true) && !K.modDown({ ctrlKey: true }, true) && !K.modDown({ ctrlKey: true, metaKey: true }, true), 'Mac: Command only');
assert.ok(K.modDown({ ctrlKey: true }, false) && !K.modDown({ metaKey: true }, false) && !K.modDown({ ctrlKey: true, metaKey: true }, false), 'Windows/Linux: Ctrl only');
// chat answer keys: Alt elsewhere, Option+Command on a Mac; never a dead key, Shift, Ctrl or while composing
assert.ok(K.chatKeyDown({ altKey: true, code: 'KeyA', key: 'a' }, false), 'Alt+A elsewhere');
assert.ok(!K.chatKeyDown({ altKey: true, metaKey: true, key: 'a' }, false), 'Alt+Meta is not the chat key elsewhere');
assert.ok(!K.chatKeyDown({ altKey: true, key: 'å' }, true), 'Mac: Option alone types a letter, not a shortcut');
assert.ok(K.chatKeyDown({ altKey: true, metaKey: true, key: 'å' }, true), 'Mac: Option+Command');
assert.ok(!K.chatKeyDown({ altKey: true, metaKey: true, key: 'Dead' }, true) && !K.chatKeyDown({ altKey: true, key: 'Dead' }, false), 'a dead key never counts');
assert.ok(!K.chatKeyDown({ altKey: true, shiftKey: true, key: 'A' }, false) && !K.chatKeyDown({ altKey: true, ctrlKey: true, key: 'a' }, false) && !K.chatKeyDown({ altKey: true, isComposing: true, key: 'a' }, false), 'no Shift, Ctrl or composition');
assert.deepStrictEqual(K.chatParts('A', true), ['alt', 'mod', 'A']);
assert.deepStrictEqual(K.chatParts('A', false), ['alt', 'A']);

// ---- FR-084: labels ----
assert.deepStrictEqual(K.keyLabels(['mod', 'K'], true), ['⌘', 'K']);
assert.deepStrictEqual(K.keyLabels(['mod', 'K'], false), ['Ctrl', 'K']);
assert.strictEqual(K.keyText(['mod', 'shift', 'A'], true), '⇧⌘A', 'Apple order: Shift before Command, no plus signs');
assert.strictEqual(K.keyText(['mod', 'shift', 'A'], false), 'Ctrl+Shift+A');
assert.strictEqual(K.keyText(['alt', 'mod', 'S'], true), '⌥⌘S');
assert.strictEqual(K.keyText(['alt', 'S'], false), 'Alt+S');
assert.strictEqual(K.ariaKeys(['mod', 'shift', 'A'], true), 'Meta+Shift+A');
assert.strictEqual(K.ariaKeys(['mod', 'shift', 'A'], false), 'Control+Shift+A');
assert.strictEqual(K.ariaKeys(['alt', 'mod', 'D'], true), 'Meta+Alt+D');
assert.strictEqual(K.ariaFor('Control+Shift+A I', true), 'Meta+Shift+A I');
assert.strictEqual(K.ariaFor('Control+Shift+A I', false), 'Control+Shift+A I', 'Windows/Linux: unchanged');
assert.strictEqual(K.textFor('the inbox (I or Ctrl+Shift+A). N or Ctrl+Shift+N', true), 'the inbox (I or ⇧⌘A). N or ⇧⌘N');
assert.strictEqual(K.textFor('Ctrl+K palette, I inbox, N next (?)', true), '⌘K palette, I inbox, N next (?)');
assert.strictEqual(K.textFor('Ctrl+K palette', false), 'Ctrl+K palette');

// ---- FR-083: the menu ----
let settings = 0, repo = 0;
const actions = { openSettings: () => { settings++; }, openRepo: () => { repo++; } };
for (const p of ['win32', 'linux'] as NodeJS.Platform[]) assert.strictEqual(appMenuTemplate(p, actions), null, `${p}: no menu (no Reload, no DevTools)`);
const mac = appMenuTemplate('darwin', actions) as MenuItemConstructorOptions[];
assert.ok(Array.isArray(mac));
assert.deepStrictEqual(mac.map((m) => m.role ?? m.label), ['appMenu', 'editMenu', 'View', 'windowMenu', 'help']);
const flat = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((m) => [m, ...(Array.isArray(m.submenu) ? flat(m.submenu) : [])]);
const all = flat(mac);
const roles = all.map((m) => m.role).filter(Boolean) as string[];
for (const bad of ['reload', 'forceReload', 'toggleDevTools']) assert.ok(!roles.includes(bad), `no ${bad} in the Mac menu`);
const view = mac[2].submenu as MenuItemConstructorOptions[];
assert.deepStrictEqual(view.filter((m) => m.role).map((m) => m.role), ['resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen'], 'View: zoom and full screen only');
const set = all.find((m) => m.label === 'Settings…') as MenuItemConstructorOptions;
assert.ok(set && set.accelerator === SETTINGS_ACCELERATOR && SETTINGS_ACCELERATOR === 'CommandOrControl+,', 'Settings… ⌘,');
assert.ok((mac[0].submenu as MenuItemConstructorOptions[]).includes(set), 'Settings… is in the app menu');
(set.click as () => void)();
const help = all.find((m) => m.label === HELP_LINK_LABEL) as MenuItemConstructorOptions;
(help.click as () => void)();
assert.deepStrictEqual([settings, repo], [1, 1], 'the menu items call their actions');
assert.ok(roles.includes('quit') && roles.includes('about'), 'About and Quit in the app menu');

// ---- FR-085: window ----
assert.ok(hideOnClose('darwin', false) && !hideOnClose('darwin', true), 'Mac: close hides unless quitting');
assert.ok(!hideOnClose('win32', false) && !hideOnClose('linux', false), 'Windows/Linux: close closes');
assert.ok(disposeOnQuit('darwin') && !disposeOnQuit('win32') && !disposeOnQuit('linux'), 'Mac ends the agents in before-quit; the others in window-all-closed');
assert.deepStrictEqual(windowChrome('darwin'), { titleBarStyle: 'hiddenInset' });
assert.deepStrictEqual(windowChrome('linux'), {});
assert.deepStrictEqual(windowChrome('win32'), {});
assert.ok(shouldBounce(0, 1, false, 'darwin') && !shouldBounce(0, 1, true, 'darwin') && !shouldBounce(2, 1, false, 'darwin'), 'Mac: bounce when the count grows in the background');
assert.ok(!shouldBounce(0, 1, false, 'win32') && !shouldBounce(0, 1, false, 'linux'), 'no bounce elsewhere');
assert.ok(!shouldFlash(0, 1, false, 'darwin'), 'no taskbar flash on a Mac (flashFrame bounces until focused there)');

// ---- wiring (static) ----
const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
for (const f of ['Menu.setApplicationMenu(menu ? Menu.buildFromTemplate(menu) : null)', "toRenderer('menu:settings', null)", 'hideOnClose(process.platform, quitting)', 'quitting = true;', "app.dock?.bounce('informational')", '...windowChrome(process.platform)', "toRenderer('window:fullScreen', true)", 'remoteReleased = true;'])
  assert.ok(main.includes(f), `main.ts wires: ${f}`);
assert.ok(/window-all-closed[\s\S]*process\.platform !== 'darwin'\) app\.quit\(\)/.test(main), 'Windows/Linux still quit when the window closes');
const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.ts'), 'utf8');
assert.ok(preload.includes("sub<null>('menu:settings'") && preload.includes('platform: process.platform') && preload.includes("'window:fullScreen'"), 'preload exposes onMenuSettings, onFullScreen and platform');
const sim = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'sim.ts'), 'utf8');
assert.ok(sim.includes('onMenuSettings:') && sim.includes('onFullScreen:'), 'the simulator bridge has the no-ops');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
assert.ok(!/\(e\.ctrlKey\|\|e\.metaKey\)/.test(app), 'app.js no longer takes Ctrl or Command on every platform');
assert.ok(!app.includes('On a Mac, Cmd works where Ctrl is shown'), 'the Mac footnote is gone');
assert.ok(app.includes("real.onMenuSettings(()=>window.DurbarScreens.openSettings())"), 'the menu opens Settings');
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.indexOf('src="keys.js"') > 0 && html.indexOf('src="keys.js"') < html.indexOf('src="app.js"'), 'index.html loads keys.js before app.js');
assert.ok(/'keys\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets.js copies keys.js');
// the Mac title bar rules apply only under html[data-platform="darwin"], so the office geometry on Linux and Windows is unchanged
const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
for (const line of css.split('\n').filter((l) => /app-region|padding-left:78px/.test(l))) assert.ok(line.startsWith('html[data-platform="darwin"]'), `darwin-only: ${line.slice(0, 80)}`);
// an open chat hides the top bar (body.panel-open), so the agent strip is the drag area then, with the same room and no-drag controls
for (const rule of ['html[data-platform="darwin"] :is(.topbar,.strip){-webkit-app-region:drag}', 'html[data-platform="darwin"]:not([data-fullscreen]) :is(.topbar,.strip){padding-left:78px}', 'html[data-platform="darwin"] :is(.topbar,.strip) :is(button,']) assert.ok(css.includes(rule), `the chat strip shares the Mac title bar rule: ${rule.slice(0, 60)}`);
assert.ok(css.includes(':root{color-scheme:light}') && css.includes(':root[data-dark]{color-scheme:dark}'), 'color-scheme follows the theme');

console.log('macos tests passed');
