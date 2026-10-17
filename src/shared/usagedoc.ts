/**
 * Usage totals kept across restarts (spec 011 FR-024, issue #21). Pure (no Node, no Electron): the main process, the tests and
 * the simulator share it.
 *
 * Privacy (FR-007): the document holds numbers, a folder's display name and a hash of its path, nothing else. A path never
 * reaches the file: folders are keyed by a 32-character hex fingerprint computed in main, and a key that is not exactly that
 * shape is refused when reading and recording.
 */

export const MAX_FOLDERS = 2000;
export const MAX_NAME = 200;
/** A credit figure above this (nano-AIU) or below 0 is "not reported", like the in-memory ledger of spec 011 FR-018. */
export const MAX_NANO = 1e15;
const MAX_TOKENS = 1e12;
const MAX_CALLS = 1e9;

export interface UsageNumbers {
  calls: number;
  inTokens: number;
  outTokens: number;
  /** Sum of the credit figures that were reported (nano-AIU). */
  nano: number;
  /** Calls that came without a usable credit figure. */
  unreported: number;
}

export interface FolderUsage extends UsageNumbers {
  /** Display name of the folder (base name only). */
  name: string;
}

export interface UsageTotalsDoc {
  version: 1;
  /** ISO time the totals started counting (first run, or the last reset). */
  since: string;
  /** Keyed by the 32-hex fingerprint of the folder's path. */
  folders: Record<string, FolderUsage>;
}

export const zeroNumbers = (): UsageNumbers => ({ calls: 0, inTokens: 0, outTokens: 0, nano: 0, unreported: 0 });

export function emptyUsageDoc(now: Date = new Date()): UsageTotalsDoc {
  return { version: 1, since: now.toISOString(), folders: Object.create(null) as Record<string, FolderUsage> };
}

export const validNano = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= MAX_NANO;
const tokens = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(x, MAX_TOKENS) : 0);
const isKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k);

/** A display name safe to keep and show: trimmed, no control characters, at most 200 characters; never empty. */
export function cleanName(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  const n = (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (n.length > MAX_NAME ? n.slice(0, MAX_NAME - 1) + '…' : n) || 'folder';
}

/**
 * Count one `usage` event for a folder. Returns true when something changed. `key` must be a fingerprint (32 hex characters);
 * a new folder beyond 2000 is not added. A credit figure that is missing, not a number, negative or above 1e15 counts as
 * "not reported" (the call still counts).
 */
export function recordUsage(doc: UsageTotalsDoc, key: string, name: string, ev: unknown): boolean {
  if (!isKey(key) || !ev || typeof ev !== 'object' || (ev as { type?: unknown }).type !== 'usage') return false;
  let f = doc.folders[key];
  if (!f) {
    if (Object.keys(doc.folders).length >= MAX_FOLDERS) return false;
    f = { name: cleanName(name), ...zeroNumbers() };
    doc.folders[key] = f;
  } else {
    f.name = cleanName(name);
  }
  const e = ev as { inputTokens?: unknown; outputTokens?: unknown; nanoAiu?: unknown };
  f.calls = Math.min(f.calls + 1, MAX_CALLS);
  f.inTokens = Math.min(f.inTokens + tokens(e.inputTokens), MAX_TOKENS * 1000);
  f.outTokens = Math.min(f.outTokens + tokens(e.outputTokens), MAX_TOKENS * 1000);
  if (validNano(e.nanoAiu)) f.nano += e.nanoAiu;
  else f.unreported = Math.min(f.unreported + 1, MAX_CALLS);
  return true;
}

const count = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(Math.floor(x), MAX_CALLS) : 0);
const big = (x: unknown, max: number): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(x, max) : 0);

/** Tolerant read of a saved document: anything odd is dropped or zeroed, hostile input never throws. */
export function sanitizeUsageDoc(raw: unknown, now: Date = new Date()): UsageTotalsDoc {
  const doc = emptyUsageDoc(now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return doc;
  const r = raw as { since?: unknown; folders?: unknown };
  if (typeof r.since === 'string' && !Number.isNaN(Date.parse(r.since)) && r.since.length <= 40) doc.since = new Date(Date.parse(r.since)).toISOString();
  if (!r.folders || typeof r.folders !== 'object' || Array.isArray(r.folders)) return doc;
  let n = 0;
  for (const [k, v] of Object.entries(r.folders as Record<string, unknown>)) {
    if (!isKey(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    if (n >= MAX_FOLDERS) break;
    const f = v as Record<string, unknown>;
    doc.folders[k] = {
      name: cleanName(f.name),
      calls: count(f.calls),
      inTokens: big(f.inTokens, MAX_TOKENS * 1000),
      outTokens: big(f.outTokens, MAX_TOKENS * 1000),
      nano: big(f.nano, MAX_NANO * MAX_FOLDERS),
      unreported: count(f.unreported),
    };
    n++;
  }
  return doc;
}

/** Sum of every saved folder, including folders that are no longer in the folder list. */
export function officeTotals(doc: UsageTotalsDoc): UsageNumbers {
  const o = zeroNumbers();
  for (const f of Object.values(doc.folders)) {
    o.calls += f.calls; o.inTokens += f.inTokens; o.outTokens += f.outTokens; o.nano += f.nano; o.unreported += f.unreported;
  }
  return o;
}

/**
 * The folder an agent's usage belongs to: its `.code-workspace` file when it has one, else its folder. The same rule as the folder
 * list (`workspaceFile ?? cwd`) and the window's room lookup (`folderOfRoom` in app.js), so the saved total lands on the right room.
 */
export function folderKeyOf(a: { workspaceFile?: string; cwd: string }): string {
  return a.workspaceFile || a.cwd;
}

/** A short display name: the workspace file's base name without `.code-workspace`, else the folder's base name. */
export function folderNameOf(a: { workspaceFile?: string; cwd: string }): string {
  const base = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  return cleanName(a.workspaceFile ? base(a.workspaceFile).replace(/\.code-workspace$/i, '') : base(a.cwd));
}

/**
 * The text a folder is fingerprinted from: separators unified, trailing separators removed, case-folded on Windows (paths there
 * are case-insensitive, so `C:\\Work\\App` and `c:/work/app/` are one folder). Pure string work; the hash is computed in main.
 */
export function normaliseFolderKey(p: string, platform: string): string {
  let s = String(p ?? '').trim();
  if (platform === 'win32') s = s.replace(/\\/g, '/').toLowerCase();
  s = s.replace(/[\\/]+$/g, '');
  return s || '/';
}
