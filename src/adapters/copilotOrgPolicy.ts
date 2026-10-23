/**
 * Spec 076 FR-198/FR-200/FR-201 (issue #602): Copilot's own machine policy file (`managed-settings.json`), read-only, normalized to
 * `OrgPolicy`. `read:` GitHub's *Enterprise managed settings* reference and the Copilot CLI config-dir reference (2026-10-23). MDM, the
 * registry, policy helpers and the enterprise's server-managed settings are not read (FR-206).
 */
import { emptyOrgPolicy, hasOwn, isPlainObject, ownMcpRules, ownValue, strictestOrgPolicy } from '../shared/orgpolicy';
import type { OrgPolicy } from '../shared/orgpolicy';
import { joinFor, jsonObject, nodeOrgFs, programFiles, readPolicyFile } from './orgpolicyfiles';
import type { OrgFs } from './orgpolicyfiles';

export const COPILOT_APP = 'Copilot';

export function copilotPolicyFile(platform: string, env: Readonly<Record<string, string | undefined>>): string {
  if (platform === 'darwin') return '/Library/Application Support/GitHubCopilot/managed-settings.json';
  if (platform === 'win32') return joinFor('win32')(joinFor('win32')(programFiles(env), 'GitHubCopilot'), 'managed-settings.json');
  return '/etc/github-copilot/managed-settings.json';
}

/** `{ "overridable": v }` (an enterprise value teams may specialize) reads as `v`: the team files are not on this machine. */
const unwrap = (v: unknown): unknown => (isPlainObject(v) && Object.keys(v).length === 1 && hasOwn(v, 'overridable') ? ownValue(v, 'overridable') : v);

export function parseCopilotOrgPolicy(o: Record<string, unknown>, p: string): OrgPolicy {
  const out = emptyOrgPolicy(COPILOT_APP, true);
  out.found = true;
  out.paths = [p];
  const bad = (key: string): void => {
    out.problems.push(`${p}: unreadable key ${key}`);
  };
  if (hasOwn(o, 'permissions')) {
    const perm = unwrap(ownValue(o, 'permissions'));
    if (!isPlainObject(perm)) {
      bad('permissions');
      out.modes.allow = 'doubt';
    } else if (hasOwn(perm, 'disableBypassPermissionsMode')) {
      const v = unwrap(ownValue(perm, 'disableBypassPermissionsMode'));
      if (v === 'disable' || v === 'allow-auto-only') out.modes.allow = 'blocked';
      else if (v !== 'unmanaged') {
        bad('permissions.disableBypassPermissionsMode');
        out.modes.allow = 'doubt';
      }
    }
  }
  if (hasOwn(o, 'allowedMcpServers')) {
    const a = ownMcpRules(unwrap(ownValue(o, 'allowedMcpServers')));
    if (a) out.mcp.allow = a;
    else {
      bad('allowedMcpServers');
      out.mcp.allow = [];
      out.mcp.doubt = true;
    }
  }
  if (hasOwn(o, 'deniedMcpServers')) {
    const d = ownMcpRules(unwrap(ownValue(o, 'deniedMcpServers')));
    if (d) out.mcp.deny = d;
    else {
      bad('deniedMcpServers');
      out.mcp.denyAll = 'doubt';
    }
  }
  return out;
}

/**
 * Read Copilot's machine policy file. On macOS and Linux Copilot refuses a file that is a symlink, not owned by root or writable by
 * others (read: config-dir reference); Durbar ignores such a file the same way, so it greys out only what Copilot enforces.
 */
export function readCopilotOrgPolicy(platform: string = process.platform, env: Readonly<Record<string, string | undefined>> = process.env, fsx: OrgFs = nodeOrgFs): OrgPolicy {
  const f = copilotPolicyFile(platform, env);
  if (platform !== 'win32') {
    let l: ReturnType<OrgFs['lstat']>;
    try {
      l = fsx.lstat(f);
    } catch {
      return strictestOrgPolicy(COPILOT_APP, [f], [`${f}: could not be read`], false, true);
    }
    if (!l) return emptyOrgPolicy(COPILOT_APP, true);
    if (l.isSymbolicLink() || l.uid !== 0 || (l.mode & 0o002) !== 0) {
      const p = emptyOrgPolicy(COPILOT_APP, true);
      p.paths = [f];
      p.problems = [`${f}: ignored (not root-owned, writable by others or a link), as Copilot does`];
      return p;
    }
  }
  const r = readPolicyFile(fsx, f);
  if (r.kind === 'missing') return emptyOrgPolicy(COPILOT_APP, true);
  if (r.kind === 'bad') return strictestOrgPolicy(COPILOT_APP, [f], [r.problem], false, true);
  const j = jsonObject(r.text, f);
  if (!j.ok) return strictestOrgPolicy(COPILOT_APP, [f], [j.problem], false, true); // documented: an unreadable device policy fails closed
  return parseCopilotOrgPolicy(j.value, f);
}
