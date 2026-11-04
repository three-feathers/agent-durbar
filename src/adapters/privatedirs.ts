/**
 * Spec 012 FR-165 and spec 087 FR-023: Durbar's private temp folders (Claude Code's `mcp-config.json` folders, the Copilot runtime's
 * TMPDIR). Each is a new `mkdtemp` folder, 0700 where modes apply; each is removed by its own cleanup, and every folder still live is
 * removed on the process `exit` event and by `sweepPrivateDirs` (main calls it in `will-quit`), so none outlives the app. Not covered: a
 * SIGKILL or a crash of the app itself, and in Electron's main process `app.exit()`/`process.exit()`, which do not emit Node's `exit`
 * event (probed 2026-11-04; main sweeps in `will-quit` too).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

/** Removes every private folder still live (process exit, `will-quit`, tests). */
export function sweepPrivateDirs(): void {
  for (const dir of [...live]) remove(dir);
}

/** How many private folders whose name starts with `prefix` are live (tests). */
export function livePrivateDirs(prefix: string): number {
  return [...live].filter((d) => path.basename(d).startsWith(prefix)).length;
}
