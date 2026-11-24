/**
 * Spec 003 FR-120..FR-133 (T050, T051): Copilot's assisted approvals inside Ask first, on the fake Copilot SDK. No runtime, no account, no
 * credits; the request and event shapes are the SDK's own types (`read:` SDK 1.0.24 / runtime 1.0.101), never seen on a real session (T056).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeClient, FakeCopilot, LOOKALIKE_DIR } from './fakes/copilot-sdk';
import type { FakeSession } from './fakes/copilot-sdk';
import { COPILOT_CAPABILITIES } from '../src/adapters/copilot';
import { CLAUDE_CAPABILITIES, CLAUDE_SDK_CAPABILITIES } from '../src/adapters/claude';
import { CODEX_CAPABILITIES } from '../src/adapters/codex';
import { cardReviewable, copilotReview, loadCardCheck, managedHumanRequired } from '../src/adapters/copilotAssisted';
import { grantScope, summarize } from '../src/adapters/permissions';
import { eventProblems } from '../src/adapters/eventguard';
import type { AgentEvent } from '../src/adapters/types';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-assisted-'));
const tick = async (n = 6): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
type Decide = (req: unknown, inv?: unknown) => Promise<Record<string, unknown>>;
const APPROVE = { recommendation: 'approve', reason: 'JUDGE-TEXT-must-never-show', model: 'judge-model-x' };

interface Rig { ad: FakeCopilot; client: FakeClient; s: FakeSession; sid: string; events: AgentEvent[]; decide: Decide; debug: string[] }
async function rig(o: { mode?: 'ask' | 'allow' | 'read-only'; client?: FakeClient; resume?: string } = {}): Promise<Rig> {
  const client = o.client ?? new FakeClient();
  const ad = new FakeCopilot(client, undefined, { waitMs: 40 });
  const debug: string[] = [];
  ad.debug = (m: string) => debug.push(m);
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const sid = await ad.start({ workspace: ws, permissionMode: o.mode ?? 'ask', quiet: true, ...(o.resume ? { resumeSessionId: o.resume } : {}) });
  const s = client.last;
  return { ad, client, s, sid, events, debug, decide: s.config.onPermissionRequest as Decide };
}
const pending = (r: Rig): Array<Record<string, unknown>> => r.events.filter((e) => e.type === 'status' && e.permission?.state === 'pending').map((e) => (e as unknown as { permission: Record<string, unknown> }).permission);
const valid = (r: Rig): void => { for (const e of r.events) assert.deepStrictEqual(eventProblems(e), [], `event ${e.type} is valid: ${JSON.stringify(e)}`); };
const noJudgeText = (r: Rig): void => {
  const all = JSON.stringify(r.events) + r.debug.join('\n');
  assert.ok(!all.includes('JUDGE-TEXT') && !all.includes('judge-model-x') && !all.includes('RUNTIME-MESSAGE'), 'FR-130, FR-127: the judge\'s and the runtime\'s own text are never in an event or the debug log');
};
/** Asks one request and answers the card it gets (deny); returns the decision and the card, if any. */
async function ask(r: Rig, req: Record<string, unknown>, inv?: unknown): Promise<{ d: Record<string, unknown>; card?: Record<string, unknown> }> {
  const before = pending(r).length;
  const p = r.decide(req, inv);
  await tick();
  const card = pending(r).length > before ? pending(r)[pending(r).length - 1] : undefined;
  if (card) r.ad.resolvePermission(r.sid, String(card.requestId), false);
  return { d: await p, card };
}

async function main(): Promise<void> {
  process.exitCode = 1;
  // T048 / FR-121: the capability, Copilot only, not verified (C8)
  assert.deepStrictEqual({ ...COPILOT_CAPABILITIES.assistedApproval }, { verified: false }, 'FR-121, C8: Copilot offers it, not verified until T056');
  for (const [n, c] of [['Claude Code', CLAUDE_CAPABILITIES], ['Claude SDK', CLAUDE_SDK_CAPABILITIES], ['Codex', CODEX_CAPABILITIES]] as const) assert.strictEqual(c.assistedApproval, undefined, `FR-121: ${n} has no assisted approvals`);

  // FR-124: the verdict, normalized (pure)
  assert.deepStrictEqual(copilotReview(false, { assistedApproval: APPROVE }, undefined), { approve: false }, 'switch off: nothing');
  assert.deepStrictEqual(copilotReview(true, { assistedApproval: APPROVE }, undefined), { approve: true });
  assert.deepStrictEqual(copilotReview(true, {}, { kind: 'commands', assistedApproval: APPROVE }), { approve: true }, 'the prompt request\'s verdict when the raw one has none');
  assert.deepStrictEqual(copilotReview(true, { assistedApproval: { recommendation: 'requireApproval' } }, undefined), { approve: false, note: 'declined' });
  assert.deepStrictEqual(copilotReview(true, { assistedApproval: { recommendation: 'excluded' } }, undefined), { approve: false, note: 'never' });
  assert.deepStrictEqual(copilotReview(true, { assistedApproval: { recommendation: 'error', failureReason: 'timeout' } }, undefined), { approve: false, note: 'undecided' });
  for (const bad of [undefined, null, 'approve', { recommendation: 'Approve' }, { recommendation: 'approved' }, { recommendation: true }, {}, [APPROVE], { recommendation: ['approve'] }])
    assert.deepStrictEqual(copilotReview(true, { assistedApproval: bad }, undefined), { approve: false }, `FR-124: nothing from a malformed verdict ${JSON.stringify(bad)}`);
  assert.deepStrictEqual(copilotReview(true, Object.create({ assistedApproval: APPROVE }), undefined), { approve: false }, 'own properties only');
  // the managed-human marker (FR-124): the prompt's marker for the five kinds, else the raw one; any value but false means a human
  assert.strictEqual(managedHumanRequired({}, undefined), false);
  assert.strictEqual(managedHumanRequired({ managedApprovalRequired: true }, undefined), true);
  assert.strictEqual(managedHumanRequired({ managedApprovalRequired: 'yes' }, undefined), true, 'fail closed on a strange value');
  assert.strictEqual(managedHumanRequired({ managedApprovalRequired: true }, { kind: 'commands', managedApprovalRequired: false }), false, 'a clearable kind\'s prompt marker clears the raw one');
  assert.strictEqual(managedHumanRequired({ managedApprovalRequired: true }, { kind: 'mcp', managedApprovalRequired: false }), true, 'another kind keeps the raw marker');
  assert.strictEqual(managedHumanRequired({ managedApprovalRequired: true }, { kind: 'commands' }), true, 'no prompt marker: the raw one');
  assert.strictEqual(managedHumanRequired({}, { kind: 'read', managedApprovalRequired: true }), true);
  assert.strictEqual(managedHumanRequired({}, { kind: 'mcp', managedApprovalRequired: true }), true, 'a prompt marker always counts');
  for (const k of ['commands', 'read', 'write', 'url', 'workflow']) assert.strictEqual(managedHumanRequired({ managedApprovalRequired: true }, { kind: k, managedApprovalRequired: false }), false, k);
  assert.deepStrictEqual(copilotReview(true, { assistedApproval: APPROVE, managedApprovalRequired: true }, undefined), { approve: false }, 'FR-124: a managed marker keeps the card');
  // FR-124 (C5): the gate reads the card the window would draw (liveact.js permCard), every word of it
  const cc = loadCardCheck(LOOKALIKE_DIR);
  assert.ok(cc, 'the card helper loads from the renderer folder');
  assert.strictEqual(loadCardCheck(path.join(ws, 'nothing-here')), undefined, 'missing: undefined (every request keeps its card)');
  const card = (req: Record<string, unknown>) => { const sc = grantScope(req as never); const ps = ((req.paths as string[] | undefined) ?? [req.fileName as string]).filter(Boolean); return { summary: summarize(req as never), kind: String(req.kind), scopeKey: sc.key, scopeLabel: sc.label, ...(sc.broad ? { broadScopeKey: sc.broad.key, broadScopeLabel: sc.broad.label } : {}), paths: ps }; };
  const ok = (req: Record<string, unknown>) => cardReviewable(cc, card(req));
  assert.strictEqual(ok({ kind: 'shell', fullCommandText: 'git status' }), true);
  assert.strictEqual(ok({ kind: 'shell', fullCommandText: 'gіt status' }), false, 'a Cyrillic letter in the program name');
  assert.strictEqual(ok({ kind: 'url', url: 'https://xn--pple-43d.example/' }), false, 'a punycode host');
  // review of PR (finding 2a, probe P1): a command longer than the card shows is a blind card: never judge-approved, even with the letter past 10000 characters
  assert.strictEqual(ok({ kind: 'shell', fullCommandText: 'echo ' + 'a '.repeat(5200) + '; gіt push --force' }), false, 'P1: a cut (blind) card is never judge-approved');
  assert.strictEqual(ok({ kind: 'shell', fullCommandText: 'echo ' + 'a '.repeat(5200) }), false, 'P1: a cut card, even with no finding');
  // finding 2b, probe P4: the scope words and keys too, not only the summary: a write's second path under a Cyrillic-a folder
  assert.strictEqual(ok({ kind: 'write', fileName: path.join(ws, 'a.txt'), paths: [path.join(ws, 'a.txt'), path.join(ws, 'pаypal', 'b.txt')] }), false, 'P4: a second path in a lookalike folder');
  const five = ['a', 'b', 'c', 'd', 'pаypal'].map((d) => path.join(ws, d, 'x.txt'));
  assert.strictEqual(ok({ kind: 'write', fileName: five[0], paths: five }), false, 'a lookalike folder past the three a label names (the raw key and paths are read)');
  assert.strictEqual(ok({ kind: 'write', fileName: path.join(ws, 'a.txt'), paths: [path.join(ws, 'a.txt'), path.join(ws, 'docs', 'b.txt')] }), true, 'two plain folders: reviewable');
  assert.strictEqual(ok({ kind: 'mcp', serverName: 'gh', toolName: 'crеate_issue' }), false, 'an MCP tool name');
  // owner decision (2026-11-24, C5 extended): a card that warns about control or bidi characters is always a card (review round 2 probes)
  assert.strictEqual(ok({ kind: 'shell', fullCommandText: 'echo \u001b]0;x\u0007 hi' }), false, 'C5: control characters shown as markers: a card');
  assert.strictEqual(ok({ kind: 'shell', fullCommandText: 'echo safe \u202etxt.exe' }), false, 'C5: a right-to-left override (U+202E): a card');
  assert.strictEqual(ok({ kind: 'shell', fullCommandText: 'echo \u001b[8mhidden\u001b[0m ok' }), false, 'C5: ESC[8m (concealed text): a card');
  assert.strictEqual(ok({ kind: 'write', fileName: path.join(ws, 'a.txt'), paths: [path.join(ws, 'a.txt'), path.join(ws, 'b\u200bc.txt')] }), false, 'C5: a zero-width character in a second path only: a card');
  // review round 2 (mutants N4, N5, N6): the lookalike in ONE input only, the others clean
  const base = { summary: 'run git status', kind: 'shell', scopeKey: 'shell-exact:git status', scopeLabel: 'run git status', broadScopeKey: 'shell:git', broadScopeLabel: 'run git (any arguments)', paths: [] as string[] };
  assert.strictEqual(cardReviewable(cc, base), true, 'the clean card is reviewable');
  assert.strictEqual(cardReviewable(cc, { ...base, scopeKey: 'shell-exact:g\u0456t status' }), false, 'N12 layer: the scope key alone');
  assert.strictEqual(cardReviewable(cc, { ...base, broadScopeKey: 'shell:g\u0456t' }), false, 'N5: the broad key alone');
  const wbase = { summary: 'write ' + path.join(ws, 'a.txt'), kind: 'write', scopeKey: 'write:' + ws, scopeLabel: 'write in ' + path.basename(ws) + '/', paths: [path.join(ws, 'a.txt')] };
  assert.strictEqual(cardReviewable(cc, wbase), true, 'a clean write is reviewable');
  assert.strictEqual(cardReviewable(cc, { ...wbase, paths: [path.join(ws, 'a.txt'), path.join(ws, 'p\u0430ypal', 'b.txt')] }), false, 'N4: the paths alone');
  // N6: a lookalike check that fails on one part only (its look is `unchecked`) keeps the card; the same text with a working check is reviewable
  {
    const cafe = { ...wbase, paths: [path.join(ws, 'a.txt'), path.join(ws, 'caf\u00e9', 'b.txt')] };
    assert.strictEqual(cardReviewable(cc, cafe), true, 'N6: a plain accented folder is reviewable with a working check');
    const lkPath = require.resolve(path.join(LOOKALIKE_DIR, 'lookalike.js'));
    const entry = require.cache[lkPath]!;
    const real = entry.exports as { check: (t: string, k: string) => unknown };
    entry.exports = { ...real, check: (t: string, k: string) => { if (t.includes('caf\u00e9')) throw new Error('stub'); return real.check(t, k); } };
    try {
      assert.strictEqual(cardReviewable(cc, cafe), false, 'N6: a part whose lookalike check failed (look unchecked) keeps the card');
      assert.strictEqual(cardReviewable(cc, wbase), true, 'N6: the stub fails only that part');
    } finally {
      entry.exports = real;
    }
  }
  assert.strictEqual(cardReviewable(undefined, card({ kind: 'shell', fullCommandText: 'git status' })), false, 'not checked counts as a finding (FR-119)');
  assert.strictEqual(cardReviewable({ reviewable: () => { throw new Error('x'); } }, card({ kind: 'shell', fullCommandText: 'ls' })), false, 'a check that throws counts as a finding');
  assert.strictEqual(cardReviewable({ reviewable: () => 'yes' as never }, card({ kind: 'shell', fullCommandText: 'ls' })), false, 'only true counts');

  // FR-128: at start the runtime's mode is read; `manual` is left alone
  {
    const r = await rig();
    assert.deepStrictEqual(r.s.permCalls, [{ name: 'getMode' }], 'FR-128: getMode after create, nothing set when manual');
    // FR-123: on only when the runtime answers `assisted`; the judge model is never sent (C2)
    assert.deepStrictEqual(await r.ad.setAssisted(r.sid, true), { on: true });
    assert.deepStrictEqual(r.s.permCalls.slice(1), [{ name: 'setMode', mode: 'assisted' }], 'FR-123: setMode assisted, no model');
    // FR-124, FR-125: a judge `approve` gives one attributed approval, the app/classifier tag, no card
    const d = await r.decide({ kind: 'shell', fullCommandText: 'git status', toolCallId: 't1', assistedApproval: APPROVE });
    assert.deepStrictEqual(d, { kind: 'attributed', result: { kind: 'approve-once' }, decisionContext: { outcome: 'auto_approved', source: 'assisted_approval', surface: 'sdk' } }, 'FR-125: createAttributedPermissionResult with assisted_approval');
    const tag = r.events.find((e) => e.type === 'permission' && e.permission.requestId === 't1') as { permission: Record<string, unknown> } | undefined;
    assert.deepStrictEqual({ via: tag?.permission.via, allowedBy: tag?.permission.allowedBy }, { via: 'app-review', allowedBy: { kind: 'app', source: 'classifier' } });
    assert.strictEqual(pending(r).length, 0, 'no card');
    // the verdict on the prompt request (the handler's second argument) counts too
    assert.strictEqual((await r.decide({ kind: 'shell', fullCommandText: 'git log', toolCallId: 't1b' }, { promptRequest: { kind: 'commands', assistedApproval: APPROVE } })).kind, 'attributed');
    // the three other verdicts: a card with the closed word (FR-130)
    for (const [rec, word] of [['requireApproval', 'declined'], ['excluded', 'never'], ['error', 'undecided']] as const) {
      const x = await ask(r, { kind: 'shell', fullCommandText: 'rm -rf build', toolCallId: 'v-' + rec, assistedApproval: { recommendation: rec, reason: 'JUDGE-TEXT' } });
      assert.strictEqual(x.card?.review, word, `FR-130: ${rec} reads ${word}`);
      assert.deepStrictEqual(x.d, { kind: 'reject', feedback: 'Denied by user in Agent Durbar.' }, 'a card the user answered goes back as before (no attribution)');
    }
    // no verdict at all: a plain card
    const nv = await ask(r, { kind: 'shell', fullCommandText: 'make', toolCallId: 'v-none' });
    assert.ok(nv.card && nv.card.review === undefined, 'no verdict: a plain card');
    // the managed-human marker keeps the card
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'git push', toolCallId: 'm1', assistedApproval: APPROVE, managedApprovalRequired: true })).card, 'FR-124: managed marker: a card');
    assert.ok((await ask(r, { kind: 'mcp', serverName: 'gh', toolName: 'merge', toolCallId: 'm2', assistedApproval: APPROVE }, { promptRequest: { kind: 'mcp', managedApprovalRequired: true } })).card, 'FR-124: the prompt request\'s marker: a card');
    assert.strictEqual((await r.decide({ kind: 'shell', fullCommandText: 'git fetch', toolCallId: 'm3', assistedApproval: APPROVE, managedApprovalRequired: true }, { promptRequest: { kind: 'commands', managedApprovalRequired: false } })).kind, 'attributed', 'a commands prompt that cleared the marker');
    // FR-132 (C5): lookalike letters in the program name keep the card
    const lka = await ask(r, { kind: 'shell', fullCommandText: 'g\u0456t push --force', toolCallId: 'l1', assistedApproval: APPROVE });
    assert.ok(lka.card, 'FR-132: a judge approve on a request with a Cyrillic letter in the program name gives a pending card');
    // review findings 2a and 2b through the adapter (probes P1, P4): a cut command and a write's second path in a lookalike folder keep their cards
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'echo ' + 'a '.repeat(5200) + '; g\u0456t push --force', toolCallId: 'P1', assistedApproval: APPROVE })).card, 'P1: a long command with a lookalike past 10000 characters gets a card');
    assert.ok((await ask(r, { kind: 'write', fileName: path.join(ws, 'a.txt'), paths: [path.join(ws, 'a.txt'), path.join(ws, 'p\u0430ypal', 'b.txt')], toolCallId: 'P4', assistedApproval: APPROVE })).card, 'P4: a second path under a Cyrillic-a folder gets a card');
    // a read outside the folders keeps its card (C5)
    assert.ok((await ask(r, { kind: 'read', path: path.join(os.tmpdir(), 'elsewhere-' + process.pid, 'secret.txt'), toolCallId: 'o1', assistedApproval: APPROVE })).card, 'C5: an outside read keeps its card');
    valid(r);
    noJudgeText(r);
    // FR-126: a switch away from Ask first turns it off first (runtime manual); never restored on the way back
    r.ad.setPermMode(r.sid, 'read-only');
    await tick();
    assert.deepStrictEqual(r.s.permCalls[r.s.permCalls.length - 1], { name: 'setMode', mode: 'manual' }, 'FR-126: Read-only sets the runtime back to manual');
    assert.strictEqual((await r.decide({ kind: 'shell', fullCommandText: 'git status', toolCallId: 'ro1', assistedApproval: APPROVE })).kind, 'reject', 'Read-only denies, the verdict is ignored');
    r.ad.setPermMode(r.sid, 'ask');
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'git status', toolCallId: 'back1', assistedApproval: APPROVE })).card, 'FR-126: back in Ask first the reviewer is off: a card');
    assert.ok(!r.s.permCalls.some((c) => c.mode === 'allow-all'), 'never the runtime\'s allow-all');
  }

  // Allow all: the switch is refused (not-ask) and nothing is set; switching to Allow all turns it off
  {
    const r = await rig({ mode: 'allow' });
    assert.deepStrictEqual(await r.ad.setAssisted(r.sid, true), { on: false, reason: 'not-ask' });
    assert.deepStrictEqual(r.s.permCalls, [{ name: 'getMode' }], 'nothing set in Allow all');
    const q = await rig();
    await q.ad.setAssisted(q.sid, true);
    q.ad.setPermMode(q.sid, 'allow');
    await tick();
    assert.strictEqual(q.s.permMode, 'manual', 'FR-126: Allow all turns it off first (Durbar\'s broker stays Allow all)');
    assert.deepStrictEqual(await q.ad.setAssisted('no-such', true), { on: false, reason: 'not-ask' }, 'an unknown session');
  }

  // FR-123, FR-127: an answer other than `assisted` is the organization's block; a missing, failed or late call leaves it off and is not retried
  {
    const r = await rig();
    r.s.permAnswer = 'manual';
    assert.deepStrictEqual(await r.ad.setAssisted(r.sid, true), { on: false, reason: 'policy' }, 'FR-127: the runtime stayed manual');
    r.s.permAnswer = undefined;
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'p1', assistedApproval: APPROVE })).card, 'off: a card');
    const old = await rig();
    delete (old.s.rpc as Record<string, unknown>).permissions;
    assert.deepStrictEqual(await old.ad.setAssisted(old.sid, true), { on: false, reason: 'unsupported' }, 'FR-123: an older runtime has no such call');
    const failing = await rig();
    failing.s.permSetFail = 'boom';
    assert.deepStrictEqual(await failing.ad.setAssisted(failing.sid, true), { on: false, reason: 'unsupported' }, 'a failed call');
    assert.strictEqual(failing.s.permCalls.filter((c) => c.mode === 'assisted').length, 1, 'never retried silently');
    const late = await rig();
    late.s.permHangs = true;
    assert.deepStrictEqual(await late.ad.setAssisted(late.sid, true), { on: false, reason: 'unsupported' }, 'no answer in time');
    assert.strictEqual(late.s.permCalls.filter((c) => c.mode === 'assisted').length, 1, 'not retried');
    assert.ok((await ask(late, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'p2', assistedApproval: APPROVE })).card, 'a late runtime is not believed: a card');
    // a mode switch while the turn-on was asked wins
    const race = await rig();
    let release: () => void = () => undefined;
    const set0 = (race.s.rpc.permissions as { setMode: (a: unknown) => Promise<unknown> }).setMode;
    (race.s.rpc.permissions as { setMode: (a: unknown) => Promise<unknown> }).setMode = async (a: unknown) => { if ((a as { mode: string }).mode === 'assisted') await new Promise<void>((res) => { release = res; }); return set0(a); };
    const on = race.ad.setAssisted(race.sid, true);
    await tick();
    race.ad.setPermMode(race.sid, 'read-only');
    release();
    assert.deepStrictEqual(await on, { on: false, reason: 'not-ask' }, 'a switch to Read-only while asked: off');
    await tick();
    assert.strictEqual(race.s.permMode, 'manual', 'and the runtime is back to manual');
  }

  // FR-127 (T051): live fallbacks turn it off once, with no runtime text; the session goes on in plain Ask first
  for (const how of ['permissions_changed', 'managed_settings_enforced'] as const) {
    const r = await rig();
    await r.ad.setAssisted(r.sid, true);
    if (how === 'permissions_changed') { r.s.permMode = 'manual'; r.s.fire('session.permissions_changed', { mode: 'manual', previousMode: 'assisted' }); }
    else r.s.fire('session.managed_settings_enforced', { action: 'blocked', escalation: 'assisted_approval', failClosed: false, message: 'RUNTIME-MESSAGE', setting: 'permissions.disableAssistedPermissionsMode' });
    const off = r.events.filter((e) => e.type === 'assisted');
    assert.deepStrictEqual(off.map((e) => ({ ...e, timestamp: 0 })), [{ type: 'assisted', sessionId: r.sid, timestamp: 0, reason: 'policy' }], `${how}: one assisted event, policy`);
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'git status', toolCallId: 'f1', assistedApproval: APPROVE })).card, `${how}: every later request gets a card`);
    r.s.fire('session.managed_settings_enforced', { action: 'blocked', escalation: 'assisted_approval', failClosed: false, message: 'RUNTIME-MESSAGE', setting: 'x' });
    assert.strictEqual(r.events.filter((e) => e.type === 'assisted').length, 1, 'said once');
    valid(r);
    noJudgeText(r);
  }
  {
    // the switch off: a managed_settings_enforced for another escalation, or a permissions_changed Durbar asked for, is nothing
    const r = await rig();
    r.s.fire('session.managed_settings_enforced', { action: 'blocked', escalation: 'bypass_permissions', failClosed: false, message: 'RUNTIME-MESSAGE', setting: 'permissions.disableBypassPermissionsMode' });
    await r.ad.setAssisted(r.sid, true);
    await r.ad.setAssisted(r.sid, false);
    assert.strictEqual(r.events.filter((e) => e.type === 'assisted').length, 0, 'nothing said for Durbar\'s own changes or another escalation');
    assert.strictEqual(r.s.permMode, 'manual', 'off: setMode manual');
    // a mode Durbar never asked for (allow-all) is set back to manual, with a code in the debug log
    r.s.permMode = 'allow-all';
    r.s.fire('session.permissions_changed', { mode: 'allow-all', previousMode: 'manual' });
    await tick();
    assert.strictEqual(r.s.permMode, 'manual', 'FR-128: an unasked allow-all is set back to manual');
    assert.ok(r.debug.includes('assisted: runtime-mode-unasked'), 'one debug code, no text');
    // and with the switch on, the session's reviewer goes off (no policy word)
    await r.ad.setAssisted(r.sid, true);
    r.s.permMode = 'allow-all';
    r.s.fire('session.permissions_changed', { mode: 'allow-all', previousMode: 'assisted' });
    await tick();
    assert.deepStrictEqual(r.events.filter((e) => e.type === 'assisted').map((e) => (e as { reason?: string }).reason), [undefined], 'off, not called the organization');
    assert.strictEqual(r.s.permMode, 'manual');
    valid(r);
  }

  // FR-128, FR-129: a resumed session that comes back in another mode is set to manual; the switch is off after a resume
  {
    const client = new FakeClient();
    client.onDisk.add('old-1');
    client.resumePermMode = 'assisted';
    const r = await rig({ client, resume: 'old-1' });
    assert.deepStrictEqual(r.s.permCalls, [{ name: 'getMode' }, { name: 'setMode', mode: 'manual' }], 'FR-128: getMode, then manual, before the start returns');
    assert.ok(r.debug.includes('assisted: runtime-mode-reset'), 'a debug code');
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'r1', assistedApproval: APPROVE })).card, 'FR-129: the switch is off after a resume');
    // an older runtime: no getMode, the start goes on
    const c2 = new FakeClient();
    const ad2 = new FakeCopilot(c2, undefined, { waitMs: 40 });
    const orig = c2.createSession.bind(c2);
    c2.createSession = async (cfg) => { const s = await orig(cfg); delete (s.rpc as Record<string, unknown>).permissions; return s; };
    assert.ok(await ad2.start({ workspace: ws, permissionMode: 'ask', quiet: true }), 'an older runtime starts');
  }

  // review finding 3 (probe P2): a getMode that throws, or none beside a setMode, still sets the runtime to manual before the start returns
  for (const how of ['throws', 'missing', 'late'] as const) {
    const client = new FakeClient();
    const orig = client.createSession.bind(client);
    client.createSession = async (cfg) => {
      const s = await orig(cfg);
      s.permMode = 'allow-all';
      const perms = s.rpc.permissions as Record<string, unknown>;
      if (how === 'throws') perms.getMode = async () => { throw new Error('x'); };
      else if (how === 'missing') delete perms.getMode;
      else perms.getMode = () => new Promise(() => undefined);
      return s;
    };
    const r = await rig({ client });
    assert.strictEqual(r.s.permMode, 'manual', `P2 (${how}): the runtime is set to manual anyway`);
    assert.deepStrictEqual(r.s.permCalls.filter((c) => c.name === 'setMode'), [{ name: 'setMode', mode: 'manual' }], `P2 (${how}): one bounded manual reset`);
  }

  // review finding 1 (C8, defence in depth): the adapter itself refuses a turn-on while `assistedApproval.verified` is false
  {
    const r = await rig();
    (r.ad as unknown as { assistedUnverifiedOk: boolean }).assistedUnverifiedOk = false;
    assert.deepStrictEqual(await r.ad.setAssisted(r.sid, true), { on: false, reason: 'unsupported' }, 'C8: not verified: the adapter refuses');
    assert.ok(!r.s.permCalls.some((c) => c.mode === 'assisted'), 'C8: nothing asked of the runtime');
    assert.deepStrictEqual(await r.ad.setAssisted(r.sid, false), { on: false }, 'off still works');
  }

  // a request field of the runtime's own named `appReview` is never believed (the adapter builds the broker's fields itself)
  {
    const r = await rig();
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'x1', appReview: 'approve' })).card, 'switch off: a runtime `appReview` field approves nothing');
    await r.ad.setAssisted(r.sid, true);
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'x2', appReview: 'approve', assistedApproval: { recommendation: 'requireApproval' } })).card, 'switch on: only the verdict counts');
  }

  // review round 2 (mutant N12): the adapter hands the gate the card the broker builds, its scope key and label included
  {
    const r = await rig();
    await r.ad.setAssisted(r.sid, true);
    const seen: Array<Record<string, unknown>> = [];
    const realCc = (r.ad as unknown as { cardCheck: { reviewable: (p: Record<string, unknown>, m: unknown) => boolean } }).cardCheck;
    (r.ad as unknown as { cardCheck: unknown }).cardCheck = { reviewable: (p: Record<string, unknown>, m: unknown) => { seen.push(p); return realCc.reviewable(p, m); } };
    const req = { kind: 'shell', fullCommandText: 'git status', toolCallId: 'k1', assistedApproval: APPROVE };
    await r.decide(req);
    const sc = grantScope(req as never);
    assert.deepStrictEqual({ scopeKey: seen[0]?.scopeKey, scopeLabel: seen[0]?.scopeLabel, broadScopeKey: seen[0]?.broadScopeKey, summary: seen[0]?.summary }, { scopeKey: sc.key, scopeLabel: sc.label, broadScopeKey: sc.broad?.key, summary: 'run git status' }, 'N12: the gate sees the scope key and label the card gets');
  }

  // C5: no lookalike module (a build without it): every judge approve keeps its card
  {
    const r = await rig();
    (r.ad as unknown as { cardCheck: unknown }).cardCheck = undefined;
    await r.ad.setAssisted(r.sid, true);
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'git status', toolCallId: 'u1', assistedApproval: APPROVE })).card, 'C5, FR-119: a request that could not be checked keeps its card');
  }

  fs.rmSync(ws, { recursive: true, force: true });
  process.exitCode = 0;
  console.log('assisted-copilot: all checks passed');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
