/**
 * App settings kept as one small JSON file in userData (spec 011 FR-012): today only the global default AI-credit cap.
 * Numbers only; no tokens, no content. Tolerant read, atomic write, failures swallowed (like FolderStore).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCap, parseSettings } from '../shared/credits';
import type { AppSettings } from '../shared/credits';
import { setPlaceEntry } from '../shared/places';
import type { PlaceMap } from '../shared/places';

export class SettingsStore {
  private s: AppSettings = {};
  constructor(private readonly file: string) {}

  load(): AppSettings {
    try {
      this.s = parseSettings(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.s = {};
    }
    return { ...this.s };
  }

  get defaultMaxAiCredits(): number | undefined {
    return this.s.defaultMaxAiCredits;
  }

  /** `undefined`/invalid clears the default. Returns the stored value. */
  setDefaultMaxAiCredits(v: unknown): number | undefined {
    const cap = parseCap(v);
    const next: AppSettings = { ...this.s };
    if (cap === undefined) delete next.defaultMaxAiCredits;
    else next.defaultMaxAiCredits = cap;
    this.s = next;
    this.save();
    return cap;
  }

  /** Serious mode (spec 034): off by default. */
  get seriousMode(): boolean {
    return this.s.seriousMode === true;
  }

  /** Only a real boolean changes it; anything else keeps the current value. Returns the value now in force. */
  setSeriousMode(v: unknown): boolean {
    if (typeof v !== 'boolean') return this.seriousMode;
    const next: AppSettings = { ...this.s };
    if (v) next.seriousMode = true;
    else delete next.seriousMode;
    this.s = next;
    this.save();
    return v;
  }

  /** Place mapping (spec 024): MCP server name -> place id or `desk`. A copy, never the stored object. */
  get placeMap(): PlaceMap {
    return { ...(this.s.placeMap ?? {}) };
  }

  /** Set one entry, or clear it with `null`. Invalid input changes nothing. Returns `ok` and the resulting map. */
  setPlace(server: unknown, choice: unknown): { ok: boolean; placeMap: PlaceMap } {
    const r = setPlaceEntry(this.s.placeMap ?? {}, server, choice);
    if (r.ok) {
      const next: AppSettings = { ...this.s };
      if (Object.keys(r.map).length) next.placeMap = r.map;
      else delete next.placeMap;
      this.s = next;
      this.save();
    }
    return { ok: r.ok, placeMap: { ...(this.s.placeMap ?? {}) } };
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...this.s }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {
      /* read-only profile, disk full, ...: keep working without persistence */
    }
  }
}
