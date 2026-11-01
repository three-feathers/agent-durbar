/**
 * Spec 080 T012, T022: the session browser's views. One lazy `WebContentsView` per page tab; a session's tabs share its in-memory partition (FR-020, FR-121), hardened
 * (FR-010, FR-024..FR-028), muted (FR-012), with the debugger attached at creation and only the `Page` domain on (FR-042), torn down
 * when the session ends (FR-023). No IPC and no renderer yet (T014/T015): nothing here is user-visible, and the view is not added to a window.
 * `makeViews(deps)` takes Electron's parts as arguments so `scripts/test-browserviews.ts` can run it against a fake.
 */
import { app, session, WebContentsView } from 'electron';
import { buildViewHandlers, dialogText, installViewSessionHandlers, installViewWebContentsHandlers, LeaveApproval, navigateChecked, newViewPartition, viewDialogPolicy, viewUserAgent, viewWebPreferences } from '../hardening';
import { installSimPages } from './simpages';
import { tabShortcut } from './tabs';
import type { KeyLike, TabShortcut } from './tabs';
import type { NavAction, NavTarget, ViewHandlers, ViewSessionLike, ViewWebContentsLike } from '../hardening';

export type ViewDriver = 'user' | 'agent' | 'none';

export interface ViewEvents {
  /** The bar note for a page dialog the agent's driving closed (FR-025d). */
  onDialogNote?(sessionId: string, note: string): void;
  /** A scripted popup with an http(s) URL (FR-026): the bar offers *Open in system browser*. */
  onPopupBlocked?(sessionId: string, url: string): void;
  /** FR-025e: Durbar's *Leave this page?* box for a user-driven view; true = Leave. `targetKnown`: main started the navigation (else the box says *Leave, then click again*). Absent: the view leaves. */
  askLeave?(sessionId: string, targetKnown: boolean): Promise<boolean>;
  /** FR-025d: a page opened an `alert` or `confirm` (not `beforeunload`). `forAgent`: main closed it with Cancel (the bar's note), so no user box exists. `text` is masked and cut. */
  onPageDialog?(sessionId: string, d: { type: string; text: string; forAgent: boolean }): void;
  /** FR-025d: the dialog closed (`Page.javascriptDialogClosed`): the *Dialog open* marker goes. */
  onPageDialogClosed?(sessionId: string): void;
  /** FR-011: how the page now shown was reached, from Chromium's own history (`transitionType`: `form_submit` for a submitted form, so a POST page is never unloaded). */
  onNavigationKind?(sessionId: string, transitionType: string): void;
  /** Spec 080 FR-125: a same-origin tab request from this tab's page; main makes the tab. False = refused (the limits), then it is offered like a popup. */
  onTabRequest?(sessionId: string, url: string, foreground: boolean): boolean;
  /** Spec 080 FR-130: a tab key pressed inside the page (already kept from the page with preventDefault). */
  onTabKey?(sessionId: string, key: TabShortcut): void;
}

export interface SessionView {
  readonly sessionId: string;
  /** Spec 080 FR-120: the page tab this view belongs to (minted by the controller in main). */
  readonly tabId: string;
  /** FR-121: the session's partition, shared by all its tabs. */
  readonly partition: string;
  readonly view: WebContentsView;
  driver: ViewDriver;
  readonly sim: boolean;
  /** The only way to move the view: loadURL, back, forward and reload (FR-024). False = refused. */
  navigate(action: NavAction): Promise<boolean>;
  /** FR-121, FR-128: closes this tab's view only (debugger detached, no `beforeunload`). The partition is cleared by the session's teardown. Safe to call twice. */
  close(): void;
  /**
   * FR-128: the user closes this tab: the page's `beforeunload` runs, and a page that asks gets Durbar's *Leave this page?* (FR-025e).
   * True = closed (no question, Leave, or the session went meanwhile); false = Stay (the tab stays).
   */
  closeAsk(): Promise<boolean>;
}

/** What `makeViews` needs from Electron; the real values are at the bottom, a fake is in the test. */
interface DebuggerLike {
  attach(v: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, params?: object): Promise<unknown>;
  on(ev: 'message', fn: (e: unknown, method: string, params: { type?: string; message?: string }) => void): unknown;
}
interface WcLike extends ViewWebContentsLike, NavTarget {
  debugger: DebuggerLike;
  setUserAgent(ua: string): void;
  getUserAgent(): string;
  setAudioMuted(m: boolean): void;
  close(o?: object): void;
  isDestroyed(): boolean;
}
interface SesLike extends ViewSessionLike {
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
}
export interface ViewDeps {
  createView(prefs: Record<string, unknown>): { webContents: WcLike };
  sessionFromPartition(name: string): SesLike;
  chromeVersion: string;
  /** Called once per new session partition with the simulator decision (T018: the test pages). Absent in the tests that do not need it. */
  onPartition?(ses: SesLike, sim: boolean): void;
  /** Test hook: `CLOSE_ASK_MS`. */
  closeAskMs?: number;
}

/** FR-121: one partition per session, made with its first view and shared by every later tab; cleared once by the session's teardown. */
interface SessionRec {
  partition: string;
  ses: SesLike;
  /** Tab views being built or built, by tab id. */
  tabs: Map<string, Promise<SessionView>>;
  built: Map<string, SessionView>;
  downloads: Set<{ cancel(): void }>;
  removeSesHandlers(): void;
  trackDownload: (...a: never[]) => void;
  /** Set by the teardown: a build still running closes its own view. */
  ended: boolean;
  /** A view of this session was built once: its partition may hold the user's logins, so a later failure never clears it. */
  everBuilt: boolean;
  cleared?: Promise<void>;
}

/** FR-128: how long a closing tab's page may take to run its `beforeunload` before the tab is closed anyway (a page that asks is not timed). */
export const CLOSE_ASK_MS = 3000;

export function makeViews(deps: ViewDeps) {
  const sessions = new Map<string, SessionRec>();

  /** The dialog part of a view: the one place that reacts to `Page.javascriptDialogOpening` (see `viewDialogPolicy`). */
  function wireViewDialogs(sv: SessionView, wc: WcLike, events: ViewEvents): void {
    wc.debugger.on('message', (_e, method, params) => {
      if (method === 'Page.javascriptDialogClosed') return void events.onPageDialogClosed?.(sv.sessionId);
      if (method !== 'Page.javascriptDialogOpening') return;
      const r = viewDialogPolicy(sv.driver, { type: String(params?.type ?? ''), message: String(params?.message ?? '') });
      if (r.answer) wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: r.answer.accept }).catch(() => undefined); // "no dialog is showing" is harmless
      if (r.note) events.onDialogNote?.(sv.sessionId, r.note);
      if (String(params?.type ?? '') !== 'beforeunload') events.onPageDialog?.(sv.sessionId, { type: String(params?.type ?? ''), text: dialogText(params?.message, 80), forAgent: r.answer !== null });
    });
  }

  /** The session's partition record, made on its first view (FR-004, FR-121): the deny-all session handlers and the download watch go on once. */
  function sessionRec(sessionId: string, sim: boolean): SessionRec {
    const have = sessions.get(sessionId);
    if (have) return have;
    const partition = newViewPartition();
    // Electron makes the session object on first use; the view below uses the same name
    const ses = deps.sessionFromPartition(partition);
    deps.onPartition?.(ses, sim);
    const downloads = new Set<{ cancel(): void }>();
    // the session handlers do not depend on a tab (they refuse everything); built from the same builder as each tab's
    const removeSesHandlers = installViewSessionHandlers(ses, buildViewHandlers({ sim, loadInView: () => undefined, onPopupBlocked: () => undefined }));
    // US3 builds downloads; until then every one is cancelled by the handler above, and any that is running is cancelled on teardown
    const trackDownload = ((_e: unknown, item: { cancel(): void; once?(e: string, f: () => void): void }) => {
      downloads.add(item);
      item.once?.('done', () => downloads.delete(item));
    }) as never;
    ses.on('will-download', trackDownload);
    const rec: SessionRec = { partition, ses, tabs: new Map(), built: new Map(), downloads, removeSesHandlers, trackDownload, ended: false, everBuilt: false };
    sessions.set(sessionId, rec);
    return rec;
  }

  async function build(rec: SessionRec, sessionId: string, tabId: string, events: ViewEvents, sim: boolean, packaged: boolean): Promise<SessionView> {
    const partition = rec.partition;
    const view = deps.createView(viewWebPreferences({ partition, packaged }));
    const wc = view.webContents;
    const leave = new LeaveApproval();
    // FR-025e: only a navigation main started, and only while it is in flight, can be repeated after *Leave*. A page-started leave is not
    // repeated (its target is not known): the page stays and the user clicks again.
    let inFlight: { action: NavAction; settled: Promise<unknown> } | undefined;
    let blocked: { action: NavAction; settled: Promise<unknown> } | undefined; // the in-flight one when a beforeunload cancelled it
    let closed = false;
    let closingAsk: ((closed: boolean) => void) | undefined; // a user close waiting for the page's beforeunload (FR-128)
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let asking = false; // Durbar's Leave this page? is open for that close
    const sv: SessionView = {
      sessionId,
      tabId,
      partition,
      view: view as unknown as WebContentsView,
      driver: 'user',
      sim,
      navigate: async (action) => {
        if (closed) return false; // a closed tab never loads again (a late Leave or a stale promise)
        let done!: () => void;
        const mine = { action, settled: new Promise<void>((r) => (done = r)) };
        inFlight = mine; // before the load starts: the unload event may come at once
        blocked = undefined;
        try {
          return await navigateChecked(wc, action, sim).catch(() => false);
        } finally {
          done();
          if (inFlight === mine) inFlight = undefined;
        }
      },
      closeAsk: () =>
        new Promise<boolean>((resolve) => {
          if (closed || wc.isDestroyed() || !events.askLeave || sv.driver === 'agent') {
            sv.close();
            return resolve(true);
          }
          if (closingAsk) closingAsk(false); // a second close while the first still asks: the first one's answer decides
          closingAsk = resolve;
          // a page that never answers (hung, or Chromium skipped the event) must not keep its tab open: closed after CLOSE_ASK_MS unless it asked
          clearTimeout(closeTimer);
          closeTimer = setTimeout(() => {
            if (closingAsk && !asking) sv.close();
          }, deps.closeAskMs ?? CLOSE_ASK_MS);
          try {
            // runs the page's beforeunload: with no handler the page closes ('destroyed'); a handler that asks reaches willPreventUnload below
            wc.close({ waitForBeforeUnload: true });
          } catch {
            sv.close();
          }
        }),
      close: () => {
        clearTimeout(closeTimer);
        asking = false;
        if (closingAsk) {
          const r = closingAsk;
          closingAsk = undefined;
          r(true);
        }
        if (closed) return;
        closed = true;
        try {
          if (wc.debugger.isAttached()) wc.debugger.detach();
        } catch {
          /* already gone */
        }
        try {
          if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false }); // no beforeunload (FR-025e, FR-128)
        } catch {
          /* already gone */
        }
      },
    };
    const handlers: ViewHandlers = buildViewHandlers({
      sim,
      loadInView: (url) => void sv.navigate({ url }).catch(() => undefined),
      openTab: events.onTabRequest ? (url, foreground) => !closed && events.onTabRequest!(sessionId, url, foreground) : undefined,
      onPopupBlocked: (url) => events.onPopupBlocked?.(sessionId, url),
      driver: () => sv.driver,
      currentUrl: () => wc.getURL(),
      askLeave: events.askLeave ? () => events.askLeave!(sessionId, blocked !== undefined) : undefined,
      leave,
      onUnloadBlocked: () => {
        blocked = inFlight; // undefined for a page-started unload
        if (closingAsk) asking = true; // the page asked: the person answers, no time limit
      },
      onLeaveAnswer: (leave) => {
        const b = blocked;
        blocked = undefined;
        if (closingAsk) {
          // FR-128: the question came from the user closing this tab: Leave closes it (no second beforeunload), Stay keeps it
          const r = closingAsk;
          closingAsk = undefined;
          asking = false;
          clearTimeout(closeTimer);
          if (leave) sv.close();
          r(leave);
          return;
        }
        if (!leave || !b || closed) return;
        // wait for the cancelled navigation to settle, then repeat it on the next tick. `[KNOWN GAP]` (T007 `sim:`): an instant answer is still not repeated in real Electron (ERR_FAILED); askDialog is never instant
        void b.settled.then(() => setImmediate(() => void (closed ? undefined : navigateChecked(wc, b.action, sim).catch(() => undefined))));
      },
    });
    installViewWebContentsHandlers(wc, handlers);
    // FR-128: a page with no beforeunload handler closes at once when the user closes its tab
    wc.on('destroyed', (() => {
      if (closingAsk) sv.close();
    }) as never);
    // FR-130: the tab keys never reach the page; main acts on them (the window is told which one)
    if (events.onTabKey) {
      wc.on('before-input-event', ((e: { preventDefault(): void }, input: KeyLike) => {
        const k = tabShortcut(input, process.platform === 'darwin');
        if (!k) return;
        e.preventDefault();
        if (!closed) events.onTabKey!(sessionId, k);
      }) as never);
    }
    wc.setUserAgent(viewUserAgent(wc.getUserAgent(), deps.chromeVersion)); // per view; app.userAgentFallback stays as it is (FR-028)
    wc.setAudioMuted(true); // FR-012
    try {
      // a command sent before the first navigation never answers (docs/agent-notes.md), so about:blank first (FR-042)
      await sv.navigate({ url: 'about:blank' });
      wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.enable'); // only Page; the other domains are Phase 2
      wireViewDialogs(sv, wc, events);
      wc.on('did-navigate', (() => {
        if (!events.onNavigationKind) return;
        wc.debugger.sendCommand('Page.getNavigationHistory').then(
          (h) => {
            const hist = h as { currentIndex?: number; entries?: { transitionType?: string }[] };
            const e = hist && Array.isArray(hist.entries) && typeof hist.currentIndex === 'number' ? hist.entries[hist.currentIndex] : undefined;
            if (e && typeof e.transitionType === 'string') events.onNavigationKind!(sessionId, e.transitionType);
          },
          () => undefined,
        );
      }) as never);
    } catch (e) {
      sv.close(); // a half-built view must not stay open
      throw e;
    }
    return sv;
  }

  /** FR-128: the partition is cleared once, after every view of the session is closed (and every build still running has settled). */
  async function endSession(sessionId: string, rec: SessionRec): Promise<void> {
    if (rec.cleared) return rec.cleared;
    rec.ended = true;
    if (sessions.get(sessionId) === rec) sessions.delete(sessionId);
    // the synchronous part first, so it also runs when the app is quitting
    for (const d of rec.downloads) {
      try {
        d.cancel();
      } catch {
        /* done already */
      }
    }
    rec.downloads.clear();
    // Electron keeps the partition's session until quit: take our listeners (and their hold on these views) off it, keep the deny-all handlers
    rec.removeSesHandlers();
    rec.ses.removeListener('will-download', rec.trackDownload);
    for (const sv of rec.built.values()) sv.close();
    rec.built.clear();
    const pending = [...rec.tabs.values()];
    rec.tabs.clear();
    rec.cleared = (async () => {
      await Promise.all(pending.map((p) => p.then((sv) => sv.close(), () => undefined)));
      await rec.ses.clearStorageData().catch(() => undefined);
      await rec.ses.clearCache().catch(() => undefined);
    })();
    return rec.cleared;
  }

  /** A tab's view, created on first use (lazy, FR-004) in its session's partition (FR-121) and shared by concurrent callers. */
  function ensureTabView(sessionId: string, tabId: string, events: ViewEvents = {}, sim = false, packaged = false): Promise<SessionView> {
    const rec = sessionRec(sessionId, sim);
    let p = rec.tabs.get(tabId);
    if (!p) {
      const mine: Promise<SessionView> = build(rec, sessionId, tabId, events, sim, packaged).then(
        (sv) => {
          if (rec.ended || rec.tabs.get(tabId) !== mine) {
            // the session ended, or the tab was closed, while this view was being built: it is stale
            sv.close();
            throw new Error('the session ended while its browser was being created');
          }
          rec.built.set(tabId, sv);
          rec.everBuilt = true;
          return sv;
        },
        async (e: unknown) => {
          if (rec.tabs.get(tabId) === mine) rec.tabs.delete(tabId);
          // the session's first view failed to build: nothing ever used its partition, so it goes before the caller hears (a retry gets a new one)
          if (!rec.ended && !rec.everBuilt && rec.tabs.size === 0 && rec.built.size === 0) await endSession(sessionId, rec);
          throw e;
        },
      );
      p = mine;
      rec.tabs.set(tabId, mine);
      mine.catch(() => {
        if (rec.tabs.get(tabId) === mine) rec.tabs.delete(tabId); // a stale build leaves no entry behind
      });
    }
    return p;
  }

  /** FR-121: closes one tab's view; never clears the partition (the session's other tabs and its logins stay). */
  async function closeTabView(sessionId: string, tabId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) return;
    const p = rec.tabs.get(tabId);
    rec.tabs.delete(tabId); // a build still running sees this and closes its own view
    const sv = rec.built.get(tabId);
    rec.built.delete(tabId);
    if (sv) sv.close();
    else if (p) await p.catch(() => undefined);
  }

  /** End, remove, folder remove (FR-023, FR-128): every tab's view closes, then the partition is cleared once. The name is never reused. */
  async function destroySessionView(sessionId: string): Promise<void> {
    const rec = sessions.get(sessionId);
    if (!rec) return;
    await endSession(sessionId, rec);
  }

  /** App quit (FR-023). The synchronous part of every teardown runs before this returns its promise. */
  function destroyAllViews(): Promise<void> {
    return Promise.all([...sessions.entries()].map(([id, rec]) => endSession(id, rec))).then(() => undefined);
  }

  return {
    ensureTabView,
    closeTabView,
    destroySessionView,
    destroyAllViews,
    /** Views built or being built, over every session. */
    liveViewCount: () => [...sessions.values()].reduce((n, r) => n + r.tabs.size, 0),
    /** Test hook: the partition name of a session, if it has one. */
    partitionOf: (sessionId: string): string | undefined => sessions.get(sessionId)?.partition,
  };
}

const real = makeViews({
  createView: (prefs) => new WebContentsView({ webPreferences: prefs as Electron.WebPreferences }) as unknown as { webContents: WcLike },
  sessionFromPartition: (name) => session.fromPartition(name) as unknown as SesLike,
  chromeVersion: process.versions.chrome,
  onPartition: (ses, sim) => void installSimPages(ses as unknown as Parameters<typeof installSimPages>[0], sim), // refuses (false) unless DURBAR_SIM
});
export const ensureTabView = (sessionId: string, tabId: string, events: ViewEvents = {}, sim = false): Promise<SessionView> => real.ensureTabView(sessionId, tabId, events, sim, app.isPackaged);
export const closeTabView = real.closeTabView;
export const destroySessionView = real.destroySessionView;
export const destroyAllViews = real.destroyAllViews;
export const liveViewCount = real.liveViewCount;
