/**
 * App settings kept as one small JSON file in userData (spec 011 FR-012): today only the global default AI-credit cap.
 * Numbers only; no tokens, no content. Tolerant read, atomic write, failures swallowed (like FolderStore).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCap, parseSettings } from '../shared/credits';
import type { AppSettings } from '../shared/credits';

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
    this.s = cap === undefined ? {} : { defaultMaxAiCredits: cap };
    this.save();
    return cap;
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
