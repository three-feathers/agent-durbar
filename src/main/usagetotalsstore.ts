/**
 * Credit totals per folder, kept on disk across restarts (spec 011 FR-025, issue #21): one small JSON file in userData.
 * Numbers, folder display names and path fingerprints only (never a path). Writes are atomic (tmp + rename), debounced and
 * flushed on quit; a missing, corrupt or oversized file is an empty document. No Electron import: the file path is injected.
 *
 * Two views exist on purpose. `doc` is what is on disk and grows with every event. `baseline` is a copy taken when the file was
 * loaded (and emptied by a reset): the window adds what *this run* recorded on top of it, so an event is never counted twice
 * however late the window asks.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { emptyUsageDoc, normaliseFolderKey, officeTotals, recordUsage, sanitizeUsageDoc } from '../shared/usagedoc';
import type { UsageNumbers, UsageTotalsDoc } from '../shared/usagedoc';

const MAX_FILE = 2 * 1024 * 1024;

export interface UsageTotalsStoreOptions {
  /** Debounce before a change is written (ms). Default 2000. */
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => Date;
  /** Platform used to normalise folder keys. Default `process.platform`. */
  platform?: string;
}

/** The fingerprint a folder is saved under: the first 32 hex characters of SHA-256 of its normalised key. */
export function folderFingerprint(folderKey: string, platform: string = process.platform): string {
  return crypto.createHash('sha256').update(normaliseFolderKey(folderKey, platform), 'utf8').digest('hex').slice(0, 32);
}

export class UsageTotalsStore {
  private doc: UsageTotalsDoc;
  private baseline: UsageTotalsDoc;
  private timer: unknown;
  private dirty = false;
  private readonly delayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  private readonly now: () => Date;
  private readonly platform: string;
  /** Set when the last write failed (read-only disk, ...); counting continues in memory. */
  lastError?: string;

  constructor(private readonly file: string, opts: UsageTotalsStoreOptions = {}) {
    this.delayMs = opts.delayMs ?? 2000;
    this.setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; });
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => new Date());
    this.platform = opts.platform ?? process.platform;
    this.doc = emptyUsageDoc(this.now());
    this.baseline = this.copy(this.doc);
  }

  private copy(d: UsageTotalsDoc): UsageTotalsDoc {
    return sanitizeUsageDoc(JSON.parse(JSON.stringify(d)), this.now());
  }

  keyFor(folderKey: string): string {
    return folderFingerprint(folderKey, this.platform);
  }

  load(): void {
    try {
      if (fs.statSync(this.file).size > MAX_FILE) throw new Error('too large');
      this.doc = sanitizeUsageDoc(JSON.parse(fs.readFileSync(this.file, 'utf8')), this.now());
    } catch {
      this.doc = emptyUsageDoc(this.now());
    }
    this.baseline = this.copy(this.doc);
  }

  /** Count one normalized event for the folder (`workspaceFile ?? cwd` of the agent). Only `usage` events change anything. */
  record(folderKey: string, name: string, ev: unknown): void {
    if (!recordUsage(this.doc, this.keyFor(folderKey), name, ev)) return;
    this.dirty = true;
    if (this.timer === undefined) this.timer = this.setTimer(() => { this.timer = undefined; this.flush(); }, this.delayMs);
  }

  /** Write now if there is something unsaved (quit, tests). Never throws. */
  flush(): void {
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.doc), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.dirty = false;
      this.lastError = undefined;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message.slice(0, 160) : 'write failed';
    }
  }

  /** What was saved before this run (or since the last reset): the window adds this run's own figures on top of it. */
  baselineView(): { since: string; office: UsageNumbers; folderOf: (folderKey: string) => (UsageNumbers & { name: string }) | undefined } {
    const b = this.baseline;
    return { since: b.since, office: officeTotals(b), folderOf: (k) => b.folders[this.keyFor(k)] };
  }

  /** The saved document as it is on disk now (tests, diagnostics). */
  view(): UsageTotalsDoc {
    return this.copy(this.doc);
  }

  /** Forget every total and start counting from now: the baseline and the file are both empty afterwards. */
  reset(): void {
    this.doc = emptyUsageDoc(this.now());
    this.baseline = this.copy(this.doc);
    this.dirty = true;
    this.flush();
  }
}
