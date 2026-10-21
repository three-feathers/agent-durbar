/** macOS conventions (spec 052 FR-083..FR-085): the app menu, ⌘ shortcuts and their labels, close-to-hide, Dock bounce. `npm run test:macos`. Runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { MenuItemConstructorOptions } from 'electron';
import { HELP_LINK_LABEL, MENU_APP_NAME, SETTINGS_ACCELERATOR, appMenuTemplate, disposeOnQuit, hideOnClose, windowChrome } from '../src/main/appmenu';
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
assert.strictEqual(mac[0].role, 'appMenu');
assert.strictEqual(mac[0].label, MENU_APP_NAME, 'the app menu title is explicit (spec 008 FR-044)');
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
{
  const appItems = ((mac[0].submenu ?? []) as MenuItemConstructorOptions[]);
  const labelOf = (role: string) => appItems.find((m) => m.role === role)?.label;
  assert.strictEqual(labelOf('about'), 'About Agent Durbar');
  assert.strictEqual(labelOf('hide'), 'Hide Agent Durbar');
  assert.strictEqual(labelOf('quit'), 'Quit Agent Durbar');
}

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
for (const line of css.split('\n').filter((l) => /app-region|padding-left:(max\()?78px/.test(l))) assert.ok(line.startsWith('html[data-platform="darwin"]'), `darwin-only: ${line.slice(0, 80)}`);
// an open chat hides the top bar (body.panel-open), so the agent strip is the drag area then, with the same room and no-drag controls;
// a screen opened over a chat (body.screen-open) also hides the strip, so then the screen's header is; a notice strip shown with a chat open is the first row (FR-138)
const D = 'html[data-platform="darwin"]';
const rules = [
  `${D} :is(.topbar,.strip,body.panel-open .notice-strip,body.panel-open.screen-open .scr-head){-webkit-app-region:drag}`,
  `${D}:not([data-fullscreen]) .strip{padding-left:78px}`,
  `${D}:not([data-fullscreen]) .topbar::before{content:"";flex:none;order:-1;width:58px;margin-right:-14px}`, // room on the first row only
  `@media (max-width:1320px){${D}:not([data-fullscreen]) .topbar::before{width:64px;margin-right:-8px}}`,
  `${D} body.panel-open :is(#restoreStrip:not([hidden]),#restoreStrip[hidden]+#awayStrip:not([hidden])){min-height:40px}`, // the first strip clears the 78x40 box
  `${D}:not([data-fullscreen]) body.panel-open .notice-strip{padding-left:78px}`,
  `${D}:not([data-fullscreen]) body.panel-open.screen-open .scr-head{padding-left:max(78px,calc((100% - 880px)/2 + 24px))}`, // FR-097 alignment kept
  `${D} :is(.topbar,body.panel-open .notice-strip,body.panel-open.screen-open .scr-head) :is(button,a,input,select,textarea,label,summary,[role="button"],[role="menu"],[role="group"],[tabindex],.more-menu){-webkit-app-region:no-drag}`,
  `${D} .strip>:is(button,a,input,select,textarea,label,summary,[role="button"],[role="menu"],[role="group"],[tabindex],.strip-list){-webkit-app-region:no-drag}`,
  `${D} .strip-list *{-webkit-app-region:initial}`,
  `${D} body.panel-open .notice-strip:not([hidden]) ~ .notice-strip{padding-left:20px}`,
  `${D} .notice-strip:not([hidden]) ~ .workspace .strip{padding-left:12px}`,
  `${D} .notice-strip:not([hidden]) ~ #screen .scr-head{padding-left:max(24px,calc((100% - 880px)/2 + 24px))}`,
  `${D} .strip{padding-right:0}`,
  `${D} .strip::after{content:"";flex:none;align-self:stretch;width:32px;`, // the grab handle (grip dots)
  `${D} :is(.dlg-ov,#foldersPop,#floorsPop,#defaultsPop,.mode-menu,.more-menu){-webkit-app-region:no-drag}`,
];
for (const rule of rules) assert.ok(css.includes(rule), `Mac title bar rule (FR-085, FR-138): ${rule.slice(0, 90)}`);
assert.ok(!css.includes('scr-head){padding-left:78px}') && !/\.topbar[^{]*\{padding-left:78px/.test(css), 'no flat 78px on the screen header or the whole top bar');
// the selectors the rules name exist in the page
const screensCss = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.css'), 'utf8');
for (const sel of ['.mode-menu{', '.more-menu{', '#floorsPop{', '#foldersPop{', '#defaultsPop{', '.notice-strip{', '.strip-list{', '.dlg-ov{']) assert.ok(css.includes(sel), `selector exists in styles.css: ${sel}`);
assert.ok(screensCss.includes('.scr-head{'), 'selector exists in screens.css: .scr-head');
for (const id of ['restoreStrip', 'awayStrip', 'foldersPop', 'floorsPop', 'defaultsPop']) assert.ok(html.includes(`id="${id}"`), `index.html has #${id}`);
assert.ok(html.indexOf('id="restoreStrip"') < html.indexOf('class="workspace"') && html.indexOf('id="awayStrip"') < html.indexOf('id="screen"') && html.indexOf('class="workspace"') < html.indexOf('id="screen"'), 'notice strips come before .workspace and #screen (the ~ rules need it)');
assert.ok(css.includes('@keyframes sl-fade') && css.includes('animation-timeline:scroll(self inline)') && /\.strip-list\{animation:sl-fade[^}]*mask-image/.test(css), 'the agent strip fades where it is cut off');
assert.ok(css.includes(':root{color-scheme:light}') && css.includes(':root[data-dark]{color-scheme:dark}'), 'color-scheme follows the theme');

console.log('macos tests passed');
