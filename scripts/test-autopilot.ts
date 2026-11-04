/**
 * Spec 099 Phase 1 (T010-T014): the Autopilot core, its types and its event guard. `npm run test:autopilot`.
 * Pure: no Electron, no network, no credits, no timers (the clock is injected; waits are on promises).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  AUTOPILOT_ANSWER, AUTOPILOT_ENDS, AutopilotRun, DEFAULT_HOURS, DEFAULT_LIMIT, codexGoalEnd, goalText, hoursOrDefault, isClaudeContinuation, limitOrDefault,
} from '../src/adapters/autopilot';
import * as core from '../src/adapters/autopilot';
import { claudeHistoryFromText, parseSessionHead } from '../src/adapters/claudeHistory';
import type { AutopilotRunEvent } from '../src/adapters/autopilot';
import { CLAUDE_DESCRIPTOR } from '../src/adapters/claude';
import { CODEX_DESCRIPTOR } from '../src/adapters/codex';
import { COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { eventProblems } from '../src/adapters/eventguard';
import type { PermissionMode } from '../src/adapters/capabilities';
import type { AutopilotEnd } from '../src/adapters/types';
import type { PermMode } from '../src/shared/api';
import type { OrgMode } from '../src/shared/orgpolicy';
import { validMode } from '../src/main/agentops';
import { stripComments } from './ipc-channel-list';

const ROOT = path.join(__dirname, '..', '..');
const src = (f: string): string => stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));
const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));

// ---- 1. default stays read-only; the three mode types are unchanged (compile time) ----
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const modesUnchanged: [Same<PermMode, 'read-only' | 'ask' | 'allow'>, Same<PermissionMode, 'read-only' | 'ask' | 'allow'>, Same<OrgMode, 'read-only' | 'ask' | 'allow'>] = [true, true, true];
assert.deepStrictEqual(modesUnchanged, [true, true, true]);
assert.strictEqual(validMode('autopilot'), 'read-only', 'autopilot is not a mode: it falls back to read-only');
assert.strictEqual(validMode(undefined), 'read-only');
assert.strictEqual(validMode('allow'), 'allow');

// ---- 2. never saved or defaulted (a source-text check: two files do not mention autopilot; it shows no behaviour, section 3 pins the file list) ----
for (const f of ['src/main/folders.ts', 'src/shared/credits.ts']) assert.ok(!/autopilot/i.test(src(f)), `${f} never mentions autopilot (nothing is saved or defaulted)`);
{
  const file = path.join(ROOT, 'src/adapters/types.ts');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const iface = (n: string): ts.InterfaceDeclaration => sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === n)!;
  for (const n of ['StartOptions', 'AgentMessage']) {
    const names = iface(n).members.map((m) => (m.name ? m.name.getText(sf) : ''));
    assert.ok(names.length >= 3, `${n} was parsed`);
    assert.deepStrictEqual(names.filter((x) => /autopilot/i.test(x)), [], `${n} has no autopilot field`);
  }
}

// ---- 3. unreachable in Phase 1 ----
for (const d of [COPILOT_DESCRIPTOR, CLAUDE_DESCRIPTOR, CODEX_DESCRIPTOR]) assert.strictEqual(d.capabilities.autopilot, undefined, `${d.id} reports no autopilot yet`);
{
  const files = walk('src').filter((f) => /\.(ts|js|html)$/.test(f));
  const hits = (re: RegExp): string[] => files.filter((f) => re.test(src(f))).map((f) => f.split(path.sep).join('/')).sort();
  assert.deepStrictEqual(hits(/agents:setAutopilot/), [], 'no agents:setAutopilot channel in src/');
  assert.deepStrictEqual(hits(/setAutopilot/), ['src/adapters/types.ts', 'src/main/simguard.ts'], 'setAutopilot appears only in the interface and the simulator guard list: no adapter, no main caller');
  assert.deepStrictEqual(hits(/autopilot/i), ['src/adapters/autopilot.ts', 'src/adapters/capabilities.ts', 'src/adapters/claudeHistory.ts', 'src/adapters/eventguard.ts', 'src/adapters/types.ts', 'src/main/simguard.ts', 'src/shared/api.ts'], 'Phase 1 touches only the types, the core, the event guard, the Claude history reader (one filter) and the simulator guard list: no renderer, no main, no adapter');
  // nothing outside the types, the core and the event guard imports the core
  assert.deepStrictEqual(hits(/from '(\.\/|\.\.\/adapters\/)autopilot'/), ['src/adapters/claudeHistory.ts', 'src/adapters/eventguard.ts'], 'only the event guard and the Claude history reader import the core in Phase 1');
}

// ---- helper: a run with a recording halt and emit ----
interface Rig { run: AutopilotRun; events: AutopilotRunEvent[]; halts: AutopilotEnd[]; clock: { t: number } }
function rig(limit: number, o: { hours?: number; halt?: (r: AutopilotEnd) => void | Promise<void> } = {}): Rig {
  const events: AutopilotRunEvent[] = [];
  const halts: AutopilotEnd[] = [];
  const clock = { t: 1_000_000 };
  const run = new AutopilotRun({
    limit, runId: 'run-1', hours: o.hours, now: () => clock.t,
    halt: (r) => { halts.push(r); return o.halt ? o.halt(r) : undefined; },
    emit: (e) => events.push(e),
  });
  return { run, events, halts, clock };
}
const ended = (r: Rig): AutopilotRunEvent[] => r.events.filter((e) => e.phase === 'ended');

// ---- 4. the limit follows D13: 1-1000 integer, default 5, never off ----
assert.strictEqual(DEFAULT_LIMIT, 5);
assert.strictEqual(limitOrDefault(undefined), 5, 'none means the default of 5');
for (const ok of [1, 5, 20, 21, 1000]) { assert.strictEqual(limitOrDefault(ok), ok); assert.strictEqual(rig(ok).run.limit, ok); }
for (const bad of [0, 1001, 1.5, NaN, Infinity, -Infinity, -1, '5', null, undefined, true, {}, []]) {
  assert.throws(() => new AutopilotRun({ limit: bad as number, runId: 'r', halt: () => undefined, emit: () => undefined }), RangeError, `constructor refuses ${String(bad)}`);
}
for (const bad of [0, 1001, 1.5, NaN, Infinity, '5', null]) assert.throws(() => limitOrDefault(bad), RangeError, `limitOrDefault refuses ${String(bad)}: it cannot be turned off`);
assert.throws(() => new AutopilotRun({ limit: 5, runId: '', halt: () => undefined, emit: () => undefined }), RangeError, 'an empty runId');
assert.throws(() => new AutopilotRun({ limit: 5, runId: 'x'.repeat(129), halt: () => undefined, emit: () => undefined }), RangeError, 'an oversized runId');
assert.strictEqual(hoursOrDefault(undefined), DEFAULT_HOURS);
for (const bad of [0, 0.5, 169, NaN, Infinity, '2', null]) assert.throws(() => hoursOrDefault(bad), RangeError, `hours ${String(bad)} refused`);
for (const ok of [1, 2, 168]) assert.strictEqual(hoursOrDefault(ok), ok);

// ---- 5. stop at exactly limit + 1 ----
let finished = false;
process.on('exit', () => { if (!finished) { console.error('autopilot test did not finish (a promise never settled, or it threw)'); process.exitCode = 1; } });
(async () => {
  for (const limit of [1, 5, 20, 1000]) {
    const r = rig(limit);
    r.run.start();
    for (let i = 1; i <= limit; i++) {
      assert.strictEqual(r.run.continuation(), 'counted', `limit ${limit}: continuation ${i} counts`);
      assert.strictEqual(r.halts.length, 0, `limit ${limit}: halt not called through continuation ${i}`);
    }
    assert.strictEqual(r.run.count, limit);
    assert.strictEqual(r.run.ended, false);
    assert.strictEqual(r.run.continuation(), 'ended', `limit ${limit}: continuation ${limit + 1} stops the run`);
    assert.deepStrictEqual(r.halts, ['limit'], `limit ${limit}: halt called once, with limit`);
    assert.strictEqual(r.run.count, limit, `limit ${limit}: ends with n = limit`);
    const end = ended(r);
    assert.strictEqual(end.length, 1);
    assert.deepStrictEqual([end[0].n, end[0].reason, end[0].limit], [limit, 'limit', limit]);
    assert.ok(r.events.filter((e) => e.phase === 'ended').every((e) => e.n <= limit), 'ended n never above limit');
    const cont = r.events.filter((e) => e.phase === 'continued');
    assert.strictEqual(cont.length, limit);
    assert.ok(cont.every((e) => e.n >= 1 && e.n <= limit), 'continued never above limit');
    assert.deepStrictEqual(r.events.map((e) => e.phase), ['started', ...cont.map(() => 'continued'), 'ended']);
    await r.run.whenStopped();
    assert.strictEqual(r.run.guardArmed, false, 'a confirmed halt leaves the guard disarmed');
    assert.strictEqual(r.run.continuation(), 'interrupted', 'a continuation after the end means the app is still going: the stop is repeated');
    assert.deepStrictEqual(r.halts, ['limit', 'limit']);
    assert.strictEqual(r.events.length, 2 + limit, 'and no event, no count');
    assert.strictEqual(r.run.count, limit);
  }

  // ---- 6. a second end is ignored ----
  {
    const r = rig(5);
    r.run.start();
    r.run.continuation();
    assert.strictEqual(r.run.end('cap', { unit: 'usd', value: 0.04 }), true);
    for (const reason of ['stopped', 'done', 'error', 'limit'] as const) assert.strictEqual(r.run.end(reason), false);
    r.run.backstopTurn();
    r.run.noteProgress(false);
    r.run.noteProgress(false);
    await r.run.whenStopped();
    assert.strictEqual(r.run.reason, 'cap', 'the first reason stays');
    assert.strictEqual(ended(r).length, 1, 'one ended event');
    assert.deepStrictEqual(ended(r)[0].spend, { unit: 'usd', value: 0.04 });
    assert.deepStrictEqual(r.halts, ['cap'], 'halt once for the ends');
    assert.strictEqual(r.events.length, 3, 'started, continued, ended: nothing more');
    assert.strictEqual(r.run.continuation(), 'interrupted');
    assert.strictEqual(r.events.length, 3);
    // an unknown reason, a bad spend: the run still ends once, as error and without the spend
    const q = rig(5);
    q.run.end('__proto__' as AutopilotEnd, { unit: 'eur' as 'usd', value: 1 });
    assert.strictEqual(q.run.reason, 'error');
    assert.strictEqual(ended(q)[0].spend, undefined);
    assert.deepStrictEqual(eventProblems({ type: 'autopilot', sessionId: 's', timestamp: 1, ...ended(q)[0] }), []);
  }

  // ---- 7. a rejecting halt still ends the run; FR-054 fails closed ----
  {
    for (const how of ['reject', 'throw'] as const) {
      const r = rig(5, { halt: how === 'reject' ? () => Promise.reject(new Error('clear failed')) : () => { throw new Error('dead child'); } });
      r.run.start();
      r.run.continuation();
      assert.strictEqual(r.run.end('stopped'), true);
      assert.strictEqual(r.run.ended, true, 'the run ends although halt failed');
      await r.run.whenStopped();
      assert.strictEqual(ended(r).length, 1);
      assert.strictEqual(r.run.guardArmed, true, `${how}: the guard stays armed`);
      assert.strictEqual(r.run.continuation(), 'interrupted', 'a later continuation is interrupted');
      assert.strictEqual(r.run.continuation(), 'interrupted');
      assert.strictEqual(r.run.guardInterrupts, 2);
      assert.deepStrictEqual(r.halts, ['stopped', 'stopped', 'stopped'], 'halt again for each interrupt, with the same reason');
      assert.strictEqual(r.run.count, 1, 'an interrupted continuation is not counted');
      assert.strictEqual(r.events.length, 3, 'and emits nothing');
      r.run.confirmCleared();
      assert.strictEqual(r.run.guardArmed, false);
    }
    // an interrupt that works disarms; a clear the adapter ran itself and could not confirm arms it even though halt resolved
    let fail = true;
    const r = rig(5, { halt: () => (fail ? Promise.reject(new Error('x')) : undefined) });
    r.run.end('limit');
    await r.run.whenStopped();
    assert.strictEqual(r.run.guardArmed, true);
    fail = false;
    assert.strictEqual(r.run.continuation(), 'interrupted');
    await new Promise((res) => setImmediate(res));
    assert.strictEqual(r.run.guardArmed, false, 'a halt that resolved disarms the guard');
    const c = rig(5);
    c.run.end('done');
    c.run.clearFailed();
    await c.run.whenStopped();
    assert.strictEqual(c.run.guardArmed, true, 'clearFailed() holds the guard even after halt resolved');
    assert.strictEqual(c.run.continuation(), 'interrupted');
    await new Promise((res) => setImmediate(res));
    assert.strictEqual(c.run.guardArmed, true, 'a resolved halt does not hide a failed clear');
    c.run.confirmCleared();
    assert.strictEqual(c.run.guardArmed, false);
    // a throwing emit does not change the run
    const t = new AutopilotRun({ limit: 1, runId: 'r', halt: () => undefined, emit: () => { throw new Error('listener'); } });
    t.start();
    assert.strictEqual(t.continuation(), 'counted');
    assert.strictEqual(t.continuation(), 'ended');
    assert.strictEqual(t.reason, 'limit');
  }

  // ---- 8. T014: the backstop (second counter and elapsed time) ----
  {
    // turns: more than 100 * (limit + 1) ends with error, exactly at the bound does not; the marker never comes
    for (const limit of [1, 5]) {
      const r = rig(limit);
      r.run.start();
      const bound = 100 * (limit + 1);
      assert.strictEqual(r.run.backstopTurns, bound);
      for (let i = 1; i <= bound; i++) r.run.backstopTurn();
      assert.strictEqual(r.run.ended, false, `limit ${limit}: exactly ${bound} turns do not end it`);
      r.run.backstopTurn();
      assert.strictEqual(r.run.ended, true, `limit ${limit}: turn ${bound + 1} ends it`);
      assert.strictEqual(r.run.reason, 'error');
      assert.deepStrictEqual(r.halts, ['error']);
      assert.strictEqual(ended(r)[0].n, 0, 'no continuation was ever seen, and the run still ended');
    }
    // time: 2 hours by default, from the injected clock; reaching it ends it
    const H = 3_600_000;
    const r = rig(5);
    assert.strictEqual(r.run.hours, 2);
    r.run.start();
    r.clock.t += 2 * H - 1;
    assert.strictEqual(r.run.checkElapsed(), false, 'one ms before 2 hours');
    assert.strictEqual(r.run.continuation(), 'counted');
    r.clock.t += 1;
    assert.strictEqual(r.run.deadlineMs, 1_000_000 + 2 * H);
    assert.strictEqual(r.run.checkElapsed(), true, 'exactly 2 hours ends it');
    assert.strictEqual(r.run.reason, 'error');
    assert.strictEqual(r.run.checkElapsed(), false, 'already ended');
    // a continuation or a turn that arrives at the bound ends it too, and nothing else is needed
    for (const feed of ['continuation', 'backstopTurn'] as const) {
      const q = rig(5, { hours: 1 });
      q.run.start();
      q.clock.t += H - 1;
      q.run[feed]();
      assert.strictEqual(q.run.ended, false);
      q.clock.t += 1;
      q.run[feed]();
      assert.strictEqual(q.run.reason, 'error', `${feed} at the bound`);
    }
    // raised: 168 hours is accepted and holds; 169 is refused
    const w = rig(5, { hours: 168 });
    w.run.start();
    w.clock.t += 168 * H - 1;
    assert.strictEqual(w.run.checkElapsed(), false);
    w.clock.t += 1;
    assert.strictEqual(w.run.checkElapsed(), true);
    assert.throws(() => rig(5, { hours: 169 }), RangeError);
    // no progress: two unchanged in a row, a change resets
    const p = rig(5);
    p.run.start();
    p.run.noteProgress(false);
    p.run.noteProgress(true);
    p.run.noteProgress(false);
    assert.strictEqual(p.run.ended, false);
    p.run.noteProgress(false);
    assert.strictEqual(p.run.reason, 'no-progress');
    // the guard interrupts a later continuation after a failed stop on a backstop end
    const g = rig(5, { halt: () => Promise.reject(new Error('x')) });
    g.run.start();
    for (let i = 0; i <= g.run.backstopTurns; i++) g.run.backstopTurn();
    await g.run.whenStopped();
    assert.strictEqual(g.run.continuation(), 'interrupted');
  }

  // ---- 8b. review of 716acc3b: clock, per-app turn bound, reentrancy, guard while a halt is pending ----
  {
    const H = 3_600_000;
    // a clock set back does not defeat the bound: only forward steps count
    const b = rig(5);
    b.run.start();
    b.clock.t -= 1_000_000_000;
    assert.strictEqual(b.run.checkElapsed(), false);
    b.clock.t += 102 * H;
    assert.strictEqual(b.run.checkElapsed(), true, '+102 h after a step back still ends a 2 hour run');
    const b2 = rig(5);
    b2.run.start();
    b2.clock.t += H;
    b2.run.checkElapsed();
    b2.clock.t -= 5 * H; // back
    b2.run.checkElapsed();
    b2.clock.t += H - 1;
    assert.strictEqual(b2.run.checkElapsed(), false);
    b2.clock.t += 1;
    assert.strictEqual(b2.run.checkElapsed(), true, 'an hour before and an hour after the step back add up');
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number, '5' as unknown as number]) {
      const n = rig(5);
      n.run.start();
      n.clock.t = bad;
      assert.strictEqual(n.run.checkElapsed(), true, `a clock that reads ${String(bad)} ends the run`);
      assert.strictEqual(n.run.reason, 'error', 'as error: it fails closed');
      assert.deepStrictEqual(n.halts, ['error']);
    }
    // an always-bad clock, from the constructor on: the first continuation ends it
    const nan = new AutopilotRun({ limit: 5, runId: 'c', now: () => NaN, halt: () => undefined, emit: () => undefined });
    assert.strictEqual(nan.continuation(), 'ended');
    assert.strictEqual(nan.reason, 'error');
    // a clock that was bad when the run began and is fine later still fails closed: its start is unknown
    let ck = NaN;
    const late = new AutopilotRun({ limit: 5, runId: 'c', now: () => ck, halt: () => undefined, emit: () => undefined });
    ck = 1_000_000;
    assert.strictEqual(late.checkElapsed(), true);
    assert.strictEqual(late.reason, 'error');
    // sampling every CLOCK_SAMPLE_MS: a step back that is sampled never delays the end
    assert.strictEqual(core.CLOCK_SAMPLE_MS, 60_000);
    const sm = rig(5);
    sm.run.start();
    sm.clock.t += H;
    sm.run.checkElapsed();
    sm.clock.t -= 5 * H;
    sm.run.checkElapsed();
    sm.clock.t += H - core.CLOCK_SAMPLE_MS;
    assert.strictEqual(sm.run.checkElapsed(), false);
    sm.clock.t += core.CLOCK_SAMPLE_MS;
    assert.strictEqual(sm.run.checkElapsed(), true, '+1 h, -5 h, +1 h, each sampled: 2 hours of forward time end the run');
    // per-app turn bound: Codex limit + 1
    const cx = new AutopilotRun({ limit: 5, runId: 'c', backstopPer: 1, halt: () => undefined, emit: () => undefined });
    assert.strictEqual(cx.backstopTurns, 6);
    for (let i = 0; i < 6; i++) cx.backstopTurn();
    assert.strictEqual(cx.ended, false, 'limit + 1 turns on Codex do not end it');
    cx.backstopTurn();
    assert.strictEqual(cx.reason, 'error');
    assert.strictEqual(rig(5).run.backstopTurns, 600);
    for (const bad of [0, 101, 1.5, NaN, '1', null]) assert.throws(() => new AutopilotRun({ limit: 5, runId: 'c', backstopPer: bad as number, halt: () => undefined, emit: () => undefined }), RangeError, `backstopPer ${String(bad)}`);
    // the owner ends the run from the started event: no continued after the ended, n stays
    const events: AutopilotRunEvent[] = [];
    const halts: AutopilotEnd[] = [];
    const holder: { run?: AutopilotRun } = {};
    holder.run = new AutopilotRun({ limit: 5, runId: 'r', halt: (r) => { halts.push(r); }, emit: (e) => { events.push(e); if (e.phase === 'started') holder.run!.end('stopped'); } });
    assert.strictEqual(holder.run.continuation(), 'ended');
    assert.deepStrictEqual(events.map((e) => `${e.phase}:${e.n}`), ['started:0', 'ended:0'], 'no continued after the end');
    assert.strictEqual(holder.run.count, 0);
    assert.deepStrictEqual(halts, ['stopped']);
    // and from the continued event: continued, then ended with the same n
    const ev2: AutopilotRunEvent[] = [];
    const h2: { run?: AutopilotRun } = {};
    h2.run = new AutopilotRun({ limit: 5, runId: 'r', halt: () => undefined, emit: (e) => { ev2.push(e); if (e.phase === 'continued') h2.run!.end('cap'); } });
    h2.run.continuation();
    assert.deepStrictEqual(ev2.map((e) => `${e.phase}:${e.n}`), ['started:0', 'continued:1', 'ended:1']);
    assert.strictEqual(h2.run.count, 1);
    // a halt that never settles: the guard is armed from the end, and each continuation is interrupted
    let calls = 0;
    const nv = rig(5, { halt: () => { calls += 1; return new Promise<void>(() => undefined); } });
    nv.run.start();
    nv.run.end('limit');
    assert.strictEqual(nv.run.guardArmed, true, 'armed at the end, before any answer');
    for (let i = 0; i < 3; i++) assert.strictEqual(nv.run.continuation(), 'interrupted');
    assert.strictEqual(nv.run.guardInterrupts, 3);
    assert.strictEqual(calls, 4);
    // a halt that throws at once: armed in the same tick
    const th = rig(5, { halt: () => { throw new Error('dead'); } });
    th.run.end('stopped');
    assert.strictEqual(th.run.guardArmed, true);
    assert.strictEqual(th.run.continuation(), 'interrupted');
    // a late result of an older halt does not decide: older resolves after a newer reject
    const pend: Array<{ ok: () => void; no: () => void }> = [];
    const st = rig(5, { halt: () => new Promise<void>((ok, no) => { pend.push({ ok, no: () => no(new Error('x')) }); }) });
    st.run.end('limit'); // halt #1
    st.run.continuation(); // halt #2
    pend[1].no();
    await new Promise((res) => setImmediate(res));
    assert.strictEqual(st.run.guardArmed, true);
    pend[0].ok(); // the older one confirms late
    await new Promise((res) => setImmediate(res));
    assert.strictEqual(st.run.guardArmed, true, 'a stale resolve does not disarm after a newer failure');
    st.run.continuation(); // halt #3
    pend[2].ok();
    await new Promise((res) => setImmediate(res));
    assert.strictEqual(st.run.guardArmed, false, 'the newest confirmed halt disarms');
    // clearFailed() before the end keeps the guard armed after a resolved halt; confirmCleared() before the end changes nothing
    const cf = rig(5);
    cf.run.start();
    cf.run.clearFailed();
    cf.run.end('done');
    await cf.run.whenStopped();
    assert.strictEqual(cf.run.guardArmed, true);
    const cc = rig(5);
    cc.run.confirmCleared();
    cc.run.end('done');
    assert.strictEqual(cc.run.guardArmed, true, 'armed at the end, whatever was confirmed before');
    await cc.run.whenStopped();
    assert.strictEqual(cc.run.guardArmed, false);
    // the id rule
    for (const runId of ['a\u202eb', 'a\nb', 'a\u0000b', 'a b', '']) assert.throws(() => new AutopilotRun({ limit: 5, runId, halt: () => undefined, emit: () => undefined }), RangeError, JSON.stringify(runId));
    // the names and warnings of FR-021
    assert.deepStrictEqual([...AUTOPILOT_ENDS], ['done', 'cap', 'limit', 'no-progress', 'blocked', 'stopped', 'error']);
    assert.deepStrictEqual([core.LIMIT_WARN_ABOVE, core.HOURS_WARN_ABOVE, core.MAX_LIMIT, core.MAX_HOURS, core.GOAL_MAX_CLAUDE], [20, 2, 1000, 168, 4000]);
    assert.deepStrictEqual([20, 21].map(core.limitWarns), [false, true]);
    assert.deepStrictEqual([2, 2.5].map(core.hoursWarn), [false, true]);
  }

  // ---- 9. the event guard ----
  {
    const base = { type: 'autopilot', sessionId: 's', timestamp: 1, runId: 'r1', limit: 5 };
    const ok = (e: object): void => assert.deepStrictEqual(eventProblems({ ...base, ...e }), [], JSON.stringify(e));
    const bad = (e: object, why: string): void => assert.ok(eventProblems({ ...base, ...e }).length > 0, why);
    ok({ phase: 'started', n: 0 });
    ok({ phase: 'continued', n: 5 });
    bad({ phase: 'continued', n: 6 }, 'n above limit');
    bad({ phase: 'ended', n: 6, reason: 'limit' }, 'ended n above limit');
    bad({ phase: 'started', n: 6 }, 'started n 6');
    bad({ phase: 'started', n: 1 }, 'started n 1');
    bad({ phase: 'continued', n: 0 }, 'continued n 0');
    bad({ phase: 'started', n: 0, spend: { unit: 'usd', value: 1 } }, 'spend on started');
    bad({ phase: 'continued', n: 1, spend: { unit: 'usd', value: 1 } }, 'spend on continued');
    for (const runId of ['a\u202eb', 'a\nb', 'a\u0000b', 'a b', 'a\u200bb', 'é', 'a/b']) bad({ phase: 'started', n: 0, runId }, `runId ${JSON.stringify(runId)}`);
    ok({ phase: 'ended', n: 5, reason: 'limit', spend: { unit: 'aiu', value: 1.5 } });
    for (const reason of AUTOPILOT_ENDS) ok({ phase: 'ended', n: 0, reason });
    for (const unit of ['aiu', 'usd', 'tokens']) ok({ phase: 'ended', n: 1, reason: 'done', spend: { unit, value: 0 } });
    ok({ phase: 'ended', n: 1000, limit: 1000, reason: 'done' });
    bad({ phase: 'continued', n: 1, limit: 0 }, 'limit 0');
    for (const n of [-1, 1.5, NaN, '3', Infinity, 1001, null, undefined]) bad({ phase: 'continued', n }, `n ${String(n)}`);
    bad({ phase: 'continued', n: 1001, limit: 1000 }, 'n above 1000');
    for (const limit of [0, 1001, 1.5, NaN, '5', null, undefined, Infinity]) bad({ phase: 'continued', n: 1, limit }, `limit ${String(limit)}`);
    for (const phase of ['begun', '', 'END', undefined, 3, '__proto__']) bad({ phase, n: 1 }, `phase ${String(phase)}`);
    for (const reason of ['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'Done', '', 7, null]) bad({ phase: 'ended', n: 1, reason }, `reason ${String(reason)}`);
    bad({ phase: 'ended', n: 1 }, 'reason missing on ended');
    for (const phase of ['started', 'continued']) for (const reason of ['done', null]) bad({ phase, n: 0, reason }, `reason on ${phase}`);
    for (const runId of ['', 'x'.repeat(129), 7, null, undefined]) bad({ phase: 'started', n: 0, runId }, `runId ${String(runId)}`);
    ok({ phase: 'started', n: 0, runId: 'x'.repeat(128) });
    for (const spend of [{ unit: 'eur', value: 1 }, { unit: 'usd', value: -1 }, { unit: 'usd', value: Infinity }, { unit: 'usd', value: NaN }, { unit: 'usd', value: '1' }, { unit: '__proto__', value: 1 }, { unit: 'toString', value: 1 }, { value: 1 }, 'usd', null, []]) {
      bad({ phase: 'ended', n: 1, reason: 'cap', spend }, `spend ${JSON.stringify(spend)}`);
    }
    // the shared base fields still apply
    assert.ok(eventProblems({ ...base, phase: 'started', n: 0, sessionId: '' }).length > 0);
    assert.ok(eventProblems({ type: 'autopilot' }).length > 0);
    // question.autoAnswered
    const q = { type: 'question', sessionId: 's', timestamp: 1, phase: 'asked', requestId: 'q', questions: [{ question: 'Which?', multiSelect: false, options: [] }] };
    assert.deepStrictEqual(eventProblems(q), []);
    assert.deepStrictEqual(eventProblems({ ...q, autoAnswered: true }), []);
    for (const v of [false, 'true', 1, null, {}]) assert.ok(eventProblems({ ...q, autoAnswered: v }).length > 0, `autoAnswered ${String(v)}`);
    // every event a run makes passes the guard
    const r = rig(3);
    r.run.start();
    for (let i = 0; i < 4; i++) r.run.continuation();
    for (const e of r.events) assert.deepStrictEqual(eventProblems({ type: 'autopilot', sessionId: 's', timestamp: 1, ...e }), []);
  }

  // ---- 10. goalText ----
  {
    const t = (s: unknown, app?: 'claude' | 'codex' | 'copilot'): core.GoalTextResult => goalText(s, app);
    assert.deepStrictEqual(t('fix the bug'), { ok: true, text: 'fix the bug' });
    assert.deepStrictEqual(t('a\u0000b'), { ok: true, text: 'a b' });
    assert.deepStrictEqual(t('a\u0001\u0002\u0003b'), { ok: true, text: 'a b' }, 'a run collapses to one space');
    assert.deepStrictEqual(t('a\x7fb'), { ok: true, text: 'a b' }, 'DEL');
    assert.deepStrictEqual(t('a\u0080\u0085\u009fb'), { ok: true, text: 'a b' }, 'C1');
    assert.deepStrictEqual(t('a\u001b[31mb'), { ok: true, text: 'a [31mb' }, 'ESC');
    assert.deepStrictEqual(t('a\tb'), { ok: true, text: 'a b' }, 'tab is C0');
    assert.deepStrictEqual(t('a\nb'), { ok: true, text: 'a\nb' }, 'newline kept');
    assert.deepStrictEqual(t('a\r\nb'), { ok: true, text: 'a \nb' }, 'CRLF is a space and a newline');
    assert.deepStrictEqual(t('a\n\nb'), { ok: true, text: 'a\n\nb' });
    assert.deepStrictEqual(t('a bé'), { ok: true, text: 'a bé' }, 'NBSP and letters are not control characters');
    assert.deepStrictEqual(t(''), { ok: false, reason: 'empty' });
    assert.deepStrictEqual(t('   \n\t '), { ok: false, reason: 'empty' });
    assert.deepStrictEqual(t('\u0000\u0001'), { ok: false, reason: 'empty' });
    for (const v of [undefined, null, 5, {}, ['clear']]) assert.deepStrictEqual(t(v), { ok: false, reason: 'empty' });
    for (const w of ['clear', 'stop', 'off', 'reset', 'none', 'cancel']) {
      for (const v of [w, ` ${w}\n`, w.toUpperCase(), `${w}\u0000`, `\u202e${w}`, `${w}\u2028`]) assert.deepStrictEqual(t(v), { ok: false, reason: 'reserved' }, `${JSON.stringify(v)} on Claude Code`);
      assert.deepStrictEqual(t(w, 'claude'), { ok: false, reason: 'reserved' });
      assert.deepStrictEqual(t(w, 'codex'), { ok: true, text: w }, `${w} is a normal goal on Codex`);
      assert.deepStrictEqual(t(w, 'copilot'), { ok: true, text: w }, `${w} is a normal goal on Copilot`);
    }
    assert.deepStrictEqual([...core.CLAUDE_GOAL_RESERVED], ['clear', 'stop', 'off', 'reset', 'none', 'cancel']);
    assert.deepStrictEqual(t('clear the cache'), { ok: true, text: 'clear the cache' });
    assert.deepStrictEqual(t('clearly'), { ok: true, text: 'clearly' });
    assert.deepStrictEqual(t('stop it'), { ok: true, text: 'stop it' });
    assert.deepStrictEqual(t('a\u202eb\u200bc\ufeffd'), { ok: true, text: 'abcd' }, 'bidi, ZWSP and BOM are removed');
    assert.deepStrictEqual(t('one\u2028two\u2029three'), { ok: true, text: 'one\ntwo\nthree' }, 'U+2028 and U+2029 are newlines: two words never join');
    for (const ch of ['\u200e', '\u200f', '\u061c', '\u206a', '\u206f', '\u{e0001}', '\u{e0041}', '\u{e007f}', '\u202a', '\u2066']) assert.deepStrictEqual(t(`a${ch}b`), { ok: true, text: 'ab' }, `U+${ch.codePointAt(0)!.toString(16)} is removed`);
    for (const v of ['\u200f', '\u200d', '\u200c\u200d', ' \u200d ', '\u202e\u200b', '\u{e0041}\u{e0042}', '\u061c\n']) for (const app of [undefined, 'claude', 'codex', 'copilot'] as const) assert.deepStrictEqual(t(v, app), { ok: false, reason: 'empty' }, `${JSON.stringify(v)} has no visible character`);
    assert.deepStrictEqual(t('\u0915\u094d\u200d\u0937'), { ok: true, text: '\u0915\u094d\u200d\u0937' }, 'a joiner between letters of a real script stays');
    assert.deepStrictEqual(t('a\u200db\u200c'), { ok: true, text: 'a\u200db\u200c' }, 'joiners stay');
    // over 4000 trimmed characters: Claude Code's own limit, refused with a reason there only
    const L4000 = 'x'.repeat(4000);
    assert.deepStrictEqual(t(L4000, 'claude'), { ok: true, text: L4000 }, 'exactly 4000 is fine');
    assert.deepStrictEqual(t(`  ${L4000}  \n`, 'claude'), { ok: true, text: L4000 }, 'the count is the trimmed length, and the trimmed text is what is sent');
    assert.strictEqual((t(L4000 + '\n'.repeat(100000), 'claude') as { text: string }).text.length, 4000, 'no unbounded padding is sent');
    assert.deepStrictEqual(t(L4000 + 'y', 'claude'), { ok: false, reason: 'too-long' });
    assert.deepStrictEqual(t(L4000 + 'y'), { ok: false, reason: 'too-long' }, 'no app: the strictest rules');
    assert.deepStrictEqual(t(L4000 + 'y', 'codex'), { ok: true, text: L4000 + 'y' }, 'Codex has no such limit here');
    assert.deepStrictEqual(t(L4000 + 'y', 'copilot'), { ok: true, text: L4000 + 'y' });
    // a line that starts with a slash is not a command on Claude Code: one message is one command (real: CLI 2.1.317, 2026-11-03)
    for (const v of ['/compact', 'fix it\n/compact', 'tests pass\n/cost', '/goal x', '/tmp is full', '/word', '/usr/bin', '/usr/bin/env is broken']) assert.deepStrictEqual(t(v, 'claude'), { ok: true, text: v }, JSON.stringify(v));
    assert.deepStrictEqual(t('a'.repeat(3990) + '\n/cost\n' + 'b'.repeat(10), 'claude'), { ok: false, reason: 'too-long' }, '4007 with a /cost line: only the length counts');
    const E2000 = '\u{1F600}'.repeat(2000);
    assert.deepStrictEqual(t(E2000, 'claude'), { ok: true, text: E2000 }, '2000 emoji = 4000 code units');
    assert.deepStrictEqual(t(E2000 + '\u{1F600}', 'claude'), { ok: false, reason: 'too-long' }, '2001 emoji = 4002 code units, as the CLI counts');
    for (const w of ['clear', 'stop', 'off', 'reset', 'none', 'cancel']) for (const v of [`  ${w.toUpperCase()}  `, ` ${w[0].toUpperCase()}${w.slice(1)}\t`, `\n${w}\n`]) assert.deepStrictEqual(t(v, 'claude'), { ok: false, reason: 'reserved' }, JSON.stringify(v));
    // a long input finishes (a backtracking pattern would not; no wall clock is asserted, FR-048b)
    for (const unit of ['\u0001 ', ' \r\n', '\u0001'.repeat(3), 'a\u0000', '\u200b\u0001', '\n ']) {
      const big = unit.repeat(Math.ceil(2_000_000 / unit.length));
      assert.ok(t(big + 'z', 'codex').ok, 'long input accepted on Codex');
      t(big + 'z', 'claude'); // finishes, whatever the answer
    }
  }

  // ---- 11. AUTOPILOT_ANSWER is an exact constant, and no function takes agent text ----
  {
    assert.strictEqual(AUTOPILOT_ANSWER, 'The user is away and will not answer. Decide by yourself, say what you chose, and keep going.');
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(AUTOPILOT_ANSWER), 'no control characters');
    assert.strictEqual(typeof AUTOPILOT_ANSWER, 'string');
    const fns = Object.entries(core).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
    assert.deepStrictEqual(fns, ['AutopilotRun', 'codexGoalEnd', 'goalText', 'hoursOrDefault', 'hoursWarn', 'isAutopilotEnd', 'isClaudeContinuation', 'isSpendUnit', 'limitOrDefault', 'limitWarns', 'validHours', 'validLimit', 'validRunId'], 'the exported functions: none builds an answer');
    const file = path.join(ROOT, 'src/adapters/autopilot.ts');
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const uses: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === 'AUTOPILOT_ANSWER') uses.push(n.parent.kind === ts.SyntaxKind.VariableDeclaration ? 'decl' : 'use');
      ts.forEachChild(n, visit);
    };
    visit(sf);
    assert.deepStrictEqual(uses, ['decl'], 'the constant is declared and never used to build text in the core');
  }

  // ---- 12. codexGoalEnd ----
  {
    const want: Record<string, AutopilotEnd | null> = { complete: 'done', budgetLimited: 'cap', usageLimited: 'cap', blocked: 'blocked', paused: 'blocked', active: null };
    for (const [status, end] of Object.entries(want)) assert.strictEqual(codexGoalEnd(status), end, status);
    for (const v of ['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'COMPLETE', 'Complete', '', 'unknown', undefined, null, 3, {}, ['complete']]) assert.strictEqual(codexGoalEnd(v), null, `${String(v)} is no end`);
  }

  // ---- 13. isClaudeContinuation ----
  {
    const fb = 'Stop hook feedback:\nThe goal is not met yet.';
    const msg = (o: object = {}): object => ({ type: 'user', isSynthetic: true, message: { role: 'user', content: [{ type: 'text', text: fb }] }, ...o });
    assert.strictEqual(isClaudeContinuation(msg()), true);
    assert.strictEqual(isClaudeContinuation(msg({ message: { role: 'user', content: fb } })), true, 'string content');
    assert.strictEqual(isClaudeContinuation(msg({ isSynthetic: undefined })), false, 'a typed "Stop hook feedback:" has no isSynthetic');
    for (const v of [false, 'true', 1, null]) assert.strictEqual(isClaudeContinuation(msg({ isSynthetic: v })), false, `isSynthetic ${String(v)}`);
    const typed = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: fb }] } };
    assert.strictEqual(isClaudeContinuation(typed), false);
    assert.strictEqual(isClaudeContinuation(msg({ message: { role: 'user', content: [{ type: 'text', text: 'Please continue' }] } })), false, 'other synthetic text');
    assert.strictEqual(isClaudeContinuation(msg({ message: { role: 'user', content: [{ type: 'text', text: ' Stop hook feedback:' }] } })), false, 'must start with it');
    assert.strictEqual(isClaudeContinuation(msg({ message: { role: 'user', content: [{ type: 'tool_result', content: fb }] } })), false);
    assert.strictEqual(isClaudeContinuation(msg({ type: 'assistant' })), false);
    assert.strictEqual(isClaudeContinuation(msg({ parent_tool_use_id: 'toolu_1' })), false, 'a helper (FR-008)');
    assert.strictEqual(isClaudeContinuation(msg({ parent_tool_use_id: null })), true);
    assert.strictEqual(isClaudeContinuation(msg({ agentId: 'a1' })), false);
    assert.strictEqual(isClaudeContinuation(msg({ isSidechain: true })), false, 'a sidechain (helper) message');
    assert.strictEqual(isClaudeContinuation(msg({ isSidechain: false })), true);
    assert.strictEqual(isClaudeContinuation(msg({ agentId: null })), true, 'a null agentId is the main stream, like a null parent_tool_use_id');
    assert.strictEqual(isClaudeContinuation(msg({ message: { role: 'user', content: [{ type: 'text', text: 'note' }, { type: 'text', text: fb }] } })), true, 'a marker in a later text block counts');
    assert.strictEqual(isClaudeContinuation(msg({ message: { role: 'user', content: [{ type: 'text', text: 'note' }, { type: 'image' }] } })), false);
    for (const v of [undefined, null, 'Stop hook feedback:', 5, [], {}, { type: 'user', isSynthetic: true }, msg({ message: null }), msg({ message: { content: [] } })]) assert.strictEqual(isClaudeContinuation(v), false, `junk ${JSON.stringify(v)}`);
  }

  // ---- 14. review of e6b78258: each mutant below survived before, with the test that kills it ----
  {
    const manual = (): { p: Promise<void>; ok: () => void; no: () => void } => {
      let ok!: () => void; let no!: () => void;
      const p = new Promise<void>((res, rej) => { ok = res; no = () => rej(new Error('x')); });
      return { p, ok, no };
    };
    const tick = (): Promise<void> => new Promise((res) => setImmediate(res));
    // M1 `this.armed = true` in guard(): after a confirmed stop, a continuation arms the guard at once, while its repeated halt is pending
    {
      const pend = manual();
      let calls = 0;
      const r = rig(1, { halt: () => (++calls === 1 ? undefined : pend.p) });
      r.run.end('done');
      await r.run.whenStopped();
      assert.strictEqual(r.run.guardArmed, false);
      assert.strictEqual(r.run.continuation(), 'interrupted');
      assert.strictEqual(r.run.guardArmed, true, 'M1: armed while the repeated halt is pending');
      pend.ok();
      await tick();
      assert.strictEqual(r.run.guardArmed, false);
    }
    // M2 the spend value checks in end(): a bad value is dropped, 0 is kept
    for (const bad of [-1, NaN, Infinity, -Infinity, '1', null, undefined]) {
      const r = rig(5);
      r.run.end('cap', { unit: 'usd', value: bad as number });
      assert.strictEqual(ended(r)[0].spend, undefined, `M2: spend value ${String(bad)} is dropped`);
      assert.deepStrictEqual(eventProblems({ type: 'autopilot', sessionId: 's', timestamp: 1, ...ended(r)[0] }), []);
    }
    { const r = rig(5); r.run.end('cap', { unit: 'tokens', value: 0 }); assert.deepStrictEqual(ended(r)[0].spend, { unit: 'tokens', value: 0 }, 'zero spend is kept'); }
    // M3 the runHalt reject handler: a clear confirmed while the halt is pending, then the halt rejects: armed again
    {
      const pend = manual();
      const r = rig(5, { halt: () => pend.p });
      r.run.end('stopped');
      r.run.confirmCleared();
      assert.strictEqual(r.run.guardArmed, false);
      pend.no();
      await r.run.whenStopped();
      assert.strictEqual(r.run.guardArmed, true, 'M3: a rejection keeps (or puts back) the guard armed');
    }
    // M4 confirmCleared() resets failedClear: after clearFailed, confirmCleared, a later repeated halt that resolves disarms
    {
      const r = rig(5);
      r.run.end('done');
      r.run.clearFailed();
      await r.run.whenStopped();
      r.run.confirmCleared();
      assert.strictEqual(r.run.continuation(), 'interrupted');
      await tick();
      assert.strictEqual(r.run.guardArmed, false, 'M4: failedClear was reset');
    }
    // M5 the constructor TypeError for halt and emit
    for (const bad of [undefined, null, 'x', 5, {}]) {
      assert.throws(() => new AutopilotRun({ limit: 5, runId: 'r', halt: bad as never, emit: () => undefined }), TypeError, `M5: halt ${String(bad)}`);
      assert.throws(() => new AutopilotRun({ limit: 5, runId: 'r', halt: () => undefined, emit: bad as never }), TypeError, `M5: emit ${String(bad)}`);
    }
    // M6 invisible-only goals
    for (const v of ['\u2800', '\uffa0', '\ufe0f', '\ufe00\ufe0f', '\u180b\u180d', '\u3164', '\u115f\u1160', '\u{e0100}', ' \u2800 \n', '\u00a0', '\u2003', '\u200c']) {
      for (const app of [undefined, 'claude', 'codex', 'copilot'] as const) assert.deepStrictEqual(goalText(v, app), { ok: false, reason: 'empty' }, `M6: ${JSON.stringify(v)}`);
    }
    // round 2: Default_Ignorable, Cf outside the removed lists, ill-formed, private-use, noncharacter, a lone mark
    for (const v of ['\u17b4', '\u17b5', '\u17b4\u17b5', '\ufff0', '\ufff8', '\u{e0080}', '\u{e0200}', '\u{e0fff}', '\u{1d173}', '\u0600', '\u06dd', '\u{110bd}', '\ud800', '\udc00', '\ud800a', 'a\ud800', '\uffff', '\ue000', '\u{f0000}', '\u0300', '\u0300\u0301', '\u0e31', ' \u0300 ']) {
      for (const app of [undefined, 'claude', 'codex', 'copilot'] as const) assert.deepStrictEqual(goalText(v, app), { ok: false, reason: 'empty' }, `M6b: ${JSON.stringify(v)}`);
    }
    assert.deepStrictEqual(goalText('a\u0300'), { ok: true, text: 'a\u0300' }, 'a mark on a letter stays');
    assert.deepStrictEqual(goalText('e\u0301 \u{1f600}'), { ok: true, text: 'e\u0301 \u{1f600}' }, 'letters, marks and emoji stay');
    assert.deepStrictEqual(goalText('a\u2800'), { ok: true, text: 'a\u2800' }, 'a blank next to a visible character stays');
    // continuation() says 'ended' when a listener ended the run while handling `continued`
    {
      const events: string[] = [];
      let run!: AutopilotRun;
      run = new AutopilotRun({ limit: 5, runId: 'r', halt: () => undefined, emit: (e) => { events.push(`${e.phase}:${e.n}`); if (e.phase === 'continued') run.end('cap'); } });
      assert.strictEqual(run.continuation(), 'ended');
      assert.strictEqual(run.ended, true);
      assert.deepStrictEqual(events, ['started:0', 'continued:1', 'ended:1']);
    }
    // the backstop clock starts at start(), not at construction
    {
      const r = rig(5);
      r.clock.t += 5 * 3_600_000;
      r.run.start();
      assert.strictEqual(r.run.checkElapsed(), false, 'idle time before start() does not count');
      assert.strictEqual(r.run.deadlineMs, r.clock.t + 2 * 3_600_000);
      assert.strictEqual(r.run.continuation(), 'counted');
      r.clock.t += 2 * 3_600_000;
      assert.strictEqual(r.run.checkElapsed(), true);
      // time sampled before start() does not count either
      const e = rig(5);
      e.clock.t += 1.5 * 3_600_000;
      assert.strictEqual(e.run.checkElapsed(), false);
      e.run.start();
      e.clock.t += 0.6 * 3_600_000;
      assert.strictEqual(e.run.checkElapsed(), false, 'elapsed time restarts at start()');
      // a clock that was fine at construction and bad at start() fails closed
      const c = { t: 1 as number };
      const events: string[] = [];
      const bad = new AutopilotRun({ limit: 5, runId: 'r', now: () => c.t, halt: () => undefined, emit: (e) => events.push(e.phase) });
      c.t = NaN;
      bad.start();
      assert.strictEqual(bad.checkElapsed(), true);
      assert.strictEqual(bad.reason, 'error');
    }
    // whenStopped() is resolved before the end (it settles a halt that was never called); after the end it follows the halt
    {
      const pend = manual();
      const r = rig(5, { halt: () => pend.p });
      let done = false;
      void r.run.whenStopped().then(() => { done = true; });
      await tick();
      assert.strictEqual(done, true, 'before end() there is no halt to wait for');
      r.run.end('done');
      let after = false;
      void r.run.whenStopped().then(() => { after = true; });
      await tick();
      assert.strictEqual(after, false, 'after end() it waits for halt');
      pend.ok();
      await r.run.whenStopped();
    }
    // end() before start() emits started first; halt is called before ended is emitted
    {
      const order: string[] = [];
      const run = new AutopilotRun({ limit: 5, runId: 'r', halt: () => { order.push('halt'); }, emit: (e) => order.push(e.phase) });
      run.end('stopped');
      assert.deepStrictEqual(order, ['started', 'halt', 'ended'], 'started, then the stop in flight, then ended');
      const q = rig(5);
      q.run.noteProgress(false);
      q.run.noteProgress(false);
      assert.deepStrictEqual(q.events.map((e) => e.phase), ['started', 'ended']);
    }
    // the event guard: an autopilot event never carries an agentId (FR-008)
    {
      const base = { type: 'autopilot', sessionId: 's', timestamp: 1, phase: 'started', runId: 'r', n: 0, limit: 5 };
      assert.deepStrictEqual(eventProblems(base), []);
      assert.ok(eventProblems({ ...base, agentId: 'h1' }).some((x) => /agentId/.test(x)), 'a helper-tagged autopilot event is refused');
    }
    // isClaudeContinuation uses the mapper's helper rule: snake_case agent_id too
    {
      const m = { type: 'user', isSynthetic: true, message: { role: 'user', content: 'Stop hook feedback: x' } };
      assert.strictEqual(isClaudeContinuation(m), true);
      assert.strictEqual(isClaudeContinuation({ ...m, agent_id: 't1', parent_tool_use_id: null }), false, 'agent_id marks a helper');
      assert.strictEqual(isClaudeContinuation({ ...m, agent_id: '', parent_tool_use_id: '' }), true, 'empty ids are the mapper\'s main stream');
      assert.strictEqual(isClaudeContinuation({ ...m, parent_tool_use_id: 'toolu_1' }), false);
    }
    // the history reader does not show a synthetic continuation as a typed prompt, and keeps a typed one
    {
      const line = (o: object): string => JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', cwd: '/w', ...o });
      const text = [
        line({ isSynthetic: true, message: { role: 'user', content: 'Stop hook feedback:\nnot met' } }),
        line({ message: { role: 'user', content: 'Stop hook feedback: typed by the person' } }),
        line({ message: { role: 'user', content: 'real prompt' } }),
      ].join('\n');
      const users = claudeHistoryFromText(text).items.filter((i) => i.type === 'user').map((i) => (i as { text: string }).text);
      assert.deepStrictEqual(users, ['Stop hook feedback: typed by the person', 'real prompt']);
      assert.strictEqual(parseSessionHead(line({ isSynthetic: true, message: { role: 'user', content: 'Stop hook feedback: x' } })).title, undefined, 'and it is no session title');
    }
  }

  finished = true;
  console.log('autopilot core (spec 099 phase 1): limit bounds, stop at limit + 1, end once, fail-closed guard, backstop, event guard, goalText, Codex and Claude mappings OK');
})().catch((e) => { console.error(e); process.exit(1); });
