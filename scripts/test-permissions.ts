/** Unit test for the permission broker (no Copilot session, no AI credits): `npm run test:permissions`. */
import * as assert from 'assert';
import * as path from 'path';
import { PermissionBroker, cleanGrantKey, grantScope, revokeGrantFor, isInsideRoots } from '../src/adapters/permissions';
import type { BrokerEvent } from '../src/adapters/permissions';
import { eventProblems } from '../src/adapters/eventguard';
import { ALLOWED_BY_KEYS_MAX } from '../src/adapters/types';
import { codexPermission } from '../src/adapters/codexModes';

async function main(): Promise<void> {
  // scopes
  assert.deepStrictEqual(grantScope({ kind: 'write', fileName: '/a/b/src/x.ts' }, path.posix).key, 'write:/a/b/src');
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
  assert.deepStrictEqual(t.ev.map((e) => e.type), ['denied-policy'], 'a read with no roots checked nothing, so it claims nothing (spec 003 FR-099); the write got a refusal');

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
  assert.strictEqual(t.b.revoke(t.b.listGrants()[0].key), true); // the key's spelling depends on the host path flavor
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
  // spec 052 FR-071: Allow all approves without a card, but says so once (via 'policy') for the local activity log; reads stay silent
  {
    const last = t.ev[t.ev.length - 1];
    assert.ok(last && last.type === 'auto' && last.permission.via === 'policy' && last.permission.state === 'approved' && last.permission.requestId === 'm2', 'allow emits one auto event');
    const n = t.ev.length;
    await t.b.request({ kind: 'read', path: '/m/a.ts' });
    const q = t.ev.slice(n);
    assert.ok(q.length === 1 && q[0].type === 'auto' && q[0].permission.via === 'quiet', 'a read in Allow all leaves one quiet note: no card, no log row (spec 003 FR-099)');
  }
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
  assert.deepStrictEqual(r.ev.map((e) => e.type), ['auto', 'denied-policy'], 'the folder read left a quiet note, the outside read a refusal');
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
  // spec 003 FR-031/FR-032: grant scopes with Windows paths (injectable flavor), on any host
  const w = path.win32;
  assert.deepStrictEqual(grantScope({ kind: 'write', fileName: 'C:\\repo\\src\\x.ts' }, w), { key: 'write:c:\\repo\\src', label: 'write in repo/src/' });
  assert.strictEqual(grantScope({ kind: 'read', path: 'D:\\data\\in.csv' }, w).key, 'read:d:\\data');
  assert.strictEqual(grantScope({ kind: 'write', fileName: 'C:\\x.ts' }, w).key, 'write:c:\\', 'a file at the drive root');
  assert.strictEqual(grantScope({ kind: 'write', fileName: '\\\\server\\share\\dir\\f.txt' }, w).key, 'write:\\\\server\\share\\dir', 'UNC path');
  assert.strictEqual(grantScope({ kind: 'write', fileName: 'C:\\repo\\src\\a.ts' }, w).key, grantScope({ kind: 'write', fileName: 'C:\\repo\\src\\b.ts' }, w).key, 'same folder, same key');
  assert.notStrictEqual(grantScope({ kind: 'write', fileName: 'C:\\repo\\src\\sub\\a.ts' }, w).key, grantScope({ kind: 'write', fileName: 'C:\\repo\\src\\b.ts' }, w).key, 'a subfolder is a different scope');
  assert.strictEqual(grantScope({ kind: 'write', fileName: '/a/b/src/x.ts' }, path.posix).key, 'write:/a/b/src');
  // documented limit (FR-032, T028): keys are exact, so case or separator differences make a different key; the broker asks again
  assert.strictEqual(grantScope({ kind: 'write', fileName: 'C:\\Repo\\src\\a.ts' }, w).key, grantScope({ kind: 'write', fileName: 'c:\\repo\\src\\a.ts' }, w).key, 'T028: case does not make another key on Windows');
  assert.strictEqual(grantScope({ kind: 'write', fileName: 'C:/repo/src/a.ts' }, w).key, grantScope({ kind: 'write', fileName: 'C:\\repo\\src\\a.ts' }, w).key, 'T028: / and \\ are the same folder on Windows');
  assert.strictEqual(grantScope({ kind: 'write', fileName: 'C:\\Repo\\Src\\a.ts' }, w).label, 'write in Repo/Src/', 'the label keeps the spelling');
  assert.notStrictEqual(grantScope({ kind: 'write', fileName: '/Repo/src/a.ts' }, path.posix).key, grantScope({ kind: 'write', fileName: '/repo/src/a.ts' }, path.posix).key, 'POSIX stays case-sensitive');
  {
    const ev: BrokerEvent[] = [];
    const b = new PermissionBroker({ ask: true, pathCheck: { flavor: w, caseInsensitive: true, realpath: (x) => x }, emit: (e) => ev.push(e) });
    const first = b.request({ kind: 'write', fileName: 'C:\\repo\\src\\a.ts', toolCallId: 'win1' });
    await tick();
    b.resolve('win1', true, true);
    await first;
    assert.deepStrictEqual(b.listGrants().map((g) => g.key), ['write:c:\\repo\\src'], 'the broker uses its path-check flavor for scopes (Windows keys in lower case)');
    assert.strictEqual((await b.request({ kind: 'write', fileName: 'C:\\repo\\src\\b.ts', toolCallId: 'win2' })).kind, 'approve-once', 'second file in the granted Windows folder');
    const other = b.request({ kind: 'write', fileName: 'C:\\repo\\docs\\c.md', toolCallId: 'win3' });
    await tick();
    assert.strictEqual(b.pendingCount(), 1, 'another Windows folder still asks');
    b.resolve('win3', false);
    await other;
    const cased = b.request({ kind: 'write', fileName: 'c:\\REPO\\SRC\\d.ts', toolCallId: 'win4' });
    await tick();
    assert.strictEqual((await cased).kind, 'approve-once', 'T028: the same Windows folder in another case is covered by the grant');
  }

  // spec 052 FR-172 (review on #470): a write that names several files is covered by a session grant only when every file's folder is
  // granted; a grant given on such a write names and grants each folder
  {
    const P = path.posix;
    const pc = { flavor: P, realpath: (x: string) => x };
    assert.strictEqual(grantScope({ kind: 'write', fileName: '/w/src/a.ts', paths: ['/w/src/a.ts', '/w/src/b.ts'] }, P).key, 'write:/w/src', 'one folder: the usual folder grant');
    const two = grantScope({ kind: 'write', fileName: '/w/src/a.ts', paths: ['/w/src/a.ts', '/w/docs/x.md'] }, P);
    assert.deepStrictEqual(two.folders?.map((f) => f.key), ['write:/w/src', 'write:/w/docs'], 'two folders: both are in the scope');
    assert.strictEqual(two.label, 'write in w/src/, w/docs/', 'the label names every folder');
    assert.ok(!two.key.startsWith('write:/'), 'the key is not the first folder\'s key');
    assert.strictEqual(grantScope({ kind: 'write', paths: ['/a/1', '/b/1', '/c/1', '/d/1', '/e/1'] }, P).label, 'write in a/, b/, c/ and 2 more folders', 'many folders: the label stays short');
    const ev: BrokerEvent[] = [];
    const b = new PermissionBroker({ mode: 'ask', pathCheck: pc, emit: (e) => ev.push(e) });
    const g1 = b.request({ kind: 'write', fileName: '/w/src/a.ts', paths: ['/w/src/a.ts'], toolCallId: 'm1' });
    await tick();
    b.resolve('m1', true, true);
    await g1;
    assert.deepStrictEqual(b.listGrants().map((g) => g.key), ['write:/w/src'], 'a grant on /w/src/');
    const mixed = b.request({ kind: 'write', fileName: '/w/src/b.ts', paths: ['/w/src/b.ts', '/home/u/.bashrc'], toolCallId: 'm2' });
    await tick();
    assert.strictEqual(b.pendingCount(), 1, 'a grant on /w/src/ does not approve [/w/src/b.ts, /home/u/.bashrc] automatically');
    assert.ok(!ev.some((e) => e.type === 'resolved' && e.permission.requestId === 'm2' && e.permission.via === 'session'), 'not resolved by the session grant');
    b.resolve('m2', true, true); // "for this session" on the two-folder write
    await mixed;
    assert.deepStrictEqual(b.listGrants().map((g) => g.key).sort(), ['write:/home/u', 'write:/w/src'], 'approving it for the session grants each named folder');
    assert.strictEqual((await b.request({ kind: 'write', fileName: '/home/u/.profile', paths: ['/w/src/c.ts', '/home/u/.profile'], toolCallId: 'm3' })).kind, 'approve-once', 'every folder granted: approved');
    const third = b.request({ kind: 'write', paths: ['/w/src/c.ts', '/home/u/x', '/etc/passwd'], toolCallId: 'm4' });
    await tick();
    assert.strictEqual(b.pendingCount(), 1, 'one folder not granted: it asks');
    b.resolve('m4', false);
    await third;
    // the same through the Codex mapping (the reviewer's probe): an item whose second file is outside the granted folder
    const b2 = new PermissionBroker({ mode: 'ask', pathCheck: pc, emit: () => undefined });
    const req = (id: string, files: string[]) => {
      const p = codexPermission('item/fileChange/requestApproval', { itemId: id }, files.map((f) => ({ path: f, kind: 'update' as const, diff: '' })));
      return b2.request({ kind: p.kind, fileName: p.fileName, paths: p.paths, toolCallId: id, cardSummary: p.summary });
    };
    const c1 = req('c1', ['/w/src/a.ts']);
    await tick();
    b2.resolve('c1', true, true);
    await c1;
    const c2 = req('c2', ['/w/src/b.ts', '/other/x']);
    await tick();
    assert.strictEqual(b2.pendingCount(), 1, 'Codex: a grant on /w/src/ does not approve [/w/src/b.ts, /other/x]');
    b2.denyPending();
    await c2;
  }

  // T026: requests without a toolCallId in the same millisecond get different ids
  {
    const b = new PermissionBroker({ roots: ['/w'], mode: 'ask', emit: () => undefined });
    const fixed = (): number => 1000;
    const p1 = b.request({ kind: 'write', fileName: '/w/a' }, fixed);
    const p2 = b.request({ kind: 'write', fileName: '/w/b' }, fixed);
    await tick();
    assert.strictEqual(b.pendingCount(), 2, 'two pending requests, not one overwriting the other');
    b.denyPending();
    await Promise.all([p1, p2]);
  }

  // spec 003 FR-099..FR-103 (issue #605): why a request ran without asking; undo through the existing revoke
  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const W = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'whyallowed.js')) as { KEYS_MAX: number; describe: (by: unknown, live: unknown, opts?: unknown) => null | { kind: string; pill: string; sentence: string; label?: string; undoKeys?: string[]; gone?: boolean } };
    const perm = (ev: BrokerEvent[], from = 0) => ev.slice(from).filter((e): e is Extract<BrokerEvent, { permission: unknown }> => 'permission' in e).map((e) => e.permission);

    // a session rule: the grant's key and label ride on the auto-approved request
    let w = mk({ ask: true });
    let p = w.b.request({ kind: 'write', fileName: '/x/a.ts', toolCallId: 'a1' });
    await tick();
    w.b.resolve('a1', true, true);
    await p;
    const userAnswer = perm(w.ev).find((x) => x.requestId === 'a1' && x.state === 'approved');
    assert.ok(userAnswer && userAnswer.via === 'user' && userAnswer.allowedBy === undefined, 'a request the user answered has no reason: Durbar asked');
    const mark = w.ev.length;
    await w.b.request({ kind: 'write', fileName: '/x/b.ts', toolCallId: 'a2' });
    const hit = perm(w.ev, mark).find((x) => x.requestId === 'a2');
    const g0 = w.b.listGrants()[0];
    assert.ok(hit && hit.via === 'session' && hit.allowedBy?.kind === 'session-grant', 'the session grant is the reason');
    assert.deepStrictEqual(hit.allowedBy, { kind: 'session-grant', key: g0.key, label: g0.label, keys: [g0.key] }, 'the matching grant, not another');
    assert.deepStrictEqual(eventProblems({ type: 'permission', sessionId: 's', timestamp: 1, permission: hit }), [], 'the event passes the guard');

    // the exact shell grant and the broad one name their own key
    w = mk({ ask: true });
    p = w.b.request({ kind: 'shell', fullCommandText: 'git status', toolCallId: 's1' });
    await tick();
    w.b.resolve('s1', true, true, true);
    await p;
    const m2 = w.ev.length;
    await w.b.request({ kind: 'shell', fullCommandText: 'git push', toolCallId: 's2' });
    const broad = perm(w.ev, m2).find((x) => x.requestId === 's2');
    assert.deepStrictEqual(broad?.allowedBy, { kind: 'session-grant', key: 'shell:git', label: w.b.listGrants()[0].label, keys: ['shell:git'] }, 'the broad rule is named');

    // after a revoke the same request asks and has no reason
    assert.strictEqual(w.b.revoke('shell:git'), true);
    const m4 = w.ev.length;
    const pend = w.b.request({ kind: 'shell', fullCommandText: 'git push', toolCallId: 's4' });
    await tick();
    assert.ok(perm(w.ev, m4).every((x) => x.allowedBy === undefined), 'a revoked rule gives no reason');
    w.b.resolve('s4', false);
    await pend;

    // Allow all: the mode is the reason (a logged 'policy' event for writes, a quiet one for reads); reads in Ask mode: the folder
    w = mk({ allow: true });
    await w.b.request({ kind: 'write', fileName: '/x/a.ts', toolCallId: 'm1' });
    await w.b.request({ kind: 'read', path: '/x/a.ts', toolCallId: 'm2' });
    const pm = perm(w.ev);
    assert.deepStrictEqual(pm.find((x) => x.requestId === 'm1'), { requestId: 'm1', kind: 'write', summary: pm[0].summary, state: 'approved', via: 'policy', allowedBy: { kind: 'allow-all' } });
    assert.strictEqual(pm.find((x) => x.requestId === 'm2')?.via, 'quiet', 'a read is not logged and has no card');
    assert.deepStrictEqual(pm.find((x) => x.requestId === 'm2')?.allowedBy, { kind: 'allow-all' });
const mkRoots2 = (m: { ask?: boolean; allow?: boolean }, roots?: string[]) => {
      const ev: BrokerEvent[] = [];
      return { ev, b: new PermissionBroker({ ...m, ...(roots ? { roots } : {}), pathCheck: { realpath: (x) => x }, emit: (e) => ev.push(e) }) };
    };
    const ro = mkRoots2({ ask: true }, ['/x']);
    await ro.b.request({ kind: 'read', path: '/x/a.ts', toolCallId: 'r1' });
    const rp = perm(ro.ev).find((x) => x.requestId === 'r1');
    assert.ok(rp && rp.via === 'quiet' && rp.allowedBy?.kind === 'in-folder' && rp.state === 'approved', 'a read the broker checked against the roots says so, quietly');
    // review of #729 item 2: a read nothing was checked for never claims "folder"
    for (const m of [{}, { ask: true }]) {
      const nr = mkRoots2(m, []);
      assert.strictEqual((await nr.b.request({ kind: 'read', path: '/etc/shadow', toolCallId: 'n1' })).kind, 'approve-once', 'no roots: reads are not path-checked (unchanged)');
      assert.ok(perm(nr.ev).every((x) => x.allowedBy === undefined), 'no roots: no reason is claimed');
      const un = mkRoots2(m);
      await un.b.request({ kind: 'read', path: '/etc/shadow', toolCallId: 'n2' });
      assert.ok(perm(un.ev).every((x) => x.allowedBy === undefined), 'roots unset: no reason is claimed');
    }
    const inAll = mkRoots2({ allow: true }, []);
    await inAll.b.request({ kind: 'read', path: '/etc/shadow', toolCallId: 'n3' });
    assert.deepStrictEqual(perm(inAll.ev)[0]?.allowedBy, { kind: 'allow-all' }, 'Allow all with empty roots says Allow all, not folder');
    const att = mkRoots2({ ask: true }, ['/x']);
    att.b.allowReadPaths(['/tmp/att.png']);
    await att.b.request({ kind: 'read', path: '/tmp/att.png', toolCallId: 'n4' });
    assert.deepStrictEqual(perm(att.ev).find((x) => x.requestId === 'n4')?.allowedBy, { kind: 'attachment' }, 'an attached file outside the folders is an attachment');
    await att.b.request({ kind: 'read', path: '/x/in.ts', toolCallId: 'n5' });
    assert.deepStrictEqual(perm(att.ev).find((x) => x.requestId === 'n5')?.allowedBy, { kind: 'in-folder' }, 'a path inside the roots stays folder');
    // a read outside the roots in Ask first is asked, never tagged
    const outside = mkRoots2({ ask: true }, ['/x']);
    const po = outside.b.request({ kind: 'read', path: '/etc/passwd', toolCallId: 'n6' });
    await tick();
    assert.ok(perm(outside.ev).every((x) => x.allowedBy === undefined) && outside.b.pendingCount() === 1);
    outside.b.resolve('n6', false);
    await po;
    // a denied request never claims a reason
    const rd = mk({});
    await rd.b.request({ kind: 'write', fileName: '/x/a.ts', toolCallId: 'd1' });
    assert.ok(rd.ev.every((e) => !('permission' in e) || e.permission.allowedBy === undefined), 'a refusal has no reason');
    // the activity log skips a quiet event, keeps an Allow all write
    const { decisionOf } = require('../src/shared/activity') as typeof import('../src/shared/activity');
    assert.strictEqual(decisionOf({ state: 'approved', via: 'quiet' }), undefined, 'a quiet read is not logged');
    assert.strictEqual(decisionOf({ state: 'approved', via: 'policy' }), 'auto-allow-all');

    // revoke: only a rule the broker holds, only a sane string (spec 003 FR-102)
    w = mk({ ask: true });
    p = w.b.request({ kind: 'write', fileName: '/x/a.ts', toolCallId: 'h1' });
    await tick();
    w.b.resolve('h1', true, true);
    await p;
    const keep = w.b.listGrants()[0].key;
    const evBefore = w.ev.length;
    for (const bad of [undefined, null, 0, 1, true, {}, [], [keep], { toString: () => keep }, '', '__proto__', 'constructor', 'toString', 'write:/y', keep + ' ', keep.toUpperCase() === keep ? keep + 'x' : keep.toUpperCase(), 'x'.repeat(600), keep + 'x'.repeat(600)] as unknown[])
      assert.strictEqual(w.b.revoke(bad as string), false, `a hostile id does not revoke: ${String(typeof bad === 'object' ? JSON.stringify(bad) : bad).slice(0, 30)}`);
    assert.strictEqual(w.b.listGrants().length, 1, 'the rule survived every hostile id');
    assert.strictEqual(w.ev.length, evBefore, 'a refused revoke emits nothing');
    assert.strictEqual(cleanGrantKey('x'.repeat(512)), 'x'.repeat(512));
    assert.strictEqual(cleanGrantKey('x'.repeat(513)), undefined);
    for (const bad of [undefined, null, 5, {}, [], '']) assert.strictEqual(cleanGrantKey(bad), undefined);
    // a revoke can only remove: it never adds a rule or changes the mode
    assert.strictEqual(w.b.getMode(), 'ask');
    assert.strictEqual(w.b.revoke(keep), true);
    assert.strictEqual(w.b.listGrants().length, 0);
    assert.strictEqual(w.b.revoke(keep), false, 'a second revoke of the same rule is a no-op');

    // review of #729 item 1: a write in several folders is allowed by every one of its rules, and all of them are named
    {
      const mf = mkRoots2({ ask: true });
      const req = (id: string, fs: string[]) => ({ kind: 'write', fileName: fs[0], paths: fs, toolCallId: id }) as never;
      const p1 = mf.b.request(req('f1', ['/w/a/x.ts', '/w/b/y.ts']));
      await tick();
      mf.b.resolve('f1', true, true);
      await p1;
      const gk = mf.b.listGrants().map((g) => g.key).sort();
      assert.strictEqual(gk.length, 2, 'one rule per folder');
      const m5 = mf.ev.length;
      await mf.b.request(req('f2', ['/w/a/x2.ts', '/w/b/y2.ts']));
      const ab = perm(mf.ev, m5).find((x) => x.requestId === 'f2')?.allowedBy;
      assert.ok(ab && ab.kind === 'session-grant', 'allowed by session rules');
      assert.deepStrictEqual([...(ab.keys ?? [])].sort(), gk, 'every folder rule is named');
      assert.ok(/w\/a.*w\/b|w\\a.*w\\b/.test(ab.label), `the label names both folders: ${ab.label}`);
      assert.deepStrictEqual(eventProblems({ type: 'permission', sessionId: 's', timestamp: 1, permission: perm(mf.ev, m5).find((x) => x.requestId === 'f2')! }), []);
      const dd2 = W.describe(ab, new Set(gk), { seen: gk });
      assert.deepStrictEqual([...(dd2?.undoKeys ?? [])].sort(), gk, 'Undo covers every rule');
      for (const k of dd2?.undoKeys ?? []) mf.b.revoke(k);
      const m6 = mf.ev.length;
      const p3 = mf.b.request(req('f3', ['/w/b/only.ts']));
      await tick();
      assert.strictEqual(mf.b.pendingCount(), 1, 'after Undo a write in the second folder asks too (no rule keeps approving silently)');
      assert.ok(perm(mf.ev, m6).every((x) => x.allowedBy === undefined));
      mf.b.resolve('f3', false);
      await p3;
    }

    // review of #729 (round 2) item 1: a write in more folders than the list holds: one limit end to end, the rest counted, nothing dropped quietly
    {
      assert.strictEqual(W.KEYS_MAX, ALLOWED_BY_KEYS_MAX, 'the window and the broker use the same limit');
      const mf = mkRoots2({ ask: true });
      const N = ALLOWED_BY_KEYS_MAX + 10;
      const files = Array.from({ length: N }, (_, i) => `/w/d${i}/x.ts`);
      const req = (id: string) => ({ kind: 'write', fileName: files[0], paths: files, toolCallId: id }) as never;
      const p1 = mf.b.request(req('g1'));
      await tick();
      mf.b.resolve('g1', true, true);
      await p1;
      assert.strictEqual(mf.b.listGrants().length, N, 'one rule per folder');
      const m7 = mf.ev.length;
      await mf.b.request(req('g2'));
      const ev2 = perm(mf.ev, m7).find((x) => x.requestId === 'g2')!;
      const ab = ev2.allowedBy;
      assert.ok(ab && ab.kind === 'session-grant' && ab.keys && ab.keys.length === ALLOWED_BY_KEYS_MAX && ab.more === 10, `capped list plus the count: ${JSON.stringify(ab && { n: ab.kind === 'session-grant' ? ab.keys?.length : 0, more: ab.kind === 'session-grant' ? ab.more : 0 })}`);
      assert.deepStrictEqual(eventProblems({ type: 'permission', sessionId: 's', timestamp: 1, permission: ev2 }), [], 'the guard accepts what the broker emits');
      const d = W.describe(ab, new Set(mf.b.listGrants().map((g) => g.key)), { seen: [] });
      assert.ok(d && d.undoKeys?.length === ALLOWED_BY_KEYS_MAX && /10 more rules/.test(d.sentence), 'the card says 10 more and Undo covers the listed ones');
      for (const k of d?.undoKeys ?? []) mf.b.revoke(k);
      assert.strictEqual(mf.b.listGrants().length, 10, 'Undo removed the listed rules; the other 10 are said to need Revoke all');
      assert.notStrictEqual(eventProblems({ type: 'permission', sessionId: 's', timestamp: 1, permission: { ...ev2, allowedBy: { kind: 'session-grant', key: 'k', label: 'l', keys: Array.from({ length: ALLOWED_BY_KEYS_MAX + 1 }, (_, i) => 'k' + i) } } }).length, 0, 'the guard refuses a list over the limit');
      assert.notStrictEqual(eventProblems({ type: 'permission', sessionId: 's', timestamp: 1, permission: { ...ev2, allowedBy: { kind: 'session-grant', key: 'k', label: 'l', more: 0 } } }).length, 0, 'and a bad count');
    }

    // review of #729 item 11: the revoke IPC's own check (main, pure part)
    {
      const calls: string[] = [];
      const has = (id: string) => id === 'agent-1';
      const rv = (id: string, k: string) => void calls.push(id + '|' + k);
      assert.strictEqual(revokeGrantFor(has, rv, 'agent-1', 'write:/x'), true);
      assert.deepStrictEqual(calls, ['agent-1|write:/x']);
      for (const [i, k] of [['nope', 'write:/x'], [5, 'k'], [null, 'k'], [{}, 'k'], [['agent-1'], 'k'], ['agent-1', 5], ['agent-1', ''], ['agent-1', null], ['agent-1', { toString: () => 'k' }], ['agent-1', 'x'.repeat(513)], ['__proto__', 'k'], ['agent-1', undefined]] as [unknown, unknown][])
        assert.strictEqual(revokeGrantFor(has, rv, i, k), false, `refused: ${JSON.stringify([i, k]).slice(0, 40)}`);
      assert.strictEqual(calls.length, 1, 'no hostile call reached the adapter');
    }

    // the event guard refuses a malformed reason
    const ev = (allowedBy: unknown) => eventProblems({ type: 'permission', sessionId: 's', timestamp: 1, permission: { requestId: 'q', kind: 'write', summary: 'x', state: 'approved', allowedBy } });
    for (const ok of [{ kind: 'allow-all' }, { kind: 'in-folder' }, { kind: 'attachment' }, { kind: 'session-grant', key: 'k', label: 'l', keys: ['k', 'j'] }, { kind: 'session-grant', key: 'k', label: 'l' }, { kind: 'app', source: 'config' }, undefined]) assert.deepStrictEqual(ev(ok), [], JSON.stringify(ok));
    for (const bad of [{ kind: 'x' }, 'allow-all', null, [], { kind: 'session-grant' }, { kind: 'session-grant', key: '', label: 'l' }, { kind: 'session-grant', key: 1, label: 'l' }, { kind: 'app', source: 'root' }, { kind: 'app' }, { kind: 'session-grant', key: 'k', label: 'l', keys: [] }, { kind: 'session-grant', key: 'k', label: 'l', keys: 'k' }, { kind: 'session-grant', key: 'k', label: 'l', keys: [1] }])
      assert.ok(ev(bad).length > 0, `refused: ${JSON.stringify(bad)}`);

    // the words (renderer module): fixed table, only the label comes from the event, cut; unknown = no tag
    const live = new Set(['k1']);
    const d = W.describe({ kind: 'session-grant', key: 'k1', label: 'write in src/' }, live);
    assert.ok(d && d.pill === 'Allowed: session rule' && d.undoKeys?.[0] === 'k1' && d.label === 'write in src/' && !d.gone);
    const gone = W.describe({ kind: 'session-grant', key: 'k1', label: 'write in src/' }, new Set(), { seen: ['k1'] });
    assert.ok(gone && gone.gone === true && gone.pill === 'Rule removed' && gone.undoKeys === undefined, 'a removed rule offers no undo');
    // a window that reloaded with sessions running knows no rules: it must not call a rule removed (spec 003 FR-101, review of #729 item 10)
    const reloaded = W.describe({ kind: 'session-grant', key: 'k1', label: 'l' }, new Set(), { seen: [] });
    assert.ok(reloaded && !reloaded.gone && reloaded.pill === 'Allowed: session rule' && reloaded.undoKeys?.[0] === 'k1', 'a rule this window never saw is not "removed"');
    assert.ok(W.describe({ kind: 'session-grant', key: 'k1', label: 'l' }, new Set(), { undone: true })?.gone === true, 'removed from the card: removed');
    assert.ok(!W.describe({ kind: 'session-grant', key: 'k1', label: 'l' }, null, { undone: true })?.gone, 'unknown rules: never removed');
    // several rules: removed only when all are gone; undo covers every live one
    const two = { kind: 'session-grant', key: 'a', label: 'write in w/a/, w/b/', keys: ['a', 'b'] };
    assert.deepStrictEqual(W.describe(two, new Set(['a', 'b']), { seen: ['a', 'b'] })?.undoKeys, ['a', 'b']);
    assert.strictEqual(W.describe(two, new Set(['b']), { seen: ['a', 'b'] })?.gone, undefined, 'one rule left: still allowed by it');
    assert.deepStrictEqual(W.describe(two, new Set(['b']), { seen: ['a', 'b'] })?.undoKeys, ['b']);
    assert.strictEqual(W.describe(two, new Set(), { seen: ['a'] })?.gone, true);
    assert.strictEqual(W.describe({ ...two, keys: [] }, null), null, 'empty keys list: no tag');
    assert.strictEqual(W.describe({ ...two, keys: ['a', 5] }, null), null);
    assert.strictEqual(W.describe({ ...two, keys: Array.from({ length: 51 }, (_, i) => 'k' + i) }, null), null);
    assert.strictEqual(W.describe({ kind: 'session-grant', key: 'k1', label: 'l' }, null)?.undoKeys?.[0], 'k1', 'unknown live set: offered');
    assert.strictEqual(W.describe({ kind: 'allow-all' }, live)?.undoKeys, undefined, 'Allow all has no rule to undo');
    assert.strictEqual(W.describe({ kind: 'in-folder' }, live)?.undoKeys, undefined);
    assert.strictEqual(W.describe({ kind: 'attachment' }, live)?.pill, 'Allowed: attached file');
    // the sentences point at the real place and promise nothing a mode cannot do (review of #729 item 3)
    for (const k of ['allow-all', 'in-folder', 'attachment']) {
      const sd = W.describe({ kind: k }, live)?.sentence ?? '';
      assert.ok(!/chat header/i.test(sd), `${k}: the mode chip is under the message box`);
      assert.ok(!/limit/i.test(sd), `${k}: no promise that a mode limits it`);
    }
    assert.ok(/mode chip under the message box/.test(W.describe({ kind: 'allow-all' }, live)?.sentence ?? ''));
    assert.strictEqual(W.describe({ kind: 'app', source: 'classifier' }, live)?.pill, 'Allowed: agent app classifier');
    assert.strictEqual(W.describe({ kind: 'app', source: 'classifier' }, live)?.undoKeys, undefined, 'Durbar does not own an app rule');
    const evil = '<img src=x onerror=alert(1)>' + 'A'.repeat(1000);
    const dd = W.describe({ kind: 'session-grant', key: 'k1', label: evil }, live);
    assert.ok(dd && typeof dd.label === 'string' && dd.label.length <= 241, 'the label is cut');
    assert.ok(!dd.pill.includes('<') && !dd.sentence.includes('<'), 'the words never carry event text');
    for (const bad of [null, undefined, 'x', 5, [], {}, { kind: 'root' }, { kind: 'app', source: '__proto__' }, { kind: 'app', source: 'constructor' }, { kind: 'app', source: 'toString' }, { kind: 'session-grant' }, { kind: 'session-grant', key: '', label: 'x' }, { kind: 'session-grant', key: 5, label: 'x' }, { kind: 'session-grant', key: 'k', label: 5 }])
      assert.strictEqual(W.describe(bad, live), null, `no tag for ${JSON.stringify(bad)}`);
  }

  console.log('permissions: all checks passed');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
