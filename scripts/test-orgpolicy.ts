/**
 * Spec 076 section O (FR-198..FR-207, issue 602): the agent apps' own organization policies, read from fixture text, a fake file system
 * and a fake Copilot runtime only (no real policy file, no agent app, no credits). `npm run test:orgpolicy`.
 *
 *  (a) Claude Code: the FR-200 keys, drop-ins combined as Claude Code combines them, each key's documented fallback, model/tool matching;
 *  (b) Copilot: the runtime's `managedSettings.resolve` first (one shared reader), the machine file only as a fallback, `overridable`;
 *  (c) Codex: the TOML subset, the `[[remote_sandbox_config]]` host overrides, anything unreadable as advice;
 *  (d) the hostile matrix (FR-201): wrong types, inherited and `__proto__` keys, limits, read errors; refused only where the vendor refuses;
 *  (e) nothing of a policy's values leaves through problems or the window's view;
 *  (f) main: the cache, the refusals (only `blocked` / `fatal`), and the wiring by behaviour: start, mode, model, MCP switch, list, tools;
 *  (g) the glob matcher stays fast on a hostile pattern.
 */
import * as assert from 'assert';
import { mergeClaudeSettings, parseClaudeOrgPolicy, readClaudeOrgPolicy } from '../src/adapters/claudeOrgPolicy';
import { copilotOrgPolicyFromResolve, parseCopilotOrgPolicy, readCopilotFileOrgPolicy, readCopilotOrgPolicy, resolveCopilotManaged } from '../src/adapters/copilotOrgPolicy';
import { hostMatches, parseCodexOrgPolicy, readCodexOrgPolicy, tomlStatements } from '../src/adapters/codexOrgPolicy';
import { nodeOrgFs } from '../src/adapters/orgpolicyfiles';
import type { OrgFs } from '../src/adapters/orgpolicyfiles';
import { FakeAdapter } from '../src/adapters/fake';
import { boundOrgPolicy, emptyOrgPolicy, ORG_LIMITS, orgVerdictStats, globMatch, mcpVerdict, modelVerdict, modeVerdict, orgBlockedText, orgDoubtText, orgFatalText, orgPolicyView, ownValue, toolVerdict, urlMatches } from '../src/shared/orgpolicy';
import type { OrgPolicy, OrgVerdict } from '../src/shared/orgpolicy';
import { orgGuardedStart, OrgPolicyCache, ORG_POLICY_TTL_MS } from '../src/main/orgpolicy';
import { setMcpOp, setModeOp, startGuardOp, startModeOf } from '../src/main/agentops';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setModelOp, withOrgModels } from '../src/main/ipc/model';
import { agentMcpReply } from '../src/main/mcpsession';
import { mcpToolsOp } from '../src/main/mcptoolsop';
import type { AgentInfo, ModelChoice } from '../src/shared/api';

const C = 'Claude Code';
const P = 'Copilot';
const B = (app: string): OrgVerdict => ({ why: orgBlockedText(app), refuse: true });
const D = (app: string): OrgVerdict => ({ why: orgDoubtText(app), refuse: false });
const F = (app: string): OrgVerdict => ({ why: orgFatalText(app), refuse: true });
const CF = '/etc/claude-code/managed-settings.json';
const GF = '/etc/github-copilot/managed-settings.json';
const XF = '/etc/codex/requirements.toml';
const claude = (o: unknown): OrgPolicy => parseClaudeOrgPolicy(o as Record<string, unknown>, [CF]);
const copilot = (o: unknown): OrgPolicy => parseCopilotOrgPolicy(o as Record<string, unknown>, GF);
const codex = (t: string, hosts: string[] = []): OrgPolicy => parseCodexOrgPolicy(t, XF, hosts);
/** The modes as three letters: `-` free, `B` blocked, `F` fatal, `D` advice. */
const modes = (p: OrgPolicy): string => ['read-only', 'ask', 'allow'].map((m) => { const v = modeVerdict(p, m); return !v ? '-' : !v.refuse ? 'D' : v.why.includes('will not start') ? 'F' : 'B'; }).join('');

/** A Copilot `managedSettings.resolve` answer that blocks Allow all (and, with `pad`, is padded to a size). */
const copilotAnswerOf = (pad: string | undefined): unknown => ({ resolved: { bypassPermissionsDisabled: true, managedKeys: ['permissions'], settings: { allowedMcpServers: [{ serverName: 'a' }] }, ...(pad ? { pad } : {}) } });

/** A fake file system from a map of path -> text (or a stat override). */
function fakeFs(files: Record<string, string | { text?: string; uid?: number; mode?: number; link?: boolean; dir?: string[]; throws?: string; size?: number }>): OrgFs {
  const get = (p: string) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : undefined);
  const statOf = (p: string) => {
    const f = get(p);
    if (f === undefined) return undefined;
    if (typeof f === 'object' && f.throws) throw Object.assign(new Error(f.throws), { code: f.throws });
    const dir = typeof f === 'object' && !!f.dir;
    const text = typeof f === 'string' ? f : (f.text ?? '');
    return { isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => typeof f === 'object' && !!f.link, size: typeof f === 'object' && f.size !== undefined ? f.size : text.length, uid: typeof f === 'object' && f.uid !== undefined ? f.uid : 0, mode: typeof f === 'object' && f.mode !== undefined ? f.mode : 0o644 };
  };
  return {
    lstat: statOf,
    stat: statOf,
    readFile: (p) => {
      const f = get(p);
      if (f === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return typeof f === 'string' ? f : (f.text ?? '');
    },
    readdir: (p) => {
      const f = get(p);
      return typeof f === 'object' && f.dir ? f.dir : [];
    },
  };
}

let done = false;
process.on('exit', () => {
  if (!done) process.exitCode = 1;
});

async function main(): Promise<void> {
  // (a) Claude Code
  {
    const p = claude({ permissions: { disableBypassPermissionsMode: 'disable', deny: ['Bash(rm *)', 'mcp__github__create_issue', 'mcp__my_notes', 'mcp__docs__get_*', 'mcp__x__y(z)'] }, availableModels: ['sonnet', 'claude-opus-4-1'], deniedModels: ['claude-sonnet-4'], allowedMcpServers: [{ serverName: 'github' }, { serverCommand: ['npx', '-y', 'srv'] }, { serverUrl: 'https://*.corp.example/*' }], deniedMcpServers: [{ serverName: 'evil' }] });
    assert.strictEqual(modes(p), '--B', 'a: Allow all blocked, the others not');
    assert.deepStrictEqual(modeVerdict(p, 'allow'), B(C), 'a: the words of FR-202, refused');
    assert.deepStrictEqual(p.tools.deny, ['mcp__github__create_issue', 'mcp__my_notes', 'mcp__docs__get_*'], 'a: only MCP tool rules, without parentheses');
    assert.strictEqual(modelVerdict(p, 'default'), undefined, 'a: Default is never greyed');
    assert.strictEqual(modelVerdict(p, 'auto'), undefined, 'a: Auto is never greyed');
    assert.strictEqual(modelVerdict(p, 'sonnet'), undefined, 'a: the alias itself');
    assert.deepStrictEqual(modelVerdict(p, 'claude-sonnet-4-5'), B(C), 'a: deniedModels claude-sonnet-4 also blocks later minor versions');
    assert.strictEqual(modelVerdict(p, 'claude-opus-4-1-20250805'), undefined, 'a: an allowed id permits its dated id');
    assert.strictEqual(modelVerdict(p, 'us.anthropic.claude-opus-4-1'), undefined, 'a: a provider prefix');
    assert.strictEqual(modelVerdict(p, 'claude-opus-4-1-5'), undefined, 'a: prefix match (default) permits an extension');
    assert.deepStrictEqual(modelVerdict(p, 'haiku'), B(C), 'a: not in availableModels');
    assert.deepStrictEqual(modelVerdict(p, 'claude-opus-4'), B(C), 'a: a shorter id is not covered');
    assert.deepStrictEqual(modelVerdict(p, 'xclaude-opus-4-1'), B(C), 'a: an id must start at a boundary');
    const ex = claude({ availableModels: ['claude-opus-4-1'], availableModelsMatch: 'exact' });
    assert.deepStrictEqual(modelVerdict(ex, 'claude-opus-4-1-5'), B(C), 'a: exact refuses a later version');
    assert.strictEqual(modelVerdict(ex, 'claude-opus-4-1-20250805'), undefined, 'a: exact still permits the dated id');
    assert.deepStrictEqual(modelVerdict(claude({ availableModels: ['best', 'default'] }), 'claude-opus-4-1'), B(C), 'a: best/default entries are ignored');
    assert.strictEqual(mcpVerdict(p, { name: 'github' }), undefined, 'a: allowed by name');
    assert.strictEqual(mcpVerdict(p, { name: 'n', command: 'npx', args: ['-y', 'srv'] }), undefined, 'a: allowed by exact command');
    assert.deepStrictEqual(mcpVerdict(p, { name: 'n', command: 'npx', args: ['-y', 'srv', 'x'] }), B(C), 'a: one argument more is not the command');
    assert.strictEqual(mcpVerdict(p, { name: 'n', url: 'https://mcp.corp.example/x' }), undefined, 'a: allowed by URL pattern');
    assert.deepStrictEqual(mcpVerdict(p, { name: 'n', url: 'https://corp.example.evil.test/x' }), B(C), 'a: a look-alike host');
    assert.deepStrictEqual(mcpVerdict(p, { name: 'n' }), D(C), 'a: only a name known and command/URL rules exist: advice, not refused');
    assert.deepStrictEqual(mcpVerdict(p, { name: 'evil' }), B(C), 'a: denied by name');
    assert.deepStrictEqual(mcpVerdict(p, { name: 'evil', builtin: true }), B(C), "a: Claude's deny-list applies to built-in servers");
    assert.strictEqual(mcpVerdict(p, { name: 'other', builtin: true }), undefined, 'a: built-in servers skip the allow-list');
    assert.deepStrictEqual(mcpVerdict(claude({ allowedMcpServers: [{ serverName: 'a' }] }), { name: 'b' }), B(C), 'a: only name rules: decided by name');
    assert.deepStrictEqual(toolVerdict(p, 'github', 'create_issue'), B(C), 'a: exact tool rule');
    assert.strictEqual(toolVerdict(p, 'github', 'search_issues'), undefined, 'a: another tool');
    assert.deepStrictEqual(toolVerdict(p, 'my.notes', 'read'), B(C), 'a: mcp__<server>: the server "my.notes" is "my_notes" in a rule');
    assert.deepStrictEqual(toolVerdict(p, 'docs', 'get_page'), B(C), 'a: a prefix glob');
    assert.strictEqual(toolVerdict(p, 'docs', 'put_page'), undefined, 'a: outside the glob');
    assert.strictEqual(toolVerdict(p, 'x', 'y'), undefined, 'a: a rule with parentheses is skipped');
    assert.deepStrictEqual(toolVerdict(claude({ permissions: { deny: ['mcp__*'] } }), 'any', 'thing'), B(C), 'a: mcp__* blocks every MCP tool');

    // drop-ins combine the way Claude Code documents it (review on PR 644, probe a): lists union, single values: the later file wins
    const two = fakeFs({
      [CF]: JSON.stringify({ availableModels: ['sonnet'], allowedMcpServers: [{ serverName: 'github' }], deniedMcpServers: [{ serverName: 'a' }], availableModelsMatch: 'exact' }),
      '/etc/claude-code/managed-settings.d': { dir: ['10-x.json', '.hidden.json', 'notes.txt', '20-y.json'] },
      '/etc/claude-code/managed-settings.d/10-x.json': JSON.stringify({ availableModels: ['opus', 'sonnet'], allowedMcpServers: [{ serverName: 'jira' }], deniedMcpServers: [{ serverName: 'b' }] }),
      '/etc/claude-code/managed-settings.d/20-y.json': JSON.stringify({ permissions: { disableBypassPermissionsMode: 'disable' }, availableModelsMatch: 'prefix' }),
    });
    const m = readClaudeOrgPolicy('linux', {}, two);
    assert.strictEqual(modes(m), '--B', 'a: a lock from a drop-in applies');
    assert.deepStrictEqual(m.models.allow, ['sonnet', 'opus'], 'a: allow-lists combine, duplicates removed');
    for (const id of ['sonnet', 'opus']) assert.strictEqual(modelVerdict(m, id), undefined, `a: ${id} allowed by one of the files`);
    for (const n of ['github', 'jira']) assert.strictEqual(mcpVerdict(m, { name: n }), undefined, `a: ${n} allowed by one of the files`);
    assert.deepStrictEqual(m.mcp.deny, [{ name: 'a' }, { name: 'b' }], 'a: deny-lists join');
    assert.strictEqual(m.models.exact, false, 'a: a single value: the later file wins');
    assert.deepStrictEqual(m.paths, [CF, '/etc/claude-code/managed-settings.d/10-x.json', '/etc/claude-code/managed-settings.d/20-y.json'], 'a: hidden and non-JSON drop-ins are not read; name order');
    assert.strictEqual(readClaudeOrgPolicy('linux', {}, fakeFs({})).found, false, 'a: no file: nothing found, nothing blocked');
    // review on PR 644: Claude Code reads only lower-case `*.json` drop-ins
    const upper = readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.d': { dir: ['10-x.JSON', '20-y.Json'] }, '/etc/claude-code/managed-settings.d/10-x.JSON': '{"permissions":{"disableBypassPermissionsMode":"disable"}}', '/etc/claude-code/managed-settings.d/20-y.Json': '{"permissions":{"disableBypassPermissionsMode":"disable"}}' }));
    assert.strictEqual(modes(upper), '---', 'a: a drop-in named .JSON or .Json is not read (Claude Code does not read it)');
    assert.strictEqual(modes(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: '   ' }))), '---', 'a: an empty file counts as {}');
    const win = readClaudeOrgPolicy('win32', { ProgramFiles: 'D:\\Programs' }, fakeFs({ 'D:\\Programs\\ClaudeCode\\managed-settings.json': '{"permissions":{"disableBypassPermissionsMode":"disable"}}' }));
    assert.strictEqual(modes(win), '--B', 'a: Windows path under Program Files from the environment');
    for (const bad of ['relative\\dir', '\\\\server\\share', '', '/etc']) {
      const r = readClaudeOrgPolicy('win32', { ProgramFiles: bad }, fakeFs({ 'C:\\Program Files\\ClaudeCode\\managed-settings.json': '{}' }));
      assert.deepStrictEqual(r.paths, ['C:\\Program Files\\ClaudeCode\\managed-settings.json'], `a: ProgramFiles ${JSON.stringify(bad)} is not a drive path: the default folder`);
    }
    const mac = readClaudeOrgPolicy('darwin', {}, fakeFs({ '/Library/Application Support/ClaudeCode/managed-settings.json': '{}' }));
    assert.ok(mac.found && modes(mac) === '---', 'a: macOS path; an empty object blocks nothing');
    const merged = mergeClaudeSettings(JSON.parse('{"a":{"__proto__":{"x":1}}}'), JSON.parse('{"a":{"b":[1]}}')) as Record<string, unknown>;
    assert.strictEqual(Object.getPrototypeOf(merged), null, 'a: merged objects have no prototype');
    assert.strictEqual(({} as Record<string, unknown>).x, undefined, 'a: Object.prototype untouched by a merge');
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { k: deep };
    assert.strictEqual(mergeClaudeSettings(deep, deep), undefined, 'a: past the depth limit the merge gives up');
  }

  // (b) Copilot: the runtime first, the file as a fallback
  {
    const resolveOf = (resolved: unknown) => ({ rpc: { managedSettings: { resolve: async () => ({ resolved, layers: [] }) } } });
    const r1 = await readCopilotOrgPolicy(resolveOf({ bypassPermissionsDisabled: true, deviceManaged: false, serverManaged: true, failClosed: false, managedKeys: ['permissions'], settings: { allowedMcpServers: [{ serverName: 'notes' }], deniedMcpServers: [{ serverUrl: 'https://*.evil.test/*' }] } }), () => assert.fail('b: the file is not read when the runtime answers'));
    assert.strictEqual(modes(r1), '--B', 'b: the runtime says bypass is disabled (server-managed): Allow all refused');
    assert.deepStrictEqual(mcpVerdict(r1, { name: 'x', url: 'https://a.evil.test/m' }), B(P), 'b: the runtime merged deny-list');
    assert.strictEqual(mcpVerdict(r1, { name: 'notes' }), undefined, 'b: the runtime merged allow-list');
    const r2 = await readCopilotOrgPolicy(resolveOf({ bypassPermissionsDisabled: false, deviceManaged: true, serverManaged: false, failClosed: false, managedKeys: [], settings: { permissions: { disableBypassPermissionsMode: { overridable: 'disable' } } } }), () => assert.fail('b: no file'));
    assert.strictEqual(modes(r2), '---', "b: the runtime's own verdict wins over a raw `overridable` value (a team override made it unmanaged)");
    const r3 = await readCopilotOrgPolicy(resolveOf({ bypassPermissionsDisabled: false, deviceManaged: false, serverManaged: false, failClosed: true, managedKeys: [] }), () => assert.fail('b: no file'));
    assert.deepStrictEqual(modeVerdict(r3, 'allow'), D(P), 'b: an undetermined policy is advice, not a refusal (Copilot: it does not disable bypass by itself)');
    let fileRead = 0;
    const file = (): OrgPolicy => (fileRead++, copilot({ permissions: { disableBypassPermissionsMode: 'disable' } }));
    assert.strictEqual(modes(await readCopilotOrgPolicy(undefined, file)), '--B', 'b: no runtime: the file');
    assert.strictEqual(modes(await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => { throw new Error('x'); } } } }, file)), '--B', 'b: a failing runtime: the file');
    assert.strictEqual(modes(await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => ({ resolved: { bypassPermissionsDisabled: 'yes' } }) } } }, file)), '--B', 'b: an answer that is not a resolve answer: the file');
    assert.strictEqual(fileRead, 3, 'b: the file read only in those three cases');
    const t0 = Date.now();
    assert.strictEqual(await resolveCopilotManaged({ rpc: { managedSettings: { resolve: () => new Promise(() => undefined) } } }, 50), undefined, 'b: a runtime that never answers is cut at the time limit');
    assert.ok(Date.now() - t0 < 5000, 'b: and does not hang');
    assert.strictEqual(copilotOrgPolicyFromResolve(Object.create({ resolved: { bypassPermissionsDisabled: true } })), undefined, 'b: own properties of the answer only');
    for (const v of ['disable', 'allow-auto-only']) assert.deepStrictEqual(modeVerdict(copilot({ permissions: { disableBypassPermissionsMode: v } }), 'allow'), B(P), `b: file ${v} blocks Allow all`);
    assert.deepStrictEqual(modeVerdict(copilot({ permissions: { disableBypassPermissionsMode: { overridable: 'disable' } } }), 'allow'), D(P), 'b: file `overridable`: a team file may set unmanaged: advice (probe g)');
    assert.deepStrictEqual(modeVerdict(copilot({ permissions: { overridable: { disableBypassPermissionsMode: 'disable' } } }), 'allow'), D(P), 'b: an overridable permissions block: advice');
    assert.strictEqual(modeVerdict(copilot({ permissions: { disableBypassPermissionsMode: 'unmanaged' } }), 'allow'), undefined, 'b: unmanaged blocks nothing');
    assert.deepStrictEqual(mcpVerdict(copilot({ deniedMcpServers: { overridable: [{ serverName: 'x' }] } }), { name: 'x' }), D(P), 'b: an overridable deny-list in the file: advice');
    const pp = copilot({ allowedMcpServers: [{ serverUrl: 'https://api.githubcopilot.com/*' }, { serverCommand: ['npx', '@playwright/mcp@latest'] }, { serverName: 'notes' }], deniedMcpServers: [{ serverName: 'github-mcp-server' }, { serverUrl: 'https://*.evil.test/*' }] });
    assert.strictEqual(mcpVerdict(pp, { name: 'x', url: 'HTTPS://API.GithubCopilot.com:443/mcp#frag' }), undefined, 'b: scheme and host lower-cased, default port and fragment dropped');
    assert.deepStrictEqual(mcpVerdict(pp, { name: 'x', url: 'https://api.githubcopilot.com.evil.test/mcp' }), B(P), 'b: a suffix host is not the host');
    assert.deepStrictEqual(mcpVerdict(pp, { name: 'x', url: 'https://a.evil.test/x' }), B(P), 'b: denied by URL');
    assert.strictEqual(mcpVerdict(pp, { name: 'github-mcp-server', builtin: true }), undefined, "b: Copilot's built-in servers skip both lists");
    assert.strictEqual(mcpVerdict(pp, { name: 'pw', command: 'npx', args: ['@playwright/mcp@latest'] }), undefined, 'b: allowed by command');
    const exactDeny = copilot({ deniedMcpServers: [{ serverUrl: 'https://evil.test/*' }] });
    assert.deepStrictEqual(mcpVerdict(exactDeny, { name: 'x', url: 'https://user:pw@evil.test/x' }), B(P), 'b: credentials in the URL do not hide the host');
    assert.deepStrictEqual(mcpVerdict(exactDeny, { name: 'x', url: 'https://%65vil.test/x' }), B(P), 'b: a percent-encoded host is decoded before matching');
    assert.deepStrictEqual(mcpVerdict(exactDeny, { name: 'x', url: 'https://EVIL.test.:443/x' }), B(P), 'b: case, trailing dot and default port');
    assert.strictEqual(urlMatches('https://*.example.com/*', 'https://a.b.example.com/x/y'), true, 'b: a host wildcard');
    assert.strictEqual(urlMatches('https://*.example.com/*', 'https://example.com.x/x'), false, 'b: the wildcard never crosses into the path');
    assert.strictEqual(urlMatches('https://*.example.com/*', 'http://a.example.com/x'), false, 'b: the scheme must match');
    const stripped = copilot({ allowedMcpServers: [{ serverName: 'a' }, { bad: 1 }] });
    assert.strictEqual(mcpVerdict(stripped, { name: 'a' }), undefined, 'b: the good entries of a list with a bad one');
    assert.deepStrictEqual(mcpVerdict(stripped, { name: 'z' }), D(P), "b: an allow-list that lost entries Durbar cannot read: a miss is advice (Copilot's handling is not documented)");
    const body = '{"permissions":{"disableBypassPermissionsMode":"disable"}}';
    assert.strictEqual(modes(readCopilotFileOrgPolicy('linux', {}, fakeFs({ [GF]: body }))), '--B', 'b: a root-owned file applies');
    for (const bad of [{ link: true }, { uid: 1000 }, { mode: 0o666 }]) {
      const r = readCopilotFileOrgPolicy('linux', {}, fakeFs({ [GF]: { text: body, ...bad } }));
      assert.strictEqual(modes(r), '---', `b: ignored like Copilot does: ${JSON.stringify(bad)}`);
      assert.ok(r.problems[0].includes('ignored'), 'b: and said so');
    }
    assert.strictEqual(modes(readCopilotFileOrgPolicy('win32', { ProgramFiles: 'C:\\PF' }, fakeFs({ 'C:\\PF\\GitHubCopilot\\managed-settings.json': { text: body, uid: 1000 } }))), '--B', 'b: no ownership rule on Windows');
  }

  // (c) Codex
  {
    assert.strictEqual(modes(codex('allowed_approval_policies = ["untrusted", "on-request"]\nallowed_sandbox_modes = ["read-only", "workspace-write"]\n')), 'B-B', 'c: the docs example: no never (Read-only, Allow all), no danger-full-access');
    assert.strictEqual(modes(codex('allowed_approval_policies = ["never", "on-request"]\n')), '---', 'c: both approvals allowed');
    assert.strictEqual(modes(codex('allowed_sandbox_modes = [\n  "read-only", # comment ]\n  "danger-full-access",\n]\n')), '---', 'c: a multi-line array with a comment and a trailing comma');
    assert.strictEqual(modes(codex('[allowed_permission_profiles]\n":read-only" = true\n":workspace" = true\n')), 'BBB', 'c: profiles without durbar_ro and danger-full-access');
    assert.strictEqual(modes(codex('[allowed_permission_profiles]\ndurbar_ro = true\n":danger-full-access" = false\n')), '--B', 'c: durbar_ro allowed, full access denied');
    assert.strictEqual(modes(codex('allowed_permission_profiles = { durbar_ro = true, ":danger-full-access" = true }\n')), '---', 'c: an inline table');
    assert.strictEqual(modes(codex('allowed_permission_profiles.durbar_ro = true\n')), '--B', 'c: a dotted key');
    assert.strictEqual(modes(codex('[rules]\nprefix_rules = [\n  [ "x" ],\n]\n[hooks]\n"odd\\"key" = 1\nallowed_approval_policies = ["on-request"]\n')), '---', 'c: other tables and their odd keys do not matter');
    assert.strictEqual(modes(codex('note = """\n[allowed_permission_profiles]\n"""\n')), '---', 'c: a table header inside a multi-line string is text');
    assert.deepStrictEqual(tomlStatements('a = [1,\n2]\n[t]\nb = "x # y" # c\n'), ['a = [1, 2]', '[t]', 'b = "x # y"'], 'c: statements');
    const host = 'allowed_sandbox_modes = ["read-only"]\n[[remote_sandbox_config]]\nhostname_patterns = ["*.devbox.example.com", "runner-??.ci.example.com"]\nallowed_sandbox_modes = ["read-only", "danger-full-access"]\n';
    assert.strictEqual(modes(codex(host, ['box1.devbox.example.com'])), '---', 'c: a matching host override allows full access (probe h)');
    assert.strictEqual(modes(codex(host, ['RUNNER-07.ci.example.com'])), '---', 'c: `?` and case-insensitive host matching');
    assert.strictEqual(modes(codex(host, ['runner-7.ci.example.com'])), '--D', 'c: no match by the names Durbar knows: Codex may match its fully qualified name: advice');
    assert.strictEqual(modes(codex('allowed_sandbox_modes = ["read-only"]\n[[remote_sandbox_config]]\nhostname_patterns = ["*.x"]\nallowed_sandbox_modes = ["read-only"]\n', ['a'])), '--B', 'c: an override that also blocks: still blocked');
    assert.strictEqual(modes(codex('[[remote_sandbox_config]]\nhostname_patterns = ["*"]\nallowed_sandbox_modes = ["read-only"]\n', ['laptop'])), '--B', 'c: an override that matches can block on its own');
    assert.strictEqual(modes(codex('[[remote_sandbox_config]]\nhostname_patterns = "x"\n', ['laptop'])), '--D', 'c: an override Durbar cannot read: advice');
    assert.strictEqual(hostMatches('a?c', 'abc') && !hostMatches('a?c', 'abbc'), true, 'c: ? is one character');
    const w = readCodexOrgPolicy('win32', { ProgramData: 'E:\\PD' }, fakeFs({ 'E:\\PD\\OpenAI\\Codex\\requirements.toml': 'allowed_sandbox_modes = ["read-only"]' }), []);
    assert.strictEqual(modes(w), '--B', 'c: Windows path under ProgramData');
    assert.strictEqual(readCodexOrgPolicy('linux', {}, fakeFs({}), []).found, false, 'c: no file');
  }

  // (d) hostile matrix (FR-201): the vendor's own fallback; refused only where the vendor refuses
  {
    const whole = (p: OrgPolicy, what: string, mark: 'F' | 'D'): void => {
      assert.strictEqual(modes(p), mark.repeat(3), `d: ${what}: modes`);
      const v = mark === 'F' ? F(p.app) : D(p.app);
      assert.deepStrictEqual(modelVerdict(p, 'claude-sonnet-4-5'), v, `d: ${what}: models`);
      assert.deepStrictEqual(mcpVerdict(p, { name: 'x' }), v, `d: ${what}: servers`);
      assert.deepStrictEqual(toolVerdict(p, 's', 't'), v, `d: ${what}: tools`);
      assert.ok(p.unreadable && p.problems.length === 1, `d: ${what}: one problem`);
    };
    for (const [what, text] of [['not JSON', '{"permissions":'], ['a JSON array', '[]'], ['a JSON string', '"x"'], ['null', 'null']] as const) whole(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: text })), `claude ${what} (Claude Code refuses to start)`, 'F');
    whole(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: { throws: 'EIO' } })), 'claude I/O error (Claude Code exits)', 'F');
    whole(readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.d': { dir: ['a.json'] }, '/etc/claude-code/managed-settings.d/a.json': '{bad' })), 'claude a bad drop-in', 'F');
    for (const code of ['EACCES', 'EPERM']) {
      const r = readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: { throws: code } }));
      assert.strictEqual(modes(r), '---', `d: claude ${code}: Claude Code starts without it, nothing refused (probe f)`);
      assert.ok(r.problems[0].includes('refused the read'), `d: claude ${code}: said so`);
    }
    assert.strictEqual(modes(readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.d': { throws: 'EACCES' }, [CF]: '{"permissions":{"disableBypassPermissionsMode":"disable"}}' }))), '--B', 'd: claude a refused drop-in folder is skipped, the main file still applies');
    whole(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: { text: '{}', size: 2e6 } })), 'claude larger than Durbar reads', 'D');
    whole(readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.d': { dir: Array.from({ length: 70 }, (_, i) => `${i}.json`) } })), 'claude too many drop-ins', 'D');
    whole(readCopilotFileOrgPolicy('linux', {}, fakeFs({ [GF]: 'nope' })), 'copilot file not JSON', 'D');
    whole(readCopilotFileOrgPolicy('linux', {}, fakeFs({ [GF]: { throws: 'EIO' } })), 'copilot file unreadable', 'D');
    for (const [what, text] of [['an unclosed string', 'allowed_sandbox_modes = ["read-only]\n'], ['an unclosed array', 'allowed_sandbox_modes = ["read-only"\n'], ['a stray bracket', 'a = 1]\n'], ['no equals sign', 'allowed_sandbox_modes\n'], ['a bad header', '[a.\n']] as const) {
      whole(codex(text), `codex ${what} (Codex's docs are silent: advice)`, 'D');
    }
    whole(readCodexOrgPolicy('linux', {}, fakeFs({ [XF]: { text: '', size: 2e6 } }), []), 'codex too large', 'D');

    const k = (o: unknown) => claude(o);
    assert.strictEqual(modelVerdict(k({ deniedModels: 'haiku' }), 'claude-sonnet-4-5'), undefined, 'd: an invalid deniedModels is dropped: blocks nothing (probe b)');
    assert.strictEqual(mcpVerdict(k({ deniedMcpServers: {} }), { name: 'x' }), undefined, 'd: an invalid deniedMcpServers is dropped: blocks nothing (probe c)');
    assert.strictEqual(modelVerdict(k({ availableModels: ['sonnet', 3] }), 'sonnet'), undefined, 'd: availableModels: a non-string entry is stripped, sonnet stays allowed (probe d)');
    assert.deepStrictEqual(modelVerdict(k({ availableModels: ['sonnet', 3] }), 'haiku'), B(C), 'd: and the rest is enforced');
    assert.strictEqual(toolVerdict(k({ permissions: { deny: ['mcp__a__b', 7] } }), 'c', 'd'), undefined, 'd: one bad permissions.deny entry is skipped, not every tool (probe e)');
    assert.deepStrictEqual(toolVerdict(k({ permissions: { deny: ['mcp__a__b', 7] } }), 'a', 'b'), B(C), 'd: the good one still applies');
    assert.strictEqual(toolVerdict(k({ permissions: { deny: 'mcp__a__b' } }), 'a', 'b'), undefined, 'd: a permissions.deny that is not a list blocks nothing');
    for (const v of [1, 'opus', {}]) {
      assert.deepStrictEqual(modelVerdict(k({ availableModels: v }), 'claude-sonnet-4-5'), B(C), `d: availableModels ${JSON.stringify(v)}: enforced as empty (documented)`);
      assert.strictEqual(modelVerdict(k({ availableModels: v }), 'default'), undefined, 'd: Default still offered');
      assert.deepStrictEqual(mcpVerdict(k({ allowedMcpServers: v }), { name: 'ok' }), B(C), `d: allowedMcpServers ${JSON.stringify(v)}: enforced as empty (documented)`);
    }
    assert.strictEqual(modelVerdict(k({ availableModels: null }), 'claude-sonnet-4-5'), undefined, 'd: a null removes the key');
    assert.strictEqual(mcpVerdict(k({ allowedMcpServers: [{ serverName: 'ok' }, { serverName: 'a', serverUrl: 'b' }, { serverCommand: [] }, 'x'] }), { name: 'ok' }), undefined, 'd: allowedMcpServers: bad entries stripped, ok stays allowed');
    assert.deepStrictEqual(mcpVerdict(k({ deniedMcpServers: [{ serverName: 'zzz' }, { other: 1 }] }), { name: 'zzz' }), B(C), 'd: deniedMcpServers: the valid subset is enforced');
    for (const v of [true, 'Disable', 1, ['disable'], { overridable: 'x' }]) assert.deepStrictEqual(modeVerdict(k({ permissions: { disableBypassPermissionsMode: v } }), 'allow'), B(C), `d: claude lock ${JSON.stringify(v)}: read as its restrictive value (documented)`);
    assert.strictEqual(modeVerdict(k({ permissions: { disableBypassPermissionsMode: null } }), 'allow'), undefined, 'd: claude lock null removes it');
    for (const v of ['x', [], 3]) {
      const p = k({ permissions: v });
      assert.deepStrictEqual(modeVerdict(p, 'allow'), D(C), `d: permissions ${JSON.stringify(v)} (undocumented): Allow all advice`);
      assert.deepStrictEqual(toolVerdict(p, 's', 't'), D(C), `d: permissions ${JSON.stringify(v)}: tools advice`);
    }
    // review on PR 644 (item 4): a rule Durbar cannot check against what it knows is advice, never a refusal (`false` would refuse)
    assert.deepStrictEqual(mcpVerdict(k({ allowedMcpServers: [{ serverCommand: ['npx', 'tool'] }] }), { name: 'known-by-name-only' }), D(C), 'd: a command-only allow-list against a server known only by name: advice');
    assert.deepStrictEqual(mcpVerdict(k({ allowedMcpServers: [{ serverUrl: 'https://x.test/*' }] }), { name: 'known-by-name-only' }), D(C), 'd: a URL-only allow-list against a server known only by name: advice');
    assert.deepStrictEqual(mcpVerdict(k({ deniedMcpServers: [{ serverCommand: ['npx', 'tool'] }] }), { name: 'known-by-name-only' }), undefined, 'd: and a command-only deny-list blocks nothing it cannot check');
    assert.deepStrictEqual(mcpVerdict(k({ allowedMcpServers: [{ serverCommand: ['npx', 'tool'] }] }), { name: 'remote', url: 'https://x.test/mcp' }), B(C), 'd: a remote server is never a command rule: blocked when every rule could be checked');
    assert.ok(k({ availableModelsMatch: 'fuzzy' }).models.exact, 'd: an unknown availableModelsMatch reads as exact (documented)');
    const many = Array.from({ length: 5000 }, (_, i) => `m${i}`);
    assert.deepStrictEqual(modelVerdict(k({ availableModels: many }), 'm1'), D(C), 'd: a list longer than Durbar reads: advice');
    assert.deepStrictEqual(mcpVerdict(k({ deniedMcpServers: [{ serverName: 'x'.repeat(3000) }] }), { name: 'y' }), D(C), 'd: an item longer than Durbar reads: advice');
    const inherited = Object.create({ permissions: { disableBypassPermissionsMode: 'disable' }, deniedMcpServers: [{ serverName: 'x' }] }) as Record<string, unknown>;
    assert.strictEqual(modes(claude(inherited)), '---', 'd: inherited keys are ignored');
    assert.strictEqual(mcpVerdict(claude(inherited), { name: 'x' }), undefined, 'd: inherited deny-list ignored');
    const proto = JSON.parse('{"__proto__":{"permissions":{"disableBypassPermissionsMode":"disable"}},"constructor":{"prototype":{"x":1}}}') as Record<string, unknown>;
    assert.strictEqual(modes(claude(proto)), '---', 'd: a __proto__ key is not a way in');
    assert.strictEqual(({} as Record<string, unknown>).permissions, undefined, 'd: Object.prototype untouched');
    assert.strictEqual(modes(claude(JSON.parse('{"permissions":{"__proto__":{"disableBypassPermissionsMode":"disable"}}}'))), '---', 'd: nor inside permissions');
    assert.strictEqual(ownValue(Object.create({ a: 1 }), 'a'), undefined, 'd: ownValue never reads an inherited key');
    assert.strictEqual(ownValue({ a: 1 }, 'a'), 1, 'd: ownValue reads an own key');
    assert.strictEqual(ownValue([1], '0'), undefined, 'd: ownValue: arrays are not plain objects');
    assert.strictEqual(modes(codex('allowed_approval_policies = ["never", 1]\n')), 'DDD', 'd: codex approvals with a non-string');
    assert.strictEqual(modes(codex('allowed_approval_policies = "never"\n')), 'DDD', 'd: codex approvals not an array');
    assert.strictEqual(modes(codex('allowed_approval_policies = ["never"]\nallowed_approval_policies = ["never"]\n')), 'DDD', 'd: codex a key twice');
    assert.strictEqual(modes(codex('allowed_approval_policies = ["nev\\u0065r", "on-request"]\n')), 'DDD', 'd: codex an escaped string is not read');
    assert.strictEqual(modes(codex('allowed_sandbox_modes = ["read-only", 2]\n')), '--D', 'd: codex sandbox modes bad: Allow all advice');
    assert.strictEqual(modes(codex('[allowed_permission_profiles]\ndurbar_ro = "yes"\n')), 'DDD', 'd: codex a profile not true/false');
    assert.strictEqual(modes(codex('"a\\"b" = 1\n')), 'DDD', 'd: codex a top-level key Durbar cannot read could be one of its keys');
  }

  // (e) values never leave: planted in every key, absent from problems and the window's view
  {
    const SECRET = 'ghp_' + 'A'.repeat(36);
    const ps = [
      claude({ permissions: { disableBypassPermissionsMode: SECRET, deny: [SECRET, 3] }, availableModels: [SECRET, {}], deniedModels: SECRET, allowedMcpServers: [{ serverUrl: SECRET, serverName: SECRET }], deniedMcpServers: SECRET }),
      copilot({ permissions: { disableBypassPermissionsMode: SECRET }, allowedMcpServers: SECRET, deniedMcpServers: [{ serverCommand: [SECRET, 1] }] }),
      codex(`allowed_approval_policies = ["${SECRET}", 1]\nallowed_sandbox_modes = "${SECRET}"\n[allowed_permission_profiles]\nx = "${SECRET}"\n`),
      readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: `{"x": "${SECRET}"` })),
      copilotOrgPolicyFromResolve({ resolved: { bypassPermissionsDisabled: true, failClosed: true, settings: { allowedMcpServers: [{ serverName: SECRET }, { bad: SECRET }] } } })!,
    ];
    for (const p of ps) {
      assert.ok(!JSON.stringify(p.problems).includes('ghp_'), 'e: no value in the problems');
      assert.ok(!JSON.stringify(orgPolicyView(p)).includes('ghp_'), 'e: no value in the window view');
    }
    // review on PR 644 (item 5): the VALID deny lists too (a copy of them into the view's paths or problems would leak)
    const valid = [
      claude({ deniedModels: [SECRET], deniedMcpServers: [{ serverName: SECRET }, { serverUrl: `https://x.test/${SECRET}` }, { serverCommand: [SECRET, '--k'] }], permissions: { deny: [`mcp__${SECRET}`, `mcp__s__${SECRET}`] } }),
      readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: JSON.stringify({ deniedModels: [SECRET], deniedMcpServers: [{ serverName: SECRET }], permissions: { deny: [`mcp__${SECRET}`] } }) })),
      copilot({ deniedMcpServers: [{ serverName: SECRET }, { serverUrl: `https://x.test/${SECRET}` }], allowedMcpServers: [{ serverName: SECRET }] }),
      copilotOrgPolicyFromResolve({ resolved: { bypassPermissionsDisabled: false, managedKeys: ['x'], settings: { deniedMcpServers: [{ serverName: SECRET }] } } })!,
    ];
    for (const p of valid) {
      assert.ok(p.mcp.deny.length + p.models.deny.length + p.tools.deny.length + (p.mcp.allow?.length ?? 0) > 0, 'e: the valid lists are really held (the check below is not vacuous)');
      const view = JSON.stringify(orgPolicyView(p));
      assert.ok(!view.includes('ghp_'), 'e: no value of a valid deny or allow list in the window view');
      assert.ok(!JSON.stringify(p.paths).includes('ghp_') && !JSON.stringify(p.problems).includes('ghp_'), 'e: nor in paths or problems');
      assert.ok(!view.includes('x.test'), 'e: nor a URL of a rule');
    }
    const ok = claude({ allowedMcpServers: [{ serverUrl: `https://x.test/?t=${SECRET}` }], availableModels: [SECRET] });
    assert.ok(!JSON.stringify(orgPolicyView(ok)).includes('ghp_'), 'e: a valid list is counted, not copied, in the view');
    assert.deepStrictEqual(orgPolicyView(ok).counts, { modelAllow: 1, modelDeny: 0, mcpAllow: 1, mcpDeny: 0, toolDeny: 0 }, 'e: counts');
  }

  // (f) main: the cache, the refusals, the wiring by behaviour
  {
    let t = 1000;
    let reads = 0;
    let pol: OrgPolicy = claude({ permissions: { disableBypassPermissionsMode: 'disable' }, deniedModels: ['haiku'], deniedMcpServers: [{ serverName: 'bad' }] });
    const ad = { displayName: C, readOrgPolicy: async () => (reads++, pol) };
    const cache = new OrgPolicyCache({ ids: () => ['claude', 'fake'], adapter: (id) => (id === 'claude' ? ad : id === 'fake' ? { displayName: 'Fake' } : undefined), now: () => t });
    assert.strictEqual(await cache.refusal('claude', { mode: 'allow' }), `${orgBlockedText(C)}: pick another permission mode.`, 'f: refusal words');
    assert.strictEqual(await cache.refusal('claude', { mode: 'ask', model: 'haiku' }), `${orgBlockedText(C)}: pick another model.`, 'f: model refusal');
    assert.strictEqual(await cache.refusal('claude', { mode: 'ask', model: 'sonnet' }), undefined, 'f: allowed');
    assert.strictEqual(await cache.refusal('fake', { mode: 'allow' }), undefined, 'f: an adapter without a reader refuses nothing');
    assert.strictEqual(reads, 1, 'f: read once within the TTL');
    pol = emptyOrgPolicy(C);
    t += ORG_POLICY_TTL_MS - 1;
    assert.ok(await cache.refusal('claude', { mode: 'allow' }), 'f: still cached just before the TTL');
    t += 2;
    assert.strictEqual(await cache.refusal('claude', { mode: 'allow' }), undefined, 'f: read again after the TTL');
    t -= 10 * ORG_POLICY_TTL_MS;
    await cache.fresh('claude');
    assert.strictEqual(reads, 3, 'f: a clock that went back reads again');
    pol = codex('allowed_sandbox_modes = ["read-only", 2]\n');
    t += 10 * ORG_POLICY_TTL_MS + 1;
    assert.strictEqual(await cache.refusal('claude', { mode: 'allow' }), undefined, 'f: advice (doubt) is not refused');
    const throwing = new OrgPolicyCache({ ids: () => ['x'], adapter: () => ({ displayName: 'X', readOrgPolicy: () => { throw new Error('boom ' + 'ghp_' + 'B'.repeat(36)); } }) });
    assert.strictEqual(await throwing.refusal('x', { mode: 'allow' }), undefined, 'f: a reader that throws is advice, not a refusal');
    assert.ok(!JSON.stringify(await throwing.view()).includes('ghp_'), 'f: and its error text is not kept');
    const now = new OrgPolicyCache({ ids: () => ['c'], adapter: () => ({ displayName: C, readOrgPolicy: () => claude({ permissions: { disableBypassPermissionsMode: 'disable' } }) }) });
    assert.strictEqual(now.refusalNow('c', { mode: 'allow' }), undefined, 'f: nothing read yet: no refusal (the read starts)');
    await now.fresh('c');
    assert.ok(now.refusalNow('c', { mode: 'allow' }), 'f: after the read: refused');
    // the start guard both start paths of main.ts use (startGuardOp): refused before the adapter starts; advice starts, with its words
    const starts: string[] = [];
    const startPol = new OrgPolicyCache({
      ids: () => ['c', 'x'],
      adapter: (id) => (id === 'c' ? { displayName: C, readOrgPolicy: () => claude({ permissions: { disableBypassPermissionsMode: 'disable' }, deniedModels: ['haiku'] }) } : { displayName: 'Codex', readOrgPolicy: () => codex('allowed_sandbox_modes = ["read-only", 2]\n') }),
    });
    const notes: string[] = [];
    const guard = { refusal: (id: string | undefined, ask: { mode?: string; model?: string }) => startPol.refusal(id, ask), advice: (id: string | undefined, ask: { mode?: string; model?: string }) => startPol.advice(id, ask), onNote: (t: string, sid: string) => { notes.push(`${sid}: ${t}`); } };
    const adOf = (id: string) => ({ id, start: async (o: { workspace: string }) => (starts.push(`${id}:${o.workspace}`), `sess-${o.workspace}`) });
    await assert.rejects(startGuardOp(guard, adOf('c'), { workspace: 'w1', permissionMode: 'allow', model: 'auto' }), (e: Error) => e.message === `${orgBlockedText(C)}: pick another permission mode.`, 'f: a blocked mode refuses the start');
    await assert.rejects(startGuardOp(guard, adOf('c'), { workspace: 'w2', permissionMode: 'ask', model: 'haiku' }), (e: Error) => e.message === `${orgBlockedText(C)}: pick another model.`, 'f: a blocked model refuses the start (the model of the options that are started)');
    await assert.rejects(startGuardOp(guard, adOf('c'), { workspace: 'w3', allow: true, model: 'auto' }), /pick another permission mode/, 'f: the mode is read from the options as the adapter reads them (allow: true)');
    await assert.rejects(startGuardOp(guard, adOf('c'), { workspace: 'w4', permissionMode: 'allow' }), /pick another permission mode/, 'f: options without a model still check the mode');
    assert.deepStrictEqual(starts, [], 'f: the adapter was not started for a refused start');
    assert.deepStrictEqual(await startGuardOp(guard, adOf('c'), { workspace: 'ok', permissionMode: 'ask', model: 'sonnet' }), { result: 'sess-ok' }, 'f: an allowed start starts, no note');
    assert.deepStrictEqual(await startGuardOp(guard, adOf('x'), { workspace: 'adv', permissionMode: 'allow', model: 'auto' }), { result: 'sess-adv', note: orgDoubtText('Codex') }, 'f: an advisory mode starts, with the advice words');
    assert.deepStrictEqual(notes, [`sess-adv: ${orgDoubtText('Codex')}`], 'f: the advice is shown once, for the session that started');
    assert.deepStrictEqual(starts, ['c:ok', 'x:adv'], 'f: exactly the allowed and the advisory starts ran, with their own options');
    assert.strictEqual(startModeOf({ permissionMode: 'weird' as never }), 'read-only', 'f: an unknown mode reads as read-only, as the adapters read it');
    assert.strictEqual(orgGuardedStart, startGuardOp, 'f: orgGuardedStart (the review\'s name) is the same op');
    // second layer: both start paths of main.ts go through the guard with the adapter and the options only, and nothing else in main.ts starts an adapter
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\r/g, '');
    // the two calls exactly: nothing after the spread may override what the guard checks (`{ ...opts, model: x }` would start x unchecked)
    const guardCalls = mainSrc.match(/startGuardOp\(orgGuard, ad, \{[^\n]*\}\)/g) ?? [];
    assert.deepStrictEqual(guardCalls, [
      'startGuardOp(orgGuard, ad, { ...startOptionsFor(draft), resumeSessionId: opts.resumeSessionId })',
      'startGuardOp(orgGuard, ad, { ...startOptionsFor(a), ...(resume ? { resumeSessionId: a.id } : { sessionId: a.id }), quiet: opts.quiet ?? true })',
    ], 'f: main.ts: addWorkspace and the lazy start call startGuardOp with the adapter and its start options, nothing overriding the mode or model');
    assert.deepStrictEqual(mainSrc.match(/\.start\(\s*[^)\s]/g) ?? [], [], 'f: main.ts: no other start call with arguments (an adapter start outside the guard)');
    assert.ok(/onNote: \(text, id\) => toRenderer\('agents:orgNote', \{ id, text \}\)/.test(mainSrc), 'f: main.ts: the advice goes to the window');

    const fa = new FakeAdapter({ id: 'claude' });
    const agents = new Map<string, AgentInfo>([['s', { id: 's', name: 's', cwd: '/w', folders: [], permMode: 'ask', adapterId: 'claude', model: 'sonnet' } as unknown as AgentInfo]]);
    const calls: string[] = [];
    const opsDeps = { agents, router: { forAgent: () => fa }, wsKey: (a: AgentInfo) => a.cwd, store: { setPermMode: () => (calls.push('mode'), true), setMaxAiCredits: () => true, setSessionMode: () => (calls.push('sess'), true) }, orgRefusal: (_a: AgentInfo, m: 'read-only' | 'ask' | 'allow') => (m === 'allow' ? 'no' : undefined) };
    assert.deepStrictEqual(setModeOp(opsDeps, 's', 'allow', {}), { ok: false, error: 'no' }, 'f: setModeOp refuses a blocked mode');
    assert.strictEqual(agents.get('s')!.permMode, 'ask', 'f: the mode is unchanged');
    assert.deepStrictEqual(calls, [], 'f: nothing saved');
    assert.ok(setModeOp(opsDeps, 's', 'read-only', {}).ok, 'f: another mode still works');
    const off = new Map<string, Set<string>>([['s', new Set(['bad'])]]);
    let mcpCalls = 0;
    (fa as unknown as { setMcpEnabled: unknown }).setMcpEnabled = async () => {
      mcpCalls++;
    };
    const mcpDeps = { ...opsDeps, orgMcpRefusal: async (_a: AgentInfo, n: string) => (n === 'bad' ? 'refused bad' : undefined) };
    assert.deepStrictEqual(await setMcpOp(mcpDeps, off, 's', 'bad', true), { ok: false, error: 'refused bad' }, 'f: setMcpOp refuses switching a blocked server on');
    assert.ok(off.get('s')!.has('bad') && mcpCalls === 0, 'f: nothing switched, the off list unchanged');
    assert.ok((await setMcpOp(mcpDeps, off, 's', 'good', true)).ok, 'f: another server switches on');
    assert.ok((await setMcpOp(mcpDeps, off, 's', 'bad', false)).ok, 'f: switching it off is never refused');
    const saved: string[] = [];
    let switched = 0;
    (fa as unknown as { setModel: unknown }).setModel = async (_s: string, r: { model: string }) => (switched++, { status: 'applied', model: r.model });
    const models: ModelChoice[] = [{ id: 'sonnet', name: 'S', efforts: [] }, { id: 'haiku', name: 'H', efforts: [] }];
    const md = { agents, router: { forAgent: () => fa }, defaultId: 'copilot', models: async () => models, orgModel: async (_id: string, mid: string) => modelVerdict(claude({ deniedModels: ['haiku'] }), mid), save: (_a: AgentInfo, c: { model: string }) => { saved.push(c.model); } };
    assert.deepStrictEqual(await setModelOp(md, 's', { model: 'haiku' }), { ok: false, error: `${orgBlockedText(C)}: pick another model.` }, 'f: setModelOp refuses a blocked model');
    assert.strictEqual(agents.get('s')!.model, 'sonnet', 'f: the model is unchanged');
    assert.deepStrictEqual(saved, [], 'f: nothing saved');
    assert.strictEqual(switched, 0, 'f: the adapter was not asked');
    const advice = { ...md, orgModel: async () => D(C) };
    assert.ok((await setModelOp(advice, 's', { model: 'haiku' })).ok, 'f: advice does not refuse a model');
    assert.deepStrictEqual(saved, ['haiku'], 'f: and it is saved');
    const listed = await withOrgModels(models, async (id) => (id === 'haiku' ? B(C) : id === 'sonnet' ? D(C) : undefined));
    assert.deepStrictEqual(listed, [{ id: 'sonnet', name: 'S', efforts: [], orgDoubt: orgDoubtText(C) }, { id: 'haiku', name: 'H', efforts: [], orgBlocked: orgBlockedText(C) }], 'f: models:list keeps blocked models, marked');
    const reply = agentMcpReply({ a: agents.get('s')!, ad: fa, live: [], off: new Set(), secrets: [], cli: [{ name: 'bad', enabled: true }, { name: 'maybe', enabled: true }, { name: 'good', enabled: true }], extras: [], ambientDisabled: new Set(), orgBlocked: (n) => (n === 'bad' ? B(C) : n === 'maybe' ? D(C) : undefined) });
    assert.strictEqual(reply.servers.find((x) => x.name === 'bad')?.orgBlocked, orgBlockedText(C), 'f: the row carries the reason');
    assert.strictEqual(reply.servers.find((x) => x.name === 'maybe')?.orgDoubt, orgDoubtText(C), 'f: advice is its own field');
    assert.strictEqual(reply.servers.find((x) => x.name === 'maybe')?.orgBlocked, undefined, 'f: advice is not a block');
    assert.strictEqual(reply.servers.find((x) => x.name === 'good')?.orgBlocked, undefined, 'f: an allowed row has none');
    const live = { ...fa, isLive: () => true, listMcpTools: async () => [{ name: 'create_issue' }, { name: 'search' }], displayName: C } as unknown as FakeAdapter;
    const tr = await mcpToolsOp({ agents, router: { forAgent: () => live }, secrets: () => [], orgTool: async (_id, s, tool) => toolVerdict(claude({ permissions: { deny: ['mcp__github__create_issue'] } }), s, tool) }, 's', 'github');
    assert.deepStrictEqual(tr.tools, [{ name: 'create_issue', orgBlocked: orgBlockedText(C) }, { name: 'search' }], 'f: the blocked tool carries the reason');
  }

  // (g) the matcher stays fast on a hostile pattern
  {
    const pat = '*a'.repeat(1000) + '*b';
    const text = 'a'.repeat(2048);
    const t0 = process.cpuUsage();
    for (let i = 0; i < 5; i++) assert.strictEqual(globMatch(pat, text), false);
    const used = process.cpuUsage(t0);
    const ms = (used.user + used.system) / 1000;
    assert.ok(ms < 5000, `g: 5 hostile matches took ${ms.toFixed(0)} ms of CPU`);
    // review on PR 644: the whole verdict is bounded. At the rule cap, the worst rule shape against a long URL stays cheap; past it, advice
    const per = 2000;
    const n = Math.floor(ORG_LIMITS.ruleChars / per);
    const atCap = emptyOrgPolicy('X');
    atCap.found = true;
    atCap.mcp.deny = Array.from({ length: n }, (_, i) => ({ url: 'https://x/' + '*' + 'a'.repeat(per - 13 - String(i).length) + 'b' + i }));
    atCap.tools.deny = [];
    assert.strictEqual(boundOrgPolicy(atCap), atCap, 'g: at the cap the rules are kept');
    assert.strictEqual(atCap.mcp.deny.length, n, 'g: all of them');
    const url = 'https://x/' + 'a'.repeat(2048);
    const t1 = process.cpuUsage();
    assert.strictEqual(mcpVerdict(atCap, { name: 's', url }), undefined, 'g: no rule matches');
    const u1 = process.cpuUsage(t1);
    const ms1 = (u1.user + u1.system) / 1000;
    assert.ok(ms1 < 1000, `g: one whole verdict at the cap took ${ms1.toFixed(0)} ms of CPU`);
    const over = emptyOrgPolicy('X');
    over.found = true;
    over.mcp.deny = Array.from({ length: n + 2 }, () => ({ url: 'https://x/' + 'a'.repeat(per - 10) }));
    boundOrgPolicy(over);
    assert.deepStrictEqual(mcpVerdict(over, { name: 's', url: 'https://y/' }), { why: orgDoubtText('X'), refuse: false }, 'g: past the cap: advice, never a refusal');
    assert.ok(over.problems.some((x) => x.includes('longer in total')), 'g: and said so');
    assert.ok(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: JSON.stringify({ deniedMcpServers: Array.from({ length: 40 }, (_, i) => ({ serverUrl: 'https://x/' + 'a'.repeat(2000) + i })) }) })).mcp.all === 'doubt', 'g: the Claude reader applies the cap');
    // the memo: one evaluation per server per policy read; a new read evaluates again
    const before = orgVerdictStats.evaluations;
    for (let i = 0; i < 50; i++) mcpVerdict(atCap, { name: 's', url });
    assert.strictEqual(orgVerdictStats.evaluations, before, 'g: repaints answer from the memo (no new evaluation)');
    for (let i = 0; i < 5; i++) toolVerdict(atCap, 'srv', 'tool');
    assert.strictEqual(orgVerdictStats.evaluations, before + 1, 'g: one evaluation for a new tool');
    const reread = { ...atCap };
    mcpVerdict(reread, { name: 's', url });
    assert.strictEqual(orgVerdictStats.evaluations, before + 2, 'g: a new policy read evaluates again');
    assert.strictEqual(globMatch('a*b*c', 'axxbyyc'), true, 'g: glob basics');
    assert.strictEqual(globMatch('a*b', 'ab'), true, 'g: empty star');
    assert.strictEqual(globMatch('a*b', 'ac'), false, 'g: no match');
  }

  // (i) review on PR 644 (item 3): reading a big policy is linear, bounded and skipped when nothing changed
  {
    const cpuMs = (f: () => void): number => {
      const t0 = process.cpuUsage();
      f();
      const u = process.cpuUsage(t0);
      return (u.user + u.system) / 1000;
    };
    const BOUND_MS = 1500; // the quadratic reading took 4.7 s (names) and 11 s (URLs) on the review machine; the linear one takes a few ms
    // (1) 4,096 distinct server names in a ~93 KB managed-settings.json (Ruben's probe)
    const names = Array.from({ length: ORG_LIMITS.listItems }, (_, i) => ({ serverName: `server-name-${String(i).padStart(5, '0')}` }));
    const namesFile = JSON.stringify({ allowedMcpServers: names, deniedMcpServers: names.slice(0, 100) });
    assert.ok(namesFile.length > 90_000, 'i: the names file is the size of the probe');
    let pn: OrgPolicy | undefined;
    const msNames = cpuMs(() => { pn = readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: namesFile })); });
    assert.ok(msNames < BOUND_MS, `i: 4,096 server names took ${msNames.toFixed(0)} ms of CPU (bound ${BOUND_MS})`);
    assert.ok(pn!.mcp.allow === undefined && pn!.mcp.all === 'doubt' || (pn!.mcp.allow?.length ?? 0) === ORG_LIMITS.listItems, 'i: read to the end (over the byte cap it is advice), not cut half-way');
    // (2) a large URL list (about 900 KB)
    const urls = Array.from({ length: ORG_LIMITS.listItems }, (_, i) => ({ serverUrl: `https://host${i}.example.com/` + 'p'.repeat(190) + i }));
    const urlsFile = JSON.stringify({ allowedMcpServers: urls });
    const msUrls = cpuMs(() => { readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: urlsFile })); });
    assert.ok(msUrls < BOUND_MS, `i: ${(urlsFile.length / 1024).toFixed(0)} KB of URLs took ${msUrls.toFixed(0)} ms of CPU (bound ${BOUND_MS})`);
    // (3) the same through the shared list readers, at the count cap, with duplicates (Copilot's runtime answer; strings)
    const dup = Array.from({ length: ORG_LIMITS.listItems }, (_, i) => ({ serverName: `dup-${i % 7}` }));
    const msCop = cpuMs(() => { copilotOrgPolicyFromResolve({ resolved: { bypassPermissionsDisabled: false, managedKeys: ['x'], settings: { allowedMcpServers: names, deniedMcpServers: dup } } }); });
    assert.ok(msCop < BOUND_MS, `i: the Copilot runtime answer with 4,096 names took ${msCop.toFixed(0)} ms of CPU`);
    const strs = Array.from({ length: ORG_LIMITS.listItems }, (_, i) => `model-${i}-` + 'm'.repeat(40));
    const msStr = cpuMs(() => { claude({ availableModels: strs, deniedModels: strs }); });
    assert.ok(msStr < BOUND_MS, `i: 4,096 model names took ${msStr.toFixed(0)} ms of CPU`);
    assert.deepStrictEqual(claude({ deniedModels: ['a', 'b', 'a', 'b', 'c'] }).models.deny, ['a', 'b', 'c'], 'i: duplicates still removed, in first-seen order');
    assert.deepStrictEqual(claude({ deniedMcpServers: [{ serverName: 'a' }, { serverUrl: 'a' }, { serverName: 'a' }, { serverCommand: ['a', 'b'] }, { serverCommand: ['a', 'b'] }, { serverCommand: ['a', 'b '] }] }).mcp.deny, [{ name: 'a' }, { url: 'a' }, { command: ['a', 'b'] }, { command: ['a', 'b '] }], 'i: a name, a URL and a command of the same text are different rules; only exact repeats go');
    // growth: doubling the list must not quadruple the work (a pairwise scan would)
    const grow = (n: number): number => cpuMs(() => { for (let r = 0; r < 20; r++) claude({ deniedMcpServers: Array.from({ length: n }, (_, i) => ({ serverUrl: `https://h${i}.example.com/` + 'q'.repeat(300) })) }); });
    grow(500);
    const t1 = grow(1000);
    const t2 = grow(4000);
    assert.ok(t2 < Math.max(t1 * 12, 300), `i: 4x the list took ${t2.toFixed(0)} ms against ${t1.toFixed(0)} ms (linear is about 4x; a pairwise scan 16x)`);
    // (4) the byte caps, written in the spec (FR-201): over a cap the area is advice (`doubt`), never read as permissive, never half-read
    const bigChars = Array.from({ length: 200 }, (_, i) => ({ serverUrl: `https://h${i}.example.com/` + 'z'.repeat(1500) })); // ~300 KB of rules, 200 items
    const bc = claude({ allowedMcpServers: bigChars });
    assert.strictEqual(bc.mcp.allow, undefined, 'i: a list over the byte cap is not held');
    assert.deepStrictEqual(mcpVerdict(bc, { name: 'x', url: 'https://other/' }), D(C), 'i: over the byte cap: advice for every server, not "allowed" and not a refusal');
    assert.ok(bc.problems.some((x) => x.includes('longer than Agent Durbar reads')), 'i: and said so');
    const bigStrings = Array.from({ length: 150 }, (_, i) => `${i}-` + 'y'.repeat(2000));
    assert.strictEqual(modelVerdict(claude({ availableModels: bigStrings }), 'sonnet')?.refuse, false, 'i: a string list over the byte cap: advice');
    const half = JSON.stringify({ deniedModels: ['haiku'], pad: 'x'.repeat(ORG_LIMITS.fileBytes - 100) });
    const manyFiles: Record<string, string> = { [CF]: half, '/etc/claude-code/managed-settings.d': { dir: ['10-a.json', '20-b.json', '30-c.json', '40-d.json', '50-e.json'] } as never };
    for (const n of ['10-a', '20-b', '30-c', '40-d', '50-e']) manyFiles[`/etc/claude-code/managed-settings.d/${n}.json`] = half;
    const together = readClaudeOrgPolicy('linux', {}, fakeFs(manyFiles as never));
    assert.deepStrictEqual(modelVerdict(together, 'sonnet'), D(C), 'i: files that are each under the cap but together over it: advice');
    assert.ok(together.problems.some((x) => x.includes('together')), 'i: and said so');
    // the Copilot runtime answer has a byte cap too
    const hugeAnswer = copilotAnswerOf('x'.repeat(ORG_LIMITS.totalFileBytes + 10));
    const cp = await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => hugeAnswer } } }, () => emptyOrgPolicy(P));
    assert.strictEqual(cp.found, true, 'i: an oversized runtime answer is a policy Durbar could not read');
    assert.deepStrictEqual(modeVerdict(cp, 'allow'), D(P), 'i: advice, never a refusal');
    // (5) unchanged TEXT is not parsed again (key: SHA-256 of the text read, after the size cap); a changed text is, whatever its size and times
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-076-reuse-'));
    try {
      const redirect = (from: string): OrgFs => ({ ...nodeOrgFs, lstat: (q) => nodeOrgFs.lstat(q.replace(from, real)), stat: (q) => nodeOrgFs.stat(q.replace(from, real)), readFile: (q) => nodeOrgFs.readFile(q.replace(from, real)), readdir: (q) => nodeOrgFs.readdir(q.replace(from, real)) });
      const cfs = redirect('/etc/claude-code');
      const a1 = JSON.stringify({ deniedModels: ['haiku'] });
      const a2 = JSON.stringify({ deniedModels: ['opus-'] }); // same length
      assert.strictEqual(a1.length, a2.length, 'i: the two texts have the same size');
      fs.writeFileSync(path.join(real, 'x.json'), a1);
      fs.writeFileSync(path.join(real, 'y.json'), a2);
      const when = new Date(1_700_000_000_000);
      fs.utimesSync(path.join(real, 'x.json'), when, when);
      fs.utimesSync(path.join(real, 'y.json'), when, when);
      const link = path.join(real, 'managed-settings.json');
      fs.symlinkSync(path.join(real, 'x.json'), link);
      const r1 = readClaudeOrgPolicy('linux', {}, cfs);
      assert.deepStrictEqual(r1.models.deny, ['haiku'], 'i: read through a link');
      assert.strictEqual(readClaudeOrgPolicy('linux', {}, cfs), r1, 'i: the same text gives back the same policy object (its verdict memo is kept)');
      fs.unlinkSync(link);
      fs.symlinkSync(path.join(real, 'y.json'), link); // the link now names another file with the same size and the same times
      const r2 = readClaudeOrgPolicy('linux', {}, cfs);
      assert.notStrictEqual(r2, r1, 'i: a link swapped to another file is read again');
      assert.deepStrictEqual(r2.models.deny, ['opus-'], 'i: and the new policy is what is returned (review on PR 644, item 2)');
      fs.writeFileSync(path.join(real, 'x.json'), a1.replace('haiku', 'sonnt'));
      assert.strictEqual(readClaudeOrgPolicy('linux', {}, cfs), r2, 'i: an unrelated file changing does not matter');
    } finally {
      fs.rmSync(real, { recursive: true, force: true });
    }
    // the key covers the problems too: a drop-in folder that stops being refused (same file text) drops its problem
    const same = JSON.stringify({ deniedModels: ['haiku'] });
    const refused = readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: same, '/etc/claude-code/managed-settings.d': { throws: 'EACCES' } }));
    assert.ok(refused.problems.some((x) => x.includes('refused the read')), 'i: a refused drop-in folder is a problem');
    const allowed = readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: same, '/etc/claude-code/managed-settings.d': { dir: [] } }));
    assert.deepStrictEqual(allowed.problems, [], 'i: the same file text with the folder readable again: no stale problem from the last read');
    assert.strictEqual(allowed.unreadable, false, 'i: and not unreadable');
    // a plain fake file system (no times at all) works the same: the key is the text
    let reads = 0;
    const counting: OrgFs = { ...fakeFs({ [CF]: same }), readFile: () => (reads++, same) };
    const k1 = readClaudeOrgPolicy('linux', {}, counting);
    assert.strictEqual(readClaudeOrgPolicy('linux', {}, counting), k1, 'i: no modification times needed to reuse a parse of the same text');
    // Codex: the same text gives the same policy; another host name or another text does not
    const cdx: OrgFs = { lstat: () => undefined, stat: (p) => (p === XF ? { isFile: () => true, isDirectory: () => false, size: 5 } : undefined), readFile: () => 'allowed_approval_policies = ["never"]\n', readdir: () => [] };
    const cx1 = readCodexOrgPolicy('linux', {}, cdx, []);
    assert.strictEqual(readCodexOrgPolicy('linux', {}, cdx, []), cx1, 'i: Codex: the same text gives the same policy');
    assert.notStrictEqual(readCodexOrgPolicy('linux', {}, cdx, ['other-host']), cx1, 'i: Codex: a different host name reads again (the host overrides depend on it)');
    const cdx2: OrgFs = { ...cdx, readFile: () => 'allowed_approval_policies = ["on-request"]\n' };
    assert.notStrictEqual(readCodexOrgPolicy('linux', {}, cdx2, []), cx1, 'i: Codex: another text reads again');
    const ans = copilotAnswerOf(undefined);
    const c1 = await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => ans } } }, () => emptyOrgPolicy(P));
    const c2 = await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => copilotAnswerOf(undefined) } } }, () => emptyOrgPolicy(P));
    assert.strictEqual(c2, c1, 'i: Copilot: the same runtime answer (by hash) is not parsed again');
    const c3 = await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => ({ resolved: { bypassPermissionsDisabled: false, managedKeys: ['y'] } }) } } }, () => emptyOrgPolicy(P));
    assert.notStrictEqual(c3, c1, 'i: Copilot: a different answer is parsed');
    // review on PR 644 (round 3): the Copilot file key holds the text (the same path with a new text is read again) ...
    const g1 = readCopilotFileOrgPolicy('linux', {}, fakeFs({ [GF]: JSON.stringify({ permissions: { disableBypassPermissionsMode: 'disable' } }) }));
    assert.deepStrictEqual(modeVerdict(g1, 'allow'), B(P), 'i: Copilot file: blocked');
    const g2 = readCopilotFileOrgPolicy('linux', {}, fakeFs({ [GF]: JSON.stringify({ permissions: { disableBypassPermissionsMode: 'unmanaged' } }) }));
    assert.notStrictEqual(g2, g1, 'i: Copilot file: the same path with a new text is read again');
    assert.strictEqual(modeVerdict(g2, 'allow'), undefined, 'i: and the new text is what applies');
    assert.strictEqual(readCopilotFileOrgPolicy('linux', {}, fakeFs({ [GF]: JSON.stringify({ permissions: { disableBypassPermissionsMode: 'unmanaged' } }) })), g2, 'i: Copilot file: the same text gives the same policy');
    // ... and the Claude key holds the paths (a renamed drop-in with the same text shows its new path in the view)
    const dropFs = (name: string): OrgFs => fakeFs({ [CF]: '{}', '/etc/claude-code/managed-settings.d': { dir: [name] }, [`/etc/claude-code/managed-settings.d/${name}`]: JSON.stringify({ deniedModels: ['haiku'] }) });
    const d1 = readClaudeOrgPolicy('linux', {}, dropFs('10-a.json'));
    const d2 = readClaudeOrgPolicy('linux', {}, dropFs('10-b.json'));
    assert.notStrictEqual(d2, d1, 'i: Claude: a renamed drop-in with the same text is read again');
    assert.ok(d1.paths.some((x) => x.endsWith('10-a.json')) && !d1.paths.some((x) => x.endsWith('10-b.json')), 'i: Claude: the first view names the first path');
    assert.ok(d2.paths.some((x) => x.endsWith('10-b.json')) && !d2.paths.some((x) => x.endsWith('10-a.json')), 'i: Claude: and the renamed one shows its new path, not a stale one (FR-207)');
    // a non-serialisable answer (a cycle) is not a policy Durbar can read: the file fallback answers, not a parse of the cycle
    const cyc: Record<string, unknown> = { resolved: { bypassPermissionsDisabled: true, managedKeys: ['permissions'] } };
    (cyc.resolved as Record<string, unknown>).self = cyc;
    const fallback = emptyOrgPolicy(P);
    const cy = await readCopilotOrgPolicy({ rpc: { managedSettings: { resolve: async () => cyc } } }, () => fallback);
    assert.deepStrictEqual(cy, { ...fallback, runtimeUnread: 'failed' }, 'i: Copilot: a cyclic runtime answer falls back to the file, and says so (spec 044 FR-183)');
    // the string-list byte cap (the rule list is ALSO bounded in total, so the problem text proves which cap fired)
    const bs = claude({ availableModels: Array.from({ length: 150 }, (_, i) => `${i}-` + 'y'.repeat(2000)) });
    assert.ok(bs.problems.some((x) => x.includes('availableModels is longer than Agent Durbar reads')), 'i: a string list over the byte cap says so (the list cap, not only the total)');
    const bd = claude({ deniedModels: Array.from({ length: 150 }, (_, i) => `${i}-` + 'y'.repeat(2000)) });
    assert.ok(bd.problems.some((x) => x.includes('deniedModels is longer than Agent Durbar reads')), 'i: the same for a deny-list');
  }

  done = true;
  console.log('test-orgpolicy: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
