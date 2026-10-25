/**
 * Spec 076 FR-198/FR-200/FR-201 (issue 602): Copilot's own organization policy, normalized to `OrgPolicy`.
 *
 * One source for every Copilot policy reader in Durbar (review on PR 644, item 3): `resolveCopilotManaged` asks the Copilot runtime
 * (`rpc.managedSettings.resolve`, SDK 1.0.22 `dist/generated/rpc.d.ts`), which merges every channel the way Copilot enforces it: MDM,
 * the registry, the machine file, the enterprise's server-managed settings and team overrides. `copilotOrgPolicyFromResolve` maps its
 * answer. Only when the runtime cannot answer, the machine file is read as a fallback (`readCopilotFileOrgPolicy`), and what it cannot
 * know (a team override of an `overridable` value, a bad value) is `doubt`, never a refusal. `read:` GitHub's *Enterprise managed
 * settings* reference and the Copilot CLI config-dir reference, 2026-10-23.
 */
import { boundOrgPolicy, emptyOrgPolicy, hasOwn, isPlainObject, ORG_LIMITS, ownMcpRules, ownValue, wholeOrgPolicy } from '../shared/orgpolicy';
import type { OrgMcpRule, OrgPolicy } from '../shared/orgpolicy';
import { createHash } from 'node:crypto';
import { joinFor, jsonObject, nodeOrgFs, programFiles, readPolicyFile, reuseOrRead, textKey } from './orgpolicyfiles';
import type { LastRead, OrgFs } from './orgpolicyfiles';

export const COPILOT_APP = 'Copilot';
export const COPILOT_RESOLVE_TIMEOUT_MS = 5000;

export function copilotPolicyFile(platform: string, env: Readonly<Record<string, string | undefined>>): string {
  if (platform === 'darwin') return '/Library/Application Support/GitHubCopilot/managed-settings.json';
  if (platform === 'win32') return joinFor('win32')(joinFor('win32')(programFiles(env), 'GitHubCopilot'), 'managed-settings.json');
  return '/etc/github-copilot/managed-settings.json';
}

/** What `resolveCopilotManaged` needs of a Copilot client: `rpc.managedSettings.resolve` (experimental in the SDK; may be missing). */
export interface CopilotManagedClient {
  rpc?: { managedSettings?: { resolve?: (params: Record<string, never>) => Promise<unknown> } };
}

/**
 * The runtime's `managedSettings.resolve` answer, capped in time; `undefined` when the runtime has no such call, fails or is late.
 * Shared by every reader of Copilot policy (this file and the model list's Auto tier, spec 007 FR-017). The answer is hostile input
 * to its readers: own properties only.
 */
export async function resolveCopilotManaged(client: CopilotManagedClient | undefined, timeoutMs = COPILOT_RESOLVE_TIMEOUT_MS): Promise<unknown> {
  const ms = client?.rpc?.managedSettings;
  if (!ms || typeof ms.resolve !== 'function') return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ms.resolve({}),
      new Promise<undefined>((r) => {
        timer = setTimeout(() => r(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `{ "overridable": v }` (an enterprise value teams may specialize): `v`, and whether it was wrapped. */
const unwrap = (v: unknown): { v: unknown; overridable: boolean } => (isPlainObject(v) && Object.keys(v).length === 1 && hasOwn(v, 'overridable') ? { v: ownValue(v, 'overridable'), overridable: true } : { v, overridable: false });

/** MCP lists of a Copilot settings object: invalid entries are dropped, and an allow-list that lost entries only advises (`doubt`). */
function mcpLists(out: OrgPolicy, settings: unknown, where: string, overridableIsDoubt: boolean): void {
  const list = (key: string): { rules: OrgMcpRule[] | undefined; doubt: boolean } => {
    if (!hasOwn(settings, key)) return { rules: undefined, doubt: false };
    const u = unwrap(ownValue(settings, key));
    const r = ownMcpRules(u.v);
    if (r === null || r.tooLong) {
      out.problems.push(`${where}: ${key} could not be read`);
      return { rules: undefined, doubt: true };
    }
    if (r.stripped) out.problems.push(`${where}: ${key} has ${r.stripped} invalid entries (skipped)`);
    return { rules: r.items, doubt: r.stripped > 0 || (overridableIsDoubt && u.overridable) };
  };
  const allow = list('allowedMcpServers');
  if (allow.rules) {
    out.mcp.allow = allow.rules;
    if (allow.doubt) out.mcp.allowMark = 'doubt';
  } else if (allow.doubt) out.mcp.all = 'doubt';
  const deny = list('deniedMcpServers');
  if (deny.rules) {
    out.mcp.deny = deny.rules;
    if (overridableIsDoubt && unwrap(ownValue(settings, 'deniedMcpServers')).overridable) out.mcp.denyMark = 'doubt'; // a team file may replace it
  }
}

/**
 * The runtime's answer as `OrgPolicy`, or `undefined` when it is not a resolve answer (the caller falls back to the file).
 * `resolved.bypassPermissionsDisabled` is Copilot's own effective verdict for Allow all (deny wins over every layer); the MCP lists come
 * from `resolved.settings`, the effective merged settings.
 */
export function copilotOrgPolicyFromResolve(r: unknown): OrgPolicy | undefined {
  const resolved = ownValue(r, 'resolved');
  if (!isPlainObject(resolved) || typeof ownValue(resolved, 'bypassPermissionsDisabled') !== 'boolean') return undefined;
  const out = emptyOrgPolicy(COPILOT_APP, true);
  const keys = ownValue(resolved, 'managedKeys');
  out.found = ownValue(resolved, 'deviceManaged') === true || ownValue(resolved, 'serverManaged') === true || (Array.isArray(keys) && keys.length > 0);
  out.paths = ['the Copilot runtime (managed settings)'];
  if (ownValue(resolved, 'bypassPermissionsDisabled') === true) {
    out.found = true;
    out.modes.allow = 'blocked';
  }
  if (ownValue(resolved, 'failClosed') === true) {
    out.found = true;
    out.problems.push('the Copilot runtime could not determine the whole policy');
    if (!out.modes.allow) out.modes.allow = 'doubt';
  }
  const settings = ownValue(resolved, 'settings');
  if (isPlainObject(settings)) mcpLists(out, settings, 'the Copilot runtime', false);
  out.unreadable = out.problems.length > 0;
  return boundOrgPolicy(out);
}

export function parseCopilotOrgPolicy(o: Record<string, unknown>, p: string): OrgPolicy {
  const out = emptyOrgPolicy(COPILOT_APP, true);
  out.found = true;
  out.paths = [p];
  if (hasOwn(o, 'permissions')) {
    const perm = unwrap(ownValue(o, 'permissions'));
    if (!isPlainObject(perm.v)) {
      out.problems.push(`${p}: permissions could not be read`);
      out.modes.allow = 'doubt';
    } else if (hasOwn(perm.v, 'disableBypassPermissionsMode')) {
      const v = unwrap(ownValue(perm.v, 'disableBypassPermissionsMode'));
      if (v.v === 'disable' || v.v === 'allow-auto-only') out.modes.allow = v.overridable || perm.overridable ? 'doubt' : 'blocked'; // a team file may set `unmanaged`
      else if (v.v !== 'unmanaged') {
        out.problems.push(`${p}: permissions.disableBypassPermissionsMode could not be read`);
        out.modes.allow = 'doubt';
      }
    }
  }
  mcpLists(out, o, p, true);
  out.unreadable = out.problems.length > 0;
  return boundOrgPolicy(out);
}

/**
 * The machine file, read only when the runtime cannot answer. On macOS and Linux Copilot refuses a file that is a symlink, not owned by
 * root or writable by others (read: config-dir reference); Durbar ignores such a file the same way. Anything it cannot read is `doubt`.
 */
export function readCopilotFileOrgPolicy(platform: string = process.platform, env: Readonly<Record<string, string | undefined>> = process.env, fsx: OrgFs = nodeOrgFs): OrgPolicy {
  const f = copilotPolicyFile(platform, env);
  if (platform !== 'win32') {
    let l: ReturnType<OrgFs['lstat']>;
    try {
      l = fsx.lstat(f);
    } catch {
      return wholeOrgPolicy(COPILOT_APP, [f], [`${f}: could not be read`], 'doubt', true);
    }
    if (!l) return emptyOrgPolicy(COPILOT_APP, true);
    if (l.isSymbolicLink() || l.uid !== 0 || (l.mode & 0o002) !== 0) {
      const p = emptyOrgPolicy(COPILOT_APP, true);
      p.paths = [f];
      p.problems = [`${f}: ignored (not root-owned, writable by others or a link), as Copilot does`];
      p.unreadable = true;
      return p;
    }
  }
  const r = readPolicyFile(fsx, f);
  if (r.kind === 'missing') return emptyOrgPolicy(COPILOT_APP, true);
  if (r.kind !== 'text') return wholeOrgPolicy(COPILOT_APP, [f], [r.problem], 'doubt', true);
  return reuseOrRead(lastCopilotFile, textKey([f, r.text]), () => {
    const j = jsonObject(r.text, f);
    if (!j.ok) return wholeOrgPolicy(COPILOT_APP, [f], [j.problem], 'doubt', true);
    return parseCopilotOrgPolicy(j.value, f);
  });
}

/** The last machine-file read, kept while the file text is the same (`reuseOrRead`). */
const lastCopilotFile: LastRead = {};

/** Copilot's policy: the runtime's answer, else the machine file (FR-198). */
export async function readCopilotOrgPolicy(client: CopilotManagedClient | undefined, file: () => OrgPolicy = () => readCopilotFileOrgPolicy()): Promise<OrgPolicy> {
  const answer = await resolveCopilotManaged(client);
  if (answer === undefined) return file();
  // FR-201 (review on PR 644 item 3): the answer is hostile input with a size cap, and an answer that did not change is not parsed again
  let text: string | undefined;
  try {
    text = JSON.stringify(answer);
  } catch {
    text = undefined; // a cycle or a throwing getter: not an answer Durbar can read
  }
  if (text === undefined) return file();
  if (text.length > ORG_LIMITS.totalFileBytes) return wholeOrgPolicy(COPILOT_APP, ['the Copilot runtime (managed settings)'], ['the Copilot runtime answer is larger than Agent Durbar reads'], 'doubt', true);
  const key = createHash('sha256').update(text).digest('hex');
  const last = lastCopilot.key === key ? lastCopilot.policy : undefined;
  if (last) return last;
  const fromRuntime = copilotOrgPolicyFromResolve(answer);
  if (!fromRuntime) return file();
  lastCopilot.key = key;
  lastCopilot.policy = fromRuntime;
  return fromRuntime;
}

/** The last runtime answer that was read, by the hash of its text (the same answer gives the same `OrgPolicy` object). */
const lastCopilot: LastRead = {};
