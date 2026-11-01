/**
 * Spec 085 FR-009: a numbers-only rollup of the sessions the user ended, per local day, for the "Since you were away" line. One small JSON
 * file in userData (like the credit totals of spec 011 FR-025): day `YYYY-MM-DD`, counts, minutes. Never a path, folder name, session name
 * or text. At most 7 days; writes are atomic (tmp + rename, mode 0600); a missing, corrupt or oversized file is an empty rollup. No Electron
 * import: the file and the clock are injected, so the unit tests run in Node.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCapped } from '../shared/cappedread';

export interface DayTotals { day: string; sessions: number; files: number; added: number; removed: number; commits: number; minutes: number }
export type DaySum = Omit<DayTotals, 'day'>;

const MAX_FILE = 64 * 1024;
const MAX_DAYS = 7;
const MAX_N = 1_000_000_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), MAX_N) : 0);

/** The local calendar day of a moment. */
export function localDay(d: Date): string {
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Tolerant parse: only known keys, each a bounded integer; a bad day string drops the entry; the newest 7 days. Own properties only. */
export function parseDays(text: string): DayTotals[] {
  try {
    if (text.length > MAX_FILE) return [];
    const doc = JSON.parse(text) as unknown;
    const list = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as { days?: unknown }).days : undefined;
    if (!Array.isArray(list)) return [];
    const byDay = new Map<string, DayTotals>();
    for (const e of list.slice(0, 64)) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
      const o = e as Record<string, unknown>;
      if (typeof o.day !== 'string' || !DAY.test(o.day) || !Object.prototype.hasOwnProperty.call(o, 'sessions')) continue;
      byDay.set(o.day, { day: o.day, sessions: n(o.sessions), files: n(o.files), added: n(o.added), removed: n(o.removed), commits: n(o.commits), minutes: n(o.minutes) });
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-MAX_DAYS);
  } catch {
    return [];
  }
}

export class SummaryDays {
  private days: DayTotals[] = [];
  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {}

  load(): void {
    try {
      const r = readCapped(fs, fs.constants, this.file, MAX_FILE); /* the limit before the read: a huge file never reaches memory */
      this.days = r.ok ? parseDays(r.buf.toString('utf8')) : [];
    } catch {
      this.days = [];
    }
  }

  /** One ended session's numbers (counts the caller already bounded; clamped again here). */
  add(s: Partial<DaySum>): void {
    const day = localDay(this.now());
    let e = this.days.find((x) => x.day === day);
    if (!e) {
      e = { day, sessions: 0, files: 0, added: 0, removed: 0, commits: 0, minutes: 0 };
      this.days.push(e);
      this.days.sort((a, b) => (a.day < b.day ? -1 : 1));
      this.days = this.days.slice(-MAX_DAYS);
    }
    e.sessions = Math.min(e.sessions + 1, MAX_N);
    for (const k of ['files', 'added', 'removed', 'commits', 'minutes'] as const) e[k] = Math.min(e[k] + n(s[k]), MAX_N);
    this.save();
  }

  /** Yesterday and today (local days) added together; undefined when no session ended on either. */
  recent(): DaySum | undefined {
    const t = this.now();
    const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    const keep = new Set([localDay(t), localDay(y)]);
    const out: DaySum = { sessions: 0, files: 0, added: 0, removed: 0, commits: 0, minutes: 0 };
    for (const e of this.days) if (keep.has(e.day)) for (const k of Object.keys(out) as (keyof DaySum)[]) out[k] = Math.min(out[k] + e[k], MAX_N);
    return out.sessions ? out : undefined;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, days: this.days }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {
      /* read-only profile, disk full: the rollup still works in memory */
    }
  }
}
