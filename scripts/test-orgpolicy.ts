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
import type { OrgFs } from '../src/adapters/orgpolicyfiles';
import { FakeAdapter } from '../src/adapters/fake';
import { emptyOrgPolicy, globMatch, mcpVerdict, modelVerdict, modeVerdict, orgBlockedText, orgDoubtText, orgFatalText, orgPolicyView, ownValue, toolVerdict, urlMatches } from '../src/shared/orgpolicy';
import type { OrgPolicy, OrgVerdict } from '../src/shared/orgpolicy';
import { OrgPolicyCache, ORG_POLICY_TTL_MS } from '../src/main/orgpolicy';
import { setMcpOp, setModeOp, startGuardOp } from '../src/main/agentops';
import * as fs from 'fs';
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
    const go = (tag: string) => async () => (starts.push(tag), `id-${tag}`);
    await assert.rejects(startGuardOp(startPol, 'c', { mode: 'allow', model: 'auto' }, go('mode')), (e: Error) => e.message === `${orgBlockedText(C)}: pick another permission mode.`, 'f: a blocked mode refuses the start');
    await assert.rejects(startGuardOp(startPol, 'c', { mode: 'ask', model: 'haiku' }, go('model')), (e: Error) => e.message === `${orgBlockedText(C)}: pick another model.`, 'f: a blocked model refuses the start');
    assert.deepStrictEqual(starts, [], 'f: the adapter was not started for a refused start');
    assert.deepStrictEqual(await startGuardOp(startPol, 'c', { mode: 'ask', model: 'sonnet' }, go('ok')), { result: 'id-ok' }, 'f: an allowed start starts, no note');
    assert.deepStrictEqual(await startGuardOp(startPol, 'x', { mode: 'allow', model: 'auto' }, go('advice')), { result: 'id-advice', note: orgDoubtText('Codex') }, 'f: an advisory mode starts, with the advice words');
    assert.deepStrictEqual(starts, ['ok', 'advice'], 'f: exactly the allowed and the advisory starts ran');
    // second layer: both start paths of main.ts go through the guard, and nothing in main.ts calls an adapter's start directly
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\r/g, '');
    assert.strictEqual((mainSrc.match(/startGuardOp\(orgPolicies, /g) ?? []).length, 2, 'f: main.ts: addWorkspace and the lazy start call startGuardOp');
    assert.strictEqual((mainSrc.match(/await ad\.start\(/g) ?? []).length, 0, 'f: main.ts: no adapter start outside the guard');

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
    assert.strictEqual(globMatch('a*b*c', 'axxbyyc'), true, 'g: glob basics');
    assert.strictEqual(globMatch('a*b', 'ab'), true, 'g: empty star');
    assert.strictEqual(globMatch('a*b', 'ac'), false, 'g: no match');
  }

  done = true;
  console.log('test-orgpolicy: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
