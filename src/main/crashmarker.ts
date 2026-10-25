/**
 * Spec 006 FR-038..FR-040 (issue #606): the running marker. A small file in the profile folder that exists only while Durbar runs
 * and lists, as ids, the main sessions that were working. Found at the next start, it means the last run did not end normally and
 * says which sessions were in the middle of a turn. Principle III: ids only, no prompt, reply, title, path or token; mode 0600.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sessionIdOk } from '../shared/sessionid';

export interface BusySession {
  id: string;
  adapterId: string;
}
export interface RunMarker {
  version: 1;
  startedAt: number;
  /** The process that writes it (FR-038, review of PR 720): another Durbar on the same profile that is still running is not a crash. */
  pid?: number;
  /** `os.uptime()` in seconds at that process's last write ("last seen"): it only grows within one boot, whatever the wall clock does. */
  up?: number;
  busy: BusySession[];
}

/** FR-038: each Durbar process keeps its own marker, `durbar-running.<pid>.json`, so two processes on one profile never read or remove each other's. */
export const MARKER_RE = /^durbar-running\.([1-9][0-9]{0,9})\.json$/;
export const markerName = (pid: number): string => `durbar-running.${pid}.json`;
/** The temp file a write goes through; a crash inside `write()` can leave one behind (removed at the next start when its process is gone). */
export const TMP_RE = /^durbar-running\.([1-9][0-9]{0,9})\.json\.tmp$/;
/** At most this many marker and temp files are looked at in one start (a profile folder holds one per Durbar process). */
export const MAX_SCAN = 64;
/**
 * A marker whose recorded uptime is more than this many seconds above the uptime now cannot be from this boot (uptime only grows
 * within a boot), so its pid, even if alive, was reused after a reboot. The margin covers rounding and a counter read on another core.
 */
export const UPTIME_MARGIN_S = 60;
/**
 * While any session is busy, the last-seen uptime is rewritten this often even when nothing else changes (a long turn has no
 * status change), so after a crash it is at most this old. An idle Durbar is not refreshed: a crash with nothing busy shows no card.
 */
export const REFRESH_MS = 120_000;
/** A marker larger than this is not ours (24 ids are about 2 KB); it is never read into memory. */
export const MAX_MARKER_BYTES = 64 * 1024;

/** At most this many busy sessions are kept (the office holds 15 agents and a folder restores at most 6 sessions). */
export const MAX_BUSY = 24;
const ADAPTER_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** The busy sessions of a list, validated: strict ids, strict adapter ids, no duplicates, at most MAX_BUSY. Anything else is dropped. */
export function cleanBusy(v: unknown): BusySession[] {
  if (!Array.isArray(v)) return [];
  const out: BusySession[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (out.length >= MAX_BUSY) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const adapterId = o.adapterId;
    if (typeof adapterId !== 'string' || !ADAPTER_ID.test(adapterId) || !sessionIdOk(adapterId, o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id, adapterId });
  }
  return out;
}

/** Parses a marker file. Null when it is not a marker at all; a marker with bad entries keeps the good ones (the run was still unclean). */
export function parseMarker(text: string): RunMarker | null {
  if (text.length > MAX_MARKER_BYTES) return null;
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const startedAt = typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? Math.round(o.startedAt) : 0;
  const pid = typeof o.pid === 'number' && Number.isInteger(o.pid) && o.pid > 0 ? o.pid : undefined;
  const up = typeof o.up === 'number' && Number.isFinite(o.up) && o.up >= 0 ? Math.round(o.up) : undefined;
  return { version: 1, startedAt, ...(pid ? { pid } : {}), ...(up !== undefined ? { up } : {}), busy: cleanBusy(o.busy) };
}

export function serializeMarker(m: RunMarker): string {
  return JSON.stringify({ version: 1, startedAt: m.startedAt, ...(m.pid ? { pid: m.pid } : {}), ...(m.up !== undefined ? { up: m.up } : {}), busy: cleanBusy(m.busy) });
}

/** Reads a marker file with the size checked first (fstat), so a huge file is never read. Undefined: no file; null: there, but not a marker. */
export function readMarkerFile(file: string): RunMarker | null | undefined {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return undefined;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_MARKER_BYTES) return null;
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) break;
      off += n;
    }
    return parseMarker(buf.subarray(0, off).toString('utf8'));
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* closed */
    }
  }
}

/** Whether a process with this id runs now (EPERM: it runs, as another user). Works on Windows, macOS and Linux. */
export function pidAlive(pid: number, kill: (pid: number, sig: 0) => unknown = (p, sig) => process.kill(p, sig)): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

export interface RestoredSession {
  id: string;
  adapterId: string;
  /** Restored lazily as the folder's remembered session (spec 006 FR-021): it resumes when asked. */
  resumeLast: boolean;
  /** The name the office shows for its folder. */
  folderName: string;
}
export interface Interrupted {
  id: string;
  adapterId: string;
  folderName: string;
}

/** FR-040: the busy sessions of the previous run that this start brought back as resumable lazy agents (same agent app), in the marker's order. */
export function interruptedFrom(prev: RunMarker | null, restored: Iterable<RestoredSession>): { items: Interrupted[]; missing: number } {
  if (!prev) return { items: [], missing: 0 };
  const byId = new Map<string, RestoredSession>();
  for (const r of restored) byId.set(r.id, r);
  const items: Interrupted[] = [];
  for (const b of prev.busy) {
    const r = byId.get(b.id);
    if (r && r.resumeLast && r.adapterId === b.adapterId) items.push({ id: r.id, adapterId: r.adapterId, folderName: r.folderName });
  }
  return { items, missing: prev.busy.length - items.length };
}

type Timer = ReturnType<typeof setTimeout>;
export interface MarkerDeps {
  now?: () => number;
  /** This process's id (tests). */
  pid?: number;
  /** Whether another process runs (tests). */
  alive?: (pid: number) => boolean;
  /** `os.uptime()` in seconds (tests). */
  uptime?: () => number;
  /** The last-seen refresh timer (tests); the default is an unref'd setTimeout, so it never keeps the process alive. */
  setRefresh?: (fn: () => void, ms: number) => Timer;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}

export class CrashMarker {
  private busy: BusySession[] = [];
  private timer: Timer | undefined;
  private active = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (t: Timer) => void;
  private readonly pid: number;
  private readonly alive: (pid: number) => boolean;
  private readonly uptime: () => number;
  private writtenCore = '';
  private refresh: Timer | undefined;
  private readonly setRefresh: (fn: () => void, ms: number) => Timer;
  /** This process's own marker file. */
  readonly file: string;
  private startedAt = 0;

  /** `dir` is the profile folder; the file is `durbar-running.<pid>.json` in it. */
  constructor(private readonly dir: string, deps: MarkerDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
    this.pid = deps.pid ?? process.pid;
    this.alive = deps.alive ?? ((p) => pidAlive(p));
    this.uptime = deps.uptime ?? (() => os.uptime());
    this.setRefresh = deps.setRefresh ?? ((fn, ms) => {
      const t = setTimeout(fn, ms);
      (t as { unref?: () => void }).unref?.();
      return t;
    });
    this.file = path.join(dir, markerName(this.pid));
  }

  /**
   * Reads the markers earlier runs left and writes this run's own. A marker whose process still runs belongs to another Durbar on the
   * same profile: it is left alone and is not a crash. The others are from runs that never ended normally: their busy sessions are
   * merged (in order, no duplicates) and the files removed. Null marker: nothing was left (a clean exit or a first run).
   */
  begin(): { unclean: boolean; marker: RunMarker | null } {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      names = [];
    }
    let unclean = false;
    let startedAt = 0;
    const busy: BusySession[] = [];
    const upNow = this.uptime();
    let scanned = 0;
    for (const name of names.sort()) {
      const m = MARKER_RE.exec(name);
      const t = m ? null : TMP_RE.exec(name);
      if (!m && !t) continue; // only our own names: anything else in the profile is never read or removed
      if (++scanned > MAX_SCAN) break;
      const pid = Number((m ?? t)![1]);
      const full = path.join(this.dir, name);
      if (t) {
        // a temp file a crash inside write() left behind; a live process's own temp file is its write in progress
        // (a live pid's temp file stays, even one a reused pid hides: a small file nobody reads; removing a live Durbar's write in progress is worse)
        if (pid === this.pid || !this.alive(pid)) this.remove(full);
        continue;
      }
      const found = readMarkerFile(full);
      if (found === undefined) continue;
      // A live pid is another Durbar on this profile: it is never offered or removed (waking a running Durbar's sessions is worse
      // than a missing card), unless the marker is provably from an earlier boot: it recorded more uptime than this machine has now.
      // After a power loss pids start again and the dead run's pid may belong to another program; uptime, unlike the wall clock,
      // cannot be set forward, so a clock change never makes a running Durbar look dead.
      const earlierBoot = !!found && found.up !== undefined && found.up > upNow + UPTIME_MARGIN_S;
      if (pid !== this.pid && !earlierBoot && this.alive(pid)) continue;
      unclean = true;
      if (found) {
        startedAt = Math.max(startedAt, found.startedAt);
        busy.push(...found.busy);
      }
      this.remove(full);
    }
    this.active = true;
    this.startedAt = this.now();
    this.busy = [];
    this.writtenCore = '';
    this.write();
    const clean = cleanBusy(busy);
    return { unclean, marker: unclean ? { version: 1, startedAt, busy: clean } : null };
  }

  /** The busy set changed: written within 250 ms, and not at all when it is the same as the file already holds. */
  setBusy(list: BusySession[]): void {
    if (!this.active) return;
    this.busy = cleanBusy(list);
    if (this.timer !== undefined) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (this.active) this.write();
    }, 250);
  }

  /** A normal exit: no timer, no file (only this process's own). Synchronous, so it can run in a `process` exit hook. */
  clear(): void {
    this.active = false;
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    if (this.refresh !== undefined) {
      clearTimeout(this.refresh);
      this.refresh = undefined;
    }
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      /* read-only profile: nothing to do */
    }
  }

  private remove(file: string): void {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* read-only profile */
    }
  }

  /** Test hook: write what is pending now. */
  flush(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    if (this.active) this.write();
  }

  /**
   * Writes the marker with the uptime now (last seen). The same content (all but `up`) is not written again, unless something removed
   * the file or `force` (the refresh while sessions are busy).
   */
  private write(force = false): void {
    const core = serializeMarker({ version: 1, startedAt: this.startedAt, pid: this.pid, busy: this.busy });
    if (!force && core === this.writtenCore && fs.existsSync(this.file)) return this.armRefresh();
    const text = serializeMarker({ version: 1, startedAt: this.startedAt, pid: this.pid, up: Math.round(this.uptime()), busy: this.busy });
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.writtenCore = core;
    } catch {
      /* read-only profile, disk full: keep working without it */
    }
    this.armRefresh();
  }

  /** While a session is busy, the last-seen uptime is refreshed every REFRESH_MS (one timer, unref'd); none while all are idle. */
  private armRefresh(): void {
    if (!this.active || this.busy.length === 0 || this.refresh !== undefined) return;
    this.refresh = this.setRefresh(() => {
      this.refresh = undefined;
      if (this.active && this.busy.length) this.write(true);
    }, REFRESH_MS);
  }
}

/**
 * FR-038 wiring for main.ts, kept here so it is tested: no marker under the simulator; otherwise one is begun and removed on every
 * normal exit, through both `will-quit` and the process `exit` hook (app.exit skips will-quit; a crash, kill or power loss runs neither).
 */
export function installCrashMarker(o: { simulator: boolean; dir: string; onWillQuit: (fn: () => void) => void; onExit: (fn: () => void) => void; deps?: MarkerDeps }): { marker: CrashMarker; began: { unclean: boolean; marker: RunMarker | null } } | undefined {
  if (o.simulator) return undefined;
  const marker = new CrashMarker(o.dir, o.deps);
  const began = marker.begin();
  o.onExit(() => marker.clear());
  o.onWillQuit(() => marker.clear());
  return { marker, began };
}
