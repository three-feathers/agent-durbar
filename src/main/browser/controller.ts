/**
 * Spec 080 T014 (FR-003, FR-004, FR-009, FR-012, FR-023): what the window may ask of a session's browser, and the one place that attaches
 * a view to the window. The IPC module (src/main/ipc/browser.ts) is a thin `fromApp`-checked wrapper around `makeBrowserController`.
 *
 * Rules kept here:
 *  - a session id from the window is looked up in main (`known`) before anything is created or touched;
 *  - the view is created on first `open` (FR-004), attached to the window only while the Browser tab asks for it and no overlay covers
 *    it, and only one view is attached at a time;
 *  - bounds from the window are checked (finite, positive, inside the window) before `setBounds`;
 *  - the window gets `BrowserState` and nothing else: URL (userinfo dropped), title, loading, history, mute, driver, a network error name.
 *    No call here reads the page's DOM, text, cookies, storage or pixels (`test:browseripc` greps for the APIs that would).
 * Electron's parts come in as arguments so the test runs it against fakes.
 */
import { simAddress } from './simpages';
import { classifyLink, parseMailto } from '../../shared/browserurl';
import { isHttpUrl } from '../../shared/url';
import type { BrowserResult, BrowserState, BrowserTab, BrowserTabs } from '../../shared/api';
import type { NavAction } from '../hardening';
import { MAX_LIVE_VIEWS, pickUnload } from './viewcap';
import type { CapView } from './viewcap';
import { canAddTab, findReuse, insertAfter, MAX_TABS_PER_LOAD, newTabId, nextActive, reuseKey, TAB_LIMIT_TEXT, validTabId } from './tabs';
import type { TabKind, TabShortcut } from './tabs';
import type { SessionView, ViewEvents } from './views';

export const STATE_KEYS = ['id', 'open', 'url', 'title', 'loading', 'canBack', 'canForward', 'muted', 'driver', 'dialogOpen', 'error', 'note', 'memory', 'tabId', 'tabLimit'] as const;
/** Spec 080 FR-127: the only keys of a `browser:tabs` entry. */
export const TAB_KEYS = ['tabId', 'kind', 'title', 'url', 'loading', 'dialogOpen', 'memory'] as const;
const MAX_URL = 2048;
const MAX_TITLE = 200;
/** FR-024: what the window says about a link that is not a web address (static text, never page text). */
export const MAIL_LINK_TEXT = 'This link wants to open your mail app.';
export const REFUSED_LINK_TEXT = 'Durbar opens only mail links in other apps.';
/** How long the still picture may take before the view is hidden without it. */
export const SNAPSHOT_MS = 300;
/** A window can hold a page this big and no more; larger numbers are a bug or an attack. */
const MAX_SIDE = 20_000;

interface EmitterLike {
  on(event: string, fn: (...a: never[]) => void): unknown;
}
/** The parts of a view's `webContents` the controller reads or calls. Nothing here reaches into the page. */
export interface BrowserWc extends EmitterLike {
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  stop(): void;
  setAudioMuted(m: boolean): void;
  isAudioMuted(): boolean;
  isDestroyed(): boolean;
  /** Only `snapshot()` calls it (FR-008's still picture). */
  capturePage(): Promise<{ toDataURL(): string }>;
  /** FR-129: a page's `foreground-tab` gives the new tab's page the focus, only when the opener page had it (never from the composer). */
  focus?(): void;
  /** FR-129 (2026-10-31 delta): whether this page has the keyboard focus now. */
  isFocused?(): boolean;
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean };
}
export interface BrowserViewLike {
  webContents: BrowserWc;
  setBounds(b: { x: number; y: number; width: number; height: number }): void;
}
export type BrowserSessionView = Pick<SessionView, 'driver' | 'navigate' | 'close' | 'closeAsk'> & { view: unknown };
export interface BrowserWinLike {
  isDestroyed(): boolean;
  contentView: { addChildView(v: never): void; removeChildView(v: never): void };
  getContentBounds(): { width: number; height: number };
  webContents: { getZoomFactor(): number; isFocused?(): boolean };
}
export interface BrowserDeps {
  /** True for a top-level session of the office (looked up in main); under the simulator also the simulated agents' ids. */
  known(id: string): boolean;
  sim: boolean;
  window(): BrowserWinLike | undefined;
  views: {
    /** FR-120, FR-121: a tab's view, in its session's partition. */
    ensureTabView(id: string, tabId: string, events: ViewEvents, sim: boolean): Promise<BrowserSessionView>;
    /** FR-121: one tab's view goes; the partition stays. */
    closeTabView(id: string, tabId: string): Promise<void>;
    /** FR-128: every tab's view goes, then the partition is cleared once. */
    destroySessionView(id: string): Promise<void>;
  };
  /** A change worth telling the window about (coalesced, and only when something differs). */
  emit(s: BrowserState): void;
  /** FR-127: the session's tab list changed (coalesced like `emit`). */
  emitTabs?(t: BrowserTabs): void;
  /** FR-123: the app-wide *Open chat links in a new tab* toggle, read in main only. */
  linksNewTab?(): boolean;
  /** FR-130: a tab key pressed inside a page; the window runs the same action as from the strip. */
  tabKey?(k: { id: string; key: TabShortcut }): void;
  /** The existing external-link path (`shell.openExternal`): called with an http(s) address (Open in system browser) or with a normalised `mailto:` href after the user's click (`openMail`); never with anything else. */
  openExternal(url: string): Promise<unknown>;
  /** FR-025d (Q2): the one-time note was accepted for this app profile. The view is not created before. */
  consented(): boolean;
  /** FR-025d, FR-132: a page dialog opened; `shown` = that tab's view is on the window now; `bg` = a background tab of the session that is shown. The window raises the toast and brings the chat forward. */
  pageDialog(d: { id: string; type: string; text: string; shown: boolean; tabId?: string; bg?: boolean }): void;
  /** FR-025e: ask the window *Leave this page?*; true = Leave. */
  askLeave(id: string, targetKnown: boolean, shown: boolean): Promise<boolean>;
  /** The window's page loaded again, or a session's view went: answers still waiting for the window are dropped (Stay). */
  dropAsks?(id?: string): void;
  /** Test hook: the snapshot's time limit (ms). */
  snapshotMs?: number;
  /** Test hook: the clock for `lastShownAt` (FR-011). */
  now?: () => number;
  /** Runs `fn` soon, once (setImmediate); the test passes a manual queue. */
  later?(fn: () => void): void;
}

/** The address as the window may see it: no user name or password, not too long; '' for about:blank. */
export function displayUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw === 'about:blank') return '';
  let t = raw;
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
      t = u.href;
    }
  } catch {
    /* not a URL: shown as it is, cut below */
  }
  return t.length > MAX_URL ? t.slice(0, MAX_URL) : t;
}
// eslint-disable-next-line no-control-regex
const cleanTitle = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TITLE) : '');

/** A Chromium net error name (`ERR_CONNECTION_REFUSED`) and nothing else; anything different becomes a generic one. */
export function errorName(raw: unknown): string {
  return typeof raw === 'string' && /^ERR_[A-Z0-9_]{1,60}$/.test(raw) ? raw : 'ERR_FAILED';
}

/**
 * The window's copy of a view's bounds, or undefined when it is not acceptable: finite numbers, a positive size, not off the window's
 * top-left, no larger than the window (plus 2 px for rounding). `zoom` turns CSS pixels into the window's device-independent ones.
 */
export function checkBounds(raw: unknown, content: { width: number; height: number }, zoom = 1): { x: number; y: number; width: number; height: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const vals = [r.x, r.y, r.width, r.height];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
  const z = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0.1 && zoom < 10 ? zoom : 1;
  const [x, y, w, h] = (vals as number[]).map((v) => v * z);
  if (x < -1 || y < -1 || w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) return undefined;
  if (x + w > content.width + 2 || y + h > content.height + 2) return undefined;
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/** One page tab's view (spec 080 FR-120): today's per-view facts, now per tab. */
interface Tracked {
  sv: BrowserSessionView;
  wc: BrowserWc;
  view: BrowserViewLike;
  attachedTo?: BrowserWinLike;
  error?: string;
  note?: string;
  dialogOpen: boolean;
  /** The page was unloaded to save memory (the active tab of a hidden session): its address, kept until it is shown again. */
  unloadedUrl?: string;
  /** Any character key input since the page loaded (from the view's `input-event`). */
  charKey: boolean;
  /** The page was reached by a form submit (Chromium's transition type). */
  byForm: boolean;
  memory?: 'reloaded' | 'many';
  /** The reload after an unload is in flight: its own navigation start must not clear the note. */
  memoryHold: boolean;
}
/** FR-120: a tab, in main's memory only. A *New tab* with no address has no view (FR-004); a dropped background tab has none either (FR-126). */
interface Tab {
  readonly tabId: string;
  readonly kind: TabKind;
  t?: Tracked;
  /** The view is being made. */
  opening?: Promise<Tracked | undefined>;
  /** FR-126: a background tab the cap dropped: its view is closed and its address and title are kept here. */
  keptUrl?: string;
  keptTitle?: string;
  /** FR-124: the address main last asked it to load, until it commits or fails. */
  pendingUrl?: string;
  /** FR-011: last time this tab was on the window (ms). */
  lastShownAt: number;
  /** FR-125: tabs its current page load opened. */
  opened: number;
}
/** A session's browser: its tabs, the active one, and what the window asked for the pane (bounds, shown, overlay). */
interface Sess {
  readonly id: string;
  order: string[];
  tabs: Map<string, Tab>;
  active: string;
  bounds?: { x: number; y: number; width: number; height: number };
  /** The Browser tab of this session's chat is shown (the window asked for it). */
  visible: boolean;
  overlay: boolean;
  /** FR-126: the last tab request hit the limit. */
  limit: boolean;
  /** A view of this session was made once (the first open makes one, as before tabs; later empty tabs have none, FR-004). */
  started: boolean;
  queued: boolean;
  lastState?: string;
  lastTabs?: string;
}

export function makeBrowserController(deps: BrowserDeps) {
  const sessions = new Map<string, Sess>();
  const later = deps.later ?? ((fn: () => void) => void setImmediate(fn));
  const now = (): number => (deps.now ?? Date.now)();
  const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  const needsConsent = (): BrowserResult => ({ ok: false, reason: 'The browser needs your OK first.', needsConsent: true });
  const closedState = (id: string): BrowserState => ({ id, open: false, url: '', title: '', loading: false, canBack: false, canForward: false, muted: true, driver: 'user', dialogOpen: false });
  const activeTab = (S: Sess): Tab | undefined => S.tabs.get(S.active);
  /** The tab is still the session's, and `t` (when given) is still its view: anything else is a late event of a closed tab (FR-128, US6 scenario 6). */
  const live = (S: Sess, tab: Tab, t?: Tracked): boolean => sessions.get(S.id) === S && S.tabs.get(tab.tabId) === tab && (t === undefined || tab.t === t);
  const viewOk = (t: Tracked | undefined): t is Tracked => !!t && !t.wc.isDestroyed();

  /** The only object that leaves for the window: explicit fields, primitives only. It describes the session's active tab. */
  function stateOf(id: string): BrowserState {
    const S = sessions.get(id);
    const tab = S && activeTab(S);
    if (!S || !tab) return closedState(id);
    const t = tab.t;
    let s: BrowserState;
    if (!t) {
      // an empty New tab, or a dropped background tab not brought back yet: the browser is open, this tab has no page
      s = { id, open: true, url: displayUrl(tab.keptUrl ?? tab.pendingUrl ?? ''), title: cleanTitle(tab.keptTitle), loading: false, canBack: false, canForward: false, muted: true, driver: 'user', dialogOpen: false, tabId: tab.tabId };
    } else if (t.wc.isDestroyed()) {
      s = { ...closedState(id), tabId: tab.tabId };
    } else {
      s = {
        id,
        open: true,
        url: displayUrl(t.wc.getURL()),
        title: cleanTitle(t.wc.getTitle()),
        loading: t.wc.isLoading() === true,
        canBack: t.wc.navigationHistory.canGoBack() === true,
        canForward: t.wc.navigationHistory.canGoForward() === true,
        muted: t.wc.isAudioMuted() === true,
        driver: t.sv.driver,
        dialogOpen: t.dialogOpen,
        tabId: tab.tabId,
      };
      if (t.error && !s.loading) s.error = t.error;
      if (t.note) s.note = t.note;
      if (t.memory) s.memory = t.memory;
    }
    if (S.limit) s.tabLimit = true;
    return s;
  }
  /** FR-127: the tab list for the window, built as `stateOf` is (explicit fields, primitives, `displayUrl`, `cleanTitle`). */
  function tabsOf(id: string): BrowserTabs {
    const S = sessions.get(id);
    if (!S) return { id, active: '', tabs: [] };
    const tabs: BrowserTab[] = [];
    for (const tabId of S.order) {
      const tab = S.tabs.get(tabId);
      if (!tab) continue;
      const t = viewOk(tab.t) ? tab.t : undefined;
      const e: BrowserTab = {
        tabId,
        kind: tab.kind,
        title: cleanTitle(t ? t.wc.getTitle() : tab.keptTitle),
        url: displayUrl(t ? (t.unloadedUrl ?? t.wc.getURL()) : (tab.keptUrl ?? tab.pendingUrl ?? '')),
        loading: !!t && t.wc.isLoading() === true,
        dialogOpen: !!t && t.dialogOpen,
      };
      const memory = !t && tab.keptUrl ? 'dropped' : t?.unloadedUrl ? 'dropped' : t?.memory;
      if (memory) e.memory = memory;
      tabs.push(e);
    }
    return { id, active: S.active, tabs };
  }
  /** Tell the window, once per burst of events, and only if the state or the tab list changed. */
  function changed(id: string): void {
    const S = sessions.get(id);
    if (!S || S.queued) return;
    S.queued = true;
    later(() => {
      S.queued = false;
      if (sessions.get(id) !== S) return;
      const s = stateOf(id);
      const key = JSON.stringify(s);
      if (key !== S.lastState) {
        S.lastState = key;
        deps.emit(s);
      }
      const t = tabsOf(id);
      const tk = JSON.stringify(t);
      if (tk !== S.lastTabs) {
        S.lastTabs = tk;
        deps.emitTabs?.(t);
      }
    });
  }

  /** A page is loaded: the view has a real address and was not unloaded to save memory. */
  const loadedOf = (t: Tracked): boolean => !t.unloadedUrl && !t.wc.isDestroyed() && displayUrl(t.wc.getURL()) !== '';
  /** FR-126: a background tab's page is dropped: its view closes (no process left), its address and title stay in the tab. */
  function dropBackground(S: Sess, tab: Tab): void {
    const t = tab.t;
    if (!t) return;
    tab.keptUrl = t.wc.isDestroyed() ? tab.keptUrl : t.wc.getURL();
    tab.keptTitle = t.wc.isDestroyed() ? tab.keptTitle : t.wc.getTitle();
    tab.t = undefined;
    tab.opening = undefined;
    detach(t);
    void deps.views.closeTabView(S.id, tab.tabId).catch(() => undefined);
  }
  /**
   * FR-011, FR-126: a page just loaded in `newTab`. If more than `MAX_LIVE_VIEWS` pages would stay loaded across every tab of every session,
   * safe background tabs drop their page first, then the least recently shown active tabs of hidden sessions (the address stays; it reloads
   * when shown again). With no safe page left, the new one stays loaded and says so.
   */
  function enforceCap(newS: Sess, newTab: Tab): void {
    const views: CapView[] = [];
    const where = new Map<string, [Sess, Tab]>();
    for (const S of sessions.values()) {
      for (const tab of S.tabs.values()) {
        if (tab === newTab || !tab.t) continue;
        const x = tab.t;
        const key = `${S.id}\u0000${tab.tabId}`;
        where.set(key, [S, tab]);
        const background = S.active !== tab.tabId;
        views.push({ id: key, loaded: loadedOf(x), shown: S.visible && !background, background, lastShownAt: tab.lastShownAt, reachedByPost: x.byForm, charKeySinceLoad: x.charKey, callInFlight: false, callInCurrentTurn: false, browserTypeSinceLoad: false });
      }
    }
    const { unload, overCap } = pickUnload(views, MAX_LIVE_VIEWS);
    for (const key of unload) {
      const w = where.get(key);
      if (!w) continue;
      const [S, tab] = w;
      const x = tab.t;
      if (!x) continue;
      if (S.active !== tab.tabId) dropBackground(S, tab);
      else {
        // the active tab of a hidden session: today's drop (the view stays, on about:blank)
        x.unloadedUrl = x.wc.getURL();
        x.memory = undefined;
        void x.sv.navigate({ url: 'about:blank' }).catch(() => undefined);
      }
      changed(S.id);
    }
    const t = newTab.t;
    if (t) {
      t.memory = overCap ? 'many' : t.memory === 'many' ? undefined : t.memory;
      changed(newS.id);
    }
  }

  function wire(S: Sess, tab: Tab, t: Tracked): void {
    const wc = t.wc;
    const ok = (): boolean => live(S, tab, t);
    const ping = (): void => {
      if (ok()) changed(S.id);
    };
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'audio-state-changed']) wc.on(ev, ping as never);
    wc.on('did-start-navigation', ((e?: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
      if (!ok()) return;
      if (e && (e.isMainFrame === false || e.isSameDocument === true)) return; // a frame or a hash change is not a new page
      t.error = undefined;
      t.note = undefined;
      if (t.memoryHold) t.memoryHold = false; // the reload that brings an unloaded page back keeps its note
      else t.memory = undefined;
      ping();
    }) as never);
    wc.on('did-navigate', (() => {
      if (!ok()) return;
      t.charKey = false; // a new page: key input counts from here (FR-011)
      t.byForm = false; // until the history says this page came from a form
      tab.opened = 0; // FR-125: a new page load may open its own tabs
      tab.pendingUrl = undefined;
      if (loadedOf(t)) {
        t.unloadedUrl = undefined;
        enforceCap(S, tab);
      }
    }) as never);
    wc.on('input-event', ((_e: unknown, ev: { type?: string }) => {
      if (ok() && ev && ev.type === 'char') t.charKey = true; // main never reads the page: it only sees that keys were typed
    }) as never);
    wc.on('did-fail-load', ((_e: unknown, code: number, desc: string, _url: string, isMain: boolean) => {
      if (!ok()) return;
      if (isMain && code !== -3) t.error = errorName(desc); // -3 is a navigation another one replaced
      if (isMain && code !== -3) tab.pendingUrl = undefined;
      ping();
    }) as never);
  }

  function winFor(): BrowserWinLike | undefined {
    const w = deps.window();
    return w && !w.isDestroyed() ? w : undefined;
  }
  function detach(t: Tracked): void {
    if (!t.attachedTo) return;
    try {
      if (!t.attachedTo.isDestroyed()) t.attachedTo.contentView.removeChildView(t.view as never);
    } catch {
      /* the window is going away */
    }
    t.attachedTo = undefined;
  }
  /**
   * The one rule for "is it on screen" (FR-127): the session's Browser tab asked for, not covered by an overlay, with bounds, and only its
   * ACTIVE tab. Only one view in the whole window at a time: every other tab of every session comes off.
   */
  function applyAttach(id: string): void {
    const S = sessions.get(id);
    if (!S) return;
    const win = winFor();
    const tab = activeTab(S);
    const t = tab?.t;
    const want = !!win && S.visible && !S.overlay && !!S.bounds && viewOk(t);
    for (const O of sessions.values()) for (const o of O.tabs.values()) if (o.t && (!want || o.t !== t)) detach(o.t);
    if (!want || !win || !t) return;
    if (t.attachedTo !== win) {
      detach(t);
      win.contentView.addChildView(t.view as never);
      t.attachedTo = win;
    }
    if (S.bounds) t.view.setBounds(S.bounds);
  }

  /** The session's browser, with its first tab (FR-120). */
  function sessFor(id: string): Sess {
    let S = sessions.get(id);
    if (!S) {
      const first: Tab = { tabId: newTabId(new Set()), kind: 'user', lastShownAt: 0, opened: 0 };
      S = { id, order: [first.tabId], tabs: new Map([[first.tabId, first]]), active: first.tabId, visible: false, overlay: false, limit: false, started: false, queued: false };
      sessions.set(id, S);
    }
    return S;
  }
  /** FR-120, FR-121: adds a tab to the right of `after`; the caller checked the limit. */
  function addTab(S: Sess, after: string | undefined): Tab {
    const tab: Tab = { tabId: newTabId(S.tabs), kind: 'user', lastShownAt: 0, opened: 0 };
    S.tabs.set(tab.tabId, tab);
    S.order = insertAfter(S.order, after, tab.tabId);
    return tab;
  }

  /** A tab's view, created on first use (FR-004) in the session's partition (FR-121). */
  async function ensure(S: Sess, tab: Tab): Promise<Tracked | undefined> {
    if (viewOk(tab.t)) return tab.t;
    if (tab.opening) return tab.opening;
    const id = S.id;
    let p!: Promise<Tracked | undefined>;
    p = (async (): Promise<Tracked | undefined> => {
      let made: Tracked | undefined;
      try {
        // events of this view count only while it is still this tab's view (a closed or dropped tab's late events change nothing)
        const mine = (): Tracked | undefined => (made && live(S, tab, made) ? made : undefined);
        const events: ViewEvents = {
          onDialogNote: (_sid, note) => {
            const x = mine();
            if (!x) return;
            x.note = cleanTitle(note);
            changed(id);
          },
          onPageDialog: (_sid, d) => {
            const x = mine();
            if (!x) return; // a closed tab's late dialog changes nothing (US6 scenario 6)
            if (!d.forAgent) x.dialogOpen = true;
            changed(id);
            const isActive = S.active === tab.tabId;
            // for the agent only the bar note (FR-025d); FR-132: which tab, and whether it is a background tab of the shown session
            if (!d.forAgent) deps.pageDialog({ id, type: d.type, text: d.text, shown: S.visible && isActive, tabId: tab.tabId, bg: S.visible && !isActive });
          },
          onPageDialogClosed: () => {
            const x = mine();
            if (!x) return;
            x.dialogOpen = false;
            changed(id);
          },
          askLeave: (_sid, known) => deps.askLeave(id, known, S.visible && S.active === tab.tabId),
          onNavigationKind: (_sid, kind) => {
            const x = mine();
            if (x) x.byForm = kind === 'form_submit';
          },
          onTabRequest: (_sid, url, foreground) => (mine() ? openFromPage(S, tab, url, foreground) : false),
          onTabKey: (_sid, key) => {
            if (mine()) deps.tabKey?.({ id, key });
          },
        };
        const sv = await deps.views.ensureTabView(id, tab.tabId, events, deps.sim);
        if (!live(S, tab) || tab.opening !== p) {
          // the tab was closed (or the session ended) while its view was being made
          void deps.views.closeTabView(id, tab.tabId).catch(() => undefined);
          return undefined;
        }
        const view = sv.view as BrowserViewLike;
        const t: Tracked = { sv, wc: view.webContents, view, dialogOpen: false, charKey: false, byForm: false, memoryHold: false };
        made = t;
        tab.t = t;
        S.started = true;
        wire(S, tab, t);
        changed(id);
        return t;
      } catch {
        return undefined;
      } finally {
        if (tab.opening === p) tab.opening = undefined;
      }
    })();
    tab.opening = p;
    return p;
  }

  const valid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100 && deps.known(id);
  const result = (id: string): BrowserResult => ({ ok: true, state: stateOf(id), tabs: tabsOf(id), linksNewTab: deps.linksNewTab?.() === true });
  /** FR-127: a tab id from the window: the right shape AND one of this session's tabs in main's map. */
  const ownTab = (id: string, tabId: unknown): Tab | undefined => (validTabId(tabId) ? sessions.get(id)?.tabs.get(tabId) : undefined);

  /** Runs a main-started navigation without waiting for the page to finish loading; a refusal is answered at once. */
  function go(S: Sess, tab: Tab, t: Tracked, action: NavAction, restoring = false): void {
    t.error = undefined;
    if (!restoring) {
      // the #891 rule, per tab (FR-126): main starts a navigation to somewhere new: this tab's kept address is stale and must never be loaded over it
      t.unloadedUrl = undefined;
      t.memory = undefined;
      t.memoryHold = false;
      tab.keptUrl = undefined;
      tab.keptTitle = undefined;
    }
    const url = typeof action === 'object' ? action.url : undefined;
    if (url) tab.pendingUrl = url;
    void t.sv.navigate(action).then(
      (ok) => {
        if (!live(S, tab, t)) return; // a closed tab's late answer changes nothing
        if (url && tab.pendingUrl === url && (!ok || t.wc.isDestroyed() || !t.wc.isLoading())) tab.pendingUrl = undefined;
        if (!ok) changed(S.id);
      },
      () => undefined,
    );
  }
  /** FR-011, FR-126: brings back the page of a tab the cap dropped, from its kept address (`restoring`: the #891 rule keeps it). */
  async function restore(S: Sess, tab: Tab): Promise<void> {
    const x = tab.t;
    if (x && x.unloadedUrl) {
      const u = x.unloadedUrl;
      x.unloadedUrl = undefined;
      x.memory = 'reloaded';
      x.memoryHold = true;
      go(S, tab, x, { url: u }, true);
      return;
    }
    if (x || !tab.keptUrl) return;
    const u = tab.keptUrl;
    tab.pendingUrl = u;
    const t = await ensure(S, tab);
    if (!t || !live(S, tab, t) || tab.keptUrl !== u) return; // closed, or a newer address replaced it meanwhile
    tab.keptUrl = undefined;
    tab.keptTitle = undefined;
    t.memory = 'reloaded';
    t.memoryHold = true;
    go(S, tab, t, { url: u }, true);
    if (S.active === tab.tabId) applyAttach(S.id);
  }
  /** The session's active tab is on the window now (or not): it is marked as shown, brought back if dropped, and attached. */
  function showActive(S: Sess): void {
    const tab = activeTab(S);
    if (tab && S.visible) {
      tab.lastShownAt = now();
      void restore(S, tab);
    }
    applyAttach(S.id);
    changed(S.id);
  }

  async function navigate(id: unknown, address: unknown): Promise<BrowserResult> {
    if (!valid(id)) return refuse('Unknown session.');
    if (!deps.consented()) return needsConsent();
    const a = simAddress(address, deps.sim);
    if (!a.ok) return { ok: false, reason: a.reason, state: stateOf(id) };
    const S = sessFor(id);
    S.limit = false;
    const tab = activeTab(S);
    if (!tab) return refuse('The browser could not start.');
    const t = await ensure(S, tab);
    if (!t || !live(S, tab, t)) return refuse('The browser could not start.');
    go(S, tab, t, { url: a.url });
    applyAttach(id);
    return result(id);
  }

  /** Creates the session's browser and its active tab's view on first use (FR-004); with `address`, also goes there. */
  async function open(id: unknown, address?: unknown): Promise<BrowserResult> {
    if (!valid(id)) return refuse('Unknown session.');
    if (!deps.consented()) return needsConsent();
    // an address the rules refuse makes no view (a link with a user name in it must not leave an empty browser behind)
    if (address !== undefined && address !== '') {
      const a = simAddress(address, deps.sim);
      if (!a.ok) return { ok: false, reason: a.reason };
    }
    const S = sessFor(id);
    const tab = activeTab(S);
    if (!tab) return refuse('The browser could not start.');
    if (address !== undefined && address !== '') return navigate(id, address);
    if (!tab.t && !tab.keptUrl && S.started) return result(id); // a later empty New tab stays without a view (FR-004) until it gets an address
    if (!tab.t && tab.keptUrl) {
      void restore(S, tab);
      return result(id);
    }
    const t = await ensure(S, tab);
    if (!t) return refuse('The browser could not start.');
    return result(id);
  }

  /** FR-124: the reuse match among the session's `user` tabs (committed, pending or kept address). */
  function reuseMatch(S: Sess, url: string): Tab | undefined {
    const facts = S.order.map((tabId) => {
      const tab = S.tabs.get(tabId)!;
      const t = viewOk(tab.t) ? tab.t : undefined;
      return { tabId, kind: tab.kind, lastShownAt: tab.lastShownAt, urls: [t ? t.wc.getURL() : undefined, tab.pendingUrl, t?.unloadedUrl, tab.keptUrl] };
    });
    const hit = findReuse(facts, url);
    return hit ? S.tabs.get(hit) : undefined;
  }
  /** A tab with nothing in it: no page, nothing loading, nothing kept. */
  const isEmpty = (tab: Tab): boolean => !tab.pendingUrl && !tab.keptUrl && !(viewOk(tab.t) && (displayUrl(tab.t.wc.getURL()) !== '' || tab.t.unloadedUrl));

  /** FR-124: a chat link with the toggle on (or the menu's *Open in a new tab*): focus a tab that has it, else a new tab, else (10 tabs) the active tab. */
  async function linkInNewTab(id: string, url: string): Promise<BrowserResult> {
    if (!deps.consented()) return needsConsent();
    const a = simAddress(url, deps.sim);
    if (!a.ok) return { ok: false, reason: a.reason };
    const S = sessions.get(id);
    if (!S) return open(id, url); // the session's first tab takes it
    S.limit = false;
    const hit = reuseMatch(S, a.url);
    if (hit) {
      // a live match is NOT reloaded; a dropped one is brought back from its kept address
      S.active = hit.tabId;
      if (S.visible) hit.lastShownAt = now();
      await restore(S, hit);
      applyAttach(id);
      changed(id);
      return result(id);
    }
    const cur = activeTab(S);
    if (cur && isEmpty(cur)) return navigate(id, a.url); // the empty New tab takes the link (no second, empty tab beside it)
    if (!canAddTab(S.order.length)) {
      const r = await navigate(id, a.url); // FR-126: at 10 tabs the link loads in the active tab, with the limit note
      S.limit = true;
      changed(id);
      return r.ok ? result(id) : r;
    }
    const tab = addTab(S, S.active);
    S.active = tab.tabId;
    tab.pendingUrl = a.url;
    showActive(S);
    const t = await ensure(S, tab);
    if (!t || !live(S, tab, t)) return result(id);
    go(S, tab, t, { url: a.url });
    applyAttach(id);
    return result(id);
  }

  /**
   * FR-125: a page asked for a tab (its URL is already http(s), or a simulator page under sim, from the opener's own top-level origin:
   * `buildViewHandlers.windowOpen`). Main makes the tab; at the limits (10 tabs, 5 per page load) or for a session that is not shown
   * (FR-007, FR-129) it refuses, and the request is offered like a popup. A `foreground-tab` from the active tab becomes active; anything
   * else opens in the background.
   */
  function openFromPage(S: Sess, opener: Tab, url: string, foreground: boolean): boolean {
    if (sessions.get(S.id) !== S || S.tabs.get(opener.tabId) !== opener) return false;
    if (opener.kind !== 'user') return false; // the agent's tab (Phase 2, FR-131) loads such requests in place, never makes tabs
    if (!S.visible) return false; // a tab never opens in a session that is not shown
    if (!canAddTab(S.order.length) || opener.opened >= MAX_TABS_PER_LOAD) return false;
    if (!deps.consented()) return false;
    const a = simAddress(url, deps.sim);
    if (!a.ok) return false;
    opener.opened++;
    const tab = addTab(S, opener.tabId);
    tab.pendingUrl = a.url;
    const fg = foreground && S.active === opener.tabId;
    // FR-129 (2026-10-31 delta): the keyboard focus follows only from the opener page itself. A page asking while the user types in the
    // composer or the chat (a timer, no gesture: FR-125's known gap) never pulls the keys into a page
    const openerHadFocus = fg && !!opener.t && !opener.t.wc.isDestroyed() && opener.t.wc.isFocused?.() === true;
    if (fg) S.active = tab.tabId;
    changed(S.id);
    void ensure(S, tab).then((t) => {
      if (!t || !live(S, tab, t)) return;
      go(S, tab, t, { url: a.url });
      if (S.active === tab.tabId) {
        showActive(S);
        // and only if the user has not gone to Durbar's own window content (the composer, the chat) while the view was being made
        if (openerHadFocus && winFor()?.webContents.isFocused?.() !== true) t.wc.focus?.();
      }
    });
    return true;
  }

  return {
    stateOf,
    tabsOf,
    open,
    /**
     * FR-030, FR-024, FR-123, FR-124: a link from the chat (agent text, so untrusted). Main classifies it, whatever the window did: a web link
     * opens in that session's browser (the address rules of FR-005 apply, so a user name in it is refused): in the active tab, or with the
     * toggle on (or `how: 'newTab'`) in a tab of its own; a mail link waits for the user's click (`openMail`); anything else is refused with
     * static text and no offer. Nothing here calls the system.
     */
    async openLink(id: unknown, url: unknown, how?: unknown): Promise<BrowserResult> {
      if (!valid(id)) return refuse('Unknown session.');
      if (how !== undefined && how !== 'default' && how !== 'newTab') return refuse('Unknown action.');
      if (typeof url !== 'string') return { ok: false, reason: REFUSED_LINK_TEXT, link: 'refused' };
      const kind = deps.sim && /^durbar-sim:\/\/pages\//i.test(url.trim()) ? 'web' : classifyLink(url);
      if (kind === 'mailto') return { ok: false, reason: MAIL_LINK_TEXT, link: 'mailto' };
      if (kind === 'refused') return { ok: false, reason: REFUSED_LINK_TEXT, link: 'refused' };
      if (how === 'newTab' || deps.linksNewTab?.() === true) return linkInNewTab(id, url);
      const S = sessions.get(id);
      if (S) S.limit = false;
      return open(id, url);
    },
    /** FR-024: the user pressed *Open* on a mail link. The only path from the browser to another app; a link that is not `mailto:` is refused again here. */
    async openMail(url: unknown): Promise<{ ok: boolean }> {
      // main re-parses the link and hands over the normalised href, never the text the window sent (2026-10-30 security review)
      const href = parseMailto(url);
      if (!href) return { ok: false };
      await deps.openExternal(href);
      return { ok: true };
    },
    state(id: unknown): BrowserResult {
      if (!valid(id)) return refuse('Unknown session.');
      return result(id);
    },
    navigate,
    /** FR-127: + and Ctrl+T. A new tab to the right of the active one, made active; with `address` (as `browser:open`) it loads there, else it has no view yet. */
    async newTab(id: unknown, address?: unknown): Promise<BrowserResult> {
      if (!valid(id)) return refuse('Unknown session.');
      if (!deps.consented()) return needsConsent();
      let url: string | undefined;
      if (address !== undefined && address !== '') {
        const a = simAddress(address, deps.sim);
        if (!a.ok) return { ok: false, reason: a.reason };
        url = a.url;
      }
      const S = sessions.get(id);
      if (!S) return open(id, address);
      if (!canAddTab(S.order.length)) {
        S.limit = true;
        changed(id);
        return { ok: false, reason: TAB_LIMIT_TEXT, tabLimit: true };
      }
      S.limit = false;
      const tab = addTab(S, S.active);
      S.active = tab.tabId;
      if (url) tab.pendingUrl = url;
      showActive(S);
      if (url) {
        const t = await ensure(S, tab);
        if (t && live(S, tab, t)) {
          go(S, tab, t, { url });
          applyAttach(id);
        }
      }
      return result(id);
    },
    /** FR-127: the window names a tab main told it about; anything else (another session's tab, a malformed id) is refused with no effect. */
    async selectTab(id: unknown, tabId: unknown): Promise<BrowserResult> {
      if (!valid(id)) return refuse('Unknown session.');
      const tab = ownTab(id, tabId);
      const S = sessions.get(id);
      if (!tab || !S) return refuse('Unknown tab.');
      if (S.active !== tab.tabId) S.limit = false;
      S.active = tab.tabId;
      if (S.visible) tab.lastShownAt = now();
      await restore(S, tab); // FR-126: a dropped tab comes back from its kept address
      applyAttach(id);
      changed(id);
      return result(id);
    },
    /**
     * FR-127, FR-128, FR-129: closes one tab. A page with a `beforeunload` handler asks *Leave this page?* first (Stay keeps the tab). The
     * partition stays; the last tab closed leaves one empty *New tab* with no view (US6 scenario 7).
     */
    async closeTab(id: unknown, tabId: unknown): Promise<BrowserResult> {
      if (!valid(id)) return refuse('Unknown session.');
      const tab = ownTab(id, tabId);
      const S = sessions.get(id);
      if (!tab || !S) return refuse('Unknown tab.');
      const t = tab.t;
      if (viewOk(t) && t.sv.closeAsk) {
        const closed = await t.sv.closeAsk();
        if (!closed) return result(id); // Stay
      }
      if (!live(S, tab)) return result(id); // closed meanwhile (the session ended, or a second close)
      // one synchronous step: the list, the active tab and the window's view change together (no reader ever sees a removed tab as active)
      S.tabs.delete(tab.tabId);
      const next = S.active === tab.tabId ? nextActive(S.order, tab.tabId) : S.active;
      S.order = S.order.filter((x) => x !== tab.tabId);
      S.limit = false;
      if (tab.t) detach(tab.t);
      tab.t = undefined;
      tab.opening = undefined;
      // its view goes (a view still being made closes itself when it arrives); the partition stays
      void deps.views.closeTabView(id, tab.tabId).catch(() => undefined);
      if (!S.order.length) {
        // the last tab: one empty New tab, no view until an address is loaded (FR-004); the partition and its cookies stay
        const empty: Tab = { tabId: newTabId(new Set([tab.tabId])), kind: 'user', lastShownAt: 0, opened: 0 };
        S.tabs.set(empty.tabId, empty);
        S.order = [empty.tabId];
        S.active = empty.tabId;
      } else if (next) S.active = next;
      showActive(S);
      return result(id);
    },
    async history(id: unknown, what: unknown): Promise<BrowserResult> {
      if (!valid(id)) return refuse('Unknown session.');
      if (what !== 'back' && what !== 'forward' && what !== 'reload') return refuse('Unknown action.');
      const S = sessions.get(id);
      const tab = S && activeTab(S);
      if (!S || !tab) return refuse('The browser is not open.');
      if (what === 'reload' && ((tab.t && tab.t.unloadedUrl) || (!tab.t && tab.keptUrl))) {
        // Reload on a page the cap dropped brings that page back
        await restore(S, tab);
        return result(id);
      }
      const t = tab.t;
      if (!viewOk(t)) return refuse('The browser is not open.');
      go(S, tab, t, what);
      return result(id);
    },
    stop(id: unknown): BrowserResult {
      if (!valid(id)) return refuse('Unknown session.');
      const S = sessions.get(id);
      const t = S && activeTab(S)?.t;
      if (!S || !t) return refuse('The browser is not open.');
      if (!t.wc.isDestroyed()) t.wc.stop();
      changed(id);
      return result(id);
    },
    bounds(id: unknown, raw: unknown): { ok: boolean } {
      if (!valid(id)) return { ok: false };
      const S = sessions.get(id);
      const win = winFor();
      if (!S || !win) return { ok: false };
      const b = checkBounds(raw, win.getContentBounds(), win.webContents.getZoomFactor());
      if (!b) return { ok: false };
      S.bounds = b;
      applyAttach(id);
      return { ok: true };
    },
    visible(id: unknown, visible: unknown): { ok: boolean } {
      if (!valid(id) || typeof visible !== 'boolean') return { ok: false };
      const S = sessions.get(id);
      if (!S) return { ok: false };
      if (visible && !S.bounds) return { ok: false }; // never attach a view that has no place yet
      S.visible = visible;
      if (visible) showActive(S); // FR-011: shown again after its page was dropped: reload it, and say so in the bar
      else applyAttach(id);
      return { ok: true };
    },
    overlay(id: unknown, open: unknown): { ok: boolean } {
      if (!valid(id) || typeof open !== 'boolean') return { ok: false };
      const S = sessions.get(id);
      if (!S) return { ok: false };
      S.overlay = open;
      applyAttach(id);
      return { ok: true };
    },
    mute(id: unknown, muted: unknown): BrowserResult {
      if (!valid(id) || typeof muted !== 'boolean') return refuse('Unknown session.');
      const S = sessions.get(id);
      const t = S && activeTab(S)?.t;
      if (!t || t.wc.isDestroyed()) return refuse('The browser is not open.');
      t.wc.setAudioMuted(muted);
      changed(id);
      return result(id);
    },
    async openSystem(id: unknown): Promise<{ ok: boolean }> {
      if (!valid(id)) return { ok: false };
      const S = sessions.get(id);
      const t = S && activeTab(S)?.t;
      const url = t && !t.wc.isDestroyed() ? t.wc.getURL() : '';
      if (!isHttpUrl(url)) return { ok: false };
      await deps.openExternal(url);
      return { ok: true };
    },
    /** FR-008: the still picture of the page area, an in-memory data URL for the window to show while an overlay hides the view. Never stored. */
    async snapshot(id: unknown): Promise<{ ok: boolean; image?: string }> {
      if (!valid(id)) return { ok: false };
      const S = sessions.get(id);
      const t = S && activeTab(S)?.t;
      if (!t || t.wc.isDestroyed() || !t.attachedTo) return { ok: false };
      try {
        // a page with a dialog open can leave capturePage waiting for good: the picture is optional, hiding the view is not
        const img = await Promise.race([t.wc.capturePage(), new Promise<undefined>((r) => setTimeout(() => r(undefined), deps.snapshotMs ?? SNAPSHOT_MS))]);
        if (!img) return { ok: false };
        const url = img.toDataURL();
        return typeof url === 'string' && url.startsWith('data:image/') ? { ok: true, image: url } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
    /** End, remove, folder remove (FR-023, FR-128): off the window first, then every tab's view and the session's partition go. Safe for any id. */
    async destroy(id: string): Promise<void> {
      const S = sessions.get(id);
      if (S) {
        for (const tab of S.tabs.values()) if (tab.t) detach(tab.t);
        sessions.delete(id);
      }
      deps.dropAsks?.(id);
      await deps.views.destroySessionView(id);
      deps.emit(closedState(id));
      deps.emitTabs?.({ id, active: '', tabs: [] });
    },
    /** The window's page is loading again (a reload or a crash recovery): nothing it knew is true, so no view may stay on top of it. */
    detachAll(): void {
      deps.dropAsks?.();
      for (const S of sessions.values()) {
        S.visible = false;
        S.overlay = false;
        for (const tab of S.tabs.values()) if (tab.t) detach(tab.t);
      }
    },
    /** Sessions with a view on the window (at most one). */
    attachedIds: (): string[] => [...sessions.values()].filter((S) => [...S.tabs.values()].some((t) => t.t?.attachedTo)).map((S) => S.id),
    liveIds: (): string[] => [...sessions.keys()],
    /** Test hook: every tab id of a session, in order. */
    tabIds: (id: string): string[] => sessions.get(id)?.order.slice() ?? [],
    /** Test hook: the reuse key FR-124 compares (re-exported so the test uses the same rule). */
    reuseKey,
  };
}
export type BrowserController = ReturnType<typeof makeBrowserController>;
