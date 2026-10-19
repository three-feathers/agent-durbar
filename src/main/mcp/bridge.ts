/**
 * Durbar MCP bridge entry, spec 041 T018 [FR-005, FR-034, FR-058, Q2, Q11]. The Electron/Node glue around
 * `bridgecore.ts`. No `electron` import here: the app object is passed in, so the order of the start-up steps is
 * unit-tested with a fake. `entry.ts` calls `runMcpBridge` before `main.ts` is even loaded, so no ipc handler, store
 * or window exists in this process.
 *
 * Order matters (plan: Bridge entry): FIRST the real key file path is worked out from the real `userData` (or
 * `DURBAR_USER_DATA`), THEN `userData` is redirected to a folder only this bridge uses, so Chromium never shares
 * the app's profile; the GPU is off, there is no window and no Dock icon. Nothing here starts Durbar.
 *
 * stdout carries only JSON-RPC (console output is sent to stderr); the key is never written anywhere.
 */
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { MCP_MARKER_ENV } from '../../shared/mcpserver';
import { devEnv } from '../devhooks';
import type { DevEnv } from '../devhooks';
import { nodeMcpFs, readKeyFile } from './auth';
import { BridgeCore } from './bridgecore';
import type { BridgeDeps, Link } from './bridgecore';
import { mcpPaths } from './paths';

/** The part of Electron's `app` the bridge uses. */
export interface BridgeApp {
  isPackaged: boolean;
  getPath(name: 'userData'): string;
  setPath(name: 'userData', value: string): void;
  getVersion(): string;
  disableHardwareAcceleration(): void;
  whenReady(): Promise<unknown>;
  exit(code?: number): void;
  dock?: { hide(): void };
}

export interface BridgePlatform {
  platform: string;
  uid: number | null;
  tmpdir: string;
}

/** Where the key file is and how to find the socket, from the REAL user data folder. */
export interface BridgeLocation {
  realUserData: string;
  keyFile: string | null;
  readKey: BridgeDeps['readKey'];
  socketFor: BridgeDeps['socketFor'];
}

/** The folder whose key file the bridge reads: the dev hook wins over Electron's `userData` (as in `main.ts`). */
export function realUserDataOf(app: Pick<BridgeApp, 'getPath'>, dev: DevEnv): string {
  return dev.DURBAR_USER_DATA ? dev.DURBAR_USER_DATA : app.getPath('userData');
}

export function locate(realUserData: string, env: NodeJS.ProcessEnv, dev: DevEnv, p: BridgePlatform): BridgeLocation {
  // same inputs as the server host in main.ts: a dev hook keeps everything in userData
  const xdgRuntimeDir = dev.DURBAR_USER_DATA ? undefined : env.XDG_RUNTIME_DIR;
  const at = (pipeId?: string) => mcpPaths({ platform: p.platform, userData: realUserData, xdgRuntimeDir, uid: p.uid, tmpdir: p.tmpdir, pipeId });
  const first = at();
  return {
    realUserData,
    keyFile: first.keyFile,
    readKey: () => {
      if (first.mcpDir === null || first.keyFile === null) return { ok: false, reason: 'missing', message: 'No connection key file.' };
      return readKeyFile({ fs: nodeMcpFs(), mcpDir: first.mcpDir, keyFile: first.keyFile, uid: p.uid, platform: p.platform });
    },
    socketFor: (pipeId) => at(pipeId).socket,
  };
}

/** A folder only this bridge process uses. */
function makeBridgeDir(tmpdir: string): string {
  return fs.mkdtempSync(path.join(tmpdir, 'agent-durbar-bridge-'));
}

/**
 * The start-up steps, in order: locate the key file, redirect `userData`, GPU off, Dock hidden once ready.
 * Returns the location and the folder to remove at exit.
 */
export function prepareBridge(app: BridgeApp, env: NodeJS.ProcessEnv, dev: DevEnv, p: BridgePlatform, makeDir: (tmpdir: string) => string = makeBridgeDir): { loc: BridgeLocation; bridgeDir: string } {
  const loc = locate(realUserDataOf(app, dev), env, dev, p); // 1. before anything moves
  const bridgeDir = makeDir(p.tmpdir);
  app.setPath('userData', bridgeDir); // 2. Chromium's profile is the bridge's own
  app.disableHardwareAcceleration(); // 3. no GPU process
  void app.whenReady().then(() => { try { app.dock?.hide(); } catch { /* no Dock */ } }, () => undefined); // 4. no Dock icon (macOS)
  return { loc, bridgeDir };
}

/** A connected `net.Socket` as a `Link`. It stays paused until the core sets `onData`, and a close that came early is reported when `onClose` is set. */
export function socketLink(s: net.Socket): Link {
  let closed = false;
  let closeCb: (() => void) | null = null;
  s.on('error', () => undefined); // 'close' follows
  s.on('close', () => { closed = true; closeCb?.(); });
  return {
    write: (data) => { if (!s.destroyed) s.write(data); },
    end: () => { s.destroy(); },
    onData: (cb) => { s.on('data', cb); },
    onClose: (cb) => { closeCb = cb; if (closed) cb(); },
  };
}

export function netConnect(socket: string): Promise<Link> {
  return new Promise((resolve, reject) => {
    const s = net.connect(socket);
    s.once('connect', () => resolve(socketLink(s)));
    s.once('error', reject);
  });
}

/** Streams the bridge reads and writes (injected for tests). */
export interface BridgeIo {
  stdin: Pick<NodeJS.ReadableStream, 'on'>;
  stdout: { write(data: string, cb?: () => void): unknown; on(ev: 'error', cb: () => void): unknown };
}

/** Wires the core to the streams. Returns the core (tests drive it; the real entry ignores it). */
export function startBridge(deps: Omit<BridgeDeps, 'stdout' | 'exit'>, io: BridgeIo, exit: (code: number) => void): BridgeCore {
  let done = false;
  const quit = (code: number, flush = true) => {
    if (done) return;
    done = true;
    // let the last reply leave before the process goes (not when stdout is already broken)
    if (!flush) return exit(code);
    try { io.stdout.write('', () => exit(code)); } catch { exit(code); }
  };
  const core = new BridgeCore({ ...deps, stdout: (data) => { io.stdout.write(data); }, exit: quit });
  io.stdin.on('data', (c: Buffer | string) => core.onStdin(c));
  io.stdin.on('end', () => core.onStdinEnd());
  io.stdin.on('close', () => core.onStdinEnd());
  io.stdin.on('error', () => core.onStdinEnd());
  io.stdout.on('error', () => quit(0, false)); // the client went away (EPIPE)
  return core;
}

/** Called by `entry.ts` when the bridge flag is present. Never returns control to the app code. */
export function runMcpBridge(app: BridgeApp, env: NodeJS.ProcessEnv): void {
  // stdout is the protocol: nothing else may be written there, not even by a stray console.log
  console.log = (...a: unknown[]) => console.error(...a);
  console.info = console.log;
  console.debug = console.log;
  const dev = devEnv(env, app.isPackaged);
  const plat: BridgePlatform = { platform: process.platform, uid: typeof process.getuid === 'function' ? process.getuid() : null, tmpdir: os.tmpdir() };
  const { loc, bridgeDir } = prepareBridge(app, env, dev, plat);
  const timers = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
  startBridge(
    {
      readKey: loc.readKey,
      socketFor: loc.socketFor,
      connect: netConnect,
      marker: env[MCP_MARKER_ENV] !== undefined && env[MCP_MARKER_ENV] !== '',
      version: app.getVersion(),
      timers,
    },
    { stdin: process.stdin, stdout: process.stdout },
    (code) => {
      try { fs.rmSync(bridgeDir, { recursive: true, force: true }); } catch { /* best effort */ }
      app.exit(code);
    },
  );
}
