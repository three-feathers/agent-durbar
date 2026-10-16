import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Open a folder or .code-workspace file with `code <path>`.
 * No shell, a single absolute path argument (so it can never be parsed as an option).
 */
export function openInVSCode(target: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!path.isAbsolute(target)) return resolve({ ok: false, error: 'path must be absolute' });
    const child = spawn('code', [target], { stdio: 'ignore', detached: true, shell: false });
    child.once('error', (err: NodeJS.ErrnoException) =>
      resolve({ ok: false, error: err.code === 'ENOENT' ? '`code` command not found in PATH' : err.message }),
    );
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}
