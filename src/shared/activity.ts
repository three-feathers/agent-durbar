/**
 * Activity log rows (spec 052 FR-071): a local audit trail of permission answers, automatic approvals, mode changes and limit
 * changes. Pure: no Electron, no Node-only imports, so the main store and the tests share it.
 *
 * A row holds names and short summaries only: never a prompt, a reply, file contents, tool output or a full path. Every text
 * field is cut to a fixed length; the action goes through `redact()` first.
 */
import { redact } from './redact';

export const ACTIVITY_MAX_ROWS = 5000;
export const ACTIVITY_ACTION_MAX = 160;
const NAME_MAX = 80;

export const ACTIVITY_DECISIONS = ['allowed-once', 'allowed-session', 'denied', 'auto-allow-all', 'auto-session-grant', 'mode-change', 'limit-change', 'remote-on', 'remote-off', 'session-deleted'] as const;
export type ActivityDecision = (typeof ACTIVITY_DECISIONS)[number];

export interface ActivityRow {
  /** ISO time. */
  t: string;
  /** The agent's display name (its room). */
  agent: string;
  /** The folder's base name, never the full path. */
  folder: string;
  /** The adapter's display name ("GitHub Copilot", ...). */
  app: string;
  /** Permission mode at the time (read-only | ask | allow), or the new mode for a mode change. */
  mode: string;
  /** Short summary, redacted, at most 160 characters. */
  action: string;
  decision: ActivityDecision;
}

/** The only keys a row may have, in CSV column order. */
export const ACTIVITY_FIELDS = ['t', 'agent', 'folder', 'app', 'mode', 'action', 'decision'] as const;

/** One line, no control characters, cut to `n`. */
function oneLine(v: unknown, n: number): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** The folder's base name: the part after the last slash or backslash. */
export function baseName(p: unknown): string {
  const s = typeof p === 'string' ? p.replace(/[\\/]+$/, '') : '';
  return s.split(/[\\/]/).pop() || s;
}

/**
 * A clean row from anything: unknown keys are dropped, every field is a short string, the folder is a base name, the action is
 * redacted and cut. Returns undefined when the decision is unknown or the time is not a date.
 */
export function sanitizeActivityRow(raw: unknown, env?: Record<string, string | undefined>): ActivityRow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!(ACTIVITY_DECISIONS as readonly string[]).includes(r.decision as string)) return undefined;
  const t = typeof r.t === 'string' && !Number.isNaN(Date.parse(r.t)) ? new Date(r.t).toISOString() : undefined;
  if (!t) return undefined;
  return {
    t,
    agent: oneLine(r.agent, NAME_MAX),
    folder: oneLine(baseName(r.folder), NAME_MAX),
    app: oneLine(r.app, NAME_MAX),
    mode: oneLine(r.mode, 16),
    action: oneLine(redact(oneLine(r.action, 2000), env), ACTIVITY_ACTION_MAX),
    decision: r.decision as ActivityDecision,
  };
}

/** Append and keep the newest `max` rows. */
export function appendCapped(rows: ActivityRow[], row: ActivityRow, max: number = ACTIVITY_MAX_ROWS): ActivityRow[] {
  rows.push(row);
  if (rows.length > max) rows.splice(0, rows.length - max);
  return rows;
}

/**
 * One CSV cell: a value that starts with `= + - @ | %` (or tab / carriage return) gets a leading `'` so a spreadsheet does not run it
 * as a formula; then the value is quoted when it holds a comma, quote or line break, with quotes doubled.
 */
export function csvCell(v: unknown): string {
  let s = typeof v === 'string' ? v : v == null ? '' : String(v);
  if (/^[=+\-@|%\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function activityCsv(rows: readonly ActivityRow[]): string {
  const lines = [ACTIVITY_FIELDS.join(',')];
  for (const r of rows) lines.push(ACTIVITY_FIELDS.map((k) => csvCell(r[k])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function activityJson(rows: readonly ActivityRow[]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(ACTIVITY_FIELDS.map((k) => [k, r[k]]))), null, 2) + '\n';
}

/** Which decision a final permission answer is, or undefined when it is not logged (still pending, the session stopped, a plain read). */
export function decisionOf(p: { state?: unknown; via?: unknown; remembered?: unknown }): ActivityDecision | undefined {
  if (!p || p.state === 'pending') return undefined;
  if (p.via === 'policy') return p.state === 'approved' ? 'auto-allow-all' : undefined;
  if (p.via === 'session') return p.state === 'approved' ? 'auto-session-grant' : undefined;
  if (p.via === 'user') return p.state === 'denied' ? 'denied' : p.remembered === true ? 'allowed-session' : 'allowed-once';
  return undefined;
}
