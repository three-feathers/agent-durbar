/**
 * The project notes file `.durbar/notes/notes.md` (spec 083 FR-052, FR-054, SC-004, issue 699): its writer and its parser. Pure: no fs, no
 * process, no clock (times come in as data), so it is unit tested (`npm run test:notesmd`). The file lives in a project folder, so
 * anyone with write access to it (an agent, a teammate's commit, a cloned repository) may have written what `parseNotesMd` reads: it is
 * untrusted data. Parsing is linear in the input (no backtracking regex on a whole line), keys nothing by text from the file (no
 * `__proto__` objects) and is capped by `NOTES_LIMITS.mdBytes` and `notesPerFolder`. Masking is the caller's (FR-005): text read here
 * is returned as written, minus control characters.
 *
 * Format (plan.md *Data model*): a fixed header, then one section per note in `createdAt` then `id` order (a new note only appends
 * lines), each `LF marker LF "## " title LF LF text LF` (an empty text has no blank line and no text line). A text line that starts
 * (after any backslashes) with the marker prefix, and one that starts with a git conflict marker outside fenced code, is written with one
 * more leading `\` and read back without it, so Durbar never writes a file it would read as a new section or as a conflict.
 */
import { NOTES_LIMITS, NOTE_ID_RE, cleanTitle, isoOk, stripControls, utf8Len, type Note } from './notes';

export const NOTE_MARKER_PREFIX = '<!-- durbar-note';
export const NOTES_MD_HEADER_COMMENT =
  '<!-- Kept by Agent Durbar (spec 083). One section per note; keep the durbar-note lines. Secrets are masked. To add a note, start it with a line <!-- durbar-note -->. Notes deleted here come back; delete them in Durbar. -->';
export const NOTES_MD_HEADER = `# Notes\n\n${NOTES_MD_HEADER_COMMENT}\n`;
/** FR-048 (T034b): the header of an *Export…* file, which nothing reads back; the body is FR-052's format, unchanged. */
export const NOTES_EXPORT_HEADER = '# Notes\n\n<!-- Exported from Agent Durbar (spec 083). Notes are listed oldest first. Secrets are masked. -->\n';
/** FR-054's message for a file with merge conflicts or one that cannot be read. */
export const NOTES_MD_UNREADABLE = '.durbar/notes/notes.md has merge conflicts or could not be read. Fix it in your editor; Durbar will not overwrite it until then.';
/** The plan's message for text outside notes, shown once (FR-054). */
export const NOTES_MD_STRAY = 'Text outside notes in notes.md is not kept';
/** A marker line longer than this has its attributes ignored (it is still a marker: a new note). */
const MARKER_ATTR_CHARS = 512;

/** One note as read from the file. `id` only when the marker has a valid, not yet seen one; `title` only when the file gives one. */
export type NotesMdSection = Partial<Pick<Note, 'id' | 'title' | 'createdAt' | 'updatedAt'>> & Pick<Note, 'text' | 'done'> & {
  /** `marker`: a `<!-- durbar-note …` section; `heading`: a `## ` heading before the first marker (FR-054). */
  origin: 'marker' | 'heading';
  /** The section's first line, 1-based (for a message). */
  line: number;
};

export type NotesMdParse =
  | {
      ok: true;
      sections: NotesMdSection[];
      /** Non-blank lines before the first marker that are neither the header nor under a `## ` heading: not kept (FR-054). */
      strayText: number;
      /** Sections whose marker repeated an id seen earlier in the file: read as new notes. */
      duplicates: number;
      /** Sections past `notesPerFolder`: not returned. */
      overflow: number;
    }
  | { ok: false; reason: 'conflict' | 'too-big'; error: string };

type Fence = { ch: '`' | '~'; len: number } | null;

/** CommonMark-like fenced code: up to 3 spaces, then 3 or more backticks or tildes; closed by the same character, at least as many, only spaces after. */
function fenceStep(f: Fence, line: string): Fence {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 32) i++;
  const c = line[i];
  if (c !== '`' && c !== '~') return f;
  let j = i;
  while (line[j] === c) j++;
  const n = j - i;
  if (n < 3) return f;
  if (f) return c === f.ch && n >= f.len && line.slice(j).trim() === '' ? null : f;
  if (c === '`' && line.indexOf('`', j) !== -1) return f; // a backtick info string: not a fence
  return { ch: c, len: n };
}

const isConflictLine = (s: string): boolean => s.startsWith('<<<<<<<') || s.startsWith('=======') || s.startsWith('>>>>>>>');
const isMarkerLine = (s: string): boolean => s.startsWith(NOTE_MARKER_PREFIX);
const leadingBackslashes = (s: string): number => { let k = 0; while (s.charCodeAt(k) === 92) k++; return k; };
const isBlank = (s: string): boolean => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c !== 32 && c !== 9) return false; } return true; };

/** Trailing blank (empty or spaces-and-tabs) lines dropped, in place. */
function dropTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) end--;
  lines.length = end;
  return lines;
}

/**
 * A note's text as the file keeps it: control characters removed (CRLF and a lone CR are line ends, `stripControls`) and trailing blank
 * lines dropped. `parseNotesMd(writeNotesMd(notes))` gives every note's text in this form; for a text already in it, exactly the text.
 */
export function notesMdText(text: string): string {
  return dropTrailingBlank(stripControls(text).split('\n')).join('\n');
}

/** Compare by `createdAt` as a time (then as text, so `…00Z` and `…00.000Z` still order the same way every time), then `id`. */
function byCreated(a: Note, b: Note): number {
  const ta = Date.parse(a.createdAt), tb = Date.parse(b.createdAt);
  const na = Number.isNaN(ta) ? 0 : ta, nb = Number.isNaN(tb) ? 0 : tb;
  if (na !== nb) return na - nb;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * FR-052: the file for these notes. UTF-8 text (the caller encodes it, no BOM), LF line ends, one trailing newline, deterministic (the
 * input order does not matter). Only `id`, the two times, `done`, the title and the text are written: never a session id, role, digest
 * or `from` (D8). An id or time that is not valid is left out of the marker rather than written (the store never holds one).
 */
export function writeNotesMd(notes: readonly Note[], header: string = NOTES_MD_HEADER): string {
  const out: string[] = [header];
  for (const n of [...notes].sort(byCreated)) {
    let marker = NOTE_MARKER_PREFIX;
    if (typeof n.id === 'string' && NOTE_ID_RE.test(n.id)) marker += ` id=${n.id}`;
    if (isoOk(n.createdAt)) marker += ` created=${n.createdAt}`;
    if (isoOk(n.updatedAt)) marker += ` updated=${n.updatedAt}`;
    if (n.done === true) marker += ' done';
    marker += ' -->';
    const title = cleanTitle(String(n.title ?? '').slice(0, NOTES_LIMITS.titleInputChars).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')) ?? 'Note';
    const text = notesMdText(String(n.text ?? ''));
    let section = `\n${marker}\n## ${title}\n`;
    if (text !== '') {
      const lines = text.split('\n');
      // a conflict-like line stays as it is only inside a fence that closes again (parseNotesMd reads an open fence as hiding nothing)
      let fence: Fence = null;
      let pending: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const inFence = fence !== null;
        fence = fenceStep(fence, l);
        const k = leadingBackslashes(l);
        const rest = k ? l.slice(k) : l;
        if (isMarkerLine(rest) || (isConflictLine(rest) && (k > 0 || !inFence))) lines[i] = '\\' + l;
        else if (isConflictLine(rest)) pending.push(i);
        if (!fence) pending = [];
      }
      for (const p of pending) lines[p] = '\\' + lines[p];
      section += `\n${lines.join('\n')}\n`;
    }
    out.push(section);
  }
  return out.join('');
}

/** A body line as the person wrote it: one escape backslash removed from an escaped marker-like or conflict-like line. */
function unescapeLine(l: string): string {
  const k = leadingBackslashes(l);
  if (k === 0) return l;
  const rest = l.slice(k);
  return isMarkerLine(rest) || isConflictLine(rest) ? l.slice(1) : l;
}

/** The marker's attributes, read without a regex over the line and without an object keyed by file text. */
function readMarker(line: string): { id?: string; createdAt?: string; updatedAt?: string; done: boolean } {
  const res: { id?: string; createdAt?: string; updatedAt?: string; done: boolean } = { done: false };
  let rest = line.slice(NOTE_MARKER_PREFIX.length).trimEnd();
  if (rest.length > MARKER_ATTR_CHARS) return res;
  if (rest.endsWith('-->')) rest = rest.slice(0, -3);
  if (rest !== '' && rest[0] !== ' ' && rest[0] !== '\t') return res; // `<!-- durbar-notes…`: a marker, no attributes
  for (const tok of rest.split(/[ \t]+/)) {
    if (tok === 'done') res.done = true;
    else if (tok.startsWith('id=') && res.id === undefined) { const v = tok.slice(3); if (v.length <= 14 && NOTE_ID_RE.test(v)) res.id = v; }
    else if (tok.startsWith('created=') && res.createdAt === undefined) { const v = tok.slice(8); if (isoOk(v)) res.createdAt = v; }
    else if (tok.startsWith('updated=') && res.updatedAt === undefined) { const v = tok.slice(8); if (isoOk(v)) res.updatedAt = v; }
  }
  return res;
}

/** A `## ` line's title: tabs as spaces, at most `titleInputChars` read, then `cleanTitle`. `undefined`: none (the caller guesses, FR-004). */
function headingTitle(l: string): string | undefined {
  return cleanTitle(l.slice(3, 3 + NOTES_LIMITS.titleInputChars).replace(/\t/g, ' '));
}

const isHeading = (l: string): boolean => l.startsWith('## ');
const isHeaderLine = (l: string): boolean => l === '# Notes' || (l.startsWith('<!-- Kept by Agent Durbar') && l.trimEnd().endsWith('-->'));

/**
 * FR-054: the notes in a `notes.md`. CRLF, a lone CR and a BOM are accepted; control characters other than tab are removed. A file
 * over `mdBytes` is `too-big`; one with a git conflict marker (`<<<<<<<`, `=======`, `>>>>>>>` at a line start) outside fenced code
 * is `conflict` (fences restart at every marker line, and a fence left open there or at the end hides nothing). Otherwise every marker line (column 0, even inside a fence: the writer escapes a
 * note's own marker-like lines) starts a section; a `## ` line right after it is the title, then one blank line is skipped; any later
 * `## ` line is text. Before the first marker, the header is skipped, each `## ` heading outside fenced code starts a new note, and
 * other non-blank lines are counted in `strayText`. A section's trailing blank lines are dropped; a heading note's and an untitled one's
 * leading ones too.
 */
export function parseNotesMd(raw: string): NotesMdParse {
  const input = String(raw ?? '');
  if (utf8Len(input) > NOTES_LIMITS.mdBytes) return { ok: false, reason: 'too-big', error: NOTES_MD_UNREADABLE };
  const lines = stripControls(input.charCodeAt(0) === 0xfeff ? input.slice(1) : input).split('\n');

  // a conflict line inside a fence that is never closed (before the next marker or the end) counts: a merge may have cut the fence
  let fence: Fence = null;
  let hidden = false;
  for (const l of lines) {
    if (isMarkerLine(l)) {
      if (fence && hidden) return { ok: false, reason: 'conflict', error: NOTES_MD_UNREADABLE };
      fence = null; hidden = false; continue;
    }
    const inFence = fence !== null;
    fence = fenceStep(fence, l);
    if (isConflictLine(l)) { if (!inFence) return { ok: false, reason: 'conflict', error: NOTES_MD_UNREADABLE }; hidden = true; }
    if (!fence) hidden = false;
  }
  if (fence && hidden) return { ok: false, reason: 'conflict', error: NOTES_MD_UNREADABLE };

  const sections: NotesMdSection[] = [];
  const seen = new Set<string>();
  let strayText = 0, duplicates = 0, overflow = 0;
  const push = (s: NotesMdSection): void => { if (sections.length < NOTES_LIMITS.notesPerFolder) sections.push(s); else overflow++; };
  const bodyText = (body: string[], untitled: boolean): string => {
    let start = 0;
    if (untitled) while (start < body.length && isBlank(body[start])) start++;
    return dropTrailingBlank(body.slice(start)).map(unescapeLine).join('\n');
  };

  // before the first marker: the header, `## ` headings as new notes, stray text
  let i = 0;
  // a section past `notesPerFolder` is only counted: its marker, title and text are never read (a hostile file at the cap stays cheap)
  const full = (): boolean => sections.length >= NOTES_LIMITS.notesPerFolder;
  let head: { title?: string; line: number; body: string[]; skip?: true } | null = null;
  const endHead = (): void => {
    if (!head) return;
    if (head.skip) { overflow++; head = null; return; }
    push({ origin: 'heading', line: head.line, ...(head.title !== undefined ? { title: head.title } : {}), text: bodyText(head.body, true), done: false });
    head = null;
  };
  fence = null;
  for (; i < lines.length && !isMarkerLine(lines[i]); i++) {
    const l = lines[i];
    const inFence = fence !== null;
    fence = fenceStep(fence, l);
    if (!inFence && isHeading(l)) { endHead(); head = full() ? { line: i + 1, body: [], skip: true } : { title: headingTitle(l), line: i + 1, body: [] }; continue; }
    if (head) { if (!head.skip) head.body.push(l); }
    else if (!isBlank(l) && !isHeaderLine(l)) strayText++;
  }
  endHead();

  // the marker sections
  while (i < lines.length) {
    const start = i;
    if (full()) {
      overflow++;
      for (i++; i < lines.length && !isMarkerLine(lines[i]); i++) { /* skipped unread */ }
      continue;
    }
    const m = readMarker(lines[i++]);
    let title: string | undefined;
    if (i < lines.length && isHeading(lines[i])) {
      title = headingTitle(lines[i++]);
      if (i < lines.length && !isMarkerLine(lines[i]) && isBlank(lines[i])) i++;
    }
    const body: string[] = [];
    while (i < lines.length && !isMarkerLine(lines[i])) body.push(lines[i++]);
    let id = m.id;
    if (id !== undefined) {
      if (seen.has(id)) { id = undefined; duplicates++; } else seen.add(id);
    }
    push({
      origin: 'marker', line: start + 1,
      ...(id !== undefined ? { id } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(m.createdAt !== undefined ? { createdAt: m.createdAt } : {}),
      ...(m.updatedAt !== undefined ? { updatedAt: m.updatedAt } : {}),
      text: bodyText(body, title === undefined), done: m.done,
    });
  }
  return { ok: true, sections, strayText, duplicates, overflow };
}
