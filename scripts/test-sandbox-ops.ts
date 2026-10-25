/**
 * Spec 087 FR-007a/FR-007c/FR-012 (review on PR 733): main's sandbox operations, without Electron: Continue only answers an open note
 * main forwarded (one-shot), Always only when offered and stored only after the adapter accepted, the owner-only check, the undo.
 * Part of `npm run test:runtime`. No process, no account, no credits.
 */
import * as assert from 'assert';
import { createSandboxOps } from '../src/main/sandboxops';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';

let done = false;
process.on('exit', (code) => {
  if (!done && code === 0) {
    console.error('sandbox ops: the run ended before its last check');
    process.exitCode = 1;
  }
});

async function main(): Promise<void> {
  const calls: Array<{ id: string; always: boolean }> = [];
  let refuse = '';
  const ad = {
    id: 'claude',
    capabilities: { osSandbox: true },
    continueWithoutSandbox: async (id: string, o: { always?: boolean }) => { calls.push({ id, always: !!o.always }); if (refuse) throw new Error(refuse); },
    sandboxHost: async () => ({ available: false, reason: 'no sandbox here' }),
  } as unknown as AgentAdapter;
  const stored: Array<[unknown, unknown]> = [];
  const store = { setSandboxAlwaysContinue: (a: unknown, on: unknown) => { stored.push([a, on]); return on === true; }, sandboxAlwaysContinue: (a: string) => stored.some((x) => x[0] === a && x[1] === true) };
  const ops = createSandboxOps({ adapterOf: (id) => (id === 's1' || id === 's2' ? ad : undefined), instance: (a) => { if (a !== 'claude') throw new Error('x'); return ad; }, readyAdapterIds: async () => new Set(['claude', 'codex']), store: () => store });
  const note = (id: string, actions: Array<'continue' | 'always'>, refused = false): AgentEvent => ({ type: 'sandbox', sessionId: id, timestamp: 1, sandbox: { state: 'off', covers: ['shell'], verified: false }, notice: { text: 't', actions, ...(refused ? { refused: true } : {}) } });

  assert.deepStrictEqual(await ops.continueWithout(false, 's1', {}), { ok: false, error: 'invalid request' }, 'not from Durbar\'s own window');
  assert.deepStrictEqual(await ops.continueWithout(true, 'nope', {}), { ok: false, error: 'unknown agent' });
  assert.deepStrictEqual(await ops.continueWithout(true, 7, {}), { ok: false, error: 'unknown agent' });
  const noNote = await ops.continueWithout(true, 's1', {});
  assert.ok(!noNote.ok && /no OS sandbox note/.test(noNote.error), 'no note open: refused (a working floor is never switched off)');
  assert.strictEqual(calls.length, 0, 'the adapter was never asked');
  ops.onEvent(note('s1', ['continue'], true));
  assert.ok(!(await ops.continueWithout(true, 's1', {})).ok, 'a refusal (policy) opens no note');
  ops.onEvent(note('s1', ['continue']));
  ops.onEvent({ type: 'sandbox', sessionId: 's1', timestamp: 2, sandbox: { state: 'unknown', covers: ['shell'], verified: false } });
  assert.ok(!(await ops.continueWithout(true, 's1', {})).ok, 'a new attempt closes the note');
  ops.onEvent(note('s1', ['continue']));
  const always1 = await ops.continueWithout(true, 's1', { always: true });
  assert.ok(!always1.ok && /not offered/.test(always1.error), 'Always only where the note offered it');
  ops.onEvent(note('s1', ['continue']));
  assert.deepStrictEqual(await ops.continueWithout(true, 's1', { always: 'yes' }), { ok: true }, 'a non-boolean always is false');
  assert.deepStrictEqual(calls.pop(), { id: 's1', always: false });
  assert.ok(!(await ops.continueWithout(true, 's1', {})).ok, 'one-shot: the second call is refused');
  ops.onEvent(note('s2', ['continue', 'always']));
  refuse = 'Your organization requires the OS sandbox';
  const r = await ops.continueWithout(true, 's2', { always: true });
  assert.ok(!r.ok && /organization requires/.test(r.error), 'the adapter refusal is passed on');
  assert.strictEqual(stored.length, 0, 'Always is not stored when the adapter refused');
  refuse = '';
  ops.onEvent(note('s2', ['continue', 'always']));
  assert.deepStrictEqual(await ops.continueWithout(true, 's2', { always: true }), { ok: true });
  assert.deepStrictEqual(stored, [['claude', true]], 'stored only after the adapter accepted');
  // review round 2 (6): a session that ends or is removed takes its note with it
  ops.onEvent(note('s1', ['continue']));
  ops.forget('s1');
  assert.ok(!(await ops.continueWithout(true, 's1', {})).ok, 'forget closes the note');
  // the Settings line and the undo
  assert.deepStrictEqual(await ops.hosts(false), {}, 'owner-only');
  assert.deepStrictEqual(await ops.hosts(true), { claude: { available: false, reason: 'no sandbox here', alwaysContinue: true } }, 'ready apps with the capability; the stored choice shown');
  assert.deepStrictEqual(ops.alwaysOff(false, 'claude'), { ok: false });
  assert.deepStrictEqual(ops.alwaysOff(true, 'evil'), { ok: false }, 'known app ids only');
  assert.deepStrictEqual(ops.alwaysOff(true, 7), { ok: false });
  assert.deepStrictEqual(ops.alwaysOff(true, 'claude'), { ok: true });
  assert.deepStrictEqual(stored.pop(), ['claude', false]);
  done = true;
  console.log('sandbox ops (spec 087): all checks passed');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
