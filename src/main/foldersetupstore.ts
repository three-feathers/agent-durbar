/**
 * Spec 061 FR-003 / FR-010: the person's decisions on a folder's own setup, per folder key: which item digests were accepted and which
 * declined. Paths and digests only, never a hook's command, a rule or a server (constitution III). A changed item has a new digest,
 * so it is neither accepted nor declined: pending, never applied until the person answers again. No Electron import (testable).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { FolderSetupDecision } from '../shared/foldersetup';

const MAX_FOLDERS = 500;
const MAX_IDS = 400;
const ID_RE = /^[0-9a-f]{32}$/;

interface Entry { accepted: string[]; declined: string[] }

export class FolderSetupStore {
  private data: Record<string, Entry> = {};
  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { version?: number; folders?: Record<string, unknown> };
      const out: Record<string, Entry> = {};
      for (const [k, v] of Object.entries(j && typeof j.folders === 'object' && j.folders ? j.folders : {}).slice(0, MAX_FOLDERS)) {
        const e = v as Partial<Entry>;
        const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string' && ID_RE.test(i)).slice(0, MAX_IDS) : []);
        if (typeof k === 'string' && k.length <= 4096) out[k] = { accepted: ids(e.accepted), declined: ids(e.declined) };
      }
      this.data = out;
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, folders: this.data }, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(key: string): Entry {
    const e = this.data[key];
    return e ? { accepted: [...e.accepted], declined: [...e.declined] } : { accepted: [], declined: [] };
  }

  /**
   * Records an answer for the items the dialog showed (`shown`: the current ids). Ids not shown are dropped (stale items go away).
   * FR-011: a hook (and, S1, a broad allow rule) is accepted only when `hooksConfirmed` is true; otherwise it is recorded as declined.
   */
  decide(key: string, shown: ReadonlyMap<string, { kind: string; confirm?: boolean }>, d: FolderSetupDecision): Entry {
    const acc = new Set(d.accepted.filter((id) => shown.has(id)));
    // FR-011 + S1 (review #424): hooks and broad allow rules need the explicit tick
    if (!d.hooksConfirmed) for (const id of [...acc]) { const s = shown.get(id); if (s?.kind === 'hook' || s?.confirm) acc.delete(id); }
    const dec = new Set([...shown.keys()].filter((id) => !acc.has(id) && (d.declined.includes(id) || d.accepted.includes(id))));
    this.data[key] = { accepted: [...acc].slice(0, MAX_IDS), declined: [...dec].slice(0, MAX_IDS) };
    const keys = Object.keys(this.data);
    if (keys.length > MAX_FOLDERS) delete this.data[keys[0]];
    this.save();
    return this.get(key);
  }

  forget(key: string): void {
    if (this.data[key]) { delete this.data[key]; this.save(); }
  }
}
