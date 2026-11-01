/**
 * Spec 080 T020 (FR-120, FR-124, FR-126, FR-129, FR-130) and T021 (FR-011, FR-126, SC-010): the pure tab model of the session browser and
 * the soft cap with tabs. `npm run test:browsertabs`. No Electron, no network, no credits.
 */
import * as assert from 'assert';
import * as path from 'path';
import { canAddTab, cycle, findReuse, insertAfter, MAX_TABS_PER_LOAD, MAX_TABS_PER_SESSION, newTabId, nextActive, reuseKey, TAB_ID_RE, TAB_LIMIT_TEXT, tabShortcut, validTabId } from '../src/main/browser/tabs';
import type { TabFacts } from '../src/main/browser/tabs';
import { MAX_LIVE_VIEWS, pickUnload, safeToUnload } from '../src/main/browser/viewcap';
import type { CapView } from '../src/main/browser/viewcap';

// ---- AC1: ids are minted here only, and only that shape is accepted ----
{
  const used = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = newTabId(used);
    assert.ok(TAB_ID_RE.test(id) && validTabId(id), id);
    assert.ok(!used.has(id), 'unique within the session');
    used.add(id);
  }
  const seq = ['0000000a', '0000000a', 'zzzzzzzz', '0000000b'];
  const fixed = new Set<string>(['t0000000a']);
  assert.strictEqual(newTabId(fixed, () => seq.shift() as string), 't0000000b', 'a taken or malformed id is skipped');
  assert.throws(() => newTabId(new Set(), () => 'XYZ'), 'never a malformed id');
  for (const bad of ['', 't123', 'T0000000a', 't0000000A', '../', 't0000000a/', ' t0000000a', 't0000000a ', 't00000000a', 't000000000', 7, 0x1234, null, undefined, {}, ['t0000000a'], { toString: () => 't0000000a' }, 'tgggggggg', 't-0000000']) {
    assert.strictEqual(validTabId(bad), false, `refused: ${JSON.stringify(bad)}`);
  }
  assert.ok(validTabId('t0123abcd'));
}

// ---- AC2: the reuse rule (FR-124) ----
{
  assert.strictEqual(reuseKey('http://localhost:5173/#top'), 'http://localhost:5173/', 'the fragment is dropped');
  assert.strictEqual(reuseKey('http://LOCALHOST:5173'), 'http://localhost:5173/', 'WHATWG: host case and the trailing slash');
  assert.strictEqual(reuseKey('http://localhost:5173/a'), 'http://localhost:5173/a');
  assert.notStrictEqual(reuseKey('http://localhost:5173/a/'), reuseKey('http://localhost:5173/a'), 'a path slash is part of the address');
  for (const bad of ['', 'not a url', 'about:blank', undefined, null, 5, {}]) assert.strictEqual(reuseKey(bad), undefined, `never matches: ${String(bad)}`);
  const tab = (tabId: string, urls: (string | undefined)[], lastShownAt = 0, kind: 'user' | 'agent' = 'user'): TabFacts => ({ tabId, kind, urls, lastShownAt });
  const tabs = [tab('t00000001', ['http://localhost:5173/', undefined, undefined], 5), tab('t00000002', ['https://a.example/x'], 1), tab('t00000003', ['about:blank', 'http://localhost:5173/', undefined], 9), tab('t00000004', [undefined, undefined, 'https://dropped.example/'], 2)];
  assert.strictEqual(findReuse(tabs, 'http://localhost:5173/#top'), 't00000003', 'the most recently shown match wins (committed or pending)');
  assert.strictEqual(findReuse(tabs, 'http://localhost:5173'), 't00000003');
  assert.strictEqual(findReuse(tabs, 'https://dropped.example/'), 't00000004', 'a dropped tab matches through its kept address');
  assert.strictEqual(findReuse(tabs, 'https://A.EXAMPLE/x#y'), 't00000002', 'host case and fragment');
  assert.strictEqual(findReuse(tabs, 'https://a.example/X'), undefined, 'path case matters');
  assert.strictEqual(findReuse(tabs, 'https://u:p@a.example/x'), undefined, 'userinfo is part of the address (and such a link is refused before this anyway)');
  assert.strictEqual(findReuse(tabs, 'not a url'), undefined, 'an unparsable address never matches');
  assert.strictEqual(findReuse(tabs, 'about:blank'), undefined, 'about:blank never matches an empty tab');
  assert.strictEqual(findReuse([tab('t00000009', ['https://agent.example/'], 99, 'agent')], 'https://agent.example/'), undefined, 'the agent\'s tab is never reused');
  assert.strictEqual(findReuse([], 'https://a.example/'), undefined);
}

// ---- AC3: the 10-tab limit ----
{
  assert.strictEqual(MAX_TABS_PER_SESSION, 10, 'owner decision Q2');
  assert.strictEqual(MAX_TABS_PER_LOAD, 5, 'FR-125');
  assert.ok(canAddTab(0) && canAddTab(9));
  assert.ok(!canAddTab(10) && !canAddTab(11), 'an 11th tab is refused');
  assert.ok(/10 tabs/.test(TAB_LIMIT_TEXT) && /Close one/.test(TAB_LIMIT_TEXT));
}

// ---- AC4: insertion and close order ----
{
  const o = ['a', 'b', 'c'];
  assert.deepStrictEqual(insertAfter(o, 'a', 'n'), ['a', 'n', 'b', 'c'], 'to the right of the active tab');
  assert.deepStrictEqual(insertAfter(o, 'c', 'n'), ['a', 'b', 'c', 'n']);
  assert.deepStrictEqual(insertAfter(o, 'zz', 'n'), ['a', 'b', 'c', 'n'], 'an unknown anchor appends');
  assert.deepStrictEqual(insertAfter([], undefined, 'n'), ['n']);
  assert.deepStrictEqual(o, ['a', 'b', 'c'], 'the input is not changed');
  assert.strictEqual(nextActive(o, 'b'), 'c', 'closing activates the tab to the right');
  assert.strictEqual(nextActive(o, 'c'), 'b', 'else the one to the left');
  assert.strictEqual(nextActive(['a'], 'a'), undefined, 'the last tab: none (the caller makes an empty New tab)');
  assert.strictEqual(cycle(o, 'c', 1), 'a', 'Ctrl+Tab wraps');
  assert.strictEqual(cycle(o, 'a', -1), 'c', 'Ctrl+Shift+Tab wraps');
  assert.strictEqual(cycle([], 'a', 1), undefined);
}

// ---- FR-130: the tab keys, the same in main and in the window ----
{
  const k = (o: Omit<K, 'type'>): K => ({ type: 'keyDown', ...o });
  type K = { type?: string; key?: string; code?: string; control?: boolean; meta?: boolean; shift?: boolean; alt?: boolean };
  const cases: [K, boolean, string | null][] = [
    [k({ key: 't', code: 'KeyT', control: true }), false, 'new'], [k({ key: 'w', code: 'KeyW', control: true }), false, 'close'],
    [k({ key: 't', code: 'KeyT', meta: true }), true, 'new'], [k({ key: 'w', code: 'KeyW', meta: true }), true, 'close'],
    [k({ key: 't', code: 'KeyT', control: true }), true, null], // Ctrl+T on a Mac is a text key (transpose)
    [k({ key: 't', code: 'KeyT', meta: true }), false, null],
    [k({ key: 'Tab', code: 'Tab', control: true }), false, 'next'], [k({ key: 'Tab', code: 'Tab', control: true, shift: true }), false, 'prev'],
    [k({ key: 'Tab', code: 'Tab', control: true }), true, 'next'], [k({ key: 'Tab', code: 'Tab', control: true, shift: true }), true, 'prev'],
    [k({ key: 'PageDown', code: 'PageDown', control: true }), false, 'next'], [k({ key: 'PageUp', code: 'PageUp', control: true }), true, 'prev'],
    [k({ key: 'T', code: 'KeyT', control: true, shift: true }), false, null], // Ctrl+Shift+T (reopen) is not built
    [k({ key: 't', code: 'KeyT', control: true, alt: true }), false, null], [k({ key: 'Tab', code: 'Tab' }), false, null], [k({ key: 'Tab', code: 'Tab', alt: true }), false, null],
    [k({ key: 'Tab', code: 'Tab', meta: true }), true, null], // ⌘Tab belongs to macOS
    [{ type: 'keyUp', key: 't', code: 'KeyT', control: true }, false, null], [{ type: 'char', key: 't', control: true }, false, null],
    [k({ key: 'y', code: 'KeyT', control: true }), false, null], // Dvorak-like: the key at T types y
    [k({ key: 'е', code: 'KeyT', control: true }), false, 'new'], // a non-Latin layout: the position counts
    [k({ key: 'x', code: 'KeyX', control: true }), false, null],
  ];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BP = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'browserpane.js'));
  for (const [ev, mac, want] of cases) {
    assert.strictEqual(tabShortcut(ev, mac), want, `main: ${JSON.stringify(ev)} mac=${mac}`);
    // the window's KeyboardEvent shape: ctrlKey, metaKey, shiftKey, altKey, type 'keydown'
    const dom = { type: ev.type === 'keyDown' ? 'keydown' : ev.type, key: ev.key, code: ev.code, ctrlKey: !!ev.control, metaKey: !!ev.meta, shiftKey: !!ev.shift, altKey: !!ev.alt };
    assert.strictEqual(BP.tabShortcut(dom, mac), want, `window: ${JSON.stringify(dom)} mac=${mac}`);
    assert.strictEqual(tabShortcut(dom, mac), want, `main with the DOM shape: ${JSON.stringify(dom)}`);
  }
  assert.strictEqual(tabShortcut(null, false), null);
  assert.strictEqual(BP.tabShortcut(null, false), null);
}

// ---- T021: the soft cap with tabs (FR-011, FR-126, SC-010) ----
const cv = (id: string, over: Partial<CapView> = {}): CapView => ({ id, loaded: true, shown: false, lastShownAt: 0, reachedByPost: false, charKeySinceLoad: false, callInFlight: false, callInCurrentTurn: false, browserTypeSinceLoad: false, ...over });
{
  // background tabs go first, even when an active tab of a hidden session was shown longer ago
  const views = [cv('hiddenActive', { lastShownAt: 1 }), cv('bgNew', { background: true, lastShownAt: 50 }), cv('bgOld', { background: true, lastShownAt: 10 }), cv('shown', { shown: true, lastShownAt: 99 })];
  assert.deepStrictEqual(pickUnload(views, MAX_LIVE_VIEWS), { unload: ['bgOld'], overCap: false }, 'the least recently shown background tab first');
  assert.deepStrictEqual(pickUnload([...views, cv('x', { lastShownAt: 2 })], MAX_LIVE_VIEWS), { unload: ['bgOld', 'bgNew'], overCap: false }, 'every background tab before an active one');
  assert.deepStrictEqual(pickUnload([...views, cv('x', { lastShownAt: 2 }), cv('y', { lastShownAt: 3 })], MAX_LIVE_VIEWS), { unload: ['bgOld', 'bgNew', 'hiddenActive'], overCap: false }, 'then hidden sessions\' active tabs, as before');
  // every FR-011 never-pick rule holds for a background tab too (T021 AC2)
  for (const flag of ['reachedByPost', 'charKeySinceLoad', 'callInFlight', 'callInCurrentTurn', 'browserTypeSinceLoad', 'shown'] as const) {
    const bg = cv('bg', { background: true, [flag]: true });
    assert.strictEqual(safeToUnload(bg), false, `a background tab with ${flag} is never picked`);
    assert.deepStrictEqual(pickUnload([bg, cv('a', { lastShownAt: 5 }), cv('b', { lastShownAt: 6 }), cv('c', { lastShownAt: 7 })], MAX_LIVE_VIEWS), { unload: ['a'], overCap: false }, `${flag}: the unsafe background tab stays, an active one goes`);
  }
}
// SC-010: 3 sessions x 10 tabs, pages loading in turn. Never more than MAX_LIVE_VIEWS loaded (over-cap pages excepted and counted), no 11th
// tab, and every pick is a background tab while one is safe. A small model of the controller's loop (the controller test runs the real one).
{
  interface T { id: string; session: number; loaded: boolean; lastShownAt: number; unsafe: boolean }
  const sessions: { tabs: T[]; active: number }[] = [0, 1, 2].map(() => ({ tabs: [], active: 0 }));
  let clock = 0, overCapPages = 0, refusedTabs = 0;
  const all = (): T[] => sessions.flatMap((s) => s.tabs);
  const shownSession = 0;
  for (let round = 0; round < 12; round++) {
    for (let si = 0; si < 3; si++) {
      const s = sessions[si];
      if (!canAddTab(s.tabs.length)) { refusedTabs++; continue; }
      const t: T = { id: `s${si}t${s.tabs.length}`, session: si, loaded: false, lastShownAt: ++clock, unsafe: (round * 3 + si) % 7 === 3 };
      s.tabs.push(t);
      s.active = s.tabs.length - 1;
      // the page loads: FR-011's cap over every tab of every session
      const others = all().filter((x) => x !== t);
      const views = others.map((x) => {
        const S = sessions[x.session];
        const background = S.tabs[S.active] !== x;
        return cv(x.id, { loaded: x.loaded, background, shown: x.session === shownSession && !background, lastShownAt: x.lastShownAt, reachedByPost: x.unsafe });
      });
      const { unload, overCap } = pickUnload(views, MAX_LIVE_VIEWS);
      const safeBg = views.filter((v) => safeToUnload(v) && v.background).map((v) => v.id);
      for (const id of unload) {
        const v = views.find((x) => x.id === id)!;
        // a picked active tab is allowed only once no safe background tab is left
        if (!v.background) assert.ok(safeBg.every((b) => unload.includes(b)), `round ${round}: an active tab was picked while a safe background tab stayed`);
        all().find((x) => x.id === id)!.loaded = false;
      }
      t.loaded = true;
      if (overCap) overCapPages++;
      const loaded = all().filter((x) => x.loaded);
      // over the cap only through pages that may not be dropped: unsafe ones, the shown tab, and the one that just loaded
      const kept = loaded.filter((x) => x.unsafe || (x.session === shownSession && sessions[x.session].tabs[sessions[x.session].active] === x) || x === t).length;
      assert.ok(loaded.length <= Math.max(MAX_LIVE_VIEWS, kept), `round ${round}: ${loaded.length} pages loaded, ${kept} of them may not be dropped`);
      if (loaded.length > MAX_LIVE_VIEWS) assert.ok(overCap, 'over the cap is said (and counted)');
    }
  }
  for (const s of sessions) assert.ok(s.tabs.length <= MAX_TABS_PER_SESSION, 'no session ever holds an 11th tab');
  assert.strictEqual(sessions.reduce((n, s) => n + s.tabs.length, 0), 30, '3 x 10 tabs');
  assert.strictEqual(refusedTabs, 6, 'the 11th and 12th tab of each session were refused');
  assert.ok(overCapPages >= 0);
}

console.log('browser tabs tests passed');
