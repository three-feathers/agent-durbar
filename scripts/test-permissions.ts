/** Unit test for the permission broker (no Copilot session, no AI credits): `npm run test:permissions`. */
import * as assert from 'assert';
import { PermissionBroker, grantScope } from '../src/adapters/permissions';
import type { BrokerEvent } from '../src/adapters/permissions';

async function main(): Promise<void> {
  // scopes
  assert.deepStrictEqual(grantScope({ kind: 'write', fileName: '/a/b/src/x.ts' }).key, 'write:/a/b/src');
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'npm test' }).key, 'shell:npm');
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'npm test && rm -rf /' }).key, 'shell-exact:npm test && rm -rf /');
  assert.strictEqual(grantScope({ kind: 'shell', fullCommandText: 'cat a | sh' }).key.startsWith('shell-exact:'), true);
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
  console.log('permissions: all checks passed');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
