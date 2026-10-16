/**
 * All-time tool usage on disk (spec 020 FR-004): one small JSON file in userData. No Electron import (the file path is injected).
 * Writes are atomic (tmp + rename), debounced, and flushed on quit. A missing, corrupt or oversized file is an empty document.
 */
import * as fs from 'fs';
import * as path from 'path';
import { emptyDoc, recordEvent, sanitizeDoc } from '../shared/toolusage';
import type { UsageDoc } from '../shared/toolusage';

const MAX_FILE = 2 * 1024 * 1024;

export interface UsageStoreOptions {
  /** Debounce before a change is written (ms). Default 2000. */
  delayMs?: number;
  /** Timer functions, injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => Date;
}

export class UsageStore {
  private doc: UsageDoc;
  private timer: unknown;
  private dirty = false;
  private readonly delayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  private readonly now: () => Date;
  /** Set when the last write failed (read-only disk, ...); counting continues in memory. */
  lastError?: string;

  constructor(private readonly file: string, opts: UsageStoreOptions = {}) {
    this.delayMs = opts.delayMs ?? 2000;
    this.setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; });
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => new Date());
    this.doc = emptyDoc(this.now());
  }

  load(): void {
    try {
      if (fs.statSync(this.file).size > MAX_FILE) return;
      this.doc = sanitizeDoc(JSON.parse(fs.readFileSync(this.file, 'utf8')), this.now());
    } catch {
      this.doc = emptyDoc(this.now());
    }
  }

  /** Count one normalized event for the agent label. Only `toolCall` start/failed change anything. */
  record(label: string, ev: unknown): void {
    if (!recordEvent(this.doc, label, ev)) return;
    this.dirty = true;
    if (this.timer === undefined) this.timer = this.setTimer(() => { this.timer = undefined; this.flush(); }, this.delayMs);
  }

  /** Write now if there is something unsaved (quit, tests). Never throws. */
  flush(): void {
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.doc), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.dirty = false;
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message.slice(0, 160) : 'write failed';
    }
  }

  /** A copy for the renderer. */
  view(): UsageDoc {
    return JSON.parse(JSON.stringify(this.doc)) as UsageDoc;
  }

  /** Forget everything and start counting again from now. */
  reset(): void {
    this.doc = emptyDoc(this.now());
    this.dirty = true;
    this.flush();
  }
}
