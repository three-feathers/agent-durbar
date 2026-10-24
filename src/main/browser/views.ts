/**
 * Spec 080 T012: the session browser's views. One lazy `WebContentsView` per session, in its own in-memory partition (FR-020), hardened
 * (FR-010, FR-024..FR-028), muted (FR-012), with the debugger attached at creation and only the `Page` domain on (FR-042), torn down
 * when the session ends (FR-023). No IPC and no renderer yet (T014/T015): nothing here is user-visible, and the view is not added to a window.
 * `makeViews(deps)` takes Electron's parts as arguments so `scripts/test-browserviews.ts` can run it against a fake.
 */
import { app, session, WebContentsView } from 'electron';
import { buildViewHandlers, installViewHandlers, LeaveApproval, navigateChecked, newViewPartition, viewDialogPolicy, viewUserAgent, viewWebPreferences } from '../hardening';
import type { NavAction, NavTarget, ViewHandlers, ViewSessionLike, ViewWebContentsLike } from '../hardening';

export type ViewDriver = 'user' | 'agent' | 'none';

export interface ViewEvents {
  /** The bar note for a page dialog the agent's driving closed (FR-025d). */
  onDialogNote?(sessionId: string, note: string): void;
  /** A scripted popup with an http(s) URL (FR-026): the bar offers *Open in system browser*. */
  onPopupBlocked?(sessionId: string, url: string): void;
  /** FR-025e: Durbar's *Leave this page?* box for a user-driven view; true = Leave. T015 wires `askDialog`. Absent: the view leaves. */
  askLeave?(sessionId: string): Promise<boolean>;
}

export interface SessionView {
  readonly sessionId: string;
  readonly partition: string;
  readonly view: WebContentsView;
  driver: ViewDriver;
  readonly sim: boolean;
  /** The only way to move the view: loadURL, back, forward and reload (FR-024). False = refused. */
  navigate(action: NavAction): Promise<boolean>;
  /** Cancel downloads, detach, close, clear storage and cache (FR-023). Safe to call twice. */
  destroy(): Promise<void>;
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
}

export function makeViews(deps: ViewDeps) {
  const views = new Map<string, Promise<SessionView>>();
  const built = new Map<string, SessionView>(); // finished ones, so quit can start their teardown synchronously

  /** The dialog part of a view: the one place that reacts to `Page.javascriptDialogOpening` (see `viewDialogPolicy`). */
  function wireViewDialogs(sv: SessionView, wc: WcLike, events: ViewEvents): void {
    wc.debugger.on('message', (_e, method, params) => {
      if (method !== 'Page.javascriptDialogOpening') return;
      const r = viewDialogPolicy(sv.driver, { type: String(params?.type ?? ''), message: String(params?.message ?? '') });
      if (r.answer) wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: r.answer.accept }).catch(() => undefined); // "no dialog is showing" is harmless
      if (r.note) events.onDialogNote?.(sv.sessionId, r.note);
    });
  }

  async function build(sessionId: string, events: ViewEvents, sim: boolean, packaged: boolean): Promise<SessionView> {
    const partition = newViewPartition();
    const view = deps.createView(viewWebPreferences({ partition, packaged }));
    const wc = view.webContents;
    const ses = deps.sessionFromPartition(partition);
    const leave = new LeaveApproval();
    // FR-025e: only a navigation main started, and only while it is in flight, can be repeated after *Leave*. A page-started leave is not
    // repeated (its target is not known): the page stays and the user clicks again.
    let inFlight: { action: NavAction; settled: Promise<unknown> } | undefined;
    let blocked: { action: NavAction; settled: Promise<unknown> } | undefined; // the in-flight one when a beforeunload cancelled it
    const downloads = new Set<{ cancel(): void }>();
    const sv: SessionView = {
      sessionId,
      partition,
      view: view as unknown as WebContentsView,
      driver: 'user',
      sim,
      navigate: async (action) => {
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
      destroy: () => {
        if (destroyed) return destroyed;
        // the synchronous part first, so it also runs when the app is quitting
        for (const d of downloads) {
          try {
            d.cancel();
          } catch {
            /* done already */
          }
        }
        downloads.clear();
        try {
          if (wc.debugger.isAttached()) wc.debugger.detach();
        } catch {
          /* already gone */
        }
        try {
          if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
        } catch {
          /* already gone */
        }
        destroyed = (async () => {
          await ses.clearStorageData().catch(() => undefined);
          await ses.clearCache().catch(() => undefined);
        })();
        return destroyed;
      },
    };
    let destroyed: Promise<void> | undefined;
    const handlers: ViewHandlers = buildViewHandlers({
      sim,
      loadInView: (url) => void sv.navigate({ url }).catch(() => undefined),
      onPopupBlocked: (url) => events.onPopupBlocked?.(sessionId, url),
      driver: () => sv.driver,
      askLeave: events.askLeave ? () => events.askLeave!(sessionId) : undefined,
      leave,
      onUnloadBlocked: () => {
        blocked = inFlight; // undefined for a page-started unload
      },
      onLeaveAnswer: (leave) => {
        const b = blocked;
        blocked = undefined;
        if (!leave || !b) return;
        // wait for the cancelled navigation to settle, then repeat it on the next tick. `[KNOWN GAP]` (T007 `sim:`): an instant answer is still not repeated in real Electron (ERR_FAILED); askDialog is never instant
        void b.settled.then(() => setImmediate(() => void navigateChecked(wc, b.action, sim).catch(() => undefined)));
      },
    });
    installViewHandlers(wc, ses, handlers);
    // US3 builds downloads; until then every one is cancelled by the handler above, and any that is running is cancelled on teardown
    (ses as unknown as { on(e: string, f: (...a: never[]) => void): void }).on('will-download', ((_e: unknown, item: { cancel(): void; once?(e: string, f: () => void): void }) => {
      downloads.add(item);
      item.once?.('done', () => downloads.delete(item));
    }) as never);
    wc.setUserAgent(viewUserAgent(wc.getUserAgent(), deps.chromeVersion)); // per view; app.userAgentFallback stays as it is (FR-028)
    wc.setAudioMuted(true); // FR-012
    try {
      // a command sent before the first navigation never answers (docs/agent-notes.md), so about:blank first (FR-042)
      await sv.navigate({ url: 'about:blank' });
      wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.enable'); // only Page; the other domains are Phase 2
      wireViewDialogs(sv, wc, events);
    } catch (e) {
      await sv.destroy(); // a half-built view must not stay open with its partition
      throw e;
    }
    return sv;
  }

  /** The session's view, created on first use (lazy) and shared by concurrent callers. */
  function ensureSessionView(sessionId: string, events: ViewEvents = {}, sim = false, packaged = false): Promise<SessionView> {
    let p = views.get(sessionId);
    if (!p) {
      const mine: Promise<SessionView> = build(sessionId, events, sim, packaged).then(async (sv) => {
        if (views.get(sessionId) !== mine) {
          // the session ended (or was ended and started again) while this one was being built: it is stale
          await sv.destroy();
          throw new Error('the session ended while its browser was being created');
        }
        built.set(sessionId, sv);
        return sv;
      });
      p = mine;
      views.set(sessionId, mine);
      mine.catch(() => {
        if (views.get(sessionId) === mine) views.delete(sessionId);
      });
    }
    return p;
  }

  /** End, remove, folder remove (FR-023). The name is never reused, so the partition's session object stays cleared until quit. */
  async function destroySessionView(sessionId: string): Promise<void> {
    const p = views.get(sessionId);
    if (!p) return;
    views.delete(sessionId); // a build still running sees this and destroys its own view
    const sv = built.get(sessionId);
    built.delete(sessionId);
    if (sv) await sv.destroy();
    else await p.catch(() => undefined);
  }

  /** App quit (FR-023). The synchronous part of every `destroy()` runs before this returns its promise. */
  function destroyAllViews(): Promise<void> {
    const done = [...built.values()].map((sv) => sv.destroy());
    const ids = [...views.keys()];
    return Promise.all([...done, ...ids.map((id) => destroySessionView(id))]).then(() => undefined);
  }

  return { ensureSessionView, destroySessionView, destroyAllViews, liveViewCount: () => views.size };
}

const real = makeViews({
  createView: (prefs) => new WebContentsView({ webPreferences: prefs as Electron.WebPreferences }) as unknown as { webContents: WcLike },
  sessionFromPartition: (name) => session.fromPartition(name) as unknown as SesLike,
  chromeVersion: process.versions.chrome,
});
export const ensureSessionView = (sessionId: string, events: ViewEvents = {}, sim = false): Promise<SessionView> => real.ensureSessionView(sessionId, events, sim, app.isPackaged);
export const destroySessionView = real.destroySessionView;
export const destroyAllViews = real.destroyAllViews;
export const liveViewCount = real.liveViewCount;
