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
import { checkBounds, displayUrl, errorName, makeBrowserController, STATE_KEYS } from '../src/main/browser/controller';
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
function fakeSession(id: string) {
  const wc = Object.assign(new EventEmitter(), {
    url: 'about:blank' as unknown, title: '' as unknown, loading: false, muted: true, canBack: false, canForward: false, destroyed: false, stops: 0,
    getURL() { return this.url as string; }, getTitle() { return this.title as string; }, isLoading() { return this.loading; }, stop() { this.stops++; },
    setAudioMuted(m: boolean) { this.muted = m; }, isAudioMuted() { return this.muted; }, isDestroyed() { return this.destroyed; },
    navigationHistory: { canGoBack: () => wc.canBack, canGoForward: () => wc.canForward },
    shot: 'data:image/png;base64,AAAA' as unknown,
    capturePage: async () => ({ toDataURL: () => wc.shot as string }),
  });
  const view = { webContents: wc, bounds: undefined as unknown, setBounds(b: unknown) { this.bounds = b; } };
  const navs: unknown[] = [];
  const sv = { id, view, driver: 'user' as const, navs, events: undefined as unknown as import('../src/main/browser/views').ViewEvents, navigate: async (a: unknown) => { navs.push(a); if (a && typeof a === 'object') { wc.url = (a as { url: string }).url; wc.emit('did-start-navigation'); wc.emit('did-navigate'); } return true; }, destroy: async () => undefined };
  return { wc, view, sv, navs };
}
function rig(opts: { sim?: boolean; known?: (id: string) => boolean; win?: ReturnType<typeof fakeWin> | undefined; zoom?: number; consent?: boolean; snapshotMs?: number; now?: () => number } = {}) {
  const win = 'win' in opts ? opts.win : fakeWin(undefined, opts.zoom);
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
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
      ensureSessionView: async (id, events) => {
        ensured.push(id);
        if (!sessions.has(id)) sessions.set(id, fakeSession(id));
        sessions.get(id)!.sv.events = events;
        return sessions.get(id)!.sv as never;
      },
      destroySessionView: async (id) => void destroyed.push(id),
    },
    emit: (s) => void emitted.push(s),
    openExternal: async (u) => void opened.push(u),
    later: (f) => void queue.push(f),
  };
  const ctl = makeBrowserController(deps);
  const flush = (): void => { while (queue.length) queue.shift()!(); };
  return { ctl, win: win!, sessions, ensured, destroyed, emitted, opened, flush, dialogs, leaves, dropped, consent };
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
    assert.deepStrictEqual(Object.keys(s).sort(), STATE_KEYS.filter((k) => k !== 'error' && k !== 'note' && k !== 'memory').sort(), 'exactly the BrowserState keys');
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
      views: { ensureSessionView: async () => { throw new Error('boom'); }, destroySessionView: async () => undefined },
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
    assert.deepStrictEqual(r.dialogs, [{ id: 's1', type: 'confirm', text: 'Delete?', shown: true }], 'a shown view says so');
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

  // ---- 2. the wiring ----
  const CH = ['open', 'state', 'navigate', 'back', 'forward', 'reload', 'stop', 'bounds', 'visible', 'overlay', 'mute', 'openSystem', 'consentAccept', 'snapshot', 'leaveAnswer', 'openLink', 'openMail'].map((c) => 'browser:' + c);
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
      await v.ensureSessionView('x1', {}, sim, false).catch(() => undefined);
      assert.deepStrictEqual(made, sim ? ['durbar-sim'] : [], `view builder, sim=${sim}: ${made.join(',') || 'no scheme handler'}`);
      await v.destroyAllViews();
    }
    const viewsSrc = read('src/main/browser/views.ts');
    assert.ok(/onPartition: \(ses, sim\) => void installSimPages\(ses as unknown as Parameters<typeof installSimPages>\[0\], sim\)/.test(viewsSrc), 'the real views call installSimPages with the view\'s sim flag');
    assert.ok(/ensureSessionView = \(sessionId: string, events: ViewEvents = \{\}, sim = false\)/.test(viewsSrc), 'sim defaults to off');
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
