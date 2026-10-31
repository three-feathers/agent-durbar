/**
 * Spec 080 T014 (IPC and teardown), T018 (simulator pages): the session browser's controller against fakes, the sources that wire it, and the
 * simulator-only scheme. `npm run test:browseripc`. No Electron, no network, no credits.
 *
 *  1. the controller: a session id is looked up in main; the view is created on first open, attached only while asked for, with bounds and
 *     no overlay, one at a time; bounds are validated; the window gets BrowserState and nothing else;
 *  2. the wiring: every browser channel is registered with `fromApp(e)`, the preload calls exactly those, none of the page-reading APIs
 *     appears in the controller or the IPC module, end / remove / folder remove / replace destroy the view;
 *  3. the simulator pages: each page, a 404, and the scheme exists only when the simulator is on (installSimPages, registerSimScheme, the view builder);
 *  4. the address bar: file:, javascript:, userinfo are refused with their reason; the test scheme only under the simulator.
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { checkBounds, displayUrl, errorName, makeBrowserController, STATE_KEYS, TAB_KEYS } from '../src/main/browser/controller';
import { MAX_LIVE_VIEWS } from '../src/main/browser/viewcap';
import type { BrowserDeps, BrowserWinLike } from '../src/main/browser/controller';
import { installSimPages, registerSimScheme, simAddress, simPage } from '../src/main/browser/simpages';
import { makeViews } from '../src/main/browser/views';
import type { BrowserState } from '../src/shared/api';
import { preloadChannels, stripComments } from './ipc-channel-list';
import { parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import * as os from 'os';

const ROOT = path.join(__dirname, '..', '..');
const read = (f: string): string => stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));

// ---- fakes ----
function fakeWin(content = { width: 1000, height: 700 }, zoom = 1) {
  const children: unknown[] = [];
  const win = {
    children,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    contentView: { addChildView: (v: unknown) => void children.push(v), removeChildView: (v: unknown) => { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); } },
    getContentBounds: () => content,
    webContents: { getZoomFactor: () => zoom },
  };
  return win;
}
/** Spec 080 T023: `hold.on` keeps the next navigations from committing (a page that is still loading); `release()` answers them (refused). */
const hold = { on: false, waiting: [] as (() => void)[], release() { const w = this.waiting.splice(0); for (const f of w) f(); } };
function fakeSession(id: string) {
  const wc = Object.assign(new EventEmitter(), {
    url: 'about:blank' as unknown, title: '' as unknown, loading: false, muted: true, canBack: false, canForward: false, destroyed: false, stops: 0, focuses: 0,
    focus() { this.focuses++; },
    getURL() { return this.url as string; }, getTitle() { return this.title as string; }, isLoading() { return this.loading; }, stop() { this.stops++; },
    setAudioMuted(m: boolean) { this.muted = m; }, isAudioMuted() { return this.muted; }, isDestroyed() { return this.destroyed; },
    navigationHistory: { canGoBack: () => wc.canBack, canGoForward: () => wc.canForward },
    shot: 'data:image/png;base64,AAAA' as unknown,
    capturePage: async () => ({ toDataURL: () => wc.shot as string }),
  });
  const view = { webContents: wc, bounds: undefined as unknown, setBounds(b: unknown) { this.bounds = b; } };
  const navs: unknown[] = [];
  const sv = {
    id, view, driver: 'user' as const, navs, tabId: '', closed: false, closeAsks: 0, leaveOnClose: true as boolean | undefined,
    events: undefined as unknown as import('../src/main/browser/views').ViewEvents,
    navigate: async (a: unknown) => {
      navs.push(a);
      if (sv.closed) return false;
      if (hold.on && a && typeof a === 'object' && (a as { url: string }).url !== 'about:blank') { wc.loading = true; return new Promise<boolean>((res) => hold.waiting.push(() => res(false))); }
      if (a && typeof a === 'object') { wc.url = (a as { url: string }).url; wc.emit('did-start-navigation'); wc.emit('did-navigate'); }
      return true;
    },
    close: () => { sv.closed = true; wc.destroyed = true; },
    // FR-128: `leaveOnClose` true = no beforeunload or Leave; false = Stay
    closeAsk: async () => { sv.closeAsks++; if (sv.leaveOnClose === false) return false; sv.close(); return true; },
  };
  return { wc, view, sv, navs };
}
function rig(opts: { sim?: boolean; known?: (id: string) => boolean; win?: ReturnType<typeof fakeWin> | undefined; zoom?: number; consent?: boolean; snapshotMs?: number; now?: () => number } = {}) {
  const win = 'win' in opts ? opts.win : fakeWin(undefined, opts.zoom);
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const tabViews = new Map<string, ReturnType<typeof fakeSession>>(); // spec 080 T023: one fake view per (session, tab)
  const closedTabs: string[] = [];
  const keys: { id: string; key: string }[] = [];
  const tabsSeen: import('../src/shared/api').BrowserTabs[] = [];
  const links = { on: false };
  const closeHold = { on: false };
  const ensured: string[] = [];
  const destroyed: string[] = [];
  const emitted: BrowserState[] = [];
  const opened: string[] = [];
  const queue: (() => void)[] = [];
  const dialogs: unknown[] = [];
  const leaves: unknown[][] = [];
  const dropped: (string | undefined)[] = [];
  const consent = { on: opts.consent !== false };
  const deps: BrowserDeps = {
    snapshotMs: opts.snapshotMs,
    now: opts.now,
    consented: () => consent.on,
    pageDialog: (d) => void dialogs.push(d),
    askLeave: async (id, known, shown) => (leaves.push([id, known, shown]), true),
    dropAsks: (id) => void dropped.push(id),
    known: opts.known ?? ((id) => /^s\d$/.test(id)),
    sim: !!opts.sim,
    window: () => win as unknown as BrowserWinLike | undefined,
    views: {
      ensureTabView: async (id, tabId, events) => {
        ensured.push(id);
        const key = id + '/' + tabId;
        if (!tabViews.has(key)) tabViews.set(key, fakeSession(id));
        const f = tabViews.get(key)!;
        if (!sessions.has(id) || sessions.get(id)!.sv.closed) sessions.set(id, f); // the session's first (live) view
        f.sv.events = events;
        f.sv.tabId = tabId;
        return f.sv as never;
      },
      closeTabView: async (id, tabId) => {
        closedTabs.push(id + '/' + tabId);
        if (closeHold.on) return new Promise<void>(() => undefined); // a view still being made: its close waits for it
        const f = tabViews.get(id + '/' + tabId);
        if (f) { f.sv.close(); tabViews.delete(id + '/' + tabId); }
      },
      destroySessionView: async (id) => {
        destroyed.push(id);
        for (const [k, f] of [...tabViews]) if (k.startsWith(id + '/')) { f.sv.close(); tabViews.delete(k); }
      },
    },
    emit: (s) => void emitted.push(s),
    emitTabs: (t) => void tabsSeen.push(t),
    linksNewTab: () => links.on,
    tabKey: (k) => void keys.push(k),
    openExternal: async (u) => void opened.push(u),
    later: (f) => void queue.push(f),
  };
  const ctl = makeBrowserController(deps);
  const flush = (): void => { while (queue.length) queue.shift()!(); };
  return { ctl, win: win!, sessions, tabViews, closedTabs, closeHold, keys, tabsSeen, links, ensured, destroyed, emitted, opened, flush, dialogs, leaves, dropped, consent };
}
const B = { x: 10, y: 120, width: 600, height: 400 };

// an unfinished run (a promise that never settles ends the process with exit 0) must fail, not pass with half the suite skipped
let finished = false;
process.on('exit', () => {
  if (!finished) {
    console.error('browser ipc tests did not finish');
    process.exitCode = 1;
  }
});
(async () => {
  // ---- 1. the controller ----
  // a session id is looked up in main
  {
    const r = rig();
    for (const bad of [undefined, null, 5, {}, '', 'x'.repeat(101), 'nobody', '../s1', 's1/../s2']) {
      assert.strictEqual((await r.ctl.open(bad)).ok, false, `open(${JSON.stringify(bad)}) refused`);
      assert.deepStrictEqual(r.ctl.bounds(bad, B), { ok: false });
      assert.deepStrictEqual(r.ctl.visible(bad, true), { ok: false });
    }
    assert.deepStrictEqual(r.ensured, [], 'no view for an unknown session');
    assert.strictEqual(r.ctl.state('nobody').ok, false);
  }
  // lazy creation (FR-004), attach rules (FR-009)
  {
    const r = rig();
    assert.deepStrictEqual(r.ensured, [], 'nothing at start');
    assert.strictEqual(r.ctl.state('s1').ok && (r.ctl.state('s1') as { state: BrowserState }).state.open, false, 'state before open: not open, and it does not create a view');
    assert.deepStrictEqual(r.ensured, []);
    const o = await r.ctl.open('s1');
    assert.ok(o.ok && o.state.open && o.state.muted && o.state.driver === 'user');
    assert.deepStrictEqual(r.ensured, ['s1']);
    await r.ctl.open('s1');
    assert.strictEqual(r.sessions.size, 1, 'one view per session');
    assert.deepStrictEqual(r.win.children, [], 'created, but not attached to the window');
    assert.deepStrictEqual(r.ctl.visible('s1', true), { ok: false }, 'no attach without bounds');
    assert.deepStrictEqual(r.ctl.bounds('s1', B), { ok: true });
    assert.deepStrictEqual(r.win.children, [], 'bounds alone attach nothing');
    assert.deepStrictEqual(r.ctl.visible('s1', true), { ok: true });
    const s1 = r.sessions.get('s1')!;
    assert.deepStrictEqual(r.win.children, [s1.view], 'attached');
    assert.deepStrictEqual(s1.view.bounds, B, 'bounds applied');
    // the Chat tab: detached again, page kept
    assert.deepStrictEqual(r.ctl.visible('s1', false), { ok: true });
    assert.deepStrictEqual(r.win.children, [], 'visible(false) detaches the view (it is not left on the Chat tab)');
    assert.strictEqual(s1.wc.isDestroyed(), false, 'the page is kept');
    // an overlay hides it, closing the overlay brings it back
    r.ctl.visible('s1', true);
    r.ctl.overlay('s1', true);
    assert.deepStrictEqual(r.win.children, [], 'an overlay hides the view');
    r.ctl.overlay('s1', false);
    assert.deepStrictEqual(r.win.children, [s1.view], 'and shows it again');
    r.ctl.overlay('s1', true);
    r.ctl.visible('s1', false);
    r.ctl.overlay('s1', false);
    assert.deepStrictEqual(r.win.children, [], 'closing an overlay does not show a view the tab did not ask for');
    // new bounds while detached are kept, not attached
    assert.deepStrictEqual(r.ctl.bounds('s1', { ...B, width: 500 }), { ok: true });
    assert.deepStrictEqual(r.win.children, []);
    // only one view is attached at a time (one chat is open)
    await r.ctl.open('s2');
    r.ctl.bounds('s2', B);
    r.ctl.visible('s1', true);
    r.ctl.visible('s2', true);
    assert.deepStrictEqual(r.win.children, [r.sessions.get('s2')!.view], 'attaching s2 takes s1 off');
    assert.deepStrictEqual(r.ctl.attachedIds(), ['s2']);
    // non-boolean flags are refused
    assert.deepStrictEqual(r.ctl.visible('s2', 'yes' as never), { ok: false });
    assert.deepStrictEqual(r.ctl.overlay('s2', 1 as never), { ok: false });
    assert.strictEqual(r.ctl.mute('s2', 'no' as never).ok, false);
    // the window's page loads again: no view stays on top of it
    r.ctl.visible('s2', true);
    assert.strictEqual(r.win.children.length, 1);
    r.ctl.detachAll();
    assert.deepStrictEqual(r.win.children, [], 'detachAll takes every view off');
    assert.deepStrictEqual(r.ctl.bounds('s2', B), { ok: true });
    assert.deepStrictEqual(r.win.children, [], 'and the old "visible" is forgotten: the new page has to ask again');
    r.ctl.visible('s2', true);
    // a destroyed window attaches nothing
    r.win.destroyed = true;
    r.ctl.visible('s2', false);
    r.ctl.visible('s1', true);
    assert.deepStrictEqual(r.win.children.length, 1, 'no change on a destroyed window');
  }
  // bounds are checked
  {
    const c = { width: 1000, height: 700 };
    assert.deepStrictEqual(checkBounds({ x: 10.4, y: 20.6, width: 500.5, height: 300 }, c), { x: 10, y: 21, width: 501, height: 300 });
    for (const bad of [null, undefined, 5, 'x', [], {}, { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 10, height: 0 }, { x: NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: Infinity, height: 10 },
      { x: '0', y: 0, width: 10, height: 10 }, { x: -50, y: 0, width: 10, height: 10 }, { x: 0, y: -50, width: 10, height: 10 }, { x: 0, y: 0, width: 5000, height: 10 }, { x: 900, y: 0, width: 200, height: 10 },
      { x: 0, y: 650, width: 10, height: 100 }, { x: 0, y: 0, width: 1e9, height: 1e9 }, { x: 0, y: 0, width: -10, height: 10 }]) {
      assert.strictEqual(checkBounds(bad, c), undefined, `refused: ${JSON.stringify(bad)}`);
    }
    assert.deepStrictEqual(checkBounds({ x: 0, y: 0, width: 1001, height: 700 }, c), { x: 0, y: 0, width: 1001, height: 700 }, '2 px of rounding is allowed');
    assert.deepStrictEqual(checkBounds({ x: 100, y: 100, width: 400, height: 300 }, c, 1.5), { x: 150, y: 150, width: 600, height: 450 }, 'zoom turns CSS pixels into window pixels');
    assert.strictEqual(checkBounds({ x: 100, y: 100, width: 800, height: 300 }, c, 1.5), undefined, 'checked after the zoom');
    assert.deepStrictEqual(checkBounds({ x: 1, y: 1, width: 10, height: 10 }, c, NaN), { x: 1, y: 1, width: 10, height: 10 }, 'a bad zoom is ignored');
    const r = rig();
    await r.ctl.open('s1');
    assert.deepStrictEqual(r.ctl.bounds('s1', { x: 0, y: 0, width: 5000, height: 10 }), { ok: false });
    r.ctl.visible('s1', false);
    assert.deepStrictEqual(r.ctl.bounds('s1', { x: 0, y: 0, width: 5000, height: 10 }), { ok: false }, 'a refused rectangle is never applied');
    assert.strictEqual(r.sessions.get('s1')!.view.bounds, undefined);
    const z = rig({ zoom: 1.25 });
    await z.ctl.open('s1');
    z.ctl.bounds('s1', { x: 80, y: 80, width: 400, height: 400 });
    z.ctl.visible('s1', true);
    assert.deepStrictEqual(z.sessions.get('s1')!.view.bounds, { x: 100, y: 100, width: 500, height: 500 }, 'the window zoom is applied');
    const none = rig({ win: undefined });
    await none.ctl.open('s1');
    assert.deepStrictEqual(none.ctl.bounds('s1', B), { ok: false }, 'no window, no bounds');
  }
  // what the window gets: BrowserState and nothing else
  {
    const r = rig();
    await r.ctl.open('s1');
    r.flush();
    const wc = r.sessions.get('s1')!.wc;
    wc.url = 'https://user:pw@example.invalid/a?q=1';
    wc.title = 'Hello\u0000\u0007 world ' + 'x'.repeat(500);
    wc.loading = true;
    wc.canBack = true;
    wc.emit('did-navigate');
    r.flush();
    const s = r.emitted[r.emitted.length - 1];
    assert.deepStrictEqual(Object.keys(s).sort(), STATE_KEYS.filter((k) => k !== 'error' && k !== 'note' && k !== 'memory' && k !== 'tabLimit').sort(), 'exactly the BrowserState keys');
    for (const [k, v] of Object.entries(s)) assert.ok(['string', 'boolean'].includes(typeof v), `${k} is a primitive (${typeof v})`);
    assert.strictEqual(s.url, 'https://example.invalid/a?q=1', 'userinfo dropped');
    assert.ok(!/pw/.test(JSON.stringify(s)));
    assert.ok(s.title.startsWith('Hello') && !/[\u0000-\u001f]/.test(s.title) && s.title.length <= 200, 'title cleaned and cut');
    assert.strictEqual(s.loading, true);
    assert.strictEqual(displayUrl('about:blank'), '');
    assert.strictEqual(displayUrl({ toString: () => 'x' }), '');
    assert.strictEqual(displayUrl('https://a.com/' + 'x'.repeat(5000)).length, 2048);
    // hostile page-controlled values: wrong types never reach the window
    wc.url = { evil: 1 };
    wc.title = { evil: 1 };
    wc.emit('page-title-updated');
    r.flush();
    const h = r.emitted[r.emitted.length - 1];
    assert.strictEqual(h.url, '');
    assert.strictEqual(h.title, '');
    // errors are a net error name only
    wc.url = 'https://a.com/';
    wc.loading = false;
    wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'https://a.com/', true);
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].error, 'ERR_CONNECTION_REFUSED');
    wc.emit('did-fail-load', {}, -102, '<script>secret page text</script>', 'https://a.com/', true);
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].error, 'ERR_FAILED', 'anything that is not a net error name becomes a generic one');
    assert.strictEqual(errorName('ERR_NAME_NOT_RESOLVED'), 'ERR_NAME_NOT_RESOLVED');
    assert.strictEqual(errorName('ERR_' + 'A'.repeat(80)), 'ERR_FAILED');
    wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.com/', true);
    wc.emit('did-start-navigation');
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].error, undefined, 'a new navigation clears the error; an aborted one sets none');
    // a subframe failure is not the page's
    wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'https://ads.example/', false);
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].error, undefined);
    // bursts are coalesced and unchanged state is not repeated
    const n = r.emitted.length;
    for (let i = 0; i < 50; i++) wc.emit('did-stop-loading');
    r.flush();
    assert.ok(r.emitted.length <= n + 1, 'a burst of events is one message at most');
    const n2 = r.emitted.length;
    wc.emit('did-stop-loading');
    r.flush();
    assert.strictEqual(r.emitted.length, n2, 'nothing changed: nothing sent');
    // mute round trip
    assert.ok((r.ctl.mute('s1', false) as { ok: true; state: BrowserState }).state.muted === false);
    assert.strictEqual(wc.muted, false);
    r.ctl.mute('s1', true);
    assert.strictEqual(wc.muted, true);
    // stop
    r.ctl.stop('s1');
    assert.strictEqual(wc.stops, 1);
  }
  // navigation goes through the view's helper, only for acceptable addresses
  {
    const r = rig();
    await r.ctl.open('s1');
    const s1 = r.sessions.get('s1')!;
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.invalid/', 'two words', '', 5, null, 'durbar-sim://pages/form', 'chrome://gpu', 'data:text/html,hi']) {
      const res = await r.ctl.navigate('s1', bad);
      assert.strictEqual(res.ok, false, `refused: ${String(bad)}`);
      assert.ok(!res.ok && typeof res.reason === 'string' && res.reason.length > 5);
    }
    assert.deepStrictEqual(s1.navs, [], 'nothing was loaded');
    assert.ok((await r.ctl.navigate('s1', 'localhost:3000')).ok);
    assert.ok((await r.ctl.navigate('s1', 'example.invalid/a')).ok);
    assert.deepStrictEqual(s1.navs, [{ url: 'http://localhost:3000/' }, { url: 'https://example.invalid/a' }]);
    await r.ctl.history('s1', 'back'); await r.ctl.history('s1', 'forward'); await r.ctl.history('s1', 'reload');
    assert.deepStrictEqual(s1.navs.slice(2), ['back', 'forward', 'reload']);
    assert.strictEqual((await r.ctl.history('s1', 'sideways')).ok, false);
    assert.strictEqual((await r.ctl.history('s2', 'back')).ok, false, 'no view yet: nothing to move');
    // under the simulator the test pages open, and only those
    const sim = rig({ sim: true });
    await sim.ctl.open('s1');
    assert.ok((await sim.ctl.navigate('s1', 'durbar-sim://pages/form')).ok);
    const before = sim.sessions.get('s1')!.navs.length;
    for (const bad of ['durbar-sim://evil/form', 'durbar-sim://user@pages/form', 'durbar-sim:pages/form', 'durbar-sim://pages:80/form', 'durbar-sim://' + 'a'.repeat(300)]) assert.strictEqual((await sim.ctl.navigate('s1', bad)).ok, false, `simulator: ${bad.slice(0, 40)}`);
    assert.strictEqual(sim.sessions.get('s1')!.navs.length, before, 'only pages on the test host load');
  }
  // open in the system browser: http(s) only
  {
    const r = rig();
    await r.ctl.open('s1');
    const wc = r.sessions.get('s1')!.wc;
    for (const u of ['about:blank', 'file:///etc/passwd', 'durbar-sim://pages/form', 'javascript:1', 'mailto:a@b.c', '']) {
      wc.url = u;
      assert.deepStrictEqual(await r.ctl.openSystem('s1'), { ok: false }, u);
    }
    wc.url = 'https://example.invalid/x';
    assert.deepStrictEqual(await r.ctl.openSystem('s1'), { ok: true });
    assert.deepStrictEqual(r.opened, ['https://example.invalid/x']);
    assert.deepStrictEqual(await r.ctl.openSystem('nobody'), { ok: false });
  }
  // teardown: off the window first, the view destroyed, the window told
  {
    const r = rig();
    await r.ctl.open('s1');
    r.ctl.bounds('s1', B);
    r.ctl.visible('s1', true);
    assert.strictEqual(r.win.children.length, 1);
    await r.ctl.destroy('s1');
    assert.deepStrictEqual(r.win.children, [], 'detached');
    assert.deepStrictEqual(r.destroyed, ['s1']);
    assert.strictEqual(r.emitted[r.emitted.length - 1].open, false, 'the window is told the page is gone');
    assert.deepStrictEqual(r.ctl.liveIds(), []);
    assert.strictEqual((await r.ctl.history('s1', 'back')).ok, false, 'nothing left to drive');
    await r.ctl.destroy('s9'); // safe for any id
    // a session opened again gets a new view
    const o = await r.ctl.open('s1');
    assert.ok(o.ok);
    assert.strictEqual(r.ensured.length, 2);
  }
  // a view that fails to start
  {
    const r = rig();
    const bad = makeBrowserController({
      known: () => true, sim: false, window: () => undefined, emit: () => undefined, openExternal: async () => undefined, consented: () => true, pageDialog: () => undefined, askLeave: async () => false,
      views: { ensureTabView: async () => { throw new Error('boom'); }, closeTabView: async () => undefined, destroySessionView: async () => undefined },
    });
    const res = await bad.open('s1');
    assert.ok(!res.ok && /could not start/.test(res.reason));
  }

  // ---- consent (FR-025d, Q2): no view before the user accepted ----
  {
    const r = rig({ consent: false });
    for (const res of [await r.ctl.open('s1'), await r.ctl.navigate('s1', 'localhost:3000'), await r.ctl.open('s1', 'example.invalid')]) assert.ok(!res.ok && res.needsConsent === true, 'refused until the note is accepted');
    assert.deepStrictEqual(r.ensured, [], 'no view is made before the user accepted');
    r.consent.on = true;
    assert.ok((await r.ctl.open('s1')).ok);
    assert.deepStrictEqual(r.ensured, ['s1']);
    assert.strictEqual(rig({ consent: false }).ctl.state('s1').ok, true, 'reading the state of a session without a view needs no consent and makes nothing');
  }
  // ---- page dialogs, the marker, the note, Leave (FR-025d, FR-025e) ----
  {
    const r = rig();
    await r.ctl.open('s1');
    const ev = r.sessions.get('s1')!.sv.events;
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    ev.onPageDialog!('s1', { type: 'confirm', text: 'Delete?', forAgent: false });
    r.flush();
    assert.deepStrictEqual(r.dialogs, [{ id: 's1', type: 'confirm', text: 'Delete?', shown: true, tabId: r.ctl.tabIds('s1')[0], bg: false }], 'a shown view says so');
    assert.strictEqual(r.emitted[r.emitted.length - 1].dialogOpen, true, 'the Dialog open marker');
    ev.onPageDialogClosed!('s1');
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].dialogOpen, false, 'the marker goes when the dialog closes');
    r.ctl.visible('s1', false);
    ev.onPageDialog!('s1', { type: 'alert', text: 'x', forAgent: false });
    assert.strictEqual((r.dialogs[1] as { shown: boolean }).shown, false, 'a hidden view says so');
    ev.onPageDialogClosed!('s1'); // the user's dialog above is answered: nothing waits now
    const nDialogs = r.dialogs.length;
    ev.onPageDialog!('s1', { type: 'alert', text: 'y', forAgent: true });
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].dialogOpen, false, 'a dialog main closed for the agent is not a Dialog open marker (nobody waits)');
    assert.strictEqual(r.dialogs.length, nDialogs, 'a dialog main closed for the agent raises no toast (only the bar note)');
    ev.onDialogNote!('s1', 'The page showed a dialog: "y"');
    ev.onPageDialogClosed!('s1');
    r.flush();
    const st = r.emitted[r.emitted.length - 1];
    assert.strictEqual(st.note, 'The page showed a dialog: "y"', 'the bar note of a dialog main closed for the agent');
    assert.strictEqual(st.dialogOpen, false);
    r.sessions.get('s1')!.wc.emit('did-start-navigation');
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].note, undefined, 'the note goes with the next navigation');
    assert.strictEqual(await ev.askLeave!('s1', true), true);
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    await ev.askLeave!('s1', false);
    assert.deepStrictEqual(r.leaves, [['s1', true, false], ['s1', false, true]], 'Leave asks with the target known or not, and whether the view is shown');
    await r.ctl.destroy('s1');
    assert.deepStrictEqual(r.dropped, ['s1'], 'a session that goes drops its waiting questions');
    r.ctl.detachAll();
    assert.deepStrictEqual(r.dropped, ['s1', undefined], 'a reloaded window page drops them all');
  }
  // ---- the one-time note is remembered in the settings file (FR-025d, Q2) ----
  {
    assert.deepStrictEqual(parseSettings('{"browserNoteAccepted":true}'), { browserNoteAccepted: true });
    for (const v of ['false', '"true"', '1', 'null']) assert.deepStrictEqual(parseSettings('{"browserNoteAccepted":' + v + '}'), {}, 'only true is kept: ' + v);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-bn-')), 'durbar-settings.json');
    const st = new SettingsStore(f);
    st.load();
    assert.strictEqual(st.browserNoteAccepted, false, 'not accepted by default');
    st.acceptBrowserNote();
    const back = new SettingsStore(f);
    back.load();
    assert.strictEqual(back.browserNoteAccepted, true, 'kept after a restart');
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  }
  // `shown` means the session's Browser tab is selected (visible), not that the view is attached: a covered open chat is still shown
  {
    const r = rig();
    await r.ctl.open('s1');
    const ev = r.sessions.get('s1')!.sv.events;
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    r.ctl.overlay('s1', true);
    assert.deepStrictEqual(r.win.children, [], 'covered: not attached');
    ev.onPageDialog!('s1', { type: 'alert', text: 'x', forAgent: false });
    await ev.askLeave!('s1', true);
    assert.strictEqual((r.dialogs[0] as { shown: boolean }).shown, true, 'a covered open chat is shown: no toast, no pull-forward');
    assert.deepStrictEqual(r.leaves[r.leaves.length - 1], ['s1', true, true]);
    r.ctl.visible('s1', false);
    ev.onPageDialog!('s1', { type: 'alert', text: 'y', forAgent: false });
    assert.strictEqual((r.dialogs[1] as { shown: boolean }).shown, false, 'another chat open: hidden');
  }
  // a capture that never answers (a page dialog is open) does not stop the cover
  {
    const r = rig({ snapshotMs: 30 });
    await r.ctl.open('s1');
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    r.sessions.get('s1')!.wc.capturePage = () => new Promise(() => undefined);
    const t0 = Date.now();
    assert.deepStrictEqual(await r.ctl.snapshot('s1'), { ok: false }, 'no picture, and it answers');
    assert.ok(Date.now() - t0 < 2000, 'within its time limit');
    assert.deepStrictEqual(r.ctl.overlay('s1', true), { ok: true });
    assert.deepStrictEqual(r.win.children, [], 'the view is hidden without the picture');
    const src = fs.readFileSync(path.join(ROOT, 'src/main/browser/controller.ts'), 'utf8');
    assert.ok(/Promise\.race\(\[t\.wc\.capturePage\(\)/.test(src), 'the capture has a time limit');
  }
  // ---- chat links (spec 080 T017, FR-030, FR-024): main classifies, whatever the window did ----
  {
    const HOSTILE = ['ms-msdt:/id', 'search-ms:query=x', 'search:query=x', 'ms-officecmd:x', 'ms-settings:x', 'smb://host/share', 'file:///etc/hostname', 'vscode://file/x', 'slack://open', 'tel:+123', 'MS-MSDT:x', '  ms-msdt:x', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://gpu', 'view-source:https://a.com', 'durbar-sim://pages/form', '', 'not a url', 'https://user:pw@example.invalid/', 'https://a.com/\u0001'];
    const r = rig();
    for (const u of HOSTILE) {
      const res = await r.ctl.openLink('s1', u);
      assert.strictEqual(res.ok, false, `refused or not opened: ${JSON.stringify(u)}`);
      if (/user:pw/.test(u)) assert.ok(!res.ok && !res.link, 'a web link with a user name is refused by the address rules, not as another scheme');
      else assert.ok(!res.ok && res.link === 'refused' && res.reason === 'Durbar opens only mail links in other apps.', `static refusal text for ${JSON.stringify(u)}: ${JSON.stringify(res)}`);
    }
    for (const bad of [undefined, null, 5, {}]) assert.strictEqual((await r.ctl.openLink('s1', bad)).ok, false);
    assert.deepStrictEqual(r.opened, [], 'zero shell.openExternal calls for the whole hostile list');
    assert.deepStrictEqual(r.ensured, [], 'and no view was made for a link that is not a web link');
    // a mail link: no offer to the system until the user's click
    const m = await r.ctl.openLink('s1', 'mailto:a@example.invalid');
    assert.ok(!m.ok && m.link === 'mailto' && m.reason === 'This link wants to open your mail app.');
    assert.deepStrictEqual(r.opened, [], 'a mail link opens nothing by itself');
    for (const u of HOSTILE.concat(['https://example.invalid/', 'http://localhost:3000/', 'MAILTO:x@y.z.evil'])) {
      if (u.toLowerCase().startsWith('mailto:')) continue;
      assert.deepStrictEqual(await r.ctl.openMail(u), { ok: false }, `openMail refuses ${JSON.stringify(u)}`);
    }
    assert.deepStrictEqual(r.opened, [], 'openMail never hands anything but mailto: to the system');
    assert.deepStrictEqual(await r.ctl.openMail('  mailto:a@example.invalid?subject=hi '), { ok: true });
    assert.deepStrictEqual(r.opened, ['mailto:a@example.invalid?subject=hi'], 'only after the click, and only the mail link');
    assert.deepStrictEqual(await r.ctl.openMail('MAILTO:x@y.z'), { ok: true }, 'the scheme is case-insensitive like the classifier');
    // 2026-10-30 security review: what is handed to the system is a normalised mail link from a conservative grammar, never the raw text
    {
      const HOSTILE_MAIL = ['mailto:a"b --x', 'mailto:a b@example.invalid', 'mailto:\\\\host\\share', 'mailto:%00@example.invalid', 'mailto:a@example.invalid?attach=C:\\x', 'mailto:' + 'a'.repeat(4000) + '@example.invalid',
        'mailto:a@example.invalid?subject=x%0d%0abcc=y', 'mailto:a@example.invalid?body=hi', 'mailto:a@example.invalid?from=b@example.invalid', 'mailto:a@example.invalid?subject=hi&attach=x', 'mailto:a@example.invalid?cc=<b@example.invalid>',
        'mailto:<a>@example.invalid', 'mailto:a@example.invalid%22', 'mailto:a%5Cb@example.invalid', 'mailto:a%20b@example.invalid', 'mailto:', 'mailto:@example.invalid', 'mailto:a@example.invalid?', 'mailto:a@example.invalid?subject', 'mailto:a@example.invalid?subject=%00',
        'mailto:a@example.invalid?subject=a b', 'mailto:a@example.invalid,,b@example.invalid', 'mailto:a@example.invalid?cc=x', 'mailto:a..b@example.invalid', 'mailto:a@example.invalid?subject=' + 'x'.repeat(600),
        // escaped Unicode controls and format characters, invalid UTF-8, double encoding (2026-10-30 review)
        'mailto:a@example.invalid?subject=x%C2%85y', 'mailto:a@example.invalid?subject=x%E2%80%A8y', 'mailto:a@example.invalid?subject=x%E2%80%A9y', 'mailto:a@example.invalid?subject=x%E2%80%AEy', 'mailto:a@example.invalid?subject=x%E2%81%A6y', 'mailto:a@example.invalid?subject=x%E2%80%8By',
        'mailto:a@example.invalid?subject=x%EF%BB%BFy', 'mailto:a@example.invalid?subject=x%C2%9Fy', 'mailto:a%C2%85@example.invalid', 'mailto:a@example.invalid?subject=%C0%80', 'mailto:a@example.invalid?subject=%2541', 'mailto:a%2541@example.invalid',
        'mailto:a@example.invalid?subject=%25%30A', 'mailto:a@example.invalid?subject=%25%32%35', 'mailto:a@example.invalid?subject=x%C2%ADy', 'mailto:a@example.invalid?subject=x%E2%81%A0y', 'mailto:a@example.invalid?subject=x%F3%A0%80%81y', 'mailto:a@example.invalid?subject=50%25', 'mailto:a@example.invalid?subject=x%E2%80%8Dy',
        // host labels and the local part
        'mailto:a@.', 'mailto:a@-.com', 'mailto:a@-b.com', 'mailto:a@b-.com', 'mailto:a@b..com', 'mailto:a@b.com.', 'mailto:-a@b.com', 'mailto:a@example.invalid?cc=a@-b.com'];
      const r2 = rig();
      for (const u of HOSTILE_MAIL) {
        assert.deepStrictEqual(await r2.ctl.openMail(u), { ok: false }, `openMail refuses ${JSON.stringify(u.slice(0, 60))}`);
        const c = await r2.ctl.openLink('s1', u);
        assert.ok(!c.ok && c.link === 'refused' && c.reason === 'Durbar opens only mail links in other apps.', `a hostile mail link is refused with static text and no button: ${JSON.stringify(u.slice(0, 60))}`);
      }
      assert.deepStrictEqual(r2.opened, [], 'nothing hostile reached the system');
      const GOOD: [string, string][] = [['mailto:a@example.invalid?subject=Hi%20there', 'mailto:a@example.invalid?subject=Hi%20there'], ['  MAILTO:a@example.invalid,b+c@example.invalid?cc=d@example.invalid&Subject=x', 'mailto:a@example.invalid,b+c@example.invalid?cc=d@example.invalid&subject=x'], ['mailto:a%2Bb@example.invalid', 'mailto:a%2Bb@example.invalid'], ['mailto:a@example.invalid?subject=caf%C3%A9', 'mailto:a@example.invalid?subject=caf%C3%A9'], ['mailto:a@x-y.example.invalid', 'mailto:a@x-y.example.invalid']];
      for (const [raw, norm] of GOOD) {
        const lr = await r2.ctl.openLink('s1', raw);
        assert.ok(!lr.ok && lr.link === 'mailto', `a good mail link is offered: ${raw}`);
        assert.deepStrictEqual(await r2.ctl.openMail(raw), { ok: true }, raw);
        assert.strictEqual(r2.opened[r2.opened.length - 1], norm, 'the normalised href is what opens');
      }
      assert.strictEqual(r2.opened.length, GOOD.length);
      // the link's own text never reaches the system as sent: only the parsed one does
      const src = fs.readFileSync(path.join(ROOT, 'src/main/browser/controller.ts'), 'utf8');
      assert.ok(/const href = parseMailto\(url\);[\s\S]*?deps\.openExternal\(href\)/.test(src) && !/openExternal\(\(url as string\)/.test(src), 'openMail hands over the normalised href');
    }
    // a web link opens in that session's own view, never in another (SC-002, FR-030)
    const a = await r.ctl.openLink('s1', 'https://example.invalid/docs?x=1');
    assert.ok(a.ok);
    const b = await r.ctl.openLink('s2', 'http://localhost:3000/');
    assert.ok(b.ok);
    assert.deepStrictEqual(r.sessions.get('s1')!.navs, [{ url: 'https://example.invalid/docs?x=1' }], "A's link loads in A only");
    assert.deepStrictEqual(r.sessions.get('s2')!.navs, [{ url: 'http://localhost:3000/' }], "B's link loads in B only");
    assert.deepStrictEqual(r.opened.length, 2, 'a web link never calls the system either (only the two mail clicks above)');
    assert.strictEqual((await r.ctl.openLink('nobody', 'https://example.invalid/')).ok, false, 'the session is looked up in main');
    assert.strictEqual((await r.ctl.openLink('../s1', 'https://example.invalid/')).ok, false);
    // the one-time note comes first
    const c = rig({ consent: false });
    const cr = await c.ctl.openLink('s1', 'https://example.invalid/');
    assert.ok(!cr.ok && cr.needsConsent === true && c.ensured.length === 0, 'no view before the note is accepted');
    // the simulator's test pages only under the simulator
    const sim = rig({ sim: true });
    assert.ok((await sim.ctl.openLink('s1', 'durbar-sim://pages/form')).ok);
    assert.ok(!(await sim.ctl.openLink('s1', 'durbar-sim://evil/form')).ok);
    const nosim = rig();
    assert.ok(!(await nosim.ctl.openLink('s1', 'durbar-sim://pages/form')).ok, 'refused outside the simulator');
    assert.deepStrictEqual(nosim.sessions.size, 0);
  }
  // ---- the soft cap on loaded pages (FR-011, T013 AC3/AC4) ----
  {
    let clock = 1000;
    const mk = () => rig({ now: () => clock++ });
    const loadIn = async (r: ReturnType<typeof mk>, id: string, url: string, keep = false): Promise<void> => {
      await r.ctl.open(id);
      r.ctl.bounds(id, B);
      r.ctl.visible(id, true);
      await r.ctl.navigate(id, url);
      r.flush();
      if (!keep) r.ctl.visible(id, false);
    };
    const urlOf = (r: ReturnType<typeof mk>, id: string): string => (r.ctl.stateOf(id) as BrowserState).url;
    // six pages with no forms: four stay loaded, the two least recently shown are dropped, and come back with the note
    {
      const r = mk();
      for (let i = 1; i <= 6; i++) await loadIn(r, 's' + i, `https://site${i}.example/`);
      r.flush();
      const loaded = ['s1', 's2', 's3', 's4', 's5', 's6'].filter((id) => urlOf(r, id) !== '');
      assert.deepStrictEqual(loaded, ['s3', 's4', 's5', 's6'], 'four are loaded; the two least recently shown were dropped');
      assert.strictEqual(r.sessions.get('s1')!.wc.url, 'about:blank');
      assert.strictEqual((r.ctl.stateOf('s6') as BrowserState).memory, undefined, 'no note while a safe view could be dropped');
      // shown again: it reloads its own address, says so, and another view makes room
      r.ctl.bounds('s1', B);
      r.ctl.visible('s1', true);
      r.flush();
      assert.deepStrictEqual(r.sessions.get('s1')!.navs.slice(-1), [{ url: 'https://site1.example/' }], 'reloaded from its kept address');
      assert.strictEqual((r.ctl.stateOf('s1') as BrowserState).memory, 'reloaded', 'with *Reloaded to save memory*');
      const loaded2 = ['s1', 's2', 's3', 's4', 's5', 's6'].filter((id) => urlOf(r, id) !== '');
      assert.strictEqual(loaded2.length, 4, 'still four loaded');
      assert.ok(urlOf(r, 's1') !== '' && urlOf(r, 's2') === '' && urlOf(r, 's3') === '', 's2 and s3 are the least recently shown now');
      // the note goes with the next navigation of that view
      await r.ctl.navigate('s1', 'https://other.example/');
      r.flush();
      assert.strictEqual((r.ctl.stateOf('s1') as BrowserState).memory, undefined);
      // the view on screen is never dropped
      const shown = mk();
      await loadIn(shown, 's1', 'https://a.example/', true);
      for (let i = 2; i <= 6; i++) await loadIn(shown, 's' + i, `https://site${i}.example/`);
      assert.notStrictEqual(urlOf(shown, 's1'), '', 'the shown view stays loaded');
    }
    // typing in a page protects it (AC4): five typed pages are never dropped, the sixth says too many are open
    {
      const r = mk();
      for (let i = 1; i <= 5; i++) {
        await loadIn(r, 's' + i, `https://site${i}.example/`);
        r.sessions.get('s' + i)!.wc.emit('input-event', {}, { type: 'char' });
      }
      await loadIn(r, 's6', 'https://site6.example/');
      r.flush();
      for (let i = 1; i <= 6; i++) assert.notStrictEqual(urlOf(r, 's' + i), '', `s${i} stays loaded`);
      assert.strictEqual((r.ctl.stateOf('s6') as BrowserState).memory, 'many', 'the newest says *Many pages are open; close some to save memory*');
      // a key that is not a character does not protect a page; a new page resets the protection
      const k = mk();
      for (let i = 1; i <= 5; i++) await loadIn(k, 's' + i, `https://site${i}.example/`);
      k.sessions.get('s2')!.wc.emit('input-event', {}, { type: 'keyDown' });
      k.flush();
      assert.strictEqual(urlOf(k, 's1'), '', 'a plain key down protects nothing: s1 (least recent) was dropped');
      const n = mk();
      for (let i = 1; i <= 4; i++) await loadIn(n, 's' + i, `https://site${i}.example/`);
      n.sessions.get('s1')!.wc.emit('input-event', {}, { type: 'char' });
      await n.ctl.navigate('s1', 'https://fresh.example/'); // a new page: typing counts from its load
      await loadIn(n, 's5', 'https://site5.example/');
      assert.ok(urlOf(n, 's1') === '' || urlOf(n, 's2') === '', 'after a new page the old typing no longer protects it');
    }
    // a link clicked in a dropped page's chat: the new address wins, the old one is never loaded over it (2026-10-30 review)
    {
      const r = mk();
      for (let i = 1; i <= 6; i++) await loadIn(r, 's' + i, `https://site${i}.example/`);
      r.flush();
      assert.strictEqual(urlOf(r, 's1'), '', 'precondition: s1 was dropped');
      const res = await r.ctl.openLink('s1', 'https://clicked.example/new');
      assert.ok(res.ok);
      r.ctl.bounds('s1', B);
      r.ctl.visible('s1', true);
      r.flush();
      assert.deepStrictEqual(r.sessions.get('s1')!.navs.slice(-1), [{ url: 'https://clicked.example/new' }], 'the clicked page is the last navigation: the old address is not reloaded over it');
      assert.strictEqual(urlOf(r, 's1'), 'https://clicked.example/new');
      assert.strictEqual((r.ctl.stateOf('s1') as BrowserState).memory, undefined, 'and no *Reloaded to save memory* note');
      assert.ok(!r.sessions.get('s1')!.navs.some((n, i, a) => i > 0 && (n as { url?: string }).url === 'https://site1.example/' && i > a.length - 3), 'site1 is not loaded again');
      // Reload on a dropped page brings it back; Back or typing an address does not load the old page
      const k = mk();
      for (let i = 1; i <= 6; i++) await loadIn(k, 's' + i, `https://site${i}.example/`);
      k.flush();
      await k.ctl.history('s1', 'reload');
      k.flush();
      assert.deepStrictEqual(k.sessions.get('s1')!.navs.slice(-1), [{ url: 'https://site1.example/' }], 'Reload on a dropped page loads its kept address');
      assert.strictEqual((k.ctl.stateOf('s1') as BrowserState).memory, 'reloaded');
      const m = mk();
      for (let i = 1; i <= 6; i++) await loadIn(m, 's' + i, `https://site${i}.example/`);
      m.flush();
      await m.ctl.navigate('s1', 'https://typed.example/');
      m.ctl.bounds('s1', B);
      m.ctl.visible('s1', true);
      m.flush();
      assert.strictEqual(urlOf(m, 's1'), 'https://typed.example/', 'a typed address wins too');
    }
    // a page reached by a form is never dropped (the history's transition type)
    {
      const r = mk();
      await loadIn(r, 's1', 'https://form.example/');
      r.sessions.get('s1')!.sv.events.onNavigationKind!('s1', 'form_submit');
      for (let i = 2; i <= 6; i++) await loadIn(r, 's' + i, `https://site${i}.example/`);
      r.flush();
      assert.notStrictEqual(urlOf(r, 's1'), '', 'the form page stays');
      assert.strictEqual(urlOf(r, 's2'), '', 'the next least recent was dropped instead');
      const src = fs.readFileSync(path.join(ROOT, 'src/main/browser/views.ts'), 'utf8');
      assert.ok(/Page\.getNavigationHistory/.test(src) && /onNavigationKind/.test(src), 'views.ts reads the transition type from the debugger it owns');
    }
  }
  // ---- the still picture ----
  {
    const r = rig();
    await r.ctl.open('s1');
    assert.deepStrictEqual(await r.ctl.snapshot('s1'), { ok: false }, 'nothing to show while the view is not attached');
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    assert.deepStrictEqual(await r.ctl.snapshot('s1'), { ok: true, image: 'data:image/png;base64,AAAA' });
    r.sessions.get('s1')!.wc.shot = 'javascript:alert(1)';
    assert.deepStrictEqual(await r.ctl.snapshot('s1'), { ok: false }, 'only an image data URL goes to the window');
    assert.deepStrictEqual(await r.ctl.snapshot('nobody'), { ok: false });
  }
  {
    // the dialog text a toast shows is masked and cut
    const { dialogText } = await import('../src/main/hardening');
    const tok = 'gh' + 'p_' + 'A1b2'.repeat(9);
    const t = dialogText(`Delete item 1? token=${tok} ${'x'.repeat(300)}`, 80);
    assert.ok(!t.includes(tok) && t.length <= 81, 'masked and cut: ' + t);
    assert.strictEqual(dialogText({ a: 1 }, 80), '');
    assert.strictEqual(dialogText('a\u0000b\u001fc', 80), 'a b c');
  }

  // ---- 1b. spec 080 T021/T023: page tabs (US6, FR-120..FR-133, SC-010) ----
  const tabsNow = (r: ReturnType<typeof rig>, id = 's1') => r.ctl.tabsOf(id);
  const activeOf = (r: ReturnType<typeof rig>, id = 's1') => r.ctl.tabsOf(id).active;
  const viewOf = (r: ReturnType<typeof rig>, tabId: string, id = 's1') => r.tabViews.get(id + '/' + tabId);
  const lastNav = (f: ReturnType<typeof fakeSession> | undefined) => (f ? f.navs[f.navs.length - 1] : undefined);
  const tick = (): Promise<void> => new Promise((res) => setImmediate(res));
  // US6.1: the toggle off (the default): a chat link loads in the active tab, no tab is added
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.navigate('s1', 'https://a.example/one');
    const first = activeOf(r);
    const o = await r.ctl.openLink('s1', 'https://b.example/two');
    assert.ok(o.ok);
    assert.strictEqual(r.ctl.tabIds('s1').length, 1, 'toggle off: no tab added');
    assert.deepStrictEqual(lastNav(viewOf(r, first)), { url: 'https://b.example/two' }, 'loaded in the active tab, as FR-030');
    assert.ok(o.ok && o.linksNewTab === false, 'the window learns the toggle from main');
  }
  // US6.2, US6.3: the toggle on: a new tab to the right, active, the old page stays; the same link focuses its tab without reloading it
  {
    const r = rig();
    r.links.on = true;
    await r.ctl.open('s1');
    await r.ctl.openLink('s1', 'http://localhost:5173/'); // the first, empty tab takes the first link
    const t1 = activeOf(r);
    assert.strictEqual(r.ctl.tabIds('s1').length, 1, 'the empty first tab took the link (no empty tab left beside it)');
    await r.ctl.openLink('s1', 'https://docs.example/x');
    const ids = r.ctl.tabIds('s1');
    assert.strictEqual(ids.length, 2, 'a new tab');
    const t2 = activeOf(r);
    assert.notStrictEqual(t2, t1, 'the new tab is active');
    assert.deepStrictEqual(ids, [t1, t2], 'to the right of the active tab');
    assert.strictEqual(viewOf(r, t1)!.wc.url, 'http://localhost:5173/', 'the page I was on stays loaded in its tab');
    const n1 = viewOf(r, t1)!.navs.length;
    await r.ctl.openLink('s1', 'http://localhost:5173/#top');
    assert.strictEqual(activeOf(r), t1, 'the same link (fragment aside) focuses its tab');
    assert.strictEqual(r.ctl.tabIds('s1').length, 2, 'no tab added');
    assert.strictEqual(viewOf(r, t1)!.navs.length, n1, 'a live match is not reloaded');
    await r.ctl.openLink('s1', 'http://LOCALHOST:5173');
    assert.strictEqual(r.ctl.tabIds('s1').length, 2, 'host case and the trailing slash match too');
    // the menu's Open in a new tab takes the same path with the toggle off
    r.links.on = false;
    await r.ctl.openLink('s1', 'https://third.example/', 'newTab');
    assert.strictEqual(r.ctl.tabIds('s1').length, 3, 'how=newTab opens a tab whatever the toggle');
    // a link clicked twice before it commits: the second finds the first through its pending address
    hold.on = true;
    await r.ctl.openLink('s1', 'https://slow.example/', 'newTab');
    await r.ctl.openLink('s1', 'https://slow.example/', 'newTab');
    assert.strictEqual(r.ctl.tabIds('s1').length, 4, 'one tab for a double click');
    hold.on = false; hold.release();
    await tick();
    // refused links make no tab
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ms-msdt:/id x', 'search-ms:query=x', 'chrome://gpu', 'https://u:p@evil.example/', ' VSCODE://x', 'data:text/html,x']) {
      const res = await r.ctl.openLink('s1', bad, 'newTab');
      assert.strictEqual(res.ok, false, `refused: ${bad}`);
    }
    const mail = await r.ctl.openLink('s1', 'mailto:a@b.example', 'newTab');
    assert.ok(!mail.ok && mail.link === 'mailto', 'mailto keeps its offer, no tab');
    assert.strictEqual(r.ctl.tabIds('s1').length, 4, 'a refused or mail link makes no tab');
    assert.deepStrictEqual(r.opened, [], 'and nothing reaches the system');
    // `how` is checked in main
    for (const how of ['evil', 1, {}, null, 'NEWTAB']) assert.strictEqual((await r.ctl.openLink('s1', 'https://x.example/', how)).ok, false, `how=${JSON.stringify(how)} refused`);
    assert.strictEqual(r.ctl.tabIds('s1').length, 4, 'a refused how has no effect');
  }
  // US6.5, FR-126: 10 tabs per session, on every path
  {
    const r = rig();
    await r.ctl.open('s1');
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    for (let i = 1; i < 10; i++) assert.ok((await r.ctl.newTab('s1')).ok, 'tab ' + (i + 1));
    assert.strictEqual(r.ctl.tabIds('s1').length, 10);
    const full = await r.ctl.newTab('s1');
    assert.ok(!full.ok && full.tabLimit === true && /10 tabs/.test(full.reason), '+ and Ctrl+T at 10: refused with the limit text');
    assert.strictEqual(r.ctl.tabIds('s1').length, 10, 'no 11th tab');
    r.flush();
    assert.strictEqual(r.emitted[r.emitted.length - 1].tabLimit, true, 'the bar says so');
    r.links.on = true;
    const act = activeOf(r);
    await r.ctl.navigate('s1', 'https://ten.example/'); // the active tab has a page (an empty one would simply take the link)
    await r.ctl.openLink('s1', 'https://eleven.example/');
    assert.strictEqual(r.ctl.tabIds('s1').length, 10, 'a chat link at 10 makes no tab');
    assert.deepStrictEqual(lastNav(viewOf(r, act)), { url: 'https://eleven.example/' }, 'it loads in the active tab instead');
    assert.strictEqual(r.ctl.stateOf('s1').tabLimit, true, 'with the limit note');
    const ev = viewOf(r, act)!.sv.events;
    assert.strictEqual(ev.onTabRequest!('s1', 'https://eleven.example/more', true), false, 'a page request at 10: refused (offered like a popup)');
    assert.strictEqual(r.ctl.tabIds('s1').length, 10);
    // other sessions are not affected
    await r.ctl.open('s2');
    assert.ok((await r.ctl.newTab('s2')).ok, 'the limit is per session');
    await r.ctl.closeTab('s1', r.ctl.tabIds('s1')[3]);
    assert.strictEqual(r.ctl.stateOf('s1').tabLimit, undefined, 'closing a tab clears the note');
  }
  // FR-004, FR-129: + makes an empty tab with no view; an address loads there
  {
    const r = rig();
    await r.ctl.open('s1');
    const views0 = r.ensured.length;
    const nt = await r.ctl.newTab('s1');
    assert.ok(nt.ok && nt.state.open && nt.state.url === '' && nt.state.tabId === activeOf(r));
    assert.strictEqual(r.ensured.length, views0, 'an empty New tab has no view');
    const t = activeOf(r);
    await r.ctl.navigate('s1', 'https://a.example/');
    assert.deepStrictEqual(lastNav(viewOf(r, t)), { url: 'https://a.example/' }, 'the address loads in the new tab');
    const nt2 = await r.ctl.newTab('s1', 'https://b.example/');
    assert.ok(nt2.ok && r.ctl.tabIds('s1').length === 3);
    assert.deepStrictEqual(lastNav(viewOf(r, activeOf(r))), { url: 'https://b.example/' }, 'newTab with an address loads it');
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'https://u:p@x.example/']) assert.strictEqual((await r.ctl.newTab('s1', bad)).ok, false, 'refused address: ' + bad);
    assert.strictEqual(r.ctl.tabIds('s1').length, 3, 'a refused address makes no tab');
    const n = rig({ consent: false });
    assert.ok((await n.ctl.newTab('s1')).ok === false && n.ctl.tabIds('s1').length === 0, 'no tab before the one-time note');
  }
  // FR-127 AC1: tab ids must have the shape AND belong to the session; anything else has no effect
  {
    const r = rig();
    await r.ctl.open('s1'); await r.ctl.newTab('s1');
    await r.ctl.open('s2');
    const [a1, a2] = r.ctl.tabIds('s1');
    const b1 = r.ctl.tabIds('s2')[0];
    const act = activeOf(r);
    for (const bad of [b1, '', 't123', 'T' + a1.slice(1), a1 + '0', '../' + a1, 5, null, undefined, {}, [a1], { toString: () => a1 }, 'tgggggggg', 't00000000']) {
      assert.strictEqual((await r.ctl.selectTab('s1', bad)).ok, false, `selectTab ${JSON.stringify(bad)} refused`);
      assert.strictEqual((await r.ctl.closeTab('s1', bad)).ok, false, `closeTab ${JSON.stringify(bad)} refused`);
    }
    assert.strictEqual(activeOf(r), act, 'nothing changed');
    assert.deepStrictEqual(r.ctl.tabIds('s1'), [a1, a2]);
    assert.deepStrictEqual(r.ctl.tabIds('s2'), [b1], 'another session\'s tab is untouched');
    for (const bad of [undefined, null, 5, 'nobody', '']) {
      assert.strictEqual((await r.ctl.newTab(bad)).ok, false);
      assert.strictEqual((await r.ctl.selectTab(bad, a1)).ok, false);
      assert.strictEqual((await r.ctl.closeTab(bad, a1)).ok, false);
    }
    assert.ok((await r.ctl.selectTab('s1', a1)).ok && activeOf(r) === a1, 'its own tab id works');
  }
  // FR-127 AC2: only the shown session's ACTIVE tab is attached; the existing channels act on the active tab
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.navigate('s1', 'https://a.example/');
    const t1 = activeOf(r);
    await r.ctl.newTab('s1', 'https://b.example/');
    const t2 = activeOf(r);
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    assert.deepStrictEqual(r.win.children, [viewOf(r, t2)!.view], 'the active tab is attached');
    await r.ctl.selectTab('s1', t1);
    assert.deepStrictEqual(r.win.children, [viewOf(r, t1)!.view], 'selecting a tab swaps the view; the background tab comes off');
    assert.deepStrictEqual(viewOf(r, t1)!.view.bounds, B, 'with the pane bounds');
    await r.ctl.history('s1', 'reload');
    assert.strictEqual(lastNav(viewOf(r, t1)), 'reload', 'reload acts on the active tab');
    assert.notStrictEqual(lastNav(viewOf(r, t2)), 'reload');
    r.ctl.mute('s1', false);
    assert.strictEqual(viewOf(r, t1)!.wc.muted, false);
    assert.strictEqual(viewOf(r, t2)!.wc.muted, true, 'mute is per tab');
    r.ctl.stop('s1');
    assert.strictEqual(viewOf(r, t1)!.wc.stops, 1);
    assert.strictEqual(viewOf(r, t2)!.wc.stops, 0);
    r.ctl.overlay('s1', true);
    assert.deepStrictEqual(r.win.children, [], 'an overlay hides the active tab');
    r.ctl.overlay('s1', false);
    r.ctl.visible('s1', false);
    assert.deepStrictEqual(r.win.children, []);
    await r.ctl.selectTab('s1', t2);
    assert.deepStrictEqual(r.win.children, [], 'a session that is not shown attaches nothing when its tab changes');
  }
  // FR-127 AC3: the tabs push has only the listed fields, primitives, cleaned titles and displayUrl addresses
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.navigate('s1', 'https://a.example/');
    const f = viewOf(r, activeOf(r))!;
    f.wc.url = 'https://user:pw@a.example/x';
    f.wc.title = 'T\u0000\u0007itle ' + 'y'.repeat(400);
    f.wc.emit('page-title-updated');
    await r.ctl.newTab('s1');
    r.flush();
    const t = r.tabsSeen[r.tabsSeen.length - 1];
    assert.deepStrictEqual(Object.keys(t).sort(), ['active', 'id', 'tabs']);
    assert.strictEqual(t.tabs.length, 2);
    for (const e of t.tabs) {
      for (const k of Object.keys(e)) assert.ok((TAB_KEYS as readonly string[]).includes(k), `tab key ${k}`);
      for (const [k, v] of Object.entries(e)) assert.ok(['string', 'boolean'].includes(typeof v), `${k} is a primitive`);
      assert.ok(/^t[0-9a-f]{8}$/.test(e.tabId));
    }
    assert.strictEqual(t.tabs[0].url, 'https://a.example/x', 'userinfo dropped');
    assert.ok(!/pw/.test(JSON.stringify(t)), 'no password in the push');
    assert.ok(t.tabs[0].title.length <= 200 && !/[\u0000-\u001f]/.test(t.tabs[0].title), 'title cleaned and cut');
    assert.strictEqual(t.tabs[1].title, '', 'an empty tab has no title (the window says New tab)');
    assert.strictEqual(r.emitted[r.emitted.length - 1].tabId, t.active, 'BrowserState carries the active tab id');
  }
  // US6.6: a tab closed while loading: its load stops, its view goes, nothing it sends afterwards changes anything
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.navigate('s1', 'https://keep.example/');
    const keep = activeOf(r);
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    hold.on = true;
    await r.ctl.newTab('s1', 'https://slow.example/');
    const slow = activeOf(r);
    await r.ctl.newTab('s1', 'https://right.example/');
    const right = activeOf(r);
    await r.ctl.selectTab('s1', slow);
    const fSlow = viewOf(r, slow)!;
    const ev = fSlow.sv.events;
    hold.on = false;
    await r.ctl.closeTab('s1', slow);
    assert.ok(fSlow.sv.closed, 'its view went');
    assert.ok(r.closedTabs.includes('s1/' + slow), 'through closeTabView (the partition stays)');
    assert.deepStrictEqual(r.destroyed, [], 'no session teardown');
    assert.strictEqual(activeOf(r), right, 'the tab to its right becomes active');
    assert.deepStrictEqual(r.win.children, [viewOf(r, right)!.view]);
    // three more pages loaded, so a page load counted for the closed tab would make the cap drop one of them
    await r.ctl.newTab('s1', 'https://p1.example/'); await r.ctl.newTab('s1', 'https://p2.example/'); await r.ctl.newTab('s1', 'https://p3.example/');
    await r.ctl.selectTab('s1', right);
    r.flush();
    const nState = r.emitted.length, nTabs = r.tabsSeen.length, nDialogs = r.dialogs.length;
    assert.strictEqual(r.ctl.tabsOf('s1').tabs.filter((x) => x.url && x.url !== '' && x.memory !== 'dropped').length, 4, 'precondition: four pages loaded, the cap is full');
    // late events of the closed tab (its webContents still emitting, as during a close in flight)
    fSlow.wc.destroyed = false;
    fSlow.wc.url = 'https://slow.example/'; fSlow.wc.emit('did-navigate'); fSlow.wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'x', true); fSlow.wc.emit('page-title-updated');
    ev.onPageDialog!('s1', { type: 'alert', text: 'late', forAgent: false });
    ev.onDialogNote!('s1', 'late note');
    assert.strictEqual(ev.onTabRequest!('s1', 'https://slow.example/pop', true), false, 'a closed tab opens no tab');
    ev.onTabKey!('s1', 'close');
    hold.release(); // its navigate promise settles now
    await tick(); r.flush();
    assert.strictEqual(r.dialogs.length, nDialogs, 'no toast from a closed tab');
    assert.deepStrictEqual(r.keys, [], 'no key from a closed tab');
    assert.strictEqual(r.ctl.tabIds('s1').length, 5);
    assert.ok(!r.ctl.tabsOf('s1').tabs.some((x) => x.memory === 'dropped'), 'its late page load made the cap drop nothing');
    assert.ok(r.emitted.length === nState && r.tabsSeen.length === nTabs, 'nothing it sent afterwards was told to the window');
    assert.strictEqual(r.ctl.stateOf('s1').tabId, right);
    assert.strictEqual(r.ctl.stateOf('s1').error, undefined, 'its failure is not the active tab\'s');
    // closing the rightmost active tab activates the one to its left
    const rightmost = r.ctl.tabIds('s1')[4];
    await r.ctl.selectTab('s1', rightmost);
    await r.ctl.closeTab('s1', rightmost);
    assert.strictEqual(activeOf(r), r.ctl.tabIds('s1')[3], 'else the tab to its left');
    assert.ok(r.ctl.tabIds('s1').includes(keep));
  }
  // the list and the active tab change in one step: a close never waits for the view's teardown, and no reader sees a removed tab as active
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.newTab('s1', 'https://a.example/');
    const a = activeOf(r);
    await r.ctl.newTab('s1', 'https://b.example/');
    await r.ctl.selectTab('s1', a);
    r.closeHold.on = true;
    const res = await r.ctl.closeTab('s1', a); // resolves although the view's teardown is still pending
    assert.ok(res.ok && res.state.tabId !== a && res.tabs!.active !== a && !res.tabs!.tabs.some((x) => x.tabId === a), 'the answer already has the new active tab');
    assert.notStrictEqual(activeOf(r), a, 'main\'s active tab moved with the list (a check-browser-tabs race, 2026-10-31)');
  }
  // a tab closed while its view is still being made never keeps a view
  {
    const r = rig();
    await r.ctl.open('s1');
    const p = r.ctl.newTab('s1', 'https://a.example/');
    const t = activeOf(r);
    const c = r.ctl.closeTab('s1', t);
    await p; await c; await tick();
    assert.ok(!r.ctl.tabIds('s1').includes(t), 'closed');
    assert.ok(r.closedTabs.includes('s1/' + t), 'its view is closed when it arrives');
  }
  // FR-128: closing a tab whose page asks: Stay keeps it, Leave closes it
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.newTab('s1', 'https://form.example/');
    const t = activeOf(r);
    viewOf(r, t)!.sv.leaveOnClose = false;
    await r.ctl.closeTab('s1', t);
    assert.ok(r.ctl.tabIds('s1').includes(t), 'Stay: the tab stays');
    assert.strictEqual(viewOf(r, t)!.sv.closeAsks, 1, 'the page was asked (beforeunload, Durbar\'s box)');
    viewOf(r, t)!.sv.leaveOnClose = true;
    await r.ctl.closeTab('s1', t);
    assert.ok(!r.ctl.tabIds('s1').includes(t), 'Leave: closed');
  }
  // US6.7: the last tab closed leaves one empty New tab with no view; the session browser (and its partition) stays
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.navigate('s1', 'https://a.example/');
    const only = activeOf(r);
    const n = r.ensured.length;
    const res = await r.ctl.closeTab('s1', only);
    assert.ok(res.ok);
    const ids = r.ctl.tabIds('s1');
    assert.strictEqual(ids.length, 1, 'one tab');
    assert.notStrictEqual(ids[0], only, 'a new, empty one');
    assert.strictEqual(r.ensured.length, n, 'with no view (FR-004)');
    assert.ok(res.ok && res.state.open && res.state.url === '', 'the browser is open on an empty tab');
    assert.deepStrictEqual(r.destroyed, [], 'only a session end wipes the partition');
    assert.ok((await r.ctl.open('s1')).ok && r.ensured.length === n, 'opening the Browser tab again keeps it empty');
    await r.ctl.navigate('s1', 'https://b.example/');
    assert.deepStrictEqual(lastNav(viewOf(r, ids[0])), { url: 'https://b.example/' }, 'an address makes its view');
  }
  // US6.8, FR-128: a session ending with several tabs, one asking Leave this page?: every view closes, the question drops, the partition goes once
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.navigate('s1', 'https://a.example/');
    await r.ctl.newTab('s1', 'https://b.example/');
    await r.ctl.newTab('s1');
    await r.ctl.newTab('s1', 'https://c.example/');
    const fakes = r.ctl.tabIds('s1').map((t) => viewOf(r, t)).filter(Boolean);
    assert.strictEqual(fakes.length, 3, 'three tabs with views, one empty');
    void fakes[1]!.sv.events.askLeave!('s1', true);
    await r.ctl.destroy('s1');
    assert.deepStrictEqual(r.destroyed, ['s1'], 'one session teardown (it closes every view, then clears the partition once)');
    assert.ok(fakes.every((f) => f!.sv.closed), 'every tab\'s view is closed');
    assert.ok(r.dropped.includes('s1'), 'the waiting question is dropped');
    assert.strictEqual(r.emitted[r.emitted.length - 1].open, false);
    assert.deepStrictEqual(r.tabsSeen[r.tabsSeen.length - 1], { id: 's1', active: '', tabs: [] }, 'the window is told the tabs are gone');
    assert.deepStrictEqual(r.ctl.tabIds('s1'), []);
    assert.strictEqual((await r.ctl.selectTab('s1', fakes[0]!.sv.tabId)).ok, false, 'an old tab id is refused after the end');
  }
  // FR-125: pages opening tabs (the hardening's windowOpen calls onTabRequest only for a same-origin http(s) request; see test:browserviews)
  {
    const r = rig();
    await r.ctl.open('s1');
    await r.ctl.navigate('s1', 'https://site.example/');
    const opener = activeOf(r);
    const ev = viewOf(r, opener)!.sv.events;
    assert.strictEqual(ev.onTabRequest!('s1', 'https://site.example/a', true), false, 'a session that is not shown never opens a tab (FR-007)');
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    assert.strictEqual(ev.onTabRequest!('s1', 'https://site.example/a', true), true, 'foreground-tab');
    await tick(); await tick();
    const fg = activeOf(r);
    assert.notStrictEqual(fg, opener, 'a foreground tab becomes active');
    assert.deepStrictEqual(r.ctl.tabIds('s1'), [opener, fg], 'to the right of the opener');
    assert.deepStrictEqual(lastNav(viewOf(r, fg)), { url: 'https://site.example/a' }, 'loaded through the view helper');
    assert.strictEqual(viewOf(r, fg)!.wc.focuses, 1, 'its page gets the focus (FR-129)');
    await r.ctl.selectTab('s1', opener);
    assert.strictEqual(ev.onTabRequest!('s1', 'https://site.example/b', false), true, 'background-tab');
    await tick(); await tick();
    assert.strictEqual(activeOf(r), opener, 'a background tab does not become active');
    assert.deepStrictEqual(r.ctl.tabIds('s1'), [opener, r.ctl.tabIds('s1')[1], fg], 'next to the opener');
    // a page that opens 50 tabs: 5 per page load, then refused
    let opened = 2;
    for (let i = 0; i < 50; i++) if (ev.onTabRequest!('s1', 'https://site.example/p' + i, false)) opened++;
    assert.strictEqual(opened, 5, 'at most 5 tabs per page load of one opener');
    await tick(); await tick();
    assert.strictEqual(r.ctl.tabIds('s1').length, 6);
    assert.strictEqual(activeOf(r), opener, 'none of them took the focus');
    // a new page load may open its own: until the 10-tab limit
    viewOf(r, opener)!.wc.emit('did-navigate');
    let more = 0;
    for (let i = 0; i < 50; i++) if (ev.onTabRequest!('s1', 'https://site.example/q' + i, false)) more++;
    assert.strictEqual(more, 4, 'the next load opens up to the 10-tab limit');
    assert.strictEqual(r.ctl.tabIds('s1').length, 10, 'never an 11th tab');
    // hostile schemes reaching the controller (defence in depth: the hardening refuses them first) make no tab and call nothing
    const r2 = rig();
    await r2.ctl.open('s1'); r2.ctl.bounds('s1', B); r2.ctl.visible('s1', true);
    const ev2 = viewOf(r2, activeOf(r2))!.sv.events;
    for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'ms-msdt:/id', 'search-ms:q', 'mailto:a@b.c', 'vscode://x', 'data:text/html,x', 'about:blank', '', 'https://u:p@x.example/']) assert.strictEqual(ev2.onTabRequest!('s1', u, true), false, 'refused: ' + u);
    assert.strictEqual(r2.ctl.tabIds('s1').length, 1, 'zero tabs');
    assert.deepStrictEqual(r2.opened, [], 'zero openExternal calls');
  }
  // FR-132: a dialog in a background tab of the shown session (toast, marker), or in a hidden session's tab (also brought forward on that tab)
  {
    const r = rig();
    await r.ctl.open('s1'); await r.ctl.navigate('s1', 'https://a.example/');
    const t1 = activeOf(r);
    await r.ctl.newTab('s1', 'https://b.example/');
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    viewOf(r, t1)!.sv.events.onPageDialog!('s1', { type: 'confirm', text: 'Delete?', forAgent: false });
    assert.deepStrictEqual(r.dialogs[0], { id: 's1', type: 'confirm', text: 'Delete?', shown: false, tabId: t1, bg: true }, 'a background tab of the shown session: not shown, bg');
    r.flush();
    const tl = r.tabsSeen[r.tabsSeen.length - 1];
    assert.strictEqual(tl.tabs.find((x) => x.tabId === t1)!.dialogOpen, true, 'the tab is marked Dialog open');
    assert.strictEqual(r.emitted[r.emitted.length - 1].dialogOpen, false, 'the active tab is not');
    assert.notStrictEqual(activeOf(r), t1, 'it is not selected by itself');
    r.ctl.visible('s1', false);
    viewOf(r, t1)!.sv.events.onPageDialog!('s1', { type: 'alert', text: 'x', forAgent: false });
    assert.deepStrictEqual(r.dialogs[1], { id: 's1', type: 'alert', text: 'x', shown: false, tabId: t1, bg: false }, 'a hidden session\'s tab: brought forward on that tab by the window');
  }
  // FR-130: a tab key inside a page goes to the window
  {
    const r = rig();
    await r.ctl.open('s1');
    viewOf(r, activeOf(r))!.sv.events.onTabKey!('s1', 'new');
    assert.deepStrictEqual(r.keys, [{ id: 's1', key: 'new' }]);
  }
  // US6.9, SC-010: 3 sessions x 10 tabs with pages loading in turn, through the real controller
  {
    let clock = 0;
    const r = rig({ now: () => ++clock });
    for (const id of ['s1', 's2', 's3']) await r.ctl.open(id);
    r.ctl.bounds('s1', B); r.ctl.visible('s1', true);
    const loadedNow = (): number => [...r.tabViews.values()].filter((f) => !f.sv.closed && typeof f.wc.url === 'string' && f.wc.url !== 'about:blank').length;
    let maxLoaded = 0;
    for (let round = 0; round < 11; round++) {
      for (const id of ['s1', 's2', 's3']) {
        const res = round === 0 ? await r.ctl.navigate(id, `https://${id}.example/0`) : await r.ctl.newTab(id, `https://${id}.example/${round}`);
        if (round === 10) assert.ok(!res.ok && (res as { tabLimit?: true }).tabLimit, 'the 11th tab is refused');
        await tick();
        maxLoaded = Math.max(maxLoaded, loadedNow());
        assert.ok(loadedNow() <= MAX_LIVE_VIEWS, `${id} round ${round}: ${loadedNow()} pages loaded`);
        // every pick is a background tab while one is loaded (all are safe here): an active tab of a hidden session is dropped only after them
        for (const h of ['s2', 's3']) {
          const tl = r.ctl.tabsOf(h);
          const act = tl.tabs.find((x) => x.tabId === tl.active);
          if (act && act.memory === 'dropped') {
            const bgLoaded = ['s1', 's2', 's3'].some((k) => r.ctl.tabsOf(k).tabs.some((x) => x.tabId !== r.ctl.tabsOf(k).active && x.memory !== 'dropped' && x.url));
            assert.ok(!bgLoaded, `${h}'s active tab was dropped while a background tab stayed loaded`);
          }
        }
      }
    }
    for (const id of ['s1', 's2', 's3']) assert.strictEqual(r.ctl.tabIds(id).length, 10, `${id} holds 10 tabs, never 11`);
    assert.strictEqual(maxLoaded, MAX_LIVE_VIEWS, 'the cap was reached and held');
    const shownActive = viewOf(r, activeOf(r, 's1'), 's1')!;
    assert.ok(!shownActive.sv.closed && shownActive.wc.url !== 'about:blank', 'the shown tab is never dropped');
    // US6.10: a dropped background tab brought back reloads its kept address; the #891 rule holds per tab
    const tl = r.ctl.tabsOf('s1');
    const dropped = tl.tabs.filter((x) => x.memory === 'dropped' && x.tabId !== tl.active);
    assert.ok(dropped.length >= 2, 'background tabs of the shown session were dropped');
    const [d1, d2] = dropped;
    const oldView = viewOf(r, d1.tabId, 's1');
    assert.ok(!oldView || oldView.sv.closed, 'a dropped background tab has no live view (its webContents closed)');
    assert.ok(r.closedTabs.includes('s1/' + d1.tabId), 'closed through closeTabView: no process left, partition kept');
    assert.ok(d1.url.startsWith('https://s1.example/'), 'its address is kept');
    // the #891 rule per tab: a navigation in the active tab never touches another tab's kept address
    await r.ctl.navigate('s1', 'https://s1.example/new-in-active');
    assert.strictEqual(r.ctl.tabsOf('s1').tabs.find((x) => x.tabId === d1.tabId)!.url, d1.url, 'tab B\'s kept address is untouched');
    await r.ctl.selectTab('s1', d1.tabId);
    await tick();
    const back = viewOf(r, d1.tabId, 's1')!;
    assert.ok(back && !back.sv.closed, 'selecting it makes a new view in the session');
    assert.deepStrictEqual(lastNav(back), { url: d1.url }, 'and loads the kept address');
    assert.strictEqual(r.ctl.stateOf('s1').memory, 'reloaded', 'with Reloaded to save memory');
    assert.deepStrictEqual(r.win.children, [back.view], 'and it is the one on the window');
    // reuse while dropped: with the toggle on, a chat link to a dropped tab's kept address focuses that tab, which reloads it
    r.links.on = true;
    const d2now = r.ctl.tabsOf('s1').tabs.find((x) => x.tabId === d2.tabId)!;
    if (d2now.memory === 'dropped') {
      const n = r.ctl.tabIds('s1').length;
      await r.ctl.openLink('s1', d2.url);
      await tick();
      assert.strictEqual(activeOf(r, 's1'), d2.tabId, 'the dropped tab with that address is focused');
      assert.strictEqual(r.ctl.tabIds('s1').length, n, 'no tab added');
      assert.deepStrictEqual(lastNav(viewOf(r, d2.tabId, 's1')), { url: d2.url }, 'and reloaded from its kept address');
    } else assert.fail('the second dropped tab came back by itself');
  }
  // FR-123: the toggle is saved as `chatLinksNewTab: true` only
  {
    assert.deepStrictEqual(parseSettings('{"chatLinksNewTab":true}'), { chatLinksNewTab: true });
    for (const v of ['false', '"true"', '1', 'null', '{}']) assert.deepStrictEqual(parseSettings('{"chatLinksNewTab":' + v + '}'), {}, 'only true is kept: ' + v);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-lt-')), 'durbar-settings.json');
    const st = new SettingsStore(f);
    st.load();
    assert.strictEqual(st.chatLinksNewTab, false, 'off by default');
    for (const bad of ['yes', 1, null, undefined, {}]) assert.strictEqual(st.setChatLinksNewTab(bad), false, 'a non-boolean changes nothing');
    st.setChatLinksNewTab(true);
    const back = new SettingsStore(f); back.load();
    assert.strictEqual(back.chatLinksNewTab, true, 'kept after a restart');
    back.setChatLinksNewTab(false);
    assert.ok(!/chatLinksNewTab/.test(fs.readFileSync(f, 'utf8')), 'the default is not written');
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  }

  // ---- 2. the wiring ----
  const CH = ['open', 'state', 'navigate', 'back', 'forward', 'reload', 'stop', 'bounds', 'visible', 'overlay', 'mute', 'openSystem', 'consentAccept', 'snapshot', 'leaveAnswer', 'openLink', 'openMail', 'newTab', 'selectTab', 'closeTab', 'setLinksNewTab'].map((c) => 'browser:' + c);
  const ipcSrc = read('src/main/ipc/browser.ts');
  const ctlSrc = read('src/main/browser/controller.ts');
  {
    const regs = [...ipcSrc.matchAll(/\bipcHandle\(\s*'([^']+)'/g)];
    assert.deepStrictEqual(regs.map((m) => m[1]).sort(), [...CH].sort(), 'src/main/ipc/browser.ts registers exactly the browser channels');
    regs.forEach((m, i) => {
      const block = ipcSrc.slice(m.index, i + 1 < regs.length ? regs[i + 1].index : ipcSrc.length);
      assert.ok(/\(fromApp\(e\) \?|if \(!fromApp\(e\)/.test(block), `${m[1]} calls fromApp(e) before it does anything`);
      assert.ok(/\(e, /.test(block) || /\(e\) =>/.test(block), `${m[1]} takes the event`);
    });
    assert.ok(/import \{ fromAppFrame as fromApp, ipcHandle \} from '\.\.\/ipcguard'/.test(ipcSrc), 'the guard is ipcguard.ts\'s own');
    // spec 080 FR-123, FR-127: the toggle takes only a real boolean; the window never sends the toggle with a link (main reads it)
    assert.ok(/ipcHandle\('browser:setLinksNewTab', \(e, on: unknown\) => \{\n\s*if \(!fromApp\(e\) \|\| typeof on !== 'boolean'\) return \{ ok: false \};/.test(ipcSrc), 'setLinksNewTab refuses a non-boolean with no effect');
    assert.ok(/ctl\.openLink\(id, url, how\)/.test(ipcSrc) && /linksNewTab = \(\): boolean => \(simulator \? simLinksNewTab : deps\.getSettingsStore\(\)\?\.chatLinksNewTab === true\)/.test(ipcSrc), 'the toggle is read in main');
    assert.ok(/if \(simulator\) simLinksNewTab = on;\n\s*else deps\.getSettingsStore\(\)\?\.setChatLinksNewTab\(on\);/.test(ipcSrc), 'the simulator writes no user settings');
    const pre = preloadChannels().all;
    for (const c of CH) assert.ok(pre.has(c), `the preload calls ${c}`);
    assert.deepStrictEqual([...pre].filter((c) => c.startsWith('browser:')).sort(), [...CH].sort(), 'the preload calls nothing else under browser:');
    assert.ok(/sub\('browser:state'/.test(read('src/preload/preload.ts')), 'the preload subscribes to browser:state');
    // the session id is looked up in main: agents, or the simulator's own ids under the simulator only
    assert.ok(/known: \(id\) => agents\.has\(id\) \|\| \(simulator && SIM_ID\.test\(id\)\)/.test(ipcSrc), 'known sessions: main\'s agents, plus sim-N under the simulator only');
    assert.ok(/sim: simulator/.test(ipcSrc) && /simulator \? Promise\.resolve\(false\) : shell\.openExternal\(url\)/.test(ipcSrc), 'the simulator never opens the desktop browser');
    assert.ok(/const consented = \(\): boolean => \(simulator && !deps\.simAsksConsent\) \|\| deps\.getSettingsStore\(\)\?\.browserNoteAccepted === true;/.test(ipcSrc) && /consented,\n/.test(ipcSrc), 'the view needs the accepted note (only the simulator may skip it)');
    assert.ok(/if \(!deps\.consented\(\)\) return needsConsent\(\);/.test(ctlSrc), 'open and navigate refuse until then');
    // nothing here reads the page
    const FORBIDDEN = /executeJavaScript|\.cookies\b|insertCSS|savePage|printToPDF|getAllWebContents|\.debugger\b|sendCommand|fromPartition|\.session\b|clearStorageData|readFile|shell\.openPath|getFocusedWebContents|webContents\.send|ipcRenderer/;
    for (const [name, src] of [['controller.ts', ctlSrc], ['ipc/browser.ts', ipcSrc]] as const) assert.ok(!FORBIDDEN.test(src), `${name} reads nothing from the page (${FORBIDDEN.exec(src)?.[0]})`);
    assert.strictEqual((ctlSrc.match(/capturePage/g) ?? []).length, 2, 'capturePage: its type and the one call in snapshot()');
    assert.ok(/async snapshot\([\s\S]*?t\.wc\.capturePage\(\)[\s\S]*?toDataURL\(\)/.test(ctlSrc) && !/writeFile|toPNG|toJPEG|toBitmap/.test(ctlSrc + ipcSrc), 'the still picture is an in-memory data URL, never written');
    assert.ok(!/\bloadURL\(|\.reload\(|goToIndex|Page\.navigate/.test(ctlSrc + ipcSrc), 'every navigation goes through the view\'s navigate() helper (FR-024)');
    assert.ok(/shell\.openExternal/.test(ipcSrc) && !/openExternal\(.*(?:address|text)/.test(ctlSrc), 'only the view\'s own http(s) address goes to the system browser');
  }
  {
    // the teardown wiring: end, remove, folder remove, a replaced session, and quit
    const blockOf = (file: string, channel: string): string => {
      const src = read(file);
      const m = new RegExp(`ipcHandle\\(\\s*'${channel}'`).exec(src);
      assert.ok(m, `${channel} is registered in ${file}`);
      const next = src.slice(m.index + 10).search(/\bipc(?:Handle|On)\(\s*'/);
      return src.slice(m.index, next < 0 ? src.length : m.index + 10 + next);
    };
    assert.ok(/deps\.browserGone\?\.\(id\)/.test(blockOf('src/main/ipc/agents.ts', 'agents:end')), 'End session destroys the browser');
    assert.ok(/deps\.browserGone\?\.\(a\.id\)/.test(blockOf('src/main/ipc/agents.ts', 'agents:remove')), 'Remove session destroys the browser');
    assert.ok(/deps\.browserGone\?\.\(rid\)/.test(blockOf('src/main/ipc/folders.ts', 'folders:remove')), 'Remove folder destroys each session\'s browser');
    assert.ok(/deps\.browserGone\?\.\(removedId\)/.test(read('src/main/ipc/previous.ts')), 'a replaced session\'s browser is destroyed');
    const mainSrc = read('src/main/main.ts');
    for (const reg of ['registerAgentsIpc', 'registerFoldersIpc', 'registerPreviousIpc']) assert.ok(new RegExp(`${reg}\\(\\{ browserGone,`).test(mainSrc), `main.ts hands browserGone to ${reg}`);
    assert.ok(/const browser = registerBrowserIpc\(\{ agents, getWin: \(\) => win, toRenderer, simulator: SIMULATOR, simAsksConsent: dev\.DURBAR_SIM_BROWSER_CONSENT === 'ask', getSettingsStore: \(\) => settingsStore \}\);/.test(mainSrc), 'main.ts registers the browser IPC with its own simulator decision');
    assert.ok(/destroyAllViews\(\)/.test(mainSrc) && /app\.on\('will-quit'/.test(mainSrc), 'quit destroys every view');
    assert.ok(/win\.webContents\.on\('did-start-loading', \(\) => browser\.detachAll\(\)\)/.test(mainSrc), 'a reloaded window page takes the views off');
  }

  // ---- 3. the simulator pages ----
  {
    const get = (p: string) => simPage('durbar-sim://pages/' + p);
    for (const [name, needle] of [['index', 'Simulator test pages'], ['links', 'id="l-form"'], ['form', 'method="post"'], ['getform', 'name="q"'], ['file', 'type="file"'], ['unload', 'beforeunload'], ['alert', 'alert('], ['confirm', 'confirm('], ['prompt', 'prompt('], ['', 'Simulator test pages']] as const) {
      const r = await get(name);
      assert.strictEqual(r.status, 200, name);
      assert.ok(r.body.includes(needle), `${name} has ${needle}`);
      assert.ok(/text\/html/.test(r.headers['content-type']));
    }
    const al = await get('alert?ms=50&n=2');
    assert.ok(/setTimeout\(go,50\)/.test(al.body) && /var n=2/.test(al.body) && /token=gh/.test(al.body), 'the alert page: delay and count from the query');
    assert.ok(!/ghp_/.test(fs.readFileSync(path.join(ROOT, 'src/main/browser/simpages.ts'), 'utf8')), 'no secret-looking literal in the source');
    // T018 AC2: the sensitive fields, the sliding element, the script redirect, the basic-auth challenge, storage, a second host
    const fields = (await get('fields')).body;
    for (const needle of ['type="password"', 'autocomplete="one-time-code"', 'autocomplete="cc-number"']) assert.ok(fields.includes(needle), `fields page: ${needle}`);
    const slide = (await get('slide')).body;
    assert.ok(/id="target"/.test(slide) && /id="cover"/.test(slide) && /animation:s 400ms/.test(slide), 'the sliding element page');
    assert.ok(/location\.replace\("durbar-sim:\/\/other\/landing"\)/.test((await get('redirect')).body), 'the script redirect goes to the other test host');
    const other = await simPage('durbar-sim://other/landing');
    assert.ok(other.status === 200 && other.body.includes('other host'));
    assert.strictEqual((await simPage('durbar-sim://other/form')).status, 404, 'the other host serves its landing page only');
    const auth = await get('auth');
    assert.ok(auth.status === 401 && /Basic realm/.test(auth.headers['www-authenticate']), 'a basic-auth challenge');
    const st = (await get('storage?set=v1')).body;
    assert.ok(/localStorage\.setItem/.test(st) && /"v1"/.test(st), 'the storage page writes only on ?set=');
    assert.ok(!(await get('storage?set=' + encodeURIComponent('</script><b>x'))).body.includes('</script><b>'), 'a value cannot close the script tag');
    const dl = await get('download');
    assert.ok(/attachment/.test(dl.headers['content-disposition']), 'the download page sends an attachment');
    const post = await simPage('durbar-sim://pages/form', 'POST', 'name=Ada&note=a+%3Cb%3E');
    assert.ok(post.body.includes('Got 2 field(s)') && post.body.includes('a &lt;b&gt;') && !post.body.includes('<b>'), 'the POST page counts fields and escapes them');
    assert.ok((await simPage('durbar-sim://pages/form', 'POST', '%E0%A4%A')).status === 200, 'a malformed body does not throw');
    assert.ok((await simPage('durbar-sim://pages/getform?q=%3Cscript%3E')).body.includes('&lt;script&gt;'), 'the GET form escapes');
    {
      /* the alert page's script holds page text: it must not be able to end the <script> (CodeQL js/bad-code-sanitization) */
      const al = await simPage('durbar-sim://pages/alert?html=1&ms=10');
      const open = al.body.indexOf('<script>'), close = al.body.indexOf('</script>', open);
      const inline = open >= 0 && close > open ? al.body.slice(open + '<script>'.length, close) : '';
      assert.ok(inline.includes('alert('), 'the alert page has its inline script');
      assert.ok(!/<\/|<!--|<img/i.test(inline), 'no </script>, <!-- or markup inside the alert script (page text is written with \\u003c)');
      assert.ok(inline.includes('\\u003cimg'), 'the markup in the page text is data, not part of the script');
    }
    const t0 = Date.now();
    const slow = await simPage('durbar-sim://pages/slow?ms=30');
    assert.ok(Date.now() - t0 >= 25 && slow.body.includes('waited 30 ms'), 'the slow page waits');
    for (const bad of ['durbar-sim://pages/nope', 'durbar-sim://other/form', 'durbar-sim://pages/../etc/passwd', 'durbar-sim://pages/constructor', 'durbar-sim://pages/__proto__', 'https://pages/form', 'not a url', 'file:///etc/passwd']) {
      assert.strictEqual((await simPage(bad)).status, 404, `404: ${bad}`);
    }
    // no page reads a file or the network
    const simSrc = read('src/main/browser/simpages.ts');
    assert.ok(!/require\(|from 'fs'|from 'child_process'|readFile|fetch\(|http\.|net\./.test(simSrc), 'the pages are fixed strings: no fs, no process, no network');
  }
  {
    // the scheme exists only under the simulator
    const handled: string[] = [];
    const ses = { protocol: { handle: (s: string) => void handled.push(s) } };
    assert.strictEqual(installSimPages(ses, false), false);
    assert.deepStrictEqual(handled, [], 'DURBAR_SIM off: no handler is registered');
    assert.strictEqual(installSimPages(ses, true), true);
    assert.deepStrictEqual(handled, ['durbar-sim']);
    const reg: unknown[] = [];
    const proto = { registerSchemesAsPrivileged: (s: unknown) => void reg.push(s) };
    assert.strictEqual(registerSimScheme(proto, false), false);
    assert.deepStrictEqual(reg, [], 'DURBAR_SIM off: the scheme is not registered');
    assert.strictEqual(registerSimScheme(proto, true), true);
    assert.strictEqual(reg.length, 1);
    // the view builder passes the decision on, per view
    for (const sim of [false, true]) {
      const made: string[] = [];
      const wcs: unknown[] = [];
      const deps = {
        chromeVersion: '152.0.0.1',
        onPartition: (s: unknown, on: boolean) => void installSimPages(s as never, on),
        sessionFromPartition: () => ({ ...new EventEmitter(), on() {}, removeListener() {}, protocol: { handle: (x: string) => void made.push(x) }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, setDisplayMediaRequestHandler() {}, clearStorageData: async () => undefined, clearCache: async () => undefined }),
        createView: () => {
          const wc = Object.assign(new EventEmitter(), {
            debugger: { attach() {}, detach() {}, isAttached: () => false, sendCommand: async () => ({}), on() {} }, setWindowOpenHandler() {}, setUserAgent() {}, getUserAgent: () => 'Chrome/1', setAudioMuted() {},
            loadURL: async () => undefined, getURL: () => 'about:blank', reload() {}, navigationHistory: { getActiveIndex: () => 0, getEntryAtIndex: () => undefined, length: () => 1, goToIndex() {} }, close() {}, isDestroyed: () => false,
          });
          wcs.push(wc);
          return { webContents: wc };
        },
      };
      const v = makeViews(deps as never);
      await v.ensureTabView('x1', 't00000001', {}, sim, false).catch(() => undefined);
      assert.deepStrictEqual(made, sim ? ['durbar-sim'] : [], `view builder, sim=${sim}: ${made.join(',') || 'no scheme handler'}`);
      await v.destroyAllViews();
    }
    const viewsSrc = read('src/main/browser/views.ts');
    assert.ok(/onPartition: \(ses, sim\) => void installSimPages\(ses as unknown as Parameters<typeof installSimPages>\[0\], sim\)/.test(viewsSrc), 'the real views call installSimPages with the view\'s sim flag');
    assert.ok(/ensureTabView = \(sessionId: string, tabId: string, events: ViewEvents = \{\}, sim = false\)/.test(viewsSrc), 'sim defaults to off');
    const mainSrc = read('src/main/main.ts');
    assert.ok(/registerSimScheme\(protocol, SIMULATOR\);/.test(mainSrc), 'main registers the scheme with its simulator decision');
    assert.strictEqual((mainSrc.match(/registerSchemesAsPrivileged/g) ?? []).length, 0, 'main.ts has no other scheme registration');
    assert.strictEqual((read('src/main/browser/simpages.ts').match(/registerSchemesAsPrivileged\(\[/g) ?? []).length, 1, 'one registration, behind `if (!sim) return false`');
    assert.ok(/export function registerSimScheme[\s\S]*?if \(!sim\) return false;[\s\S]*?registerSchemesAsPrivileged/.test(read('src/main/browser/simpages.ts')), 'the registration is behind the guard');
    assert.ok(/export function installSimPages[\s\S]*?if \(!sim\) return false;[\s\S]*?protocol\.handle/.test(read('src/main/browser/simpages.ts')), 'the handler is behind the guard');
    // and the navigation predicate refuses the scheme without the simulator
    assert.ok(!simAddress('durbar-sim://pages/form', false).ok, 'the address bar refuses it without the simulator');
    assert.ok(simAddress('durbar-sim://pages/form', true).ok);
  }

  // ---- 4. the renderer's side is covered by test:browserpane and the driver; the sim open list ----
  {
    const sg = read('src/main/simguard.ts');
    for (const c of CH) assert.ok(sg.includes(`'${c}':`), `${c} is open under the simulator (the view only loads simulator pages)`);
  }
  finished = true;
  console.log('browser ipc tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
