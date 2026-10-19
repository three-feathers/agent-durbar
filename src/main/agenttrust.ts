/**
 * Repository agent confirmations (spec 043 FR-003): a custom agent file from the session folder's repository is used only
 * after the user confirmed it for that folder and that exact file content. Saved as `durbar-agent-trust.json` in the app's
 * user-data folder: folder path, agent id and the file's SHA-256, never the file content. Tolerant: a bad file = no trust.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';

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

/** SHA-256 of an agent file (at most 1 MB), or undefined when it cannot be read. */
export function hashAgentFile(file: string): string | undefined {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_AGENT_FILE) return undefined;
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return undefined;
  }
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
