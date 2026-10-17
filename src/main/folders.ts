/**
 * The saved folder list (which folders/workspaces are in the office, with their permission mode and
 * hidden flag), kept as one small JSON file in the app's userData folder. No tokens, no chat content, no paths
 * other than the folders the user added. Tolerant: a missing or corrupt file means an empty list.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCap } from '../shared/credits';
import { parseTier } from '../shared/modelswitch';
import type { ContextTier } from '../shared/modelswitch';
import * as floorOps from '../shared/floors';
import type { FloorOp, FloorsDoc } from '../shared/floors';

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
  /** Context tier chosen for this folder's sessions (spec 030); absent = the model's default. Only ever our own choice, never Copilot's settings. */
  contextTier?: ContextTier;
  /** Per-session credit cap (AIU) for this folder's sessions (spec 011); a plain number. */
  maxAiCredits?: number;
  /** Floor id (spec 033). Absent = the ground floor; never written for it. */
  floor?: string;
}

/**
 * The saved mode comes back exactly as saved, Allow all included (spec 003 FR-025, no silent downgrade).
 * `restored` is true for Allow all so the UI can show a small "restored" note (FR-026). It is never saved.
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
      contextTier: parseTier(o.contextTier),
      maxAiCredits: parseCap(o.maxAiCredits),
      floor: typeof o.floor === 'string' && o.floor !== floorOps.GROUND && o.floor.length <= 20 ? o.floor : undefined,
    });
    if (out.length >= MAX_FOLDERS) break;
  }
  return out;
}

/** The floors part of the file (spec 033): a file without it means one ground floor, on, holding every folder. */
export function parseSavedFloors(text: string): FloorsDoc {
  try {
    const doc = JSON.parse(text) as { floors?: unknown; lastFloor?: unknown } | null;
    return doc && typeof doc === 'object' ? floorOps.parseFloors(doc.floors, doc.lastFloor) : floorOps.defaultFloors();
  } catch {
    return floorOps.defaultFloors();
  }
}

export class FolderStore {
  private folders: SavedFolder[] = [];
  private floorsDoc: FloorsDoc = floorOps.defaultFloors();
  constructor(private readonly file: string) {}

  load(): SavedFolder[] {
    try {
      const text = fs.readFileSync(this.file, 'utf8');
      this.folders = parseSavedFolders(text);
      this.floorsDoc = parseSavedFloors(text);
    } catch {
      this.folders = [];
      this.floorsDoc = floorOps.defaultFloors();
    }
    // A folder pointing at a floor that is gone is on the ground floor (FR-014).
    for (const f of this.folders) if (f.floor && floorOps.floorOf(f.floor, this.floorsDoc) === floorOps.GROUND) f.floor = undefined;
    return this.list();
  }

  /** A copy of the floors and the default floor for the next added folder. */
  floors(): FloorsDoc {
    return { floors: this.floorsDoc.floors.map((f) => ({ ...f })), lastFloor: this.floorsDoc.lastFloor };
  }

  /** The floor a saved folder is on (ground for unknown folders). */
  floorOfFolder(workspace: string): string {
    return floorOps.floorOf(this.get(workspace)?.floor, this.floorsDoc);
  }

  createFloor(name: unknown): FloorOp {
    return this.applyFloors(floorOps.createFloor(this.floorsDoc, name));
  }

  renameFloor(id: unknown, name: unknown): FloorOp {
    return this.applyFloors(floorOps.renameFloor(this.floorsDoc, id, name));
  }

  reorderFloors(ids: unknown): FloorOp {
    return this.applyFloors(floorOps.reorderFloors(this.floorsDoc, ids));
  }

  /** Deletes the floor and, in the same write, moves its folders back to the ground floor. */
  deleteFloor(id: unknown): FloorOp {
    const r = floorOps.deleteFloor(this.floorsDoc, id);
    if (r.ok) for (const f of this.folders) if (f.floor === id) f.floor = undefined;
    return this.applyFloors(r);
  }

  setFloorOn(id: unknown, on: unknown): FloorOp {
    return this.applyFloors(floorOps.setFloorOn(this.floorsDoc, id, on));
  }

  onlyFloor(id: unknown): FloorOp {
    return this.applyFloors(floorOps.onlyFloor(this.floorsDoc, id));
  }

  /** Moves a saved folder to a floor. Nothing else about the folder changes (FR-005). */
  moveFolder(workspace: string, floorId: unknown): boolean {
    const cur = this.get(workspace);
    if (!cur || typeof floorId !== 'string' || floorOps.floorOf(floorId, this.floorsDoc) !== floorId) return false;
    cur.floor = floorId === floorOps.GROUND ? undefined : floorId;
    this.save();
    return true;
  }

  private applyFloors(r: FloorOp): FloorOp {
    if (r.ok) {
      this.floorsDoc = r.doc;
      this.save();
    }
    return { ...r, doc: this.floors() } as FloorOp;
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
    if (cur) Object.assign(cur, { permMode: entry.permMode, model: entry.model, effort: entry.effort, contextTier: parseTier(entry.contextTier), maxAiCredits: parseCap(entry.maxAiCredits) });
    else {
      // A new folder goes to the requested floor (unknown -> ground), which becomes the default for the next one (FR-006).
      const floor = floorOps.floorOf(entry.floor, this.floorsDoc);
      this.folders.push({ ...entry, permMode: entry.permMode, hidden: entry.hidden === true, floor: floor === floorOps.GROUND ? undefined : floor });
      if (entry.floor !== undefined) this.floorsDoc = { ...this.floorsDoc, lastFloor: floor };
    }
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

  /** Remember the model choice of an applied switch (spec 030): the model, the effort (`null` clears it, `undefined` keeps it) and the tier (`undefined` = default). Saved in this app's own file only. */
  setModelChoice(workspace: string, choice: { model: string; effort?: string | null; contextTier?: ContextTier }): boolean {
    const cur = this.get(workspace);
    if (!cur || !choice.model || choice.model.length > 100) return false;
    cur.model = choice.model;
    if (choice.effort === null) cur.effort = undefined;
    else if (choice.effort !== undefined) cur.effort = EFFORTS.has(choice.effort) ? choice.effort : cur.effort;
    const t = parseTier(choice.contextTier);
    cur.contextTier = t === 'long' ? 'long' : undefined;
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
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, floors: this.floorsDoc.floors, lastFloor: this.floorsDoc.lastFloor, folders: this.folders }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {
      /* read-only profile, disk full, ...: keep working without persistence */
    }
  }
}
