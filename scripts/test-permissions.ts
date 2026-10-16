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
  console.log('permissions: all checks passed');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
