/**
 * Spec 100 FR-004, FR-012 (decided Q3): the last MCP figures per agent app and server, for Settings: names, numbers and the time only.
 * Its own file, on purpose: figures are written with no user action, so they must never be able to overwrite the store of the user's servers
 * and secrets, which loads as empty when it cannot be read (review of the build, 2026-10-31). Losing this file loses only figures that the next
 * session measures again, so a bad file here simply counts as empty. Pure (no Electron); never decrypts or reads a secret.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { McpCostEntry, McpCosts } from '../shared/api';
import type { McpContextServer } from '../shared/mcpcost';
import { safeTokens, stripUnsafe } from '../shared/mcpcost';

const APPS = ['copilot', 'claude', 'codex'] as const;
const MAX_FILE = 256 * 1024;
export const MAX_COST_SERVERS = 200;
export const MAX_COST_NAME = 128;

/** One kept figure: known fields, checked numbers; undefined when there is no figure. */
function entry(v: unknown): McpCostEntry | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const tokens = safeTokens(o.tokens);
  const deferredTokens = safeTokens(o.deferredTokens);
  if ((o.source !== 'reported' && o.source !== 'estimated') || (tokens === undefined && !deferredTokens) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined;
  return { ...(tokens !== undefined ? { tokens } : {}), ...(deferredTokens ? { deferredTokens } : {}), source: o.source, ...(o.capped === true ? { capped: true } : {}), at: o.at };
}

const nameOk = (n: string): boolean => !!n && n.length <= MAX_COST_NAME && n !== '__proto__' && stripUnsafe(n) === n;

export class McpCostStore {
  /** Maps, not objects: a name is never a property of anything. */
  private costs = new Map<string, Map<string, McpCostEntry>>();
  constructor(private readonly file: string) {}

  load(): void {
    this.costs = new Map();
    let doc: unknown;
    try {
      if (fs.statSync(this.file).size > MAX_FILE) return;
      doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
    for (const app of APPS) {
      if (!Object.prototype.hasOwnProperty.call(doc, app)) continue;
      const m = (doc as Record<string, unknown>)[app];
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
      const rec = new Map<string, McpCostEntry>();
      for (const [name, raw] of Object.entries(m as Record<string, unknown>).slice(0, MAX_COST_SERVERS)) {
        const e = entry(raw);
        if (e && nameOk(name)) rec.set(name, e);
      }
      if (rec.size) this.costs.set(app, rec);
    }
  }

  /** What Settings shows: own properties only. */
  all(): McpCosts {
    return Object.fromEntries([...this.costs].map(([app, m]) => [app, Object.fromEntries(m)]));
  }

  /** A report's figures replace that server's last ones; a server with no figure changes nothing; at most 200 per app, the oldest go first. */
  set(app: string, servers: readonly McpContextServer[], at: number): void {
    if (!(APPS as readonly string[]).includes(app) || !Number.isFinite(at)) return;
    const m = new Map(this.costs.get(app) ?? []);
    let changed = false;
    for (const s of servers) {
      const e = entry({ ...s, at });
      if (!e || !nameOk(s.name)) continue;
      m.set(s.name, e);
      changed = true;
    }
    if (!changed) return;
    this.costs.set(app, new Map([...m].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_COST_SERVERS)));
    this.save();
  }

  /** FR-012: drop a figure of a server its app's lists no longer have. An app with an empty list is left alone: an unreadable list is not an empty one. */
  prune(known: Record<string, readonly string[]>): void {
    let changed = false;
    for (const [app, m] of this.costs) {
      const names = known[app];
      if (!names || !names.length) continue;
      const keep = new Set(names);
      for (const n of [...m.keys()]) {
        if (!keep.has(n)) {
          m.delete(n);
          changed = true;
        }
      }
      if (!m.size) this.costs.delete(app);
    }
    if (changed) this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.all(), null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
