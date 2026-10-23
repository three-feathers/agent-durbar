/**
 * Spec 076 FR-198/FR-200/FR-201 (issue #602): Claude Code's own machine policy (`managed-settings.json` and `managed-settings.d/*.json`),
 * read-only, normalized to `OrgPolicy`. `read:` https://code.claude.com/docs/en/managed-settings.md and settings-reference.md
 * (2026-10-23). Only the keys of FR-200 are read; MDM, the registry and server-managed settings are not (FR-206).
 */
import { emptyOrgPolicy, mcpToolRules, mergeOrgPolicy, ownMcpRules, ownStrings, ownValue, hasOwn, strictestOrgPolicy, isPlainObject } from '../shared/orgpolicy';
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

/** One parsed Claude Code settings object, as `OrgPolicy` (FR-200). A bad value of a key is that key's strictest reading (FR-201). */
export function parseClaudeOrgPolicy(o: Record<string, unknown>, p: string): OrgPolicy {
  const out = emptyOrgPolicy(CLAUDE_APP);
  out.found = true;
  out.paths = [p];
  const bad = (key: string): void => {
    out.problems.push(`${p}: unreadable key ${key}`);
  };
  if (hasOwn(o, 'permissions')) {
    const perm = ownValue(o, 'permissions');
    if (!isPlainObject(perm)) {
      bad('permissions');
      out.modes.allow = 'doubt';
      out.tools.denyAll = 'doubt';
    } else {
      if (hasOwn(perm, 'disableBypassPermissionsMode')) {
        const v = ownValue(perm, 'disableBypassPermissionsMode');
        if (v === 'disable') out.modes.allow = 'blocked';
        else {
          bad('permissions.disableBypassPermissionsMode');
          out.modes.allow = 'doubt'; // the documented lock reads as its restrictive value when it is not what Claude Code reads
        }
      }
      if (hasOwn(perm, 'deny')) {
        const d = ownStrings(ownValue(perm, 'deny'));
        if (d) out.tools.deny = mcpToolRules(d);
        else {
          bad('permissions.deny');
          out.tools.denyAll = 'doubt';
        }
      }
    }
  }
  if (hasOwn(o, 'availableModels')) {
    const a = ownStrings(ownValue(o, 'availableModels'));
    if (a) out.models.allow = a;
    else {
      bad('availableModels');
      out.models.allow = [];
      out.models.doubt = true;
    }
  }
  if (hasOwn(o, 'availableModelsMatch')) {
    const v = ownValue(o, 'availableModelsMatch');
    if (v === 'exact') out.models.exact = true;
    else if (v !== 'prefix') {
      bad('availableModelsMatch');
      out.models.exact = true; // documented: an unreadable value is treated as "exact"
    }
  }
  if (hasOwn(o, 'deniedModels')) {
    const d = ownStrings(ownValue(o, 'deniedModels'));
    if (d) out.models.deny = d;
    else {
      bad('deniedModels');
      out.models.denyAll = 'doubt';
    }
  }
  if (hasOwn(o, 'allowedMcpServers')) {
    const a = ownMcpRules(ownValue(o, 'allowedMcpServers'));
    if (a) out.mcp.allow = a;
    else {
      bad('allowedMcpServers');
      out.mcp.allow = [];
      out.mcp.doubt = true;
    }
  }
  if (hasOwn(o, 'deniedMcpServers')) {
    const d = ownMcpRules(ownValue(o, 'deniedMcpServers'));
    if (d) out.mcp.deny = d;
    else {
      bad('deniedMcpServers');
      out.mcp.denyAll = 'doubt';
    }
  }
  return out;
}

/** Read Claude Code's machine policy: `managed-settings.json` and the drop-ins next to it; one unreadable file makes it all strictest. */
export function readClaudeOrgPolicy(platform: string = process.platform, env: Readonly<Record<string, string | undefined>> = process.env, fsx: OrgFs = nodeOrgFs): OrgPolicy {
  const join = joinFor(platform);
  const dir = claudePolicyDir(platform, env);
  const files = [join(dir, 'managed-settings.json')];
  const drop = dropInFiles(fsx, join(dir, 'managed-settings.d'), join);
  if ('problem' in drop) return strictestOrgPolicy(CLAUDE_APP, [join(dir, 'managed-settings.d')], [drop.problem]);
  files.push(...drop.files);
  let acc: OrgPolicy | undefined;
  for (const f of files) {
    const r = readPolicyFile(fsx, f);
    if (r.kind === 'missing') continue;
    if (r.kind === 'bad') return strictestOrgPolicy(CLAUDE_APP, [f], [r.problem]);
    const j = jsonObject(r.text, f);
    if (!j.ok) return strictestOrgPolicy(CLAUDE_APP, [f], [j.problem]); // Claude Code itself refuses to start then (read: managed-settings)
    const one = parseClaudeOrgPolicy(j.value, f);
    acc = acc ? mergeOrgPolicy(acc, one) : one;
  }
  return acc ?? emptyOrgPolicy(CLAUDE_APP);
}
