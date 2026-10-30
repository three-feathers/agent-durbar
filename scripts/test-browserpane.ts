/**
 * Spec 080 T015 (FR-002, FR-006, FR-007, FR-009): the renderer's side of the session browser. `npm run test:browserpane`.
 * Pure helpers of src/renderer/browserpane.js, and the sources that wire it: the tab bar, the page, the script tag, the text sizes. No Electron.
 * The behaviour in the window (tabs, bar, bounds, attach and detach) is `scripts/check-browser-tab.js`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const src = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BP = require(path.join(ROOT, 'src', 'renderer', 'browserpane.js')) as {
  tabKey(key: string, index: number, count: number): number;
  barModel(s: unknown): { open: boolean; address: string; canBack: boolean; canForward: boolean; reload: string; reloadLabel: string; status: { kind: string; word: string } | null; title: string; sound: { on: boolean; word: string; hint: string }; system: boolean; dialogOpen: boolean };
  barModel2?: never;
  boundsOf(r: unknown): { x: number; y: number; width: number; height: number } | null;
  tabsHTML(): string;
  paneHTML(): string;
};

// the tablist's keys (WAI-ARIA): arrows wrap, Home and End, nothing else
assert.strictEqual(BP.tabKey('ArrowRight', 0, 2), 1);
assert.strictEqual(BP.tabKey('ArrowRight', 1, 2), 0, 'wraps');
assert.strictEqual(BP.tabKey('ArrowLeft', 0, 2), 1, 'wraps');
assert.strictEqual(BP.tabKey('ArrowLeft', 1, 2), 0);
assert.strictEqual(BP.tabKey('Home', 1, 2), 0);
assert.strictEqual(BP.tabKey('End', 0, 2), 1);
for (const k of ['Enter', ' ', 'a', 'Escape', 'ArrowDown', 'Tab']) assert.strictEqual(BP.tabKey(k, 0, 2), -1, `${k} is not a tab key`);
assert.strictEqual(BP.tabKey('ArrowRight', 0, 0), -1);

// the bar, by state
const idle = BP.barModel({ id: 's', open: true, url: 'https://example.com/a', title: 'Example', loading: false, canBack: true, canForward: false, muted: true, driver: 'user' });
assert.deepStrictEqual({ a: idle.address, b: idle.canBack, f: idle.canForward, r: idle.reload, st: idle.status, t: idle.title, s: idle.sound.word, sys: idle.system }, { a: 'https://example.com/a', b: true, f: false, r: 'reload', st: null, t: 'Example', s: 'Sound off', sys: true });
const loading = BP.barModel({ id: 's', open: true, url: 'https://example.com/a', title: 'x', loading: true, canBack: false, canForward: false, muted: false, driver: 'user' });
assert.deepStrictEqual({ r: loading.reload, l: loading.reloadLabel, st: loading.status, t: loading.title, s: loading.sound.word }, { r: 'stop', l: 'Stop', st: { kind: 'loading', word: 'Loading…' }, t: '', s: 'Sound on' }, 'Stop while loading; icon kind plus a word');
const failed = BP.barModel({ id: 's', open: true, url: 'https://example.com/a', title: 'x', loading: false, canBack: false, canForward: false, muted: true, driver: 'user', error: 'ERR_CONNECTION_REFUSED' });
assert.ok(failed.status && failed.status.kind === 'error' && /ERR_CONNECTION_REFUSED/.test(failed.status.word) && failed.title === '', 'an error shows as icon plus word');
assert.strictEqual(BP.barModel({ id: 's', open: false }).status?.kind, 'closed', 'a closed browser says so');
assert.strictEqual(BP.barModel({ id: 's', open: false, connecting: true }).status, null, 'while the view is being made it says nothing');
assert.strictEqual(BP.barModel({ id: 's', open: false, failed: 'The browser could not start.' }).status?.word, 'The browser could not start.');
for (const url of ['', 'file:///etc/passwd', 'durbar-sim://pages/form', 'about:blank']) assert.strictEqual(BP.barModel({ id: 's', open: true, url }).system, false, `no system-browser button for "${url}"`);
for (const bad of [null, undefined, 5, 'x', {}]) assert.doesNotThrow(() => BP.barModel(bad), 'a malformed state never throws');
assert.strictEqual(BP.barModel({ open: true, url: 5 }).address, '', 'a non-string address is not shown');

// FR-025d: the note of a dialog main closed for the agent (icon plus word), and the Dialog open marker
const noted = BP.barModel({ id: 's', open: true, url: 'https://a.com/', title: 't', loading: false, canBack: false, canForward: false, muted: true, driver: 'agent', dialogOpen: false, note: 'The page showed a dialog: "Delete?"' });
assert.deepStrictEqual(noted.status, { kind: 'dialog', word: 'The page showed a dialog: "Delete?"' }, 'the bar shows the dialog note');
assert.strictEqual(BP.barModel({ id: 's', open: true, dialogOpen: true } as never).dialogOpen, true);
assert.strictEqual(BP.barModel({ id: 's', open: true, dialogOpen: 'yes' } as never).dialogOpen, false, 'only a real true is a marker');
assert.strictEqual(BP.barModel({ id: 's', open: true, loading: true, note: 'x' } as never).status?.kind, 'loading', 'loading and errors come before the note');

// bounds
assert.deepStrictEqual(BP.boundsOf({ left: 10.4, top: 99.6, width: 600.4, height: 300.5 }), { x: 10, y: 100, width: 600, height: 301 });
for (const bad of [null, undefined, { left: 0, top: 0, width: 0, height: 10 }, { left: 0, top: 0, width: 10, height: 0.2 }, { left: NaN, top: 0, width: 10, height: 10 }]) assert.strictEqual(BP.boundsOf(bad), null);

// the markup: a tablist with two tabs, a tabpanel, the bar's controls with names
const tabs = BP.tabsHTML();
assert.ok(/role="tablist"/.test(tabs) && (tabs.match(/role="tab"/g) ?? []).length === 2, 'a tablist with two tabs');
assert.ok(/id="tabChat"[^>]*aria-selected="true"[^>]*tabindex="0"/.test(tabs) && /id="tabBrowser"[^>]*aria-selected="false"[^>]*tabindex="-1"/.test(tabs), 'Chat is the default and the roving tabindex starts there');
assert.ok(/aria-controls="chat"/.test(tabs) && /aria-controls="browserPane"/.test(tabs));
const pane = BP.paneHTML();
assert.ok(/id="browserPane" role="tabpanel" aria-labelledby="tabBrowser" hidden/.test(pane), 'the pane is a hidden tabpanel until the Browser tab is chosen');
for (const id of ['bBack', 'bFwd', 'bReload']) assert.ok(new RegExp(`id="${id}"[^>]*aria-label="[A-Z]`).test(pane), `${id} has a name`);
assert.ok(/id="bAddr"[^>]*aria-label="Address"/.test(pane) && /<span>Open in system browser<\/span>/.test(pane), 'the address field and Open in system browser');
assert.ok(/id="bNote" role="status" aria-live="polite"/.test(pane), 'loading and error are announced');
assert.ok(!/<img|<iframe|<webview|<script/i.test(pane + tabs), 'the page area is a native view: no frame in the window');

// the wiring in app.js, index.html, copy-assets
const app = src('src/renderer/app.js');
assert.ok(/BP\.available\(a\)\?BP\.tabsHTML\(\):''/.test(app) && /BP\.available\(a\)\?BP\.paneHTML\(\):''/.test(app), 'openPanel writes the tabs and the pane only for a live top-level session');
assert.ok(/BP\.mount\(a\);/.test(app), 'openPanel wires them');
assert.ok(/function closePanel\(\)\{closeSlash\(\);keepDraft\(\);\n\s*BP\.hide\(\);/.test(app), 'closing the panel takes the view off (FR-009)');
assert.ok(/BP\.init\(\{ bridge: window\.agentDurbar,/.test(app), 'the pane talks to the real preload API, never the simulator\'s stand-in');
// T016 (FR-008): one overlayOpen/overlayClose helper; the observer finds the shared menu, askDialog, toasts, the slash list and popovers
assert.ok(/function overlayOpen\(key\)\{OVERLAYS\.add\(key\);BP\.overlay\(true\);\}/.test(app) && /function overlayClose\(key\)\{OVERLAYS\.delete\(key\);if\(!OVERLAYS\.size\)BP\.overlay\(false\);\}/.test(app), 'one overlayOpen / overlayClose pair');
const sel = /const OVERLAY_SEL='([^']+)'/.exec(app)?.[1] ?? '';
for (const needle of ['.dlg-ov', '[role="menu"]', '.mode-menu', '.more-menu', '#toasts .toast', '[role="listbox"]']) assert.ok(sel.includes(needle), `overlays include ${needle}`);
assert.ok(/overlay\(on\)/.test(src('src/renderer/browserpane.js')) && /bridge\.browserSnapshot\(id\)/.test(src('src/renderer/browserpane.js')) && /bridge\.browserOverlay\(id,true\)/.test(src('src/renderer/browserpane.js')), 'the pane takes a still picture, then hides the view');
// FR-025d (Q2), FR-025e, FR-025d (Q3): consent, Leave and the hidden dialog, all through the shared askDialog and toast
const pane2 = src('src/renderer/browserpane.js');
assert.ok(/Chat links will open there once that is built; for now you type an address yourself\./.test(pane2) && !/Links the agent prints/.test(pane2), 'the note says only what is true now about chat links');
assert.ok(/Nothing loads unless you open a Browser tab\./.test(pane2), 'the note says when the browser loads anything');
assert.ok(/r\.needsConsent/.test(pane2) && /Not now/.test(pane2) && /Open the browser/.test(pane2) && /browserConsentAccept/.test(pane2), 'the consent: Not now / Open the browser, remembered through main');
assert.ok(/title:'Leave this page\?'/.test(pane2) && /Leave, then click again\./.test(pane2) && /label:'Stay',value:null/.test(pane2) && /cls:'primary warn'/.test(pane2), 'the Leave box: Stay is the cancel (focused first), Leave is the warn choice');
assert.ok(/browserLeaveAnswer\(a\.req,!!\(r&&r\.value==='leave'\)\)/.test(pane2), 'the answer goes to main; Esc and Stay are not Leave');
assert.ok(/if\(d\.shown\)return;[^\n]*\n\s*if\(host\.say\)host\.say\(d\);/.test(pane2), 'a shown view raises no toast: only a hidden one does');
assert.ok(/'A page in <b>'\+esc\(a\?a\.name:'a session'\)\+'<\/b> is asking: <span class="pagetext">\\u201c'\+esc\(d\.text\)\+'\\u201d<\/span>/.test(app), 'the toast escapes the session name and the page text');
assert.ok(/function clearCover\(c\)/.test(pane2) && /clearCover\(cur\);\s*if\(cur\.shown\)\{cur\.shown=false;bridge\.browserVisible\(id,false\);\}/.test(pane2) && /clearCover\(cur\);\s*if\(cur\.shown&&bridge\)bridge\.browserVisible/.test(pane2), 'leaving the Browser tab or the panel clears the cover');
assert.ok(!/if\(!cur\|\|cur\.tab!=='browser'\)return;/.test(pane2.slice(pane2.indexOf('async function overlay'))), 'overlay(false) does not stop at a non-browser tab');
assert.ok(/cur\.covered=!!\(host\.covers&&host\.covers\(\)\);\s*await bridge\.browserOverlay\(id,cur\.covered\)[\s\S]*?bridge\.browserVisible\(id,true\)/.test(pane2), 'an attach starts uncovered or, under an open overlay, stays off: main\'s flag is set before the view is attached');
assert.ok(/function overlaySync\(\)\{const c=coversBrowser\(BP\.paneRect\(\)\)/.test(app), 'the overlay test also sees an overlay open while the attach is in flight');
assert.ok(/else if\(OVERLAYS\.has\('dom'\)\|\|BP\.covered\(\)\)overlayClose\('dom'\)/.test(app), 'overlaySync also lifts a cover the pane still holds');
assert.ok(/new MutationObserver\(\(\)=>\{if\(q\)return;/.test(app), 'the overlay observer also runs while no Browser tab shows');
assert.ok(/PULLED\.has\(id\)\)return;\s*PULLED\.add\(id\)/.test(app) && /if\(!pulling\)PULLED\.delete\(id\)/.test(app), 'a hidden dialog brings a chat forward once, until the user opens it');
assert.ok(/A page in <b>/.test(app) && /dialogHTML\(x\)/.test(app), 'the toast names the session; the marker is on the strip item and the desks');
const html = src('src/renderer/index.html');
assert.ok(html.indexOf('browserpane.js') > 0 && html.indexOf('browserpane.js') < html.indexOf('src="app.js"'), 'browserpane.js loads before app.js');
assert.ok(/'browserpane\.js'/.test(src('scripts/copy-assets.js')), 'browserpane.js is copied to dist');

// text size (FR-006) and tokens: every rule this feature added uses the type tokens, none a size under 10.5px, no colour literal
const css = src('src/renderer/styles.css');
const block = css.slice(css.indexOf('/* spec 080 T015'), css.indexOf('@keyframes bspin') + 160);
assert.ok(block.length > 800, 'the feature\'s CSS block is found');
for (const m of block.matchAll(/font-size:\s*([^;}]+)/g)) {
  const v = m[1].trim();
  if (/^\d+(\.\d+)?px$/.test(v)) assert.ok(parseFloat(v) >= 10.5, `font-size ${v} is at least 10.5px`);
  else assert.ok(/^var\(--t[1-5]-size\)$/.test(v), `font-size ${v} is a type token`);
}
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(block) && !/rgba?\(/i.test(block), 'theme tokens only: no colour literal');
assert.ok(/prefers-reduced-motion:reduce\)\{\.bspin\{animation:none\}/.test(block), 'the spinner stops under prefers-reduced-motion (FR-006)');
assert.ok(/\.panel-in\.on-browser #chat\{[^}]*visibility:hidden/.test(block), 'the chat is out of the way, not unmounted, on the Browser tab (its scroll position stays)');
// the overlay closes while the attach is still in flight (the pane is not shown yet): the cover is still known and can be lifted
(async () => {
  const made: Record<string, unknown> = {};
  const rect = { left: 0, top: 0, width: 500, height: 300, right: 500, bottom: 300 };
  const el = (id: string): unknown => {
    if (made[id]) return made[id];
    const store: Record<string, unknown> = { dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, getBoundingClientRect: () => rect, appendChild() {}, remove() {}, focus() {}, setAttribute() {}, querySelector: () => el('q'), querySelectorAll: () => [] };
    return (made[id] = new Proxy(store, { get: (t, k) => (k in t ? t[k as string] : undefined), set: (t, k, v) => ((t[k as string] = v), true) }));
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { getElementById: (id: string) => el(id), querySelector: () => el('panelIn'), createElement: () => el('new'), activeElement: null };
  g.window = {};
  g.requestAnimationFrame = (cb: () => void) => setImmediate(cb);
  const calls: string[] = [];
  let covers = true;
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const bridge = {
    browserOpen: async () => ({ ok: true, state: { id: 'a', open: true, url: '', title: '', loading: false, canBack: false, canForward: false, muted: true, driver: 'user', dialogOpen: false } }),
    browserBounds: async () => ({ ok: true }),
    browserOverlay: async (_id: string, on: boolean) => { calls.push('overlay ' + on); if (on) await hold; return { ok: true }; },
    browserVisible: async (_id: string, v: boolean) => { calls.push('visible ' + v); return { ok: true }; },
    browserSnapshot: async () => ({ ok: false }),
  };
  const P = BP as unknown as { init(o: unknown): void; mount(a: unknown): void; select(t: string): Promise<void>; overlay(on: boolean): Promise<void>; covered(): boolean; current(): { shown: boolean } | null; available(a: unknown): boolean };
  P.init({ bridge, covers: () => covers, recheck: () => undefined, ask: async () => null });
  P.mount({ id: 'a', live: true });
  const sel = P.select('browser');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(P.covered(), true, 'a chat attached under an open overlay starts covered');
  assert.strictEqual(P.current()?.shown, false, 'and is not shown yet: the attach IPCs are in flight');
  covers = false;
  await P.overlay(false); // what overlaySync does when the overlay closes now
  assert.strictEqual(P.covered(), false, 'the cover is lifted although the pane was not shown');
  assert.ok(calls.includes('overlay false'), 'main is told');
  release();
  await sel;
  assert.deepStrictEqual(calls.slice(-1), ['visible true'], 'the view is attached last, after the flag was cleared');
  console.log('browser pane (cover during attach) ok');
  // FR-030/031: where a click goes, including a parent that is gone (2026-10-30 security review)
  {
    const R = (BP as unknown as { linkRoute(web: boolean, mod: boolean, setting: string, avail: boolean): string }).linkRoute;
    assert.strictEqual(R(true, false, 'session', true), 'tab', 'a plain web click opens the session browser');
    assert.strictEqual(R(true, true, 'session', true), 'system', 'Ctrl/Cmd+click: the system browser');
    assert.strictEqual(R(true, false, 'system', true), 'system', 'the System setting');
    assert.strictEqual(R(false, false, 'system', true), 'tab', 'the setting never changes how a non-web link is classified (main does)');
    assert.strictEqual(R(false, true, 'session', true), 'tab', 'a modifier does not send a non-web link to the system');
    assert.strictEqual(R(true, false, 'session', false), 'system', 'no live root (the demo, an ended or removed parent): a web link goes to the system browser, not nowhere');
    assert.strictEqual(R(false, false, 'session', false), 'refuse', 'and a non-web link is refused with the static text');
    const app2 = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
    assert.ok(/root=a&&liveRoot\(a\)[^\n]*\n[^\n]*\n\s*const route=BP\.linkRoute\(web,mod,CHAT_LINKS,!!root&&BP\.available\(root\)\)/.test(app2), "the click uses the chat's root session (a helper's parent), never the clicked chat's own id");
    assert.ok(/BP\.openLink\(root\.id,u\)/.test(app2), 'and asks main for the root id');
  }
})().then(() => console.log('browser pane tests passed'), (e) => { console.error(e); process.exit(1); });
