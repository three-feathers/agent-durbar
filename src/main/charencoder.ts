/**
 * Spec 096 FR-022: pictures an image tool wrote are decoded here, never in main: in a hidden, sandboxed window with no Node, a session that cancels every
 * web request and the CSP `default-src 'none'; img-src data: blob:`, one window per job, destroyed after it. Main passes the bytes over a MessagePort and
 * gets back only what `parseEncoderReply` lets through (FR-023). A decode error, a timeout of 20 s, a crash or a cancel refuses the picture.
 *
 * The page: under a session that cancels every request, neither a `file:` nor a `data:` page can load (`ERR_BLOCKED_BY_CLIENT`), and the CSP blocks any
 * `<script src>`. `about:blank` makes no request, so the wording holds with no exception: the fixed bundled `charencoder.html` is written into it and
 * the fixed bundled `charencoder.js` runs through `executeJavaScript`, before any untrusted byte exists in the window (spec `## Changes`, 2026-10-31).
 */
import { BrowserWindow, MessageChannelMain, session } from 'electron';
import type { BrowserWindowConstructorOptions, Session, WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ENCODER_FAILED, parseEncoderReply } from '../shared/charrules';
import type { EncoderResult } from '../shared/charrules';

export const ENCODER_TIMEOUT_MS = 20_000;
/** In memory (no `persist:`): nothing of a job can stay on the disk. */
export const ENCODER_PARTITION = 'durbar-charencoder';
const PORT_CHANNEL = 'charencoder:port';

let ready: Session | undefined;
/** The encoder's session: every web request cancelled, every permission refused. */
export function encoderSession(): Session {
  if (ready) return ready;
  const ses = session.fromPartition(ENCODER_PARTITION);
  ses.webRequest.onBeforeRequest((_details, cb) => cb({ cancel: true }));
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ready = ses;
  return ses;
}

/** The window's options (FR-022); `test:charencoder` reads them. */
export function encoderWindowOptions(ses: Session): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: 64,
    height: 64,
    paintWhenInitiallyHidden: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      devTools: false,
      backgroundThrottling: false,
      session: ses,
      preload: path.join(__dirname, '..', 'preload', 'charencoder-preload.js'),
    },
  };
}

const pageIn = new WeakSet<WebContents>();
/** The window with its guards, nothing loaded yet. `check-charencoder` attacks this same window. */
export function createEncoderWindow(): BrowserWindow {
  const win = new BrowserWindow(encoderWindowOptions(encoderSession()));
  const wc = win.webContents;
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); // WebRTC is outside the session's requests and this CSP: no UDP around them
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  // `about:blank?x` makes no request and fires no `will-navigate`, yet would leave a page with no CSP: once the page is in, any other document ends the window, and the job with it
  wc.on('did-start-navigation', (d) => { if (pageIn.has(wc) && d.isMainFrame && !d.isSameDocument && !win.isDestroyed()) win.destroy(); });
  return win;
}

/** Writes the fixed page into `about:blank`, which makes no request, and runs the fixed script (see the top of this file). */
export async function loadEncoderPage(wc: WebContents): Promise<void> {
  await wc.loadURL('about:blank');
  pageIn.add(wc);
  const dir = path.join(__dirname, '..', 'renderer');
  // both are fixed files of the app, never picture bytes or user text; JSON.stringify only quotes the page as a script string
  await wc.executeJavaScript(`document.open();document.write(${JSON.stringify(fs.readFileSync(path.join(dir, 'charencoder.html'), 'utf8'))});document.close();0`);
  await wc.executeJavaScript(`${fs.readFileSync(path.join(dir, 'charencoder.js'), 'utf8')}\n;0`);
}

export interface EncodeOptions {
  /** How long a job may take (default 20 s, FR-022); a test shortens it. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Decode and re-encode one sheet whose header gave `header`. Never throws; the result is checked by `parseEncoderReply`. The window is always destroyed. */
export function encodeSheet(bytes: Uint8Array, header: { width: number; height: number }, opts: EncodeOptions = {}): Promise<EncoderResult> {
  return new Promise<EncoderResult>((resolve) => {
    if (opts.signal?.aborted) return resolve({ ok: false, error: ENCODER_FAILED });
    let win: BrowserWindow | undefined;
    let port: Electron.MessagePortMain | undefined;
    let settled = false;
    const finish = (r: EncoderResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      try { port?.close(); } catch { /* already closed */ }
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
      resolve(r);
    };
    const refuse = (): void => finish({ ok: false, error: ENCODER_FAILED });
    const onAbort = (): void => refuse();
    const timer = setTimeout(refuse, opts.timeoutMs ?? ENCODER_TIMEOUT_MS);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    void (async () => {
      win = createEncoderWindow();
      const wc = win.webContents;
      wc.on('render-process-gone', refuse);
      win.on('closed', refuse);
      await loadEncoderPage(wc);
      if (settled) return;
      const { port1, port2 } = new MessageChannelMain();
      port = port1;
      port1.on('message', (m) => finish(parseEncoderReply(m.data)));
      port1.start();
      wc.postMessage(PORT_CHANNEL, null, [port2]);
      // a copy: the file's bytes stay main's, and only what the window needs goes in
      port1.postMessage({ bytes: Uint8Array.from(bytes), width: header.width, height: header.height });
    })().catch(refuse);
  });
}
