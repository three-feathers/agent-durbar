/**
 * Where the Durbar MCP server keeps its key file and listens (spec 041 FR-002, FR-006, FR-062).
 * Pure: every input is passed in, nothing is read, created or opened here. The caller creates the
 * folders (mode 0700) and, for the temporary fallback, checks them with `checkFallbackDir`.
 */
import * as path from 'path';
import { MCP_DIR_NAME, MCP_KEY_FILE_NAME, MCP_SERVER_NAME, MCP_SOCKET_FILE_NAME, UNIX_SOCKET_MAX_BYTES } from '../../shared/mcpserver';

export type McpPlatform = 'win32' | 'darwin' | 'linux';

export interface McpPathsInput {
  platform: string;
  /** Electron `userData`. The caller has already applied the `DURBAR_USER_DATA` dev hook (through `devEnv`, empty in packaged builds); this module never reads it. */
  userData: string;
  /** `process.env.XDG_RUNTIME_DIR`, passed by the caller (pass `undefined` when a dev hook keeps everything in userData). Used on Linux only. */
  xdgRuntimeDir?: string;
  /** Numeric user id (`process.getuid()`); `null` on Windows. */
  uid: number | null;
  /** `os.tmpdir()`; per-user on macOS. */
  tmpdir: string;
  /** Per-install id from the key file; required on Windows for the pipe name. */
  pipeId?: string;
}

export interface McpPaths {
  platform: McpPlatform;
  /** Folder that holds the key file (and the socket, unless it moved). Create it with mode 0700. */
  mcpDir: string | null;
  /** `null` when userData is not an absolute path (nothing is written). */
  keyFile: string | null;
  /** Unix socket path, or `\\.\pipe\...` on Windows. `null` when Durbar must not listen (see `reason`). */
  socket: string | null;
  kind: 'unix' | 'pipe';
  /** Set for every Unix socket folder (XDG runtime dir, <userData>/mcp, tmp fallback); null on Windows. The caller creates it with mode 0700 and must `lstat`-check it with `checkFallbackDir` before use (FR-062). */
  checkDir: string | null;
  /** Why there is no socket (shown in Settings); `null` when `socket` is set. */
  reason: string | null;
}

const PIPE_ID_RE = /^[A-Za-z0-9]{8,128}$/;

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function mcpPaths(input: McpPathsInput): McpPaths {
  // Unknown platform names are treated like Linux (Unix socket, XDG runtime dir).
  const platform: McpPlatform = input.platform === 'win32' ? 'win32' : input.platform === 'darwin' ? 'darwin' : 'linux';
  const p = platform === 'win32' ? path.win32 : path.posix;
  const userData = input.userData;
  const kind = platform === 'win32' ? 'pipe' : 'unix';

  if (typeof userData !== 'string' || userData.includes('\0') || !p.isAbsolute(userData) || p.normalize(userData) !== userData) {
    return { platform, mcpDir: null, keyFile: null, kind, socket: null, checkDir: null, reason: 'Durbar\'s data folder is not a plain absolute path, so the MCP server is not started.' };
  }
  const mcpDir = p.join(userData, MCP_DIR_NAME);
  const keyFile = p.join(mcpDir, MCP_KEY_FILE_NAME);

  if (platform === 'win32') {
    const ok = typeof input.pipeId === 'string' && PIPE_ID_RE.test(input.pipeId);
    return {
      platform, mcpDir, keyFile, kind, checkDir: null,
      socket: ok ? `\\\\.\\pipe\\${MCP_SERVER_NAME}-mcp-${input.pipeId}` : null,
      reason: ok ? null : 'The connection id is missing or invalid, so there is no pipe name.',
    };
  }

  // Linux: the XDG runtime dir, unless it is unset, not absolute, not normalized (a ".." or "." segment, double slash) or has a NUL.
  const xdg = input.xdgRuntimeDir;
  const useXdg = platform === 'linux' && typeof xdg === 'string' && !xdg.includes('\0') && p.isAbsolute(xdg) && p.normalize(xdg) === xdg;
  const inUserData = p.join(mcpDir, MCP_SOCKET_FILE_NAME);
  const fits = (s: string) => byteLength(s) <= UNIX_SOCKET_MAX_BYTES;
  if (useXdg) {
    const xdgDir = p.join(xdg as string, MCP_SERVER_NAME);
    const xdgSock = p.join(xdgDir, MCP_SOCKET_FILE_NAME);
    if (fits(xdgSock)) return { platform, mcpDir, keyFile, kind, socket: xdgSock, checkDir: xdgDir, reason: null };
  }
  // Then <userData>/mcp (checked too: one lstat, owned, 0700, not a symlink).
  if (fits(inUserData)) return { platform, mcpDir, keyFile, kind, socket: inUserData, checkDir: mcpDir, reason: null };

  // Too long for a Unix socket: per-user folder in the temp dir (macOS TMPDIR is already per user; the uid keeps the name unique elsewhere).
  const uidOk = input.uid !== null && Number.isInteger(input.uid) && input.uid >= 0;
  if (!uidOk || !p.isAbsolute(input.tmpdir) || p.normalize(input.tmpdir) !== input.tmpdir) {
    return { platform, mcpDir, keyFile, kind, socket: null, checkDir: null, reason: 'The socket path is too long and there is no safe temporary folder to use instead.' };
  }
  const checkDir = p.join(input.tmpdir, `${MCP_SERVER_NAME}-${input.uid}`);
  const fallback = p.join(checkDir, MCP_SOCKET_FILE_NAME);
  if (!fits(fallback)) {
    return { platform, mcpDir, keyFile, kind, socket: null, checkDir: null, reason: 'The socket path is too long, even in the temporary folder.' };
  }
  return { platform, mcpDir, keyFile, kind, socket: fallback, checkDir, reason: null };
}

/** The part of `fs.Stats` (from `lstat`, which does not follow links) that the check needs. */
export interface FallbackStat {
  uid: number;
  mode: number;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
}

export type FallbackCheck = { ok: true } | { ok: false; reason: string };

/** FR-062: the temporary folder must be a real directory, owned by the current user, mode 0700. Otherwise Durbar does not listen. */
export function checkFallbackDir(st: FallbackStat, uid: number): FallbackCheck {
  if (st.isSymbolicLink()) return { ok: false, reason: 'The temporary socket folder is a symbolic link, so Durbar does not use it.' };
  if (!st.isDirectory()) return { ok: false, reason: 'The temporary socket folder is not a folder, so Durbar does not use it.' };
  if (st.uid !== uid) return { ok: false, reason: 'The temporary socket folder belongs to another user, so Durbar does not use it.' };
  if ((st.mode & 0o777) !== 0o700) return { ok: false, reason: 'The temporary socket folder is open to other users (it must be mode 0700), so Durbar does not use it.' };
  return { ok: true };
}
