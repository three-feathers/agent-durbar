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
import type { BrowserResult, BrowserState } from '../../shared/api';
import type { NavAction } from '../hardening';
import { MAX_LIVE_VIEWS, pickUnload } from './viewcap';
import type { CapView } from './viewcap';
import type { SessionView, ViewEvents } from './views';

export const STATE_KEYS = ['id', 'open', 'url', 'title', 'loading', 'canBack', 'canForward', 'muted', 'driver', 'dialogOpen', 'error', 'note', 'memory'] as const;
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
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean };
}
export interface BrowserViewLike {
  webContents: BrowserWc;
  setBounds(b: { x: number; y: number; width: number; height: number }): void;
}
export type BrowserSessionView = Pick<SessionView, 'driver' | 'navigate' | 'destroy'> & { view: unknown };
export interface BrowserWinLike {
  isDestroyed(): boolean;
  contentView: { addChildView(v: never): void; removeChildView(v: never): void };
  getContentBounds(): { width: number; height: number };
  webContents: { getZoomFactor(): number };
}
export interface BrowserDeps {
  /** True for a top-level session of the office (looked up in main); under the simulator also the simulated agents' ids. */
  known(id: string): boolean;
  sim: boolean;
  window(): BrowserWinLike | undefined;
  views: {
    ensureSessionView(id: string, events: ViewEvents, sim: boolean): Promise<BrowserSessionView>;
    destroySessionView(id: string): Promise<void>;
  };
  /** A change worth telling the window about (coalesced, and only when something differs). */
  emit(s: BrowserState): void;
  /** The existing external-link path (`shell.openExternal`); never called for anything but http(s). */
  openExternal(url: string): Promise<unknown>;
  /** FR-025d (Q2): the one-time note was accepted for this app profile. The view is not created before. */
  consented(): boolean;
  /** FR-025d: a page dialog opened; `shown` = the view is on the window now. The window raises the toast and brings the chat forward. */
  pageDialog(d: { id: string; type: string; text: string; shown: boolean }): void;
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

interface Tracked {
  sv: BrowserSessionView;
  wc: BrowserWc;
  view: BrowserViewLike;
  bounds?: { x: number; y: number; width: number; height: number };
  visible: boolean;
  overlay: boolean;
  attachedTo?: BrowserWinLike;
  error?: string;
  note?: string;
  dialogOpen: boolean;
  /** FR-011: last time this view was put on the window (ms). */
  lastShownAt: number;
  /** The page was unloaded to save memory: its address, kept until it is shown again. */
  unloadedUrl?: string;
  /** Any character key input since the page loaded (from the view's `input-event`). */
  charKey: boolean;
  /** The page was reached by a form submit (Chromium's transition type). */
  byForm: boolean;
  memory?: 'reloaded' | 'many';
  /** The reload after an unload is in flight: its own navigation start must not clear the note. */
  memoryHold: boolean;
  last?: string;
  queued: boolean;
}

export function makeBrowserController(deps: BrowserDeps) {
  const tracked = new Map<string, Tracked>();
  const opening = new Map<string, Promise<Tracked | undefined>>();
  const later = deps.later ?? ((fn: () => void) => void setImmediate(fn));
  const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  const needsConsent = (): BrowserResult => ({ ok: false, reason: 'The browser needs your OK first.', needsConsent: true });

  /** The only object that leaves for the window: explicit fields, primitives only. */
  function stateOf(id: string): BrowserState {
    const t = tracked.get(id);
    if (!t || t.wc.isDestroyed()) return { id, open: false, url: '', title: '', loading: false, canBack: false, canForward: false, muted: true, driver: 'user', dialogOpen: false };
    const s: BrowserState = {
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
    };
    if (t.error && !s.loading) s.error = t.error;
    if (t.note) s.note = t.note;
    if (t.memory) s.memory = t.memory;
    return s;
  }
  /** Tell the window, once per burst of events, and only if the state changed. */
  function changed(id: string): void {
    const t = tracked.get(id);
    if (!t || t.queued) return;
    t.queued = true;
    later(() => {
      t.queued = false;
      if (tracked.get(id) !== t) return;
      const s = stateOf(id);
      const key = JSON.stringify(s);
      if (key === t.last) return;
      t.last = key;
      deps.emit(s);
    });
  }

  /** A page is loaded: the view has a real address and was not unloaded to save memory. */
  const loadedOf = (t: Tracked): boolean => !t.unloadedUrl && !t.wc.isDestroyed() && displayUrl(t.wc.getURL()) !== '';
  /**
   * FR-011: a page just loaded in `newId`. If more than `MAX_LIVE_VIEWS` pages would stay loaded, the least recently shown safe views drop
   * their page (the address and the partition stay; it reloads when shown again). With no safe view left, the new one stays loaded and says so.
   */
  function enforceCap(newId: string): void {
    const views: CapView[] = [];
    for (const [i, x] of tracked) {
      if (i === newId) continue;
      views.push({ id: i, loaded: loadedOf(x), shown: !!x.visible, lastShownAt: x.lastShownAt, reachedByPost: x.byForm, charKeySinceLoad: x.charKey, callInFlight: false, callInCurrentTurn: false, browserTypeSinceLoad: false });
    }
    const { unload, overCap } = pickUnload(views, MAX_LIVE_VIEWS);
    for (const i of unload) {
      const x = tracked.get(i);
      if (!x) continue;
      x.unloadedUrl = x.wc.getURL();
      x.memory = undefined;
      void x.sv.navigate({ url: 'about:blank' }).catch(() => undefined);
      changed(i);
    }
    const t = tracked.get(newId);
    if (t) {
      t.memory = overCap ? 'many' : t.memory === 'many' ? undefined : t.memory;
      changed(newId);
    }
  }

  function wire(id: string, t: Tracked): void {
    const wc = t.wc;
    const ping = (): void => changed(id);
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'audio-state-changed']) wc.on(ev, ping as never);
    wc.on('did-start-navigation', ((e?: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
      if (e && (e.isMainFrame === false || e.isSameDocument === true)) return; // a frame or a hash change is not a new page
      t.error = undefined;
      t.note = undefined;
      if (t.memoryHold) t.memoryHold = false; // the reload that brings an unloaded page back keeps its note
      else t.memory = undefined;
      ping();
    }) as never);
    wc.on('did-navigate', (() => {
      t.charKey = false; // a new page: key input counts from here (FR-011)
      t.byForm = false; // until the history says this page came from a form
      if (loadedOf(t)) {
        t.unloadedUrl = undefined;
        enforceCap(id);
      }
    }) as never);
    wc.on('input-event', ((_e: unknown, ev: { type?: string }) => {
      if (ev && ev.type === 'char') t.charKey = true; // main never reads the page: it only sees that keys were typed
    }) as never);
    wc.on('did-fail-load', ((_e: unknown, code: number, desc: string, _url: string, isMain: boolean) => {
      if (isMain && code !== -3) t.error = errorName(desc); // -3 is a navigation another one replaced
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
  /** The one rule for "is it on screen": asked for, not covered by an overlay, and it has bounds. Only one view at a time. */
  function applyAttach(id: string): void {
    const t = tracked.get(id);
    if (!t) return;
    const win = winFor();
    const want = !!win && t.visible && !t.overlay && !!t.bounds && !t.wc.isDestroyed();
    if (!want || !win) {
      detach(t);
      return;
    }
    for (const [otherId, o] of tracked) if (otherId !== id) detach(o);
    if (t.attachedTo !== win) {
      detach(t);
      win.contentView.addChildView(t.view as never);
      t.attachedTo = win;
    }
    if (t.bounds) t.view.setBounds(t.bounds);
  }

  async function ensure(id: string): Promise<Tracked | undefined> {
    const have = tracked.get(id);
    if (have && !have.wc.isDestroyed()) return have;
    let p = opening.get(id);
    if (!p) {
      p = (async () => {
        try {
          const events: ViewEvents = {
            onDialogNote: (_sid, note) => {
              const x = tracked.get(id);
              if (x) x.note = cleanTitle(note);
              changed(id);
            },
            onPageDialog: (_sid, d) => {
              const x = tracked.get(id);
              if (x && !d.forAgent) x.dialogOpen = true;
              changed(id);
              if (!d.forAgent) deps.pageDialog({ id, type: d.type, text: d.text, shown: !!x?.visible }); // for the agent only the bar note (FR-025d)
            },
            onPageDialogClosed: () => {
              const x = tracked.get(id);
              if (x) x.dialogOpen = false;
              changed(id);
            },
            askLeave: (_sid, known) => deps.askLeave(id, known, !!tracked.get(id)?.visible),
            onNavigationKind: (_sid, kind) => {
              const x = tracked.get(id);
              if (x) x.byForm = kind === 'form_submit';
            },
          };
          const sv = await deps.views.ensureSessionView(id, events, deps.sim);
          const view = sv.view as BrowserViewLike;
          const t: Tracked = { sv, wc: view.webContents, view, visible: false, overlay: false, queued: false, dialogOpen: false, lastShownAt: 0, charKey: false, byForm: false, memoryHold: false };
          tracked.set(id, t);
          wire(id, t);
          changed(id);
          return t;
        } catch {
          return undefined;
        } finally {
          opening.delete(id);
        }
      })();
      opening.set(id, p);
    }
    return p;
  }

  const valid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100 && deps.known(id);
  const result = (id: string): BrowserResult => ({ ok: true, state: stateOf(id) });

  /** Runs a main-started navigation without waiting for the page to finish loading; a refusal is answered at once. */
  function go(id: string, t: Tracked, action: NavAction): void {
    t.error = undefined;
    void t.sv.navigate(action).then((ok) => ok || changed(id), () => undefined);
  }
  async function navigate(id: unknown, address: unknown): Promise<BrowserResult> {
    if (!valid(id)) return refuse('Unknown session.');
    if (!deps.consented()) return needsConsent();
    const a = simAddress(address, deps.sim);
    if (!a.ok) return { ok: false, reason: a.reason, state: stateOf(id) };
    const t = await ensure(id);
    if (!t) return refuse('The browser could not start.');
    go(id, t, { url: a.url });
    return result(id);
  }

  /** Creates the session's view on first use (FR-004); with `address`, also goes there. */
  async function open(id: unknown, address?: unknown): Promise<BrowserResult> {
    if (!valid(id)) return refuse('Unknown session.');
    if (!deps.consented()) return needsConsent();
    // an address the rules refuse makes no view (a link with a user name in it must not leave an empty browser behind)
    if (address !== undefined && address !== '') {
      const a = simAddress(address, deps.sim);
      if (!a.ok) return { ok: false, reason: a.reason };
    }
    const t = await ensure(id);
    if (!t) return refuse('The browser could not start.');
    if (address !== undefined && address !== '') return navigate(id, address);
    return result(id);
  }

  return {
    stateOf,
    open,
    /**
     * FR-030, FR-024: a link from the chat (agent text, so untrusted). Main classifies it, whatever the window did: a web link opens in
     * that session's browser (the address rules of FR-005 apply, so a user name in it is refused); a mail link waits for the user's click
     * (`openMail`); anything else is refused with static text and no offer. Nothing here calls the system.
     */
    async openLink(id: unknown, url: unknown): Promise<BrowserResult> {
      if (!valid(id)) return refuse('Unknown session.');
      if (typeof url !== 'string') return { ok: false, reason: REFUSED_LINK_TEXT, link: 'refused' };
      const kind = deps.sim && /^durbar-sim:\/\/pages\//i.test(url.trim()) ? 'web' : classifyLink(url);
      if (kind === 'mailto') return { ok: false, reason: MAIL_LINK_TEXT, link: 'mailto' };
      if (kind === 'refused') return { ok: false, reason: REFUSED_LINK_TEXT, link: 'refused' };
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
    async history(id: unknown, what: unknown): Promise<BrowserResult> {
      if (!valid(id)) return refuse('Unknown session.');
      if (what !== 'back' && what !== 'forward' && what !== 'reload') return refuse('Unknown action.');
      const t = tracked.get(id);
      if (!t) return refuse('The browser is not open.');
      go(id, t, what);
      return result(id);
    },
    stop(id: unknown): BrowserResult {
      if (!valid(id)) return refuse('Unknown session.');
      const t = tracked.get(id);
      if (!t) return refuse('The browser is not open.');
      if (!t.wc.isDestroyed()) t.wc.stop();
      changed(id);
      return result(id);
    },
    bounds(id: unknown, raw: unknown): { ok: boolean } {
      if (!valid(id)) return { ok: false };
      const t = tracked.get(id);
      const win = winFor();
      if (!t || !win) return { ok: false };
      const b = checkBounds(raw, win.getContentBounds(), win.webContents.getZoomFactor());
      if (!b) return { ok: false };
      t.bounds = b;
      applyAttach(id);
      return { ok: true };
    },
    visible(id: unknown, visible: unknown): { ok: boolean } {
      if (!valid(id) || typeof visible !== 'boolean') return { ok: false };
      const t = tracked.get(id);
      if (!t) return { ok: false };
      if (visible && !t.bounds) return { ok: false }; // never attach a view that has no place yet
      t.visible = visible;
      if (visible) {
        t.lastShownAt = (deps.now ?? Date.now)();
        if (t.unloadedUrl) {
          // FR-011: shown again after its page was dropped: reload it, and say so in the bar
          const u = t.unloadedUrl;
          t.unloadedUrl = undefined;
          t.memory = 'reloaded';
          t.memoryHold = true;
          go(id, t, { url: u });
        }
      }
      applyAttach(id);
      return { ok: true };
    },
    overlay(id: unknown, open: unknown): { ok: boolean } {
      if (!valid(id) || typeof open !== 'boolean') return { ok: false };
      const t = tracked.get(id);
      if (!t) return { ok: false };
      t.overlay = open;
      applyAttach(id);
      return { ok: true };
    },
    mute(id: unknown, muted: unknown): BrowserResult {
      if (!valid(id) || typeof muted !== 'boolean') return refuse('Unknown session.');
      const t = tracked.get(id);
      if (!t || t.wc.isDestroyed()) return refuse('The browser is not open.');
      t.wc.setAudioMuted(muted);
      changed(id);
      return result(id);
    },
    async openSystem(id: unknown): Promise<{ ok: boolean }> {
      if (!valid(id)) return { ok: false };
      const t = tracked.get(id);
      const url = t && !t.wc.isDestroyed() ? t.wc.getURL() : '';
      if (!isHttpUrl(url)) return { ok: false };
      await deps.openExternal(url);
      return { ok: true };
    },
    /** FR-008: the still picture of the page area, an in-memory data URL for the window to show while an overlay hides the view. Never stored. */
    async snapshot(id: unknown): Promise<{ ok: boolean; image?: string }> {
      if (!valid(id)) return { ok: false };
      const t = tracked.get(id);
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
    /** End, remove, folder remove (FR-023): off the window first, then the view and its partition go. Safe for any id. */
    async destroy(id: string): Promise<void> {
      const t = tracked.get(id);
      if (t) {
        detach(t);
        tracked.delete(id);
      }
      deps.dropAsks?.(id);
      await deps.views.destroySessionView(id);
      deps.emit({ id, open: false, url: '', title: '', loading: false, canBack: false, canForward: false, muted: true, driver: 'user', dialogOpen: false });
    },
    /** The window's page is loading again (a reload or a crash recovery): nothing it knew is true, so no view may stay on top of it. */
    detachAll(): void {
      deps.dropAsks?.();
      for (const t of tracked.values()) {
        t.visible = false;
        t.overlay = false;
        detach(t);
      }
    },
    attachedIds: (): string[] => [...tracked].filter(([, t]) => t.attachedTo).map(([id]) => id),
    liveIds: (): string[] => [...tracked.keys()],
  };
}
export type BrowserController = ReturnType<typeof makeBrowserController>;
