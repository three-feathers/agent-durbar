/** Handler bodies behind the IPC (spec 012 FR-054): fake adapters and a fake store only. No Electron, no session, no credits. */
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { FakeAdapter } from '../src/adapters/fake';
import { ALL_OPTIONAL as ALL } from './test-adapter-contract';
import { restorable, resumeModeOp, sendWithSlash, setCapOp, setMcpOp, setModeOp, stopTurnOp } from '../src/main/agentops';
import type { AgentMessage } from '../src/adapters/types';
import type { OpsDeps } from '../src/main/agentops';
import type { SavedFolder } from '../src/main/folders';
import type { AgentInfo, PermMode } from '../src/shared/api';

const WS = path.join(os.tmpdir(), 'durbar-agentops-ws');

function setup() {
  const full = new FakeAdapter({ id: 'full' });
  const bare = new FakeAdapter({ id: 'bare', omit: ALL });
  const by = new Map<string, FakeAdapter>();
  const agents = new Map<string, AgentInfo>();
  const mk = (id: string, ad: FakeAdapter): AgentInfo => {
    const a = { id, name: id, cwd: WS + '-' + id, folders: [], permMode: 'ask' as PermMode, adapterId: 'copilot' } as AgentInfo;
    agents.set(id, a);
    by.set(id, ad);
    return a;
  };
  const calls: string[] = [];
  const store = { setPermMode: (k: string, m: unknown) => (calls.push(`mode:${k}:${String(m)}`), true), setMaxAiCredits: (k: string, c: unknown) => (calls.push(`cap:${k}:${String(c)}`), true), setSessionMode: (k: string, id: string, m: unknown) => (calls.push(`smode:${k}:${id}:${String(m)}`), true) };
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
    assert.deepStrictEqual(calls, [`mode:${b.cwd}:allow`, `smode:${b.cwd}:b:allow`], 'a: not live: the folder mode and this session\'s own mode are saved (spec 003, 2026-10-21)');
    // a full fake applies it and counts pending
    await full.start({ workspace: WS, sessionId: 'f', permissionMode: 'ask', quiet: true });
    const p1 = full.request('f', { kind: 'write', toolCallId: 'c1', fileName: path.join(WS, 'x') });
    const p2 = full.request('f', { kind: 'shell', toolCallId: 'c2', fullCommandText: 'ls' });
    f.permRestored = true;
    f.permFrom = 'session';
    const r3 = setModeOp(deps(false), 'f', 'garbage', {}); // invalid -> read-only: denies both
    assert.deepStrictEqual(r3, { ok: true, mode: 'read-only', pending: 0 }, 'a: an invalid mode becomes read-only, and denies what is pending');
    assert.strictEqual(f.permRestored, undefined, 'a: permRestored is cleared');
    assert.strictEqual(f.permFrom, undefined, 'a: permFrom is cleared (a fresh choice)');
    assert.deepStrictEqual([(await p1).kind, (await p2).kind], ['reject', 'reject'], 'a: the pending requests were denied');
    const p3 = full.request('f', { kind: 'write', toolCallId: 'c3', fileName: path.join(WS, 'x') });
    setModeOp(deps(), 'f', 'ask', {});
    const p4 = full.request('f', { kind: 'write', toolCallId: 'c4', fileName: path.join(WS, 'x') });
    const r4 = setModeOp(deps(), 'f', 'allow', { approvePending: false });
    assert.deepStrictEqual(r4, { ok: true, mode: 'allow', pending: 1 }, 'a: pending counts what stays pending');
    full.resolvePermission?.('f', 'c4', true);
    assert.strictEqual((await p4).kind, 'approve-once');
    assert.strictEqual((await p3).kind, 'reject');
    // spec 003 (2026-10-21): the session's own mode is saved under its resume id when main gives one (Codex: the thread id)
    calls.length = 0;
    assert.ok(setModeOp({ ...deps(), sessionKey: (a) => 'thread-' + a.id }, 'b', 'ask', {}).ok);
    assert.deepStrictEqual(calls, [`mode:${b.cwd}:ask`, `smode:${b.cwd}:thread-b:ask`], 'a: the session mode is keyed by the resume id');
  }

  // spec 003 (2026-10-21): a session resumed from Previous sessions starts in its own last mode, and a difference is logged
  {
    const saved = { sessionModes: [{ id: 'A', mode: 'allow' as PermMode }, { id: 'B', mode: 'ask' as PermMode }] };
    assert.deepStrictEqual(resumeModeOp(saved, 'A', 'read-only'), { mode: 'allow', permFrom: 'session', permRestored: true, modeWas: 'read-only', logLine: 'Resumed in Allow all, the mode last chosen for this session (opened from a session in Read-only)' }, 'resume: the owner\'s case, Allow all comes back and says so');
    assert.deepStrictEqual(resumeModeOp(saved, 'B', 'ask'), { mode: 'ask', permFrom: 'session' }, 'resume: same mode as the opener, nothing to log');
    assert.deepStrictEqual(resumeModeOp(saved, 'B', 'allow'), { mode: 'ask', permFrom: 'session', modeWas: 'allow', logLine: 'Resumed in Ask first, the mode last chosen for this session (opened from a session in Allow all)' }, 'resume: a narrower own mode is used and logged too');
    assert.deepStrictEqual(resumeModeOp(saved, 'Z', 'read-only'), { mode: 'read-only', permFrom: 'opener' }, 'resume: nothing remembered, the opener\'s mode');
    assert.deepStrictEqual(resumeModeOp(undefined, 'A', 'ask'), { mode: 'ask', permFrom: 'opener' }, 'resume: no saved folder, the opener\'s mode');
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

  // (b2) spec 012 FR-150: a dollar-cap adapter takes cents, and its cap is never saved with the folder (that one is AIU)
  {
    const { full, mk, calls, deps } = setup();
    Object.defineProperty(full, 'capabilities', { value: { ...full.capabilities, capUnit: 'usd' } });
    const u = mk('u', full);
    const bad = await setCapOp(deps(), 'u', 0.001);
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error ?? '', /at least \$0\.01/, 'b2: the dollar minimum');
    await full.start({ workspace: WS, sessionId: 'u', quiet: true });
    assert.deepStrictEqual(await setCapOp(deps(), 'u', 0.5), { ok: true, maxAiCredits: 0.5 }, 'b2: $0.50 is fine (an AIU cap would need 30)');
    assert.strictEqual(u.maxAiCredits, 0.5);
    assert.deepStrictEqual(await setCapOp(deps(), 'u', null), { ok: true, maxAiCredits: undefined });
    assert.deepStrictEqual(calls, [], 'b2: the folder store is not touched');
    await full.stop('u');
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
  // (f) spec 073 FR-005 (review on #535): main's send step expands a `/name` and falls back to the typed text
  {
    const sent: AgentMessage[] = [];
    const asked: string[] = [];
    const ad = (expand?: (id: string, t: string) => Promise<{ text: string; where: string; note?: string } | undefined>) => ({
      send: async (_id: string, m: AgentMessage) => { sent.push(m); },
      ...(expand ? { expandSlashCommand: expand } : {}),
    });
    const att = [{ path: '/x/a.png', kind: 'image' as const }];
    const ok = ad(async (id, t) => (asked.push(`${id}:${t}`), t.startsWith('/review') ? { text: 'EXPANDED body', where: '.claude/commands/review.md' } : undefined));
    assert.deepStrictEqual(await sendWithSlash(ok, 's1', { text: '/review 42', attachments: att, plan: true }), { slash: '.claude/commands/review.md' }, 'f: where comes back');
    assert.deepStrictEqual(sent.pop(), { text: 'EXPANDED body', attachments: att, plan: true }, 'f: the expanded text reaches send, with the attachments and plan');
    assert.deepStrictEqual(asked, ['s1:/review 42'], 'f: the adapter is asked with the agent id and the typed text');
    assert.deepStrictEqual(await sendWithSlash(ok, 's1', { text: 'hi' }), {}, 'f: no expansion, no slash');
    assert.deepStrictEqual(sent.pop(), { text: 'hi' }, 'f: the typed text is sent');
    const bad = ad(async () => { throw new Error('disk gone'); });
    assert.deepStrictEqual(await sendWithSlash(bad, 's1', { text: '/review 1' }), {}, 'f: a rejected expansion is not an error');
    assert.deepStrictEqual(sent.pop(), { text: '/review 1' }, 'f: a rejected expansion sends the typed text');
    assert.deepStrictEqual(await sendWithSlash(ad(), 's1', { text: '/review 1' }), {}, 'f: an adapter without expansion sends as typed');
    assert.deepStrictEqual(sent.pop(), { text: '/review 1' });
    // spec 073 delta 2026-10-23: a VS Code prompt file's note comes back as slashNote
    const noted = ad(async () => ({ text: 'P', where: '.github/prompts/p.prompt.md', note: 'VS Code settings not applied: mode.' }));
    assert.deepStrictEqual(await sendWithSlash(noted, 's1', { text: '/p' }), { slash: '.github/prompts/p.prompt.md', slashNote: 'VS Code settings not applied: mode.' }, 'f: the note comes back');
    assert.deepStrictEqual(sent.pop(), { text: 'P' });
    const failing = { send: async () => { throw new Error('send failed'); }, expandSlashCommand: async () => ({ text: 'X', where: 'w' }) };
    await assert.rejects(sendWithSlash(failing, 's1', { text: '/review' }), /send failed/, 'f: a failed send still rejects (sendOp reports it)');
  }
  console.log('agentops: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
