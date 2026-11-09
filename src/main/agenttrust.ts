/**
 * Repository agent confirmations (spec 043 FR-003): a custom agent file from the session folder's repository is used only
 * after the user confirmed it for that folder and that exact file content. Saved as `durbar-agent-trust.json` in the app's
 * user-data folder: folder path, agent id and the file's SHA-256, never the file content. Tolerant: a bad file = no trust.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import { readCapped, type CappedFlags, type CappedFs } from '../shared/cappedread';

export interface AgentTrust {
  folder: string;
  agentId: string;
  sha256: string;
}

export const MAX_TRUST = 200;
export const MAX_AGENT_FILE = 1024 * 1024;

export function parseAgentTrust(text: string): AgentTrust[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const list = doc && typeof doc === 'object' && Array.isArray((doc as { trusted?: unknown }).trusted) ? (doc as { trusted: unknown[] }).trusted : [];
  const out: AgentTrust[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.folder !== 'string' || !o.folder || o.folder.length > 4096) continue;
    if (typeof o.agentId !== 'string' || !o.agentId || o.agentId.length > 100) continue;
    if (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256)) continue;
    out.push({ folder: o.folder, agentId: o.agentId, sha256: o.sha256 });
    if (out.length >= MAX_TRUST) break;
  }
  return out;
}

/** One read of an agent file: its bytes and their SHA-256 (spec 043 FR-044). */
export interface AgentFileBytes {
  sha256: string;
  bytes: Buffer;
}

/** The file calls `readAgentFile` uses; tests pass flags without `O_NOFOLLOW`, as on Windows. */
export interface AgentFileFs {
  io: CappedFs;
  flags: CappedFlags;
  lstat(file: string): { isSymbolicLink(): boolean; dev: number; ino: number };
}
const nodeFs: AgentFileFs = { io: fs, flags: fs.constants, lstat: (f) => fs.lstatSync(f) };

/**
 * Spec 043 FR-044: an agent file's bytes and their SHA-256 from ONE open, so the hash is of exactly the bytes used. Never follows a
 * final link: `O_NOFOLLOW` where defined; where it is not (Windows) an `lstat` first refuses a link, and the opened file must be the
 * one it saw (same `dev` and `ino`, which on NTFS is the file index). `fstat` on the descriptor: a regular file with one link, at most
 * 1 MB (`readCapped`). Undefined when it cannot be read.
 */
export function readAgentFile(file: string, d: AgentFileFs = nodeFs): AgentFileBytes | undefined {
  let seen: { dev: number; ino: number } | undefined;
  try {
    if (!d.flags.O_NOFOLLOW) {
      const st = d.lstat(file);
      if (st.isSymbolicLink()) return undefined;
      seen = { dev: st.dev, ino: st.ino };
    }
  } catch {
    return undefined;
  }
  const vet = (st: { isFile(): boolean; size: number; nlink: number; dev: number; ino: number }): string | undefined => (seen && (st.dev !== seen.dev || st.ino !== seen.ino) ? 'replaced' : undefined);
  const r = readCapped(d.io, d.flags, file, MAX_AGENT_FILE, vet);
  return r.ok ? { sha256: createHash('sha256').update(r.buf).digest('hex'), bytes: r.buf } : undefined;
}

/** SHA-256 of an agent file (at most 1 MB, `readAgentFile`), or undefined when it cannot be read. */
export function hashAgentFile(file: string): string | undefined {
  return readAgentFile(file)?.sha256;
}

/** Spec 043 FR-044: the confirmation of `agents:selectProfile` is `{ sha256 }` of the text the dialog showed; anything else is not one. */
export function shownSha(confirm: unknown): string | undefined {
  const s = confirm && typeof confirm === 'object' ? (confirm as { sha256?: unknown }).sha256 : undefined;
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s) ? s : undefined;
}

export class AgentTrustStore {
  private list: AgentTrust[] = [];
  constructor(private readonly file: string) {}

  load(): void {
    try {
      this.list = parseAgentTrust(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.list = [];
    }
  }

  isTrusted(folder: string, agentId: string, sha256: string | undefined): boolean {
    return !!sha256 && this.list.some((t) => t.folder === folder && t.agentId === agentId && t.sha256 === sha256);
  }

  /** Remembers the confirmation; an older one for the same folder and agent is replaced (the newest are kept). */
  trust(folder: string, agentId: string, sha256: string): void {
    this.list = this.list.filter((t) => !(t.folder === folder && t.agentId === agentId));
    this.list.push({ folder, agentId, sha256 });
    if (this.list.length > MAX_TRUST) this.list = this.list.slice(this.list.length - MAX_TRUST);
    try {
      fs.writeFileSync(this.file, JSON.stringify({ trusted: this.list }, null, 2));
    } catch {
      /* not saved: it asks again next time */
    }
  }
}
