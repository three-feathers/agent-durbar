/**
 * Spec 065: undo an agent's file changes, one turn at a time. Adapters call the write guard just before an agent's file-edit tool
 * writes (FR-001); this store keeps the first copy of each such file in the turn, records what the files look like when the turn
 * ends, and can put them back. Safety (constitution III):
 * - only paths inside the session's folders (lexical and realpath containment), never through a symbolic link;
 * - an undo refuses, for the whole turn, when any file changed since the turn ended (someone else's work is never overwritten);
 * - before restoring, the current files are copied, so the undo itself can be undone;
 * - files are written with a temp file and a rename in the same folder (keeping the mode); no git, no shell;
 * - copies are private (folders 0700, files 0600), bounded (per file, per turn, turns per session, total) and only live while the
 *   app runs: the folder is emptied when the store is created.
 * Pure file-system code with an injected folder and limits, so it is unit-tested (scripts/test-checkpoints.ts).
 */
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { simpleDiff } from '../shared/diff';

export interface CheckpointLimits {
  fileBytes: number;
  turnBytes: number;
  turnsPerSession: number;
  totalBytes: number;
}
export const DEFAULT_CHECKPOINT_LIMITS: CheckpointLimits = { fileBytes: 5 * 1024 * 1024, turnBytes: 50 * 1024 * 1024, turnsPerSession: 20, totalBytes: 500 * 1024 * 1024 };

export type Change = 'changed' | 'created' | 'deleted';
export interface NotCovered { path: string; why: string }
export interface TurnSummary { turn: number; kind: 'turn' | 'undo'; files: { path: string; change: Change }[]; notCovered: NotCovered[] }
export interface PreviewFile { path: string; action: 'restore' | 'remove' | 'create'; diff?: string; binary?: boolean }
export interface Preview { ok: true; turn: number; files: PreviewFile[]; conflicts: string[]; notCovered: NotCovered[] }
export type UndoResult =
  | { ok: true; restored: number; removed: number; created: number; undo: TurnSummary }
  | { ok: false; error: string; conflicts?: string[] };

interface FileRecord { abs: string; rel: string; existed: boolean; blob?: string; size: number; mode: number; before: string; after?: string }
interface TurnRecord { id: number; kind: 'turn' | 'undo'; dir: string; roots: string[]; files: Map<string, FileRecord>; notCovered: NotCovered[]; bytes: number; ended: boolean }

const MISSING = 'missing';
const LINK = 'symlink';
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** What a path holds right now, as one comparable string: a content hash, `missing` or `symlink` (a link is never followed). */
function stateOf(abs: string): string {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return MISSING;
  }
  if (st.isSymbolicLink()) return LINK;
  if (!st.isFile()) return 'other';
  try {
    return sha(fs.readFileSync(abs));
  } catch {
    return 'unreadable';
  }
}

const isInside = (root: string, p: string): boolean => {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const realOr = (p: string): string | undefined => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return undefined;
  }
};
/** Nearest existing ancestor's real path (a created file's folder may not exist yet). */
function realAncestor(p: string): string | undefined {
  let cur = p;
  for (let i = 0; i < 64; i++) {
    const r = realOr(cur);
    if (r) return r;
    const up = path.dirname(cur);
    if (up === cur) return undefined;
    cur = up;
  }
  return undefined;
}
const looksBinary = (b: Buffer): boolean => b.subarray(0, 8192).includes(0);

/**
 * FR-005 at undo time (review on #440): the folders may have changed since the copy was taken, for example a parent folder swapped
 * for a link to somewhere outside. A target is safe only when it is lexically inside one of the roots, no existing component between
 * that root and the target (the target included) is a link or a non-folder, and the nearest existing parent's real path is inside the
 * root's real path. Returns why it is not safe, or undefined.
 */
export function unsafeTarget(roots: readonly string[], abs: string): string | undefined {
  const root = roots.find((r) => isInside(r, abs) && abs !== r);
  if (!root) return 'outside the session’s folders';
  const realRoot = realOr(root);
  if (!realRoot) return 'the session’s folder is gone';
  const parts = path.relative(root, abs).split(path.sep).filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      break; // missing from here on: created one level at a time, each checked again
    }
    if (st.isSymbolicLink()) return 'a folder or file on its path is now a link';
    if (i < parts.length - 1 && !st.isDirectory()) return 'a folder on its path is no longer a folder';
  }
  const realParent = realAncestor(path.dirname(abs));
  if (!realParent || !isInside(realRoot, realParent)) return 'its folder now leads outside the session’s folders';
  return undefined;
}

/** Creates the missing folders of `dir` one level at a time, each checked to be a real folder (never a link) inside the root. */
function makeParents(roots: readonly string[], dir: string): void {
  const root = roots.find((r) => isInside(r, dir));
  if (!root) throw new Error('outside the session’s folders');
  let cur = root;
  for (const part of path.relative(root, dir).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      fs.mkdirSync(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('a folder on its path is now a link');
  }
}

export class CheckpointStore {
  private readonly turns = new Map<string, TurnRecord[]>();
  private readonly open = new Map<string, TurnRecord>();
  private seq = 0;
  private blobs = 0;

  constructor(private readonly dir: string, private readonly limits: CheckpointLimits = DEFAULT_CHECKPOINT_LIMITS) {
    fs.rmSync(dir, { recursive: true, force: true }); // copies only live while the app runs (FR-006)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }

  /** A send starts a turn (FR-002). An unfinished turn of the same session is ended first. */
  beginTurn(agent: string, roots: string[]): number {
    if (this.open.has(agent)) this.endTurn(agent);
    return this.newTurn(agent, roots, 'turn').id;
  }

  private newTurn(agent: string, roots: string[], kind: 'turn' | 'undo'): TurnRecord {
    const id = ++this.seq;
    const dir = path.join(this.dir, String(id));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const t: TurnRecord = { id, kind, dir, roots: roots.map((r) => path.resolve(r)), files: new Map(), notCovered: [], bytes: 0, ended: false };
    this.open.set(agent, t);
    return t;
  }

  /**
   * FR-001/FR-002: just before an agent's file-edit tool writes `filePath`: keep a copy of it (or "it did not exist"). The first copy
   * of a path in a turn wins. Never throws: anything that cannot be kept is listed as not covered.
   */
  capture(agent: string, roots: string[], filePath: string): void {
    try {
      let t = this.open.get(agent);
      if (!t) t = this.newTurn(agent, roots, 'turn'); // a write outside a send (a queued message): still one turn
      if (typeof filePath !== 'string' || !filePath || filePath.length > 4096 || filePath.includes('\0')) return;
      const abs = path.resolve(t.roots[0] ?? process.cwd(), filePath);
      if (t.files.has(abs) || t.notCovered.some((n) => n.path === abs)) return;
      const skip = (why: string): void => void t!.notCovered.push({ path: abs, why });
      const root = t.roots.find((r) => isInside(r, abs));
      if (!root) return skip('outside the session’s folders');
      const realRoot = realOr(root);
      const realParent = realAncestor(path.dirname(abs));
      if (!realRoot || !realParent || !isInside(realRoot, realParent)) return skip('outside the session’s folders (through a link)');
      let st: fs.Stats | undefined;
      try {
        st = fs.lstatSync(abs);
      } catch {
        st = undefined;
      }
      const rel = path.relative(root, abs) || path.basename(abs);
      if (!st) {
        t.files.set(abs, { abs, rel, existed: false, size: 0, mode: 0o644, before: MISSING });
        return;
      }
      if (st.isSymbolicLink()) return skip('a symbolic link');
      if (!st.isFile()) return skip('not a regular file');
      if (st.size > this.limits.fileBytes) return skip('too large to undo');
      if (t.bytes + st.size > this.limits.turnBytes) return skip('too large to undo (this turn changed too much)');
      const data = fs.readFileSync(abs);
      const blob = path.join(t.dir, `${++this.blobs}.bin`);
      fs.writeFileSync(blob, data, { mode: 0o600 });
      t.bytes += data.length;
      t.files.set(abs, { abs, rel, existed: true, blob, size: data.length, mode: st.mode & 0o777, before: sha(data) });
    } catch {
      /* never fails the agent's write */
    }
  }

  /** FR-002: the session went idle or stopped. Records the after-state of each file; a summary when the turn changed files. */
  endTurn(agent: string): TurnSummary | undefined {
    const t = this.open.get(agent);
    if (!t) return undefined;
    this.open.delete(agent);
    t.ended = true;
    for (const [abs, f] of t.files) {
      f.after = stateOf(abs);
      if (f.after === f.before) t.files.delete(abs); // written back unchanged: nothing to undo
    }
    if (!t.files.size && !t.notCovered.length) {
      fs.rmSync(t.dir, { recursive: true, force: true });
      return undefined;
    }
    const list = this.turns.get(agent) ?? [];
    list.push(t);
    this.turns.set(agent, list);
    this.prune(agent);
    return this.summary(t);
  }

  private summary(t: TurnRecord): TurnSummary {
    const files = [...t.files.values()].map((f) => ({ path: f.rel, change: (!f.existed ? 'created' : f.after === MISSING ? 'deleted' : 'changed') as Change }));
    return { turn: t.id, kind: t.kind, files, notCovered: t.notCovered.map((n) => ({ path: this.relOf(t, n.path), why: n.why })) };
  }

  private relOf(t: TurnRecord, abs: string): string {
    const root = t.roots.find((r) => isInside(r, abs));
    return root ? path.relative(root, abs) || path.basename(abs) : abs;
  }

  private find(agent: string, turn: unknown): TurnRecord | undefined {
    return typeof turn === 'number' ? this.turns.get(agent)?.find((t) => t.id === turn) : undefined;
  }

  /** FR-004: what an undo of `turn` would do, with short diffs and the files changed since (conflicts). */
  preview(agent: string, turn: unknown): Preview | { ok: false; error: string } {
    const t = this.find(agent, turn);
    if (!t || !t.ended) return { ok: false, error: 'These changes can no longer be undone (only the last turns are kept, while Agent Durbar runs).' };
    const files: PreviewFile[] = [];
    const conflicts: string[] = [];
    for (const f of t.files.values()) {
      const now = stateOf(f.abs);
      if (now !== f.after) conflicts.push(f.rel);
      const action: PreviewFile['action'] = !f.existed ? 'remove' : now === MISSING ? 'create' : 'restore';
      const entry: PreviewFile = { path: f.rel, action };
      try {
        const before = f.blob ? fs.readFileSync(f.blob) : Buffer.alloc(0);
        const cur = now !== MISSING && now !== LINK ? fs.readFileSync(f.abs) : Buffer.alloc(0);
        if (looksBinary(before) || looksBinary(cur)) entry.binary = true;
        else if (before.length + cur.length <= 2 * 1024 * 1024) {
          const d = simpleDiff(f.rel, cur.toString('utf8'), before.toString('utf8'));
          if (d) entry.diff = d;
        }
      } catch {
        /* no diff */
      }
      files.push(entry);
    }
    return { ok: true, turn: t.id, files, conflicts, notCovered: t.notCovered.map((n) => ({ path: this.relOf(t, n.path), why: n.why })) };
  }

  /**
   * FR-004: put the files of `turn` back. Refuses when any of them changed since the turn ended. Copies the current files first
   * (a new `undo` checkpoint, so the restore can itself be undone), then writes each file atomically or removes a created file.
   */
  undo(agent: string, turn: unknown): UndoResult {
    const p = this.preview(agent, turn);
    if (!p.ok) return { ok: false, error: p.error };
    if (p.conflicts.length) return { ok: false, error: 'Some of these files changed after that turn, so nothing was restored.', conflicts: p.conflicts };
    const t = this.find(agent, turn) as TurnRecord;
    // containment again, now (the copy-time check is not enough: a parent may have become a link to somewhere outside)
    const unsafe = [...t.files.values()].filter((f) => unsafeTarget(t.roots, f.abs)).map((f) => f.rel);
    if (unsafe.length) return { ok: false, error: 'A folder on the way to some of these files changed (for example it is now a link), so nothing was restored.', conflicts: unsafe };
    if (this.open.has(agent)) this.endTurn(agent);
    const back = this.newTurn(agent, t.roots, 'undo');
    for (const f of t.files.values()) this.capture(agent, t.roots, f.abs);
    if (back.notCovered.length) {
      // the current files could not all be copied (too large now): do not restore what could not be undone again
      this.open.delete(agent);
      fs.rmSync(back.dir, { recursive: true, force: true });
      return { ok: false, error: 'The current files are too large to keep a copy, so nothing was restored.' };
    }
    let restored = 0, removed = 0, created = 0;
    try {
      for (const f of t.files.values()) {
        // checked again right before each change, so a swap during the undo is caught too
        const why = unsafeTarget(t.roots, f.abs);
        if (why) throw new Error(`${f.rel}: ${why}`);
        if (!f.existed) {
          const st = fs.lstatSync(f.abs);
          if (st.isFile()) fs.unlinkSync(f.abs);
          removed++;
          continue;
        }
        const data = f.blob ? fs.readFileSync(f.blob) : Buffer.alloc(0);
        const dir = path.dirname(f.abs);
        const wasMissing = stateOf(f.abs) === MISSING;
        makeParents(t.roots, dir);
        if (unsafeTarget(t.roots, f.abs)) throw new Error(`${f.rel}: its folder changed during the undo`);
        const tmp = path.join(dir, `.${path.basename(f.abs)}.durbar-${randomBytes(6).toString('hex')}`);
        fs.writeFileSync(tmp, data, { mode: f.mode, flag: 'wx' });
        fs.chmodSync(tmp, f.mode);
        fs.renameSync(tmp, f.abs);
        if (wasMissing) created++;
        else restored++;
      }
    } catch (e) {
      // stopped part way (a path changed during the undo): what was already restored can be undone again from the new checkpoint
      this.endTurn(agent);
      const done = restored + removed + created;
      return { ok: false, error: `The undo stopped${done ? ` after ${done} file${done === 1 ? '' : 's'}` : ''}: ${e instanceof Error ? e.message : String(e)}. Nothing outside the session’s folders was touched.` };
    } finally {
      if (this.open.has(agent)) this.endTurn(agent);
    }
    const recs = this.turns.get(agent) ?? [];
    const u = recs.find((x) => x.id === back.id);
    return { ok: true, restored, removed, created, undo: u ? this.summary(u) : { turn: back.id, kind: 'undo', files: [], notCovered: [] } };
  }

  /** FR-006: a removed session's copies go. */
  forget(agent: string): void {
    this.open.delete(agent);
    for (const t of this.turns.get(agent) ?? []) fs.rmSync(t.dir, { recursive: true, force: true });
    this.turns.delete(agent);
  }

  private prune(agent: string): void {
    const list = this.turns.get(agent) ?? [];
    while (list.length > this.limits.turnsPerSession) {
      const old = list.shift() as TurnRecord;
      fs.rmSync(old.dir, { recursive: true, force: true });
    }
    // total cap: drop the oldest turns of any session
    const all = [...this.turns.entries()].flatMap(([a, ts]) => ts.map((t) => ({ a, t })));
    let total = all.reduce((s, x) => s + x.t.bytes, 0);
    all.sort((x, y) => x.t.id - y.t.id);
    for (const { a, t } of all) {
      if (total <= this.limits.totalBytes) break;
      const ts = this.turns.get(a) ?? [];
      ts.splice(ts.indexOf(t), 1);
      fs.rmSync(t.dir, { recursive: true, force: true });
      total -= t.bytes;
    }
  }
}
