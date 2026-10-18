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
  /** Electron `userData` (the caller has already applied `DURBAR_USER_DATA` when it set the path; it is read from `env` here too). */
  userData: string;
  env: Record<string, string | undefined>;
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
  mcpDir: string;
  keyFile: string;
  /** Unix socket path, or `\\.\pipe\...` on Windows. `null` when Durbar must not listen (see `reason`). */
  socket: string | null;
  kind: 'unix' | 'pipe';
  /** Set when the socket sits in the temporary fallback folder: the caller must `lstat` it before use (FR-062). */
  fallbackDir: string | null;
  /** Why there is no socket (shown in Settings); `null` when `socket` is set. */
  reason: string | null;
}

const PIPE_ID_RE = /^[A-Za-z0-9]{8,128}$/;

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function mcpPaths(input: McpPathsInput): McpPaths {
  const platform: McpPlatform = input.platform === 'win32' ? 'win32' : input.platform === 'darwin' ? 'darwin' : 'linux';
  const devUserData = input.env.DURBAR_USER_DATA;
  const dev = typeof devUserData === 'string' && devUserData !== '';
  const userData = dev ? (devUserData as string) : input.userData;

  if (platform === 'win32') {
    const mcpDir = path.win32.join(userData, MCP_DIR_NAME);
    const keyFile = path.win32.join(mcpDir, MCP_KEY_FILE_NAME);
    const ok = typeof input.pipeId === 'string' && PIPE_ID_RE.test(input.pipeId);
    return {
      platform, mcpDir, keyFile, kind: 'pipe', fallbackDir: null,
      socket: ok ? `\\\\.\\pipe\\${MCP_SERVER_NAME}-mcp-${input.pipeId}` : null,
      reason: ok ? null : 'The connection id is missing or invalid, so there is no pipe name.',
    };
  }

  const p = path.posix;
  const mcpDir = p.join(userData, MCP_DIR_NAME);
  const keyFile = p.join(mcpDir, MCP_KEY_FILE_NAME);

  // Linux: the XDG runtime dir, unless it is unset or not absolute, or DURBAR_USER_DATA asks to keep everything in one folder.
  const xdg = input.env.XDG_RUNTIME_DIR;
  const useXdg = platform === 'linux' && !dev && typeof xdg === 'string' && p.isAbsolute(xdg);
  const primaryDir = useXdg ? p.join(xdg as string, MCP_SERVER_NAME) : mcpDir;
  const primary = p.join(primaryDir, MCP_SOCKET_FILE_NAME);
  if (byteLength(primary) <= UNIX_SOCKET_MAX_BYTES) {
    return { platform, mcpDir, keyFile, kind: 'unix', socket: primary, fallbackDir: null, reason: null };
  }

  // Too long for a Unix socket: per-user folder in the temp dir (macOS TMPDIR is already per user; the uid keeps the name unique elsewhere).
  const uidOk = input.uid !== null && Number.isInteger(input.uid) && input.uid >= 0;
  if (!uidOk || !p.isAbsolute(input.tmpdir)) {
    return { platform, mcpDir, keyFile, kind: 'unix', socket: null, fallbackDir: null, reason: 'The socket path is too long and there is no safe temporary folder to use instead.' };
  }
  const fallbackDir = p.join(input.tmpdir, `${MCP_SERVER_NAME}-${input.uid}`);
  const fallback = p.join(fallbackDir, MCP_SOCKET_FILE_NAME);
  if (byteLength(fallback) > UNIX_SOCKET_MAX_BYTES) {
    return { platform, mcpDir, keyFile, kind: 'unix', socket: null, fallbackDir: null, reason: 'The socket path is too long, even in the temporary folder.' };
  }
  return { platform, mcpDir, keyFile, kind: 'unix', socket: fallback, fallbackDir, reason: null };
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
