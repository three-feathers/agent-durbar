/**
 * Spec 080 T012/T013: the session browser view's hardening builders (FR-010, FR-020, FR-024..FR-028) and the soft cap picker (FR-011).
 * `npm run test:browserviews`. Pure: no Electron, no network, no credits.
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import {
  buildViewHandlers, installViewHandlers, newViewPartition, VIEW_PARTITION_RE, VIEW_SESSION_EVENTS, VIEW_WEBCONTENTS_EVENTS,
  LEAVE_APPROVAL_MS, LeaveApproval, navigateChecked, viewDialogPolicy, viewUserAgent, viewWebPreferences, type ViewHandlers,
} from '../src/main/hardening';
import { MAX_LIVE_VIEWS, pickUnload, safeToUnload, type CapView } from '../src/main/browser/viewcap';

// ---- AC1: webPreferences are exactly FR-010's ----
const prefs = viewWebPreferences({ partition: 'durbar-browser-' + 'a'.repeat(32), packaged: false });
for (const k of ['sandbox', 'contextIsolation', 'webSecurity', 'safeDialogs']) assert.strictEqual(prefs[k], true, k);
for (const k of ['nodeIntegration', 'webviewTag', 'allowRunningInsecureContent', 'experimentalFeatures', 'navigateOnDragDrop', 'spellcheck']) assert.strictEqual(prefs[k], false, k);
assert.strictEqual(prefs.autoplayPolicy, 'user-gesture-required');
assert.ok(!('disableDialogs' in prefs), 'owner decision 2026-10-24: dialogs are not disabled');
assert.ok(!('backgroundThrottling' in prefs), 'no throttling key: Electron default, the run-time toggle is Phase 2');
assert.ok(!('preload' in prefs), 'no preload');
assert.strictEqual(prefs.devTools, true, 'unpackaged');
assert.strictEqual(viewWebPreferences({ partition: 'x', packaged: true }).devTools, false, 'devTools off when packaged');
assert.deepStrictEqual(Object.keys(prefs).sort(), ['allowRunningInsecureContent', 'autoplayPolicy', 'contextIsolation', 'devTools', 'experimentalFeatures', 'navigateOnDragDrop', 'nodeIntegration', 'partition', 'safeDialogs', 'sandbox', 'spellcheck', 'webSecurity', 'webviewTag'], 'no stray key');

// ---- AC2: partition names ----
const seen = new Set<string>();
for (let i = 0; i < 200; i++) {
  const n = newViewPartition();
  assert.ok(VIEW_PARTITION_RE.test(n), n);
  assert.ok(!n.startsWith('persist:'));
  assert.ok(!seen.has(n), 'never reused');
  seen.add(n);
}
{
  const used = new Set<string>();
  const seq = ['0'.repeat(32), '0'.repeat(32), '1'.repeat(32)];
  const next = (): string => seq.shift() as string;
  assert.strictEqual(newViewPartition(next, used), 'durbar-browser-' + '0'.repeat(32));
  assert.strictEqual(newViewPartition(next, used), 'durbar-browser-' + '1'.repeat(32), 'a repeated name is skipped');
  assert.throws(() => newViewPartition(() => 'zz', new Set()), 'a malformed name is refused (never persist:)');
  assert.throws(() => newViewPartition(() => 'persist:' + 'a'.repeat(24), new Set()));
}

// ---- AC5: user agent ----
const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) agent-durbar/1.2.3 Chrome/152.0.7977.167 Electron/44.8.0 Safari/537.36';
for (const platform of ['linux', 'win32', 'darwin'] as const) {
  for (const ua of [viewUserAgent(DEFAULT_UA, '152.0.7977.167', platform), viewUserAgent('Mozilla/5.0 Electron/1 agent-durbar/2', '152.0.7977.167', platform), viewUserAgent('', '152.0.7977.167', platform)]) {
    assert.ok(!/electron|durbar/i.test(ua), ua);
    assert.ok(/Chrome\/\d+/.test(ua), ua);
    assert.ok(ua.startsWith('Mozilla/5.0 ('), ua);
  }
}
assert.strictEqual(viewUserAgent(DEFAULT_UA, '152.0.7977.167', 'linux'), 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.167 Safari/537.36');
assert.ok(viewUserAgent('', '152.0.1', 'win32').includes('Windows NT 10.0'));

// ---- AC3/AC4: the handler list refuses, and installViewHandlers puts every one on ----
const loaded: string[] = [];
const popups: string[] = [];
const h = buildViewHandlers({ sim: false, currentUrl: () => 'https://example.com/page', loadInView: (u) => loaded.push(u), onPopupBlocked: (u) => popups.push(u) });
const ev = (): { prevented: number; preventDefault(): void } => ({ prevented: 0, preventDefault() { this.prevented++; } });

assert.deepStrictEqual(h.windowOpen({ url: 'https://example.com/a', disposition: 'foreground-tab', referrer: { url: 'https://example.com/page' } }), { action: 'deny' });
assert.deepStrictEqual(loaded, ['https://example.com/a'], 'a _blank link loads in the same view');
assert.deepStrictEqual(h.windowOpen({ url: 'https://example.com/b', disposition: 'new-window' }), { action: 'deny' });
assert.deepStrictEqual(h.windowOpen({ url: 'file:///etc/passwd', disposition: 'foreground-tab' }), { action: 'deny' });
assert.deepStrictEqual(h.windowOpen({ url: 'javascript:alert(1)', disposition: 'background-tab' }), { action: 'deny' });
assert.deepStrictEqual(loaded, ['https://example.com/a'], 'a popup or a refused scheme never loads');
assert.deepStrictEqual(popups, ['https://example.com/b'], 'only http(s) popups are reported (an Open offer); refused schemes are dropped');
// a same-origin popup with features (new-window) is not a tab: offered, never loaded in the view (review of PR #696)
{
  const l2: string[] = [], p2: string[] = [];
  const h2 = buildViewHandlers({ sim: false, currentUrl: () => 'https://example.com/page', loadInView: (u) => l2.push(u), onPopupBlocked: (u) => p2.push(u) });
  assert.deepStrictEqual(h2.windowOpen({ url: 'https://example.com/c', disposition: 'new-window', referrer: { url: 'https://example.com/page' } }), { action: 'deny' });
  assert.deepStrictEqual(l2, [], 'a same-origin new-window popup does not load in the view');
  assert.deepStrictEqual(p2, ['https://example.com/c'], 'a same-origin new-window popup is offered');
}
// framebusting: only the view's own top-level origin may load a tab popup in the view
{
  const before = loaded.length;
  const open = (referrer: { url?: string } | null | undefined, url = 'https://evil.test/x', cur?: string): void => {
    const hh = buildViewHandlers({ currentUrl: () => cur ?? 'https://example.com/page', loadInView: (u) => loaded.push(u), onPopupBlocked: (u) => popups.push(u) });
    hh.windowOpen({ url, disposition: 'foreground-tab', referrer });
  };
  const p0 = popups.length;
  open({ url: 'http://localhost:1/frame' }, 'http://localhost:1/evil', 'http://127.0.0.1:1/top'); // a cross-origin iframe
  open({ url: 'https://example.com:8443/page' });  // same host, other port
  open({ url: 'http://example.com/page' });         // same host, other scheme
  open({ url: '' }); open({}); open(null); open(undefined); // empty referrer fails closed
  open({ url: 'about:blank' }); open({ url: 'not a url' }); open({ url: 'https://example.com/page' }, 'https://evil.test/x', 'about:blank');
  assert.strictEqual(loaded.length, before, 'a cross-origin, empty or opaque referrer never loads in the view');
  assert.strictEqual(popups.length - p0, 10, 'each becomes an Open in system browser offer');
  popups.length = p0;
  open({ url: 'https://example.com/other?x=1#y' }, 'https://example.com/next');
  assert.strictEqual(loaded.length, before + 1, 'a same-origin opener loads (a top-level scripted open with no gesture too: FR-026 will say same-origin loads)');
  assert.strictEqual(loaded[loaded.length - 1], 'https://example.com/next');
  loaded.pop();
}
// the OAuth pattern: window.open('') / about:blank must not wipe the user's page
for (const url of ['', 'about:blank', 'about:srcdoc', 'data:text/html,x', 'blob:https://a.com/x', 'ms-msdt:/id x', 'search-ms:q=x']) {
  for (const disposition of ['foreground-tab', 'background-tab', 'new-window']) h.windowOpen({ url, disposition });
}
assert.deepStrictEqual(loaded, ['https://example.com/a'], 'nothing but http(s) loads in the view');
assert.deepStrictEqual(popups, ['https://example.com/b'], 'about:blank and empty are blocked popups with no offer');

// spec 080 FR-125 (T023 AC4): in a user tab a same-origin tab request opens a NEW tab through main; the window open is still denied
{
  const tabs: [string, boolean][] = [], inView: string[] = [], offers: string[] = [];
  let room = true;
  const ht = buildViewHandlers({ sim: false, currentUrl: () => 'https://example.com/page', loadInView: (u) => inView.push(u), onPopupBlocked: (u) => offers.push(u), openTab: (u, fg) => (tabs.push([u, fg]), room) });
  assert.deepStrictEqual(ht.windowOpen({ url: 'https://example.com/a', disposition: 'foreground-tab', referrer: { url: 'https://example.com/page' } }), { action: 'deny' }, 'still deny: Durbar makes the tab itself');
  assert.deepStrictEqual(ht.windowOpen({ url: 'https://example.com/b', disposition: 'background-tab', referrer: { url: 'https://example.com/x' } }), { action: 'deny' });
  assert.deepStrictEqual(tabs, [['https://example.com/a', true], ['https://example.com/b', false]], 'foreground and background tabs');
  assert.deepStrictEqual(inView, [], 'a user tab never loads it in place');
  for (const [d, why] of [[{ url: 'https://evil.test/x', disposition: 'foreground-tab', referrer: { url: 'https://evil.test/frame' } }, 'cross-origin frame'], [{ url: 'https://example.com/c', disposition: 'foreground-tab', referrer: { url: '' } }, 'empty referrer'], [{ url: 'https://example.com/c', disposition: 'foreground-tab' }, 'no referrer'], [{ url: 'https://example.com/c', disposition: 'new-window', referrer: { url: 'https://example.com/page' } }, 'a popup with features']] as const) {
    const n = tabs.length;
    assert.deepStrictEqual(ht.windowOpen(d as never), { action: 'deny' });
    assert.strictEqual(tabs.length, n, `${why}: no tab`);
  }
  assert.strictEqual(offers.length, 4, 'each of those is offered for the system browser');
  room = false;
  ht.windowOpen({ url: 'https://example.com/full', disposition: 'foreground-tab', referrer: { url: 'https://example.com/page' } });
  assert.strictEqual(offers[offers.length - 1], 'https://example.com/full', 'refused by main (the limits): offered instead');
  // the T011 hostile list: zero tabs and zero offers (nothing reaches shell.openExternal)
  const t0 = tabs.length, o0 = offers.length;
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'ms-msdt:/id PCWDiagnostic', 'search-ms:query=x', 'search:query=x', 'ms-officecmd:x', 'ms-settings:privacy', 'smb://host/share', 'vscode://x', 'slack://open', 'tel:123', 'MS-MSDT:/id', ' ms-msdt:/id', 'mailto:a@b.c', 'about:blank', '', 'data:text/html,x', 'blob:https://example.com/x', 'durbar-sim://pages/index']) {
    for (const disposition of ['foreground-tab', 'background-tab', 'new-window']) ht.windowOpen({ url, disposition, referrer: { url: 'https://example.com/page' } });
  }
  assert.strictEqual(tabs.length, t0, 'zero tabs for a hostile scheme');
  assert.strictEqual(offers.length, o0, 'zero offers (no shell.openExternal path) for a hostile scheme');
  // the simulator's pages open tabs only under the simulator, and only from the same test host
  const st: string[] = [];
  const hs = buildViewHandlers({ sim: true, currentUrl: () => 'durbar-sim://pages/links', loadInView: () => undefined, onPopupBlocked: () => undefined, openTab: (u) => (st.push(u), true) });
  hs.windowOpen({ url: 'durbar-sim://pages/index', disposition: 'foreground-tab', referrer: { url: 'durbar-sim://pages/links' } });
  hs.windowOpen({ url: 'durbar-sim://other/landing', disposition: 'foreground-tab', referrer: { url: 'durbar-sim://other/x' } });
  hs.windowOpen({ url: 'durbar-sim://pages/index', disposition: 'foreground-tab', referrer: { url: 'durbar-sim://user@pages/links' } });
  assert.deepStrictEqual(st, ['durbar-sim://pages/index'], 'same test host only');
  const off: string[] = [];
  buildViewHandlers({ sim: false, currentUrl: () => 'durbar-sim://pages/links', loadInView: () => undefined, onPopupBlocked: () => undefined, openTab: (u) => (off.push(u), true) }).windowOpen({ url: 'durbar-sim://pages/index', disposition: 'foreground-tab', referrer: { url: 'durbar-sim://pages/links' } });
  assert.deepStrictEqual(off, [], 'never without the simulator');
}
for (const [url, isMainFrame, ok] of [['https://a.com/', true, true], ['file:///etc/passwd', true, false], ['file:///x', false, false], ['data:text/html,x', true, false], ['data:text/html,x', false, true], ['chrome://gpu', true, false], ['durbar-sim://x', true, false]] as const) {
  const e = ev();
  h.navigate({ url, isMainFrame, preventDefault: () => e.preventDefault() });
  assert.strictEqual(e.prevented, ok ? 0 : 1, `${url} main=${isMainFrame}`);
}
{
  const sim = buildViewHandlers({ sim: true, loadInView: () => undefined, onPopupBlocked: () => undefined });
  const e = ev();
  sim.navigate({ url: 'durbar-sim://x', isMainFrame: true, preventDefault: () => e.preventDefault() });
  assert.strictEqual(e.prevented, 0, 'the simulator scheme only under sim');
}

let granted: boolean | undefined;
for (const p of ['fullscreen', 'media', 'geolocation', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'openExternal', 'unknown']) {
  h.permissionRequest({}, p, (g) => (granted = g));
  assert.strictEqual(granted, false, p);
}
assert.strictEqual(h.permissionCheck(), false);
assert.strictEqual(h.devicePermission(), false);
let streams: unknown = 'unset';
h.displayMedia({}, (s) => (streams = s));
assert.strictEqual(streams, null, 'display media denied');

{
  let ok: boolean | undefined;
  const e = ev();
  h.certificateError(e, 'https://x', 'ERR', {}, (v) => (ok = v));
  assert.strictEqual(ok, false);
  let calls: unknown[][] = [];
  const spy = (): ((...a: unknown[]) => void) => (...a) => void calls.push(a);
  const cases: [string, (e: ReturnType<typeof ev>) => void, unknown[]][] = [
    ['client certificate', (x) => h.selectClientCertificate(x, 'https://x', [{}], spy() as never), []],
    ['bluetooth', (x) => h.selectBluetooth(x, [{ deviceId: 'a' }], spy() as never), ['']],
    ['hid', (x) => h.selectHid(x, {}, spy() as never), []],
    ['serial', (x) => h.selectSerial(x, [{ portId: 'a' }], {}, spy() as never), ['']],
    ['usb', (x) => h.selectUsb(x, {}, spy() as never), []],
    ['login', (x) => h.login(x, {}, {}, spy() as never), []],
  ];
  for (const [name, run, args] of cases) {
    calls = [];
    const x = ev();
    run(x);
    assert.strictEqual(x.prevented, 1, `${name}: preventDefault`);
    assert.deepStrictEqual(calls, [args], `${name}: callback with no choice`);
  }
  const u = ev();
  h.willPreventUnload(u);
  assert.strictEqual(u.prevented, 1, 'will-prevent-unload is ignored');
}

// installViewHandlers: every event has a handler, and firing it refuses
{
  const wc = Object.assign(new EventEmitter(), { openHandler: undefined as unknown, setWindowOpenHandler(f: unknown) { this.openHandler = f; } });
  const ses = Object.assign(new EventEmitter(), {
    set: {} as Record<string, unknown>,
    setPermissionRequestHandler(f: unknown) { this.set.req = f; },
    setPermissionCheckHandler(f: unknown) { this.set.check = f; },
    setDevicePermissionHandler(f: unknown) { this.set.device = f; },
    setDisplayMediaRequestHandler(f: unknown) { this.set.media = f; },
  });
  installViewHandlers(wc as never, ses as never, h);
  assert.strictEqual(typeof wc.openHandler, 'function');
  assert.deepStrictEqual(Object.keys(ses.set).sort(), ['check', 'device', 'media', 'req']);
  for (const [k, f] of Object.entries(ses.set)) assert.strictEqual(typeof f, 'function', k);
  for (const name of VIEW_WEBCONTENTS_EVENTS) assert.strictEqual(wc.listenerCount(name), 1, `webContents ${name}`);
  for (const name of VIEW_SESSION_EVENTS) assert.strictEqual(ses.listenerCount(name), 1, `session ${name}`);
  // through the real emitters
  const nav = { url: 'file:///etc/passwd', isMainFrame: true, prevented: false, preventDefault() { this.prevented = true; } };
  for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    nav.prevented = false;
    wc.emit(name, nav);
    assert.ok(nav.prevented, name + ' refuses file:');
  }
  const e1 = ev(); let cert: unknown = 'unset';
  ses.emit('select-usb-device', e1, {}, (id?: string) => (cert = id));
  assert.strictEqual(e1.prevented, 1);
  assert.strictEqual(cert, undefined);
  const e2 = ev(); let bt: unknown = 'unset';
  wc.emit('select-bluetooth-device', e2, [], (id: string) => (bt = id));
  assert.strictEqual(bt, '');
  const e3 = ev(); wc.emit('will-prevent-unload', e3); assert.strictEqual(e3.prevented, 1);
  const e4 = ev(); let la = 'unset'; wc.emit('login', e4, {}, {}, (u?: string) => (la = String(u))); assert.strictEqual(la, 'undefined'); assert.strictEqual(e4.prevented, 1);
  let ce: boolean | undefined; wc.emit('certificate-error', ev(), 'https://x', 'e', {}, (v: boolean) => (ce = v)); assert.strictEqual(ce, false);
  const e5 = ev(); wc.emit('select-client-certificate', e5, 'https://x', [], () => undefined); assert.strictEqual(e5.prevented, 1);
  const e6 = ev(); ses.emit('select-hid-device', e6, {}, () => undefined); assert.strictEqual(e6.prevented, 1);
  const e8 = ev(); ses.emit('will-download', e8, { cancel() {} }); assert.strictEqual(e8.prevented, 1, 'every download is cancelled');
  const e7 = ev(); ses.emit('select-serial-port', e7, [], {}, () => undefined); assert.strictEqual(e7.prevented, 1);
  let g: boolean | undefined; (ses.set.req as ViewHandlers['permissionRequest'])({}, 'fullscreen', (v) => (g = v)); assert.strictEqual(g, false);
}

// ---- FR-025e: beforeunload. The agent's calls are never blocked; user or none: no preventDefault, Durbar's box, one-shot Leave ----
{
  let now = 1000;
  const flag = new LeaveApproval(() => now);
  assert.strictEqual(flag.consume(), false, 'not armed');
  flag.arm();
  assert.strictEqual(flag.consume(), true, 'armed: passes once');
  assert.strictEqual(flag.consume(), false, 'one shot');
  flag.arm();
  now += LEAVE_APPROVAL_MS;
  assert.strictEqual(flag.consume(), true, 'still valid at 10 s');
  flag.arm();
  now += LEAVE_APPROVAL_MS + 1;
  assert.strictEqual(flag.consume(), false, 'expired after 10 s');
  assert.strictEqual(LEAVE_APPROVAL_MS, 10000);
}
(async () => {
  const mkCtx = (driver: 'user' | 'agent' | 'none', answer: boolean | 'reject', log: string[], flag = new LeaveApproval()) =>
    buildViewHandlers({
      loadInView: () => undefined, onPopupBlocked: () => undefined, driver: () => driver, leave: flag,
      askLeave: async () => { log.push('ask'); if (answer === 'reject') throw new Error('x'); return answer; },
      onLeaveAnswer: (l) => void log.push('answer ' + l),
    });
  const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
  // the agent: preventDefault at once, no box
  { const log: string[] = []; const e = ev(); mkCtx('agent', false, log).willPreventUnload(e); await tick(); assert.strictEqual(e.prevented, 1); assert.deepStrictEqual(log, []); }
  // user, Stay: no preventDefault (the navigation is cancelled), asked once, nothing repeated, flag not armed
  for (const driver of ['user', 'none'] as const) {
    const log: string[] = []; const flag = new LeaveApproval(); const hh = mkCtx(driver, false, log, flag);
    const e = ev(); hh.willPreventUnload(e); await tick();
    assert.strictEqual(e.prevented, 0, driver + ' Stay: no preventDefault'); assert.deepStrictEqual(log, ['ask', 'answer false']);
    assert.strictEqual(flag.consume(), false, 'Stay arms nothing');
  }
  // user, Leave: still no preventDefault on this event; the flag is armed and the navigation repeated; the next event passes once
  {
    const log: string[] = []; const flag = new LeaveApproval(); const hh = mkCtx('user', true, log, flag);
    const e1 = ev(); hh.willPreventUnload(e1); await tick();
    assert.strictEqual(e1.prevented, 0); assert.deepStrictEqual(log, ['ask', 'answer true']);
    const e2 = ev(); hh.willPreventUnload(e2); await tick();
    assert.strictEqual(e2.prevented, 1, 'with the flag set the unload passes'); assert.deepStrictEqual(log, ['ask', 'answer true'], 'no second box');
    const e3 = ev(); hh.willPreventUnload(e3); await tick();
    assert.strictEqual(e3.prevented, 0, 'one shot: the third asks again'); assert.deepStrictEqual(log, ['ask', 'answer true', 'ask', 'answer true']);
  }
  // a box that fails: Stay
  { const log: string[] = []; const e = ev(); mkCtx('user', 'reject', log).willPreventUnload(e); await tick(); assert.strictEqual(e.prevented, 0); assert.deepStrictEqual(log, ['ask', 'answer false']); }
  // no UI yet (T015): the view leaves instead of getting stuck
  { const e = ev(); buildViewHandlers({ loadInView: () => undefined, onPopupBlocked: () => undefined, driver: () => 'user' }).willPreventUnload(e); assert.strictEqual(e.prevented, 1); }
})().catch((e) => { console.error(e); process.exit(1); });

// ---- Paco (PR 682) a: navigations main starts itself go through one checked helper ----
(async () => {
  const log: string[] = [];
  let url = 'https://a.com/';
  const entries = ['https://a.com/0', 'https://a.com/1', 'file:///etc/passwd', 'https://a.com/3'].map((u) => ({ url: u }));
  let idx = 1;
  const wc = {
    loadURL: async (u: string) => void log.push('load ' + u),
    getURL: () => url,
    reload: () => void log.push('reload'),
    navigationHistory: { getActiveIndex: () => idx, getEntryAtIndex: (i: number) => entries[i], length: () => entries.length, goToIndex: (i: number) => void log.push('go ' + i) },
  };
  for (const bad of ['file:///etc/passwd', 'chrome://gpu', 'javascript:alert(1)', 'data:text/html,x', 'view-source:https://a.com', 'devtools://x', 'ms-msdt:x', 'not a url']) {
    assert.strictEqual(await navigateChecked(wc, { url: bad }), false, bad);
  }
  assert.deepStrictEqual(log, [], 'a refused URL loads nothing');
  assert.strictEqual(await navigateChecked(wc, { url: 'https://b.com/' }), true);
  assert.strictEqual(await navigateChecked(wc, { url: 'about:blank' }), true);
  assert.deepStrictEqual(log, ['load https://b.com/', 'load about:blank']);
  log.length = 0;
  assert.strictEqual(await navigateChecked(wc, 'back'), true);
  assert.strictEqual(await navigateChecked(wc, 'forward'), false, 'the next entry is a file: URL');
  idx = 3;
  assert.strictEqual(await navigateChecked(wc, 'forward'), false, 'no entry after the last');
  assert.strictEqual(await navigateChecked(wc, 'back'), false, 'the entry before is file:');
  idx = 0;
  assert.strictEqual(await navigateChecked(wc, 'back'), false, 'no entry before the first');
  assert.deepStrictEqual(log, ['go 0']);
  log.length = 0;
  assert.strictEqual(await navigateChecked(wc, 'reload'), true);
  url = 'file:///etc/passwd';
  assert.strictEqual(await navigateChecked(wc, 'reload'), false, 'reload of a refused address');
  assert.deepStrictEqual(log, ['reload']);
  url = 'durbar-sim://x';
  assert.strictEqual(await navigateChecked(wc, { url }), false);
  assert.strictEqual(await navigateChecked(wc, { url }, true), true, 'sim scheme only with sim');
  console.log('browser views navigation tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- AC4: dialogs (owner decision 2026-10-24): shown to the user; main answers only while the agent drives ----
assert.deepStrictEqual(viewDialogPolicy('user', { type: 'confirm', message: 'Delete?' }), { answer: null, note: null }, 'the user answers it');
assert.deepStrictEqual(viewDialogPolicy('none', { type: 'confirm', message: 'Delete?' }), { answer: null, note: null }, 'no driver: the native dialog stays for the user');
assert.deepStrictEqual(viewDialogPolicy('agent', { type: 'beforeunload', message: '' }), { answer: null, note: null }, 'beforeunload is never answered (accept:false would cancel the navigation)');
{
  const r = viewDialogPolicy('agent', { type: 'confirm', message: 'Delete this item?' });
  assert.deepStrictEqual(r.answer, { accept: false });
  assert.strictEqual(r.note, 'The page showed a dialog: "Delete this item?"');
  const long = viewDialogPolicy('agent', { type: 'alert', message: 'x'.repeat(5000) + '\nsecond line' });
  assert.ok((long.note as string).length < 200, 'cut to 120 characters');
  const tok = 'ghp_' + 'A1b2C3d4'.repeat(5);
  assert.ok(!(viewDialogPolicy('agent', { type: 'alert', message: 'token ' + tok }).note as string).includes(tok), 'masked');
  assert.ok(!/[\u0000-\u001f]/.test(viewDialogPolicy('agent', { type: 'alert', message: 'a\u0000b\nc\u001b[31m' }).note as string), 'no control characters');
}
{
  const c0 = process.cpuUsage();
  viewDialogPolicy('agent', { type: 'alert', message: 'a '.repeat(100000) });
  const c = process.cpuUsage(c0); // CPU time, not wall time: a busy machine must not fail it
  assert.ok((c.user + c.system) / 1000 < 2000, 'a 200k-character message is handled quickly');
}

// ---- T013: soft cap picker ----
const mk = (id: string, over: Partial<CapView> = {}): CapView => ({ id, loaded: true, shown: false, lastShownAt: Number(id.replace(/\D/g, '')) || 0, reachedByPost: false, charKeySinceLoad: false, callInFlight: false, callInCurrentTurn: false, browserTypeSinceLoad: false, ...over });
assert.strictEqual(MAX_LIVE_VIEWS, 4);
{
  const four = [mk('v4'), mk('v1'), mk('v3'), mk('v2')];
  assert.deepStrictEqual(pickUnload(four), { unload: ['v1'], overCap: false }, 'the least recently shown goes');
  assert.deepStrictEqual(pickUnload(four.slice(0, 3)), { unload: [], overCap: false }, 'room left');
  assert.deepStrictEqual(pickUnload([...four, mk('v5')]), { unload: ['v1', 'v2'], overCap: false }, 'already over: unload down to the cap');
  assert.deepStrictEqual(pickUnload([mk("v0", { loaded: false }), ...four]), { unload: ["v1"], overCap: false }, "an unloaded view does not count");
}
for (const [flag, why] of [['reachedByPost', 'POST'], ['charKeySinceLoad', 'character key input'], ['callInFlight', 'call in flight'], ['callInCurrentTurn', 'call in the current turn'], ['browserTypeSinceLoad', 'browser_type since load'], ['shown', 'on screen']] as const) {
  const vs = [mk('v1', { [flag]: true }), mk('v2'), mk('v3'), mk('v4')];
  assert.strictEqual(safeToUnload(vs[0]), false, why);
  assert.deepStrictEqual(pickUnload(vs), { unload: ['v2'], overCap: false }, `${why}: never picked, the next oldest goes`);
  const all = vs.map((v) => ({ ...v, [flag]: true }));
  assert.deepStrictEqual(pickUnload(all), { unload: [], overCap: true }, `${why}: no candidate means over the cap`);
}
assert.strictEqual(safeToUnload(mk('v1')), true, 'a driver:agent view with no call in the current turn can be picked');
assert.deepStrictEqual(pickUnload([mk('v1', { charKeySinceLoad: true }), mk('v2', { reachedByPost: true }), mk('v3'), mk('v4', { callInFlight: true })], 3), { unload: ['v3'], overCap: true }, 'partly freed: still over the cap');

// ---- views.ts against a fake Electron (T012 AC5-AC7, Paco/reviewer items) ----
import { makeViews, type ViewDeps } from '../src/main/browser/views';
const T1 = 't00000001';
function fakeElectron() {
  const log: string[] = [];
  const created: { wc: any; ses: any }[] = [];
  const sesByName = new Map<string, any>();
  const gate: { loadHold?: Promise<void>; attachFails?: boolean; enableFails?: boolean; unloadBlocks?: boolean; direct?: string[] } = {};
  const deps: ViewDeps = {
    chromeVersion: '152.0.0.1',
    createView: (prefs) => {
      const i = created.length;
      const msg = new EventEmitter();
      const dbg = {
        attached: false,
        attach(v: string) { if (gate.attachFails) throw new Error('attach failed'); log.push(`${i}:attach ${v}`); this.attached = true; },
        detach() { log.push(`${i}:detach`); this.attached = false; },
        isAttached() { return this.attached; },
        sendCommand: async (m: string, p?: object) => { log.push(`${i}:cmd ${m}${p ? ' ' + JSON.stringify(p) : ''}`); if (m === 'Page.enable' && gate.enableFails) throw new Error('enable failed'); return {}; },
        on: (_e: string, fn: (...a: unknown[]) => void) => msg.on('message', fn),
      };
      let destroyed = false;
      let cancelling = false;
      const wc = Object.assign(new EventEmitter(), {
        prefs, debugger: dbg, msg,
        openHandler: undefined as unknown, setWindowOpenHandler(h: unknown) { (this as { openHandler: unknown }).openHandler = h; }, setUserAgent: (u: string) => void log.push(`${i}:ua ${u}`), getUserAgent: () => 'Mozilla/5.0 (X11; Linux x86_64) Chrome/152.0.0.1 Electron/44 Safari/537.36',
        setAudioMuted: (m: boolean) => void log.push(`${i}:mute ${m}`),
        // a page with a beforeunload handler: the unload event fires, and the navigation is cancelled unless the handler prevented it
        unload(): boolean { const e = { prevented: false, preventDefault() { this.prevented = true; } }; (this as unknown as EventEmitter).emit('will-prevent-unload', e); return e.prevented; },
        loadURL: async function (this: { unload(): boolean }, u: string) {
          log.push(`${i}:load ${u}`); await gate.loadHold;
          if (cancelling) throw new Error('ERR_ABORTED'); // Chromium drops a load that starts while the previous one is still being cancelled
          if (gate.unloadBlocks && u !== 'about:blank' && !this.unload()) { cancelling = true; await new Promise((r) => setTimeout(r, 10)); cancelling = false; throw new Error('ERR_ABORTED'); }
          if (u !== 'about:blank') log.push(`${i}:done ${u}`);
        },
        getURL: () => 'https://a.com/', reload() {},
        navigationHistory: { getActiveIndex: () => 1, getEntryAtIndex: (n: number) => (n === 0 ? { url: 'https://a.com/0' } : { url: 'https://a.com/1' }), length: () => 2,
          goToIndex(n: number) { log.push(`${i}:go ${n}`); if (gate.unloadBlocks && !(wc as unknown as { unload(): boolean }).unload()) log.push(`${i}:cancelled`); } },
        // FR-128: waitForBeforeUnload runs the page's beforeunload; a page that asks keeps the view open (Electron fires will-prevent-unload)
        close: (o: { waitForBeforeUnload?: boolean }) => {
          if (destroyed) return;
          if (o && o.waitForBeforeUnload && gate.unloadBlocks && !(wc as unknown as { unload(): boolean }).unload()) { log.push(`${i}:close kept`); return; }
          log.push(`${i}:close ${JSON.stringify(o)}`); destroyed = true; (wc as unknown as EventEmitter).emit('destroyed');
        }, isDestroyed: () => destroyed,
      });
      const ses = sesByName.get(String(prefs.partition));
      created.push({ wc, ses });
      return { webContents: wc as never };
    },
    // FR-121: one session object per partition name (made before its first view, as Electron's session.fromPartition does)
    sessionFromPartition: (name: string) => {
      if (!sesByName.has(name)) {
        const i = created.length;
        sesByName.set(name, Object.assign(new EventEmitter(), {
          nulls: 0, set: [] as string[], name,
          setPermissionRequestHandler(f: unknown) { if (!f) this.nulls++; this.set.push('req'); }, setPermissionCheckHandler(f: unknown) { if (!f) this.nulls++; }, setDevicePermissionHandler(f: unknown) { if (!f) this.nulls++; }, setDisplayMediaRequestHandler(f: unknown) { if (!f) this.nulls++; },
          clearStorageData: async () => void log.push(`${i}:clearStorage`), clearCache: async () => void log.push(`${i}:clearCache`),
        }));
      }
      return sesByName.get(name) as never;
    },
  };
  return { deps, log, created, gate };
}
(async () => {
  // creation: muted, about:blank first, then attach, then only Page.enable; the UA has no Electron token; the options are the builder's
  {
    const f = fakeElectron(); const v = makeViews(f.deps);
    const sv = await v.ensureTabView('s1', T1);
    assert.deepStrictEqual(f.log.filter((l) => !l.includes(':ua ')), ['0:mute true', '0:load about:blank', '0:attach 1.3', '0:cmd Page.enable'], 'mute, about:blank, attach, Page only');
    assert.ok(f.log.some((l) => l.startsWith('0:ua ') && !/electron/i.test(l)));
    assert.ok(VIEW_PARTITION_RE.test(f.created[0].wc.prefs.partition) && !('disableDialogs' in f.created[0].wc.prefs));
    assert.strictEqual(sv.partition, f.created[0].wc.prefs.partition);
    assert.strictEqual(await v.ensureTabView('s1', T1), sv, 'lazy and shared');
    assert.strictEqual(v.liveViewCount(), 1);
    // the dialog part: only while the agent drives
    f.log.length = 0;
    f.created[0].wc.msg.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'ok?' });
    assert.deepStrictEqual(f.log, [], 'driver user: not answered');
    sv.driver = 'agent';
    f.created[0].wc.msg.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: '' });
    assert.deepStrictEqual(f.log, [], 'beforeunload is never answered');
    f.created[0].wc.msg.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'ok?' });
    assert.deepStrictEqual(f.log, ['0:cmd Page.handleJavaScriptDialog {"accept":false}'], 'driver agent: closed with Cancel');
      // FR-025d: the window hears of an alert or confirm (not beforeunload) and of its closing; FR-025e: Leave knows whether main started the navigation
    {
      const seen: unknown[] = [];
      const f2 = fakeElectron(); f2.gate.unloadBlocks = true;
      const v2 = makeViews(f2.deps);
      const sv2 = await v2.ensureTabView('s2', T1, { onPageDialog: (_s, d) => void seen.push(['open', d]), onPageDialogClosed: () => void seen.push('closed'), askLeave: async (_s, known) => (seen.push(['leave', known]), false) });
      const msg2 = f2.created[0].wc.msg;
      msg2.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete? token=' + 'gh' + 'p_' + 'A1b2'.repeat(9) });
      msg2.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: '' });
      msg2.emit('message', {}, 'Page.javascriptDialogClosed', { result: false });
      sv2.driver = 'agent';
      msg2.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'hi' });
      assert.deepStrictEqual(seen.map((x) => (Array.isArray(x) ? [x[0], (x[1] as { type: string; forAgent: boolean }).type, (x[1] as { forAgent: boolean }).forAgent] : x)), [['open', 'confirm', false], 'closed', ['open', 'alert', true]], 'confirm for the user, closed, alert closed for the agent; beforeunload is never reported');
      assert.ok(!/ghp_/.test(JSON.stringify(seen)), 'the text is masked');
      sv2.driver = 'user'; seen.length = 0;
      await sv2.navigate({ url: 'https://b.com/' });
      await new Promise((r) => setTimeout(r, 40));
      f2.created[0].wc.unload();
      await new Promise((r) => setTimeout(r, 40));
      assert.deepStrictEqual(seen, [['leave', true], ['leave', false]], 'a navigation main started: target known (the in-flight one is also asked); a page-started unload: unknown');
    }
  // downloads: cancelled by the handler, and a running one is cancelled on teardown
    const ev1 = ev(); let cancelled = 0;
    f.created[0].ses.emit('will-download', ev1, { cancel: () => cancelled++, once() {} });
    assert.strictEqual(ev1.prevented, 1);
    f.log.length = 0;
    const sesE = f.created[0].ses as EventEmitter & { nulls: number };
    for (const name of [...VIEW_SESSION_EVENTS]) assert.strictEqual(sesE.listenerCount(name), name === 'will-download' ? 2 : 1, `before teardown: ${name}`);
    await v.destroySessionView('s1');
    for (const name of [...VIEW_SESSION_EVENTS]) assert.strictEqual(sesE.listenerCount(name), 0, `after teardown no ${name} listener holds the view`);
    assert.strictEqual(sesE.nulls, 0, 'the deny-all handlers stay: never set to null (Electron would allow by default)');
    assert.strictEqual(cancelled, 1, 'teardown cancels a running download');
    assert.deepStrictEqual(f.log, ['0:detach', '0:close {"waitForBeforeUnload":false}', '0:clearStorage', '0:clearCache'], 'teardown order');
    assert.strictEqual(v.liveViewCount(), 0);
    sv.close();
    await v.destroySessionView('s1');
    assert.strictEqual(f.log.length, 4, 'a second close or teardown does nothing');
  }
  // a failing attach or Page.enable cleans up the half-built view
  for (const which of ['attachFails', 'enableFails'] as const) {
    const f = fakeElectron(); f.gate[which] = true; const v = makeViews(f.deps);
    await assert.rejects(v.ensureTabView('s1', T1));
    assert.ok(f.log.includes('0:close {"waitForBeforeUnload":false}') && f.log.includes('0:clearStorage') && f.log.includes('0:clearCache'), which + ': closed and cleared');
    assert.strictEqual(v.liveViewCount(), 0, 'not kept');
    f.gate[which] = false;
    const sv = await v.ensureTabView('s1', T1);
    assert.notStrictEqual(f.created[1], undefined, 'a retry builds a new view');
    assert.notStrictEqual(sv.partition, f.created[0].wc.prefs.partition);
  }
  // end during create, then create again: the stale build is destroyed and never registered
  {
    const f = fakeElectron(); let release!: () => void;
    f.gate.loadHold = new Promise<void>((r) => (release = r));
    const v = makeViews(f.deps);
    const first = v.ensureTabView('s1', T1); first.catch(() => undefined);
    await new Promise((r) => setImmediate(r));
    const ended = v.destroySessionView('s1');
    f.gate.loadHold = undefined;
    const second = v.ensureTabView('s1', T1);
    release();
    await assert.rejects(first, /ended while/);
    await ended;
    const sv2 = await second;
    assert.ok(f.log.includes('0:close {"waitForBeforeUnload":false}'), 'the stale view was closed');
    assert.ok(!f.log.some((l) => l.startsWith('1:close')), 'the new one is alive');
    assert.strictEqual(v.liveViewCount(), 1);
    assert.strictEqual(await v.ensureTabView('s1', T1), sv2, 'the registry holds the new view');
    await v.destroyAllViews();
    assert.ok(f.log.includes('1:close {"waitForBeforeUnload":false}'));
    assert.strictEqual(v.liveViewCount(), 0);
  }
  // FR-025e: Leave repeats only a navigation main started, through navigateChecked
  {
    const mkv = async (ask: () => Promise<boolean>) => {
      const f = fakeElectron(); f.gate.unloadBlocks = true;
      const v = makeViews(f.deps); const sv = await v.ensureTabView('s1', T1, { askLeave: ask });
      f.log.length = 0;
      return { f, sv, wc: f.created[0].wc };
    };
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));
    // main-started loadURL: cancelled (no preventDefault), then Leave repeats it and it passes
    { const { f, sv } = await mkv(async () => true);
      assert.strictEqual(await sv.navigate({ url: 'https://b.com/' }), false, 'cancelled by the page');
      await tick();
      assert.deepStrictEqual(f.log, ['0:load https://b.com/', '0:load https://b.com/', '0:done https://b.com/'], 'repeated once, and it passes');
    }
    // main-started Back goes through navigateChecked (history), not loadURL
    { const { f, sv } = await mkv(async () => true);
      await sv.navigate('back'); await tick();
      assert.deepStrictEqual(f.log, ['0:go 0', '0:cancelled', '0:go 0'], 'Back, cancelled, repeated through the history helper and it passes');
      assert.ok(!f.log.some((l) => l.includes(':load ')), 'never loadURL for Back');
    }
    // Stay: nothing repeated
    { const { f, sv } = await mkv(async () => false);
      await sv.navigate({ url: 'https://b.com/' }); await tick();
      assert.deepStrictEqual(f.log, ['0:load https://b.com/'], 'Stay repeats nothing');
    }
    // a delayed answer (askDialog is never instant): the repeat waits for the cancel to settle and the load is not dropped. An instant answer is a known gap in real Electron
    { const { f, sv } = await mkv(() => new Promise<boolean>((r) => setTimeout(() => r(true), 5)));
      await sv.navigate({ url: 'https://c.com/' }); await tick();
      assert.strictEqual(f.log.filter((l) => l === '0:done https://c.com/').length, 1, 'a delayed Leave repeats and the load is not dropped');
    }
    // page-started unload (a link click): nothing is repeated, the flag is armed so the user's next click passes
    { const { f, wc } = await mkv(async () => true);
      assert.strictEqual(wc.unload(), false, 'page stays');
      await tick();
      assert.deepStrictEqual(f.log, [], 'no navigation is repeated for a page-started leave');
      assert.strictEqual(wc.unload(), true, 'the next try passes');
      assert.strictEqual(wc.unload(), false, 'one shot');
    }
    // an older finished navigation is not repeated by a later page-started leave
    { const { f, sv, wc } = await mkv(async () => true);
      f.gate.unloadBlocks = false; await sv.navigate({ url: 'https://old.com/' }); f.gate.unloadBlocks = true; f.log.length = 0;
      wc.unload(); await tick();
      assert.deepStrictEqual(f.log, [], 'the earlier navigation is not repeated');
    }
  }
  // ---- spec 080 T022: tabs share the session's partition; closing a tab never clears it; the teardown clears it once, after every view ----
  {
    const f = fakeElectron(); const v = makeViews(f.deps);
    const a = await v.ensureTabView('s1', 't00000001');
    const b = await v.ensureTabView('s1', 't00000002');
    const c = await v.ensureTabView('s2', 't00000001');
    assert.strictEqual(a.partition, b.partition, 'two tabs of one session share the partition (FR-121)');
    assert.notStrictEqual(a.partition, c.partition, 'two sessions never do (FR-020)');
    assert.strictEqual(f.created[0].ses, f.created[1].ses, 'the same session object');
    assert.notStrictEqual(f.created[0].ses, f.created[2].ses);
    assert.strictEqual(f.created[0].ses.set.length, 1, 'the deny-all session handlers go on once per session');
    assert.strictEqual((f.created[0].ses as EventEmitter).listenerCount('will-download'), 2, 'one handler and one download watch per session, not per tab');
    assert.strictEqual(v.liveViewCount(), 3);
    assert.strictEqual(v.partitionOf('s1'), a.partition);
    f.log.length = 0;
    await v.closeTabView('s1', 't00000001');
    assert.deepStrictEqual(f.log, ['0:detach', '0:close {"waitForBeforeUnload":false}'], 'closing a tab closes its view only: no clearStorageData, no clearCache');
    assert.strictEqual(v.liveViewCount(), 2);
    assert.strictEqual(await v.ensureTabView('s1', 't00000003').then((x) => x.partition), a.partition, 'a later tab still uses it (the logins stay)');
    f.log.length = 0;
    await v.destroySessionView('s1');
    const clears = f.log.filter((l) => /clear/.test(l));
    assert.deepStrictEqual(clears, ['0:clearStorage', '0:clearCache'], 'the teardown clears the partition exactly once');
    const lastClose = Math.max(...f.log.map((l, i) => (/close/.test(l) ? i : -1)));
    assert.ok(lastClose >= 0 && lastClose < f.log.indexOf('0:clearStorage'), 'after every view of the session is closed');
    assert.ok(f.log.includes('1:close {"waitForBeforeUnload":false}') && f.log.includes('3:close {"waitForBeforeUnload":false}'), 'every tab closed, without beforeunload');
    assert.strictEqual(v.partitionOf('s1'), undefined);
    assert.strictEqual(v.liveViewCount(), 1, 's2 untouched');
    assert.notStrictEqual(await v.ensureTabView('s1', 't00000001').then((x) => x.partition), a.partition, 'a session started again gets a new partition');
    await v.destroyAllViews();
    assert.strictEqual(v.liveViewCount(), 0);
  }
  // a tab view still being built when the session ends: closed, and the partition is cleared only after it settled
  {
    const f = fakeElectron(); let release!: () => void;
    const v = makeViews(f.deps);
    await v.ensureTabView('s1', 't00000001');
    f.gate.loadHold = new Promise<void>((r) => (release = r));
    const slow = v.ensureTabView('s1', 't00000002'); slow.catch(() => undefined);
    await new Promise((r) => setImmediate(r));
    f.log.length = 0;
    const ended = v.destroySessionView('s1');
    await new Promise((r) => setImmediate(r));
    assert.ok(!f.log.some((l) => /clear/.test(l)), 'not cleared while a view is still being built');
    release();
    await ended;
    await assert.rejects(slow);
    assert.ok(f.log.includes('1:close {"waitForBeforeUnload":false}'), 'the late view is closed');
    assert.ok(f.log.indexOf('1:close {"waitForBeforeUnload":false}') < f.log.indexOf('0:clearStorage'), 'and only then the partition is cleared');
  }
  // closing the last tab keeps the partition (a closed tab's late build too)
  {
    const f = fakeElectron(); const v = makeViews(f.deps);
    const a = await v.ensureTabView('s1', 't00000001');
    await v.closeTabView('s1', 't00000001');
    assert.ok(!f.log.some((l) => /clear/.test(l)), 'the last tab closed: nothing cleared');
    assert.strictEqual(v.partitionOf('s1'), a.partition, 'the session browser and its partition stay');
  }
  // FR-128: the user closes a tab: the page's beforeunload runs; Stay keeps it, Leave closes it; no handler closes at once
  {
    const f = fakeElectron(); f.gate.unloadBlocks = true;
    let answer = false;
    const asked: boolean[] = [];
    const v = makeViews(f.deps);
    const sv = await v.ensureTabView('s1', 't00000001', { askLeave: async (_s, known) => (asked.push(known), answer) });
    f.log.length = 0;
    assert.strictEqual(await sv.closeAsk(), false, 'Stay: the tab stays');
    assert.deepStrictEqual(f.log, ['0:close kept'], 'the close ran the page\'s beforeunload, which asked');
    assert.strictEqual(asked.length, 1, 'Durbar\'s Leave this page? was asked');
    assert.ok(!f.created[0].wc.isDestroyed());
    answer = true;
    assert.strictEqual(await sv.closeAsk(), true, 'Leave: closed');
    assert.ok(f.created[0].wc.isDestroyed());
    assert.ok(f.log.includes('0:close {"waitForBeforeUnload":false}'), 'closed without a second beforeunload');
    assert.strictEqual(await sv.navigate({ url: 'https://late.example/' }), false, 'a closed tab never loads again');
    // a page with no beforeunload closes at once
    const g = fakeElectron(); const v2 = makeViews(g.deps);
    const sv2 = await v2.ensureTabView('s1', 't00000001', { askLeave: async () => false });
    assert.strictEqual(await sv2.closeAsk(), true, 'no handler: closed');
    // the agent's tab (driver agent) is never blocked
    const h2 = fakeElectron(); h2.gate.unloadBlocks = true; const v3 = makeViews(h2.deps);
    const sv3 = await v3.ensureTabView('s1', 't00000001', { askLeave: async () => false });
    sv3.driver = 'agent';
    assert.strictEqual(await sv3.closeAsk(), true, 'driver agent: closed at once');
    // the session ends while the question waits: the close resolves
    const k = fakeElectron(); k.gate.unloadBlocks = true; const v4 = makeViews(k.deps);
    const sv4 = await v4.ensureTabView('s1', 't00000001', { askLeave: () => new Promise<boolean>(() => undefined) });
    const pending = sv4.closeAsk();
    await v4.destroySessionView('s1');
    assert.strictEqual(await pending, true, 'the teardown answers a waiting close');
  }
  // FR-125, FR-130: a view's tab requests and tab keys reach the controller's events
  {
    const f = fakeElectron(); const v = makeViews(f.deps);
    const reqs: unknown[] = [], keys: unknown[] = [];
    await v.ensureTabView('s1', 't00000001', { onTabRequest: (s, u, fg) => (reqs.push([s, u, fg]), true), onTabKey: (s, k) => void keys.push([s, k]) });
    const wc = f.created[0].wc;
    // the window open handler is the builder's
    const handler = (wc as { openHandler?: (d: unknown) => unknown }).openHandler!;
    assert.deepStrictEqual(handler({ url: 'https://a.com/x', disposition: 'foreground-tab', referrer: { url: 'https://a.com/' } }), { action: 'deny' });
    assert.deepStrictEqual(reqs, [['s1', 'https://a.com/x', true]], 'a same-origin tab request goes to main');
    const key = (input: object) => { const e = { prevented: 0, preventDefault() { this.prevented++; } }; (wc as unknown as EventEmitter).emit('before-input-event', e, input); return e.prevented; };
    const mod = process.platform === 'darwin' ? { meta: true } : { control: true };
    assert.strictEqual(key({ type: 'keyDown', key: 't', code: 'KeyT', ...mod }), 1, 'Ctrl/Cmd+T is kept from the page');
    assert.strictEqual(key({ type: 'keyDown', key: 'Tab', code: 'Tab', control: true }), 1, 'Ctrl+Tab too');
    assert.strictEqual(key({ type: 'keyDown', key: 'w', code: 'KeyW', ...mod }), 1);
    assert.strictEqual(key({ type: 'keyDown', key: 'a', code: 'KeyA', ...mod }), 0, 'other keys reach the page');
    assert.strictEqual(key({ type: 'keyUp', key: 't', code: 'KeyT', ...mod }), 0);
    assert.deepStrictEqual(keys, [['s1', 'new'], ['s1', 'next'], ['s1', 'close']], 'and main acts on them');
  }
  // a refused navigation through the view's helper
  {
    const f = fakeElectron(); const v = makeViews(f.deps); const sv = await v.ensureTabView('s1', T1);
    f.log.length = 0;
    assert.strictEqual(await sv.navigate({ url: 'file:///etc/passwd' }), false);
    assert.deepStrictEqual(f.log, [], 'loadURL never called');
    assert.strictEqual(await sv.navigate({ url: 'https://a.com/' }), true);
  }
  console.log('browser views (fake Electron) tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

console.log('browser views tests passed');
