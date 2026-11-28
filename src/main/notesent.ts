/**
 * Spec 116 T009: which sessions have had the memory note. One small file in userData: SHA-256 fingerprints (32 hex) of `<app id>:<resume id>`,
 * never an id, a path or a text. At most MAX entries (the oldest go), atomic write (tmp + rename) after the send succeeds. A missing or corrupt
 * file reads as empty: the note may go once more, never anything else. `claim` is taken before the send and `release`d if it fails, so two quick
 * sends carry the note at most once. No Electron: the file path is injected.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const MAX_SENT = 2000;
const MAX_FILE = 256 * 1024;
export const fingerprint = (appId: string, resumeId: string): string => createHash('sha256').update(`${appId}:${resumeId}`, 'utf8').digest('hex').slice(0, 32);

export class NoteSentStore {
  private list: string[] = [];
  private readonly claimed = new Set<string>();
  constructor(private readonly file: string) {
    try {
      if (fs.statSync(file).size <= MAX_FILE) {
        const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { sent?: unknown };
        if (j && Array.isArray(j.sent)) this.list = j.sent.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{32}$/.test(x)).slice(-MAX_SENT);
      }
    } catch { this.list = []; }
  }
  has(key: string): boolean { return this.list.includes(key) || this.claimed.has(key); }
  /** true when this call took it: nobody has it and nobody else is sending it */
  claim(key: string): boolean { if (this.has(key)) return false; this.claimed.add(key); return true; }
  release(key: string): void { this.claimed.delete(key); }
  /** after a successful send: kept for good (written now) */
  commit(key: string): void {
    this.claimed.delete(key);
    if (this.list.includes(key)) return;
    this.list.push(key);
    if (this.list.length > MAX_SENT) this.list = this.list.slice(-MAX_SENT);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ sent: this.list }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch { /* kept in memory for this run; the note may go once more after a restart */ }
  }
}
