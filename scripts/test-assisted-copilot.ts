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
import { copilotReview, loadLookalike, lookalikeClean, managedHumanRequired } from '../src/adapters/copilotAssisted';
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
  // FR-124 (C5): the lookalike gate
  const lk = loadLookalike(LOOKALIKE_DIR);
  assert.ok(lk, 'the lookalike module loads from the renderer folder');
  assert.strictEqual(loadLookalike(path.join(ws, 'nothing-here')), undefined, 'missing: undefined (every request keeps its card)');
  assert.strictEqual(lookalikeClean(lk, 'run git status', 'shell'), true);
  assert.strictEqual(lookalikeClean(lk, 'run g\u0456t status', 'shell'), false, 'a Cyrillic letter in the program name');
  assert.strictEqual(lookalikeClean(lk, 'fetch https://xn--pple-43d.example/', 'url'), false, 'a punycode host');
  assert.strictEqual(lookalikeClean(undefined, 'run git status', 'shell'), false, 'not checked counts as a finding (FR-119)');
  assert.strictEqual(lookalikeClean({ check: () => { throw new Error('x'); } }, 'run ls', 'shell'), false, 'a check that throws counts as a finding');
  assert.strictEqual(lookalikeClean({ check: () => ({ findings: 'none' } as never) }, 'run ls', 'shell'), false, 'a malformed answer counts as a finding');

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

  // a request field of the runtime's own named `appReview` is never believed (the adapter builds the broker's fields itself)
  {
    const r = await rig();
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'x1', appReview: 'approve' })).card, 'switch off: a runtime `appReview` field approves nothing');
    await r.ad.setAssisted(r.sid, true);
    assert.ok((await ask(r, { kind: 'shell', fullCommandText: 'ls', toolCallId: 'x2', appReview: 'approve', assistedApproval: { recommendation: 'requireApproval' } })).card, 'switch on: only the verdict counts');
  }

  // C5: no lookalike module (a build without it): every judge approve keeps its card
  {
    const r = await rig();
    (r.ad as unknown as { lookalike: unknown }).lookalike = undefined;
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
