/**
 * Adapter contract suite (spec 012 FR-053, checks C1-C10). Adapter-agnostic: it only uses `AgentAdapter` and two hooks, and it
 * skips a check when the adapter's capabilities say the feature is absent, never by adapter name. T015 runs it on three
 * `FakeAdapter` setups; T016 runs it on `CopilotAdapter` with a fake client (scripts/fakes/copilot-sdk.ts). No session, no process, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { FakeAdapter } from '../src/adapters/fake';
import type { OptionalMember } from '../src/adapters/fake';
import { eventProblems } from '../src/adapters/eventguard';
import { EventMapper } from '../src/adapters/map';
import type { RawEvent } from '../src/adapters/map';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import type { ScriptEvent } from './fakes/copilot-sdk';
import type { PermissionLike } from '../src/adapters/permissions';
import type { AgentAdapter, AgentEvent, PermissionInfo, PermissionMode } from '../src/adapters/types';
import { PRODUCTION_DESCRIPTORS } from '../src/adapters/descriptors';
import { offeredDescriptors } from '../src/adapters/experimental';
import { CodexAdapter } from '../src/adapters/codex';
import { FakeCodexServer } from './fakes/codex-app-server';
import { ClaudeAdapter, claudeArgs } from '../src/adapters/claude';
import { createCliTransport } from '../src/adapters/claudeTransport';
import { fakeSpawn } from './fakes/claude-cli';
import type { FakeClaudeChild } from './fakes/claude-cli';

export type Outcome = 'approved' | 'denied';

export interface ContractHooks {
  /** Makes the adapter receive one runtime permission request for the session; resolves with the decision (in Ask first it waits for `resolvePermission`). */
  requestPermission(ad: AgentAdapter, sid: string, req: PermissionLike): Promise<Outcome>;
  /** Runs one scripted turn to its end (`working` ... `idle`). */
  turn(ad: AgentAdapter, sid: string): Promise<void>;
  /**
   * Set when the vendor decides reads itself and never asks the adapter (Codex: its sandbox profile, spec 012 D6). C6's "a read
   * inside the workspace is approved" cannot reach the adapter then; the check is reported as a named skip with this reason, never passed silently.
   */
  readsDecidedByVendor?: string;
}

export interface ContractTarget {
  ad: AgentAdapter;
  workspace: string;
}

export interface ContractReport {
  ran: string[];
  skipped: string[];
  usageEvents: number;
}

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const TYPES = new Set(['user', 'status', 'permission', 'grants', 'thinking', 'output', 'toolCall', 'subagent', 'usage', 'context', 'model', 'compaction', 'mcp', 'limit']);
const ALL_MODES: PermissionMode[] = ['read-only', 'ask', 'allow'];

/** Waits (a few event-loop turns at most) for something that must already be on its way. */
async function until<T>(what: string, f: () => T | undefined, ms = 1000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && (v as unknown) !== false) return v; // `false` means "not yet", like undefined (as in test-codex-adapter)
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** The promise must settle soon: a hang is a failure with a name instead of a stuck test run. */
async function settles<T>(what: string, p: Promise<T>, ms = 1000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new assert.AssertionError({ message: `${what}: still waiting after ${ms}ms` })), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runContract(name: string, make: () => ContractTarget, hooks: ContractHooks): Promise<ContractReport> {
  const report: ContractReport = { ran: [], skipped: [], usageEvents: 0 };
  const M = (c: string, m: string): string => `${name} ${c}: ${m}`;

  const fresh = () => {
    const t = make();
    const events: AgentEvent[] = [];
    // spec 010 T023: every event of every adapter passes the same shape check as the simulator's
    t.ad.onEvent((e) => {
      const p = eventProblems(e);
      assert.deepStrictEqual(p, [], M('event shape', `${e.type}: ${p.join(', ')}`));
      events.push(e);
    });
    let n = 0;
    const cap = t.ad.capabilities;
    return {
      ad: t.ad,
      ws: t.workspace,
      events,
      cap,
      file: path.join(t.workspace, 'a.txt'),
      req: (kind: string, extra: Partial<PermissionLike> = {}): PermissionLike => ({ kind, toolCallId: `${name}-call-${++n}`, ...extra }),
      write: (): PermissionLike => ({ kind: 'write', toolCallId: `${name}-call-${++n}`, fileName: path.join(t.workspace, 'a.txt') }),
      read: (): PermissionLike => ({ kind: 'read', toolCallId: `${name}-call-${++n}`, path: path.join(t.workspace, 'a.txt') }),
      start: (mode: PermissionMode | undefined, quiet = true) => t.ad.start({ workspace: t.workspace, permissionMode: mode, quiet }),
      pending: (): PermissionInfo | undefined => {
        const e = events.find((x): x is Extract<AgentEvent, { type: 'status' }> => x.type === 'status' && x.status === 'needs-permission' && x.permission?.state === 'pending');
        return e?.permission;
      },
      permissions: (): PermissionInfo[] => events.flatMap((e) => (e.type === 'permission' ? [e.permission] : [])),
    };
  };
  const ran = (c: string): void => void report.ran.push(c);
  const skip = (c: string, why: string): void => void report.skipped.push(`${c} (${why})`);

  // (C1) Identity
  {
    const { ad, cap } = fresh();
    assert.ok(ID_RE.test(ad.id), M('C1', 'the id matches the registry rule'));
    assert.ok(typeof ad.displayName === 'string' && ad.displayName.trim().length > 0, M('C1', 'displayName is set'));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(cap)), cap, M('C1', 'capabilities are plain JSON'));
    assert.ok(cap.permissionModes.includes('read-only'), M('C1', 'read-only is always declared (constitution III)'));
    ran('C1');
  }

  // (C2) Optional members and capabilities agree (FR-027)
  {
    const { ad, cap } = fresh();
    const has = (k: keyof AgentAdapter): boolean => typeof ad[k] === 'function';
    assert.strictEqual(has('interrupt'), cap.interrupt, M('C2', 'interrupt() <=> capabilities.interrupt'));
    assert.strictEqual(has('listModelOptions'), cap.models, M('C2', 'listModelOptions() <=> capabilities.models'));
    assert.strictEqual(has('listPreviousSessions'), cap.history, M('C2', 'listPreviousSessions() <=> capabilities.history'));
    assert.strictEqual(has('history'), cap.history, M('C2', 'history() <=> capabilities.history'));
    assert.strictEqual(has('setCap'), cap.caps, M('C2', 'setCap() <=> capabilities.caps'));
    assert.strictEqual(has('resolveLimit'), cap.caps, M('C2', 'resolveLimit() <=> capabilities.caps'));
    assert.strictEqual(has('setMcpEnabled'), cap.mcpToggle, M('C2', 'setMcpEnabled() <=> capabilities.mcpToggle'));
    assert.strictEqual(has('restartMcpServer'), !!cap.mcpRestart, M('C2', 'restartMcpServer() <=> capabilities.mcpRestart (spec 058 FR-012)'));
    if (cap.mcpRestart) assert.ok(cap.mcpToggle, M('C2', 'a per-server restart only exists where servers can be switched (spec 058 FR-012)'));
    assert.strictEqual(has('handoffSummary'), !!cap.handoff, M('C2', 'handoffSummary() <=> capabilities.handoff'));
    assert.strictEqual(has('generateText'), !!cap.oneShot, M('C2', 'generateText() <=> capabilities.oneShot'));
    assert.strictEqual(has('setRemote'), !!cap.remote, M('C2', 'setRemote() <=> capabilities.remote (spec 054 FR-001)'));
    assert.strictEqual(has('renameSession'), !!cap.renameSession, M('C2', 'renameSession() <=> capabilities.renameSession (spec 059 FR-007)'));
    assert.strictEqual(has('deleteSession'), !!cap.deleteSession, M('C2', 'deleteSession() <=> capabilities.deleteSession (spec 006 FR-028)'));
    assert.strictEqual(has('startMcpSignIn'), !!cap.mcpSignIn, M('C2', 'startMcpSignIn() <=> capabilities.mcpSignIn (spec 058 FR-064)'));
    if (has('cancelMcpSignIn')) assert.ok(cap.mcpSignIn, M('C2', 'cancelMcpSignIn() only with capabilities.mcpSignIn'));
    assert.ok(cap.mcpSignInSteps === undefined || (typeof cap.mcpSignInSteps === 'string' && cap.mcpSignInSteps.length > 0), M('C2', 'mcpSignInSteps is a non-empty string or missing'));
    assert.strictEqual(typeof cap.mcpSignIn, cap.mcpSignIn === undefined ? 'undefined' : 'boolean', M('C2', 'mcpSignIn is a boolean or missing'));
    assert.strictEqual(has('setPermMode'), cap.permModeSwitch !== 'none', M('C2', "setPermMode() <=> permModeSwitch !== 'none'"));
    ran('C2');
  }

  // (C3) Lifecycle
  {
    const t = fresh();
    const sid = await t.start('read-only', false);
    assert.ok(typeof sid === 'string' && sid.length > 0, M('C3', 'start resolves an id'));
    assert.ok(t.ad.isLive(sid), M('C3', 'the session is live after start'));
    const first = t.events[0];
    assert.ok(first && first.type === 'status' && first.status === 'idle', M('C3', 'the first event is status idle unless quiet'));
    const q = fresh();
    await q.start('read-only', true);
    assert.strictEqual(q.events.length, 0, M('C3', 'a quiet start emits nothing'));
    const beforeUnknown = t.events.length;
    await assert.rejects(() => t.ad.send('no-such-session', { text: 'hi' }), M('C3', 'send to an unknown id rejects'));
    assert.deepStrictEqual(t.events.slice(beforeUnknown), [], M('C3', 'send to an unknown id emits no event'));
    await t.ad.stop(sid);
    const last = t.events[t.events.length - 1];
    assert.ok(last.type === 'status' && last.status === 'stopped', M('C3', 'stop emits stopped last'));
    assert.strictEqual(t.ad.isLive(sid), false, M('C3', 'isLive turns false after stop'));
    await assert.rejects(() => t.ad.send(sid, { text: 'hi' }), M('C3', 'send to a stopped id rejects'));
    const before = t.events.length;
    await t.ad.stop(sid); // must not throw
    assert.strictEqual(t.events.length, before, M('C3', 'a second stop emits nothing'));
    const a = await t.start('read-only');
    const b = await t.start('read-only');
    assert.notStrictEqual(a, b, M('C3', 'two starts give two ids'));
    await t.ad.dispose();
    assert.ok(!t.ad.isLive(a) && !t.ad.isLive(b), M('C3', 'dispose leaves nothing live'));
    ran('C3');
  }

  // (C4) Every event, over a whole scenario; (C5) turn order
  {
    const t = fresh();
    const sid = await t.start('read-only', false);
    t.events.length = 0;
    await hooks.turn(t.ad, sid);
    const turn = [...t.events];
    assert.ok(turn.length > 0, M('C5', 'a turn emits events'));
    const firstWorking = turn.findIndex((e) => e.type === 'status' && e.status === 'working');
    assert.strictEqual(firstWorking, 0, M('C5', 'the turn starts with status working'));
    for (const [i, e] of turn.entries()) {
      if (e.type === 'output' || e.type === 'toolCall' || e.type === 'usage' || e.type === 'thinking') assert.ok(i > firstWorking, M('C5', `working comes before ${e.type}`));
    }
    const end = turn[turn.length - 1];
    assert.ok(end.type === 'status' && end.status === 'idle', M('C5', 'the turn ends with status idle'));
    for (const e of turn) {
      if (e.type !== 'usage') continue;
      report.usageEvents++;
      if (e.nanoAiu !== undefined) assert.ok(t.cap.usage.nanoAiu, M('C5', 'usage has no nanoAiu unless capabilities.usage.nanoAiu'));
      if (e.costUsd !== undefined) {
        assert.ok(t.cap.usage.costUsd, M('C5', 'usage has no costUsd unless capabilities.usage.costUsd'));
        assert.strictEqual(e.costBasis, 'estimate', M('C5', "costUsd comes with costBasis 'estimate'"));
      }
      if (e.inputTokens !== undefined || e.outputTokens !== undefined) assert.ok(t.cap.usage.tokens, M('C5', 'usage has no token counts unless capabilities.usage.tokens'));
    }
    ran('C5');
    // C4 on everything this session produced, plus a permission round and the stop
    const out = hooks.requestPermission(t.ad, sid, t.write());
    await settles(M('C4', 'a read-only write request'), out);
    await t.ad.stop(sid);
    const ids = new Set([sid]);
    for (const e of t.events) {
      assert.ok(ids.has(e.sessionId), M('C4', 'every event carries a known sessionId'));
      assert.strictEqual(typeof e.timestamp, 'number', M('C4', 'every event has a numeric timestamp'));
      assert.ok(TYPES.has(e.type), M('C4', `${String(e.type)} is a known event type`));
      const rec = e as unknown as Record<string, unknown>;
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(e)), M('C4', 'every event survives a JSON round trip'));
      const json = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
      for (const k of Object.keys(rec)) {
        const v = rec[k];
        if (v === undefined) continue;
        assert.ok(k in json && typeof v !== 'function' && typeof v !== 'symbol' && typeof v !== 'bigint' && !(v instanceof Map) && !(v instanceof Set), M('C4', `field ${k} survives a JSON round trip`));
      }
    }
    ran('C4');
  }

  // (C6) Modes (SC-004)
  {
    for (const mode of ALL_MODES) {
      const declared = fresh().cap.permissionModes.includes(mode);
      if (!declared) {
        const t = fresh();
        await assert.rejects(() => t.start(mode), M('C6', `starting in undeclared mode ${mode} is refused`));
        continue;
      }
      const t = fresh();
      const sid = await t.start(mode);
      if (!hooks.readsDecidedByVendor) assert.strictEqual(await settles(M('C6', `${mode}: read inside the workspace`), hooks.requestPermission(t.ad, sid, t.read())), 'approved', M('C6', `${mode}: a read inside the workspace is approved`));
      if (mode === 'read-only') {
        assert.strictEqual(await settles(M('C6', 'read-only: write'), hooks.requestPermission(t.ad, sid, t.write())), 'denied', M('C6', 'read-only: a write is denied'));
        assert.strictEqual(t.pending(), undefined, M('C6', 'read-only: a denied write leaves no pending state'));
      } else if (mode === 'allow') {
        assert.strictEqual(await settles(M('C6', 'allow: write'), hooks.requestPermission(t.ad, sid, t.write())), 'approved', M('C6', 'allow: a write is approved'));
        assert.strictEqual(t.pending(), undefined, M('C6', 'allow: no pending state'));
      } else {
        const p = hooks.requestPermission(t.ad, sid, t.write());
        const pend = await until('the pending state in ask', () => t.pending());
        assert.strictEqual(pend.state, 'pending', M('C6', 'ask: a write is pending'));
        if (t.ad.resolvePermission) {
          t.ad.resolvePermission(sid, pend.requestId, true);
          assert.strictEqual(await settles(M('C6', 'ask: approve'), p), 'approved', M('C6', 'ask: resolvePermission approves it'));
          assert.ok(t.permissions().some((x) => x.requestId === pend.requestId && x.state === 'approved'), M('C6', 'ask: a permission event says approved'));
        } else {
          skip('C6 ask approval', 'no resolvePermission');
          await t.ad.stop(sid);
          await settles(M('C6', 'ask: stop'), p);
        }
      }
      await t.ad.stop(sid);
    }
    if (hooks.readsDecidedByVendor) skip('C6 workspace read', hooks.readsDecidedByVendor);
    // an unknown mode behaves as Read-only
    const u = fresh();
    const sid = await u.ad.start({ workspace: u.ws, permissionMode: 'bogus' as unknown as PermissionMode, quiet: true });
    assert.strictEqual(await settles(M('C6', 'unknown mode: write'), hooks.requestPermission(u.ad, sid, u.write())), 'denied', M('C6', 'an unknown permissionMode behaves as Read-only'));
    ran('C6');
  }

  // (C7) A request still pending at stop is denied via 'stopped'
  if (fresh().cap.permissionModes.includes('ask')) {
    const t = fresh();
    const sid = await t.start('ask');
    const p = hooks.requestPermission(t.ad, sid, t.write());
    await until('the pending state', () => t.pending());
    await t.ad.stop(sid);
    assert.strictEqual(await settles(M('C7', 'a pending request at stop'), p), 'denied', M('C7', 'a pending request at stop resolves denied'));
    assert.ok(t.permissions().some((x) => x.state === 'denied' && x.via === 'stopped'), M('C7', "the decision says via 'stopped'"));
    ran('C7');
  } else skip('C7', 'ask not declared');

  // (C8) "Approve for this session" grants
  {
    const t = fresh();
    if (t.cap.permissionModes.includes('ask') && t.ad.resolvePermission && t.ad.revokeGrant) {
      const sid = await t.start('ask');
      const p1 = hooks.requestPermission(t.ad, sid, t.write());
      const pend = await until('the first pending state', () => t.pending());
      t.ad.resolvePermission(sid, pend.requestId, true, true);
      assert.strictEqual(await settles(M('C8', 'first request'), p1), 'approved', M('C8', 'the remembered request is approved'));
      const grants = [...t.events].reverse().find((e): e is Extract<AgentEvent, { type: 'grants' }> => e.type === 'grants');
      assert.ok(grants && grants.grants.length === 1, M('C8', 'approving for the session emits a grants event with one grant'));
      assert.strictEqual(await settles(M('C8', 'second request'), hooks.requestPermission(t.ad, sid, t.write())), 'approved', M('C8', 'the grant approves the next request without asking'));
      t.ad.revokeGrant(sid, grants.grants[0].key);
      const after = [...t.events].reverse().find((e): e is Extract<AgentEvent, { type: 'grants' }> => e.type === 'grants');
      assert.deepStrictEqual(after?.grants, [], M('C8', 'revokeGrant removes the grant'));
      t.events.length = 0;
      const p3 = hooks.requestPermission(t.ad, sid, t.write());
      await until('a pending state after revoke', () => t.pending());
      await t.ad.stop(sid);
      await settles(M('C8', 'third request'), p3);
      ran('C8');
    } else skip('C8', 'ask, resolvePermission or revokeGrant absent');
  }

  // (C9) A live mode switch to Read-only denies what is pending
  {
    const t = fresh();
    if (t.cap.permModeSwitch === 'live' && t.ad.setPermMode && t.cap.permissionModes.includes('ask')) {
      const sid = await t.start('ask');
      const p = hooks.requestPermission(t.ad, sid, t.write());
      await until('the pending state', () => t.pending());
      const r = t.ad.setPermMode(sid, 'read-only');
      assert.strictEqual(r.pending, 0, M('C9', 'nothing stays pending after the switch to Read-only'));
      assert.strictEqual(await settles(M('C9', 'the pending request'), p), 'denied', M('C9', 'switching Ask first to Read-only denies what is pending'));
      assert.strictEqual(await settles(M('C9', 'a later write'), hooks.requestPermission(t.ad, sid, t.write())), 'denied', M('C9', 'a later write is denied in Read-only'));
      await t.ad.stop(sid);
      ran('C9');
    } else skip('C9', "permModeSwitch is not 'live'");
  }

  // (C10) Interrupt keeps the session
  {
    const t = fresh();
    if (t.cap.interrupt && t.ad.interrupt) {
      const sid = await t.start('read-only');
      await t.ad.interrupt(sid);
      assert.ok(t.ad.isLive(sid), M('C10', 'the session stays live after interrupt'));
      t.events.length = 0;
      await hooks.turn(t.ad, sid);
      const end = t.events[t.events.length - 1];
      assert.ok(end.type === 'status' && end.status === 'idle', M('C10', 'a new turn still runs after interrupt'));
      await t.ad.stop(sid);
      ran('C10');
    } else skip('C10', 'interrupt not declared');
  }

  return report;
}

// ---- T015: the three FakeAdapter setups ----

// Every member FakeAdapter can omit. A Record, so the scripts build (`tsc -p tsconfig.scripts.json`, run by `npm test`) fails when `OptionalMember` gains a name not listed here.
const OMITTABLE: Record<OptionalMember, true> = {
  interrupt: true, resolvePermission: true, revokeGrant: true, setCap: true, resolveLimit: true, setMcpEnabled: true, setModel: true,
  cancelQueuedModel: true, compact: true, listModelOptions: true, listPreviousSessions: true, history: true, setPermMode: true,
  handoffSummary: true, generateText: true, deleteSession: true, renameSession: true, startMcpSignIn: true, cancelMcpSignIn: true,
  restartMcpServer: true,
};
export const ALL_OPTIONAL = Object.keys(OMITTABLE) as OptionalMember[];
/** Optional `AgentAdapter` members FakeAdapter does not implement (so it cannot omit them): fields, and methods no fake test needs yet. */
const NOT_IN_FAKE = [
  'debug', 'writeGuard', 'resolvePlan', 'answerQuestion', 'answerElicitation', 'listAgentProfiles', 'selectAgentProfile', 'setRemote',
  'authStatus', 'verifySignIn', 'refreshAuth', 'resumeIdOf',
];

/** The optional members of `interface AgentAdapter`, read from `src/adapters/types.ts` with the TypeScript parser (no hand-kept copy). */
export function interfaceOptionalMembers(): string[] {
  const file = path.join(__dirname, '..', '..', 'src', 'adapters', 'types.ts');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const decl = sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'AgentAdapter');
  assert.ok(decl, 'src/adapters/types.ts declares interface AgentAdapter');
  assert.strictEqual(decl.heritageClauses, undefined, 'AgentAdapter extends nothing (an inherited optional member would be missed here)');
  return decl.members.filter((m) => m.questionToken !== undefined && m.name !== undefined).map((m) => (m.name as ts.Identifier).text);
}

/** ALL_OPTIONAL plus NOT_IN_FAKE is exactly the interface's optional members, and the fakes really have or lack them. */
function checkOptionalLists(): void {
  const inIface = interfaceOptionalMembers();
  assert.ok(inIface.length > 0, 'the parser found optional members');
  const listed = [...ALL_OPTIONAL, ...NOT_IN_FAKE];
  assert.strictEqual(new Set(listed).size, listed.length, 'ALL_OPTIONAL and NOT_IN_FAKE do not overlap');
  const missing = inIface.filter((m) => !listed.includes(m));
  const stale = listed.filter((m) => !inIface.includes(m));
  assert.deepStrictEqual(missing, [], `optional AgentAdapter members in neither ALL_OPTIONAL (via FakeAdapter's OptionalMember) nor NOT_IN_FAKE: ${missing.join(', ')}`);
  assert.deepStrictEqual(stale, [], `listed but not optional members of AgentAdapter: ${stale.join(', ')}`);
  const fn = (ad: FakeAdapter, m: string): boolean => typeof (ad as unknown as Record<string, unknown>)[m] === 'function';
  const bare = new FakeAdapter({ omit: ALL_OPTIONAL });
  assert.deepStrictEqual(inIface.filter((m) => fn(bare, m)), [], 'fake-bare has no optional AgentAdapter method');
  const full = new FakeAdapter({ capabilities: { deleteSession: true, renameSession: 'any', mcpSignIn: true, mcpRestart: true } });
  assert.deepStrictEqual(ALL_OPTIONAL.filter((m) => !fn(full, m)), [], 'FakeAdapter implements every member in ALL_OPTIONAL');
  assert.deepStrictEqual(NOT_IN_FAKE.filter((m) => fn(full, m)), [], 'a member FakeAdapter implements belongs in OptionalMember, not NOT_IN_FAKE');
}
const SCRIPT = [
  { thinking: 'Considering' },
  { tool: 'ls', args: { path: '.' } },
  { usage: { model: 'fake-model', inputTokens: 3, outputTokens: 4, nanoAiu: 500, costUsd: 0.02 } },
  { output: 'Done.' },
];
const HOOKS: ContractHooks = {
  requestPermission: async (ad, sid, req) => ((await (ad as FakeAdapter).request(sid, req)).kind === 'approve-once' ? 'approved' : 'denied'),
  turn: (ad, sid) => ad.send(sid, { text: 'go' }),
};
const WS = path.join(os.tmpdir(), 'durbar-contract-ws');

async function main(): Promise<void> {
  checkOptionalLists();
  // Spec 058 FR-063: `mcpAuth` only on a failed toolCall that has an MCP server; FR-064: sign-in members behind the flag.
  {
    const base = { type: 'toolCall', sessionId: 's', timestamp: 1, callId: 'c', tool: 'mcp__notes__read' };
    assert.deepStrictEqual(eventProblems({ ...base, phase: 'failed', mcpServer: 'notes', mcpTool: 'read', mcpAuth: true }), [], 'mcpAuth on a failed MCP call passes');
    assert.deepStrictEqual(eventProblems({ ...base, phase: 'failed', mcpServer: 'notes' }), [], 'no mcpAuth passes');
    assert.ok(eventProblems({ ...base, phase: 'complete', mcpServer: 'notes', mcpAuth: true }).length > 0, 'mcpAuth on a completed call is refused');
    assert.ok(eventProblems({ ...base, phase: 'start', mcpServer: 'notes', mcpAuth: true }).length > 0, 'mcpAuth on a started call is refused');
    assert.ok(eventProblems({ ...base, phase: 'failed', mcpAuth: true }).length > 0, 'mcpAuth without mcpServer is refused');
    assert.ok(eventProblems({ ...base, phase: 'failed', mcpServer: '', mcpAuth: true }).length > 0, 'mcpAuth with an empty mcpServer is refused');
    assert.ok(eventProblems({ ...base, phase: 'failed', mcpServer: 'notes', mcpAuth: false }).length > 0, 'mcpAuth false is refused');
    assert.ok(eventProblems({ ...base, phase: 'failed', mcpServer: 'notes', mcpAuth: 'yes' }).length > 0, 'mcpAuth of another type is refused');
    const si = new FakeAdapter({ script: [], capabilities: { mcpSignIn: true } });
    assert.strictEqual(si.capabilities.mcpSignIn, true);
    assert.ok(si.startMcpSignIn && si.cancelMcpSignIn, 'sign-in members exist with the flag');
    const noCancel = new FakeAdapter({ script: [], capabilities: { mcpSignIn: true }, omit: ['cancelMcpSignIn'] });
    assert.ok(noCancel.startMcpSignIn && !noCancel.cancelMcpSignIn, 'cancel is optional');
    const off = new FakeAdapter({ script: [] });
    assert.ok(!off.startMcpSignIn && !off.cancelMcpSignIn && !('mcpSignIn' in off.capabilities) && !('mcpSignInSteps' in off.capabilities), 'no members and no fields without the flag');
    const omitted = new FakeAdapter({ script: [], capabilities: { mcpSignIn: true }, omit: ['startMcpSignIn'] });
    assert.ok(!omitted.startMcpSignIn && !omitted.capabilities.mcpSignIn, 'omitting startMcpSignIn forces the flag off');
    const sid = await si.start({ workspace: WS, permissionMode: 'read-only', quiet: true });
    assert.deepStrictEqual(await si.startMcpSignIn!(sid, 'notes'), { kind: 'browser', url: 'https://auth.example.test/authorize' });
    await si.cancelMcpSignIn!(sid, 'notes');
    assert.deepStrictEqual(si.signInCalls, [{ sessionId: sid, name: 'notes' }, { sessionId: sid, name: 'notes', cancel: true }]);
    await assert.rejects(() => si.startMcpSignIn!('nope', 'notes'), 'an unknown session is refused');
    await si.stop(sid);
  }

  const setups: Array<[string, () => FakeAdapter]> = [
    ['fake-full', () => new FakeAdapter({ script: SCRIPT })],
    ['fake-rename-any', () => new FakeAdapter({ script: SCRIPT, capabilities: { renameSession: 'any' } })],
    ['fake-rename-next', () => new FakeAdapter({ script: SCRIPT, capabilities: { renameSession: 'next-turn' } })],
    ['fake-signin', () => new FakeAdapter({ script: SCRIPT, capabilities: { mcpSignIn: true, mcpSignInSteps: 'In a terminal, run `fake login {name}`.' } })],
    ['fake-bare', () => new FakeAdapter({ script: SCRIPT, omit: ALL_OPTIONAL })],
    ['fake-readonly', () => new FakeAdapter({ script: SCRIPT, capabilities: { permissionModes: ['read-only'] } })],
  ];
  // FR-085: every contract run, by adapter name, so the end of main can count C6/C7 per registered adapter
  const reports = new Map<string, ContractReport>();
  for (const [name, mk] of setups) {
    const r = await runContract(name, () => ({ ad: mk(), workspace: WS }), HOOKS);
    reports.set(name, r);
    assert.ok(r.usageEvents > 0, `${name}: the scripted turn produced usage events, so C5 checked them`);
    console.log(`${name}: ran ${r.ran.join(' ')}; skipped ${r.skipped.length ? r.skipped.join(', ') : 'none'}`);
    if (name === 'fake-full') assert.strictEqual(r.skipped.length, 0, 'fake-full skips nothing');
    if (name === 'fake-bare') assert.ok(r.skipped.some((s) => s.startsWith('C10')) && r.skipped.some((s) => s.startsWith('C9')) && r.skipped.some((s) => s.startsWith('C8')), 'fake-bare skips C8, C9 and C10 by capability');
    if (name === 'fake-readonly') assert.ok(r.skipped.some((s) => s.startsWith('C7')), 'fake-readonly skips C7');
  }

  // ---- T016 (FR-056): the same suite on CopilotAdapter through its protected getClient() seam, with a fake client and a recorded turn
  {
    const fxDir = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'events');
    const reasoning = JSON.parse(fs.readFileSync(path.join(fxDir, 'auto-reasoning.json'), 'utf8')) as ScriptEvent[];
    const clients = new Map<AgentAdapter, FakeClient>();
    const dirs: string[] = [];
    const copilotMake = (): ContractTarget => {
      const client = new FakeClient();
      client.turnScript = reasoning;
      const ad = new FakeCopilot(client);
      clients.set(ad, client);
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-contract-copilot-'));
      dirs.push(workspace);
      return { ad, workspace };
    };
    const copilotHooks: ContractHooks = {
      requestPermission: async (ad, sid, req) => {
        const session = clients.get(ad)!.sessions.get(sid)!;
        const result = (await (session.config.onPermissionRequest as (r: unknown) => Promise<{ kind: string }>)(req)) as { kind: string };
        return result.kind === 'approve-once' ? 'approved' : 'denied';
      },
      turn: (ad, sid) => ad.send(sid, { text: 'go' }),
    };
    try {
      const r = await runContract('copilot', copilotMake, copilotHooks);
      reports.set('copilot', r);
      console.log(`copilot: ran ${r.ran.join(' ')}; skipped ${r.skipped.length ? r.skipped.join(', ') : 'none'}`);
      assert.deepStrictEqual(r.skipped, [], 'copilot skips nothing');
      assert.strictEqual(r.ran.length, 10, 'copilot runs C1-C10');
      assert.ok(r.usageEvents > 0, 'copilot: the replayed turn produced usage events, so C5 checked them');
      assert.ok(clients.size > 0);
      for (const ad of clients.keys()) assert.strictEqual((ad as unknown as { client?: unknown }).client, undefined, 'copilot: no real CopilotClient was created');
    } finally {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    }

    // ---- spec 012 T091 (FR-112): the same suite on ClaudeAdapter over the real CLI transport and a scripted fake `claude`
    {
      const children = new Map<string, FakeClaudeChild>(); // session id -> its fake CLI
      const claudeDirs: string[] = [];
      const toolFor = (req: PermissionLike): { name: string; input: Record<string, unknown> } => {
        switch (req.kind) {
          case 'read': return { name: 'Read', input: { file_path: req.path ?? req.fileName ?? '' } };
          case 'write': return { name: 'Write', input: { file_path: req.path ?? req.fileName ?? 'x.txt', content: 'x' } };
          case 'shell': return { name: 'Bash', input: { command: req.fullCommandText ?? 'ls' } };
          case 'url': return { name: 'WebFetch', input: { url: req.url ?? 'https://example.com' } };
          case 'mcp': return { name: `mcp__${req.serverName ?? 'srv'}__${req.toolName ?? 'tool'}`, input: {} };
          default: return { name: 'TodoWrite', input: {} };
        }
      };
      const claudeMake = (): ContractTarget => {
        const sp = fakeSpawn();
        sp.next = (c) => {
          c.onWrite = (o) => {
            const req = o.request as { subtype?: string } | undefined;
            if (o.type === 'control_request' && (req?.subtype === 'initialize' || req?.subtype === 'interrupt')) setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } }), 0);
            if (o.type === 'user' && !String(JSON.stringify(o.message)).includes('__warmup__')) {
              setTimeout(() => {
                c.send({ type: 'system', subtype: 'init', session_id: 's', cwd: '/', model: 'claude-haiku-5-5', permissionMode: 'default', tools: [], mcp_servers: [] });
                c.send({ type: 'assistant', message: { id: 'm' + Math.random(), role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 5, output_tokens: 1 } } });
                c.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0001, usage: { input_tokens: 5, output_tokens: 1 } });
              }, 0);
            }
          };
        };
        const ad = new ClaudeAdapter({
          claudePath: async () => '/usr/local/bin/claude',
          makeTransport: (x) => {
            const t = createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 5, killGraceMs: 5 });
            const sid = x.launch.sessionId;
            children.set(sid, sp.children[sp.children.length - 1]);
            return t;
          },
          sessionExists: () => false,
          claudeMd: () => undefined,
          env: () => ({}),
        });
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-contract-claude-'));
        claudeDirs.push(workspace);
        return { ad, workspace };
      };
      let reqN = 0;
      const claudeHooks: ContractHooks = {
        requestPermission: async (ad, sid, req) => {
          if (!children.has(sid)) {
            await ad.send(sid, { text: '__warmup__' }); // starts the CLI without a turn
            await until('claude child', () => children.get(sid));
          }
          const c = children.get(sid)!;
          const id = `contract-${++reqN}`;
          const t = toolFor(req);
          c.send({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: t.name, input: t.input, tool_use_id: req.toolCallId ?? id } });
          const reply = await until(`answer to ${id}`, () => c.objects().find((o) => o.type === 'control_response' && (o.response as { request_id: string }).request_id === id), 5000);
          return ((reply.response as { response: { behavior: string } }).response.behavior === 'allow') ? 'approved' : 'denied';
        },
        turn: async (ad, sid) => {
          const done = new Promise<void>((resolve) => {
            const off = ad.onEvent((e) => {
              if (e.sessionId === sid && e.type === 'status' && (e.status === 'idle' || e.status === 'error') && e.intent === undefined) {
                off();
                resolve();
              }
            });
          });
          await ad.send(sid, { text: 'go' });
          await done;
        },
      };
      try {
        const r = await runContract('claude', claudeMake, claudeHooks);
        reports.set('claude', r);
        console.log(`claude: ran ${r.ran.join(' ')}; skipped ${r.skipped.length ? r.skipped.join(', ') : 'none'}`);
        assert.ok(r.usageEvents > 0, 'claude: the scripted turn produced usage events, so C5 checked them');
      } finally {
        for (const d of claudeDirs) fs.rmSync(d, { recursive: true, force: true });
      }
    }

    // ---- FR-057 (spec 002 T020): the adapter's stream for a replayed fixture equals what EventMapper gives for the same events
    const strip = (e: unknown): unknown => {
      const { sessionId: _s, timestamp: _t, ...rest } = e as Record<string, unknown>;
      return rest;
    };
    for (const name of ['auto-reasoning', 'auto-subagent', 'mcp-tool-usage']) {
      const raw = JSON.parse(fs.readFileSync(path.join(fxDir, `${name}.json`), 'utf8')) as ScriptEvent[];
      const client = new FakeClient();
      client.turnScript = raw;
      const ad = new FakeCopilot(client);
      const got: AgentEvent[] = [];
      let stream: AgentEvent[] = [];
      ad.onEvent((e) => got.push(e));
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-fixture-copilot-'));
      try {
        const sid = await ad.start({ workspace: ws, quiet: true });
        await ad.send(sid, { text: 'go' });
        stream = [...got];
        await ad.dispose();
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
      assert.ok(stream.length > 1, `${name}: the replay produced events`);
      const first = stream[0];
      assert.ok(first.type === 'status' && first.status === 'working', `${name}: the adapter's own leading status working comes first`);
      const actual = stream.slice(1).map(strip);
      const want: unknown[] = [];
      const mapper = new EventMapper((b) => want.push(b));
      for (const ev of raw) mapper.map(ev as unknown as RawEvent);
      assert.ok(want.length > 0, `${name}: the mapper produced events`);
      assert.deepStrictEqual(actual, want.map(strip), `${name}: adapter stream equals EventMapper stream`);
      // The adapter and the reference both use EventMapper, so also pin one fact about the fixture itself: every reasoning delta reaches the stream as a thinking event.
      assert.strictEqual(actual.filter((e) => (e as { type: string }).type === 'thinking').length, raw.filter((e) => e.type === 'assistant.reasoning_delta').length, `${name}: one thinking event per reasoning delta`);
    }
  }

  // ---- T043a (FR-099): the same suite on CodexAdapter, with a scripted in-memory app-server (scripts/fakes/codex-app-server.ts).
  // platform and version are injected so C3 and C6 do not depend on the runner's OS or on a Codex install.
  {
    const fxDir = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'codex');
    const turn = JSON.parse(fs.readFileSync(path.join(fxDir, 'thread-turn.json'), 'utf8')) as { notifications: Array<{ method: string; params?: unknown }> };
    const servers = new Map<AgentAdapter, FakeCodexServer>();
    const dirs: string[] = [];
    const codexMake = (): ContractTarget => {
      const server = new FakeCodexServer({ turnScript: turn.notifications });
      const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: path.join(os.tmpdir(), 'fake-codex'), version: '0.163.0' }), platform: 'linux', env: {} });
      servers.set(ad, server);
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-contract-codex-'));
      dirs.push(workspace);
      return { ad, workspace };
    };
    const codexHooks: ContractHooks = {
      requestPermission: async (ad, sid, req) => {
        const server = servers.get(ad)!;
        const child = server.childOfThread(sid)!;
        if (req.kind !== 'write') throw new Error(`the Codex contract hook only sends writes, not ${req.kind}`);
        const rep = await server.serverRequest('item/fileChange/requestApproval', { threadId: sid, itemId: req.toolCallId, changes: [{ path: req.fileName }] }, child);
        return (rep.result as { decision?: string } | undefined)?.decision === 'accept' ? 'approved' : 'denied';
      },
      turn: async (ad, sid) => {
        await ad.send(sid, { text: 'go' });
        await servers.get(ad)!.flush();
      },
      readsDecidedByVendor: 'read decided by the Codex profile; settings asserted by test-sc004 FR-088',
    };
    try {
      const r = await runContract('codex', codexMake, codexHooks);
      reports.set('codex', r);
      console.log(`codex: ran ${r.ran.join(' ')}; skipped ${r.skipped.length ? r.skipped.join(', ') : 'none'}`);
      assert.strictEqual(r.ran.length, 9, 'codex runs C1-C8 and C10 (nine checks)');
      assert.ok(!r.ran.includes('C9'), 'codex does not run C9');
      assert.deepStrictEqual(
        r.skipped,
        ["C6 workspace read (read decided by the Codex profile; settings asserted by test-sc004 FR-088)", "C9 (permModeSwitch is not 'live')"],
        'codex skips exactly the named C6 workspace read (D6) and C9',
      );
      for (const ad of servers.keys()) await ad.dispose();
      for (const s of servers.values()) assert.deepStrictEqual(s.live, [], 'codex: no fake child is left running');
    } finally {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    }
  }

  // ---- FR-085 (spec 012 T026): C6 (modes) and C7 (stop denies pending) ran once for the fake and for every registered adapter, so a new adapter cannot skip them.
  // A registered or experimental adapter without a contract run above fails here: add its run when it is added.
  for (const id of ['fake-full', ...PRODUCTION_DESCRIPTORS.map((d) => d.id), ...offeredDescriptors({}).map((d) => d.id)]) {
    const r = reports.get(id);
    assert.ok(r, `FR-085: no contract run for the registered adapter ${id}`);
    for (const c of ['C6', 'C7']) assert.strictEqual(r.ran.filter((x) => x === c).length, 1, `FR-085: ${c} ran exactly once for ${id}`);
  }

  // FakeAdapter specifics the contract does not cover
  {
    const ad = new FakeAdapter({ omit: ['interrupt', 'listPreviousSessions'], capabilities: { usage: { tokens: true, costUsd: true, nanoAiu: true } } });
    assert.strictEqual(ad.capabilities.interrupt, false, 'omit interrupt forces the capability off');
    assert.strictEqual(ad.capabilities.history, false, 'omit listPreviousSessions forces capabilities.history off');
    assert.ok(!('interrupt' in ad) && !('history' in ad) && !('listPreviousSessions' in ad), 'an omitted member is not on the instance, and neither is its sibling');
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    const adU = new FakeAdapter({ script: [{ usage: { nanoAiu: 7, costUsd: 0.5 } }], capabilities: { usage: { tokens: true, costUsd: true, nanoAiu: true } } });
    adU.onEvent((e) => events.push(e));
    const sid = await adU.start({ workspace: WS, quiet: true });
    await adU.send(sid, { text: 'x' });
    const u = events.find((e) => e.type === 'usage');
    assert.ok(u && u.type === 'usage' && u.nanoAiu === 7 && u.costUsd === 0.5 && u.costBasis === 'estimate', 'declared usage figures pass through, with costBasis estimate');
    assert.strictEqual(adU.capabilities.usage.nanoAiu, true, 'a declared figure stays declared');
    const bare = new FakeAdapter({ id: 'x-1' });
    assert.strictEqual(bare.id, 'x-1');
    assert.strictEqual(await bare.start({ workspace: WS, sessionId: 'abc', quiet: true }), 'abc', 'sessionId is the session id');
    assert.strictEqual(await bare.start({ workspace: WS, sessionId: 'abc', resumeSessionId: 'zzz', quiet: true }), 'zzz', 'resumeSessionId wins');
    assert.strictEqual(await bare.start({ workspace: WS, quiet: true }), 'fake-1', 'otherwise fake-<n>');
    await bare.dispose();
  }
  console.log('adapter contract: ok');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
