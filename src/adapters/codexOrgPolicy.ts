/**
 * Spec 076 FR-198/FR-200/FR-201 (issue #602): Codex's own machine requirements (`requirements.toml`), read-only, normalized to
 * `OrgPolicy`. `read:` https://learn.chatgpt.com/docs/enterprise/managed-configuration.md (2026-10-23). Only
 * `allowed_approval_policies`, `allowed_sandbox_modes` and `[allowed_permission_profiles]` are read; `mcp_servers` identities, cloud
 * requirements, `managed_config.toml` and MDM are not (FR-206).
 *
 * Durbar's modes in Codex (`codexModes.ts`): Read-only = approval `never` + profile `durbar_ro`; Ask first = `on-request` + `durbar_ro`;
 * Allow all = `never` + sandbox `danger-full-access`.
 */
import { emptyOrgPolicy, ORG_LIMITS, strictestOrgPolicy } from '../shared/orgpolicy';
import type { OrgMode, OrgPolicy } from '../shared/orgpolicy';
import { CODEX_RO_PROFILE } from './codexModes';
import { joinFor, nodeOrgFs, programData, readPolicyFile } from './orgpolicyfiles';
import type { OrgFs } from './orgpolicyfiles';

export const CODEX_APP = 'Codex';

export function codexPolicyFile(platform: string, env: Readonly<Record<string, string | undefined>>): string {
  if (platform === 'win32') {
    const j = joinFor('win32');
    return j(j(j(programData(env), 'OpenAI'), 'Codex'), 'requirements.toml');
  }
  return '/etc/codex/requirements.toml';
}

/**
 * Split TOML text into statements (a key/value pair or a table header, with comments removed), keeping multi-line arrays, inline
 * tables and multi-line strings in one statement. One pass over the characters; `undefined` when the text is not well formed
 * (an unclosed string or bracket), so the caller reads the whole file as unreadable.
 */
export function tomlStatements(text: string): string[] | undefined {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const close = triple ? c.repeat(3) : c;
      let j = i + close.length;
      for (;;) {
        if (j >= n) return undefined;
        if (!triple && (text[j] === '\n' || text[j] === '\r')) return undefined;
        if (c === '"' && text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text.startsWith(close, j)) break;
        j++;
      }
      // a closing triple quote may be followed by up to two more quotes that belong to the string
      let end = j + close.length;
      while (triple && end < n && text[end] === c && end - j < close.length + 2) end++;
      cur += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth < 0) return undefined;
    }
    if (c === '\n' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += c === '\r' || c === '\n' ? ' ' : c;
    i++;
  }
  if (depth !== 0) return undefined;
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A TOML key part: a bare key, or a quoted one without escapes. `undefined` for anything else. */
function keyPart(s: string): string | undefined {
  const t = s.trim();
  if (/^[A-Za-z0-9_-]+$/.test(t)) return t;
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const v = t.slice(1, -1);
    return v.includes(t[0]) || (t[0] === '"' && v.includes('\\')) ? undefined : v;
  }
  return undefined;
}

/** Split on `sep` outside quotes. */
function splitOutside(s: string, sep: string): string[] {
  const parts: string[] = [];
  let q = '';
  let start = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

const dotted = (k: string): string[] | undefined => {
  const parts = splitOutside(k, '.').map(keyPart);
  return parts.every((x): x is string => x !== undefined) ? parts : undefined;
};

/** A strict array of plain strings (no escapes), all or nothing; `null` when it is anything else. */
function stringArray(v: string): string[] | null {
  const t = v.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  const items = splitOutside(inner, ',').map((x) => x.trim());
  if (items[items.length - 1] === '') items.pop(); // a trailing comma
  if (items.length > ORG_LIMITS.listItems) return null;
  const out: string[] = [];
  for (const it of items) {
    const k = it.length >= 2 && (it[0] === '"' || it[0] === "'") ? keyPart(it) : undefined;
    if (k === undefined || k.length > ORG_LIMITS.itemChars) return null;
    out.push(k);
  }
  return out;
}

/** An inline table of `key = true|false`; `null` otherwise. */
function boolTable(v: string): Map<string, boolean> | null {
  const t = v.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  const m = new Map<string, boolean>();
  const inner = t.slice(1, -1).trim();
  if (!inner) return m;
  for (const pair of splitOutside(inner, ',')) {
    if (!pair.trim()) return null;
    const kv = splitOutside(pair, '=');
    const k = kv.length === 2 ? keyPart(kv[0]) : undefined;
    const b = kv.length === 2 ? kv[1].trim() : '';
    if (k === undefined || (b !== 'true' && b !== 'false')) return null;
    m.set(k, b === 'true');
  }
  return m.size > ORG_LIMITS.listItems ? null : m;
}

const APPROVALS = 'allowed_approval_policies';
const SANDBOXES = 'allowed_sandbox_modes';
const PROFILES = 'allowed_permission_profiles';

export function parseCodexOrgPolicy(text: string, p: string): OrgPolicy {
  const st = tomlStatements(text);
  if (!st) return strictestOrgPolicy(CODEX_APP, [p], [`${p}: not valid TOML`], true);
  let table: string[] = [];
  let approvals: string[] | null | undefined;
  let sandboxes: string[] | null | undefined;
  let profiles: Map<string, boolean> | null | undefined;
  const problems: string[] = [];
  const bad = (key: string): void => {
    if (!problems.includes(`${p}: unreadable key ${key}`)) problems.push(`${p}: unreadable key ${key}`);
  };
  for (const s of st) {
    if (s.startsWith('[')) {
      const arr = s.startsWith('[[');
      const inner = arr ? (s.endsWith(']]') ? s.slice(2, -2) : undefined) : s.endsWith(']') ? s.slice(1, -1) : undefined;
      const k = inner === undefined ? undefined : dotted(inner);
      if (!k) return strictestOrgPolicy(CODEX_APP, [p], [`${p}: not valid TOML`], true);
      table = k;
      if (k[0] === PROFILES) {
        if (arr || k.length !== 1) {
          bad(PROFILES);
          profiles = null;
        } else if (profiles === undefined) profiles = new Map();
      }
      continue;
    }
    const kv = splitOutside(s, '=');
    if (kv.length < 2) return strictestOrgPolicy(CODEX_APP, [p], [`${p}: not valid TOML`], true);
    const key = dotted(kv[0]);
    const value = kv.slice(1).join('=');
    if (!key) {
      // a key Durbar cannot read at the top level or in the profiles table could be one of its keys: strictest for them (FR-201)
      if (!table.length || table[0] === PROFILES) {
        approvals = null;
        sandboxes = null;
        profiles = null;
        bad(APPROVALS);
        bad(SANDBOXES);
        bad(PROFILES);
      }
      continue;
    }
    const full = [...table, ...key];
    if (full.length === 1 && full[0] === APPROVALS) approvals = approvals === undefined ? stringArray(value) : null;
    else if (full.length === 1 && full[0] === SANDBOXES) sandboxes = sandboxes === undefined ? stringArray(value) : null;
    else if (full[0] === PROFILES) {
      if (profiles === null) continue;
      if (full.length === 1) {
        profiles = profiles === undefined ? boolTable(value) : null;
      } else if (full.length === 2) {
        const b = value.trim();
        if (b !== 'true' && b !== 'false') profiles = null;
        else (profiles ??= new Map()).set(full[1], b === 'true');
      } else profiles = null;
    }
    if (approvals === null) bad(APPROVALS);
    if (sandboxes === null) bad(SANDBOXES);
    if (profiles === null) bad(PROFILES);
  }
  const out = emptyOrgPolicy(CODEX_APP);
  out.found = true;
  out.paths = [p];
  out.problems = problems;
  const mark = (m: OrgMode, doubt: boolean): void => {
    if (doubt) out.modes[m] = 'doubt';
    else if (out.modes[m] !== 'doubt') out.modes[m] = 'blocked';
  };
  if (approvals === null) for (const m of ['read-only', 'ask', 'allow'] as const) mark(m, true);
  else if (approvals) {
    if (!approvals.includes('never')) {
      mark('read-only', false);
      mark('allow', false);
    }
    if (!approvals.includes('on-request')) mark('ask', false);
  }
  if (sandboxes === null) mark('allow', true);
  else if (sandboxes && !sandboxes.includes('danger-full-access')) mark('allow', false);
  if (profiles === null) for (const m of ['read-only', 'ask', 'allow'] as const) mark(m, true);
  else if (profiles) {
    if (profiles.get(CODEX_RO_PROFILE) !== true) {
      mark('read-only', false);
      mark('ask', false);
    }
    if (profiles.get(':danger-full-access') !== true) mark('allow', false);
  }
  return out;
}

export function readCodexOrgPolicy(platform: string = process.platform, env: Readonly<Record<string, string | undefined>> = process.env, fsx: OrgFs = nodeOrgFs): OrgPolicy {
  const f = codexPolicyFile(platform, env);
  const r = readPolicyFile(fsx, f);
  if (r.kind === 'missing') return emptyOrgPolicy(CODEX_APP);
  if (r.kind === 'bad') return strictestOrgPolicy(CODEX_APP, [f], [r.problem], true);
  return parseCodexOrgPolicy(r.text, f);
}
