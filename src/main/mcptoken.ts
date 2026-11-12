/**
 * Spec 058 FR-232 (issue #1621): a server that sends a token itself (a header, or a `${NAME}` reference) and refused it with a 403 is not a
 * "needs sign-in" row: an OAuth sign-in cannot change a header. Pure; main only. Header and variable values are read here only to find
 * `${NAME}` references and whether a name is set; no value ever leaves this module (names only, and never a name that looks like a token).
 */
import type { McpServerSpec } from '../shared/mcp';
import { maskMcpError } from './mcpmask';

/** What Durbar knows of a server's entry: its header names, the texts that may hold `${NAME}` (header values, the address), and OAuth. */
export interface TokenEntry {
  headerKeys: readonly string[];
  /** Main only: header values and the address as written in the list. Never put in a reply. */
  texts: readonly string[];
  /** The entry has its own OAuth settings (Claude Code's `oauth`): a sign-in may apply, so it is not a token server. */
  oauth?: boolean;
}

/** FR-232 (c): a variable name Durbar may say (letters, digits, `_`, at most 64). */
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

/** FR-232 (a): a token server: a header or a `${NAME}` reference, and no OAuth settings. */
export function isTokenServer(e: TokenEntry | undefined): boolean {
  if (!e || e.oauth) return false;
  return e.headerKeys.length > 0 || e.texts.some((t) => typeof t === 'string' && /\$\{[A-Za-z_]/.test(t.slice(0, 8192)));
}

/** FR-232 (b): a refusal of the token: `403` or "forbidden", and not `401` / "unauthorized" (those keep "needs sign-in"). */
export function isTokenRefusal(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const s = text.slice(0, 2000);
  return /\b403\b|forbidden/i.test(s) && !/\b401\b|unauthori[sz]ed/i.test(s);
}

/**
 * FR-232 (c): the referenced names whose value in Durbar's own environment is missing or empty (`isSet` reads only presence), at most
 * three. A name that the session's masking would change (a token shape, a known secret value) is never returned.
 */
export function unsetVars(e: TokenEntry, isSet: (name: string) => boolean, secrets: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const n of refNames(e.texts)) {
    if (out.length >= MAX_NAMES) break;
    if (maskMcpError(n, secrets) !== n) continue;
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
  return v ? { headerKeys: (v.headers ?? []).map((h) => h.key), texts: typeof v.url === 'string' ? [v.url] : [] } : undefined;
}

/** A list entry with its values (the Copilot CLI list's candidate, Claude Code's `McpServerSpec`). */
export function tokenEntryOfSpec(s: Pick<McpServerSpec, 'headers' | 'url' | 'oauth'> | undefined): TokenEntry | undefined {
  if (!s) return undefined;
  const h = s.headers && typeof s.headers === 'object' ? s.headers : {};
  return { headerKeys: Object.keys(h), texts: [...Object.values(h).filter((v): v is string => typeof v === 'string'), ...(typeof s.url === 'string' ? [s.url] : [])], ...(s.oauth ? { oauth: true } : {}) };
}

/** Durbar's own environment: set and not empty. `process.env` is case-insensitive on Windows by itself. */
export const envIsSet = (env: NodeJS.ProcessEnv = process.env) => (name: string): boolean => {
  const v = env[name];
  return typeof v === 'string' && v !== '';
};
