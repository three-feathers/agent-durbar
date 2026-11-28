/**
 * Spec 116 T009: which sessions have had the memory note. One small file in userData: SHA-256 fingerprints (32 hex) of `<app id>:<resume id>:<memory folder>`,
 * never an id, a path or a text. At most MAX entries (the oldest go). The store is read and written without following links, capped and never blocking:
 * read with `readCapped` (`O_NOFOLLOW`, `O_NONBLOCK`, a regular file only, at most MAX_FILE bytes); written to a fresh, randomly named temp file opened
 * exclusively (`wx`) with `O_NOFOLLOW` where it exists and mode 0600, then renamed over the store. A missing, linked, special, oversized or corrupt file
 * reads as empty: the note may go once more, never anything else. `claim` is taken before the send and `release`d if it fails, so two quick sends
 * carry the note at most once. No Electron: the file path (and, for tests, the fs and the random source) are injected.
 */
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readCapped } from '../shared/cappedread';
import { memoryGitFlags } from './memorygit';

export const MAX_SENT = 2000;
export const MAX_FILE = 256 * 1024;
/** The key of one session and one memory folder: a session resumed later with another memory folder is a new key (one note for the new folder). */
export const fingerprint = (appId: string, resumeId: string, folder = ''): string => createHash('sha256').update(`${appId}:${resumeId}${folder === '' ? '' : ':' + folder}`, 'utf8').digest('hex').slice(0, 32);

export interface NoteSentDeps { fs?: typeof fs; rand?: () => string }

export class NoteSentStore {
  private list: string[] = [];
  private readonly claimed = new Set<string>();
  private readonly fs: typeof fs;
  private readonly rand: () => string;
  constructor(private readonly file: string, deps: NoteSentDeps = {}) {
    this.fs = deps.fs ?? fs;
    this.rand = deps.rand ?? ((): string => randomBytes(8).toString('hex'));
    try {
      const r = readCapped(this.fs, memoryGitFlags(this.fs.constants), file, MAX_FILE);
      if (r.ok) {
        const j = JSON.parse(r.buf.toString('utf8')) as { sent?: unknown };
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
    this.write();
  }
  private write(): void {
    const c = this.fs.constants;
    const tmp = `${this.file}.${this.rand()}.tmp`;
    let fd: number | undefined;
    try {
      this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fd = this.fs.openSync(tmp, c.O_WRONLY | c.O_CREAT | c.O_EXCL | (c.O_NOFOLLOW ?? 0), 0o600); // exclusive: a planted file or link at this name is never opened
      this.fs.writeSync(fd, JSON.stringify({ sent: this.list }));
      this.fs.closeSync(fd); fd = undefined;
      this.fs.renameSync(tmp, this.file);
    } catch {
      /* kept in memory for this run; the note may go once more after a restart */
      if (fd !== undefined) { try { this.fs.closeSync(fd); } catch { /* gone */ } try { this.fs.unlinkSync(tmp); } catch { /* not ours to remove */ } }
    }
  }
}
