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
}

type Refusal = { ok: false; code: 'invalid'; error: string };
const refuse = (error: string): Refusal => ({ ok: false, code: 'invalid', error });

/** FR-009: the first 16 hex characters of SHA-256 of the message text with `\r\n` turned into `\n` and the ends trimmed. */
export function digestOf(raw: string): string {
  return createHash('sha256').update(rawDigestInput(raw), 'utf8').digest('hex').slice(0, 16);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export class NotesOps {
  constructor(private readonly d: NotesOpsDeps) {}

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

  async list(agentId: unknown): Promise<NotesView | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    return t.store.list(t.key);
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
    return t.store.save(t.key, t.name, { text, from: kind, source, values: this.values(t.key, t.a.id) });
  }

  /** FR-012: a note typed by hand. */
  async add(agentId: unknown, input: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    if (!isObj(input) || typeof input.text !== 'string' || !input.text.trim()) return refuse('The note is empty.');
    if (input.text.length > NOTES_LIMITS.inputChars) return refuse('That note is too long.');
    return t.store.add(t.key, t.name, { text: input.text, from: 'typed', values: this.values(t.key) });
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
    return t.store.update(t.key, t.name, id, rev, { title: title as string | undefined, text: text as string | undefined, done: done as boolean | undefined, values: this.values(t.key, t.a.id) });
  }

  async remove(agentId: unknown, id: unknown, rev: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    if (typeof id !== 'string' || !NOTE_ID_RE.test(id)) return refuse('Unknown note.');
    if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 1) return refuse('Unknown version of the note.');
    return t.store.remove(t.key, t.name, id, rev);
  }

  async removeAll(agentId: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    return t.store.removeAll(t.key, t.name);
  }

  async startOver(agentId: unknown): Promise<NotesWrote | Refusal> {
    const t = this.target(agentId);
    if ('ok' in t) return t;
    return t.store.startOver(t.key);
  }
}
