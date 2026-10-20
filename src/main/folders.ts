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
  /** Which agent kind restores this folder (spec 012 FR-042). Absent means `copilot`; it is never written for Copilot. */
  adapterId?: string;
  /** Display name of the room (spec 006 FR-018); absent = the folder's own name. */
  label?: string;
  /** Custom agent preselected for this folder's new sessions (spec 043 FR-009): only the agent's id. */
  defaultAgent?: string;
  /** The folder's last used session (spec 006 FR-020): continued after a restart. An id and its harness, never content. */
  lastSession?: { id: string; adapterId?: string };
  /** Spec 052 FR-088: every session open in this folder that got a message (oldest first, at most 6), restored after a restart. Ids and harness only. Absent in files written before; then `lastSession` alone is restored. */
  openSessions?: Array<{ id: string; adapterId?: string }>;
}

export const DEFAULT_ADAPTER = 'copilot';

/** The adapter id of a saved folder; `copilot` when none is saved. */
export function adapterOf(f: Pick<SavedFolder, 'adapterId'>): string {
  return f.adapterId ?? DEFAULT_ADAPTER;
}

// Same shape as the registry's id rule (src/adapters/registry.ts); copied so the store imports no adapter code.
const ADAPTER_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** A well-formed id other than `copilot` is kept as saved (even one this build does not know); anything else is `undefined` (Copilot). */
export function parseAdapterId(v: unknown): string | undefined {
  return typeof v === 'string' && ADAPTER_ID.test(v) && v !== DEFAULT_ADAPTER ? v : undefined;
}

/**
 * The saved mode comes back exactly as saved, Allow all included (spec 003 FR-025, no silent downgrade).
 * `restored` is true for Allow all so the UI can show a small "restored" note (FR-026). It is never saved.
 */
export function restoreMode(saved: SavedPermMode): { mode: SavedPermMode; restored: boolean } {
  return { mode: saved, restored: saved === 'allow' };
}

export const MAX_LABEL = 40;

/** A folder display name (spec 006 FR-018): trimmed, 1 to 40 characters, no control characters; anything else is `undefined` (the folder's own name). */
export function parseLabel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  return t && [...t].length <= MAX_LABEL && !/[\u0000-\u001f\u007f]/.test(t) ? t : undefined;
}

/** The id rule of `agents:selectProfile` (spec 043 FR-003). */
export const PROFILE_ID = /^[A-Za-z0-9._:@/-]{1,100}$/;

/** A saved default agent id (spec 043 FR-009); anything else is `undefined` (no default). */
export function parseDefaultAgent(v: unknown): string | undefined {
  return typeof v === 'string' && PROFILE_ID.test(v) ? v : undefined;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

/** A saved last session (spec 006 FR-020); anything malformed is `undefined` (the folder starts fresh, as before). */
export function parseLastSession(v: unknown): SavedFolder['lastSession'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !SESSION_ID.test(o.id)) return undefined;
  const adapterId = parseAdapterId(o.adapterId);
  return adapterId ? { id: o.id, adapterId } : { id: o.id };
}

/** Spec 052 FR-088: how many open sessions per folder come back after a restart. */
export const MAX_OPEN_SESSIONS = 6;

/** A saved open-session list: well-formed entries only, duplicates dropped, the newest 6 kept; empty or malformed is `undefined`. */
export function parseOpenSessions(v: unknown): SavedFolder['openSessions'] {
  if (!Array.isArray(v)) return undefined;
  const out: NonNullable<SavedFolder['openSessions']> = [];
  for (const e of v.slice(-100)) {
    const s = parseLastSession(e);
    if (s && !out.some((x) => x.id === s.id)) out.push(s);
  }
  const kept = out.slice(-MAX_OPEN_SESSIONS);
  return kept.length ? kept : undefined;
}

/** The sessions a saved folder brings back (FR-088): its last session first, then the other open ones in the order they were opened. Older files have only `lastSession`. */
export function sessionsToRestore(f: Pick<SavedFolder, 'lastSession' | 'openSessions'>): Array<{ id: string; adapterId?: string }> {
  const out = f.lastSession ? [{ ...f.lastSession }] : [];
  for (const s of f.openSessions ?? []) if (!out.some((x) => x.id === s.id)) out.push({ ...s });
  return out.slice(0, MAX_OPEN_SESSIONS);
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
      adapterId: parseAdapterId(o.adapterId),
      ...(parseLabel(o.label) ? { label: parseLabel(o.label) } : {}), // only when set, so older files read back unchanged
      ...(parseDefaultAgent(o.defaultAgent) ? { defaultAgent: parseDefaultAgent(o.defaultAgent) } : {}),
      ...(parseLastSession(o.lastSession) ? { lastSession: parseLastSession(o.lastSession) } : {}),
      ...(parseOpenSessions(o.openSessions) ? { openSessions: parseOpenSessions(o.openSessions) } : {}),
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

  /** Adds the folder, or refreshes its mode/model when it is already saved (the hidden flag is kept), and its adapter when a valid `adapterId` (or `'copilot'`) is given. */
  upsert(entry: Omit<SavedFolder, 'hidden'> & { hidden?: boolean }): void {
    const cur = this.get(entry.workspace);
    if (cur) {
      Object.assign(cur, { permMode: entry.permMode, model: entry.model, effort: entry.effort, contextTier: parseTier(entry.contextTier), maxAiCredits: parseCap(entry.maxAiCredits) });
      if (entry.adapterId === DEFAULT_ADAPTER || parseAdapterId(entry.adapterId) !== undefined) cur.adapterId = parseAdapterId(entry.adapterId);
    } else {
      // A new folder goes to the requested floor (unknown -> ground), which becomes the default for the next one (FR-006).
      const floor = floorOps.floorOf(entry.floor, this.floorsDoc);
      this.folders.push({ ...entry, permMode: entry.permMode, hidden: entry.hidden === true, floor: floor === floorOps.GROUND ? undefined : floor, adapterId: parseAdapterId(entry.adapterId) });
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

  /** Remember which agent kind this folder uses (spec 012 FR-044). `copilot` clears the field; a malformed id is refused. */
  setAdapterId(workspace: string, id: unknown): boolean {
    const cur = this.get(workspace);
    if (!cur || (id !== DEFAULT_ADAPTER && parseAdapterId(id) === undefined)) return false;
    cur.adapterId = parseAdapterId(id);
    this.save();
    return true;
  }

  /** Sets the folder's display name (FR-018); an empty or invalid name clears it. Returns the saved label, or false for an unknown folder. */
  setLabel(workspace: string, label: unknown): { label: string | undefined } | false {
    const cur = this.get(workspace);
    if (!cur) return false;
    cur.label = parseLabel(label);
    this.save();
    return { label: cur.label };
  }

  /** Sets (a valid id) or clears (`null`) the folder's default agent (spec 043 FR-009); false for an unknown folder or a bad id. */
  setDefaultAgent(workspace: string, profileId: unknown): { defaultAgent: string | undefined } | false {
    const cur = this.get(workspace);
    if (!cur || (profileId !== null && !parseDefaultAgent(profileId))) return false;
    cur.defaultAgent = profileId === null ? undefined : parseDefaultAgent(profileId);
    this.save();
    return { defaultAgent: cur.defaultAgent };
  }

  /** Records the folder's last used session (FR-020); written only when it changes. `copilot` is not written, as for `adapterId`. */
  setLastSession(workspace: string, id: string, adapterId: string | undefined): boolean {
    const cur = this.get(workspace);
    const next = parseLastSession({ id, adapterId });
    if (!cur || !next) return false;
    if (cur.lastSession?.id === next.id && cur.lastSession?.adapterId === next.adapterId) return true;
    cur.lastSession = next;
    this.save();
    return true;
  }

  /** Forgets the last session when it is that one (FR-020: the session was removed from the folder). */
  clearLastSession(workspace: string, id: string): void {
    const cur = this.get(workspace);
    if (!cur || cur.lastSession?.id !== id) return;
    cur.lastSession = undefined;
    this.save();
  }

  /** Spec 052 FR-088: the session is open in this folder (it got a message, or was resumed). Written only when new; past 6 the oldest one other than the last session is dropped. */
  addOpenSession(workspace: string, id: string, adapterId: string | undefined): boolean {
    const cur = this.get(workspace);
    const next = parseLastSession({ id, adapterId });
    if (!cur || !next) return false;
    const list = cur.openSessions ?? [];
    const at = list.findIndex((x) => x.id === next.id);
    if (at >= 0 && list[at].adapterId === next.adapterId) return true;
    const out = list.filter((x) => x.id !== next.id);
    out.push(next);
    while (out.length > MAX_OPEN_SESSIONS) {
      const drop = out.findIndex((x) => x.id !== cur.lastSession?.id);
      out.splice(drop < 0 ? 0 : drop, 1);
    }
    cur.openSessions = out;
    this.save();
    return true;
  }

  /** FR-088: the session left the folder (Remove from office, replaced by a resumed one); it is not restored any more. Also forgets it as the last session. */
  removeOpenSession(workspace: string, id: string): void {
    const cur = this.get(workspace);
    if (!cur) return;
    const list = cur.openSessions ?? [];
    const out = list.filter((x) => x.id !== id);
    const wasLast = cur.lastSession?.id === id;
    if (out.length === list.length && !wasLast) return;
    cur.openSessions = out.length ? out : undefined;
    if (wasLast) cur.lastSession = undefined;
    this.save();
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
