/*
 * Spec 012 FR-166 (#1093): the one place a test makes a temp folder. `tmpDir(prefix)` is `fs.mkdtempSync` under `os.tmpdir()`; every folder
 * made is removed when the process exits (also after `process.exit` or a failed assert), so `npm test` leaves no `durbar-*` folder behind
 * (scripts/run-tests.js fails a suite that does). A test that needs the folder gone earlier calls `rmTmp(dir)`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const made = new Set<string>();
let hooked = false;

export function rmTmp(dir: string): void {
  made.delete(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS cleans its temp folder */
  }
}

/** A new empty folder `<tmpdir>/<prefix>XXXXXX`, removed at process exit. */
export function tmpDir(prefix: string): string {
  if (!hooked) {
    hooked = true;
    process.on('exit', () => {
      for (const d of [...made]) rmTmp(d);
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}
