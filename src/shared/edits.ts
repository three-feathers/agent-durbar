/**
 * The normalized view of a file-changing tool call (spec 005 FR-018..FR-025). Pure, adapter-neutral: no provider types.
 * Adapters turn their own argument shapes into an `EditInfo` with these helpers (src/adapters/edits.ts); the chat shows it.
 */
import { clipDiff, simpleDiff, DIFF_MAX } from './diff';
import { redact } from './redact';

export type EditKind = 'edit' | 'create' | 'write' | 'delete' | 'move';

/** One file a tool call changes. `diff` is unified-diff body text (`@@`, `+`, `-`, ` ` lines, no `---`/`+++` header). */
export interface EditFile {
  path: string;
  kind: EditKind;
  diff?: string;
  added?: number;
  removed?: number;
  movedTo?: string;
}

/** `partial`: the arguments are still being written by the model. `more`: files left out after `EDIT_FILES_MAX`. */
export interface EditInfo {
  files: EditFile[];
  partial?: boolean;
  more?: number;
}

/** Files listed per call (FR-024). */
export const EDIT_FILES_MAX = 20;
/** Longest path kept (characters). */
const PATH_MAX = 1000;

const KINDS: readonly EditKind[] = ['edit', 'create', 'write', 'delete', 'move'];
export const isEditKind = (v: unknown): v is EditKind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);

const toLines = (s: string): string[] => (s === '' ? [] : s.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));

/** + and - lines of a diff body (header lines `---`/`+++` before the first `@@` are not counted). */
export function countDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let hunk = false;
  for (const l of toLines(diff)) {
    if (l.startsWith('@@')) hunk = true;
    else if (!hunk && /^(\+\+\+|---)( |$)/.test(l)) continue;
    else if (l.startsWith('+')) added++;
    else if (l.startsWith('-')) removed++;
  }
  return { added, removed };
}

/** Drop a leading `--- a/x` / `+++ b/x` header (the row already names the file). */
function bodyOf(diff: string): string {
  return diff.replace(/\r\n?/g, '\n').replace(/^--- [^\n]*\n\+\+\+ [^\n]*\n/, '').replace(/\n+$/, '');
}

/** A file from old and new text (an edit), or from new text only (`create`/`write`: all lines added). */
export function editFile(path: string, kind: EditKind, oldText: string | undefined, newText: string | undefined): EditFile {
  const f: EditFile = { path, kind };
  if (typeof newText !== 'string' && typeof oldText !== 'string') return f;
  const diff = bodyOf(simpleDiff(path, typeof oldText === 'string' ? oldText : '', typeof newText === 'string' ? newText : '', Infinity));
  if (diff) Object.assign(f, { diff }, countDiff(diff));
  return f;
}

/** Text that is a file's content, not a diff, as all-added (or all-removed) lines. */
function contentAs(text: string, sign: '+' | '-'): string {
  const ls = toLines(text);
  return ls.length ? `@@ ${sign === '+' ? '-0,0 +1,' : '-1,'}${ls.length}${sign === '+' ? '' : ' +0,0'} @@\n` + ls.map((l) => sign + l).join('\n') : '';
}
const looksLikeDiff = (t: string): boolean => /^@@/m.test(t) || toLines(t).every((l) => /^[+\- ]/.test(l) || l === '');

/** A change of a known kind whose `diff` may be the file's content (Codex `add`/`delete`) or a unified diff. */
export function diffFile(path: string, kind: EditKind, text: string | undefined, movedTo?: string): EditFile {
  const f: EditFile = { path, kind, ...(movedTo ? { movedTo } : {}) };
  if (typeof text !== 'string' || !text) return f;
  const diff = looksLikeDiff(text) ? bodyOf(text) : contentAs(text, kind === 'delete' ? '-' : '+');
  if (diff) Object.assign(f, { diff }, countDiff(diff));
  return f;
}

/**
 * Files of a patch text: the `*** Begin Patch` format (`*** Add File:`, `*** Update File:`, `*** Delete File:`, `*** Move to:`)
 * or a plain unified diff (`--- a/x` / `+++ b/x`, `diff --git`). An unfinished patch (still streaming) gives the files so far.
 */
export function patchFiles(text: string): EditFile[] {
  const out: { f: EditFile; body: string[] }[] = [];
  let cur: { f: EditFile; body: string[] } | undefined;
  const start = (path: string, kind: EditKind): void => {
    cur = { f: { path: path.trim(), kind }, body: [] };
    out.push(cur);
  };
  const ls = toLines(text);
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    let m: RegExpExecArray | null;
    if ((m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(l))) start(m[2], m[1] === 'Add' ? 'create' : m[1] === 'Delete' ? 'delete' : 'edit');
    else if ((m = /^\*\*\* Move to: (.+)$/.exec(l)) && cur) Object.assign(cur.f, { kind: 'move', movedTo: m[1].trim() });
    else if (/^\*\*\* (Begin Patch|End Patch|End of File)\s*$/.test(l)) continue;
    else if (/^diff --git /.test(l)) cur = undefined;
    else if ((m = /^--- (?:a\/)?(.+?)\s*$/.exec(l)) && i + 1 < ls.length && /^\+\+\+ /.test(ls[i + 1])) {
      const to = /^\+\+\+ (?:b\/)?(.+?)\s*$/.exec(ls[i + 1])![1];
      const from = m[1];
      start(to === '/dev/null' ? from : to, from === '/dev/null' ? 'create' : to === '/dev/null' ? 'delete' : 'edit');
      i++;
    } else if (cur && (/^[+\- ]/.test(l) || l.startsWith('@@') || l === '')) cur.body.push(l);
  }
  return out.map(({ f, body }) => {
    while (body.length && body[body.length - 1] === '') body.pop();
    if (!body.length) return f;
    const diff = (body[0].startsWith('@@') ? '' : '@@\n') + body.join('\n');
    return { ...f, diff, ...countDiff(diff) };
  });
}

const cleanPath = (p: string): string => redact(String(p).replace(/[\r\n\t]+/g, ' ')).slice(0, PATH_MAX);

/** Mask secrets in paths and diffs, cut each diff at `DIFF_MAX` characters, keep at most `EDIT_FILES_MAX` files (FR-024). */
export function finishEdit(files: EditFile[], partial?: boolean): EditInfo | undefined {
  const ok = files.filter((f) => f && typeof f.path === 'string' && f.path.trim());
  if (!ok.length) return undefined;
  const kept = ok.slice(0, EDIT_FILES_MAX).map((f) => {
    const g: EditFile = { path: cleanPath(f.path), kind: isEditKind(f.kind) ? f.kind : 'edit' };
    if (f.movedTo) g.movedTo = cleanPath(f.movedTo);
    if (typeof f.diff === 'string' && f.diff) {
      g.diff = clipDiff(redact(f.diff), DIFF_MAX);
      g.added = f.added ?? 0;
      g.removed = f.removed ?? 0;
    }
    return g;
  });
  return { files: kept, ...(partial ? { partial: true } : {}), ...(ok.length > kept.length ? { more: ok.length - kept.length } : {}) };
}

/**
 * Parse the start of a JSON text that is still being written (a tool call's streamed arguments): an open string is closed (a
 * cut escape dropped), a dangling key or colon gets `null`, a cut number or literal is dropped, open brackets are closed. Linear
 * time. `undefined` when the text does not start a JSON object or array, or cannot be repaired.
 */
export function partialJson(text: string): unknown {
  if (typeof text !== 'string') return undefined;
  const t = text.trimStart();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    /* repaired below */
  }
  type Frame = { t: '{' | '['; st: 'key' | 'colon' | 'value' | 'after' };
  const stack: Frame[] = [];
  let inStr = false;
  let esc = false;
  let keyStr = false;
  let lastStruct = -1; // index after the last character that ends a token (structural char or closing quote)
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') {
        inStr = false;
        lastStruct = i + 1;
        const top = stack[stack.length - 1];
        if (top) top.st = keyStr ? 'colon' : 'after';
      }
      continue;
    }
    const top = stack[stack.length - 1];
    if (c === '"') {
      inStr = true;
      keyStr = !!top && top.t === '{' && top.st === 'key';
    } else if (c === '{' || c === '[') {
      stack.push({ t: c, st: c === '{' ? 'key' : 'value' });
      lastStruct = i + 1;
    } else if (c === '}' || c === ']') {
      stack.pop();
      const p = stack[stack.length - 1];
      if (p) p.st = 'after';
      lastStruct = i + 1;
      if (!stack.length) return safeParse(t.slice(0, i + 1));
    } else if (c === ':') {
      if (top) top.st = 'value';
      lastStruct = i + 1;
    } else if (c === ',') {
      if (top) top.st = top.t === '{' ? 'key' : 'value';
      lastStruct = i + 1;
    } else if (/\s/.test(c) && top && top.st === 'value' && i > 0 && !/[\s:,[{]/.test(t[i - 1])) {
      top.st = 'after';
      lastStruct = i;
    }
  }
  let out: string;
  if (inStr) {
    out = t.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
    if (esc && out === t) out = out.slice(0, -1);
    out += '"';
    const top = stack[stack.length - 1];
    if (top && keyStr) top.st = 'colon';
  } else {
    out = t.slice(0, Math.max(lastStruct, 0));
    // a cut literal or number after the last token is dropped; its slot then needs a value
    const top = stack[stack.length - 1];
    if (top && t.slice(lastStruct).trim() && top.st !== 'after') top.st = 'value';
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i];
    out = out.replace(/\s+$/, '');
    if (f.t === '{') {
      if (f.st === 'colon') out += ':null';
      else if (f.st === 'value') out += out.endsWith(':') ? 'null' : '';
      if (f.st === 'key') out = out.replace(/,$/, '');
      out += '}';
    } else {
      if (f.st === 'value') out = out.replace(/,$/, '');
      out += ']';
    }
  }
  return safeParse(out);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
