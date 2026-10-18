/** Handler bodies behind the IPC (spec 012 FR-054): fake adapters and a fake store only. No Electron, no session, no credits. */
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { FakeAdapter } from '../src/adapters/fake';
import type { OptionalMember } from '../src/adapters/fake';
import { restorable, setCapOp, setMcpOp, setModeOp, stopTurnOp } from '../src/main/agentops';
import type { OpsDeps } from '../src/main/agentops';
import type { SavedFolder } from '../src/main/folders';
import type { AgentInfo, PermMode } from '../src/shared/api';

const ALL: OptionalMember[] = ['interrupt', 'resolvePermission', 'revokeGrant', 'setCap', 'resolveLimit', 'setMcpEnabled', 'setModel', 'cancelQueuedModel', 'compact', 'listModelOptions', 'listPreviousSessions', 'history', 'setPermMode'];
const WS = path.join(os.tmpdir(), 'durbar-agentops-ws');

function setup() {
  const full = new FakeAdapter({ id: 'full' });
  const bare = new FakeAdapter({ id: 'bare', omit: ALL });
  const by = new Map<string, FakeAdapter>();
  const agents = new Map<string, AgentInfo>();
  const mk = (id: string, ad: FakeAdapter): AgentInfo => {
    const a = { id, name: id, cwd: WS + '-' + id, folders: [], permMode: 'ask' as PermMode } as AgentInfo;
    agents.set(id, a);
    by.set(id, ad);
    return a;
  };
  const calls: string[] = [];
  const store = { setPermMode: (k: string, m: unknown) => (calls.push(`mode:${k}:${String(m)}`), true), setMaxAiCredits: (k: string, c: unknown) => (calls.push(`cap:${k}:${String(c)}`), true) };
  const deps = (withStore = true): OpsDeps => ({ agents, router: { forAgent: (id) => by.get(id) }, store: withStore ? store : undefined, wsKey: (a) => a.cwd });
  return { full, bare, agents, mk, calls, deps };
}

async function main(): Promise<void> {
  // (a) setModeOp
  {
    const { full, bare, mk, calls, deps } = setup();
    const f = mk('f', full);
    const b = mk('b', bare);
    assert.deepStrictEqual(setModeOp(deps(), 'nope', 'allow', {}), { ok: false, error: 'unknown agent' }, 'a: unknown agent gives an error');
    assert.deepStrictEqual(setModeOp(deps(), 42, 'allow', {}), { ok: false, error: 'unknown agent' }, 'a: a non-string id gives an error');
    await bare.start({ workspace: WS, sessionId: 'b', quiet: true });
    const r = setModeOp(deps(), 'b', 'allow', {});
    assert.strictEqual(r.ok, false, 'a: a live adapter without setPermMode is refused');
    assert.match(r.error ?? '', /cannot change that setting while its session is running/, 'a: refusal message');
    assert.deepStrictEqual(calls, [], 'a: a refusal does not call the store');
    assert.strictEqual(b.permMode, 'ask', 'a: a refusal leaves permMode unchanged');
    await bare.stop('b');
    const r2 = setModeOp(deps(), 'b', 'allow', {});
    assert.deepStrictEqual(r2, { ok: true, mode: 'allow', pending: 0 }, 'a: a bare adapter that is not live saves the mode');
    assert.strictEqual(b.permMode, 'allow', 'a: not live: permMode is saved');
    assert.deepStrictEqual(calls, [`mode:${b.cwd}:allow`], 'a: not live: the store is called once with the workspace key');
    // a full fake applies it and counts pending
    await full.start({ workspace: WS, sessionId: 'f', permissionMode: 'ask', quiet: true });
    const p1 = full.request('f', { kind: 'write', toolCallId: 'c1', fileName: path.join(WS, 'x') });
    const p2 = full.request('f', { kind: 'shell', toolCallId: 'c2', fullCommandText: 'ls' });
    f.permRestored = true;
    const r3 = setModeOp(deps(false), 'f', 'garbage', {}); // invalid -> read-only: denies both
    assert.deepStrictEqual(r3, { ok: true, mode: 'read-only', pending: 0 }, 'a: an invalid mode becomes read-only, and denies what is pending');
    assert.strictEqual(f.permRestored, undefined, 'a: permRestored is cleared');
    assert.deepStrictEqual([(await p1).kind, (await p2).kind], ['reject', 'reject'], 'a: the pending requests were denied');
    const p3 = full.request('f', { kind: 'write', toolCallId: 'c3', fileName: path.join(WS, 'x') });
    setModeOp(deps(), 'f', 'ask', {});
    const p4 = full.request('f', { kind: 'write', toolCallId: 'c4', fileName: path.join(WS, 'x') });
    const r4 = setModeOp(deps(), 'f', 'allow', { approvePending: false });
    assert.deepStrictEqual(r4, { ok: true, mode: 'allow', pending: 1 }, 'a: pending counts what stays pending');
    full.resolvePermission?.('f', 'c4', true);
    assert.strictEqual((await p4).kind, 'approve-once');
    assert.strictEqual((await p3).kind, 'reject');
  }

  // (b) setCapOp
  {
    const { full, bare, mk, calls, deps } = setup();
    const f = mk('f', full);
    const b = mk('b', bare);
    assert.deepStrictEqual(await setCapOp(deps(), 'nope', 30), { ok: false, error: 'unknown agent' }, 'b: unknown agent gives an error');
    for (const bad of [5, 'x']) {
      const r = await setCapOp(deps(), 'b', bad);
      assert.strictEqual(r.ok, false, `b: ${String(bad)} is invalid`);
      assert.match(r.error ?? '', /at least 30 AI credits/, 'b: invalid value message');
    }
    assert.deepStrictEqual(calls, [], 'b: invalid values are not saved');
    await bare.start({ workspace: WS, sessionId: 'b', quiet: true });
    const r = await setCapOp(deps(), 'b', 100);
    assert.strictEqual(r.ok, false, 'b: a live adapter without setCap is refused');
    assert.match(r.error ?? '', /cannot change that setting/, 'b: refusal message');
    assert.strictEqual(b.maxAiCredits, undefined, 'b: a refusal leaves the cap unchanged');
    assert.deepStrictEqual(calls, [], 'b: a refusal does not call the store');
    await bare.stop('b');
    assert.deepStrictEqual(await setCapOp(deps(), 'b', 100), { ok: true, maxAiCredits: 100 }, 'b: not live: saved');
    assert.deepStrictEqual(await setCapOp(deps(), 'b', null), { ok: true, maxAiCredits: undefined }, 'b: null removes the cap');
    assert.strictEqual(b.maxAiCredits, undefined, 'b: null clears maxAiCredits');
    assert.deepStrictEqual(calls, [`cap:${b.cwd}:100`, `cap:${b.cwd}:undefined`], 'b: the store saw both');
    const seen: string[] = [];
    full.onEvent((e) => e.type === 'limit' && seen.push(`${e.phase}:${String(e.maxAiCredits)}`));
    await full.start({ workspace: WS, sessionId: 'f', quiet: true });
    assert.deepStrictEqual(await setCapOp(deps(), 'f', 60), { ok: true, maxAiCredits: 60 }, 'b: a full fake takes the cap live');
    assert.deepStrictEqual(seen, ['changed:60'], 'b: setCap was called on the adapter');
    assert.strictEqual(f.maxAiCredits, 60);
    await full.stop('f');
    // an adapter error becomes { ok: false, error }
    await full.start({ workspace: WS, sessionId: 'f', quiet: true });
    full.setCap = async () => { throw new Error('boom'); };
    assert.deepStrictEqual(await setCapOp(deps(), 'f', 90), { ok: false, error: 'boom' }, 'b: an adapter error is returned, nothing saved');
    assert.strictEqual(f.maxAiCredits, 60);
  }

  // (c) stopTurnOp
  {
    const { full, bare, mk, deps } = setup();
    mk('f', full);
    mk('b', bare);
    assert.strictEqual(await stopTurnOp(deps(), 'nope'), undefined, 'c: unknown agent: nothing');
    assert.strictEqual(await stopTurnOp(deps(), 'b'), undefined, 'c: not live: nothing to refuse');
    await bare.start({ workspace: WS, sessionId: 'b', quiet: true });
    const r = await stopTurnOp(deps(), 'b');
    assert.strictEqual(r?.ok, false, 'c: live bare is refused');
    assert.match(r?.error ?? '', /cannot stop a running turn/, 'c: refusal message');
    assert.ok(bare.isLive('b'), 'c: the refused session is untouched');
    await full.start({ workspace: WS, sessionId: 'f', quiet: true });
    assert.strictEqual(await stopTurnOp(deps(), 'f'), undefined, 'c: full gives undefined');
    assert.ok(full.isLive('f'), 'c: full stays live');
  }

  // (d) setMcpOp
  {
    const { full, bare, mk, deps } = setup();
    mk('f', full);
    mk('b', bare);
    const off = new Map<string, Set<string>>();
    assert.deepStrictEqual(await setMcpOp(deps(), off, 'nope', 'srv', true), { ok: false, error: 'unknown agent or server' }, 'd: unknown agent');
    for (const bad of ['', 'x'.repeat(65), 7]) {
      assert.deepStrictEqual(await setMcpOp(deps(), off, 'f', bad, false), { ok: false, error: 'unknown agent or server' }, `d: bad name ${JSON.stringify(bad)}`);
    }
    assert.strictEqual(off.size, 0, 'd: bad input does not touch off');
    await bare.start({ workspace: WS, sessionId: 'b', quiet: true });
    const r = await setMcpOp(deps(), off, 'b', 'srv', false);
    assert.strictEqual(r.ok, false, 'd: a live adapter without setMcpEnabled is refused');
    assert.match(r.error ?? '', /cannot switch MCP servers/, 'd: refusal message');
    assert.strictEqual(off.size, 0, 'd: a refusal leaves off unchanged');
    await bare.stop('b');
    assert.deepStrictEqual(await setMcpOp(deps(), off, 'b', 'srv', false), { ok: true }, 'd: not live: saved');
    assert.deepStrictEqual([...(off.get('b') ?? [])], ['srv'], 'd: not live: the server is off');
    assert.deepStrictEqual(await setMcpOp(deps(), off, 'b', 'srv', true), { ok: true }, 'd: switching on');
    assert.deepStrictEqual([...(off.get('b') ?? [])], [], 'd: switching on removes it from off');
    await full.start({ workspace: WS, sessionId: 'f', quiet: true });
    assert.deepStrictEqual(await setMcpOp(deps(), off, 'f', 'srv', false), { ok: true }, 'd: a full fake applies it live');
    full.setMcpEnabled = async () => { throw new Error('not part of this session'); };
    const e = await setMcpOp(deps(), off, 'f', 'srv2', false);
    assert.strictEqual(e.ok, true, 'd: a live apply error is still saved');
    assert.match(e.error ?? '', /^Saved for this agent\..*not part of this session.*applies at the next start\.$/, 'd: the apply error message');
    assert.ok(off.get('f')?.has('srv2'), 'd: saved even though it could not be applied');
  }

  // (e) restorable
  {
    const sf = (workspace: string, adapterId?: string): SavedFolder => ({ workspace, ...(adapterId ? { adapterId } : {}) } as SavedFolder);
    const known = new Set(['copilot', 'fake']);
    const warns: string[] = [];
    const secret = path.join(os.tmpdir(), 'SECRET-project-folder');
    const list = [sf(path.join(os.tmpdir(), 'one')), sf(secret, 'future-agent'), sf(path.join(os.tmpdir(), 'two'), 'fake'), sf(path.join(os.tmpdir(), 'three'), 'future-agent')];
    const out = restorable(list, (i) => known.has(i), (m) => warns.push(m));
    assert.deepStrictEqual(out.map((x) => [x.folder.workspace, x.adapterId]), [[list[0].workspace, 'copilot'], [list[2].workspace, 'fake']], 'e: known ids pass, in order, with their adapter id (a missing id is copilot)');
    assert.strictEqual(out[0].folder, list[0], 'e: the folder object is passed through');
    assert.strictEqual(warns.length, 1, 'e: two folders of one unknown id warn once');
    assert.ok(warns[0].includes('future-agent'), 'e: the warning names the adapter id');
    assert.ok(!warns[0].includes('SECRET') && !warns[0].includes(os.tmpdir()), 'e: the warning has no workspace path');
    const w2: string[] = [];
    restorable([sf(secret, 'a-one'), sf(secret, 'a-two')], () => false, (m) => w2.push(m));
    assert.strictEqual(w2.length, 2, 'e: two different unknown ids warn twice');
    assert.deepStrictEqual(restorable([], () => true, () => assert.fail('no warning')), [], 'e: empty in, empty out');
  }
  console.log('agentops: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
