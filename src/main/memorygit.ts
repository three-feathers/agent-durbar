/**
 * Office memory (spec 116 FR-051, FR-055): read `<memory>/.git/config` as a file, never through git (FR-012: no process, no network).
 * `.git` must be a real folder (a file as in a worktree or submodule, or a link, answers "could not check"); the config is read with
 * `readCapped` (64 KB, `O_NOFOLLOW`, regular file only). Any doubt answers `unknown`, never `none`; only a folder with no `.git` at all
 * answers `none`.
 */
import { readCapped, type CappedFs, type CappedFlags } from '../shared/cappedread';
import { remoteHosts, MAX_GIT_CONFIG, type RemoteAnswer } from '../shared/memoryfolder';

export interface GitProbeFs extends CappedFs {
  lstatSync(p: string): { isDirectory(): boolean; isSymbolicLink(): boolean };
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
  const r = readCapped(fs, k, join(git, 'config'), MAX_GIT_CONFIG);
  if (!r.ok) return { kind: 'unknown' };
  return remoteHosts(r.buf.toString('utf8'));
}
