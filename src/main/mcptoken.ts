/**
 * Spec 058 FR-232 (issue #1621): a server that sends a token itself (a header, or a `${NAME}` reference) and refused it with a 403 is not a
 * "needs sign-in" row: an OAuth sign-in cannot change a header. Pure; main only. Header and variable values are read here only to find
 * `${NAME}` references and whether a name is set; no value ever leaves this module (names only, and never a name that looks like a token).
 */
import type { McpServerSpec } from '../shared/mcp';
import { maskMcpError } from './mcpmask';
import { envVarName, maskTokenShapes, secretFlag } from '../shared/redact';

/** What Durbar knows of a server's entry: its headers, the texts that may hold `${NAME}` (header values, the address), and OAuth. */
export interface TokenEntry {
  /** Main only: each header's name and, from an agent app's list, its value as written (a folder extra's values are Durbar's own secrets: name only). */
  headers: ReadonlyArray<readonly [string, string | undefined]>;
  /** Main only: header values and the address as written in the list. Never put in a reply. */
  texts: readonly string[];
  /** The entry has its own OAuth settings (Claude Code's `oauth`): a sign-in may apply, so it is not a token server. */
  oauth?: boolean;
}

/** FR-232 (c): what a `${...}` body must look like to be a reference at all (letters, digits, `_`, at most 64); only `envVarName` ones are ever said. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** `${NAME}`, `${env:NAME}`, `${NAME:-default}`; the body is cut at 200 characters (linear on hostile input). */
const REF = /\$\{(?:env:)?([^}:]{1,200})(:-[^}]{0,2000})?\}/g;
const MAX_NAMES = 3;

/** FR-232 (c): the `${NAME}` references without a fallback, in order, once each (names only). */
export function refNames(texts: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (typeof t !== 'string') continue;
    for (const m of t.slice(0, 8192).matchAll(REF)) {
      const n = m[1];
      if (m[2] === undefined && NAME.test(n) && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

const hasRef = (t: unknown): boolean => typeof t === 'string' && /\$\{[A-Za-z_]/.test(t.slice(0, 8192));
/**
 * FR-232 (a), review of PR #1637: a credential header: its name or value is a secret by the shared rule (`secretFlag`: `Authorization`,
 * `X-API-Key`, a `Bearer ...` value), its value has a token shape, or it holds a `${NAME}`. `X-MCP-Readonly: true` or `Accept` is not one.
 */
export function isCredentialHeader(key: unknown, value?: unknown): boolean {
  if (typeof key === 'string' && secretFlag(key)) return true;
  if (typeof value !== 'string') return false;
  const v = value.slice(0, 4096);
  return secretFlag(v) || maskTokenShapes(v, '[redacted]') !== v || hasRef(v);
}

/** FR-232 (a): a token server: a credential header or a `${NAME}` reference, and no OAuth settings. */
export function isTokenServer(e: TokenEntry | undefined): boolean {
  if (!e || e.oauth) return false;
  return e.headers.some(([k, v]) => isCredentialHeader(k, v)) || e.texts.some(hasRef);
}

/** FR-232 (b): a refusal of the token: `403` or "forbidden", and not `401` / "unauthorized" (those keep "needs sign-in"). */
export function isTokenRefusal(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const s = text.slice(0, 2000);
  return /\b403\b|forbidden/i.test(s) && !/\b401\b|unauthori[sz]ed/i.test(s);
}

/**
 * FR-232 (c): the referenced names whose value in Durbar's own environment is missing or empty (`isSet` reads only presence), at most
 * three. Only an environment-variable-shaped name (`envVarName`, shared with the window) is returned, and never one the session's masking
 * would change (a known secret value).
 */
export function unsetVars(e: TokenEntry, isSet: (name: string) => boolean, secrets: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const n of refNames(e.texts)) {
    if (out.length >= MAX_NAMES) break;
    if (!envVarName(n) || maskMcpError(n, secrets) !== n) continue;
    let set = true;
    try {
      set = isSet(n) === true;
    } catch {
      set = true; // unknown: say nothing rather than guess
    }
    if (!set) out.push(n);
  }
  return out;
}

/** A folder extra (Durbar's own store): header names only; its values are Durbar's, never a `${NAME}`. */
export function tokenEntryOfExtra(v: { headers?: ReadonlyArray<{ key: string }>; url?: string } | undefined): TokenEntry | undefined {
  return v ? { headers: (v.headers ?? []).map((h) => [h.key, undefined] as const), texts: typeof v.url === 'string' ? [v.url] : [] } : undefined;
}

/** A list entry with its values (the Copilot CLI list's candidate, Claude Code's `McpServerSpec`). */
export function tokenEntryOfSpec(s: Pick<McpServerSpec, 'headers' | 'url' | 'oauth'> | undefined): TokenEntry | undefined {
  if (!s) return undefined;
  const h = s.headers && typeof s.headers === 'object' ? s.headers : {};
  return { headers: Object.entries(h).map(([k, v]) => [k, typeof v === 'string' ? v : undefined] as const), texts: [...Object.values(h).filter((v): v is string => typeof v === 'string'), ...(typeof s.url === 'string' ? [s.url] : [])], ...(s.oauth ? { oauth: true } : {}) };
}

/** Durbar's own environment: set and not empty. `process.env` is case-insensitive on Windows by itself. */
export const envIsSet = (env: NodeJS.ProcessEnv = process.env) => (name: string): boolean => {
  const v = env[name];
  return typeof v === 'string' && v !== '';
};
