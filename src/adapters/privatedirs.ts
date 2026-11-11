/**
 * Spec 012 FR-165 and spec 087 FR-023: Durbar's private temp folders (Claude Code's `mcp-config.json` folders, the Copilot runtime's
 * TMPDIR, under a short root when the OS one is too long for Unix sockets: FR-024). Each is a new `mkdtemp` folder, 0700 where modes
 * apply; each is removed by its own cleanup, and every folder still live is
 * removed on the process `exit` event and by `sweepPrivateDirs` (main calls it in `will-quit`), so none outlives the app. Not covered: a
 * SIGKILL or a crash of the app itself, and in Electron's main process `app.exit()`/`process.exit()`, which do not emit Node's `exit`
 * event (probed 2026-11-04; main sweeps in `will-quit` too).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UNIX_SOCKET_MAX_BYTES } from '../shared/mcpserver';

const live = new Set<string>();
let exitHooked = false;

const remove = (dir: string): void => {
  live.delete(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS cleans its temp folder */
  }
};

/** A new private folder `<tmpRoot>/<prefix>XXXXXX`, mode 0700 (POSIX), tracked until `cleanup` or the exit sweep. */
export function makePrivateDir(prefix: string, tmpRoot: string = os.tmpdir()): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(tmpRoot, prefix));
  live.add(dir);
  if (!exitHooked) {
    exitHooked = true;
    process.on('exit', sweepPrivateDirs);
  }
  try {
    if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
  } catch (e) {
    remove(dir);
    throw e;
  }
  return { dir, cleanup: () => remove(dir) };
}

/** Spec 087 FR-024: bytes kept free after a private `TMPDIR` for the Unix sockets tools put under it (Playwright MCP: `pw-<hash>/<domain>/<name>.sock`). */
export const SOCKET_ROOM_BYTES = 40;
/** mkdtemp's random suffix (`XXXXXX`). */
const MKDTEMP_SUFFIX_BYTES = 6;

/**
 * Spec 087 FR-024 (issue #1173): the root for a private folder that is handed to a runtime as `TMPDIR`. On macOS and Linux a Unix socket
 * path must fit `sun_path` (104 bytes on macOS, 108 on Linux; `UNIX_SOCKET_MAX_BYTES`), and macOS's `os.tmpdir()` (`/var/folders/…/T`)
 * leaves too little room. So when `<tmpRoot>/<prefix>XXXXXX` plus `SOCKET_ROOM_BYTES` does not fit, the short root (`/tmp`, resolved:
 * `/private/tmp` on macOS) is used instead. Windows is unchanged (named pipes have no such limit).
 */
export function socketSafeTmpRoot(prefix: string, tmpRoot: string = os.tmpdir(), platform: string = process.platform, short?: string): string {
  if (platform === 'win32') return tmpRoot;
  const shortRoot = short ?? realShortRoot();
  const fits = (root: string) => Buffer.byteLength(path.join(root, prefix), 'utf8') + MKDTEMP_SUFFIX_BYTES + SOCKET_ROOM_BYTES <= UNIX_SOCKET_MAX_BYTES;
  return fits(tmpRoot) || !fits(shortRoot) ? tmpRoot : shortRoot;
}

function realShortRoot(): string {
  try {
    return fs.realpathSync('/tmp');
  } catch {
    return '/tmp';
  }
}

/** Spec 087 FR-024: `makePrivateDir` under `socketSafeTmpRoot`; if the short root cannot be used, the OS temp root as before. */
export function makeSocketSafePrivateDir(prefix: string): { dir: string; cleanup: () => void } {
  const root = socketSafeTmpRoot(prefix);
  if (root === os.tmpdir()) return makePrivateDir(prefix);
  try {
    return makePrivateDir(prefix, root);
  } catch {
    return makePrivateDir(prefix);
  }
}

/** Removes every private folder still live (process exit, `will-quit`, tests). */
export function sweepPrivateDirs(): void {
  for (const dir of [...live]) remove(dir);
}

/** How many private folders whose name starts with `prefix` are live (tests). */
export function livePrivateDirs(prefix: string): number {
  return [...live].filter((d) => path.basename(d).startsWith(prefix)).length;
}
