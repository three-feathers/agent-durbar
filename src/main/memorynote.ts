/**
 * Spec 116 T009 (FR-022, FR-050, FR-001): the memory note for one session's first typed message. Pure of Electron: every dependency is injected.
 * `preview` builds the block for the composer (the nonce stays in memory here, per agent, never on disk or in a log); `take` is asked by the send:
 * it rebuilds the block with the previewed nonce and hands it out only when it equals what the person saw, byte for byte. Everything fails closed:
 * the memory off or refused (`roots` empty), a throw, a path with a hidden character, a changed preview, an already sent session: no note.
 * Durbar reads only the folder's top-level NAMES (one `readdir`): never a file (FR-050).
 */
import { randomBytes } from 'crypto';
import { entryNameOf, noteBody, noteClose, noteOpen } from '../shared/memorynote';
import { unhide } from '../shared/redact';
import { drawNonce, firstMessageChain } from './firstmessage';

export interface MemoryNoteDeps {
  /** `MemoryOps.readRoots()`: the real path of the folder while the memory is on and T002 passes now, else none */
  roots(agentId: string): string[];
  /** ONE `readdir` of the folder's top level, names only */
  names(dir: string): string[];
  /** the session's record key (`fingerprint(app id, resume id)`), or undefined when it cannot be told */
  keyOf(agentId: string): string | undefined;
  sent: { has(key: string): boolean; claim(key: string): boolean; release(key: string): void; commit(key: string): void };
  nonce?: () => string;
}
export interface NotePreview { id: string; text: string }
export interface NoteTaken { text: string; commit(): void; release(): void }

const MAX_PENDING = 64;

export class MemoryNote {
  private pending = new Map<string, { id: string; nonce: string; text: string }>();
  constructor(private readonly d: MemoryNoteDeps) {}

  /** the block with this nonce, or undefined (memory not usable, a bad path, a throw) */
  private build(agentId: string, nonce: string): string | undefined {
    try {
      const dir = this.d.roots(agentId)[0];
      if (typeof dir !== 'string' || !dir || unhide(dir) !== dir || /[\u0000-\u001f\u007f]/.test(dir)) return undefined;
      let names: string[] = [];
      try { names = this.d.names(dir); } catch { names = []; } // a folder that cannot be listed still gets its note, without an entry line
      const chain = firstMessageChain([{ id: 'memory', open: noteOpen, body: noteBody(dir, entryNameOf(names)), close: noteClose }], { nonces: [nonce] });
      return chain?.text;
    } catch { return undefined; }
  }

  private sentAlready(agentId: string): boolean {
    const k = this.d.keyOf(agentId);
    return k === undefined || this.d.sent.has(k);
  }

  /** for the composer: undefined when nothing will be sent (already sent, off, refused, unknown) */
  preview(agentId: string): NotePreview | undefined {
    this.pending.delete(agentId);
    try {
      if (this.sentAlready(agentId)) return undefined;
      const nonce = (this.d.nonce ?? drawNonce)();
      const text = this.build(agentId, nonce);
      if (text === undefined) return undefined;
      const id = randomBytes(8).toString('hex');
      if (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string);
      this.pending.set(agentId, { id, nonce, text });
      return { id, text };
    } catch { return undefined; }
  }

  /** for the send, on a typed first message: the exact previewed text, claimed for this send, or undefined */
  take(agentId: string, noteId: unknown): NoteTaken | undefined {
    let key: string | undefined;
    let claimed = false;
    try {
      const p = this.pending.get(agentId);
      if (!p || typeof noteId !== 'string' || noteId !== p.id) return undefined;
      key = this.d.keyOf(agentId);
      if (key === undefined || !this.d.sent.claim(key)) return undefined;
      claimed = true;
      const text = this.build(agentId, p.nonce);
      if (text === undefined || text !== p.text) { this.d.sent.release(key); this.pending.delete(agentId); return undefined; }
      const k = key;
      return {
        text,
        commit: () => { this.d.sent.commit(k); this.pending.delete(agentId); },
        release: () => this.d.sent.release(k),
      };
    } catch {
      if (claimed && key !== undefined) { try { this.d.sent.release(key); } catch { /* nothing more to do */ } }
      return undefined;
    }
  }
}
