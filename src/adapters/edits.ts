/**
 * Spec 005 FR-018/FR-019: the file-changing tools of each agent app and their argument shapes, turned into the neutral
 * `EditInfo` (src/shared/edits.ts). Adapter side: tool names and argument keys of Claude Code, Copilot and Codex live here only.
 *
 * - Claude Code: `Edit {file_path, old_string, new_string}`, `MultiEdit {file_path, edits[{old_string, new_string}]}`,
 *   `Write {file_path, content}`, `NotebookEdit {notebook_path, new_source, edit_mode}` (read: Claude Code tool docs).
 * - Copilot: `edit {path, old_str, new_str}`, `create {path, file_text}`, `str_replace_editor {command, path, ...}` (read: Copilot
 *   CLI tool list), `apply_patch` with the patch as one string (real: argument types counted in local session logs, no content read).
 * - Codex: `fileChange` items carry `changes[{path, kind, diff}]` (read: `codex app-server generate-ts`, codex-cli 0.163.0); the
 *   Codex mapper calls `codexEdit` directly.
 */
import { codexFileChanges } from './codexModes';
import { cleanPath, diffFile, editFile, finishEdit, partialJson, patchFiles, type EditFile, type EditInfo, type EditKind } from '../shared/edits';

/** Tool names (lower case) whose calls change files. */
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write', 'notebookedit', 'create', 'str_replace_editor', 'str_replace_based_edit_tool', 'apply_patch']);

export const isEditTool = (name: unknown): boolean => typeof name === 'string' && EDIT_TOOLS.has(name.toLowerCase());

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The patch text of an `apply_patch` call: the whole argument, or its `input`/`patch` field. */
function patchText(args: unknown): string | undefined {
  if (typeof args === 'string') return args;
  return isObj(args) ? (s(args.input) ?? s(args.patch)) : undefined;
}

/** The file a call touches as soon as the arguments name it (also from a partial argument object). */
export function editPath(tool: string, args: unknown): string | undefined {
  if (!isEditTool(tool)) return undefined;
  const p = patchText(args);
  if (p !== undefined) return patchFiles(p)[0]?.path || undefined;
  if (!isObj(args)) return undefined;
  return s(args.file_path) ?? s(args.path) ?? s(args.notebook_path) ?? undefined;
}

/**
 * The files a call changes, raw (not yet masked or cut). `partial`: the arguments are still being written, so an edit whose new
 * text has not started yet shows the file only (FR-027: the old text alone is not a removal; real Claude Code stream, T036).
 */
function filesOf(tool: string, args: unknown, partial?: boolean): EditFile[] {
  const t = tool.toLowerCase();
  const p = patchText(args);
  if (t === 'apply_patch' || (p !== undefined && /^\*\*\* Begin Patch/m.test(p))) return p !== undefined ? patchFiles(p) : [];
  if (!isObj(args)) return [];
  const path = s(args.file_path) ?? s(args.path) ?? s(args.notebook_path);
  if (!path) return [];
  switch (t) {
    case 'multiedit': {
      const edits = (Array.isArray(args.edits) ? args.edits.filter(isObj) : []).filter((e) => !partial || s(e.new_string) !== undefined);
      const parts = edits.map((e) => editFile(path, 'edit', s(e.old_string) ?? '', s(e.new_string) ?? '')).filter((f) => f.diff);
      if (!parts.length) return [{ path, kind: 'edit' }];
      return [{ path, kind: 'edit', diff: parts.map((f) => f.diff).join('\n'), added: parts.reduce((n, f) => n + (f.added ?? 0), 0), removed: parts.reduce((n, f) => n + (f.removed ?? 0), 0) }];
    }
    case 'write':
      return [editFile(path, 'write', undefined, s(args.content))];
    case 'create':
      return [editFile(path, 'create', undefined, s(args.file_text) ?? s(args.content))];
    case 'notebookedit': {
      const mode = s(args.edit_mode);
      if (mode === 'delete') return [{ path, kind: 'edit' }];
      return [editFile(path, 'edit', undefined, s(args.new_source))];
    }
    case 'str_replace_editor':
    case 'str_replace_based_edit_tool': {
      const cmd = s(args.command);
      if (cmd === 'view' || cmd === 'undo_edit') return [];
      if (cmd === 'create') return [editFile(path, 'create', undefined, s(args.file_text))];
      if (cmd === 'insert') return [editFile(path, 'edit', undefined, s(args.new_str))];
      if (partial && s(args.new_str) === undefined) return [{ path, kind: 'edit' }];
      return [editFile(path, 'edit', s(args.old_str) ?? '', s(args.new_str) ?? '')];
    }
    default: {
      // Claude `Edit`, Copilot `edit`
      const oldText = s(args.old_string) ?? s(args.old_str);
      const newText = s(args.new_string) ?? s(args.new_str);
      if ((oldText === undefined && newText === undefined) || (partial && newText === undefined)) return [{ path, kind: 'edit' }];
      return [editFile(path, 'edit', oldText ?? '', newText ?? '')];
    }
  }
}

/** The normalized edit of a call, or undefined when the tool does not change files or names no file yet. */
export function editOf(tool: string, args: unknown, partial?: boolean): EditInfo | undefined {
  if (!isEditTool(tool)) return undefined;
  try {
    return finishEdit(filesOf(tool, args, partial), partial);
  } catch {
    return undefined;
  }
}

/**
 * Codex `fileChange.changes` as an edit. Read once, by spec 052's `codexFileChanges` (the permission card's reader, #470), so the chat
 * row and the card agree; the text follows the kind (`diffFile`): an add is the new file, a delete the old one, an update a hunk.
 */
export function codexEdit(changes: unknown, partial?: boolean): EditInfo | undefined {
  if (!Array.isArray(changes)) return undefined;
  try {
    const files = codexFileChanges(changes).map((c) => {
      const kind: EditKind = c.kind === 'add' ? 'create' : c.kind === 'delete' ? 'delete' : c.movePath ? 'move' : 'edit';
      return diffFile(c.path, kind, c.diff, kind === 'move' ? c.movePath : undefined);
    });
    return finishEdit(files, partial);
  } catch {
    return undefined;
  }
}

/** The first `*** Add|Update|Delete File:` path of a patch text, only once its line is complete (a newline follows it). */
function patchLinePath(t: string): string | undefined {
  const m = /^\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+)\r?\n/m.exec(t);
  return m ? m[1].trim() || undefined : undefined;
}

/** Longest argument stream kept per call (characters, FR-024). */
export const ARG_STREAM_MAX = 1_000_000;

/**
 * A tool call's arguments as they stream in (JSON text, or raw text for a custom tool such as `apply_patch`). Re-parsed only
 * after the text grew by an eighth (at least 128 characters), so the total cost stays linear in the size of the arguments.
 */
export class ArgStream {
  private text = '';
  private nextAt = 0;
  private full = false;
  constructor(public tool: string) {}

  get length(): number {
    return this.text.length;
  }

  /**
   * The file the arguments name, only once its value is complete (a closed JSON string, or a whole `*** ... File:` line of a
   * raw patch), so a half-written path is never shown.
   */
  path(): string | undefined {
    const t = this.text;
    if (/^\s*[{[]/.test(t)) {
      const m = /"(?:file_path|path|notebook_path)"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(t);
      if (m) {
        try {
          return (JSON.parse(m[1]) as string) || undefined;
        } catch {
          return undefined;
        }
      }
      // Copilot `apply_patch` as JSON (`{"input": "*** Begin Patch\n…"}`, review on #463): the patch string so far, read like raw text
      if (!/"(?:input|patch)"\s*:/.test(t)) return undefined;
      const p = patchText(partialJson(t.trimStart()));
      return p === undefined ? undefined : patchLinePath(p);
    }
    return patchLinePath(t);
  }

  /** Add a fragment; true when the arguments should be parsed again now. */
  append(delta: string): boolean {
    if (this.full || typeof delta !== 'string' || !delta) return false;
    this.text += delta;
    if (this.text.length > ARG_STREAM_MAX) {
      this.text = this.text.slice(0, ARG_STREAM_MAX);
      this.full = true;
      return true;
    }
    if (this.text.length < this.nextAt) return false;
    this.nextAt = this.text.length + Math.max(128, this.text.length >> 3);
    return true;
  }

  /** The arguments so far: a (repaired) JSON value, or the raw text when it is not JSON. */
  value(): unknown {
    const t = this.text.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) return partialJson(t);
    return this.text;
  }
}

/** What a fragment of streamed arguments asks the mapper to emit: the early `start` (path only) and/or a partial `update`. */
export type StreamStep = { phase: 'start'; args: { path: string } } | { phase: 'update'; edit: EditInfo };

/** Argument text looked at on every fragment until it names the file (characters). */
const PATH_LOOK_MAX = 4096;
/** Calls whose arguments stream in at most at once (oldest dropped first). */
const STREAMS_MAX = 32;

/**
 * Spec 005 FR-019, shared by the Claude Code and Copilot mappers: the argument streams of file-changing calls, keyed by call id.
 * A call "starts early" as soon as its streamed arguments name the file; the agent app's later whole-call message then becomes
 * an `update` (`takeStarted`).
 */
export class EditStreams {
  private streams = new Map<string, ArgStream>();
  private started = new Set<string>();

  /** A call whose arguments are about to stream (its name is known first). Only file-changing tools are kept. */
  begin(callId: string, tool: string): void {
    if (isEditTool(tool) && !this.streams.has(callId) && !this.started.has(callId)) this.open(callId, tool);
  }

  private open(callId: string, tool: string): ArgStream {
    if (this.streams.size >= STREAMS_MAX) this.streams.delete(this.streams.keys().next().value as string);
    const st = new ArgStream(tool);
    this.streams.set(callId, st);
    return st;
  }

  /** A fragment of a call's arguments. `tool` may come with any fragment (Copilot names it "when known"); a call with no name
   *  yet is kept until one arrives, a call named by a tool that changes no files is dropped. */
  delta(callId: string, delta: string, tool?: string): StreamStep[] {
    let st = this.streams.get(callId);
    if (!st) {
      if (this.started.has(callId) || (tool !== undefined && !isEditTool(tool))) return [];
      st = this.open(callId, tool ?? ''); // no name yet: kept until a later fragment names the tool
    } else if (tool && !st.tool) {
      if (!isEditTool(tool)) {
        this.streams.delete(callId);
        return [];
      }
      st.tool = tool;
    }
    const due = st.append(delta);
    if (!st.tool) return [];
    // until the file is named, every fragment is looked at (the path comes first and early; capped so this stays cheap)
    if (!due && (this.started.has(callId) || st.length > PATH_LOOK_MAX)) return [];
    const out: StreamStep[] = [];
    if (!this.started.has(callId)) {
      const path = st.path();
      if (!path) return [];
      if (this.started.size >= STREAMS_MAX * 4) this.started.delete(this.started.values().next().value as string);
      this.started.add(callId);
      out.push({ phase: 'start', args: { path: cleanPath(path) } }); // masked like the edit's own paths (FR-024)
    }
    const edit = editOf(st.tool, st.value(), true);
    if (edit) out.push({ phase: 'update', edit });
    return out;
  }

  /** The tool of a call whose stream is open (Copilot: the name may only come with a later fragment). */
  toolOf(callId: string): string | undefined {
    return this.streams.get(callId)?.tool;
  }

  /** True when the call already started early; forgets its stream either way. */
  takeStarted(callId: string): boolean {
    this.streams.delete(callId);
    return this.started.delete(callId);
  }

  clear(): void {
    this.streams.clear();
    this.started.clear();
  }

  get size(): number {
    return this.streams.size + this.started.size;
  }
}
