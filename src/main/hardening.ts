/**
 * Window hardening (spec 045 FR-004, FR-005): pure checks, wired in main.ts.
 * - The window may only ever show the app's own page (any query or hash): no other `file://` page, no web page.
 * - Web permissions the page asks for are refused, except writing text to the clipboard (the Copy buttons, spec 005 FR-015) and
 *   notifications (spec 052 FR-059: "<name> needs you" with a short summary while the window is in the background; never file contents).
 */
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { cut, redact } from '../shared/redact';

export function navigationAllowed(url: string, indexFile: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    const flavor = platform === 'win32' ? path.win32 : path.posix;
    const norm = (p: string): string => (platform === 'win32' ? flavor.resolve(p).toLowerCase() : flavor.resolve(p));
    return norm(fileURLToPath(u, { windows: platform === 'win32' })) === norm(indexFile);
  } catch {
    return false;
  }
}

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'notifications']);

export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/**
 * Spec 051 FR-004b: a privileged IPC call (installs, sign-in) is answered only for the app's own page in the window's main frame,
 * never for another frame or a page the window was somehow moved to.
 */
export function senderAllowed(frame: { url: string; isMain: boolean } | null | undefined, indexFile: string, platform: NodeJS.Platform = process.platform): boolean {
  return !!frame && frame.isMain && navigationAllowed(frame.url, indexFile, platform);
}

/** The simulator's test-page scheme (FR-091); the name is a placeholder until the simulator task fixes it. Allowed only in the main frame and only with `sim`. */
export const SIM_VIEW_SCHEME = 'durbar-sim:';

/**
 * Spec 080 FR-024: the session browser view's navigation guard, checked on `will-navigate`, `will-redirect` and `will-frame-navigate`
 * (the frame is passed in). The app window's own rule stays `navigationAllowed`; this one is for the web page in the view.
 * - main frame: `http:`, `https:`, `about:blank` (and `SIM_VIEW_SCHEME`, FR-091, only when the caller passes `sim`, that is under DURBAR_SIM);
 * - subframes: also `about:srcdoc`, `blob:` and `data:`;
 * - everything else (`file:`, `chrome:`, `devtools:`, `view-source:`, `filesystem:`, `javascript:`, custom schemes) at every level.
 * The network classes of FR-058 apply on top, elsewhere.
 */
export function viewNavigationAllowed(url: string, isMainFrame: boolean, sim = false): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const scheme = u.protocol;
  if (scheme === 'http:' || scheme === 'https:') return true;
  // compared as given, not as URL normalises it: `about:blank#x`, `about:blank?x` and `ABOUT:BLANK` are refused (fail closed)
  if (scheme === 'about:') return url === 'about:blank' || (!isMainFrame && url === 'about:srcdoc');
  if (isMainFrame) return sim && scheme === SIM_VIEW_SCHEME;
  return scheme === 'blob:' || scheme === 'data:';
}

// ---- Spec 080 T012: the session browser view's hardening (FR-010, FR-020, FR-024..FR-028). Pure builders; src/main/browser/views.ts uses them. ----

/**
 * FR-010: the view's `webPreferences`. No preload, no Node. No `backgroundThrottling` key (Electron's default; FR-010's run-time
 * toggle is Phase 2). No `disableDialogs` (owner decision 2026-10-24: the user sees and answers the page's dialogs; `safeDialogs`
 * keeps the "prevent more dialogs" checkbox). `devTools` is off when packaged.
 */
export function viewWebPreferences(o: { partition: string; packaged: boolean }): Record<string, unknown> {
  return {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    spellcheck: false, // spellcheck downloads Hunspell dictionaries from a third party on Windows and Linux (FR-010)
    autoplayPolicy: 'user-gesture-required',
    devTools: !o.packaged,
    partition: o.partition,
  };
}

/** FR-020: an in-memory partition (never `persist:`), 128 random bits, never reused (the set remembers every name handed out). */
export const VIEW_PARTITION_RE = /^durbar-browser-[0-9a-f]{32}$/;
const partitionsUsed = new Set<string>();
export function newViewPartition(randomHex: () => string = () => crypto.randomBytes(16).toString('hex'), used: Set<string> = partitionsUsed): string {
  for (let i = 0; i < 8; i++) {
    const name = `durbar-browser-${randomHex()}`;
    if (!VIEW_PARTITION_RE.test(name) || used.has(name)) continue;
    used.add(name);
    return name;
  }
  throw new Error('could not make a fresh browser partition name');
}

/**
 * FR-028: the Chrome user agent of a view, from the default one with the `Electron/<v>` and `agent-durbar/<v>` tokens removed.
 * No Durbar token, account or path ever stays in it. A default without a `Chrome/` token (not expected) is rebuilt from the running
 * Chromium version, in Chrome's reduced form (`Chrome/<major>.0.0.0`).
 */
export function viewUserAgent(defaultUa: string, chromeVersion: string, platform: NodeJS.Platform = process.platform): string {
  const stripped = String(defaultUa)
    .replace(/\s+(?:Electron|agent-durbar|AgentDurbar|Agent-Durbar)\/\S*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/\bChrome\/\d/.test(stripped) && !/electron|durbar/i.test(stripped)) return stripped;
  const major = /^\d+/.exec(chromeVersion)?.[0] ?? '0';
  const os = platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function isWebUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

/** Same http(s) origin, both sides present; anything else (empty, opaque, other scheme) is false. */
function sameWebOrigin(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || !isWebUrl(a) || !isWebUrl(b)) return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export interface ViewHandlerContext {
  /** Under DURBAR_SIM only (FR-091). */
  sim?: boolean;
  /** `target=_blank` link: load it in the same view (FR-026). Only called for an allowed main-frame URL. */
  loadInView(url: string): void;
  /** A scripted popup was refused; the bar offers *Open in system browser* for its URL (FR-026). */
  onPopupBlocked(url: string): void;
  /** The view's current top-level URL; its origin must equal the popup's referrer origin for a tab popup to load in the view. */
  currentUrl?(): string;
  /** Who drives the view now (FR-060). Decides what `beforeunload` does. */
  driver?(): 'user' | 'agent' | 'none';
  /**
   * FR-025e, user or no driver: Durbar's own *Leave this page?* box (Stay focused), asked through the renderer's `askDialog` (T015 wires it).
   * Asynchronous: `will-prevent-unload` is synchronous, so the navigation is cancelled first. True = Leave. Without it (no UI yet) the view leaves.
   */
  askLeave?(): Promise<boolean>;
  /** The one-shot *leave approved* flag of this view. */
  leave?: LeaveApproval;
  /** A `beforeunload` cancelled something and Durbar is about to ask: the view notes the navigation main has in flight, if any. */
  onUnloadBlocked?(): void;
  /** The answer: on Leave the view repeats the navigation main started (through `navigateChecked`), if one was cancelled; a page-started one is not repeated. */
  onLeaveAnswer?(leave: boolean): void;
}

/** FR-025e: *Leave* arms it, the next `will-prevent-unload` of that view consumes it; it expires after 10 s. */
export const LEAVE_APPROVAL_MS = 10_000;
export class LeaveApproval {
  private armedAt: number | undefined;
  constructor(private readonly now: () => number = Date.now) {}
  arm(): void {
    this.armedAt = this.now();
  }
  /** True once per `arm()`, and only within `LEAVE_APPROVAL_MS`. */
  consume(): boolean {
    const t = this.armedAt;
    this.armedAt = undefined;
    return t !== undefined && this.now() - t <= LEAVE_APPROVAL_MS;
  }
}

/**
 * Navigations that main starts itself (`loadURL`, back, forward, reload, CDP `Page.navigate`) fire no `will-navigate` or
 * `will-frame-navigate` in Electron (Paco's review of PR 682), so every one goes through this check first (FR-024).
 * Returns false (and does nothing) for a refused URL.
 */
export interface NavTarget {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  reload(): void;
  navigationHistory: { getActiveIndex(): number; getEntryAtIndex(i: number): { url: string } | null | undefined; length(): number; goToIndex(i: number): void };
}
export type NavAction = { url: string } | 'back' | 'forward' | 'reload';
export async function navigateChecked(wc: NavTarget, action: NavAction, sim = false): Promise<boolean> {
  if (typeof action === 'object') {
    if (!viewNavigationAllowed(action.url, true, sim)) return false;
    await wc.loadURL(action.url);
    return true;
  }
  if (action === 'reload') {
    if (!viewNavigationAllowed(wc.getURL(), true, sim)) return false;
    wc.reload();
    return true;
  }
  const h = wc.navigationHistory;
  const i = h.getActiveIndex() + (action === 'back' ? -1 : 1);
  const e = i >= 0 && i < h.length() ? h.getEntryAtIndex(i) : undefined;
  if (!e || !viewNavigationAllowed(e.url, true, sim)) return false;
  h.goToIndex(i);
  return true;
}
interface Ev {
  preventDefault(): void;
}
/** Every handler of FR-024..FR-025e, FR-026, FR-027 in one place; `installViewHandlers` puts them on a view. Every default refuses. */
export interface ViewHandlers {
  windowOpen(d: { url: string; disposition?: string; referrer?: { url?: string } | null }): { action: 'deny' };
  /** `will-navigate`, `will-redirect` and `will-frame-navigate` (FR-024): the frame is passed in. */
  navigate(d: { url: string; isMainFrame: boolean; preventDefault(): void }): void;
  permissionRequest(wc: unknown, permission: string, callback: (granted: boolean) => void): void;
  permissionCheck(): boolean;
  devicePermission(): boolean;
  displayMedia(request: unknown, callback: (streams: null) => void): void;
  certificateError(e: Ev, url: string, error: string, cert: unknown, callback: (ok: boolean) => void): void;
  selectClientCertificate(e: Ev, url: string, list: unknown, callback: (cert?: undefined) => void): void;
  selectBluetooth(e: Ev, devices: unknown, callback: (id: string) => void): void;
  selectHid(e: Ev, details: unknown, callback: (id?: string | null) => void): void;
  selectSerial(e: Ev, ports: unknown, wc: unknown, callback: (id: string) => void): void;
  selectUsb(e: Ev, details: unknown, callback: (id?: string) => void): void;
  login(e: Ev, details: unknown, info: unknown, callback: (user?: string, pass?: string) => void): void;
  willPreventUnload(e: Ev): void;
  /** Every download is cancelled for now (US3 builds them later). */
  willDownload(e: Ev, item: unknown): void;
}
export function buildViewHandlers(ctx: ViewHandlerContext): ViewHandlers {
  return {
    windowOpen: (d) => {
      // Electron gives no "this came from a click"; a plain link has a tab disposition, a feature-ed window.open is `new-window`.
      // Only http(s) loads in the view: `about:blank` or an empty URL (`window.open('')`, the OAuth pattern) must never wipe the user's page.
      // And only when the opener is the view's own top-level origin: a cross-origin iframe (which Chromium stops from touching
      // `top.location`) must not replace the page through `window.open` (framebusting). An empty or opaque referrer fails closed.
      const web = isWebUrl(d.url);
      const tab = d.disposition === 'foreground-tab' || d.disposition === 'background-tab';
      if (web && tab && sameWebOrigin(d.referrer?.url, ctx.currentUrl?.())) ctx.loadInView(d.url);
      else if (web) ctx.onPopupBlocked(d.url); // only http(s) URLs get an *Open in system browser* offer
      return { action: 'deny' };
    },
    navigate: (d) => {
      if (!viewNavigationAllowed(d.url, d.isMainFrame, !!ctx.sim)) d.preventDefault();
    },
    permissionRequest: (_wc, _permission, callback) => callback(false), // fullscreen included (FR-025)
    permissionCheck: () => false,
    devicePermission: () => false,
    displayMedia: (_r, callback) => callback(null),
    certificateError: (_e, _u, _err, _c, callback) => callback(false),
    selectClientCertificate: (e, _u, _l, callback) => {
      e.preventDefault();
      callback();
    },
    selectBluetooth: (e, _d, callback) => {
      e.preventDefault();
      callback('');
    },
    selectHid: (e, _d, callback) => {
      e.preventDefault();
      callback();
    },
    selectSerial: (e, _p, _wc, callback) => {
      e.preventDefault();
      callback('');
    },
    selectUsb: (e, _d, callback) => {
      e.preventDefault();
      callback();
    },
    willDownload: (e) => e.preventDefault(),
    login: (e, _d, _i, callback) => {
      e.preventDefault();
      callback(); // no credentials: the request is cancelled (FR-025c)
    },
    willPreventUnload: (e) => {
      // FR-025e. preventDefault() = leave. The agent's own calls are never blocked.
      const driver = ctx.driver?.() ?? 'agent';
      if (driver === 'agent' || !ctx.askLeave || ctx.leave?.consume()) return e.preventDefault();
      // user or none: do not preventDefault (the navigation is cancelled), ask, and on Leave arm the one-shot flag and repeat the navigation
      ctx.onUnloadBlocked?.();
      void ctx.askLeave().then(
        (leave) => {
          if (leave) ctx.leave?.arm();
          ctx.onLeaveAnswer?.(leave);
        },
        () => ctx.onLeaveAnswer?.(false),
      );
    },
  };
}

// loose on purpose: Electron's `on` is overloaded per event name
type Listen = { on(event: string, listener: (...a: never[]) => void): unknown };
export interface ViewWebContentsLike extends Listen {
  setWindowOpenHandler(h: (d: { url: string; disposition?: string }) => { action: 'deny' }): void;
}
export interface ViewSessionLike {
  on(event: string, listener: (...a: never[]) => void): unknown;
  removeListener(event: string, listener: (...a: never[]) => void): unknown;
  setPermissionRequestHandler(h: ViewHandlers['permissionRequest']): void;
  setPermissionCheckHandler(h: ViewHandlers['permissionCheck']): void;
  setDevicePermissionHandler(h: ViewHandlers['devicePermission']): void;
  setDisplayMediaRequestHandler(h: ViewHandlers['displayMedia']): void;
}
/** Names of the `webContents` and `session` events installed (a test checks each one). */
export const VIEW_WEBCONTENTS_EVENTS = ['will-navigate', 'will-redirect', 'will-frame-navigate', 'certificate-error', 'select-client-certificate', 'select-bluetooth-device', 'login', 'will-prevent-unload'] as const;
export const VIEW_SESSION_EVENTS = ['select-hid-device', 'select-serial-port', 'select-usb-device', 'will-download'] as const;
/** Returns a disposer for the listeners put on the session (Electron keeps the session until quit; the deny-all handlers stay, never `null`). */
export function installViewHandlers(wc: ViewWebContentsLike, ses: ViewSessionLike, h: ViewHandlers): () => void {
  const on = (t: Listen, ev: string, fn: (...a: never[]) => void): void => void t.on(ev, fn);
  wc.setWindowOpenHandler(h.windowOpen);
  // Electron 44: the three navigation events take one `details` object (url, isMainFrame, preventDefault)
  for (const ev of ['will-navigate', 'will-redirect', 'will-frame-navigate']) on(wc, ev, h.navigate as never);
  on(wc, 'certificate-error', h.certificateError as never);
  on(wc, 'select-client-certificate', h.selectClientCertificate as never);
  on(wc, 'select-bluetooth-device', h.selectBluetooth as never);
  on(wc, 'login', h.login as never);
  on(wc, 'will-prevent-unload', h.willPreventUnload as never);
  const sesListeners: [string, (...a: never[]) => void][] = [
    ['select-hid-device', h.selectHid as never],
    ['select-serial-port', h.selectSerial as never],
    ['select-usb-device', h.selectUsb as never],
    ['will-download', h.willDownload as never],
  ];
  for (const [ev, fn] of sesListeners) on(ses, ev, fn);
  ses.setPermissionRequestHandler(h.permissionRequest);
  ses.setPermissionCheckHandler(h.permissionCheck);
  ses.setDevicePermissionHandler(h.devicePermission);
  ses.setDisplayMediaRequestHandler(h.displayMedia);
  return () => {
    for (const [ev, fn] of sesListeners) ses.removeListener(ev, fn);
  };
}

/**
 * The dialog part of the view (FR-025d, rewritten by the owner decision of 2026-10-24; a spec delta follows): dialogs are NOT disabled, so the
 * user sees a native dialog and answers it. Only while the driver is the agent does main answer through `Page.handleJavaScriptDialog`
 * (`accept: false`) so no tool call hangs, and then the bar shows a note. `beforeunload` is never answered here (`will-prevent-unload`
 * already lets the navigation go; a CDP `accept:false` would cancel it, T007 AC2 `sim:`).
 * This is the one place to adjust the dialog behaviour.
 */
/** A page dialog's text for the window (FR-025d toast, FR-064): masked, control characters out, cut to `n` characters. It is page text, never an instruction. */
export function dialogText(message: unknown, n: number): string {
  // eslint-disable-next-line no-control-regex
  return cut(redact(typeof message === 'string' ? message : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(), n);
}

export function viewDialogPolicy(driver: 'user' | 'agent' | 'none', d: { type: string; message: string }): { answer: { accept: boolean } | null; note: string | null } {
  if (d.type === 'beforeunload' || driver !== 'agent') return { answer: null, note: null };
  const text = cut(redact(String(d.message ?? '')).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(), 120);
  return { answer: { accept: false }, note: `The page showed a dialog: "${text}"` };
}
