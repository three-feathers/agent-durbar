/**
 * What the notes IPC channels do (spec 083 FR-009, FR-062, issue 699), without Electron so it is unit tested: every argument from the
 * window is validated here, the folder and the session are found from the agent id (never from the window), the known secret values
 * of the folder and the session are collected for the mask (FR-005), and the store does the rest. No note text, title, session id or
 * secret value is ever logged; a refusal is a short fixed reason.
 */
import { createHash } from 'crypto';
import type { AgentInfo } from '../shared/api';
import { NOTES_LIMITS, NOTE_ID_RE, rawDigestInput } from '../shared/notes';
import type { NoteSource } from '../shared/notes';
import { sessionIdOk } from '../shared/sessionid';
import { folderKeyOf, folderNameOf } from '../shared/usagedoc';
import type { NotesStore, NotesView, NotesWrote } from './notesstore';
import type { NotesExport, NotesFail, NotesFileCount, NotesFileState, NotesFileSwitch, NotesSetFile } from '../shared/notes';
import { syncNotesFile, type NotesFile } from './notesfile';
import { writeNotesMd } from '../shared/notesmd';
import { exportDialogOptions, writeNotesExport, type ExportDialogOptions, type NotesExportOptions } from './notesexport';

export interface NotesOpsDeps {
  agents: Map<string, AgentInfo>;
  /** Created when the app is ready: read when a call runs. */
  store(): NotesStore | undefined;
  /** The session a message belongs to (`resumeIdFor` in main). */
  resumeIdFor(agentId: string): string;
  /** The agent app of an agent (`copilot`, `claude`, `codex`, ...). */
  adapterIdOf(agentId: string): string | undefined;
  /** The secret values stored for the folder's MCP extras (`extraSecretValues`). */
  folderValues(folderKey: string): readonly string[];
  /** The secret values the session was given (`secretValuesFor`). */
  sessionValues(agentId: string): readonly string[];
  now?(): Date;
  /** The project-file mirror (T041, FR-053, FR-054). Absent: never used. */
  file?(): NotesFile | undefined;
  /**
   * Whether a folder's project-file switch is on (FR-050; `notesFile` in folders.json, T042). Absent or false: nothing reads,
   * stats or writes the folder's `.durbar/notes.md`.
   */
  fileOn?(folderKey: string): boolean;
  /** Saves the switch (`notesFile` in folders.json, T042); false when it could not be saved. Absent: the switch cannot be turned. */
  setFileOn?(folderKey: string, on: boolean): boolean;
  /**
   * True while some secret value Durbar may hold is still locked in the vault (main: `!mcpStore.noPrompt()`): the mask would be
   * incomplete, so no project-file cycle runs (review of PR 931). Absent: never pending.
   */
  valuesPending?(folderKey: string): boolean;
  /**
   * A native confirmation the page cannot answer (Cancel is the default; `nativeConfirm` in main), before the switch is turned on,
   * before *Delete the file* (review of PR 931, Q2), before *Delete all* and before a removed folder's notes are deleted (T034b, with
   * the count of notes). Absent: all are refused.
   */
  confirmNative?(kind: NativeKind, folderName: string, count?: number): Promise<boolean>;
  /**
   * FR-048 (T034b): main's save dialog (`dialog.showSaveDialog`); the chosen path, or `undefined` when cancelled. Absent: *Export…*
   * is not available. The window never sends a path.
   */
  saveDialog?(opts: ExportDialogOptions): Promise<string | undefined>;
  /** Options for writing the export (tests inject an `fs`). */
  exportOpts?: NotesExportOptions;
  setTimer?(fn: () => void, ms: number): unknown;
}

/** FR-050 (T042): the reasons the switch is refused or greyed; short fixed texts, never a path. */
export const SWITCH_WORKSPACE = 'The project file is not offered for a VS Code workspace.';
export const SWITCH_MISSING = 'The folder is not there, so Durbar cannot keep .durbar/notes.md in it.';
export const SWITCH_ALREADY_OFF = 'The switch is already off; Durbar does not touch .durbar/notes.md while it is off.';
export const VALUES_PENDING = 'Waiting for the secret store to unlock (it unlocks when a session with MCP extras starts); notes.md is not updated until then.';
export const VALUES_PENDING_ON = 'A secret value is still locked in the secret store, so Durbar cannot mask the file yet; the switch stays off. Start a session that uses MCP extras, then try again.';
export const NATIVE_CANCELLED = 'Cancelled: nothing changed.';
export const DELETE_LEFTOVER = 'A temp file from a crash (.notes.md.*.tmp) may remain in .durbar.';
export const SWITCH_UNSAVED = 'Could not save the choice in the folder list.';
export const EXCLUDE_KEPT = 'The .durbar/ line in .git/info/exclude stays (it is harmless).';

/** What a native confirmation is for (`confirmNative`). */
export type NativeKind = 'on' | 'delete' | 'deleteAll' | 'forget';
/** FR-048 (T034b): short fixed texts, never a path. */
export const EXPORT_NONE = 'There are no notes to export.';
export const EXPORT_PENDING = 'A secret value is still locked in the secret store, so Durbar cannot mask the export yet. Start a session that uses MCP extras, then try again.';
export const EXPORT_UNAVAILABLE = 'Export is not available.';
export const DELETE_ALL_NONE = 'There are no notes to delete.';

/** The words of each native confirmation (`nativeConfirm` in main): pure, so the texts are tested. The folder's name, never a path. */
export function notesConfirmText(kind: NativeKind, name: string, count?: number): { ok: string; message: string; detail: string } {
  const n = typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
  const notes = n === 1 ? '1 note' : `${n} notes`;
  if (kind === 'on') return { ok: 'Turn on', message: `Keep the notes of ${name} in the project?`, detail: 'Durbar will write .durbar/notes.md in this folder. It may get committed and pushed with your code.' };
  if (kind === 'delete') return { ok: 'Delete the file', message: `Delete .durbar/notes.md in ${name}?`, detail: 'Durbar deletes it only if it holds exactly what Durbar would write.' };
  if (kind === 'deleteAll') return { ok: 'Delete all', message: `Delete all ${notes} of ${name}?`, detail: 'They are deleted from this computer. This cannot be undone.' };
  return { ok: 'Remove and delete notes', message: n ? `Remove ${name} and delete its ${notes}?` : `Remove ${name} and delete its notes?`, detail: 'The notes are deleted from this computer. .durbar/notes.md in the project is not touched.' };
}

/** FR-053: at most one project-file write per folder in this time. */
const FILE_EVERY_MS = 500;

type Refusal = { ok: false; code: 'invalid'; error: string };
const refuse = (error: string): Refusal => ({ ok: false, code: 'invalid', error });
const REMOVE_KEPT = 'Durbar did not delete .durbar/notes.md.';

/** FR-009: the first 16 hex characters of SHA-256 of the message text with `\r\n` turned into `\n` and the ends trimmed. */
export function digestOf(raw: string): string {
  return createHash('sha256').update(rawDigestInput(raw), 'utf8').digest('hex').slice(0, 16);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export class NotesOps {
  private readonly cycles = new Map<string, Promise<NotesFileState | undefined>>();
  private readonly timers = new Set<string>();
  /** Per folder: the last `setFile` call, so calls run one at a time (T042 review). */
  private readonly switching = new Map<string, Promise<unknown>>();

  constructor(private readonly d: NotesOpsDeps) {}

  /** The folder path the project file belongs to, only while its switch is on and it is a plain folder (no `.code-workspace`, FR-050). */
  private fileTarget(a: AgentInfo, key: string): { file: NotesFile; folderPath: string } | undefined {
    if (a.workspaceFile || !this.d.fileOn || !this.d.file) return undefined;
    let on = false;
    try { on = this.d.fileOn(key) === true; } catch { on = false; }
    if (!on) return undefined;
    const file = this.d.file();
    return file ? { file, folderPath: a.cwd } : undefined;
  }

  /**
   * One mirror cycle for the folder (FR-053, FR-054), one at a time per folder; `undefined` while the switch is off. A cycle whose
   * rename found the file changed runs once more after 500 ms (`retries`), so the outside edit is imported, then written.
   */
  syncFile(agentId: unknown, retries = 1, create = false): Promise<NotesFileState | undefined> {
    const t = this.target(agentId);
    if ('ok' in t) return Promise.resolve(undefined);
    const ft = this.fileTarget(t.a, t.key);
    if (!ft) return Promise.resolve(undefined);
    const prev = this.cycles.get(t.key) ?? Promise.resolve(undefined);
    const run = prev.then(async (): Promise<NotesFileState | undefined> => {
      if (!this.fileTarget(t.a, t.key)) return undefined; // turned off while this cycle waited its turn (T042): it writes nothing
      let pending = false;
      try { pending = this.d.valuesPending?.(t.key) === true; } catch { pending = true; }
      if (pending) return { error: VALUES_PENDING }; // review of PR 931: an incomplete mask would un-mask the shared file
      const r = await syncNotesFile({ file: ft.file, store: t.store, folderKey: t.key, folderName: t.name, folderPath: ft.folderPath, values: this.fileValues(t.key), now: this.d.now, create });
      if (r.retry && retries > 0) this.schedule(t.a.id, t.key, retries - 1);
      return r.state;
    }).catch((): NotesFileState => ({ error: 'Could not write .durbar/notes.md: ERROR' }));
    this.cycles.set(t.key, run);
    return run;
  }

  /** After a change: one cycle within 500 ms (changes in between share it). */
  private schedule(agentId: string, key: string, retries = 1): void {
    if (this.timers.has(key)) return;
    this.timers.add(key);
    const fire = (): void => { this.timers.delete(key); void this.syncFile(agentId, retries); };
    (this.d.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)))(fire, FILE_EVERY_MS);
  }

  /** A change reached the store: the folder's project file follows while its switch is on. */
  private changed<T extends { ok: boolean }>(agentId: unknown, r: T): T {
    if (!r.ok) return r;
    const t = this.target(agentId);
    if (!('ok' in t) && this.fileTarget(t.a, t.key)) this.schedule(t.a.id, t.key);
    return r;
  }

  private target(agentId: unknown): { a: AgentInfo; store: NotesStore; key: string; name: string } | Refusal {
    const a = typeof agentId === 'string' && agentId.length <= 200 ? this.d.agents.get(agentId) : undefined;
    if (!a) return refuse('That chat is not open.');
    const store = this.d.store();
    if (!store) return refuse('Notes are not available.');
    const key = folderKeyOf(a);
    return { a, store, key, name: folderNameOf(a) };
  }

  /** The folder's values and, when a session is given, its values too (an import or a typed note passes none). */
  private values(key: string, agentId?: string): string[] {
    let vs: readonly string[] = [];
    try { vs = this.d.folderValues(key); } catch { /* store not ready: the shape mask still runs */ }
    let ss: readonly string[] = [];
    if (agentId) { try { ss = this.d.sessionValues(agentId); } catch { /* same */ } }
    return [...new Set([...vs, ...ss])];
  }

  /**
   * The values the project file is masked with (review of PR 931): the folder's and the session values of EVERY open chat of the folder
   * (`sessionValues` also covers the user-wide MCP list), sorted, so the output does not depend on which chat asked.
   */
  private fileValues(key: string): string[] {
    const out = new Set<string>();
    try { for (const v of this.d.folderValues(key)) out.add(v); } catch { /* the shape mask still runs */ }
    for (const a of this.d.agents.values()) {
      if (folderKeyOf(a) !== key) continue;
      try { for (const v of this.d.sessionValues(a.id)) out.add(v); } catch { /* same */ }
    }
    return [...out].sort((x, y) => y.length - x.length || (x < y ? -1 : x > y ? 1 : 0));
  }

  async list(agentId: unknown): Promise<NotesView | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    // FR-054: opening the drawer or the view reads an outside edit back (and writes) first, only while the switch is on
    const fileState = this.fileTarget(t.a, t.key) ? await this.syncFile(agentId) : undefined;
    const v = await t.store.list(t.key);
    if (!v.ok) return v;
    if (fileState) (v as { file?: NotesFileState }).file = fileState;
    const sw = this.switchOf(t.a, t.key);
    if (sw) (v as { fileSwitch?: NotesFileSwitch }).fileSwitch = sw;
    // the chat's own session (main's `resumeIdFor`, never the window's), so the drawer can put "This session" first (FR-021); '' when it is unusable
    const app = this.d.adapterIdOf(t.a.id) ?? t.a.adapterId ?? 'copilot';
    const sid = this.d.resumeIdFor(t.a.id);
    return { ...v, session: sessionIdOk(app, sid) ? sid : '' };
  }

  /** FR-009: the window sends the role, the message's place and the raw text; the app and the session are main's. */
  async save(agentId: unknown, input: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    if (!isObj(input)) return refuse('Nothing to save.');
    const { role, ord, text, from } = input;
    if (role !== 'user' && role !== 'agent') return refuse('Unknown message kind.');
    if (typeof ord !== 'number' || !Number.isInteger(ord) || ord < 0 || ord > NOTES_LIMITS.ordMax) return refuse('Unknown message place.');
    if (typeof text !== 'string' || !text.trim()) return refuse('The message is empty.');
    if (text.length > NOTES_LIMITS.inputChars) return refuse('That message is too long to save.');
    const kind = from === undefined ? role : from;
    if (kind !== 'agent' && kind !== 'user' && kind !== 'selection') return refuse('Unknown way of saving.');
    if ((kind === 'agent' && role !== 'agent') || (kind === 'user' && role !== 'user')) return refuse('Unknown way of saving.');
    const app = this.d.adapterIdOf(t.a.id) ?? t.a.adapterId ?? 'copilot';
    const session = this.d.resumeIdFor(t.a.id);
    const source: NoteSource | undefined = sessionIdOk(app, session)
      ? { app, session, role, ord, digest: digestOf(text), at: (this.d.now?.() ?? new Date()).toISOString() }
      : undefined; // no usable session yet: the note is kept without a link
    return this.changed(agentId, await t.store.save(t.key, t.name, { text, from: kind, source, values: this.values(t.key, t.a.id) }));
  }

  /** FR-012: a note typed by hand. */
  async add(agentId: unknown, input: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    if (!isObj(input) || typeof input.text !== 'string' || !input.text.trim()) return refuse('The note is empty.');
    if (input.text.length > NOTES_LIMITS.inputChars) return refuse('That note is too long.');
    return this.changed(agentId, await t.store.add(t.key, t.name, { text: input.text, from: 'typed', values: this.values(t.key) }));
  }

  async update(agentId: unknown, id: unknown, rev: unknown, patch: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    if (typeof id !== 'string' || !NOTE_ID_RE.test(id)) return refuse('Unknown note.');
    if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 1) return refuse('Unknown version of the note.');
    if (!isObj(patch)) return refuse('Nothing to change.');
    const { title, text, done } = patch;
    if (title === undefined && text === undefined && done === undefined) return refuse('Nothing to change.');
    if (title !== undefined && (typeof title !== 'string' || title.length > NOTES_LIMITS.titleInputChars)) return refuse('That title is not valid.');
    if (text !== undefined && (typeof text !== 'string' || text.length > NOTES_LIMITS.inputChars)) return refuse('That text is not valid.');
    if (done !== undefined && typeof done !== 'boolean') return refuse('Done is yes or no.');
    return this.changed(agentId, await t.store.update(t.key, t.name, id, rev, { title: title as string | undefined, text: text as string | undefined, done: done as boolean | undefined, values: this.values(t.key, t.a.id) }));
  }

  async remove(agentId: unknown, id: unknown, rev: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    if (typeof id !== 'string' || !NOTE_ID_RE.test(id)) return refuse('Unknown note.');
    if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 1) return refuse('Unknown version of the note.');
    return this.changed(agentId, await t.store.remove(t.key, t.name, id, rev));
  }

  /**
   * FR-048 (T034b): *Delete all…*. Main counts the folder's notes itself and asks a native confirmation the page cannot answer (Cancel
   * the default), then deletes them with a tombstone each (FR-008), so neither the project file nor another process brings them back.
   */
  async removeAll(agentId: unknown): Promise<(NotesWrote & { count?: number }) | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    const v = await t.store.list(t.key);
    if (!v.ok) return v;
    if (v.readOnly) return { ok: false, code: 'unreadable', error: v.readOnly };
    const count = v.notes.length;
    if (!count) return refuse(DELETE_ALL_NONE);
    if (!(await this.native('deleteAll', t.a, count))) return refuse(NATIVE_CANCELLED);
    const r = this.changed(agentId, await t.store.removeAll(t.key, t.name));
    return r.ok ? { ...r, count } : r;
  }

  /**
   * FR-048 (T034b): *Export…*. Main shows the save dialog (the window sends no path), then writes FR-052's format of every note, done
   * ones included, masked again with the CURRENT values exactly as the project file is (`fileValues`, `NotesFile.forFile`), so the
   * output never depends on which chat asked; refused while a secret value is still locked. No session id is written (`writeNotesMd`).
   */
  async export(agentId: unknown): Promise<NotesExport> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    const file = this.d.file?.();
    if (!this.d.saveDialog || !file) return refuse(EXPORT_UNAVAILABLE);
    const v = await t.store.list(t.key);
    if (!v.ok) return v;
    if (!v.notes.length) return refuse(EXPORT_NONE);
    let pending = false;
    try { pending = this.d.valuesPending?.(t.key) === true; } catch { pending = true; }
    if (pending) return refuse(EXPORT_PENDING); // an incomplete mask would un-mask the shared file (review of PR 931)
    let chosen: string | undefined;
    try { chosen = await this.d.saveDialog(exportDialogOptions(t.name)); } catch { return refuse(EXPORT_UNAVAILABLE); }
    if (typeof chosen !== 'string' || !chosen) return { ok: false, cancelled: true };
    // read again after the dialog (a note may have changed while it was open), then mask with the values known now
    const now = await t.store.list(t.key);
    if (!now.ok) return now;
    let pendingNow = false;
    try { pendingNow = this.d.valuesPending?.(t.key) === true; } catch { pendingNow = true; }
    if (pendingNow) return refuse(EXPORT_PENDING);
    const text = writeNotesMd(file.forFile(now.notes, this.fileValues(t.key)));
    const w = await writeNotesExport(chosen, text, this.d.exportOpts);
    if (!w.ok) return refuse(w.error);
    return { ok: true, count: now.notes.length, name: w.name };
  }

  /**
   * FR-048 (T034b): before a folder is removed with *Also delete its notes*: the folder's key and how many notes it has, after a native
   * confirmation when it has any (Cancel: nothing is removed). The folder is found from the agent id, never from the window.
   */
  async confirmForget(agentId: unknown): Promise<{ ok: true; key: string; count: number } | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    const v = await t.store.list(t.key);
    const count = v.ok ? v.notes.length : 0;
    if (v.ok && !count) return { ok: true, key: t.key, count };
    // an unreadable file holds notes too: it is confirmed like a folder with notes
    if (!(await this.native('forget', t.a, count))) return refuse(NATIVE_CANCELLED);
    return { ok: true, key: t.key, count };
  }

  /**
   * FR-048 (T034b): a removed folder's notes file is deleted, after a mirror cycle of the folder already running has finished (a queued
   * one finds the switch off with the folder gone and writes nothing). Only `<fingerprint(folderKey)>.json`; `.durbar/notes.md` and
   * `.git/info/exclude` in the project are never touched here.
   */
  async forget(folderKey: string): Promise<{ ok: true; deleted: boolean } | NotesFail | Refusal> {
    const store = this.d.store();
    if (!store) return refuse('Notes are not available.');
    for (let p = this.cycles.get(folderKey); p;) { await p.catch(() => undefined); const n = this.cycles.get(folderKey); if (n === p) break; p = n; }
    const r = await store.forget(folderKey);
    if (!r.ok) return r;
    this.cycles.delete(folderKey);
    return { ok: true, deleted: r.deleted };
  }

  /** FR-050 (T042): the switch as the screen shows it; `undefined` for a `.code-workspace` (not offered) or when the mirror is not wired. */
  private switchOf(a: AgentInfo, key: string): NotesFileSwitch | undefined {
    if (a.workspaceFile || !this.d.file || !this.d.setFileOn) return undefined;
    const file = this.d.file();
    if (!file) return undefined;
    let on = false;
    try { on = this.d.fileOn?.(key) === true; } catch { on = false; }
    return file.folderThere(a.cwd) ? { on } : { on, disabled: SWITCH_MISSING };
  }

  /** The folder a switch call acts on: a plain folder that is there, with the mirror wired. */
  private switchTarget(agentId: unknown): { a: AgentInfo; store: NotesStore; key: string; name: string; file: NotesFile } | Refusal {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    if (t.a.workspaceFile) return refuse(SWITCH_WORKSPACE);
    const file = this.d.file?.();
    if (!file || !this.d.setFileOn) return refuse('The project file is not available.');
    if (!file.folderThere(t.a.cwd)) return refuse(SWITCH_MISSING);
    return { ...t, file };
  }

  /** FR-050: how many notes an existing `notes.md` would add, and whether the folder is in a repository (the turn-on dialog only). */
  async fileCount(agentId: unknown): Promise<NotesFileCount | Refusal> {
    const t = this.switchTarget(agentId);
    if ('ok' in t) return t;
    const v = await t.store.list(t.key);
    if (!v.ok) return v;
    const c = t.file.count(t.a.cwd, new Set(v.notes.map((n) => n.id)));
    if (!c.ok) return refuse(c.error);
    return { ok: true, count: c.count, exists: c.exists, strayText: c.strayText, repo: t.file.inRepo(t.a.cwd) };
  }

  /**
   * FR-050, FR-055 (T042, reviews of PR 931): turn the folder's project file on or off. On: refused while a secret value is locked;
   * counts again (an unreadable file keeps the switch off); asks the native box; adds the exclude line when asked and the folder is in a
   * repository (a failure keeps the switch off); clears the mirror, saves the flag and runs the one cycle that may create the file. Off:
   * saves the flag, waits for a cycle already writing, and with `deleteFile` (after the native box) deletes `notes.md` only when it
   * holds exactly what Durbar would write.
   */
  async setFile(agentId: unknown, on: unknown, opts?: unknown): Promise<NotesSetFile | Refusal> {
    if (typeof on !== 'boolean') return refuse('On is yes or no.');
    if (opts !== undefined && (!isObj(opts) || Object.keys(opts).some((k) => k !== 'deleteFile' && k !== 'exclude'))) return refuse('Unknown options.');
    const o = (opts ?? {}) as { deleteFile?: unknown; exclude?: unknown };
    if ((o.deleteFile !== undefined && typeof o.deleteFile !== 'boolean') || (o.exclude !== undefined && typeof o.exclude !== 'boolean')) return refuse('Unknown options.');
    if (on && o.deleteFile !== undefined) return refuse('Unknown options.');
    if (!on && o.exclude !== undefined) return refuse('Unknown options.');
    const t = this.switchTarget(agentId);
    if ('ok' in t) return t;
    // one switch call at a time per folder (review of 0be6db42): an on and an off in one tick never interleave around an await
    const run = (this.switching.get(t.key) ?? Promise.resolve()).then(() => this.setFileNow(t, on, o));
    this.switching.set(t.key, run.catch(() => undefined));
    return run;
  }

  private async native(kind: NativeKind, a: AgentInfo, count?: number): Promise<boolean> {
    if (!this.d.confirmNative) return false;
    try { return (await this.d.confirmNative(kind, folderNameOf(a), count)) === true; } catch { return false; }
  }

  private async setFileNow(t: { a: AgentInfo; store: NotesStore; key: string; file: NotesFile }, on: boolean, o: { deleteFile?: unknown; exclude?: unknown }): Promise<NotesSetFile | Refusal> {
    const setOn = this.d.setFileOn!;
    let was = false;
    try { was = this.d.fileOn?.(t.key) === true; } catch { was = false; }
    if (on) {
      if (!was) {
        const v = await t.store.list(t.key);
        if (!v.ok) return v;
        const c = t.file.count(t.a.cwd, new Set(v.notes.map((n) => n.id)));
        if (!c.ok) return refuse(c.error); // COUNT_UNREADABLE for a conflict or a file that does not parse: the switch stays off
      }
      // review 2 of PR 931: never turn on with an incomplete mask; the first write must happen in this call
      let pending = false;
      try { pending = !was && this.d.valuesPending?.(t.key) === true; } catch { pending = true; }
      if (pending) return refuse(VALUES_PENDING_ON);
      // review of PR 931 (Q2): main asks with a native box the page cannot answer, before anything is written
      if (!was && !(await this.native('on', t.a))) return refuse(NATIVE_CANCELLED);
      let message: string | undefined;
      if (o.exclude === true && t.file.inRepo(t.a.cwd)) {
        // review of PR 931 (point 3): the line goes in BEFORE the switch is saved; when it cannot, the switch stays off (no fail-open)
        const x = t.file.addExclude(t.a.cwd);
        if (!x.ok) return was ? { ok: true, on: true, message: x.error } : { ...refuse(`${x.error.replace(/\.$/, '')}. The switch stays off.`), excludeFailed: true };
        message = x.added ? 'Added .durbar/ to .git/info/exclude (local only).' : '.durbar/ is already in .git/info/exclude.';
      }
      if (!was) {
        // review of PR 931 (point 4): turning on starts from no `mirror`, so a file that was gone is written again only now
        const m = await t.store.setMirror(t.key, folderNameOf(t.a), undefined);
        if (!m.ok) return m;
        // review 3 of PR 931: the folder's identity is recorded now, apart from the mirror, and every cycle checks it
        const ff = await t.store.setFileFolder(t.key, folderNameOf(t.a), t.file.folderId(t.a.cwd));
        if (!ff.ok) return ff;
        if (!setOn(t.key, true)) return refuse(SWITCH_UNSAVED);
      }
      const file = await this.syncFile(t.a.id, 1, !was); // only turning on may create the file (review 2 of PR 931)
      return { ok: true, on: true, ...(file ? { file } : {}), ...(message ? { message } : {}) };
    }
    // FR-050: while the switch is off Durbar never reads, stats or writes notes.md, so *Delete* is only part of turning it off
    if (!was && o.deleteFile === true) return refuse(SWITCH_ALREADY_OFF);
    if (o.deleteFile === true && !(await this.native('delete', t.a))) return refuse(NATIVE_CANCELLED);
    if (was && !setOn(t.key, false)) return refuse(SWITCH_UNSAVED);
    // a cycle running or queued finishes first (a queued one now finds the switch off and writes nothing), then the file is looked at
    for (let p = this.cycles.get(t.key); p;) { await p.catch(() => undefined); const n = this.cycles.get(t.key); if (n === p) break; p = n; }
    const lines: string[] = [];
    if (o.deleteFile === true) {
      const r = t.file.remove(t.a.cwd, await t.store.getMirror(t.key));
      lines.push(r.removed ? (r.dirRemoved ? 'Deleted .durbar/notes.md and the empty .durbar folder.' : `Deleted .durbar/notes.md. ${DELETE_LEFTOVER}`) : r.why ?? REMOVE_KEPT);
    } else lines.push('Durbar stopped writing .durbar/notes.md; the file is left in the project.');
    if (t.file.inRepo(t.a.cwd)) lines.push(EXCLUDE_KEPT);
    return { ok: true, on: false, message: lines.join(' ') };
  }

  async startOver(agentId: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    return t.store.startOver(t.key);
  }
}
