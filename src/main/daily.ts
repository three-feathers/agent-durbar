/**
 * Spec 052 round 8 (daily use): what the app remembers between runs that is not a setting. The window's place and size
 * (FR-087) and when the app last quit (FR-089), kept as one small JSON file in userData; the window placement on a
 * display; the "Since you were away" summary; the quit prompt's text (FR-090). Pure except the store's file I/O: no
 * Electron imports, so the unit tests run in Node. No paths, prompts or tokens are written.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Schedule } from './schedules';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState extends Rect {
  maximized: boolean;
}
export interface AppState {
  window?: WindowState;
  /** When the app last quit cleanly (epoch ms). Cleared on start, so a crash never counts as "away". */
  quitAt?: number;
}

export const DEFAULT_SIZE = { width: 1440, height: 900 };
/** Smaller than this is not a usable window; a saved size below it is ignored. */
export const MIN_SIZE = { width: 640, height: 480 };
/** How much of a saved window must still be on the display for it to count as visible. */
const MIN_VISIBLE = { width: 120, height: 80 };
/** FR-089: the card shows only after a longer break than this. */
export const AWAY_MIN_MS = 30 * 60_000;

const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);

/** A saved window state, or undefined for anything malformed. */
export function parseWindowState(v: unknown): WindowState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const x = int(o.x, -100_000, 100_000), y = int(o.y, -100_000, 100_000);
  const width = int(o.width, MIN_SIZE.width, 20_000), height = int(o.height, MIN_SIZE.height, 20_000);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height, maximized: o.maximized === true };
}

/** Tolerant parse of the file: a missing, corrupt or odd file is an empty state. */
export function parseAppState(text: string): AppState {
  try {
    const doc = JSON.parse(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};
    const w = parseWindowState(doc.window);
    const q = int(doc.quitAt, 1, 8_640_000_000_000_000);
    return { ...(w ? { window: w } : {}), ...(q !== undefined ? { quitAt: q } : {}) };
  } catch {
    return {};
  }
}

/**
 * FR-087: where the window opens. `workArea` is the work area of the display that best matches the saved rectangle
 * (Electron's `screen.getDisplayMatching`). A saved window that is still visible there is kept, shrunk to fit and pushed
 * inside; an unknown or off-screen one (less than 120x80 px of it on the display) gets the default size, centred by the OS.
 */
export function placeWindow(saved: WindowState | undefined, workArea: Rect | undefined): { bounds: Partial<Rect> & { width: number; height: number }; maximized: boolean; restored: boolean } {
  const fallback = { bounds: { ...DEFAULT_SIZE }, maximized: false, restored: false };
  if (!saved || !workArea || workArea.width <= 0 || workArea.height <= 0) return fallback;
  const ix = Math.min(saved.x + saved.width, workArea.x + workArea.width) - Math.max(saved.x, workArea.x);
  const iy = Math.min(saved.y + saved.height, workArea.y + workArea.height) - Math.max(saved.y, workArea.y);
  if (ix < MIN_VISIBLE.width || iy < MIN_VISIBLE.height) return { ...fallback, maximized: saved.maximized };
  const width = Math.min(saved.width, workArea.width), height = Math.min(saved.height, workArea.height);
  const x = Math.max(workArea.x, Math.min(saved.x, workArea.x + workArea.width - width));
  const y = Math.max(workArea.y, Math.min(saved.y, workArea.y + workArea.height - height));
  return { bounds: { x, y, width, height }, maximized: saved.maximized, restored: true };
}

export interface MissedRun {
  id: string;
  /** The folder's display name (its label, else its base name); never the full path. */
  folderName: string;
  /** The prompt on one line, whole (at most what the scheduler keeps): the window masks it and then cuts it, so a token is never cut before it is masked (spec 041 FR-065). */
  prompt: string;
  /** A repeating schedule (its next run is still planned) or a one-time one (it will not run again by itself). */
  repeats: boolean;
}
export interface SinceAway {
  awayMs: number;
  missed: MissedRun[];
  /** Spec 085 FR-009: sessions the user ended yesterday and today, numbers only (added when the window asks). */
  briefing?: { sessions: number; files: number; added: number; removed: number; commits: number; minutes: number };
}

const snippet = (t: string): string => t.replace(/\s+/g, ' ').trim();

/**
 * FR-089: what happened while the app was closed, from the stores only. `quitAt` is the saved quit time, `startedAt` the
 * moment this run started (before the scheduler marked missed runs, which it stamps with the start time). Undefined when
 * the quit time is unknown (first run, a crash) or the break was 30 minutes or less.
 */
export function buildSinceAway(quitAt: number | undefined, startedAt: number, schedules: Schedule[], folderName: (folder: string) => string): SinceAway | undefined {
  if (quitAt === undefined || !(startedAt - quitAt > AWAY_MIN_MS)) return undefined;
  const missed = schedules
    .filter((s) => s.last?.outcome === 'missed' && s.last.at >= startedAt)
    .map((s) => ({ id: s.id, folderName: folderName(s.folder), prompt: snippet(s.prompt), repeats: s.every !== undefined || s.rule !== undefined }));
  return { awayMs: startedAt - quitAt, missed };
}

/** FR-090: the quit prompt's text for `n` working agents (n >= 1). */
export function quitMessage(n: number): { message: string; detail: string } {
  return {
    message: n === 1 ? '1 agent is still working. Quit anyway?' : `${n} agents are still working. Quit anyway?`,
    detail: n === 1 ? 'Its reply stops now. Its chat stays, and sending a message later picks up where it left off.' : 'Their replies stop now. Their chats stay, and sending a message later picks up where they left off.',
  };
}

/** The file of `AppState`; written atomically, failures swallowed (the app keeps working without it). */
export class AppStateStore {
  private s: AppState = {};
  constructor(private readonly file: string) {}

  load(): AppState {
    try {
      this.s = parseAppState(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.s = {};
    }
    return { ...this.s };
  }

  get window(): WindowState | undefined {
    return this.s.window ? { ...this.s.window } : undefined;
  }

  get quitAt(): number | undefined {
    return this.s.quitAt;
  }

  setWindow(w: unknown): void {
    const next = parseWindowState(w);
    if (!next) return;
    const cur = this.s.window;
    if (cur && cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height && cur.maximized === next.maximized) return;
    this.s = { ...this.s, window: next };
    this.save();
  }

  /** `undefined` clears it (done on start: an unclean exit leaves no quit time). */
  setQuitAt(t: number | undefined): void {
    if (t === this.s.quitAt) return;
    const next: AppState = { ...this.s };
    if (t === undefined) delete next.quitAt;
    else next.quitAt = Math.round(t);
    this.s = next;
    this.save();
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...this.s }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {
      /* read-only profile, disk full, ...: keep working without it */
    }
  }
}
