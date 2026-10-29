/**
 * Spec 087 T066: the folder cleanup of `scripts/sandbox-floor-real.ts` (the `switch` probe), apart so `scripts/test-sandbox-floor.ts` can
 * test it on throw-away folders. It removes only what it can name, never recursively.
 *
 * The real run of 2026-10-28 (`real:`, Linux 7.0, bubblewrap 0.9.0, CLI 1.0.98; issue #806) left the session folder F behind: it held a
 * `.git/` with an empty `hooks/` and a `config` the probe never made. Ask first's floor denies `<root>/.git/hooks` and `<root>/.git/config`
 * (FR-004), and the runtime or bubblewrap leaves a placeholder for each one that did not exist. `gitPlaceholders` recognises exactly that:
 * a plain `.git` folder that holds exactly `hooks` (a plain, empty folder) and `config` (a plain, empty file), nothing else.
 */
import * as fs from 'fs';
import * as path from 'path';

const plainDir = (p: string): boolean => { const s = fs.lstatSync(p); return s.isDirectory() && !s.isSymbolicLink(); };

/** True only when `gitDir` is exactly the two placeholders of a denied `.git/hooks` and `.git/config` (see above). Never throws. */
export function gitPlaceholders(gitDir: string): boolean {
  try {
    if (!plainDir(gitDir)) return false;
    const names = fs.readdirSync(gitDir).sort();
    if (names.length !== 2 || names[0] !== 'config' || names[1] !== 'hooks') return false;
    const hooks = path.join(gitDir, 'hooks');
    if (!plainDir(hooks) || fs.readdirSync(hooks).length) return false;
    const cfg = fs.lstatSync(path.join(gitDir, 'config'));
    return cfg.isFile() && cfg.size === 0;
  } catch {
    return false;
  }
}

/**
 * Remove a folder the probe made, only when it is directly under `parent`, has the probe's prefix and holds nothing but `allowed` files
 * and, with `gitPlaceholders`, the `.git` placeholders above at its top level. Nothing is removed unless all of it qualifies.
 */
export function removeOwn(dir: string, parent: string, allowed: readonly string[], o: { prefix: string; show: (v: unknown, n?: number) => string; gitPlaceholders?: boolean }): string {
  const show = o.show;
  try {
    if (!dir) return 'nothing to remove';
    if (path.dirname(dir) !== parent || !path.basename(dir).startsWith(o.prefix)) return `left ${show(dir)}: not a folder this script made`;
    if (!fs.existsSync(dir)) return `already gone: ${show(dir)}`;
    if (!plainDir(dir)) return `left ${show(dir)}: not a plain folder`;
    const names = fs.readdirSync(dir);
    const git = !!o.gitPlaceholders && names.includes('.git') && gitPlaceholders(path.join(dir, '.git'));
    const other = names.filter((n) => !(git && n === '.git') && (!allowed.includes(n) || !fs.lstatSync(path.join(dir, n)).isFile()));
    if (other.length) return `left ${show(dir)}: it holds ${other.length} other entr${other.length === 1 ? 'y' : 'ies'}`;
    for (const n of names) if (n !== '.git') fs.unlinkSync(path.join(dir, n));
    if (git) {
      // non-recursive on purpose: rmdir refuses a folder that is no longer empty
      fs.rmdirSync(path.join(dir, '.git', 'hooks'));
      fs.unlinkSync(path.join(dir, '.git', 'config'));
      fs.rmdirSync(path.join(dir, '.git'));
    }
    fs.rmdirSync(dir);
    return `removed ${show(dir)}${git ? ' (and the .git/hooks, .git/config placeholders of the floor)' : ''}`;
  } catch (e) {
    return `could not remove ${show(dir)}: ${show(e instanceof Error ? e.message : e, 200)}`;
  }
}
