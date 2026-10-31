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

// ---- 2. never saved or defaulted ----
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
  assert.deepStrictEqual(hits(/autopilot/i), ['src/adapters/autopilot.ts', 'src/adapters/capabilities.ts', 'src/adapters/eventguard.ts', 'src/adapters/types.ts', 'src/main/simguard.ts', 'src/shared/api.ts'], 'Phase 1 touches only the types, the core, the event guard and the simulator guard list: no renderer, no main, no adapter');
  // nothing outside the types, the core and the event guard imports the core
  assert.deepStrictEqual(hits(/from '(\.\/|\.\.\/adapters\/)autopilot'/), ['src/adapters/eventguard.ts'], 'only the event guard imports the core in Phase 1');
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
    for (let i = 0; i < 3; i++) assert.strictEqual(r.run.continuation(), 'ignored', 'later continuations are ignored');
    assert.strictEqual(r.halts.length, 1);
    assert.strictEqual(r.events.length, 2 + limit);
  }

  // ---- 6. a second end is ignored ----
  {
    const r = rig(5);
    r.run.start();
    r.run.continuation();
    assert.strictEqual(r.run.end('cap', { unit: 'usd', value: 0.04 }), true);
    for (const reason of ['stopped', 'done', 'error', 'limit'] as const) assert.strictEqual(r.run.end(reason), false);
    assert.strictEqual(r.run.continuation(), 'ignored');
    r.run.backstopTurn();
    r.run.noteProgress(false);
    r.run.noteProgress(false);
    await r.run.whenStopped();
    assert.strictEqual(r.run.reason, 'cap', 'the first reason stays');
    assert.strictEqual(ended(r).length, 1, 'one ended event');
    assert.deepStrictEqual(ended(r)[0].spend, { unit: 'usd', value: 0.04 });
    assert.deepStrictEqual(r.halts, ['cap'], 'halt once');
    assert.strictEqual(r.events.length, 3, 'started, continued, ended: nothing more');
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
      assert.strictEqual(r.run.continuation(), 'ignored', 'after the acknowledged clear it is ignored');
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

  // ---- 9. the event guard ----
  {
    const base = { type: 'autopilot', sessionId: 's', timestamp: 1, runId: 'r1', limit: 5 };
    const ok = (e: object): void => assert.deepStrictEqual(eventProblems({ ...base, ...e }), [], JSON.stringify(e));
    const bad = (e: object, why: string): void => assert.ok(eventProblems({ ...base, ...e }).length > 0, why);
    ok({ phase: 'started', n: 0 });
    ok({ phase: 'continued', n: 5 });
    ok({ phase: 'continued', n: 6 }); // limit + 1 is the bound
    ok({ phase: 'ended', n: 5, reason: 'limit', spend: { unit: 'aiu', value: 1.5 } });
    for (const reason of AUTOPILOT_ENDS) ok({ phase: 'ended', n: 0, reason });
    for (const unit of ['aiu', 'usd', 'tokens']) ok({ phase: 'ended', n: 1, reason: 'done', spend: { unit, value: 0 } });
    ok({ phase: 'ended', n: 1000, limit: 1000, reason: 'done' });
    for (const n of [-1, 1.5, NaN, '3', Infinity, 1001, null, undefined]) bad({ phase: 'continued', n }, `n ${String(n)}`);
    bad({ phase: 'continued', n: 7 }, 'n above limit + 1');
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
    assert.deepStrictEqual(t('clear'), { ok: false, reason: 'reserved' });
    assert.deepStrictEqual(t('clear', 'claude'), { ok: false, reason: 'reserved' });
    assert.deepStrictEqual(t(' clear\n'), { ok: false, reason: 'reserved' }, 'with spaces around it');
    assert.deepStrictEqual(t('clear\u0000'), { ok: false, reason: 'reserved' }, 'with a control character around it');
    assert.deepStrictEqual(t('CLEAR'), { ok: false, reason: 'reserved' });
    assert.deepStrictEqual(t('clear the cache'), { ok: true, text: 'clear the cache' });
    assert.deepStrictEqual(t('clearly'), { ok: true, text: 'clearly' });
    // over 4000: a warning on Claude Code, never a refusal
    const L4000 = 'x'.repeat(4000);
    assert.deepStrictEqual(t(L4000, 'claude'), { ok: true, text: L4000 }, 'exactly 4000 is fine');
    assert.deepStrictEqual(t(L4000 + 'y', 'claude'), { ok: true, text: L4000 + 'y', warn: 'long' });
    assert.strictEqual((t(L4000 + 'y') as { warn?: string }).warn, 'long', 'no app: the strictest rules');
    assert.strictEqual((t(L4000 + 'y', 'codex') as { warn?: string }).warn, undefined, 'the warning is Claude Code only');
    assert.strictEqual((t(L4000 + 'y', 'copilot') as { warn?: string }).warn, undefined);
    // linear time on a long input: a worst case for a backtracking pattern, checked by shape and a loose bound
    for (const unit of ['\u0001 ', ' \r\n', '\u0001'.repeat(3), 'a\u0000']) {
      const big = unit.repeat(Math.ceil(2_000_000 / unit.length));
      const t0 = process.hrtime.bigint();
      const res = t(big + 'z');
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(res.ok, 'long input accepted');
      assert.ok(ms < 5000, `2 MB took ${ms} ms`);
    }
    {
      const s = (n: number): string => 'a\u0001'.repeat(n);
      const time = (n: number): number => { const t0 = process.hrtime.bigint(); t(s(n)); return Number(process.hrtime.bigint() - t0) / 1e6; };
      time(1000); // warm up
      const small = Math.max(time(100_000), 1);
      const large = time(1_600_000);
      assert.ok(large < small * 16 * 8 + 50, `16x the input took ${large} ms against ${small} ms: not quadratic`);
    }
  }

  // ---- 11. AUTOPILOT_ANSWER is an exact constant, and no function takes agent text ----
  {
    assert.strictEqual(AUTOPILOT_ANSWER, 'The user is away and will not answer. Decide by yourself, say what you chose, and keep going.');
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(AUTOPILOT_ANSWER), 'no control characters');
    assert.strictEqual(typeof AUTOPILOT_ANSWER, 'string');
    const fns = Object.entries(core).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
    assert.deepStrictEqual(fns, ['AutopilotRun', 'codexGoalEnd', 'goalText', 'hoursOrDefault', 'isAutopilotEnd', 'isClaudeContinuation', 'isSpendUnit', 'limitOrDefault', 'validHours', 'validLimit', 'validRunId'], 'the exported functions: none builds an answer');
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
    for (const v of [undefined, null, 'Stop hook feedback:', 5, [], {}, { type: 'user', isSynthetic: true }, msg({ message: null }), msg({ message: { content: [] } })]) assert.strictEqual(isClaudeContinuation(v), false, `junk ${JSON.stringify(v)}`);
  }

  console.log('autopilot core (spec 099 phase 1): limit bounds, stop at limit + 1, end once, fail-closed guard, backstop, event guard, goalText, Codex and Claude mappings OK');
})().catch((e) => { console.error(e); process.exit(1); });
