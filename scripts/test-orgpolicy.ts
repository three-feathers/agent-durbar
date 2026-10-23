/**
 * Spec 076 section O (FR-198..FR-207, issue #602): the agent apps' own organization policies, read from fixture text and a fake file
 * system only (no real policy file, no agent app, no credits). `npm run test:orgpolicy`.
 *
 *  (a) Claude Code: the FR-200 keys, several files, the model and tool matching;
 *  (b) Copilot: the bypass values, `overridable`, MCP rules (name, command, URL with canonicalization), built-in servers;
 *  (c) Codex: the TOML subset (approvals, sandbox modes, permission profiles), dotted keys and inline tables;
 *  (d) the hostile matrix (FR-201): wrong types, inherited and `__proto__` keys, partial lists, limits, not JSON / not TOML,
 *      Copilot's file trust rule, read errors; each bad value reads as its strictest state with the "could not be read" reason;
 *  (e) nothing of a file's values leaves through problems or the window's view;
 *  (f) main: the cache (60 s), refusals with the window's words, `setModeOp`, `agentMcpReply`, `mcpToolsOp`;
 *  (g) the glob matcher stays fast on a hostile pattern.
 */
import * as assert from 'assert';
import { parseClaudeOrgPolicy, readClaudeOrgPolicy } from '../src/adapters/claudeOrgPolicy';
import { parseCopilotOrgPolicy, readCopilotOrgPolicy } from '../src/adapters/copilotOrgPolicy';
import { parseCodexOrgPolicy, readCodexOrgPolicy, tomlStatements } from '../src/adapters/codexOrgPolicy';
import type { OrgFs } from '../src/adapters/orgpolicyfiles';
import { FakeAdapter } from '../src/adapters/fake';
import { emptyOrgPolicy, ownValue, globMatch, mcpBlocked, modeBlocked, modelBlocked, orgBlockedText, orgDoubtText, orgPolicyView, toolBlocked, urlMatches } from '../src/shared/orgpolicy';
import type { OrgPolicy } from '../src/shared/orgpolicy';
import { OrgPolicyCache, ORG_POLICY_TTL_MS } from '../src/main/orgpolicy';
import { setModeOp } from '../src/main/agentops';
import { agentMcpReply } from '../src/main/mcpsession';
import { mcpToolsOp } from '../src/main/mcptoolsop';
import type { AgentInfo } from '../src/shared/api';

const C = 'Claude Code';
const BLOCK_C = orgBlockedText(C);
const DOUBT_C = orgDoubtText(C);
const claude = (o: unknown): OrgPolicy => parseClaudeOrgPolicy(o as Record<string, unknown>, '/etc/claude-code/managed-settings.json');
const copilot = (o: unknown): OrgPolicy => parseCopilotOrgPolicy(o as Record<string, unknown>, '/etc/github-copilot/managed-settings.json');
const codex = (t: string): OrgPolicy => parseCodexOrgPolicy(t, '/etc/codex/requirements.toml');
const modes = (p: OrgPolicy): string => ['read-only', 'ask', 'allow'].map((m) => (modeBlocked(p, m) ? (modeBlocked(p, m)!.includes('could not') ? 'D' : 'B') : '-')).join('');

/** A fake file system from a map of path -> text (or a stat override). */
function fakeFs(files: Record<string, string | { text?: string; uid?: number; mode?: number; link?: boolean; dir?: string[]; throws?: boolean; size?: number }>): OrgFs {
  const get = (p: string) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : undefined);
  const statOf = (p: string) => {
    const f = get(p);
    if (f === undefined) return undefined;
    if (typeof f === 'object' && f.throws) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
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
    assert.strictEqual(modeBlocked(p, 'allow'), BLOCK_C, 'a: the words of FR-202');
    assert.deepStrictEqual(p.tools.deny, ['mcp__github__create_issue', 'mcp__my_notes', 'mcp__docs__get_*'], 'a: only MCP tool rules, without parentheses');
    // models: family alias, prefix extension, deny wins, default never greyed
    assert.strictEqual(modelBlocked(p, 'default'), undefined, 'a: Default is never greyed');
    assert.strictEqual(modelBlocked(p, 'auto'), undefined, 'a: Auto is never greyed');
    assert.strictEqual(modelBlocked(p, 'sonnet'), undefined, 'a: the alias itself');
    assert.strictEqual(modelBlocked(p, 'claude-sonnet-4-5'), BLOCK_C, 'a: deniedModels claude-sonnet-4 also blocks later minor versions');
    assert.strictEqual(modelBlocked(p, 'claude-opus-4-1-20250805'), undefined, 'a: an allowed id permits its dated id');
    assert.strictEqual(modelBlocked(p, 'us.anthropic.claude-opus-4-1'), undefined, 'a: a provider prefix');
    assert.strictEqual(modelBlocked(p, 'claude-opus-4-1-5'), undefined, 'a: prefix match (default) permits an extension');
    assert.strictEqual(modelBlocked(p, 'haiku'), BLOCK_C, 'a: not in availableModels');
    assert.strictEqual(modelBlocked(p, 'claude-opus-4'), BLOCK_C, 'a: a shorter id is not covered');
    assert.strictEqual(modelBlocked(p, 'xclaude-opus-4-1'), BLOCK_C, 'a: an id must start at a boundary');
    const ex = claude({ availableModels: ['claude-opus-4-1'], availableModelsMatch: 'exact' });
    assert.strictEqual(modelBlocked(ex, 'claude-opus-4-1-5'), BLOCK_C, 'a: exact refuses a later version');
    assert.strictEqual(modelBlocked(ex, 'claude-opus-4-1-20250805'), undefined, 'a: exact still permits the dated id');
    assert.strictEqual(modelBlocked(claude({ availableModels: ['best', 'default'] }), 'claude-opus-4-1'), BLOCK_C, 'a: best/default entries are ignored');
    // MCP: name, command, URL; deny wins; built-in skips the allow-list but not Claude's deny-list
    assert.strictEqual(mcpBlocked(p, { name: 'github' }), undefined, 'a: allowed by name');
    assert.strictEqual(mcpBlocked(p, { name: 'n', command: 'npx', args: ['-y', 'srv'] }), undefined, 'a: allowed by exact command');
    assert.strictEqual(mcpBlocked(p, { name: 'n', command: 'npx', args: ['-y', 'srv', 'x'] }), BLOCK_C, 'a: one argument more is not the command');
    assert.strictEqual(mcpBlocked(p, { name: 'n', url: 'https://mcp.corp.example/x' }), undefined, 'a: allowed by URL pattern');
    assert.strictEqual(mcpBlocked(p, { name: 'n', url: 'https://corp.example.evil.test/x' }), BLOCK_C, 'a: a look-alike host');
    assert.strictEqual(mcpBlocked(p, { name: 'n' }), undefined, 'a: only a name known and command/URL rules exist: left as it is');
    assert.strictEqual(mcpBlocked(p, { name: 'evil' }), BLOCK_C, 'a: denied by name');
    assert.strictEqual(mcpBlocked(p, { name: 'evil', builtin: true }), BLOCK_C, "a: Claude's deny-list applies to built-in servers");
    assert.strictEqual(mcpBlocked(p, { name: 'other', builtin: true }), undefined, 'a: built-in servers skip the allow-list');
    assert.strictEqual(mcpBlocked(claude({ allowedMcpServers: [{ serverName: 'a' }] }), { name: 'b' }), BLOCK_C, 'a: only name rules: decided by name');
    // tools
    assert.strictEqual(toolBlocked(p, 'github', 'create_issue'), BLOCK_C, 'a: exact tool rule');
    assert.strictEqual(toolBlocked(p, 'github', 'search_issues'), undefined, 'a: another tool');
    assert.strictEqual(toolBlocked(p, 'my.notes', 'read'), BLOCK_C, 'a: mcp__<server>: the server "my.notes" is "my_notes" in a rule');
    assert.strictEqual(toolBlocked(p, 'docs', 'get_page'), BLOCK_C, 'a: a prefix glob');
    assert.strictEqual(toolBlocked(p, 'docs', 'put_page'), undefined, 'a: outside the glob');
    assert.strictEqual(toolBlocked(p, 'x', 'y'), undefined, 'a: a rule with parentheses is skipped');
    assert.strictEqual(toolBlocked(claude({ permissions: { deny: ['mcp__*'] } }), 'any', 'thing'), BLOCK_C, 'a: mcp__* blocks every MCP tool');
    // several files: locks add up, deny-lists join, allow-lists intersect
    const fs1 = fakeFs({
      '/etc/claude-code/managed-settings.json': JSON.stringify({ availableModels: ['sonnet', 'opus'], deniedMcpServers: [{ serverName: 'a' }] }),
      '/etc/claude-code/managed-settings.d': { dir: ['10-x.json', '.hidden.json', 'notes.txt'] },
      '/etc/claude-code/managed-settings.d/10-x.json': JSON.stringify({ permissions: { disableBypassPermissionsMode: 'disable' }, availableModels: ['opus'], deniedMcpServers: [{ serverName: 'b' }] }),
    });
    const m = readClaudeOrgPolicy('linux', {}, fs1);
    assert.strictEqual(modes(m), '--B', 'a: a lock from a drop-in applies');
    assert.deepStrictEqual(m.models.allow, ['opus'], 'a: allow-lists intersect');
    assert.deepStrictEqual(m.mcp.deny, [{ serverName: 'a' }, { serverName: 'b' }].map((x) => ({ name: x.serverName })), 'a: deny-lists join');
    assert.deepStrictEqual(m.paths, ['/etc/claude-code/managed-settings.json', '/etc/claude-code/managed-settings.d/10-x.json'], 'a: hidden and non-JSON drop-ins are not read');
    assert.strictEqual(readClaudeOrgPolicy('linux', {}, fakeFs({})).found, false, 'a: no file: nothing found, nothing blocked');
    assert.strictEqual(modeBlocked(readClaudeOrgPolicy('linux', {}, fakeFs({})), 'allow'), undefined, 'a: no file: Allow all offered');
    const win = readClaudeOrgPolicy('win32', { ProgramFiles: 'D:\\Programs' }, fakeFs({ 'D:\\Programs\\ClaudeCode\\managed-settings.json': '{"permissions":{"disableBypassPermissionsMode":"disable"}}' }));
    assert.strictEqual(modes(win), '--B', 'a: Windows path under Program Files from the environment');
    const mac = readClaudeOrgPolicy('darwin', {}, fakeFs({ '/Library/Application Support/ClaudeCode/managed-settings.json': '{}' }));
    assert.ok(mac.found && modes(mac) === '---', 'a: macOS path; an empty object blocks nothing');
  }

  // (b) Copilot
  {
    const P = 'Copilot';
    for (const v of ['disable', 'allow-auto-only', { overridable: 'disable' }]) assert.strictEqual(modeBlocked(copilot({ permissions: { disableBypassPermissionsMode: v } }), 'allow'), orgBlockedText(P), `b: ${JSON.stringify(v)} blocks Allow all`);
    assert.strictEqual(modeBlocked(copilot({ permissions: { disableBypassPermissionsMode: 'unmanaged' } }), 'allow'), undefined, 'b: unmanaged blocks nothing');
    assert.strictEqual(modeBlocked(copilot({ permissions: { overridable: { disableBypassPermissionsMode: 'disable' } } }), 'allow'), orgBlockedText(P), 'b: an overridable permissions object');
    const p = copilot({ allowedMcpServers: [{ serverUrl: 'https://api.githubcopilot.com/*' }, { serverCommand: ['npx', '@playwright/mcp@latest'] }, { serverName: 'notes' }], deniedMcpServers: { overridable: [{ serverName: 'github-mcp-server' }, { serverUrl: 'https://*.evil.test/*' }] } });
    assert.strictEqual(mcpBlocked(p, { name: 'x', url: 'HTTPS://API.GithubCopilot.com:443/mcp#frag' }), undefined, 'b: scheme and host lower-cased, default port and fragment dropped');
    assert.strictEqual(mcpBlocked(p, { name: 'x', url: 'https://api.githubcopilot.com.evil.test/mcp' }), orgBlockedText(P), 'b: a suffix host is not the host');
    assert.strictEqual(mcpBlocked(p, { name: 'x', url: 'https://user@evil.test/@api.githubcopilot.com/' }), orgBlockedText(P), 'b: credentials never match');
    assert.strictEqual(mcpBlocked(p, { name: 'x', url: 'https://a.evil.test/x' }), orgBlockedText(P), 'b: denied by URL');
    assert.strictEqual(mcpBlocked(p, { name: 'x', url: 'https://%65vil.test.evil.test/x' }), orgBlockedText(P), 'b: percent-encoded host octets are decoded first');
    assert.strictEqual(mcpBlocked(p, { name: 'github-mcp-server', builtin: true }), undefined, "b: Copilot's built-in servers skip both lists");
    assert.strictEqual(mcpBlocked(p, { name: 'notes', command: 'node', args: ['x.js'] }), undefined, 'b: allowed by name');
    assert.strictEqual(mcpBlocked(p, { name: 'pw', command: 'npx', args: ['@playwright/mcp@latest'] }), undefined, 'b: allowed by command');
    assert.strictEqual(urlMatches('https://*.example.com/*', 'https://a.b.example.com/x/y'), true, 'b: a host wildcard');
    const exactDeny = copilot({ deniedMcpServers: [{ serverUrl: 'https://evil.test/*' }] });
    assert.strictEqual(mcpBlocked(exactDeny, { name: 'x', url: 'https://user:pw@evil.test/x' }), orgBlockedText(P), 'b: credentials in the URL do not hide the host');
    assert.strictEqual(mcpBlocked(exactDeny, { name: 'x', url: 'https://%65vil.test/x' }), orgBlockedText(P), 'b: a percent-encoded host is decoded before matching');
    assert.strictEqual(mcpBlocked(exactDeny, { name: 'x', url: 'https://EVIL.test.:443/x' }), orgBlockedText(P), 'b: case, trailing dot and default port');
    assert.strictEqual(urlMatches('https://*.example.com/*', 'https://example.com.x/x'), false, 'b: the wildcard never crosses into the path');
    assert.strictEqual(urlMatches('https://*.example.com/*', 'http://a.example.com/x'), false, 'b: the scheme must match');
    // file trust (POSIX): Copilot ignores a link, a file not owned by root, a file writable by others
    const F = '/etc/github-copilot/managed-settings.json';
    const body = '{"permissions":{"disableBypassPermissionsMode":"disable"}}';
    assert.strictEqual(modes(readCopilotOrgPolicy('linux', {}, fakeFs({ [F]: body }))), '--B', 'b: a root-owned file applies');
    for (const bad of [{ link: true }, { uid: 1000 }, { mode: 0o666 }]) {
      const r = readCopilotOrgPolicy('linux', {}, fakeFs({ [F]: { text: body, ...bad } }));
      assert.strictEqual(modes(r), '---', `b: ignored like Copilot does: ${JSON.stringify(bad)}`);
      assert.ok(r.problems[0].includes('ignored'), 'b: and said so');
    }
    assert.strictEqual(modes(readCopilotOrgPolicy('win32', { ProgramFiles: 'C:\\PF' }, fakeFs({ 'C:\\PF\\GitHubCopilot\\managed-settings.json': { text: body, uid: 1000 } }))), '--B', 'b: no ownership rule on Windows');
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
    assert.strictEqual(modes(codex('[rules]\nprefix_rules = [\n  [ "x" ],\n]\n[hooks]\n"odd\\"key" = 1\nallowed_approval_policies = ["on-request"]\n')), '---', 'c: other tables and their odd keys do not matter; a key in another table is not ours');
    assert.strictEqual(modes(codex('note = """\n[allowed_permission_profiles]\n"""\n')), '---', 'c: a table header inside a multi-line string is text');
    assert.strictEqual(modes(codex('# only a comment\n')), '---', 'c: nothing set');
    assert.deepStrictEqual(tomlStatements('a = [1,\n2]\n[t]\nb = "x # y" # c\n'), ['a = [1, 2]', '[t]', 'b = "x # y"'], 'c: statements');
    const w = readCodexOrgPolicy('win32', { ProgramData: 'E:\\PD' }, fakeFs({ 'E:\\PD\\OpenAI\\Codex\\requirements.toml': 'allowed_sandbox_modes = ["read-only"]' }));
    assert.strictEqual(modes(w), '--B', 'c: Windows path under ProgramData');
    assert.strictEqual(readCodexOrgPolicy('linux', {}, fakeFs({})).found, false, 'c: no file');
  }

  // (d) hostile matrix (FR-201): strictest state, "could not be read"
  {
    const strict = (p: OrgPolicy, what: string, allModes = false): void => {
      assert.strictEqual(modes(p), allModes ? 'DDD' : '--D', `d: ${what}: modes`);
      assert.strictEqual(modelBlocked(p, 'claude-sonnet-4-5'), orgDoubtText(p.app), `d: ${what}: models`);
      assert.strictEqual(mcpBlocked(p, { name: 'x' }), orgDoubtText(p.app), `d: ${what}: servers`);
      assert.strictEqual(toolBlocked(p, 's', 't'), orgDoubtText(p.app), `d: ${what}: tools`);
      assert.ok(p.unreadable && p.problems.length === 1, `d: ${what}: one problem`);
    };
    const CF = '/etc/claude-code/managed-settings.json';
    for (const [what, text] of [['not JSON', '{"permissions":'], ['a JSON array', '[]'], ['a JSON string', '"x"'], ['null', 'null'], ['empty', '']] as const) strict(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: text })), `claude ${what}`);
    strict(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: { text: '{}', size: 300 * 1024 } })), 'claude too large');
    strict(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: { throws: true } })), 'claude unreadable');
    strict(readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.d': { throws: true } })), 'claude unreadable drop-in folder');
    strict(readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.d': { dir: Array.from({ length: 40 }, (_, i) => `${i}.json`) } })), 'claude too many drop-ins');
    strict(readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.d': { dir: ['a.json'] }, '/etc/claude-code/managed-settings.d/a.json': '{bad' })), 'claude a bad drop-in');
    assert.strictEqual(modes(readClaudeOrgPolicy('linux', {}, fakeFs({ [CF]: '\ufeff{}' }))), '---', 'd: a BOM is fine');
    const GF = '/etc/github-copilot/managed-settings.json';
    strict(readCopilotOrgPolicy('linux', {}, fakeFs({ [GF]: 'nope' })), 'copilot not JSON');
    strict(readCopilotOrgPolicy('linux', {}, fakeFs({ [GF]: { throws: true } })), 'copilot unreadable');
    for (const [what, text] of [['an unclosed string', 'allowed_sandbox_modes = ["read-only]\n'], ['an unclosed array', 'allowed_sandbox_modes = ["read-only"\n'], ['a stray bracket', 'a = 1]\n'], ['no equals sign', 'allowed_sandbox_modes\n'], ['a bad header', '[a.\n']] as const) {
      strict(codex(text), `codex ${what}`, true);
    }
    strict(readCodexOrgPolicy('linux', {}, fakeFs({ '/etc/codex/requirements.toml': { text: '', size: 1e9 } })), 'codex too large', true);

    // a single bad key: that key's strictest state, the rest as written (all or nothing per key)
    const k = (o: unknown) => claude(o);
    const many = Array.from({ length: 257 }, (_, i) => `m${i}`);
    const long = 'x'.repeat(513);
    const badLists: unknown[] = [null, 1, 'opus', {}, [1], ['ok', 2], [''], many, [long], [['nested']]];
    for (const v of badLists) {
      assert.strictEqual(modelBlocked(k({ availableModels: v }), 'claude-sonnet-4-5'), DOUBT_C, `d: availableModels ${JSON.stringify(v)?.slice(0, 30)}: empty allow-list`);
      assert.strictEqual(modelBlocked(k({ availableModels: v }), 'default'), undefined, 'd: Default still offered');
      assert.strictEqual(modelBlocked(k({ deniedModels: v }), 'claude-sonnet-4-5'), DOUBT_C, `d: deniedModels ${JSON.stringify(v)?.slice(0, 30)}: deny all`);
      assert.strictEqual(toolBlocked(k({ permissions: { deny: v } }), 's', 't'), DOUBT_C, `d: permissions.deny ${JSON.stringify(v)?.slice(0, 30)}: deny all`);
    }
    const badRules: unknown[] = [null, 'x', {}, [{}], [{ serverName: 'a', serverUrl: 'b' }], [{ serverName: 1 }], [{ serverCommand: [] }], [{ serverCommand: ['a', 1] }], [{ serverCommand: 'npx' }], [{ other: 'x' }], [{ serverName: 'ok' }, 'x'], Array.from({ length: 257 }, () => ({ serverName: 'a' }))];
    for (const v of badRules) {
      assert.strictEqual(mcpBlocked(k({ allowedMcpServers: v }), { name: 'ok' }), DOUBT_C, `d: allowedMcpServers ${JSON.stringify(v)?.slice(0, 40)}: empty allow-list`);
      assert.strictEqual(mcpBlocked(k({ deniedMcpServers: v }), { name: 'zzz' }), DOUBT_C, `d: deniedMcpServers ${JSON.stringify(v)?.slice(0, 40)}: deny all`);
      assert.strictEqual(mcpBlocked(copilot({ deniedMcpServers: v }), { name: 'zzz' }), orgDoubtText('Copilot'), `d: copilot deniedMcpServers ${JSON.stringify(v)?.slice(0, 40)}`);
    }
    for (const v of [true, 'Disable', 1, null, ['disable'], { overridable: 'x' }]) {
      assert.strictEqual(modeBlocked(k({ permissions: { disableBypassPermissionsMode: v } }), 'allow'), DOUBT_C, `d: claude lock ${JSON.stringify(v)}: locked`);
      assert.strictEqual(modeBlocked(copilot({ permissions: { disableBypassPermissionsMode: v } }), 'allow'), orgDoubtText('Copilot'), `d: copilot lock ${JSON.stringify(v)}: locked`);
    }
    for (const v of [null, 'x', [], 3]) {
      const p = k({ permissions: v });
      assert.strictEqual(modeBlocked(p, 'allow'), DOUBT_C, `d: permissions ${JSON.stringify(v)}: Allow all locked`);
      assert.strictEqual(toolBlocked(p, 's', 't'), DOUBT_C, `d: permissions ${JSON.stringify(v)}: tools denied`);
    }
    assert.ok(k({ availableModelsMatch: 'fuzzy' }).models.exact, 'd: an unknown availableModelsMatch reads as exact');
    // a bad key leaves the other keys as written
    const mixed = k({ deniedModels: 3, permissions: { disableBypassPermissionsMode: 'disable' }, allowedMcpServers: [{ serverName: 'a' }] });
    assert.strictEqual(modeBlocked(mixed, 'allow'), BLOCK_C, 'd: a good key next to a bad one is read as written');
    assert.strictEqual(mcpBlocked(mixed, { name: 'a' }), undefined, 'd: and its allow-list too');
    // own properties only: an inherited key or `__proto__` is never read
    const inherited = Object.create({ permissions: { disableBypassPermissionsMode: 'disable' }, deniedMcpServers: [{ serverName: 'x' }] }) as Record<string, unknown>;
    assert.strictEqual(modes(claude(inherited)), '---', 'd: inherited keys are ignored');
    assert.strictEqual(mcpBlocked(claude(inherited), { name: 'x' }), undefined, 'd: inherited deny-list ignored');
    const proto = JSON.parse('{"__proto__":{"permissions":{"disableBypassPermissionsMode":"disable"}},"constructor":{"prototype":{"x":1}}}') as Record<string, unknown>;
    assert.strictEqual(modes(claude(proto)), '---', 'd: a __proto__ key is not a way in');
    assert.strictEqual(({} as Record<string, unknown>).permissions, undefined, 'd: Object.prototype untouched');
    const permProto = JSON.parse('{"permissions":{"__proto__":{"disableBypassPermissionsMode":"disable"}}}');
    assert.strictEqual(modes(claude(permProto)), '---', 'd: nor inside permissions');
    assert.strictEqual(ownValue(Object.create({ a: 1 }), 'a'), undefined, 'd: ownValue never reads an inherited key');
    assert.strictEqual(ownValue({ a: 1 }, 'a'), 1, 'd: ownValue reads an own key');
    assert.strictEqual(ownValue([1], '0'), undefined, 'd: ownValue: arrays are not plain objects');
    // Codex single bad keys
    assert.strictEqual(modes(codex('allowed_approval_policies = ["never", 1]\n')), 'DDD', 'd: codex approvals with a non-string: all modes');
    assert.strictEqual(modes(codex('allowed_approval_policies = "never"\n')), 'DDD', 'd: codex approvals not an array');
    assert.strictEqual(modes(codex('allowed_approval_policies = ["never"]\nallowed_approval_policies = ["never"]\n')), 'DDD', 'd: codex a key twice');
    assert.strictEqual(modes(codex('allowed_approval_policies = ["nev\\u0065r", "on-request"]\n')), 'DDD', 'd: codex an escaped string is not read');
    assert.strictEqual(modes(codex('allowed_sandbox_modes = ["read-only", 2]\n')), '--D', 'd: codex sandbox modes bad: Allow all');
    assert.strictEqual(modes(codex('[allowed_permission_profiles]\ndurbar_ro = "yes"\n')), 'DDD', 'd: codex a profile not true/false');
    assert.strictEqual(modes(codex('[[allowed_permission_profiles]]\n')), 'DDD', 'd: codex profiles as an array of tables');
    assert.strictEqual(modes(codex('"a\\"b" = 1\n')), 'DDD', 'd: codex a top-level key Durbar cannot read could be one of its keys');
    assert.strictEqual(modes(codex(`allowed_sandbox_modes = [${Array.from({ length: 300 }, () => '"x"').join(',')}]\n`)), '--D', 'd: codex a list over the limit');
  }

  // (e) values never leave: planted in every key, absent from problems and the window's view
  {
    const SECRET = 'ghp_' + 'A'.repeat(36);
    const ps = [
      claude({ permissions: { disableBypassPermissionsMode: SECRET, deny: [SECRET, 3] }, availableModels: [SECRET, {}], deniedModels: SECRET, allowedMcpServers: [{ serverUrl: SECRET, serverName: SECRET }], deniedMcpServers: SECRET }),
      copilot({ permissions: { disableBypassPermissionsMode: SECRET }, allowedMcpServers: SECRET, deniedMcpServers: [{ serverCommand: [SECRET, 1] }] }),
      codex(`allowed_approval_policies = ["${SECRET}", 1]\nallowed_sandbox_modes = "${SECRET}"\n[allowed_permission_profiles]\nx = "${SECRET}"\n`),
      readClaudeOrgPolicy('linux', {}, fakeFs({ '/etc/claude-code/managed-settings.json': `{"x": "${SECRET}"` })),
    ];
    for (const p of ps) {
      assert.ok(!JSON.stringify(p.problems).includes('ghp_'), 'e: no value in the problems');
      assert.ok(!JSON.stringify(orgPolicyView(p)).includes('ghp_'), 'e: no value in the window view');
    }
    const ok = claude({ allowedMcpServers: [{ serverUrl: `https://x.test/?t=${SECRET}` }], availableModels: [SECRET] });
    assert.ok(!JSON.stringify(orgPolicyView(ok)).includes('ghp_'), 'e: a valid list is counted, not copied, in the view');
    assert.deepStrictEqual(orgPolicyView(ok).counts, { modelAllow: 1, modelDeny: 0, mcpAllow: 1, mcpDeny: 0, toolDeny: 0 }, 'e: counts');
  }

  // (f) main: the cache, the refusals, the wiring
  {
    let t = 1000;
    let reads = 0;
    let pol: OrgPolicy = claude({ permissions: { disableBypassPermissionsMode: 'disable' }, deniedModels: ['haiku'], deniedMcpServers: [{ serverName: 'bad' }], permissions2: 1 });
    const ad = { displayName: C, readOrgPolicy: () => (reads++, pol) };
    const cache = new OrgPolicyCache({ ids: () => ['claude', 'fake'], adapter: (id) => (id === 'claude' ? ad : id === 'fake' ? { displayName: 'Fake' } : undefined), now: () => t });
    assert.strictEqual(cache.refusal('claude', { mode: 'allow' }), `${BLOCK_C}: pick another permission mode.`, 'f: refusal words');
    assert.strictEqual(cache.refusal('claude', { mode: 'ask', model: 'haiku' }), `${BLOCK_C}: pick another model.`, 'f: model refusal');
    assert.strictEqual(cache.refusal('claude', { mode: 'ask', model: 'sonnet' }), undefined, 'f: allowed');
    assert.strictEqual(cache.refusal('fake', { mode: 'allow' }), undefined, 'f: an adapter without a reader refuses nothing');
    assert.strictEqual(cache.refusal(undefined, { mode: 'allow' }), undefined, 'f: no app');
    assert.strictEqual(reads, 1, 'f: read once within the TTL');
    pol = emptyOrgPolicy(C);
    t += ORG_POLICY_TTL_MS - 1;
    assert.ok(cache.refusal('claude', { mode: 'allow' }), 'f: still cached just before the TTL');
    t += 2;
    assert.strictEqual(cache.refusal('claude', { mode: 'allow' }), undefined, 'f: read again after the TTL');
    t -= 10 * ORG_POLICY_TTL_MS;
    cache.get('claude');
    assert.strictEqual(reads, 3, 'f: a clock that went back reads again');
    const throwing = new OrgPolicyCache({ ids: () => ['x'], adapter: () => ({ displayName: 'X', readOrgPolicy: () => { throw new Error('boom ' + 'ghp_' + 'B'.repeat(36)); } }) });
    assert.strictEqual(throwing.refusal('x', { mode: 'allow' }), `${orgDoubtText('X')}: pick another permission mode.`, 'f: a reader that throws is the strictest state');
    assert.ok(!JSON.stringify(throwing.view()).includes('ghp_'), 'f: and its error text is not kept');
    assert.deepStrictEqual(Object.keys(cache.view()), ['claude'], 'f: the view lists the apps that read a policy');

    // setModeOp refuses before anything changes
    const fa = new FakeAdapter({ id: 'claude' });
    const agents = new Map<string, AgentInfo>([['s', { id: 's', name: 's', cwd: '/w', folders: [], permMode: 'ask', adapterId: 'claude' } as unknown as AgentInfo]]);
    const calls: string[] = [];
    const deps = { agents, router: { forAgent: () => fa }, wsKey: (a: AgentInfo) => a.cwd, store: { setPermMode: () => (calls.push('mode'), true), setMaxAiCredits: () => true, setSessionMode: () => (calls.push('sess'), true) }, orgRefusal: (_a: AgentInfo, m: 'read-only' | 'ask' | 'allow') => (m === 'allow' ? 'no' : undefined) };
    assert.deepStrictEqual(setModeOp(deps, 's', 'allow', {}), { ok: false, error: 'no' }, 'f: setModeOp refuses a blocked mode');
    assert.strictEqual(agents.get('s')!.permMode, 'ask', 'f: the mode is unchanged');
    assert.deepStrictEqual(calls, [], 'f: nothing saved');
    assert.ok(setModeOp(deps, 's', 'read-only', {}).ok, 'f: another mode still works');

    // agentMcpReply marks the row; mcpToolsOp marks the tool
    const reply = agentMcpReply({ a: agents.get('s')!, ad: fa, live: [], off: new Set(), secrets: [], cli: [{ name: 'bad', enabled: true }, { name: 'good', enabled: true }], extras: [], ambientDisabled: new Set(), orgBlocked: (n) => (n === 'bad' ? BLOCK_C : undefined) });
    assert.strictEqual(reply.servers.find((x) => x.name === 'bad')?.orgBlocked, BLOCK_C, 'f: the row carries the reason');
    assert.strictEqual(reply.servers.find((x) => x.name === 'good')?.orgBlocked, undefined, 'f: an allowed row does not');
    const live = { ...fa, isLive: () => true, listMcpTools: async () => [{ name: 'create_issue' }, { name: 'search' }], displayName: C } as unknown as FakeAdapter;
    const tr = await mcpToolsOp({ agents, router: { forAgent: () => live }, secrets: () => [], orgTool: (_id, s, tool) => toolBlocked(claude({ permissions: { deny: ['mcp__github__create_issue'] } }), s, tool) }, 's', 'github');
    assert.deepStrictEqual(tr.tools, [{ name: 'create_issue', orgBlocked: BLOCK_C }, { name: 'search' }], 'f: the blocked tool carries the reason');
  }

  // (g) the matcher stays fast on a hostile pattern (capped at 512 characters by the readers)
  {
    const pat = '*a'.repeat(250) + '*b';
    const text = 'a'.repeat(512);
    const t0 = process.cpuUsage();
    for (let i = 0; i < 20; i++) assert.strictEqual(globMatch(pat, text), false);
    const ms = (process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000;
    assert.ok(ms < 2000, `g: 20 hostile matches took ${ms.toFixed(0)} ms of CPU`);
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
