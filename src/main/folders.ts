/**
 * The saved folder list (which folders/workspaces are in the office, with their permission mode and
 * hidden flag), kept as one small JSON file in the app's userData folder. No tokens, no chat content, no paths
 * other than the folders the user added. Tolerant: a missing or corrupt file means an empty list.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCap } from '../shared/credits';

export type SavedPermMode = 'read-only' | 'ask' | 'allow';

export interface SavedFolder {
  /** Folder path, or the .code-workspace file for a multi-root workspace. */
  workspace: string;
  permMode: SavedPermMode;
  hidden: boolean;
  /** The room's door is closed in the office (spec 017). */
  closed?: boolean;
  model?: string;
  effort?: string;
  /** Per-session credit cap (AIU) for this folder's sessions (spec 011); a plain number. */
  maxAiCredits?: number;
}

/**
 * The saved mode comes back exactly as saved, Allow edits included (spec 003 FR-025, no silent downgrade).
 * `restored` is true for Allow edits so the UI can show a small "restored" note (FR-026). It is never saved.
 */
export function restoreMode(saved: SavedPermMode): { mode: SavedPermMode; restored: boolean } {
  return { mode: saved, restored: saved === 'allow' };
}

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MAX_FOLDERS = 200;

/** Parse the file text; unknown shapes and bad entries are dropped, duplicates collapsed. */
export function parseSavedFolders(text: string): SavedFolder[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const list = doc && typeof doc === 'object' && Array.isArray((doc as { folders?: unknown }).folders) ? (doc as { folders: unknown[] }).folders : [];
  const out: SavedFolder[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.workspace !== 'string' || !o.workspace || o.workspace.length > 4096 || !path.isAbsolute(o.workspace) || seen.has(o.workspace)) continue;
    seen.add(o.workspace);
    out.push({
      workspace: o.workspace,
      permMode: o.permMode === 'ask' || o.permMode === 'allow' ? o.permMode : 'read-only',
      hidden: o.hidden === true,
      closed: o.closed === true ? true : undefined,
      model: typeof o.model === 'string' && o.model.length <= 100 ? o.model : undefined,
      effort: typeof o.effort === 'string' && EFFORTS.has(o.effort) ? o.effort : undefined,
      maxAiCredits: parseCap(o.maxAiCredits),
    });
    if (out.length >= MAX_FOLDERS) break;
  }
  return out;
}

export class FolderStore {
  private folders: SavedFolder[] = [];
  constructor(private readonly file: string) {}

  load(): SavedFolder[] {
    try {
      this.folders = parseSavedFolders(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.folders = [];
    }
    return this.list();
  }

  list(): SavedFolder[] {
    return this.folders.map((f) => ({ ...f }));
  }

  get(workspace: string): SavedFolder | undefined {
    return this.folders.find((f) => f.workspace === workspace);
  }

  /** Adds the folder, or refreshes its mode/model when it is already saved (the hidden flag is kept). */
  upsert(entry: Omit<SavedFolder, 'hidden'> & { hidden?: boolean }): void {
    const cur = this.get(entry.workspace);
    if (cur) Object.assign(cur, { permMode: entry.permMode, model: entry.model, effort: entry.effort, maxAiCredits: parseCap(entry.maxAiCredits) });
    else this.folders.push({ ...entry, permMode: entry.permMode, hidden: entry.hidden === true });
    this.save();
  }

  setHidden(workspace: string, hidden: boolean): boolean {
    const cur = this.get(workspace);
    if (!cur) return false;
    cur.hidden = hidden;
    this.save();
    return true;
  }

  /** Remember the credit cap for this folder (undefined/invalid = no cap). */
  setMaxAiCredits(workspace: string, cap: unknown): boolean {
    const cur = this.get(workspace);
    if (!cur) return false;
    cur.maxAiCredits = parseCap(cap);
    this.save();
    return true;
  }

  setClosed(workspace: string, closed: boolean): boolean {
    const cur = this.get(workspace);
    if (!cur) return false;
    cur.closed = closed ? true : undefined;
    this.save();
    return true;
  }

  /** Remember the permission mode chosen for this folder (used when the agent is restored on the next start). */
  setPermMode(workspace: string, permMode: SavedPermMode): boolean {
    const cur = this.get(workspace);
    if (!cur) return false;
    cur.permMode = permMode;
    this.save();
    return true;
  }

  remove(workspace: string): boolean {
    const n = this.folders.length;
    this.folders = this.folders.filter((f) => f.workspace !== workspace);
    if (this.folders.length === n) return false;
    this.save();
    return true;
  }

  /** Write atomically (temp file + rename). A failure is swallowed: the list just is not remembered. */
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, folders: this.folders }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {
      /* read-only profile, disk full, ...: keep working without persistence */
    }
  }
}
