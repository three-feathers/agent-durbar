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
/** Largest key file Durbar will read, in bytes (a real one is about 150). */
const MAX_KEY_FILE_BYTES = 4096;

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
  /** Opens read-only without following a final symlink and without blocking on a FIFO (`O_NOFOLLOW|O_NONBLOCK` where the OS has them). Throws on a link. */
  open(file: string): number;
  /** `fstat` of an open descriptor, with the size in bytes. */
  fstat(fd: number): AuthStat & { size: number };
  /** Reads at most `max` bytes from the descriptor, as UTF-8 text. */
  readFd(fd: number, max: number): string;
  close(fd: number): void;
  lstat(p: string): AuthStat;
  /** File names (not paths) in a folder. */
  readdir(dir: string): string[];
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

function owned(d: KeyFileDeps, st: AuthStat): boolean {
  if (d.platform === 'win32') return true; // no usable owner on Windows
  return d.uid !== null && st.uid === d.uid; // POSIX: fails closed when the uid is unknown
}

/** The connection folder must be a real folder (not a link) owned by this user. Returns the refusal text, or null. `strictMode` adds the 0700 check (read); the write path fixes the mode itself. */
function dirProblem(d: KeyFileDeps, st: AuthStat, strictMode: boolean): string | null {
  if (st.isSymbolicLink()) return 'The connection folder is a symbolic link, so it is not used.';
  if (!st.isDirectory()) return 'The connection folder is not a folder, so it is not used.';
  if (!owned(d, st)) return 'The connection folder belongs to another user, so it is not used.';
  if (strictMode && d.platform !== 'win32' && (st.mode & 0o077) !== 0) return 'The connection folder is open to other users (it must be mode 0700), so it is not used.';
  return null;
}

const TMP_SUFFIX_RE = /^[0-9a-f]{16}\.tmp$/;

/** Removes leftover `<key file name>.<16 hex>.tmp` files from a crashed write: only that pattern, only in `mcpDir`, only regular files (a link or folder with that name is left alone; nothing is followed). Never throws. */
function removeStaleTemps(d: KeyFileDeps): void {
  try {
    const name = d.keyFile.slice(Math.max(d.keyFile.lastIndexOf('/'), d.keyFile.lastIndexOf('\\')) + 1);
    for (const f of d.fs.readdir(d.mcpDir)) {
      if (!f.startsWith(name + '.') || !TMP_SUFFIX_RE.test(f.slice(name.length + 1))) continue;
      const full = d.keyFile.slice(0, d.keyFile.length - name.length) + f;
      try {
        const st = d.fs.lstat(full);
        if (!st.isSymbolicLink() && st.isFile()) d.fs.unlink(full);
      } catch { /* gone already */ }
    }
  } catch { /* no folder, or unreadable: nothing to clean */ }
}

/** Writes the key file atomically (temp file in the same folder, then rename): a failure leaves the old file, or none, never a partial one. */
function writeAtomic(d: KeyFileDeps, m: KeyMaterial): void {
  const random = d.random ?? randomBytes;
  const posix = d.platform !== 'win32';
  try {
    d.fs.mkdirp(d.mcpDir, 0o700);
  } catch (e) {
    throw new Error(`Could not create the connection folder (${errCode(e)}).`);
  }
  // Never write through a symlinked or foreign folder (checked before chmod, which would follow a link).
  let problem: string | null;
  try { problem = dirProblem(d, d.fs.lstat(d.mcpDir), false); } catch (e) {
    throw new Error(`Could not check the connection folder (${errCode(e)}).`);
  }
  if (problem) throw new Error(problem);
  try {
    if (posix) d.fs.chmod(d.mcpDir, 0o700); // an existing folder (or a restrictive umask) must end up 0700
  } catch (e) {
    throw new Error(`Could not secure the connection folder (${errCode(e)}).`);
  }
  removeStaleTemps(d);
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
  let folderOk = false;
  try { folderOk = dirProblem(d, d.fs.lstat(d.mcpDir), false) === null; } catch { /* no folder */ }
  if (folderOk) removeStaleTemps(d);
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
  const missing: KeyReadResult = { ok: false, reason: 'missing', message: 'There is no connection key file.' };
  const cannot = (what: string, e: unknown): KeyReadResult => ({ ok: false, reason: 'invalid', message: `The ${what} cannot be read (${errCode(e)}).` });

  let dirSt: AuthStat;
  try { dirSt = d.fs.lstat(d.mcpDir); } catch (e) {
    return errCode(e) === 'ENOENT' ? missing : cannot('connection folder', e);
  }
  const dp = dirProblem(d, dirSt, true);
  if (dp) return unsafe(dp);

  let st: AuthStat;
  try { st = d.fs.lstat(d.keyFile); } catch (e) {
    return errCode(e) === 'ENOENT' ? missing : cannot('connection key file', e);
  }
  if (st.isSymbolicLink()) return unsafe('The connection key file is a symbolic link, so it is not used.');
  if (!st.isFile()) return unsafe('The connection key file is not a regular file, so it is not used.');

  // The checks above are a fast path. What counts is the descriptor: open without following a link or blocking on a
  // FIFO, then fstat the descriptor, so a file swapped in after the lstat is refused.
  let fd: number;
  try { fd = d.fs.open(d.keyFile); } catch (e) {
    const c = errCode(e);
    if (c === 'ENOENT') return missing;
    if (c === 'ELOOP' || c === 'EMLINK') return unsafe('The connection key file is a symbolic link, so it is not used.');
    return cannot('connection key file', e);
  }
  let text: string;
  try {
    const fst = d.fs.fstat(fd);
    if (fst.isSymbolicLink() || !fst.isFile()) return unsafe('The connection key file is not a regular file, so it is not used.');
    if (!owned(d, fst)) return unsafe('The connection key file belongs to another user, so it is not used.');
    if (posix && (fst.mode & 0o077) !== 0) return unsafe('The connection key file is open to other users (it must be mode 0600), so it is not used.');
    if (!(fst.size >= 0) || fst.size > MAX_KEY_FILE_BYTES) return { ok: false, reason: 'invalid', message: 'The connection key file is damaged.' };
    text = d.fs.readFd(fd, MAX_KEY_FILE_BYTES);
  } catch (e) {
    return cannot('connection key file', e);
  } finally {
    try { d.fs.close(fd); } catch { /* nothing more to do */ }
  }
  const bad: KeyReadResult = { ok: false, reason: 'invalid', message: 'The connection key file is damaged.' };
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
    open: (file) => fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)),
    fstat: (fd) => fs.fstatSync(fd),
    readFd: (fd, max) => {
      const buf = Buffer.alloc(max);
      let n = 0;
      while (n < max) {
        const got = fs.readSync(fd, buf, n, max - n, null);
        if (got === 0) break;
        n += got;
      }
      return buf.subarray(0, n).toString('utf8');
    },
    close: (fd) => fs.closeSync(fd),
    lstat: (p) => fs.lstatSync(p),
    readdir: (dir) => fs.readdirSync(dir),
    unlink: (p) => fs.unlinkSync(p),
  };
}

// ---------------------------------------------------------------------------------------------
// Handshake (FR-058, FR-061)
//
//   server -> bridge  {"hello":"agent-durbar-mcp/1","nonceS":<64 hex>}
//   bridge -> server  {"nonceB":<64 hex>,"mac":HMAC(key,T('b')),"marker":bool?,"parent":str?}
//   server -> bridge  {"ok":true,"mac":HMAC(key,T('s'))}      (only after the bridge's MAC checked out)
//
// T(role) is an unambiguous transcript: lp(role) lp(version) first-nonce second-nonce marker-byte
// parent-present-byte lp(parent), where lp(x) is a 2-byte big-endian length then the UTF-8 bytes. The order is
// (nonceS, nonceB) for role "b" and (nonceB, nonceS) for role "s". So each MAC covers the role, the protocol version,
// both nonces and the bridge's claimed `marker` and `parent`: a relayed reply with a changed field fails, and a MAC
// cannot be reflected back at the side that made it or replayed from the other direction. The key never crosses
// the wire. A failed handshake sends nothing back (the server has sent only its nonce before authenticating).
// ---------------------------------------------------------------------------------------------

export const HELLO = 'agent-durbar-mcp/1';
const MAX_HANDSHAKE_MESSAGE_CHARS = 1024;
/** Longest raw `parent` the server looks at (UTF-16 units); it is sanitized and capped to 64 code points after. */
const MAX_RAW_PARENT_CHARS = 512;
const HEX64_RE = /^[0-9a-f]{64}$/;

export type HandshakeErrorCode = 'timeout' | 'malformed' | 'bad-version' | 'bad-mac' | 'bad-state' | 'refused-agent';

const ERROR_TEXT: Record<HandshakeErrorCode, string> = {
  timeout: 'The handshake did not finish in time.',
  malformed: 'The handshake message was not valid.',
  'bad-version': 'The peer speaks another handshake version.',
  'bad-mac': 'The handshake proof was wrong.',
  'bad-state': 'A handshake message arrived at the wrong time, or could not be sent.',
  'refused-agent': 'Durbar does not accept connections from inside an agent.',
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
  /** Writes one handshake message (a JSON string, no newline; T013 frames it). If it throws, the handshake fails as `bad-state`. */
  send(message: string): void;
  onDone(result: HandshakeResult): void;
  timers: Timers;
  random?: (n: number) => Buffer;
  /** Defaults to `MCP_LIMITS.handshakeTimeoutMs` (2 s). */
  timeoutMs?: number;
}

export interface Handshake {
  /** Server: sends the hello and starts the timer. Bridge: starts the timer and waits for the hello. Idempotent. */
  start(): void;
  /** Feed one received message (as text). Never throws. */
  receive(message: string): void;
  /** The connection closed: stops the timer without reporting a result. */
  abort(): void;
  readonly done: boolean;
}

const PARENT_MAX_CODE_POINTS = 64;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The name of the client that launched the bridge, made safe to bind and show: control and format characters (\p{Cc}, \p{Cf}, such as U+202E) and lone surrogates are stripped, then at most 64 code points are kept (the same rule as `clientInfo`, T012). */
export function sanitizeParent(s: string): string {
  return Array.from(s.replace(LONE_SURROGATE_RE, '').replace(/[\p{Cc}\p{Cf}]/gu, '')).slice(0, PARENT_MAX_CODE_POINTS).join('');
}

function lp(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(Math.min(b.length, 0xffff));
  return Buffer.concat([len, b.subarray(0, 0xffff)]);
}

/** HMAC-SHA256 over the transcript T(role) described above. */
function mac(key: Buffer, role: 'b' | 's', first: Buffer, second: Buffer, peer: PeerInfo): Buffer {
  return createHmac('sha256', key)
    .update(lp(role)).update(lp(HELLO))
    .update(first).update(second)
    .update(Buffer.from([peer.marker ? 1 : 0, peer.parent !== undefined ? 1 : 0]))
    .update(lp(peer.parent ?? ''))
    .digest();
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
  const clear = () => { if (timer !== null) { try { d.timers.clearTimeout(timer); } catch { /* ignore */ } timer = null; } };
  const finish = (r: HandshakeResult) => {
    if (finished) return;
    finished = true;
    clear();
    try { d.onDone(r); } catch { /* a throwing listener must not break the caller */ }
  };
  const fail = (code: HandshakeErrorCode) => finish({ ok: false, error: { code, message: ERROR_TEXT[code] } });
  const arm = () => { timer = d.timers.setTimeout(() => fail('timeout'), d.timeoutMs ?? MCP_LIMITS.handshakeTimeoutMs); };
  /** Sends; a throwing `send` fails the handshake as bad-state. Returns whether it was sent. */
  const send = (m: string): boolean => {
    try { d.send(m); return true; } catch { fail('bad-state'); return false; }
  };
  /** Runs a step so that `receive` and `start` never throw. */
  const guard = (fn: () => void) => { try { fn(); } catch { fail('bad-state'); } };
  return { random, fail, finish, arm, send, guard, abort: () => { finished = true; clear(); }, isDone: () => finished };
}

/** The Durbar (listening) side. */
export function createServerHandshake(d: HandshakeDeps): Handshake {
  const b = base(d);
  let state: 'idle' | 'await-reply' = 'idle';
  let nonceS: Buffer = Buffer.alloc(0);
  return {
    start() {
      if (state !== 'idle' || b.isDone()) return;
      b.guard(() => {
        nonceS = b.random(NONCE_BYTES);
        state = 'await-reply';
        b.arm();
        b.send(JSON.stringify({ hello: HELLO, nonceS: nonceS.toString('hex') }));
      });
    },
    receive(message) {
      if (b.isDone()) return;
      b.guard(() => {
        if (state !== 'await-reply') return b.fail('bad-state');
        const o = parse(message);
        const nonceB = o && hex64(o.nonceB);
        const got = o && hex64(o.mac);
        if (!o || !nonceB || !got) return b.fail('malformed');
        if (o.marker !== undefined && typeof o.marker !== 'boolean') return b.fail('malformed');
        if (o.parent !== undefined && (typeof o.parent !== 'string' || o.parent.length > MAX_RAW_PARENT_CHARS)) return b.fail('malformed');
        const peer: PeerInfo = { marker: o.marker === true, ...(typeof o.parent === 'string' ? { parent: sanitizeParent(o.parent) } : {}) };
        if (nonceB.equals(nonceS) || !macEqual(mac(d.key, 'b', nonceS, nonceB, peer), got)) return b.fail('bad-mac');
        // Defence in depth (FR-034): an authenticated bridge that says it runs inside an agent is refused; nothing is sent back.
        if (peer.marker) return b.fail('refused-agent');
        if (!b.send(JSON.stringify({ ok: true, mac: mac(d.key, 's', nonceB, nonceS, peer).toString('hex') }))) return;
        b.finish({ ok: true, peer });
      });
    },
    abort: b.abort,
    get done() { return b.isDone(); },
  };
}

export interface BridgeHandshakeDeps extends HandshakeDeps {
  /** Sent to the server in the answer and covered by both MACs (plan: marker, parent name). */
  peer?: PeerInfo;
}

/** The bridge (connecting) side. */
export function createBridgeHandshake(d: BridgeHandshakeDeps): Handshake {
  const b = base(d);
  const peer: PeerInfo = { marker: d.peer?.marker === true, ...(d.peer?.parent !== undefined ? { parent: sanitizeParent(d.peer.parent) } : {}) };
  let started = false;
  let state: 'await-hello' | 'await-final' = 'await-hello';
  let nonceS: Buffer = Buffer.alloc(0);
  let nonceB: Buffer = Buffer.alloc(0);
  return {
    start() {
      if (started || b.isDone()) return;
      started = true;
      b.guard(() => b.arm());
    },
    receive(message) {
      if (b.isDone()) return;
      b.guard(() => {
        const o = parse(message);
        if (state === 'await-hello') {
          const ns = o && hex64(o.nonceS);
          if (!o || !ns) return b.fail('malformed');
          if (o.hello !== HELLO) return b.fail('bad-version');
          nonceS = ns;
          nonceB = b.random(NONCE_BYTES);
          if (nonceB.equals(nonceS)) return b.fail('bad-mac');
          state = 'await-final';
          const reply: Record<string, unknown> = { nonceB: nonceB.toString('hex'), mac: mac(d.key, 'b', nonceS, nonceB, peer).toString('hex') };
          if (d.peer) { reply.marker = peer.marker; if (peer.parent !== undefined) reply.parent = peer.parent; }
          b.send(JSON.stringify(reply));
          return;
        }
        const got = o && hex64(o.mac);
        if (!o || o.ok !== true || !got) return b.fail('malformed');
        if (!macEqual(mac(d.key, 's', nonceB, nonceS, peer), got)) return b.fail('bad-mac');
        b.finish({ ok: true, peer });
      });
    },
    abort: b.abort,
    get done() { return b.isDone(); },
  };
}
