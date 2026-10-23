/**
 * Spec 076 FR-198/FR-200/FR-201 (issue 602): Claude Code's own machine policy (`managed-settings.json` and `managed-settings.d/*.json`),
 * read-only, normalized to `OrgPolicy` the way Claude Code reads it. `read:` https://code.claude.com/docs/en/managed-settings.md
 * ("Split a file-based policy across teams", "Keys that fail closed", the fallback table) and settings-reference.md, 2026-10-23.
 * Only the keys of FR-200 are read; MDM, the registry and server-managed settings are not (FR-206).
 */
import { emptyOrgPolicy, hasOwn, isPlainObject, mcpToolRules, ORG_LIMITS, ownMcpRules, ownStrings, ownValue, wholeOrgPolicy } from '../shared/orgpolicy';
import type { OrgPolicy } from '../shared/orgpolicy';
import { dropInFiles, joinFor, jsonObject, nodeOrgFs, programFiles, readPolicyFile } from './orgpolicyfiles';
import type { OrgFs } from './orgpolicyfiles';

export const CLAUDE_APP = 'Claude Code';

/** The system folder Claude Code reads its managed files from (FR-198). */
export function claudePolicyDir(platform: string, env: Readonly<Record<string, string | undefined>>): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return joinFor('win32')(programFiles(env), 'ClaudeCode');
  return '/etc/claude-code';
}

/**
 * Claude Code's documented merge of `managed-settings.json` and its drop-ins, in order: a later single value replaces an earlier one,
 * lists combine with duplicates removed, nested blocks merge key by key. Own keys only, into prototype-free objects; `undefined` past
 * the depth limit (Durbar cannot follow it: the caller treats it as `doubt`).
 */
export function mergeClaudeSettings(a: unknown, b: unknown, depth = 0): unknown {
  if (depth > ORG_LIMITS.depth) return undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: unknown[] = [...a];
    const seen = new Set(a.map((x) => JSON.stringify(x)));
    for (const x of b) {
      const k = JSON.stringify(x);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(x);
      }
    }
    return out;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(a)) out[k] = a[k];
    for (const k of Object.keys(b)) {
      if (Object.prototype.hasOwnProperty.call(out, k)) {
        const m = mergeClaudeSettings(out[k], b[k], depth + 1);
        if (m === undefined && b[k] !== undefined) return undefined;
        out[k] = m;
      } else out[k] = b[k];
    }
    return out;
  }
  return b;
}

/** One (merged) Claude Code settings object, as `OrgPolicy` (FR-200), with Claude Code's own fallback for each bad value (FR-201). */
export function parseClaudeOrgPolicy(o: Record<string, unknown>, paths: string[]): OrgPolicy {
  const out = emptyOrgPolicy(CLAUDE_APP);
  out.found = true;
  out.paths = [...paths];
  const where = paths[paths.length - 1] ?? CLAUDE_APP;
  const note = (key: string, what: string): void => {
    out.problems.push(`${where}: ${key} ${what}`);
  };
  const perm = ownValue(o, 'permissions');
  if (perm !== undefined && perm !== null && !isPlainObject(perm)) {
    // Claude Code repairs `permissions` per field; a block that is not an object is not documented: advice only
    note('permissions', 'is not an object');
    out.modes.allow = 'doubt';
    out.tools.all = 'doubt';
  } else if (isPlainObject(perm)) {
    if (hasOwn(perm, 'disableBypassPermissionsMode')) {
      const v = ownValue(perm, 'disableBypassPermissionsMode');
      if (v === 'disable') out.modes.allow = 'blocked';
      else if (v !== null) {
        // documented: a lock inside `permissions` that Claude Code cannot read reads as its restrictive value
        note('permissions.disableBypassPermissionsMode', 'is invalid (read as "disable")');
        out.modes.allow = 'blocked';
      }
    }
    const deny = ownStrings(ownValue(perm, 'deny'));
    if (deny && deny.tooLong) {
      note('permissions.deny', 'is longer than Agent Durbar reads');
      out.tools.all = 'doubt';
    } else if (deny) {
      out.tools.deny = mcpToolRules(deny.items);
      if (deny.stripped) note('permissions.deny', `has ${deny.stripped} invalid entries (skipped)`);
    }
  }
  if (hasOwn(o, 'availableModels') && ownValue(o, 'availableModels') !== null) {
    const a = ownStrings(ownValue(o, 'availableModels'));
    if (a === null) {
      note('availableModels', 'is invalid (enforced as empty)');
      out.models.allow = []; // documented: an empty allow-list until fixed, only the Default model
    } else if (a.tooLong) {
      note('availableModels', 'is longer than Agent Durbar reads');
      out.models.all = 'doubt';
    } else {
      out.models.allow = a.items; // a non-string entry is stripped and the rest enforced
      if (a.stripped) note('availableModels', `has ${a.stripped} invalid entries (stripped)`);
    }
  }
  if (hasOwn(o, 'availableModelsMatch')) {
    const v = ownValue(o, 'availableModelsMatch');
    if (v === 'exact') out.models.exact = true;
    else if (v !== 'prefix' && v !== null) {
      note('availableModelsMatch', 'is invalid (read as "exact")');
      out.models.exact = true;
    }
  }
  if (hasOwn(o, 'deniedModels')) {
    const d = ownStrings(ownValue(o, 'deniedModels'));
    if (d === null) {
      if (ownValue(o, 'deniedModels') !== null) note('deniedModels', 'is invalid (dropped)'); // documented: dropped, blocks nothing
    } else if (d.tooLong) {
      note('deniedModels', 'is longer than Agent Durbar reads');
      out.models.all = 'doubt';
    } else {
      out.models.deny = d.items;
      if (d.stripped) note('deniedModels', `has ${d.stripped} invalid entries (stripped)`);
    }
  }
  if (hasOwn(o, 'allowedMcpServers') && ownValue(o, 'allowedMcpServers') !== null) {
    const a = ownMcpRules(ownValue(o, 'allowedMcpServers'));
    if (a === null) {
      note('allowedMcpServers', 'is invalid (enforced as empty)');
      out.mcp.allow = [];
    } else if (a.tooLong) {
      note('allowedMcpServers', 'is longer than Agent Durbar reads');
      out.mcp.all = 'doubt';
    } else {
      out.mcp.allow = a.items;
      if (a.stripped) note('allowedMcpServers', `has ${a.stripped} invalid entries (stripped)`);
    }
  }
  if (hasOwn(o, 'deniedMcpServers')) {
    const d = ownMcpRules(ownValue(o, 'deniedMcpServers'));
    if (d === null) {
      if (ownValue(o, 'deniedMcpServers') !== null) note('deniedMcpServers', 'is invalid (dropped)'); // documented: dropped, blocks nothing
    } else if (d.tooLong) {
      note('deniedMcpServers', 'is longer than Agent Durbar reads');
      out.mcp.all = 'doubt';
    } else {
      out.mcp.deny = d.items;
      if (d.stripped) note('deniedMcpServers', `has ${d.stripped} invalid entries (stripped)`);
    }
  }
  out.unreadable = out.problems.length > 0;
  return out;
}

/**
 * Read Claude Code's machine policy: `managed-settings.json`, then the drop-ins in name order, merged as Claude Code merges them.
 * A file that is not a JSON object, or a read that fails for another reason than the system's refusal, makes Claude Code refuse to
 * start (read: managed-settings), so every start is refused (`fatal`). A read the system refuses (a root-only file) is skipped, as Claude
 * Code skips it. A file over Durbar's own size limit is `doubt`.
 */
export function readClaudeOrgPolicy(platform: string = process.platform, env: Readonly<Record<string, string | undefined>> = process.env, fsx: OrgFs = nodeOrgFs): OrgPolicy {
  const join = joinFor(platform);
  const dir = claudePolicyDir(platform, env);
  const problems: string[] = [];
  const files = [join(dir, 'managed-settings.json')];
  const drop = dropInFiles(fsx, join(dir, 'managed-settings.d'), join);
  if ('problem' in drop) return wholeOrgPolicy(CLAUDE_APP, [join(dir, 'managed-settings.d')], [drop.problem], 'fatal');
  if ('tooMany' in drop) return wholeOrgPolicy(CLAUDE_APP, [join(dir, 'managed-settings.d')], [drop.tooMany], 'doubt');
  if ('denied' in drop) problems.push(drop.denied);
  else files.push(...drop.files);
  let merged: unknown;
  const read: string[] = [];
  for (const f of files) {
    const r = readPolicyFile(fsx, f);
    if (r.kind === 'missing') continue;
    if (r.kind === 'denied') {
      problems.push(r.problem);
      continue;
    }
    if (r.kind === 'tooLarge') return wholeOrgPolicy(CLAUDE_APP, [f], [r.problem], 'doubt');
    if (r.kind === 'bad') return wholeOrgPolicy(CLAUDE_APP, [f], [r.problem], 'fatal');
    const j = r.text.trim() === '' ? { ok: true as const, value: {} as Record<string, unknown> } : jsonObject(r.text, f); // documented: an empty file counts as {}
    if (!j.ok) return wholeOrgPolicy(CLAUDE_APP, [f], [j.problem], 'fatal');
    read.push(f);
    merged = merged === undefined ? j.value : mergeClaudeSettings(merged, j.value);
    if (merged === undefined) return wholeOrgPolicy(CLAUDE_APP, [f], [`${f}: nested deeper than Agent Durbar reads`], 'doubt');
  }
  if (merged === undefined) {
    const p = emptyOrgPolicy(CLAUDE_APP);
    p.problems = problems;
    p.unreadable = problems.length > 0;
    return p;
  }
  const p = parseClaudeOrgPolicy(merged as Record<string, unknown>, read);
  p.problems.unshift(...problems);
  p.unreadable = p.problems.length > 0;
  return p;
}
