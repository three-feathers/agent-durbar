/**
 * Durbar MCP server: the per-install key file and the mutual HMAC handshake (spec 041 FR-003, FR-033,
 * FR-058, FR-061). Node `crypto` only. No Electron, no sockets: the file system, randomness and timers are
 * injected, and the handshake machines only call the `send` they are given, so T017 wires them to the socket.
 *
 * Secrecy rules: the key is never put in a message, an error or a log line. Every error text here is a fixed
 * string (plus at most an fs error code).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { MCP_LIMITS } from '../../shared/mcpserver';

// ---------------------------------------------------------------------------------------------
// Key file
// ---------------------------------------------------------------------------------------------

export const KEY_BYTES = 32; // 256 bits
export const NONCE_BYTES = 32;
const PIPE_ID_RE = /^[A-Za-z0-9]{8,128}$/;
const HEX_KEY_RE = /^[0-9a-f]{64}$/;
const KEY_FILE_VERSION = 1;
const MAX_KEY_FILE_CHARS = 4096;

/** The part of `fs.Stats` (from `lstat`, which does not follow links) the checks need. */
export interface AuthStat {
  uid: number;
  mode: number;
  isSymbolicLink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
}

/** Injected file system (synchronous; the key file is tiny). `lstat` and `read` throw errors with a `code` like Node's. */
export interface McpFs {
  mkdirp(dir: string, mode: number): void;
  chmod(p: string, mode: number): void;
  /** Exclusive create (flag `wx`) with the given mode. */
  writeNew(file: string, data: string, mode: number): void;
  rename(from: string, to: string): void;
  read(file: string): string;
  lstat(p: string): AuthStat;
  unlink(p: string): void;
}

export interface KeyFileDeps {
  fs: McpFs;
  /** `McpPaths.mcpDir` and `McpPaths.keyFile` (both non-null: the caller does nothing when they are null). */
  mcpDir: string;
  keyFile: string;
  /** `process.getuid()`; `null` on Windows. */
  uid: number | null;
  /** 'win32' skips the POSIX owner and mode checks (see `readKeyFile`). */
  platform: string;
  random?: (n: number) => Buffer;
}

export interface KeyMaterial {
  /** 256-bit key. */
  key: Buffer;
  /** Per-install id for the Windows pipe name (FR-006). */
  pipeId: string;
}

export type KeyReadResult =
  | { ok: true; material: KeyMaterial }
  /** `missing`: no key file (the server is off). `unsafe`: wrong owner or mode, or a link. `invalid`: unreadable or malformed content. */
  | { ok: false; reason: 'missing' | 'unsafe' | 'invalid'; message: string };

function errCode(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : 'UNKNOWN';
}

function newMaterial(random: (n: number) => Buffer): KeyMaterial {
  return { key: random(KEY_BYTES), pipeId: random(16).toString('hex') };
}

function serialize(m: KeyMaterial): string {
  return JSON.stringify({ version: KEY_FILE_VERSION, key: m.key.toString('hex'), pipeId: m.pipeId }) + '\n';
}

/** Writes the key file atomically (temp file in the same folder, then rename): a failure leaves the old file, or none, never a partial one. */
function writeAtomic(d: KeyFileDeps, m: KeyMaterial): void {
  const random = d.random ?? randomBytes;
  const posix = d.platform !== 'win32';
  try {
    d.fs.mkdirp(d.mcpDir, 0o700);
    if (posix) d.fs.chmod(d.mcpDir, 0o700); // an existing folder (or a restrictive umask) must end up 0700
  } catch (e) {
    throw new Error(`Could not create the connection folder (${errCode(e)}).`);
  }
  const tmp = `${d.keyFile}.${random(8).toString('hex')}.tmp`;
  try {
    d.fs.writeNew(tmp, serialize(m), 0o600);
    d.fs.rename(tmp, d.keyFile);
  } catch (e) {
    try { d.fs.unlink(tmp); } catch { /* the temp file may not exist */ }
    throw new Error(`Could not write the connection key file (${errCode(e)}).`);
  }
}

/** Creates a fresh key and pipe id and writes them (mode 0600 file, 0700 folder). Replaces a file that is already there. */
export function createKeyFile(d: KeyFileDeps): KeyMaterial {
  const m = newMaterial(d.random ?? randomBytes);
  writeAtomic(d, m);
  return m;
}

/** FR-003 *Reset connection key*: a new key and pipe id replace the old ones, so bridges holding the old key fail the handshake. */
export function rotateKeyFile(d: KeyFileDeps): KeyMaterial {
  return createKeyFile(d);
}

/** Deletes the key file (server turned off). Missing is fine. */
export function deleteKeyFile(d: KeyFileDeps): void {
  try {
    d.fs.unlink(d.keyFile);
  } catch (e) {
    if (errCode(e) !== 'ENOENT') throw new Error(`Could not delete the connection key file (${errCode(e)}).`);
  }
}

/**
 * Reads the key file, refusing anything that is not private to this user.
 * macOS and Linux: the folder and the file must not be symbolic links (`lstat`), must be a folder / regular file,
 * be owned by the current uid, and the file must have no group or other bits (so 0600; 0400 is accepted) and the
 * folder must be 0700.
 * Windows: Node reports no usable owner or mode bits, so only "not a link, is a regular file / folder" is checked;
 * privacy there rests on the ACL that Durbar's user-data folder inherits (user only). [KNOWN GAP] ACLs are not read.
 */
export function readKeyFile(d: KeyFileDeps): KeyReadResult {
  const posix = d.platform !== 'win32';
  const unsafe = (message: string): KeyReadResult => ({ ok: false, reason: 'unsafe', message });
  const owner = (st: AuthStat) => !posix || d.uid === null || st.uid === d.uid;

  let dirSt: AuthStat;
  try { dirSt = d.fs.lstat(d.mcpDir); } catch (e) {
    if (errCode(e) === 'ENOENT') return { ok: false, reason: 'missing', message: 'There is no connection key file.' };
    return { ok: false, reason: 'invalid', message: `The connection folder cannot be read (${errCode(e)}).` };
  }
  if (dirSt.isSymbolicLink()) return unsafe('The connection folder is a symbolic link, so it is not used.');
  if (!dirSt.isDirectory()) return unsafe('The connection folder is not a folder, so it is not used.');
  if (!owner(dirSt)) return unsafe('The connection folder belongs to another user, so it is not used.');
  if (posix && (dirSt.mode & 0o077) !== 0) return unsafe('The connection folder is open to other users (it must be mode 0700), so it is not used.');

  let st: AuthStat;
  try { st = d.fs.lstat(d.keyFile); } catch (e) {
    if (errCode(e) === 'ENOENT') return { ok: false, reason: 'missing', message: 'There is no connection key file.' };
    return { ok: false, reason: 'invalid', message: `The connection key file cannot be read (${errCode(e)}).` };
  }
  if (st.isSymbolicLink()) return unsafe('The connection key file is a symbolic link, so it is not used.');
  if (!st.isFile()) return unsafe('The connection key file is not a regular file, so it is not used.');
  if (!owner(st)) return unsafe('The connection key file belongs to another user, so it is not used.');
  if (posix && (st.mode & 0o077) !== 0) return unsafe('The connection key file is open to other users (it must be mode 0600), so it is not used.');

  let text: string;
  try { text = d.fs.read(d.keyFile); } catch (e) {
    return { ok: false, reason: 'invalid', message: `The connection key file cannot be read (${errCode(e)}).` };
  }
  const bad: KeyReadResult = { ok: false, reason: 'invalid', message: 'The connection key file is damaged.' };
  if (text.length > MAX_KEY_FILE_CHARS) return bad;
  let o: unknown;
  try { o = JSON.parse(text); } catch { return bad; }
  if (typeof o !== 'object' || o === null) return bad;
  const r = o as Record<string, unknown>;
  if (r.version !== KEY_FILE_VERSION || typeof r.key !== 'string' || !HEX_KEY_RE.test(r.key)) return bad;
  if (typeof r.pipeId !== 'string' || !PIPE_ID_RE.test(r.pipeId)) return bad;
  return { ok: true, material: { key: Buffer.from(r.key, 'hex'), pipeId: r.pipeId } };
}

/** The real file system, for the main process and the bridge. */
export function nodeMcpFs(): McpFs {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  return {
    mkdirp: (dir, mode) => { fs.mkdirSync(dir, { recursive: true, mode }); },
    chmod: (p, mode) => fs.chmodSync(p, mode),
    writeNew: (file, data, mode) => fs.writeFileSync(file, data, { flag: 'wx', mode }),
    rename: (a, b) => fs.renameSync(a, b),
    read: (file) => fs.readFileSync(file, 'utf8'),
    lstat: (p) => fs.lstatSync(p),
    unlink: (p) => fs.unlinkSync(p),
  };
}

// ---------------------------------------------------------------------------------------------
// Handshake (FR-058, FR-061)
//
//   server -> bridge  {"hello":"agent-durbar-mcp/1","nonceS":<64 hex>}
//   bridge -> server  {"nonceB":<64 hex>,"mac":HMAC(key,"b"|nonceS|nonceB),"marker":bool?,"parent":str?}
//   server -> bridge  {"ok":true,"mac":HMAC(key,"s"|nonceB|nonceS)}      (only after the bridge's MAC checked out)
//
// Nonces are 32 random bytes (hex on the wire). MACs are HMAC-SHA256 over a one-byte role label and the raw
// nonces; the labels differ per direction, so a MAC cannot be reflected back at the side that made it or replayed
// from the other direction. The key never crosses the wire. A failed handshake sends nothing back (the server has
// sent only its nonce before authenticating).
// ---------------------------------------------------------------------------------------------

export const HELLO = 'agent-durbar-mcp/1';
const MAX_HANDSHAKE_MESSAGE_CHARS = 1024;
const HEX64_RE = /^[0-9a-f]{64}$/;

export type HandshakeErrorCode = 'timeout' | 'malformed' | 'bad-version' | 'bad-mac' | 'bad-state';

const ERROR_TEXT: Record<HandshakeErrorCode, string> = {
  timeout: 'The handshake did not finish in time.',
  malformed: 'The handshake message was not valid.',
  'bad-version': 'The peer speaks another handshake version.',
  'bad-mac': 'The handshake proof was wrong.',
  'bad-state': 'A handshake message arrived at the wrong time.',
};

export interface HandshakeError { code: HandshakeErrorCode; message: string }
/** What the bridge told the server about itself (plan: marker and parent name), validated. */
export interface PeerInfo { marker: boolean; parent?: string }
export type HandshakeResult = { ok: true; peer: PeerInfo } | { ok: false; error: HandshakeError };

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HandshakeDeps {
  /** 32-byte key from the key file. */
  key: Buffer;
  /** Writes one handshake message (a JSON string, no newline; T013 frames it). */
  send(message: string): void;
  onDone(result: HandshakeResult): void;
  timers: Timers;
  random?: (n: number) => Buffer;
  /** Defaults to `MCP_LIMITS.handshakeTimeoutMs` (2 s). */
  timeoutMs?: number;
}

export interface Handshake {
  /** Server: sends the hello and starts the timer. Bridge: starts the timer and waits for the hello. */
  start(): void;
  /** Feed one received message (as text). Never throws. */
  receive(message: string): void;
  /** The connection closed: stops the timer without reporting a result. */
  abort(): void;
  readonly done: boolean;
}

function mac(key: Buffer, role: 'b' | 's', first: Buffer, second: Buffer): Buffer {
  return createHmac('sha256', key).update(role, 'utf8').update(first).update(second).digest();
}

/** Constant-time compare; a different length is simply "no" (timingSafeEqual would throw). */
function macEqual(expected: Buffer, got: Buffer): boolean {
  return expected.length === got.length && timingSafeEqual(expected, got);
}

function parse(message: string): Record<string, unknown> | null {
  if (typeof message !== 'string' || message.length === 0 || message.length > MAX_HANDSHAKE_MESSAGE_CHARS) return null;
  let o: unknown;
  try { o = JSON.parse(message); } catch { return null; }
  return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
}

const hex64 = (v: unknown): Buffer | null => (typeof v === 'string' && HEX64_RE.test(v) ? Buffer.from(v, 'hex') : null);

function base(d: HandshakeDeps) {
  if (!Buffer.isBuffer(d.key) || d.key.length !== KEY_BYTES) throw new Error('The connection key must be 32 bytes.');
  const random = d.random ?? randomBytes;
  let finished = false;
  let timer: unknown = null;
  const clear = () => { if (timer !== null) { d.timers.clearTimeout(timer); timer = null; } };
  const finish = (r: HandshakeResult) => {
    if (finished) return;
    finished = true;
    clear();
    d.onDone(r);
  };
  const fail = (code: HandshakeErrorCode) => finish({ ok: false, error: { code, message: ERROR_TEXT[code] } });
  const arm = () => { timer = d.timers.setTimeout(() => fail('timeout'), d.timeoutMs ?? MCP_LIMITS.handshakeTimeoutMs); };
  return { random, fail, finish, arm, abort: () => { finished = true; clear(); }, isDone: () => finished };
}

/** The Durbar (listening) side. */
export function createServerHandshake(d: HandshakeDeps): Handshake {
  const b = base(d);
  let state: 'idle' | 'await-reply' = 'idle';
  let nonceS: Buffer = Buffer.alloc(0);
  return {
    start() {
      if (state !== 'idle' || b.isDone()) return;
      nonceS = b.random(NONCE_BYTES);
      state = 'await-reply';
      b.arm();
      d.send(JSON.stringify({ hello: HELLO, nonceS: nonceS.toString('hex') }));
    },
    receive(message) {
      if (b.isDone()) return;
      if (state !== 'await-reply') return b.fail('bad-state');
      const o = parse(message);
      const nonceB = o && hex64(o.nonceB);
      const got = o && hex64(o.mac);
      if (!o || !nonceB || !got) return b.fail('malformed');
      if (o.marker !== undefined && typeof o.marker !== 'boolean') return b.fail('malformed');
      if (o.parent !== undefined && (typeof o.parent !== 'string' || o.parent.length > MCP_LIMITS.maxNameLength)) return b.fail('malformed');
      if (nonceB.equals(nonceS) || !macEqual(mac(d.key, 'b', nonceS, nonceB), got)) return b.fail('bad-mac');
      d.send(JSON.stringify({ ok: true, mac: mac(d.key, 's', nonceB, nonceS).toString('hex') }));
      b.finish({ ok: true, peer: { marker: o.marker === true, ...(typeof o.parent === 'string' ? { parent: o.parent } : {}) } });
    },
    abort: b.abort,
    get done() { return b.isDone(); },
  };
}

export interface BridgeHandshakeDeps extends HandshakeDeps {
  /** Sent to the server in the answer (plan: marker, parent name). */
  peer?: PeerInfo;
}

/** The bridge (connecting) side. */
export function createBridgeHandshake(d: BridgeHandshakeDeps): Handshake {
  const b = base(d);
  let state: 'await-hello' | 'await-final' = 'await-hello';
  let nonceS: Buffer = Buffer.alloc(0);
  let nonceB: Buffer = Buffer.alloc(0);
  return {
    start() { b.arm(); },
    receive(message) {
      if (b.isDone()) return;
      const o = parse(message);
      if (state === 'await-hello') {
        const ns = o && hex64(o.nonceS);
        if (!o || !ns) return b.fail('malformed');
        if (o.hello !== HELLO) return b.fail('bad-version');
        nonceS = ns;
        nonceB = b.random(NONCE_BYTES);
        if (nonceB.equals(nonceS)) return b.fail('bad-mac');
        state = 'await-final';
        const reply: Record<string, unknown> = { nonceB: nonceB.toString('hex'), mac: mac(d.key, 'b', nonceS, nonceB).toString('hex') };
        if (d.peer) { reply.marker = d.peer.marker; if (d.peer.parent !== undefined) reply.parent = d.peer.parent; }
        d.send(JSON.stringify(reply));
        return;
      }
      const got = o && hex64(o.mac);
      if (!o || o.ok !== true || !got) return b.fail('malformed');
      if (!macEqual(mac(d.key, 's', nonceB, nonceS), got)) return b.fail('bad-mac');
      b.finish({ ok: true, peer: { marker: false } });
    },
    abort: b.abort,
    get done() { return b.isDone(); },
  };
}
