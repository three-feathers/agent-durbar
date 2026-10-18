/** Claude permission modes (spec 012 T021): mode -> SDK options, tool name -> kind, Read-only PreToolUse decision. `npm run test:runtime`. No credits spent. */
import * as assert from 'assert';
import { claudeOptionsFor, decideTool, readIsInsideRoots, isReadTool, parseMcpTool, preToolUseDecision, toolKind } from '../src/adapters/claudeModes';
import * as path from 'path';
import type { PermissionMode } from '../src/adapters/capabilities';

// Read-only's allowedTools equals the tools whose kind is read (dontAsk needs it; the hook enforces the roots).
{
  const listed = [...(claudeOptionsFor('read-only').allowedTools ?? [])].sort();
  for (const t of listed) assert.strictEqual(toolKind(t), 'read', `read-only: allowedTools ${t} is a read tool`);
  for (const t of ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']) assert.ok(listed.includes(t), `read-only: allowedTools includes ${t}`);
  assert.strictEqual(listed.length, 5, 'read-only: allowedTools is exactly the read set');
}
// Ask first and Allow all send NO read tool in allowedTools: every read reaches canUseTool (roots check)
for (const m of ['ask', 'allow'] as PermissionMode[]) assert.ok(!(claudeOptionsFor(m).allowedTools ?? []).length, `${m}: no tool pre-approved in allowedTools`);
// no user/project settings in any mode (their allow rules would approve tools before canUseTool)
for (const m of ['read-only', 'ask', 'allow', 'bogus'] as PermissionMode[]) assert.deepStrictEqual(claudeOptionsFor(m).settingSources, [], `${String(m)}: settingSources is []`);
// MCP servers only from Durbar's own mcpServers option, in every mode (spec 012 Q8)
for (const m of ['read-only', 'ask', 'allow', 'bogus'] as PermissionMode[]) assert.strictEqual(claudeOptionsFor(m).strictMcpConfig, true, `${String(m)}: strictMcpConfig is true`);

const posixPC = { flavor: path.posix, realpath: (p: string) => p, caseInsensitive: false };
const PC = posixPC;
const R = ['/w/p'];
// mode -> options (plan table)
const ro = claudeOptionsFor('read-only');
assert.strictEqual(ro.permissionMode, 'dontAsk', 'read-only uses dontAsk');
assert.deepStrictEqual(ro.allowedTools, ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']);
assert.strictEqual(ro.allowDangerouslySkipPermissions, undefined, 'read-only never skips permissions');
assert.strictEqual(ro.preToolUseHook, true, 'read-only installs the deny hook');
for (const t of ['Bash', 'BashOutput', 'KillBash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']) assert.ok(ro.disallowedTools?.includes(t), `read-only backstop disallows ${t}`);
const ask = claudeOptionsFor('ask');
assert.strictEqual(ask.permissionMode, 'default', 'ask uses default');
assert.strictEqual(ask.allowedTools, undefined);
assert.strictEqual(ask.canUseTool, true);
assert.strictEqual(ask.allowDangerouslySkipPermissions, undefined);
assert.strictEqual(ask.preToolUseHook, false);
const allow = claudeOptionsFor('allow');
assert.strictEqual(allow.permissionMode, 'bypassPermissions', 'allow uses bypassPermissions');
assert.strictEqual(allow.allowDangerouslySkipPermissions, true);
assert.strictEqual(allow.preToolUseHook, false);
for (const m of ['read-only', 'ask', 'allow'] as PermissionMode[]) {
  assert.ok(['dontAsk', 'default', 'bypassPermissions'].includes(claudeOptionsFor(m).permissionMode), 'never auto/acceptEdits/plan');
  assert.notStrictEqual(claudeOptionsFor(m), claudeOptionsFor(m), 'fresh object: callers cannot corrupt a shared one');
}
claudeOptionsFor('read-only').allowedTools!.push('Bash');
assert.deepStrictEqual(claudeOptionsFor('read-only').allowedTools, ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS'], 'mutating a result does not leak');

// unknown or missing mode: Read-only options, never fewer restrictions
for (const bad of ['bogus', undefined, null, '', 'READ-ONLY', '__proto__']) {
  const o = claudeOptionsFor(bad as never);
  assert.ok(o, `options for ${String(bad)}`);
  assert.strictEqual(o.permissionMode, 'dontAsk', `unknown mode ${String(bad)} falls back to dontAsk`);
  assert.strictEqual(o.preToolUseHook, true);
  assert.strictEqual(o.allowDangerouslySkipPermissions, undefined);
  assert.strictEqual(decideTool(bad as never, 'Bash').behavior, 'deny', `unknown mode ${String(bad)} denies Bash`);
  assert.ok(preToolUseDecision(bad as never, 'Bash'), `unknown mode ${String(bad)}: hook denies Bash`);
}
assert.strictEqual(preToolUseDecision('bogus' as never, 'Read', { file_path: '/w/p/a.ts' }, ['/w/p'], PC), undefined, 'unknown mode still lets reads inside the roots through');

// tool -> kind
for (const t of ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']) assert.strictEqual(toolKind(t), 'read', t);
for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) assert.strictEqual(toolKind(t), 'write', t);
for (const t of ['Bash', 'BashOutput', 'KillBash']) assert.strictEqual(toolKind(t), 'shell', t);
for (const t of ['WebFetch', 'WebSearch']) assert.strictEqual(toolKind(t), 'url', t);
assert.strictEqual(toolKind('mcp__github__create_issue'), 'mcp');
assert.deepStrictEqual(parseMcpTool('mcp__github__create_issue'), { server: 'github', tool: 'create_issue' });
assert.strictEqual(parseMcpTool('Read'), undefined);
for (const t of ['Agent', 'Task', 'AskUserQuestion', 'TodoWrite', 'SomethingNew', '', 'read', 'BASH', ' Read', 'mcp__', 'mcp__server', 'mcp__a__']) assert.strictEqual(toolKind(t), 'custom-tool', `unknown "${t}" is custom-tool`);
for (const t of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
  assert.strictEqual(toolKind(t), 'custom-tool', `${t} gets no special treatment`);
  assert.strictEqual(isReadTool(t), false);
  assert.strictEqual(decideTool('read-only', t).behavior, 'deny', `${t} denied in read-only`);
  assert.strictEqual(decideTool('ask', t).behavior, 'ask');
}
assert.strictEqual(isReadTool('SomethingNew'), false, 'unknown tool is non-read');

// Read-only PreToolUse decision
const inside: Record<string, Record<string, unknown>> = { Read: { file_path: '/w/p/a.ts' }, Glob: { pattern: '**/*.ts', path: '/w/p/src' }, Grep: { pattern: 'x', path: '/w/p' }, NotebookRead: { notebook_path: '/w/p/n.ipynb' }, LS: { path: '/w/p' } };
for (const t of Object.keys(inside)) {
  assert.strictEqual(preToolUseDecision('read-only', t, inside[t], R, PC), undefined, `${t} inside the roots not denied in read-only`);
  assert.strictEqual(decideTool('read-only', t, inside[t], R, PC).behavior, 'allow');
  assert.strictEqual(decideTool('ask', t, inside[t], R, PC).behavior, 'allow');
}
for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'BashOutput', 'KillBash', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'SomethingNew', 'mcp__github__list_issues', 'mcp__fs__read_file', '__proto__']) {
  const d = preToolUseDecision('read-only', t);
  assert.ok(d, `${t} denied in read-only`);
  assert.strictEqual(d!.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(d!.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(d!.hookSpecificOutput.permissionDecisionReason.includes(t), `reason names ${t}`);
  assert.deepStrictEqual(decideTool('read-only', t).behavior, 'deny');
}
// other modes: the hook has no opinion
for (const m of ['ask', 'allow'] as PermissionMode[]) for (const t of ['Bash', 'Write', 'SomethingNew']) assert.strictEqual(preToolUseDecision(m, t), undefined, `${m}: no hook opinion on ${t}`);

// Ask / Allow behaviour (canUseTool)
for (const t of ['Write', 'Edit', 'Bash', 'WebFetch', 'mcp__s__t', 'SomethingNew', 'Task']) assert.strictEqual(decideTool('ask', t).behavior, 'ask', `ask: ${t} asks`);
for (const t of ['Read', 'Write', 'Bash', 'WebFetch', 'mcp__s__t', 'SomethingNew', 'Task']) assert.strictEqual(decideTool('allow', t).behavior, 'allow', `allow: ${t} approved`);
assert.strictEqual(decideTool('allow', 'AskUserQuestion').behavior, 'ask', 'allow still needs the user for AskUserQuestion');
assert.strictEqual(decideTool('read-only', 'AskUserQuestion').behavior, 'deny');
// only allow auto-approves anything non-read
for (const m of ['read-only', 'ask'] as PermissionMode[]) assert.notStrictEqual(decideTool(m, 'Bash').behavior, 'allow');

console.log('claude modes: ok');

// reads and the session roots (same rule as the broker's readIsOutside; no roots counts as outside)
const outsideInput: Record<string, Record<string, unknown>> = { Read: { file_path: '/home/u/.ssh/id_rsa' }, Glob: { pattern: '*', path: '/etc' }, Grep: { pattern: 'x', path: '/home/u' }, NotebookRead: { notebook_path: '/home/u/n.ipynb' }, LS: { path: '/' } };
for (const t of Object.keys(outsideInput)) {
  const ro1 = decideTool('read-only', t, outsideInput[t], R, PC);
  assert.strictEqual(ro1.behavior, 'deny', `read-only: ${t} outside the roots is denied`);
  assert.ok(ro1.behavior === 'deny' && ro1.reason.includes(t), 'deny has a reason');
  assert.ok(preToolUseDecision('read-only', t, outsideInput[t], R, PC), `hook denies ${t} outside the roots`);
  assert.strictEqual(decideTool('ask', t, outsideInput[t], R, PC).behavior, 'ask', `ask: ${t} outside the roots asks`);
  assert.strictEqual(decideTool('allow', t, outsideInput[t], R, PC).behavior, 'allow', 'allow: not roots-limited');
  assert.strictEqual(preToolUseDecision('ask', t, outsideInput[t], R, PC), undefined);
}
assert.strictEqual(decideTool('read-only', 'Read', { file_path: '/w/p/a.ts' }).behavior, 'deny', 'no roots given: outside');
assert.strictEqual(decideTool('ask', 'Read', { file_path: '/w/p/a.ts' }, [], PC).behavior, 'ask', 'empty roots: outside');
assert.strictEqual(decideTool('read-only', 'Read', undefined, R, PC).behavior, 'deny', 'Read without a path is denied');
assert.strictEqual(decideTool('read-only', 'Read', { file_path: 42 }, R, PC).behavior, 'deny', 'non-string path is denied');
assert.strictEqual(decideTool('read-only', 'Read', { file_path: '' }, R, PC).behavior, 'deny', 'empty path is denied');
assert.strictEqual(decideTool('read-only', 'Read', { file_path: '/w/p/../q/x' }, R, PC).behavior, 'deny', '.. collapsed');
assert.strictEqual(decideTool('read-only', 'Read', { file_path: '/w/p2/x' }, R, PC).behavior, 'deny', 'sibling with the same prefix');
assert.strictEqual(decideTool('read-only', 'Read', { file_path: 'src/a.ts' }, R, PC).behavior, 'allow', 'relative resolves against the first root');
// Grep/Glob/LS without a path work on the session folder
assert.strictEqual(decideTool('read-only', 'Grep', { pattern: 'x' }, R, PC).behavior, 'allow', 'Grep with no path is the root');
assert.strictEqual(decideTool('read-only', 'LS', {}, R, PC).behavior, 'allow');
assert.strictEqual(decideTool('read-only', 'Grep', { pattern: 'x' }, [], PC).behavior, 'deny', 'Grep with no path and no roots is outside');
// a Glob pattern cannot escape the roots
for (const pattern of ['/etc/*', '../*', 'a/../../b', 'C:\\Users\\*', '\\\\srv\\x']) assert.strictEqual(decideTool('read-only', 'Glob', { pattern }, R, PC).behavior, 'deny', `Glob pattern ${pattern} escapes`);
assert.strictEqual(decideTool('read-only', 'Glob', { pattern: 'src/**/*.ts' }, R, PC).behavior, 'allow');
// Windows and POSIX paths
const winPC = { flavor: path.win32, realpath: (p: string) => p, caseInsensitive: true };
const WR = ['C:\\w\\proj'];
assert.ok(readIsInsideRoots('Read', { file_path: 'C:\\w\\proj\\src\\a.ts' }, WR, winPC), 'win32 inside');
assert.ok(readIsInsideRoots('Read', { file_path: 'c:\\W\\PROJ\\a.ts' }, WR, winPC), 'win32 case-insensitive');
assert.ok(readIsInsideRoots('Grep', { pattern: 'x' }, WR, winPC), 'win32 Grep without path');
assert.ok(!readIsInsideRoots('Read', { file_path: 'C:\\Users\\u\\.ssh\\id_rsa' }, WR, winPC), 'win32 outside');
assert.ok(!readIsInsideRoots('Read', { file_path: 'C:\\w\\proj\\..\\x' }, WR, winPC), 'win32 ..');
assert.ok(!readIsInsideRoots('Read', { file_path: 'D:\\w\\proj\\a.ts' }, WR, winPC), 'win32 other drive');
assert.strictEqual(decideTool('read-only', 'Read', { file_path: 'C:\\Users\\u\\x' }, WR, winPC).behavior, 'deny');
assert.ok(readIsInsideRoots('Read', { file_path: '/w/p/a.ts' }, R, posixPC), 'posix inside');
assert.ok(!readIsInsideRoots('Read', { file_path: '/w/P/a.ts' }, R, posixPC), 'posix is case-sensitive');
console.log('claude modes: roots ok');
