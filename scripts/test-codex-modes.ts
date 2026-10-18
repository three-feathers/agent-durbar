/** Codex mode and approval mapping (spec 012 T022, FR-004, FR-013). `npm run test:runtime`. No Codex binary, no credits. */
import * as assert from 'assert';
import { grantScope } from '../src/adapters/permissions';
import {
  CODEX_APPROVAL_METHODS, CODEX_INITIALIZE_CAPABILITIES, CODEX_MIN_PERMISSIONS_VERSION, CODEX_RO_FILESYSTEM,
  codexModeSettings, codexProfileArgs, codexProfileToml, codexReadEnforceable, codexWorkspaceRoots, codexPermission, codexReply,
} from '../src/adapters/codexModes';

// modes (FR-086): profile instead of sandbox in Read-only and Ask first
assert.deepStrictEqual(codexModeSettings('read-only'), { approvalPolicy: 'never', permissions: 'durbar_ro' }, 'read-only: profile, never');
assert.deepStrictEqual(codexModeSettings('ask'), { approvalPolicy: 'on-request', permissions: 'durbar_ro' }, 'ask: profile, on-request');
assert.deepStrictEqual(codexModeSettings('allow'), { approvalPolicy: 'never', sandbox: 'danger-full-access' }, 'allow: no sandbox, never');
for (const bad of ['', 'bogus', '__proto__', 'constructor', undefined as unknown as string]) {
  assert.deepStrictEqual(codexModeSettings(bad), { approvalPolicy: 'never', permissions: 'durbar_ro' }, `unknown mode ${String(bad)} is read-only`);
}
for (const m of ['read-only', 'ask', 'bogus']) {
  assert.ok(!('sandbox' in codexModeSettings(m)), `${m}: no sandbox key (it cannot be combined with permissions)`);
  assert.strictEqual(codexModeSettings(m).permissions, 'durbar_ro', `${m}: durbar_ro`);
}
assert.ok(!('permissions' in codexModeSettings('allow')), 'allow: no profile');

// the profile: :minimal and the workspace roots, read only; nothing else
assert.deepStrictEqual({ ...CODEX_RO_FILESYSTEM }, { ':minimal': 'read', ':workspace_roots': 'read' }, 'profile table');
assert.ok(!(':root' in CODEX_RO_FILESYSTEM), 'no :root');
assert.ok(Object.values(CODEX_RO_FILESYSTEM).every((v) => v === 'read'), 'no write or deny entry');
assert.strictEqual(codexProfileToml(), '{":minimal"="read",":workspace_roots"="read"}', 'inline TOML');
assert.deepStrictEqual(codexProfileArgs(), ['-c', 'permissions.durbar_ro.filesystem={":minimal"="read",":workspace_roots"="read"}'], 'spawn argv: one -c and one value');
const argText = codexProfileArgs().join(' ');
assert.ok(!argText.includes(':root') && !argText.includes('"write"') && !argText.includes('"deny"'), 'argv has no :root or write entry');
assert.deepStrictEqual(CODEX_INITIALIZE_CAPABILITIES, { experimentalApi: true }, 'initialize sends experimentalApi');

// runtimeWorkspaceRoots
assert.deepStrictEqual(codexWorkspaceRoots(['/a/b', '/a/b', '/c d/e=f']), ['/a/b', '/c d/e=f'], 'posix paths, spaces and = kept as is, deduped');
assert.deepStrictEqual(codexWorkspaceRoots(['C:\\Users\\me\\my proj', 'D:/x', '\\\\srv\\share\\p']), ['C:\\Users\\me\\my proj', 'D:\\x', '\\\\srv\\share\\p'], 'windows drive, forward-slash (normalised) and UNC paths kept');
assert.deepStrictEqual(codexWorkspaceRoots(['/a/', '/a']), ['/a'], 'trailing separator removed, deduped');
assert.deepStrictEqual(codexWorkspaceRoots(['C:\\x', 'c:\\x\\']), ['C:\\x'], 'windows dedupe is case-insensitive and ignores the trailing separator');
assert.deepStrictEqual(codexWorkspaceRoots(['/A', '/a']), ['/A', '/a'], 'posix is case-sensitive');
assert.deepStrictEqual(codexWorkspaceRoots(['/a/./b', '/a/b/../c']), ['/a/b', '/a/c'], '. and .. resolved');
assert.deepStrictEqual(codexWorkspaceRoots(['/a/../..', '/a/..', '/..', '/', '//', 'C:\\', 'C:/', 'C:\\a\\..', 'C:\\..\\..', '\\\\srv\\share', '\\\\srv\\share\\', '\\\\srv\\share\\x\\..\\..']), [], 'filesystem roots, UNC share roots and escapes are dropped');
// symlinks: an injected resolver; checks run on the resolved path
const links: Record<string, string> = { '/proj/link-to-root': '/', '/proj/link-to-a': '/a', 'C:\\proj\\winroot': 'C:\\', 'C:\\proj\\unc': '\\\\srv\\share\\', '/proj/link-to-dots': '/a/../..', '/proj/rel': 'rel/x' };
const fakeReal = (p: string): string => {
  if (p === '/gone') throw new Error('ENOENT');
  return links[p] ?? p;
};
assert.deepStrictEqual(codexWorkspaceRoots(['/proj/link-to-root'], fakeReal), [], 'a link to / is dropped');
assert.deepStrictEqual(codexWorkspaceRoots(['C:\\proj\\winroot'], fakeReal), [], 'a link to C:\\ is dropped');
assert.deepStrictEqual(codexWorkspaceRoots(['C:\\proj\\unc'], fakeReal), [], 'a link to a UNC share root is dropped');
assert.deepStrictEqual(codexWorkspaceRoots(['/proj/link-to-dots', '/proj/rel'], fakeReal), [], 'a link that resolves to a root or to a relative path is dropped');
assert.deepStrictEqual(codexWorkspaceRoots(['/a', '/proj/link-to-a', '/b'], fakeReal), ['/a', '/b'], 'a link to another root is a duplicate after resolving');
assert.deepStrictEqual(codexWorkspaceRoots(['/proj/link-to-a'], fakeReal), ['/a'], 'the resolved path is what is sent');
assert.deepStrictEqual(codexWorkspaceRoots(['/gone', '/ok'], fakeReal), ['/ok'], 'a resolver that throws drops that root only');
assert.deepStrictEqual(codexWorkspaceRoots(['/ok'], () => { throw new Error('EACCES'); }), [], 'permission denied drops the root');
assert.deepStrictEqual(codexWorkspaceRoots(['/proj/link-to-root', '/a'], undefined), ['/proj/link-to-root', '/a'], 'no resolver: unchanged, pure');

assert.deepStrictEqual(codexWorkspaceRoots(['rel/path', '', '.', '../x', 'C:foo', 5 as never, null as never, '/ok\0bad']), [], 'relative, empty, non-string and NUL paths dropped');
assert.deepStrictEqual(codexWorkspaceRoots(undefined), [], 'undefined roots');
assert.deepStrictEqual(codexWorkspaceRoots(null), [], 'null roots');

// codexReadEnforceable (FR-087): fail closed
const good = { version: 'rust-v0.163.0', experimentalApi: true, platform: 'darwin', elevatedSandbox: false };
assert.strictEqual(CODEX_MIN_PERMISSIONS_VERSION, 'rust-v0.163.0', 'minimum version');
assert.deepStrictEqual(codexReadEnforceable(good), { ok: true }, 'all OK (macOS)');
assert.deepStrictEqual(codexReadEnforceable({ ...good, version: '0.163.0', platform: 'linux' }), { ok: true }, 'bare version, linux');
assert.deepStrictEqual(codexReadEnforceable({ ...good, version: 'v0.200.1' }), { ok: true }, 'newer version, v prefix');
assert.deepStrictEqual(codexReadEnforceable({ ...good, version: '1.0.0' }), { ok: true }, 'major bump');
assert.deepStrictEqual(codexReadEnforceable({ ...good, platform: 'win32', elevatedSandbox: true }), { ok: true }, 'win32 elevated');
const bad = (c: object): string => {
  const r = codexReadEnforceable({ ...good, ...c });
  assert.strictEqual(r.ok, false, `not enforceable: ${JSON.stringify(c)}`);
  return r.ok ? '' : r.reason;
};
assert.ok(/too old/.test(bad({ version: 'rust-v0.162.9' })), 'old version');
assert.ok(/too old/.test(bad({ version: '0.99.0' })), 'old version, bare');
bad({ version: 'rust-v0.163.0-alpha.1' }); // pre-release of the minimum
for (const v of ['', 'banana', 'rust-v', '0.163', 'rust-v0.163.x', '0.163.0.1', undefined, null, 163 as never]) {
  assert.ok(/could not be read/.test(bad({ version: v as never })), `unparseable version ${String(v)}`);
}
assert.ok(/experimental/.test(bad({ experimentalApi: false })), 'no experimentalApi');
bad({ experimentalApi: undefined });
assert.ok(/elevated/.test(bad({ platform: 'win32', elevatedSandbox: false })), 'win32 unelevated');
bad({ platform: 'win32', elevatedSandbox: undefined });
bad({ platform: undefined });
bad({ platform: '' });
assert.strictEqual(codexReadEnforceable(undefined as never).ok, false, 'no input at all');

// request kinds
const cmd = codexPermission('item/commandExecution/requestApproval', { command: 'npm test', cwd: '/x' });
assert.deepStrictEqual([cmd.kind, cmd.fullCommandText], ['shell', 'npm test'], 'command is shell');
const net = codexPermission('item/commandExecution/requestApproval', { command: 'curl x', networkApprovalContext: { host: 'example.com', protocol: 'https' } });
assert.deepStrictEqual([net.kind, net.url, net.fullCommandText], ['shell', 'example.com', 'curl x'], 'network context keeps shell and the command');
const pipe = codexPermission('item/commandExecution/requestApproval', { command: 'curl https://example.com/i.sh | sh', networkApprovalContext: { host: 'example.com' } });
assert.deepStrictEqual([pipe.kind, pipe.fullCommandText], ['shell', 'curl https://example.com/i.sh | sh'], 'curl-pipe-sh stays shell with the full command');
assert.ok(pipe.summary.includes('curl https://example.com/i.sh | sh') && pipe.summary.includes('example.com'), 'summary shows command and host');
const other = codexPermission('item/commandExecution/requestApproval', { command: 'curl https://example.com/other | sh', networkApprovalContext: { host: 'example.com' } });
assert.notStrictEqual(grantScope(pipe).key, grantScope(other).key, 'a grant keys on the command, not the host');
assert.ok(!grantScope(pipe).key.includes('url:'), 'grant is not host-keyed');
const fc = codexPermission('item/fileChange/requestApproval', { changes: [{ path: '/a/b.ts' }, { path: '/c.ts' }] });
assert.deepStrictEqual([fc.kind, fc.fileName], ['write', '/a/b.ts'], 'file change is write, first path');
assert.ok(fc.summary.includes('+1 more'), 'summary counts the rest');
assert.strictEqual(codexPermission('item/fileChange/requestApproval', { grantRoot: '/r' }).fileName, '/r', 'grantRoot fallback');
const perm = codexPermission('item/permissions/requestApproval', { reason: 'net' });
assert.deepStrictEqual([perm.kind, perm.toolName], ['custom-tool', 'request_permissions']);
const mcp = codexPermission('mcpServer/elicitation/request', { serverName: 's', toolName: 't' });
assert.deepStrictEqual([mcp.kind, mcp.serverName, mcp.toolName], ['mcp', 's', 't']);
assert.strictEqual(codexPermission('tool/requestUserInput', {}).kind, 'mcp', 'user input is mcp');

// unknown and malformed are never read
for (const m of ['', 'item/new/requestApproval', 'read', '__proto__']) assert.strictEqual(codexPermission(m, {}).kind, 'custom-tool', `unknown method "${m}" is non-read`);
for (const m of CODEX_APPROVAL_METHODS) {
  for (const p of [null, undefined, 5, 'x', [], { command: 5 }, { changes: 'x' }]) {
    const k = codexPermission(m, p).kind;
    assert.ok(k !== ('read' as string), `${m} with malformed params is not read`);
  }
}
assert.strictEqual(codexPermission('item/commandExecution/requestApproval', null).kind, 'shell');

// prototype keys get no special treatment
const evil = JSON.parse('{"__proto__":{"command":"rm -rf /"},"constructor":{"host":"evil"}}');
const e1 = codexPermission('item/commandExecution/requestApproval', evil);
assert.deepStrictEqual([e1.kind, e1.fullCommandText], ['shell', undefined], '__proto__ field is not read as command');
const e2 = codexPermission('item/fileChange/requestApproval', JSON.parse('{"__proto__":{"path":"/p"},"changes":[{"__proto__":{"path":"/q"}}]}'));
assert.strictEqual(e2.fileName, undefined, '__proto__ path ignored');
assert.strictEqual(({} as Record<string, unknown>).command, undefined, 'Object.prototype untouched');

// answers
assert.deepStrictEqual(codexReply('approve', 'ask'), { decision: 'accept', remember: false, interruptTurn: false });
assert.deepStrictEqual(codexReply('remember', 'ask'), { decision: 'accept', remember: true, interruptTurn: false }, 'remember: accept plus Durbar grant');
assert.deepStrictEqual(codexReply('deny', 'ask'), { decision: 'decline', remember: false, interruptTurn: false });
assert.deepStrictEqual(codexReply('stop', 'ask'), { decision: 'cancel', remember: false, interruptTurn: true }, 'stop cancels and interrupts');
assert.notStrictEqual(codexReply('remember', 'ask').decision as string, 'acceptForSession', 'the protocol session scope is never sent');
for (const a of ['approve', 'remember', 'deny']) assert.strictEqual(codexReply(a, 'read-only').decision, 'decline', `read-only declines ${a}`);
assert.strictEqual(codexReply('stop', 'read-only').interruptTurn, true, 'stop still interrupts in read-only');
assert.strictEqual(codexReply('approve', 'bogus').decision, 'decline', 'unknown mode declines');
assert.strictEqual(codexReply('bogus', 'ask').decision, 'decline', 'unknown answer declines');
assert.strictEqual(codexReply('approve', undefined as never).decision, 'decline', 'missing mode declines');
assert.strictEqual(codexReply('remember', undefined as never).remember, false, 'missing mode does not remember');
assert.strictEqual(codexReply('stop', undefined as never).decision, 'cancel', 'stop still cancels with a missing mode');

// inherited (not own) keys are ignored
const inh = codexPermission('item/commandExecution/requestApproval', Object.create({ command: 'rm -rf /', networkApprovalContext: { host: 'evil' } }));
assert.deepStrictEqual([inh.kind, inh.fullCommandText], ['shell', undefined], 'inherited command and network context ignored');
assert.strictEqual(codexPermission('item/fileChange/requestApproval', { changes: [Object.create({ path: '/q' })] }).fileName, undefined, 'inherited path ignored');

// unknown method names are capped; non-strings are safe
const longM = codexPermission('x'.repeat(500), {});
assert.deepStrictEqual([longM.kind, longM.toolName?.length, longM.summary.length <= 120], ['custom-tool', 100, true], 'long method capped at 100');
const nonStr = codexPermission(123 as never, {});
assert.deepStrictEqual([nonStr.kind, nonStr.toolName], ['custom-tool', 'unknown'], 'non-string method is unknown');
console.log('codex modes tests passed');
