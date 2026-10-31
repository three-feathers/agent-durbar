/**
 * Notes per folder (spec 083, issue 699): the pure model. Types, the one `NOTES_LIMITS` object (FR-006), the document parser, titles,
 * ids, the change rules (stale `rev`, the cap) and the merge of two copies of one folder's notes (FR-008). No Electron, no Node-only
 * imports and no clock or random source of its own (callers pass them), so it is unit tested. Masking is `maskNoteText` in redact.ts:
 * everything that reaches this module has been masked already; nothing here sees a secret.
 */
import { sessionIdOk } from './sessionid';

/**
 * FR-006: every cap lives here. The character caps are the only numbers written down; every byte cap is DERIVED from them, so Durbar
 * never writes a file larger than it will read back. A stored character costs at most 3 bytes of UTF-8 and, after control characters
 * are removed, a JSON escape costs at most 2 bytes per character (`\"`, `\\`, `\n`, `\t`), so 3 bytes per character bound both.
 */
export const NOTES_LIMITS = (() => {
  const textChars = 16_000;
  const titleChars = 80;
  const notesPerFolder = 300;
  const tombstones = 300;
  const folderNameChars = 80;
  /** What the window may send for one note's text before masking, and for a title (IPC validation, FR-062). */
  const inputChars = 65_536;
  const titleInputChars = 400;
  /** The highest message place (`ord`) a note may carry. */
  const ordMax = 1_000_000;
  /** The fields besides title and text: id, times, flags, source (session id up to 100 characters), digest. */
  const noteExtraBytes = 1_024;
  const tombstoneBytes = 128;
  /** The document's own fields: version, folder name (3 bytes per character), mirror, punctuation, and up to one pending id per note (14 characters, quotes, comma). */
  const docExtraBytes = 3 * folderNameChars + 1_024 + notesPerFolder * 17;
  const noteJsonBytes = 3 * (textChars + titleChars) + noteExtraBytes;
  const storeBytes = notesPerFolder * noteJsonBytes + tombstones * tombstoneBytes + docExtraBytes;
  /**
   * An escaped line (a marker-like or conflict-like text line, spec 083 Changes 2026-10-31) costs one byte more, but it is ASCII up to
   * its marker, so it still costs under 3 bytes per character: `3 × characters` bounds every text; the `textChars / 17` term and the
   * 256 bytes (marker line, `## `, blank lines) are slack. Tested at every cap (`test-notesmd.ts`).
   */
  const noteMdBytes = 3 * (textChars + titleChars) + Math.ceil(textChars / 17) + 1 + 256;
  const mdBytes = notesPerFolder * noteMdBytes + 1_024;
  /** FR-051: the most read of a worktree's or submodule's `.git` file and of its `commondir` file, and of `info/exclude` (files Durbar did not write). */
  const gitFileBytes = 4_096;
  const excludeBytes = 1_048_576;
  return { textChars, titleChars, notesPerFolder, tombstones, folderNameChars, inputChars, titleInputChars, ordMax, noteExtraBytes, tombstoneBytes, docExtraBytes, noteJsonBytes, storeBytes, noteMdBytes, mdBytes, gitFileBytes, excludeBytes } as const;
})();

export type NoteFrom = 'agent' | 'user' | 'selection' | 'typed' | 'file';
const FROMS: readonly NoteFrom[] = ['agent', 'user', 'selection', 'typed', 'file'];

export interface NoteSource {
  /** The agent app's id (`copilot`, `claude`, `codex`, ...). */
  app: string;
  session: string;
  role: 'user' | 'agent';
  /** The message's place among that role's messages in the chat. */
  ord: number;
  /** First 16 hex characters of SHA-256 of `rawDigestInput(raw text)`. */
  digest: string;
  at: string;
}

export interface Note {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  rev: number;
  done: boolean;
  from: NoteFrom;
  /** True when the project file changed it after it was saved (FR-054). */
  fileEdited: boolean;
  /** True when masking changed the title or text when it was saved or edited (FR-005, FR-024). */
  hidden: boolean;
  source?: NoteSource;
}

export interface Tombstone { id: string; deletedAt: string }
export interface NotesMirror { sha256: string; bytes: number; at: string }

export interface NotesDoc {
  version: 1;
  folderName: string;
  notes: Note[];
  tombstones: Tombstone[];
  mirror?: NotesMirror;
  /** The last `notes.md` imported (FR-054; T041 review): the same file is never imported twice, after a restart too. */
  fileImport?: { sha256: string; at: string };
  /**
   * The project folder's identity recorded when the switch was turned on (review 3 of PR 931): `<dev>:<ino>:<birth time in ns>` (or
   * `<dev>:<ino>` where the file system has no birth time), never a path. Every cycle compares it with the folder found now.
   */
  fileFolder?: { id: string; at: string };
  /** Ids of notes imported from `notes.md` sections without an id that no successful write has put into the file yet (T041 review). */
  filePending?: string[];
}

export const NOTE_ID_RE = /^n-[a-z0-9]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** An ISO 8601 UTC time as Durbar writes it (`toISOString`, milliseconds optional), at most 32 characters. */
export const isoOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 32 && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export const emptyNotesDoc = (folderName = ''): NotesDoc => ({ version: 1, folderName: cleanFolderName(folderName), notes: [], tombstones: [] });

/** The folder's display name as stored: no control characters, at most `folderNameChars`. Never a path. */
export function cleanFolderName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim() : '';
  return s.length > NOTES_LIMITS.folderNameChars ? s.slice(0, NOTES_LIMITS.folderNameChars) : s;
}

/** UTF-8 length of a string without building the bytes. A lone surrogate counts 3 (the replacement character). */
export function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** True when `bytes` fits the cap (FR-006: checked before every write). */
export const fitsCap = (bytes: number, cap: number): boolean => bytes <= cap;

/**
 * FR-006: control characters other than tab and line feed are removed (a line end is `\n`), and a lone surrogate becomes U+FFFD, so a
 * JSON escape costs at most 2 bytes per character and a stored character at most 3 bytes.
 */
export function stripControls(s: string): string {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
}

/** The visible last line of a text cut to the cap (FR-006). */
export const CUT_LINE = `[Cut: the message was longer than ${String(NOTES_LIMITS.textChars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} characters.]`;

/**
 * The text as stored: controls removed, and when longer than `textChars` cut at the last line end that leaves room for the visible
 * `CUT_LINE`, the whole never longer than the cap. Call it on MASKED text: mask, then cut, never the other way round (a secret across
 * the cut would leave its head).
 */
export function fitText(masked: string): { text: string; cut: boolean } {
  const t = stripControls(masked);
  if (t.length <= NOTES_LIMITS.textChars) return { text: t, cut: false };
  const room = NOTES_LIMITS.textChars - CUT_LINE.length - 2;
  let end = t.lastIndexOf('\n', room);
  if (end <= 0) { end = room; if (/[\ud800-\udbff]/.test(t[end - 1] ?? '')) end--; }
  return { text: t.slice(0, end).replace(/\s+$/, '') + '\n\n' + CUT_LINE, cut: true };
}

/** FR-003: a title is one line, 1 to `titleChars` characters, no control character. `undefined`: refused. Longer: cut (never in a surrogate pair). */
export function cleanTitle(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > NOTES_LIMITS.titleInputChars) return undefined;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (s.length <= NOTES_LIMITS.titleChars) return s;
  let end = NOTES_LIMITS.titleChars;
  if (/[\ud800-\udbff]/.test(s[end - 1])) end--;
  return s.slice(0, end).trimEnd();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** FR-004: the first non-empty line with its Markdown marks removed, cut at a word to `titleChars`; empty: `Note of 24 Oct 10:12` (local time). */
export function guessTitle(text: string, now: Date): string {
  const first = stripControls(String(text ?? '')).split('\n').find((l) => l.trim()) ?? '';
  let l = first.slice(0, NOTES_LIMITS.titleInputChars);
  l = l
    .replace(/^\s*(?:`{3,}|~{3,})\s*\w*\s*$/, '')
    .replace(/^\s*(?:#{1,6}\s+|>+\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)+/, '')
    .replace(/!?\[([^\]]{0,200})\]\([^)]{0,500}\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/(^|[^A-Za-z0-9*])(?:\*{1,3}|~~)(?=\S)/g, '$1')
    .replace(/(^|[^A-Za-z0-9])_{1,3}(?=\S)/g, '$1')
    .replace(/(?<=\S)_{1,3}(?=$|[^A-Za-z0-9])/g, '')
    .replace(/(?<=\S)(?:\*{1,3}|~~)(?=$|[^A-Za-z0-9*])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!l) return `Note of ${now.getDate()} ${MONTHS[now.getMonth()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (l.length <= NOTES_LIMITS.titleChars) return l;
  let cut = l.slice(0, NOTES_LIMITS.titleChars + 1);
  const sp = cut.lastIndexOf(' ');
  cut = sp >= NOTES_LIMITS.titleChars / 2 ? cut.slice(0, sp) : cut.slice(0, NOTES_LIMITS.titleChars);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.replace(/[\s.,;:!?-]+$/, '') || cut;
}

/** FR-003: `n-` and 12 base-36 characters, each from `rand(36)` (a uniform integer 0..35, e.g. `crypto.randomInt`): no modulo bias here. */
export function newNoteId(rand: (n: number) => number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'n-';
  for (let i = 0; i < 12; i++) s += chars[rand(chars.length)];
  return s;
}

/** FR-009: the text a message's digest is computed from, on both sides: line ends unified and the ends trimmed. */
export const rawDigestInput = (raw: string): string => String(raw ?? '').replace(/\r\n/g, '\n').trim();

function parseSource(v: unknown): NoteSource | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  if (typeof s.app !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(s.app)) return undefined;
  if (!sessionIdOk(s.app, s.session)) return undefined;
  if (s.role !== 'user' && s.role !== 'agent') return undefined;
  if (!intIn(s.ord, 0, NOTES_LIMITS.ordMax)) return undefined;
  if (typeof s.digest !== 'string' || !/^[0-9a-f]{16}$/.test(s.digest)) return undefined;
  if (!isoOk(s.at)) return undefined;
  return { app: s.app, session: s.session as string, role: s.role, ord: s.ord as number, digest: s.digest, at: s.at };
}

function parseNote(v: unknown): Note | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const n = v as Record<string, unknown>;
  if (typeof n.id !== 'string' || !NOTE_ID_RE.test(n.id)) return undefined;
  const title = cleanTitle(n.title);
  if (title === undefined || typeof n.text !== 'string' || n.text.length > NOTES_LIMITS.textChars) return undefined;
  if (!isoOk(n.createdAt) || !isoOk(n.updatedAt) || !intIn(n.rev, 1, 1e9)) return undefined;
  if (typeof n.from !== 'string' || !FROMS.includes(n.from as NoteFrom)) return undefined;
  const source = n.source === undefined ? undefined : parseSource(n.source);
  return {
    id: n.id, title, text: stripControls(n.text), createdAt: n.createdAt, updatedAt: n.updatedAt, rev: n.rev,
    done: n.done === true, from: n.from as NoteFrom, fileEdited: n.fileEdited === true, hidden: n.hidden === true,
    ...(source ? { source } : {}),
  };
}

export type ParseResult = { ok: true; doc: NotesDoc; dropped: number } | { ok: false; error: string };

/**
 * FR-007: a good note is kept, a bad one dropped (and counted). A document that cannot be read at all (not JSON, unknown version, over
 * `storeBytes`) is an error: the caller leaves the file as it is.
 */
export function parseNotesDoc(raw: string): ParseResult {
  if (typeof raw !== 'string') return { ok: false, error: 'not text' };
  if (!fitsCap(utf8Len(raw), NOTES_LIMITS.storeBytes)) return { ok: false, error: 'the file is larger than Durbar writes' };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, error: 'not valid JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'not a notes file' };
  const d = j as Record<string, unknown>;
  if (d.version !== 1) return { ok: false, error: 'a version of the notes file this Durbar does not know' };
  const notes: Note[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const x of Array.isArray(d.notes) ? d.notes : []) {
    const n = parseNote(x);
    if (!n || ids.has(n.id) || notes.length >= NOTES_LIMITS.notesPerFolder) { dropped++; continue; }
    ids.add(n.id);
    notes.push(n);
  }
  const tombstones: Tombstone[] = [];
  const tids = new Set<string>();
  for (const t of Array.isArray(d.tombstones) ? d.tombstones : []) {
    const o = t as Record<string, unknown> | null;
    if (!o || typeof o.id !== 'string' || !NOTE_ID_RE.test(o.id) || !isoOk(o.deletedAt) || tids.has(o.id) || ids.has(o.id)) continue;
    tids.add(o.id);
    tombstones.push({ id: o.id, deletedAt: o.deletedAt });
  }
  const m = d.mirror as Record<string, unknown> | undefined;
  const mirror = m && typeof m === 'object' && typeof m.sha256 === 'string' && /^[0-9a-f]{64}$/.test(m.sha256) && intIn(m.bytes, 0, NOTES_LIMITS.mdBytes) && isoOk(m.at)
    ? { sha256: m.sha256, bytes: m.bytes as number, at: m.at as string } : undefined;
  const ff = d.fileFolder as Record<string, unknown> | undefined;
  const fileFolder = ff && typeof ff === 'object' && typeof ff.id === 'string' && /^[0-9]{1,24}:[0-9]{1,24}(?::[0-9]{1,24})?$/.test(ff.id) && isoOk(ff.at) ? { id: ff.id, at: ff.at as string } : undefined;
  const fi = d.fileImport as Record<string, unknown> | undefined;
  const fileImport = fi && typeof fi === 'object' && typeof fi.sha256 === 'string' && /^[0-9a-f]{64}$/.test(fi.sha256) && isoOk(fi.at) ? { sha256: fi.sha256, at: fi.at as string } : undefined;
  const filePending = Array.isArray(d.filePending) ? [...new Set(d.filePending.filter((x): x is string => typeof x === 'string' && ids.has(x)))] : [];
  return { ok: true, dropped, doc: { version: 1, folderName: cleanFolderName(d.folderName), notes, tombstones: capTombstones(tombstones), ...(mirror ? { mirror } : {}), ...(fileFolder ? { fileFolder } : {}), ...(fileImport ? { fileImport } : {}), ...(filePending.length ? { filePending } : {}) } };
}

/** Compact JSON, the way it is written and measured. */
export const serializeNotesDoc = (doc: NotesDoc): string => JSON.stringify(doc);

function capTombstones(t: Tombstone[]): Tombstone[] {
  if (t.length <= NOTES_LIMITS.tombstones) return t;
  return [...t].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : a.id < b.id ? 1 : -1)).slice(0, NOTES_LIMITS.tombstones);
}

export type NoteChange =
  | { op: 'add'; text: string; title?: string; from: NoteFrom; hidden: boolean; source?: NoteSource }
  | { op: 'update'; id: string; rev: number; title?: string; text?: string; done?: boolean; hidden?: boolean }
  | { op: 'delete'; id: string; rev: number }
  | { op: 'deleteAll' };

export type ChangeResult =
  | { ok: true; doc: NotesDoc; note?: Note }
  | { ok: false; code: 'stale' | 'cap' | 'missing' | 'invalid'; error: string; current?: Note };

export const CAP_MESSAGE = `This folder has ${NOTES_LIMITS.notesPerFolder} notes. Delete or export some first.`;

const copyDoc = (d: NotesDoc): NotesDoc => ({ ...d, notes: d.notes.map((n) => ({ ...n })), tombstones: d.tombstones.map((t) => ({ ...t })) });

/**
 * FR-006, FR-008: one change applied to a copy of the document. `rev` must match (else `stale`, with the saved note); a change bumps
 * `rev` and `updatedAt`; a delete leaves a tombstone; the 301st note is refused. Text and titles are checked again here (controls
 * removed, cut to the cap): the caller masked them first.
 */
export function applyChange(doc: NotesDoc, change: NoteChange, now: Date, newId: () => string): ChangeResult {
  const d = copyDoc(doc);
  const stamp = now.toISOString();
  if (change.op === 'add') {
    if (d.notes.length >= NOTES_LIMITS.notesPerFolder) return { ok: false, code: 'cap', error: CAP_MESSAGE };
    const fit = fitText(change.text);
    if (!fit.text.trim()) return { ok: false, code: 'invalid', error: 'The note is empty.' };
    const title = change.title !== undefined ? cleanTitle(change.title) : cleanTitle(guessTitle(fit.text, now));
    if (title === undefined) return { ok: false, code: 'invalid', error: 'The title is empty or has control characters.' };
    let id = newId();
    for (let i = 0; i < 8 && (d.notes.some((n) => n.id === id) || d.tombstones.some((t) => t.id === id)); i++) id = newId();
    if (d.notes.some((n) => n.id === id) || d.tombstones.some((t) => t.id === id)) return { ok: false, code: 'invalid', error: 'Could not make a note id.' };
    const note: Note = { id, title, text: fit.text, createdAt: stamp, updatedAt: stamp, rev: 1, done: false, from: change.from, fileEdited: false, hidden: change.hidden, ...(change.source ? { source: change.source } : {}) };
    d.notes.push(note);
    return { ok: true, doc: d, note };
  }
  if (change.op === 'deleteAll') {
    for (const n of d.notes) d.tombstones.push({ id: n.id, deletedAt: stamp });
    d.notes = [];
    d.tombstones = capTombstones(d.tombstones);
    return { ok: true, doc: d };
  }
  const i = d.notes.findIndex((n) => n.id === change.id);
  if (i < 0) return { ok: false, code: 'missing', error: 'That note is not there any more.' };
  const cur = d.notes[i];
  if (cur.rev !== change.rev) return { ok: false, code: 'stale', error: 'That note changed since you opened it.', current: cur };
  if (change.op === 'delete') {
    d.notes.splice(i, 1);
    d.tombstones = capTombstones([...d.tombstones.filter((t) => t.id !== cur.id), { id: cur.id, deletedAt: stamp }]);
    return { ok: true, doc: d, note: cur };
  }
  const next: Note = { ...cur };
  let changed = false;
  let titleEdited = false;
  let textEdited = false;
  if (change.title !== undefined) {
    const t = cleanTitle(change.title);
    if (t === undefined) return { ok: false, code: 'invalid', error: 'The title is empty or has control characters.' };
    if (t !== cur.title) { next.title = t; changed = true; titleEdited = true; }
  }
  if (change.text !== undefined) {
    const fit = fitText(change.text);
    if (!fit.text.trim()) return { ok: false, code: 'invalid', error: 'The note is empty.' };
    if (fit.text !== cur.text) { next.text = fit.text; changed = true; textEdited = true; }
  }
  if (change.done !== undefined && change.done !== cur.done) { next.done = change.done; changed = true; }
  if (!changed) return { ok: true, doc: d, note: cur };
  next.hidden = (cur.hidden && !(titleEdited && textEdited)) || change.hidden === true;
  next.rev = cur.rev + 1;
  next.updatedAt = stamp;
  d.notes[i] = next;
  return { ok: true, doc: d, note: next };
}

/**
 * The pending ids (T041) of either copy that are still notes AND were created after the newest successful write (`mirror.at`): a note
 * created before that write was in it, so another copy that still lists it is stale. When in doubt this gives a duplicate, never an
 * overwrite of a note that is in the file.
 */
function pendingOf(a: NotesDoc, b: NotesDoc, notes: readonly Note[], mirror: NotesMirror | undefined): { filePending?: string[] } {
  const after = new Map(notes.map((n) => [n.id, !mirror || Date.parse(n.createdAt) > Date.parse(mirror.at)]));
  const ids = [...new Set([...(a.filePending ?? []), ...(b.filePending ?? [])])].filter((x) => after.get(x) === true);
  return ids.length ? { filePending: ids } : {};
}

const sameContent = (a: Note, b: Note): boolean => a.title === b.title && a.text === b.text && a.done === b.done && a.hidden === b.hidden && a.fileEdited === b.fileEdited;

/**
 * FR-008: two copies of one folder's notes become one. By `id`: the higher `updatedAt` wins (then the higher `rev`, then `a`); a
 * tombstone wins over an edit that is not newer than it; tombstones are kept (newest per id) and capped at `tombstones`, oldest dropped.
 * When two different versions meet, the result's `rev` is above both, so a window holding either one sees its change as stale.
 */
export function mergeDocs(a: NotesDoc, b: NotesDoc): NotesDoc {
  const dead = new Map<string, string>();
  for (const t of [...a.tombstones, ...b.tombstones]) if (!dead.has(t.id) || dead.get(t.id)! < t.deletedAt) dead.set(t.id, t.deletedAt);
  const byId = new Map<string, Note>();
  for (const n of [...a.notes, ...b.notes]) {
    const old = byId.get(n.id);
    if (!old) { byId.set(n.id, n); continue; }
    const newer = n.updatedAt > old.updatedAt || (n.updatedAt === old.updatedAt && n.rev > old.rev) ? n : old;
    const other = newer === n ? old : n;
    byId.set(n.id, { ...newer, rev: sameContent(newer, other) ? Math.max(old.rev, n.rev) : Math.max(old.rev, n.rev) + (newer.rev > other.rev ? 0 : 1) });
  }
  const notes: Note[] = [];
  for (const n of byId.values()) {
    const at = dead.get(n.id);
    if (at !== undefined && at >= n.updatedAt) continue;
    notes.push(n);
    dead.delete(n.id); // a newer edit than the tombstone: the note lives, the tombstone goes
  }
  notes.sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id < y.id ? -1 : 1));
  const mirror = [a.mirror, b.mirror].filter((m): m is NotesMirror => !!m).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
  const fileImport = [a.fileImport, b.fileImport].filter((m): m is { sha256: string; at: string } => !!m).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
  const fileFolder = [a.fileFolder, b.fileFolder].filter((m): m is { id: string; at: string } => !!m).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
  return {
    version: 1,
    folderName: a.folderName || b.folderName,
    notes,
    tombstones: capTombstones([...dead].map(([id, deletedAt]) => ({ id, deletedAt }))),
    ...(mirror ? { mirror } : {}),
    ...(fileImport ? { fileImport } : {}),
    ...(fileFolder ? { fileFolder } : {}),
    ...pendingOf(a, b, notes, mirror),
  };
}

/** FR-021: this session's notes first, then the rest; each group newest first. */
export function orderForFolder(notes: readonly Note[], session?: string): Note[] {
  const rank = (n: Note): number => (session && n.source?.session === session ? 0 : 1);
  return [...notes].sort((x, y) => rank(x) - rank(y) || (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : x.id < y.id ? 1 : -1));
}

/** What the notes calls answer (spec 083 FR-062): a refusal carries a short reason, and `stale` the note as saved. */
export type NotesFail = { ok: false; code: 'stale' | 'cap' | 'missing' | 'invalid' | 'unreadable' | 'write'; error: string; current?: Note };
/** The project file's state while its switch is on (FR-053, FR-054): `error` blocks writing it (a conflict, a refused link, a failed write); `info` is a note for the screen (stray text, notes not imported). */
export interface NotesFileState { error?: string; info?: string }
/**
 * The project-file switch as the Notes screen shows it (FR-050, T042): `on` from `notesFile` in folders.json; `disabled` is the reason the
 * switch is greyed (the folder is not there). Absent from a `.code-workspace`'s view: the switch is not offered there.
 */
export interface NotesFileSwitch { on: boolean; disabled?: string }
/** `notes:fileCount` (FR-050, only while turning on): notes the existing file would add, whether it exists, whether the folder is in a git repository. */
export type NotesFileCount = { ok: true; count: number; exists: boolean; strayText: number; repo: boolean } | NotesFail;
/** `notes:setFile` (FR-050, FR-055): the switch's new position, the mirror's state after turning on, and a short line for the screen. */
export type NotesSetFile = { ok: true; on: boolean; file?: NotesFileState; message?: string; demo?: boolean } | (NotesFail & { excludeFailed?: true });
export type NotesView = { ok: true; fingerprint: string; folderName: string; notes: Note[]; max: number; readOnly?: string; session?: string; file?: NotesFileState; fileSwitch?: NotesFileSwitch } | NotesFail;
export type NotesWrote = { ok: true; fingerprint: string; note?: Note; existing?: boolean } | NotesFail;
