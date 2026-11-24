/**
 * Office memory (spec 116 FR-051, FR-055): read `<memory>/.git/config` as a file, never through git (FR-012: no process, no network).
 * `.git` must be a real folder (a file as in a worktree or submodule, or a link, answers "could not check"); the config is read with
 * `readCapped` (64 KB, `O_NOFOLLOW`, regular file only). Any doubt answers `unknown`, never `none`; only a folder with no `.git` at all,
 * or a `.git/config` that names no remote, answers `none` ("no remote in this folder's .git/config").
 */
import { readCapped, type CappedFs, type CappedFlags } from '../shared/cappedread';
import { remoteHosts, MAX_GIT_CONFIG, type RemoteAnswer } from '../shared/memoryfolder';

/** The open flags for `.git/config`: `O_NOFOLLOW` and `O_NONBLOCK` where they exist (a FIFO swapped in after the lstat would block main forever). Main passes `fs.constants`, so a caller cannot forget one. */
export function memoryGitFlags(c: { O_RDONLY: number; O_NOFOLLOW?: number; O_NONBLOCK?: number }): CappedFlags {
  return { O_RDONLY: c.O_RDONLY, O_NOFOLLOW: c.O_NOFOLLOW, O_NONBLOCK: c.O_NONBLOCK };
}

export interface GitProbeFs extends CappedFs {
  lstatSync(p: string): { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean };
}

/** `join` is the platform's `path.join`. */
export function memoryGitRemote(fs: GitProbeFs, k: CappedFlags, join: (...p: string[]) => string, memoryFolder: string): RemoteAnswer {
  const git = join(memoryFolder, '.git');
  try {
    const st = fs.lstatSync(git);
    if (st.isSymbolicLink() || !st.isDirectory()) return { kind: 'unknown' };
  } catch (e) {
    return (e as { code?: unknown } | null)?.code === 'ENOENT' ? { kind: 'none' } : { kind: 'unknown' };
  }
  // Older layouts keep remotes outside the config: if either exists we cannot say "none" (names only, no readdir: FR-050)
  for (const old of ['remotes', 'branches']) {
    try { fs.lstatSync(join(git, old)); return { kind: 'unknown' }; } catch (e) { if ((e as { code?: unknown } | null)?.code !== 'ENOENT') return { kind: 'unknown' }; }
  }
  const cfg = join(git, 'config');
  // A link or a non-file is refused here, before the open: `O_NOFOLLOW` does not exist on Windows
  try { const c = fs.lstatSync(cfg); if (c.isSymbolicLink() || !c.isFile()) return { kind: 'unknown' }; } catch { return { kind: 'unknown' }; }
  const r = readCapped(fs, k, cfg, MAX_GIT_CONFIG);
  if (!r.ok) return { kind: 'unknown' };
  return remoteHosts(r.buf.toString('utf8'));
}
