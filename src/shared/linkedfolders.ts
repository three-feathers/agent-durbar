/**
 * Spec 043 FR-044: a project's agent folder is used only when no folder between the project and it is a link. Shared by the agent
 * list readers and main's read of a listed file, so both agree. `lstat` only (never `stat` or `realpath`): a symbolic link counts as a
 * link, and so does a Windows junction (Node's `lstat` reports it as `isSymbolicLink()`: from Node's docs, not run on Windows). Not
 * loaded in the page.
 */
import * as fs from 'fs';
import * as path from 'path';

export type LstatLike = (p: string) => { isSymbolicLink(): boolean };

/**
 * True when `dir` is not inside `root`, or `dir` or any folder between `root` and it is a link or cannot be read. `root` itself (the
 * folder the user opened) is not checked.
 */
export function linkedBelow(root: string, dir: string, lstat: LstatLike = (p) => fs.lstatSync(p)): boolean {
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return true;
  let cur = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      if (lstat(cur).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}
