/** Handler bodies behind the IPC (spec 012 FR-054): fake adapters and a fake store only. No Electron, no session, no credits. */
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { FakeAdapter } from '../src/adapters/fake';
import { ALL_OPTIONAL as ALL } from './test-adapter-contract';
import { MAX_ANSWER } from '../src/shared/answerlimits';
import { answerQuestionOp, assistedOnEvent, restorable, resumeModeOp, sendWithSlash, setCapOp, setMcpOp, setModeAssistedOp, setModeOp, stopTurnOp } from '../src/main/agentops';
import { ASSISTED_NOT_ASK, ASSISTED_NOT_RUNNING, ASSISTED_OFF_ROW, ASSISTED_POLICY_LINE, ASSISTED_REMOTE, ASSISTED_UNSUPPORTED_LINE, ASSISTED_UNVERIFIED, NO_ASSISTED } from '../src/adapters/assistedLines';
import type { AgentAdapter, AgentEvent } from '../src/adapters/types';
import type { AgentMessage } from '../src/adapters/types';
import type { OpsDeps } from '../src/main/agentops';
import type { SavedFolder } from '../src/main/folders';
import type { AgentInfo, PermMode } from '../src/shared/api';
import { ShownError } from '../src/shared/shownerror';

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
    full.setCap = async () => { throw new ShownError('boom'); };
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
    full.setMcpEnabled = async () => { throw new ShownError('not part of this session'); };
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
    const ad = (expand?: (id: string, t: string) => Promise<{ text: string; where: string; note?: string; asTyped?: true } | undefined>) => ({
      send: async (_id: string, m: AgentMessage) => { sent.push(m); },
      ...(expand ? { expandSlashCommand: expand } : {}),
    });
    const att = [{ path: '/x/a.png', kind: 'image' as const }];
    const ok = ad(async (id, t) => (asked.push(`${id}:${t}`), t.startsWith('/review') ? { text: 'EXPANDED body', where: '.claude/commands/review.md' } : undefined));
    assert.deepStrictEqual(await sendWithSlash(ok, 's1', { text: '/review 42', attachments: att, plan: true }), { slash: '.claude/commands/review.md' }, 'f: where comes back');
    assert.deepStrictEqual(sent.pop(), { text: 'EXPANDED body', attachments: att, plan: true }, 'f: the expanded text reaches send, with the attachments and plan');
    assert.deepStrictEqual(asked.slice(), ['s1:/review 42'], 'f: the adapter is asked with the agent id and the typed text');
    assert.deepStrictEqual(await sendWithSlash(ok, 's1', { text: 'hi' }), {}, 'f: no expansion, no slash');
    assert.deepStrictEqual(sent.pop(), { text: 'hi' }, 'f: the typed text is sent');
    const bad = ad(async () => { throw new ShownError('disk gone'); });
    assert.deepStrictEqual(await sendWithSlash(bad, 's1', { text: '/review 1' }), {}, 'f: a rejected expansion is not an error');
    assert.deepStrictEqual(sent.pop(), { text: '/review 1' }, 'f: a rejected expansion sends the typed text');
    assert.deepStrictEqual(await sendWithSlash(ad(), 's1', { text: '/review 1' }), {}, 'f: an adapter without expansion sends as typed');
    assert.deepStrictEqual(sent.pop(), { text: '/review 1' });
    // spec 073 delta 2026-10-23: a VS Code prompt file's note comes back as slashNote
    const noted = ad(async () => ({ text: 'P', where: '.github/prompts/p.prompt.md', note: 'VS Code settings not applied: mode.' }));
    assert.deepStrictEqual(await sendWithSlash(noted, 's1', { text: '/p' }), { slash: '.github/prompts/p.prompt.md', slashNote: 'VS Code settings not applied: mode.' }, 'f: the note comes back');
    assert.deepStrictEqual(sent.pop(), { text: 'P' });
    // review on #615: over the size cap the adapter answers asTyped; the typed line is sent and only the note comes back
    const capped = ad(async () => ({ text: 'NOT SENT', where: 'p.md', asTyped: true as const, note: 'Not expanded: too big.' }));
    assert.deepStrictEqual(await sendWithSlash(capped, 's1', { text: '/p huge' }), { slashNote: 'Not expanded: too big.' }, 'f: asTyped gives only the note');
    assert.deepStrictEqual(sent.pop(), { text: '/p huge' }, 'f: asTyped sends the typed line');
    const failing = { send: async () => { throw new ShownError('send failed'); }, expandSlashCommand: async () => ({ text: 'X', where: 'w' }) };
    await assert.rejects(sendWithSlash(failing, 's1', { text: '/review' }), /send failed/, 'f: a failed send still rejects (sendOp reports it)');
  }
  // (g) answerQuestionOp (spec 052 FR-178, issue 689): the answer reaches the adapter as given; a long question's key is kept; nothing usable is refused, never a skip
  {
    const got: unknown[] = [];
    const adapter = { answerQuestion: (sid: string, rid: string, ans: unknown) => got.push([sid, rid, ans]) };
    const agents = new Map<string, AgentInfo>([['g1', { id: 'g1', name: 'g1', cwd: WS, folders: [], permMode: 'ask', adapterId: 'copilot' } as AgentInfo]]);
    const d = { agents, router: { forAgent: (id: string) => (id === 'g1' ? adapter : undefined) } } as unknown as Pick<OpsDeps, 'agents' | 'router'>;
    const longQ = 'Which of these long-running approaches should I take? '.repeat(8).trim();
    assert.ok(longQ.length > 300 && longQ.length < 2000);
    assert.deepStrictEqual(answerQuestionOp(d, 'g1', 'r1', { [longQ]: 'my own' }), { ok: true });
    assert.deepStrictEqual(got.pop(), ['g1', 'r1', { [longQ]: 'my own' }], 'g: the answer to a question over 300 characters reaches the adapter');
    assert.deepStrictEqual(answerQuestionOp(d, 'g1', 'r2', null), { ok: true });
    assert.deepStrictEqual(got.pop(), ['g1', 'r2', null], 'g: null is a skip');
    for (const bad of [{ q: '' }, { q: '   ' }, {}, 'text', 5, undefined, { [`${'x'.repeat(20001)}`]: 'a' }]) {
      assert.strictEqual(answerQuestionOp(d, 'g1', 'r3', bad).ok, false, 'g: refused: ' + JSON.stringify(bad)?.slice(0, 30));
    }
    assert.strictEqual(got.length, 0, 'g: a refused answer never reaches the adapter as a skip');
    // one limit end to end (FR-178): exactly the cap passes, one over is refused with a reason and never reaches the adapter cut
    assert.strictEqual(MAX_ANSWER, 500);
    assert.deepStrictEqual(answerQuestionOp(d, 'g1', 'r4', { q: 'x'.repeat(MAX_ANSWER) }), { ok: true });
    assert.strictEqual((got.pop() as [string, string, Record<string, string>])[2].q.length, MAX_ANSWER, 'g: at the cap, whole');
    const over = answerQuestionOp(d, 'g1', 'r5', { q: 'x'.repeat(MAX_ANSWER + 1) });
    assert.ok(!over.ok && /too long: 500 characters at most/.test(over.error ?? ''), 'g: one over is refused with its reason: ' + JSON.stringify(over));
    assert.strictEqual(got.length, 0, 'g: nothing cut was sent');
    // the page's boxes use the same number: no literal in the card code, and the module is loaded as a page script
    const fsx = await import('fs');
    const appSrc = fsx.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'app.js'), 'utf8');
    assert.ok(!/maxLength=500\b/.test(appSrc) && (appSrc.match(/maxLength=window\.exports\.MAX_ANSWER/g) ?? []).length === 2, 'g: both answer boxes take the limit from MAX_ANSWER');
    assert.ok(/shared\/answerlimits\.js/.test(fsx.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.html'), 'utf8')), 'g: the limit is loaded in the page');
    assert.strictEqual(answerQuestionOp(d, 'nope', 'r', { q: 'a' }).ok, false);
    assert.strictEqual(answerQuestionOp(d, 'g1', 'r'.repeat(201), { q: 'a' }).ok, false);
  }
  // spec 003 FR-122, FR-126, FR-127 (T052): `opts.assisted` through the same `agents:setMode` call
  {
    const agents = new Map<string, AgentInfo>();
    const asked: Array<[string, unknown]> = [];
    let answer: { on: boolean; reason?: 'policy' | 'unsupported' | 'not-ask' } = { on: true };
    let live = true;
    let verified = true;
    const stub = (withCap: boolean): AgentAdapter => ({
      capabilities: withCap ? { assistedApproval: { verified } } : {},
      isLive: () => live,
      setPermMode: (_id: string, m: string) => { asked.push(['mode', m]); return { pending: 0 }; },
      setAssisted: async (_id: string, on: boolean) => { asked.push(['assisted', on]); return on ? answer : { on: false }; },
    }) as unknown as AgentAdapter;
    const copilot = stub(true);
    const by = new Map<string, AgentAdapter>();
    const mkA = (id: string, ad: AgentAdapter, mode: PermMode = 'ask'): AgentInfo => { const a = { id, name: id, cwd: WS + '-' + id, folders: [], permMode: mode, adapterId: 'copilot' } as AgentInfo; agents.set(id, a); by.set(id, ad); return a; };
    const rows: string[] = [];
    let remote = false;
    let org: string | undefined;
    const d: OpsDeps = { agents, router: { forAgent: (id) => by.get(id) }, wsKey: (a) => a.cwd, log: (_a, decision, action) => rows.push(`${decision}:${action}`), remoteOn: () => remote, orgAssistedRefusal: () => org };
    const a = mkA('c', copilot);
    // not a boolean: ignored, a plain mode change
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: 'yes' }), { ok: true, mode: 'ask', pending: 0 }, 'T052: a non-boolean assisted is ignored');
    assert.deepStrictEqual(asked.slice(), [['mode', 'ask']], 'T052: nothing asked of the reviewer');
    asked.length = 0; rows.length = 0;
    assert.deepStrictEqual(await setModeAssistedOp(d, 'nope', 'ask', { assisted: true }), { ok: false, error: 'unknown agent' });
    // on: the adapter's answer, one row, AgentInfo.assisted is only {on:true}
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: true, mode: 'ask', pending: 0, assisted: true }, 'T052: on');
    assert.deepStrictEqual(a.assisted, { on: true });
    assert.deepStrictEqual(rows.slice(), ['mode-change:Ask first to Ask first + review'], 'FR-122: one mode-change row');
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: true, mode: 'ask', pending: 0, assisted: true }, 'on again: nothing new');
    assert.strictEqual(rows.length, 1);
    // FR-126: a switch to Read-only turns it off (the adapter does the runtime) and the row says so; never restored on the way back
    assert.ok(setModeOp(d, 'c', 'read-only', {}).ok);
    assert.strictEqual(a.assisted, undefined, 'FR-126: Read-only turns it off');
    assert.strictEqual(rows[rows.length - 1], 'mode-change:Ask first + review to Read-only');
    assert.ok(setModeOp(d, 'c', 'ask', {}).ok);
    assert.strictEqual(a.assisted, undefined, 'FR-126: not restored on the way back');
    for (const m of ['allow', 'read-only'] as const) {
      a.permMode = 'ask'; a.assisted = { on: true };
      assert.ok(setModeOp(d, 'c', m, {}).ok);
      assert.strictEqual(a.assisted, undefined, `FR-126: ${m} turns it off`);
    }
    // outside Ask first, on Autopilot, with remote control, under the policy, not live, without the capability: refused, nothing asked
    asked.length = 0; rows.length = 0;
    a.permMode = 'allow';
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'allow', { assisted: true }), { ok: false, error: ASSISTED_NOT_ASK }, 'FR-120: Ask first only');
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: ASSISTED_NOT_ASK }, 'not a mode change and a turn-on in one');
    a.permMode = 'ask';
    a.autopilot = { limit: 5 };
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: ASSISTED_NOT_ASK }, 'FR-126: never on Autopilot');
    a.autopilot = undefined;
    remote = true;
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: ASSISTED_REMOTE }, 'FR-126 (C6): never with remote control');
    remote = false;
    org = 'Your organization turned off Copilot\'s assisted approvals. This session stays in Ask first.';
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: org }, 'FR-127: the policy refuses it first');
    org = undefined;
    live = false;
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: ASSISTED_NOT_RUNNING }, 'a session that is not running');
    live = true;
    // review finding 1 (C8): main refuses a turn-on while the app's capability is not verified (a real Copilot session today); off still works
    verified = false;
    const unv = stub(true);
    const u = mkA('u', unv);
    assert.deepStrictEqual(await setModeAssistedOp(d, 'u', 'ask', { assisted: true }), { ok: false, error: ASSISTED_UNVERIFIED }, 'C8: not verified: refused in main');
    assert.strictEqual(u.assisted, undefined);
    assert.deepStrictEqual(await setModeAssistedOp(d, 'u', 'ask', { assisted: false }), { ok: true, mode: 'ask', pending: 0, assisted: false }, 'C8: off is always allowed');
    verified = true;
    asked.length = 0;
    mkA('cl', stub(false));
    assert.deepStrictEqual(await setModeAssistedOp(d, 'cl', 'ask', { assisted: true }), { ok: false, error: NO_ASSISTED }, 'FR-121: Claude Code and Codex: not supported');
    assert.deepStrictEqual(asked.slice(), [], 'nothing was asked of an adapter');
    assert.deepStrictEqual(rows.slice(), [], 'and nothing logged');
    // the adapter's answer is believed: policy, unsupported, not-ask; a throw is unsupported
    for (const [ans, err] of [[{ on: false, reason: 'policy' }, ASSISTED_POLICY_LINE], [{ on: false, reason: 'unsupported' }, ASSISTED_UNSUPPORTED_LINE], [{ on: false, reason: 'not-ask' }, ASSISTED_NOT_ASK], [{ on: false }, ASSISTED_UNSUPPORTED_LINE]] as const) {
      answer = ans as typeof answer;
      assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: err, assisted: false }, `FR-123: ${JSON.stringify(ans)}`);
      assert.strictEqual(a.assisted, undefined);
    }
    by.set('c', { ...copilot, setAssisted: async () => { throw new Error('rpc boom'); } } as AgentAdapter);
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: ASSISTED_UNSUPPORTED_LINE, assisted: false }, 'a throw: off, the fixed line (not the error text)');
    by.set('c', copilot);
    // a mode change while the adapter was asked wins: off again
    answer = { on: true };
    asked.length = 0;
    const slow = { ...copilot, setAssisted: async (id: string, on: boolean) => { asked.push(['assisted', on]); if (on) a.permMode = 'read-only'; return on ? { on: true } : { on: false }; } } as AgentAdapter;
    by.set('c', slow);
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: false, error: ASSISTED_NOT_ASK }, 'a switch during the call wins');
    assert.deepStrictEqual(asked.slice(), [['assisted', true], ['assisted', false]], 'and the reviewer goes off again');
    assert.strictEqual(a.assisted, undefined);
    by.set('c', copilot);
    a.permMode = 'ask';
    // off: always allowed, one row only when it was on
    await setModeAssistedOp(d, 'c', 'ask', { assisted: true });
    rows.length = 0;
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: false }), { ok: true, mode: 'ask', pending: 0, assisted: false });
    assert.strictEqual(a.assisted, undefined);
    assert.deepStrictEqual(rows.slice(), ['mode-change:Ask first + review to Ask first'], 'FR-122: one row back');
    await setModeAssistedOp(d, 'c', 'ask', { assisted: false });
    assert.strictEqual(rows.length, 1, 'off when off: no row');
    // 2026-11-25 (T058, FR-129): the end of the session clears main's state, so a later turn-on asks the adapter again
    const ev = (x: Record<string, unknown>): AgentEvent => ({ sessionId: 'c', ts: 1, ...x }) as unknown as AgentEvent;
    await setModeAssistedOp(d, 'c', 'ask', { assisted: true });
    assert.deepStrictEqual(a.assisted, { on: true });
    rows.length = 0; asked.length = 0;
    assistedOnEvent(d, ev({ type: 'status', status: 'stopped', agentId: 'helper-1' }));
    assert.deepStrictEqual(a.assisted, { on: true }, 'T058: a helper that stops changes nothing');
    assistedOnEvent(d, ev({ type: 'status', status: 'idle' }));
    assistedOnEvent(d, ev({ type: 'status', status: 'stopped', sessionId: 'u' }));
    assert.deepStrictEqual(a.assisted, { on: true }, 'T058: another status or another session changes nothing');
    assistedOnEvent(d, ev({ type: 'status', status: 'stopped' }));
    assert.strictEqual(a.assisted, undefined, 'T058: stopped clears main\'s reviewer state');
    assert.deepStrictEqual(rows.slice(), [], 'T058: the end of a session writes no row');
    assert.deepStrictEqual(await setModeAssistedOp(d, 'c', 'ask', { assisted: true }), { ok: true, mode: 'ask', pending: 0, assisted: true }, 'T058: on again after the end');
    assert.deepStrictEqual(asked.slice(), [['assisted', true]], 'T058: a turn-on after the end asks the adapter (not the early "already on")');
    // FR-127: an off the user did not ask for: the policy line always, the plain off row only when it was on; an on event changes nothing
    rows.length = 0;
    assistedOnEvent(d, ev({ type: 'assisted', assisted: { on: true } }));
    assert.deepStrictEqual(a.assisted, { on: true }, 'FR-127: an on event changes nothing');
    assistedOnEvent(d, ev({ type: 'assisted' }));
    assert.strictEqual(a.assisted, undefined, 'FR-127: a fallback clears it');
    assert.deepStrictEqual(rows.slice(), ['mode-change:' + ASSISTED_OFF_ROW], 'FR-127: one off row while it was on');
    assistedOnEvent(d, ev({ type: 'assisted' }));
    assert.strictEqual(rows.length, 1, 'FR-127: no off row when it was already off');
    assistedOnEvent(d, ev({ type: 'assisted', reason: 'policy' }));
    assert.deepStrictEqual(rows.slice(1), ['mode-change:' + ASSISTED_POLICY_LINE], 'FR-127: the policy line always, also when it was off');
    assistedOnEvent(d, ev({ type: 'assisted', sessionId: 'nope' }));
  }
  console.log('agentops: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
