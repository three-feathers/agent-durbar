/** Claude permission modes (spec 012 T021): mode -> SDK options, tool name -> kind, Read-only PreToolUse decision. `npm run test:runtime`. No credits spent. */
import * as assert from 'assert';
import { claudeOptionsFor, decideTool, isReadTool, parseMcpTool, preToolUseDecision, toolKind } from '../src/adapters/claudeModes';
import type { PermissionMode } from '../src/adapters/capabilities';

// allowedTools equals the tools whose kind is read (SDK mode and hook cannot drift apart)
for (const m of ['read-only', 'ask'] as PermissionMode[]) {
  const listed = [...(claudeOptionsFor(m).allowedTools ?? [])].sort();
  for (const t of listed) assert.strictEqual(toolKind(t), 'read', `${m}: allowedTools ${t} is a read tool`);
  for (const t of ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']) assert.ok(listed.includes(t), `${m}: allowedTools includes ${t}`);
  assert.strictEqual(listed.length, 5, `${m}: allowedTools is exactly the read set`);
}

// mode -> options (plan table)
const ro = claudeOptionsFor('read-only');
assert.strictEqual(ro.permissionMode, 'dontAsk', 'read-only uses dontAsk');
assert.deepStrictEqual(ro.allowedTools, ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']);
assert.strictEqual(ro.allowDangerouslySkipPermissions, undefined, 'read-only never skips permissions');
assert.strictEqual(ro.preToolUseHook, true, 'read-only installs the deny hook');
for (const t of ['Bash', 'BashOutput', 'KillBash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']) assert.ok(ro.disallowedTools?.includes(t), `read-only backstop disallows ${t}`);
const ask = claudeOptionsFor('ask');
assert.strictEqual(ask.permissionMode, 'default', 'ask uses default');
assert.deepStrictEqual(ask.allowedTools, ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']);
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
assert.strictEqual(preToolUseDecision('bogus' as never, 'Read'), undefined, 'unknown mode still lets reads through');

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
for (const t of ['Read', 'Glob', 'Grep', 'NotebookRead', 'LS']) assert.strictEqual(preToolUseDecision('read-only', t), undefined, `${t} not denied in read-only`);
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
for (const t of ['Read', 'Glob', 'Grep']) assert.strictEqual(decideTool('ask', t).behavior, 'allow', `ask: ${t} is a read`);
for (const t of ['Write', 'Edit', 'Bash', 'WebFetch', 'mcp__s__t', 'SomethingNew', 'Task']) assert.strictEqual(decideTool('ask', t).behavior, 'ask', `ask: ${t} asks`);
for (const t of ['Read', 'Write', 'Bash', 'WebFetch', 'mcp__s__t', 'SomethingNew', 'Task']) assert.strictEqual(decideTool('allow', t).behavior, 'allow', `allow: ${t} approved`);
assert.strictEqual(decideTool('allow', 'AskUserQuestion').behavior, 'ask', 'allow still needs the user for AskUserQuestion');
assert.strictEqual(decideTool('read-only', 'AskUserQuestion').behavior, 'deny');
// only allow auto-approves anything non-read
for (const m of ['read-only', 'ask'] as PermissionMode[]) assert.notStrictEqual(decideTool(m, 'Bash').behavior, 'allow');

console.log('claude modes: ok');
