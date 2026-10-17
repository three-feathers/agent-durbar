/** Unit test for the permission broker (no Copilot session, no AI credits): `npm run test:permissions`. */
import * as assert from 'assert';
import * as path from 'path';
import { PermissionBroker, grantScope, isInsideRoots } from '../src/adapters/permissions';
import type { BrokerEvent } from '../src/adapters/permissions';

async function main(): Promise<void> {
  // scopes
  assert.deepStrictEqual(grantScope({ kind: 'write', fileName: '/a/b/src/x.ts' }).key, 'write:/a/b/src');
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'npm test' }).key, 'shell-exact:npm test', 'shell grants are exact by default (spec 003 FR-022)');
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'npm test' }).broad?.key, 'shell:npm', 'any-arguments is offered for simple commands');
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'npm test && rm -rf /' }).key, 'shell-exact:npm test && rm -rf /');
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'cat a | sh' }).key.startsWith('shell-exact:'), true);
  for (const c of ['npm test && rm -rf /', 'cat a | sh', 'ls > out', 'echo $(id)', 'ls; id', 'ls `id`', 'ls\nid', 'FOO=1 git status', './run.sh', '/bin/ls', 'bash -c ls', 'python3 x.py', 'sudo ls', 'node a.js', 'env FOO=1 ls', 'find . -exec rm {} +', 'PowerShell.exe -c x', 'cmd /c dir'])
    assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: c }).broad, undefined, `no any-arguments scope for: ${c}`);
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'git push origin main' }).broad?.key, 'shell:git');
  assert.strictEqual(grantScope({ kind: 'url', url: 'https://example.com/x?y=1' }).key, 'url:example.com');
  assert.strictEqual(grantScope({ kind: 'mcp', toolName: 'search' }).key, 'mcp:search');
  assert.strictEqual(grantScope({ kind: 'mcp', serverName: 'github', toolName: 'search' }).key, 'mcp:github/search', 'MCP grants are scoped to the server');
  assert.notStrictEqual(grantScope({ kind: 'mcp', serverName: 'a', toolName: 'search' }).key, grantScope({ kind: 'mcp', serverName: 'b', toolName: 'search' }).key);

  const mk = (opts: { ask?: boolean; allow?: boolean }) => {
    const ev: BrokerEvent[] = [];
    return { ev, b: new PermissionBroker({ ...opts, emit: (e) => ev.push(e) }) };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // read is always approved, read-only denies writes
  let t = mk({});
  assert.strictEqual((await t.b.request({ kind: 'read', path: '/x' })).kind, 'approve-once');
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/x/y.ts', toolCallId: 'w1' })).kind, 'reject');
  assert.strictEqual(t.ev[0].type, 'denied-policy');

  // ask: pending -> approve once (no grant) -> asks again
  t = mk({ ask: true });
  let p = t.b.request({ kind: 'write', fileName: '/x/y.ts', toolCallId: 'w1' });
  await tick();
  assert.strictEqual(t.ev[0].type, 'pending');
  assert.strictEqual(t.b.resolve('w1', true), true);
  assert.strictEqual((await p).kind, 'approve-once');
  assert.strictEqual(t.b.listGrants().length, 0);
  p = t.b.request({ kind: 'write', fileName: '/x/y.ts', toolCallId: 'w2' });
  await tick();
  assert.strictEqual(t.ev.filter((e) => e.type === 'pending').length, 2);

  // approve for this session: remembered, same folder auto-approved, other folder asks, revoke asks again
  t.b.resolve('w2', true, true);
  await p;
  assert.strictEqual(t.b.listGrants().length, 1);
  const before = t.ev.length;
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/x/z.ts', toolCallId: 'w3' })).kind, 'approve-once');
  const auto = t.ev.slice(before).find((e) => e.type === 'resolved');
  assert.ok(auto && auto.type === 'resolved' && auto.permission.via === 'session');
  p = t.b.request({ kind: 'write', fileName: '/other/z.ts', toolCallId: 'w4' });
  await tick();
  assert.strictEqual(t.b.resolve('w4', false), true);
  assert.strictEqual((await p).kind, 'reject');
  assert.strictEqual(t.b.revoke('write:/x'), true);
  p = t.b.request({ kind: 'write', fileName: '/x/z.ts', toolCallId: 'w5' });
  await tick();
  assert.strictEqual(t.ev[t.ev.length - 1].type, 'pending');
  t.b.resolve('w5', false);
  await p;

  // deny never remembers
  t.b.resolve('nope', true);
  p = t.b.request({ kind: 'shell', fullCommandText: 'ls -la', toolCallId: 's1' });
  await tick();
  t.b.resolve('s1', false, true);
  await p;
  assert.strictEqual(t.b.listGrants().length, 0);

  // stop with pending: denied cleanly, event says via stopped, grants cleared, later requests rejected
  t = mk({ ask: true });
  p = t.b.request({ kind: 'write', fileName: '/x/y.ts', toolCallId: 'w9' });
  const p2 = t.b.request({ kind: 'shell', fullCommandText: 'make', toolCallId: 's9' });
  await tick();
  t.b.stop();
  const [r1, r2] = await Promise.all([p, p2]);
  assert.strictEqual(r1.kind, 'reject');
  assert.strictEqual(r2.kind, 'reject');
  const stopped = t.ev.filter((e) => e.type === 'resolved' && e.permission.via === 'stopped');
  assert.strictEqual(stopped.length, 2);
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/x/q.ts', toolCallId: 'late' })).kind, 'reject');
  // Stop (interrupt a turn): pending requests are denied, but the session and its grants live on
  t = mk({ ask: true });
  const g = t.b.request({ kind: 'write', fileName: '/x/y.ts', toolCallId: 'i1' });
  await tick();
  t.b.resolve('i1', true, true);
  assert.strictEqual((await g).kind, 'approve-once');
  const pend = t.b.request({ kind: 'shell', fullCommandText: 'make', toolCallId: 'i2' });
  await tick();
  t.b.denyPending();
  assert.strictEqual((await pend).kind, 'reject');
  assert.strictEqual(t.b.listGrants().length, 1, 'grants survive an interrupt');
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/x/z.ts', toolCallId: 'i3' })).kind, 'approve-once', 'still usable after the interrupt (auto-approved by the grant)');

  // mode can change at any time (spec 018): applies to the next request, no restart
  t = mk({});
  assert.strictEqual(t.b.getMode(), 'read-only');
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/m/a.ts', toolCallId: 'm1' })).kind, 'reject');
  t.b.setMode('allow');
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/m/a.ts', toolCallId: 'm2' })).kind, 'approve-once', 'allow edits applies to the next request');
  t.b.setMode('ask');
  const askP = t.b.request({ kind: 'shell', fullCommandText: 'make', toolCallId: 'm3' });
  await tick();
  assert.strictEqual(t.b.pendingCount(), 1);
  t.b.setMode('allow'); // a pending request stays pending until the user chooses to approve it
  assert.strictEqual(t.b.pendingCount(), 1);
  assert.strictEqual(t.b.approvePending(), 1);
  assert.strictEqual((await askP).kind, 'approve-once');
  assert.strictEqual(t.b.listGrants().length, 0, 'approving pending ones from the switch remembers nothing');
  // grants: kept on switch unless cleared
  t.b.setMode('ask');
  const gp = t.b.request({ kind: 'write', fileName: '/m/g/a.ts', toolCallId: 'm4' });
  await tick();
  t.b.resolve('m4', true, true);
  await gp;
  assert.strictEqual(t.b.listGrants().length, 1);
  t.b.setMode('read-only');
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/m/g/b.ts', toolCallId: 'm5' })).kind, 'reject', 'read-only wins over an old grant');
  t.b.setMode('ask');
  assert.strictEqual((await t.b.request({ kind: 'write', fileName: '/m/g/c.ts', toolCallId: 'm6' })).kind, 'approve-once', 'grant kept');
  t.b.clearGrants();
  assert.strictEqual(t.b.listGrants().length, 0);
  assert.strictEqual(t.ev.filter((e) => e.type === 'grants').pop()?.type, 'grants');
  // switching to read-only can deny what is pending
  const dp = t.b.request({ kind: 'write', fileName: '/m/g/d.ts', toolCallId: 'm7' });
  await tick();
  t.b.setMode('read-only');
  assert.strictEqual(t.b.denyPendingByUser(), 1);
  assert.strictEqual((await dp).kind, 'reject');

  // shell grants (spec 003 FR-022): exact by default, "any arguments" only when picked, never for pipes
  t = mk({ ask: true });
  let sp = t.b.request({ kind: 'shell', fullCommandText: 'git status', toolCallId: 'sh1' });
  await tick();
  const pend0 = t.ev.find((e) => e.type === 'pending');
  assert.ok(pend0 && pend0.type === 'pending' && pend0.permission.broadScopeKey === 'shell:git' && pend0.permission.scopeKey === 'shell-exact:git status');
  t.b.resolve('sh1', true, true); // default: exact command
  await sp;
  assert.strictEqual(t.b.listGrants()[0].key, 'shell-exact:git status');
  assert.strictEqual((await t.b.request({ kind: 'shell', fullCommandText: 'git status', toolCallId: 'sh2' })).kind, 'approve-once', 'same command is auto-approved');
  sp = t.b.request({ kind: 'shell', fullCommandText: 'git push --force', toolCallId: 'sh3' });
  await tick();
  assert.strictEqual(t.b.pendingCount(), 1, 'other arguments ask again');
  t.b.resolve('sh3', true, true, true); // explicit: any arguments
  await sp;
  assert.ok(t.b.listGrants().some((g) => g.key === 'shell:git'));
  assert.strictEqual((await t.b.request({ kind: 'shell', fullCommandText: 'git log', toolCallId: 'sh4' })).kind, 'approve-once', 'any-arguments grant covers other git commands');
  sp = t.b.request({ kind: 'shell', fullCommandText: 'git log | sh', toolCallId: 'sh5' });
  await tick();
  assert.strictEqual(t.b.pendingCount(), 1, 'a pipe never matches the any-arguments grant');
  t.b.resolve('sh5', false);
  await sp;
  sp = t.b.request({ kind: 'shell', fullCommandText: 'bash -c ls', toolCallId: 'sh6' });
  await tick();
  t.b.resolve('sh6', true, true, true); // broad requested but not offered: falls back to exact
  await sp;
  assert.ok(!t.b.listGrants().some((g) => g.key === 'shell:bash'));

  // reads outside the roots (spec 003 FR-023)
  const root = path.resolve('/w/proj'), other = path.resolve('/w/proj2');
  const links: Record<string, string> = { [path.resolve('/w/proj/link')]: path.resolve('/etc') };
  const realpath = (x: string): string => {
    for (const [from, to] of Object.entries(links)) if (x === from || x.startsWith(from + path.sep)) return to + x.slice(from.length);
    if (x.startsWith(path.resolve('/w')) || x.startsWith(path.resolve('/etc')) || x.startsWith(path.resolve('/tmp'))) return x;
    throw new Error('ENOENT');
  };
  const pc = { realpath };
  assert.ok(isInsideRoots(path.join(root, 'a/b.ts'), [root], pc));
  assert.ok(isInsideRoots(root, [root], pc), 'the root itself');
  assert.ok(isInsideRoots('src/x.ts', [root], pc), 'relative paths resolve against the first root');
  assert.ok(isInsideRoots(path.join(root, 'new/dir/file.ts'), [root], pc), 'a not-yet-existing file inside');
  assert.ok(!isInsideRoots(other + '/a', [root], pc), 'a sibling with the same prefix is outside');
  assert.ok(!isInsideRoots(path.join(root, '..', 'secret'), [root], pc), '.. collapsed');
  assert.ok(!isInsideRoots(path.join(root, 'link', 'passwd'), [root], pc), 'a symlink pointing outside is outside');
  assert.ok(!isInsideRoots('/etc/passwd', [root], pc));
  assert.ok(!isInsideRoots('', [root], pc) && !isInsideRoots(undefined, [root], pc), 'no path counts as outside');
  assert.ok(isInsideRoots(path.join(other, 'x'), [root, other], pc), 'second workspace folder');
  assert.ok(isInsideRoots('C:\\Work\\Proj\\a.ts', ['c:\\work\\proj'], { flavor: path.win32, caseInsensitive: true, realpath: (x) => x }), 'Windows: case-insensitive');
  assert.ok(!isInsideRoots('D:\\Work\\Proj\\a.ts', ['C:\\Work\\Proj'], { flavor: path.win32, caseInsensitive: true, realpath: (x) => x }), 'Windows: other drive is outside');

  const mkRoots = (mode: 'read-only' | 'ask' | 'allow') => {
    const ev: BrokerEvent[] = [];
    return { ev, b: new PermissionBroker({ mode, roots: [root], pathCheck: pc, emit: (e) => ev.push(e) }) };
  };
  let r = mkRoots('read-only');
  assert.strictEqual((await r.b.request({ kind: 'read', path: path.join(root, 'a.ts'), toolCallId: 'r1' })).kind, 'approve-once');
  const denied = await r.b.request({ kind: 'read', path: '/etc/passwd', toolCallId: 'r2' });
  assert.strictEqual(denied.kind, 'reject');
  assert.ok(denied.kind === 'reject' && /outside the session's folders/.test(denied.feedback));
  assert.strictEqual(r.ev[0].type, 'denied-policy');
  r.b.allowReadPaths(['/tmp/attached.png']);
  assert.strictEqual((await r.b.request({ kind: 'read', path: '/tmp/attached.png', toolCallId: 'r3' })).kind, 'approve-once', 'attached files may be read');
  assert.strictEqual((await r.b.request({ kind: 'read', path: '/tmp/other.png', toolCallId: 'r4' })).kind, 'reject');
  r = mkRoots('ask');
  const rp = r.b.request({ kind: 'read', path: '/etc/hosts', toolCallId: 'r5' });
  await tick();
  assert.strictEqual(r.b.pendingCount(), 1, 'outside reads ask in Ask mode');
  r.b.resolve('r5', true, true);
  assert.strictEqual((await rp).kind, 'approve-once');
  assert.strictEqual((await r.b.request({ kind: 'read', path: '/etc/os-release', toolCallId: 'r6' })).kind, 'approve-once', 'folder grant covers siblings');
  assert.strictEqual((await r.b.request({ kind: 'read', path: path.join(root, 'ok.ts'), toolCallId: 'r7' })).kind, 'approve-once', 'inside reads never ask');
  r = mkRoots('allow');
  assert.strictEqual((await r.b.request({ kind: 'read', path: '/etc/passwd', toolCallId: 'r8' })).kind, 'approve-once', 'Allow all approves everything');
  console.log('permissions: all checks passed');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
