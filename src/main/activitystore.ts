/**
 * Activity log (spec 052 FR-071): one small JSON file in userData (`activity.json`) with the newest 5000 rows of permission
 * answers, automatic approvals, mode changes and limit changes. Rows are cleaned by `sanitizeActivityRow` (names, a folder base
 * name and a redacted summary of at most 160 characters; never prompts, replies, file contents or tool output). Writes are atomic
 * (tmp + rename), debounced and flushed on quit; a missing, corrupt or oversized file is an empty log. No Electron import: the
 * file path is injected.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ACTIVITY_MAX_ROWS, appendCapped, sanitizeActivityRow } from '../shared/activity';
import type { ActivityRow } from '../shared/activity';

const MAX_FILE = 8 * 1024 * 1024;

export interface ActivityStoreOptions {
  /** Debounce before a change is written (ms). Default 2000. */
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => Date;
  max?: number;
  env?: Record<string, string | undefined>;
}

export class ActivityStore {
  private rows: ActivityRow[] = [];
  private timer: unknown;
  private dirty = false;
  private readonly delayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  private readonly now: () => Date;
  private readonly max: number;
  private readonly env?: Record<string, string | undefined>;
  /** Set when the last write failed; logging continues in memory. */
  lastError?: string;

  constructor(private readonly file: string, opts: ActivityStoreOptions = {}) {
    this.delayMs = opts.delayMs ?? 2000;
    this.setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; });
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => new Date());
    this.max = opts.max ?? ACTIVITY_MAX_ROWS;
    this.env = opts.env;
  }

  load(): void {
    try {
      if (fs.statSync(this.file).size > MAX_FILE) throw new Error('too large');
      const doc = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { rows?: unknown };
      const list = Array.isArray(doc?.rows) ? doc.rows : [];
      const rows: ActivityRow[] = [];
      for (const r of list) {
        const ok = sanitizeActivityRow(r, this.env);
        if (ok) appendCapped(rows, ok, this.max);
      }
      this.rows = rows;
    } catch {
      this.rows = [];
    }
  }

  /** Add one row (time = now). Fields beyond the row's own are dropped; returns the stored row, or undefined when refused. */
  record(row: Omit<ActivityRow, 't'> & Record<string, unknown>): ActivityRow | undefined {
    const clean = sanitizeActivityRow({ ...row, t: this.now().toISOString() }, this.env);
    if (!clean) return undefined;
    appendCapped(this.rows, clean, this.max);
    this.dirty = true;
    if (this.timer === undefined) this.timer = this.setTimer(() => { this.timer = undefined; this.flush(); }, this.delayMs);
    return clean;
  }

  /** The newest `limit` rows, newest first. */
  list(limit?: unknown): ActivityRow[] {
    const n = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), this.max) : this.max;
    return this.rows.slice(-n).reverse().map((r) => ({ ...r }));
  }

  /** Every row, oldest first (export). */
  all(): ActivityRow[] {
    return this.rows.map((r) => ({ ...r }));
  }

  clear(): void {
    this.rows = [];
    this.dirty = true;
    this.flush();
  }

  /** Write now if there is something unsaved (quit, tests). Never throws. */
  flush(): void {
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, rows: this.rows }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.dirty = false;
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message.slice(0, 160) : 'write failed';
    }
  }
}
