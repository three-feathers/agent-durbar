/** Scheduled prompts (spec 044 FR-036..FR-039, FR-043): the run log kept by main. Part of `npm run test:schedules`. Fake clock, no session, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_RUNS, Scheduler, cleanRuns, runsReply, loadSchedules, parseSchedules, publicDoc, saveSchedules } from '../src/main/schedules';
import type { Schedule, ScheduleRun, SchedulesDoc } from '../src/main/schedules';
import { harness } from './test-schedules';

const MIN = 60_000;
const T0 = 1_000_000_000_000;
const ID = 'aaaaaaaa-1111';
const log = (h: ReturnType<typeof harness>, id: string): ScheduleRun[] => h.sch.doc.runs?.[id] ?? [];
/** The log's newest entry always equals `last` (FR-036: one place records both); a folded entry ends at `until`. */
const lastEqualsNewest = (h: ReturnType<typeof harness>): void => {
  for (const s of h.sch.doc.schedules) {
    const top = log(h, s.id).slice(-1)[0];
    if (s.last) assert.ok(top && (top.until ?? top.at) === s.last.at && top.outcome === s.last.outcome, `the newest entry equals last (${s.id}): ${JSON.stringify([top, s.last])}`);
  }
};
const mkSched = (o: Partial<Schedule> = {}): Schedule => ({ id: ID, folder: '/w', prompt: 'PROMPT-TEXT', every: 5, next: T0 + 5 * MIN, ...o });

async function main(): Promise<void> {
  // ---- FR-038: loading, migration and strict reading ----
  {
    const old = parseSchedules(JSON.stringify({ pausedAll: false, schedules: [{ id: ID, folder: '/w', prompt: 'p', every: 30, next: T0 + 1, last: { at: T0 - 1, outcome: 'sent' } }] }), T0);
    assert.strictEqual(old.runs, undefined, 'a file without runs loads with empty logs');
    assert.deepStrictEqual(old.schedules[0].last, { at: T0 - 1, outcome: 'sent' }, 'last is kept and not copied into the log');
    assert.deepStrictEqual(Object.keys(parseSchedules('{"schedules":[],"runs":{"x":[{"at":1,"outcome":"sent"}]}}', T0)), ['pausedAll', 'schedules'], 'a log without a schedule is dropped');
    const ids = [ID, 'bbbbbbbb-2222'];
    const good = { at: T0, outcome: 'sent', session: 's1', reason: 'send-error', manual: true, n: 3, until: T0 + 5 };
    assert.deepStrictEqual(cleanRuns({ [ID]: [good] }, ids), { [ID]: [good] }, 'a full entry is kept');
    for (const bad of [null, 5, 'x', [], [[]], true]) assert.deepStrictEqual(cleanRuns(bad, ids), {}, `runs that is not an object: ${JSON.stringify(bad)}`);
    assert.deepStrictEqual(cleanRuns({ orphan: [good], [ID]: 'nope', 'bbbbbbbb-2222': { 0: good } }, ids), {}, 'orphan ids and non-arrays are dropped');
    assert.deepStrictEqual(cleanRuns({ __proto__: [good], constructor: [good] }, ids), {}, 'inherited keys are not read');
    // bad entries and bad fields
    const bads = [null, 7, 'x', [], { at: 0, outcome: 'sent' }, { at: -1, outcome: 'sent' }, { at: 'x', outcome: 'sent' }, { at: Infinity, outcome: 'sent' }, { at: NaN, outcome: 'sent' }, { at: T0, outcome: 'nope' }, { at: T0 }, { outcome: 'sent' }];
    assert.deepStrictEqual(cleanRuns({ [ID]: [...bads, { at: T0, outcome: 'sent' }] }, ids), { [ID]: [{ at: T0, outcome: 'sent' }] }, 'entries with a bad required field are dropped');
    const dirty = { at: T0, outcome: 'failed', session: 'bad session!', reason: 'because I said so: /home/me/.ssh', manual: 'yes', n: 1, until: T0 - 1, extra: 'x', prompt: 'SECRET', error: 'boom' };
    assert.deepStrictEqual(cleanRuns({ [ID]: [dirty] }, ids), { [ID]: [{ at: T0, outcome: 'failed' }] }, 'a bad optional field is dropped alone; unknown fields (prompt, error) are never kept');
    for (const [k, v] of [['n', 1.5], ['n', 100_001], ['n', '5'], ['session', 'x'.repeat(129)], ['session', ''], ['until', Infinity], ['reason', 'user ']] as const) assert.ok(!(k in cleanRuns({ [ID]: [{ at: T0, outcome: 'sent', [k]: v }] }, ids)[ID][0]), `${k}=${String(v)} is dropped`);
    assert.strictEqual(cleanRuns({ [ID]: [{ at: T0, outcome: 'ended', reason: 'app-closed' }] }, ids)[ID][0].reason, 'app-closed', 'a loop end reason is a valid reason');
    // sorted, 500 entries cut to the newest 50
    const many = Array.from({ length: 500 }, (_, i) => ({ at: T0 + ((i * 7919) % 500), outcome: 'sent' }));
    const cut = cleanRuns({ [ID]: many }, ids)[ID];
    assert.strictEqual(cut.length, MAX_RUNS, '500 entries are cut to 50');
    assert.ok(cut.every((r, i) => i === 0 || cut[i - 1].at <= r.at), 'sorted by time');
    assert.strictEqual(cut[MAX_RUNS - 1].at, T0 + 499, 'the newest are kept');
    // a hostile file does not throw and keeps schedules
    assert.strictEqual(parseSchedules(JSON.stringify({ schedules: [{ id: ID, folder: '/w', prompt: 'p', every: 30 }], runs: { [ID]: 'x' } }), T0).schedules.length, 1);
  }

  // ---- FR-036: the log equals last; sessions and reasons ----
  {
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    const r = h.sch.save({ folder: '/w', prompt: 'PROMPT-TEXT', every: 30 }, () => true);
    assert.ok(r.ok);
    const id = r.ok ? r.schedule.id : '';
    assert.deepStrictEqual(log(h, id), [], 'a new schedule has no runs');
    await h.advance(30 * MIN);
    assert.deepStrictEqual(log(h, id), [{ at: T0 + 30 * MIN, outcome: 'sent', session: 'folder-agent' }], 'sent: the session send returned');
    h.busy.add('/w');
    await h.advance(30 * MIN);
    assert.deepStrictEqual(log(h, id).slice(-1)[0], { at: T0 + 60 * MIN, outcome: 'skipped-busy' }, 'a folder schedule skipped busy has no session');
    h.busy.delete('/w');
    lastEqualsNewest(h);
    // no prompt text, path or error text anywhere in the serialised log
    const text = JSON.stringify(h.sch.doc.runs);
    assert.ok(!/PROMPT-TEXT|\/w/.test(text), 'no prompt text or path in the log');
    // Run missed now is manual; a failed send says why
    assert.deepStrictEqual(await h.sch.runNow(id), { ok: true });
    assert.deepStrictEqual(log(h, id).slice(-1)[0], { at: h.now, outcome: 'sent', session: 'folder-agent', manual: true });
    lastEqualsNewest(h);
    // the three reasons
    const f = h.sch.save({ folder: '/fail', prompt: 'x', every: 30 }, () => true);
    const fid = f.ok ? f.schedule.id : '';
    await h.advance(30 * MIN);
    assert.deepStrictEqual(log(h, fid).slice(-1)[0], { at: h.now, outcome: 'failed', reason: 'no-agent' }, 'send said false: no-agent');
    const t = harness({ pausedAll: false, schedules: [] }, T0, { send: async () => { throw new Error('/home/me/secret token abc'); } });
    t.sch.start();
    const tr = t.sch.save({ folder: '/w', prompt: 'x', every: 30 }, () => true);
    const tid = tr.ok ? tr.schedule.id : '';
    await t.advance(30 * MIN);
    assert.deepStrictEqual(log(t, tid), [{ at: T0 + 30 * MIN, outcome: 'failed', reason: 'send-error' }], 'send threw: send-error');
    assert.ok(!/secret|home|token/.test(JSON.stringify(t.sch.doc)), 'the error text is not stored anywhere');
    assert.deepStrictEqual(await t.sch.runNow(tid), { ok: false, error: 'Could not send it.' });
    assert.strictEqual(log(t, tid).slice(-1)[0].manual, true);
    // a targeted schedule: the target is the session of a skip; an ended session pauses it with skipped-ended
    const g = h.sch.save({ folder: '/w', prompt: 'x', every: 30, target: { session: 's1', agent: 'copilot' } }, () => true);
    const gid = g.ok ? g.schedule.id : '';
    h.busy.add('s1');
    await h.advance(30 * MIN);
    assert.deepStrictEqual(log(h, gid).slice(-1)[0], { at: h.now, outcome: 'skipped-busy', session: 's1' }, 'a targeted skip names its session');
    h.busy.delete('s1');
    h.sessions.delete('s1');
    await h.advance(30 * MIN);
    assert.deepStrictEqual(log(h, gid).slice(-1)[0], { at: h.now, outcome: 'skipped-ended', session: 's1' });
    lastEqualsNewest(h);
    assert.ok(log(h, gid).filter((x) => x.outcome === 'skipped-ended').length === 1 && h.sch.doc.schedules.find((x) => x.id === gid)?.paused, 'it paused');
    h.sessions.add('s1');
    // an edit, Pause and Resume keep the log
    const before = JSON.stringify(log(h, id));
    const s0 = h.sch.doc.schedules.find((x) => x.id === id)!;
    assert.ok(h.sch.save({ ...s0, edit: true, prompt: 'changed', every: 30 }, () => true).ok);
    assert.ok(h.sch.save({ ...s0, paused: true }, () => true).ok);
    assert.ok(h.sch.save({ ...s0, paused: false }, () => true).ok);
    assert.strictEqual(JSON.stringify(log(h, id)), before, 'edit, pause and resume keep the log');
    // runsOf: newest first, a copy, empty for an unknown id
    const ro = h.sch.runsOf(id);
    assert.deepStrictEqual(ro.map((x) => x.at), [...ro.map((x) => x.at)].sort((a, b) => b - a), 'newest first');
    ro[0].outcome = 'failed';
    ro.pop();
    assert.strictEqual(JSON.stringify(log(h, id)), before, 'runsOf returns a copy');
    assert.deepStrictEqual(h.sch.runsOf('nope'), []);
    assert.deepStrictEqual(h.sch.runsOf('__proto__'), []);
    // FR-043: the IPC answer checks its argument and is read-only
    assert.deepStrictEqual(runsReply(h.sch, id), { ok: true, runs: h.sch.runsOf(id) });
    assert.deepStrictEqual(runsReply(h.sch, 'unknown-id'), { ok: true, runs: [] }, 'an unknown id gives an empty list');
    assert.deepStrictEqual(runsReply(undefined, id), { ok: true, runs: [] }, 'no scheduler yet: empty');
    for (const bad of [undefined, null, 5, {}, [id], '', 'x'.repeat(65), '../x', 'a b', 'a.b', 'a\nb', '__proto__', 'constructor/..']) assert.deepStrictEqual(runsReply(h.sch, bad), { ok: false }, `refused: ${JSON.stringify(bad)}`);
    assert.deepStrictEqual(Object.keys(runsReply(h.sch, id)).sort(), ['ok', 'runs']);
    const ipcSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'schedules.ts'), 'utf8');
    assert.ok(/ipcHandle\('schedules:runs', \(e, id: unknown\) => \(fromApp\(e\) \? runsReply\(/.test(ipcSrc), 'the channel checks the frame, then the argument');
    assert.ok(!/schedules:(clearRuns|setRuns|runs[A-Z])/.test(ipcSrc), 'no channel writes a log');
    assert.ok(/changed: \(doc\) => toRenderer\('schedules:changed', publicDoc\(doc\)\)/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8')), 'the push carries no runs');
    assert.ok(/ipcHandle\('schedules:list', \(\) => \{[^}]*publicDoc\(/.test(ipcSrc.replace(/\s+/g, ' ')), 'schedules:list carries no runs')
    // the document pushed to the window carries no runs; the saved one does
    assert.strictEqual('runs' in publicDoc(h.sch.doc), false, 'publicDoc has no runs');
    assert.deepStrictEqual(Object.keys(publicDoc(h.sch.doc)).sort(), ['pausedAll', 'schedules']);
    assert.ok('runs' in h.sch.doc);
    // deletion drops the log with the schedule, in the same write
    const saves = h.saved;
    assert.ok(h.sch.remove(id));
    assert.strictEqual(h.sch.doc.runs?.[id], undefined, 'remove drops the log');
    assert.ok(h.saved === saves + 1 && h.sch.doc.runs?.[fid], 'one write; other logs stay');
    h.sch.removeFolder('/fail');
    assert.strictEqual(h.sch.doc.runs?.[fid], undefined, 'removeFolder drops the logs of its schedules');
    assert.ok(h.sch.doc.runs?.[gid], 'a schedule of another folder keeps its log');
  }

  // ---- FR-037: the cap and folding ----
  {
    const h = harness({ pausedAll: false, schedules: [mkSched({ id: ID })] });
    h.sch.start();
    // 60 sent runs: only the newest 50 stay
    for (let i = 0; i < 60; i++) await h.advance(5 * MIN);
    assert.strictEqual(log(h, ID).length, MAX_RUNS, 'the cap is 50');
    assert.strictEqual(log(h, ID)[0].at, T0 + 11 * 5 * MIN, 'the oldest go first');
    lastEqualsNewest(h);
    // busy repeats fold: one entry with a count and until
    h.busy.add('/w');
    for (let i = 0; i < 4; i++) await h.advance(5 * MIN);
    const top = log(h, ID).slice(-1)[0];
    assert.deepStrictEqual([top.outcome, top.n, top.until], ['skipped-busy', 4, h.now], 'four busy skips are one entry with n=4');
    assert.strictEqual(log(h, ID).length, MAX_RUNS, 'a fold does not push an entry out');
    lastEqualsNewest(h);
    // another outcome in between: no folding across it
    h.busy.delete('/w');
    await h.advance(5 * MIN);
    h.busy.add('/w');
    await h.advance(5 * MIN);
    const tail = log(h, ID).slice(-3).map((x) => [x.outcome, x.n]);
    assert.deepStrictEqual(tail, [['skipped-busy', 4], ['sent', undefined], ['skipped-busy', undefined]], 'a sent run in between starts a new entry');
    // paused repeats fold too, and sent never folds
    h.busy.clear();
    h.sch.setPausedAll(true);
    for (let i = 0; i < 3; i++) await h.advance(5 * MIN);
    assert.deepStrictEqual(log(h, ID).slice(-1)[0].n, 3);
    h.sch.setPausedAll(false);
    await h.advance(5 * MIN);
    await h.advance(5 * MIN);
    assert.deepStrictEqual(log(h, ID).slice(-2).map((x) => [x.outcome, x.n]), [['sent', undefined], ['sent', undefined]], 'sent never folds');
  }
  // a skip with another session does not fold; missed/failed never fold
  {
    const h = harness({ pausedAll: false, schedules: [mkSched({ id: ID, target: { session: 's1', agent: 'copilot' } }), mkSched({ id: 'bbbbbbbb-2222', target: { session: 's2', agent: 'copilot' } })] });
    h.sch.start();
    h.busy.add('s1');
    h.busy.add('s2');
    await h.advance(5 * MIN);
    await h.advance(5 * MIN);
    assert.deepStrictEqual(log(h, ID).map((x) => [x.outcome, x.session, x.n]), [['skipped-busy', 's1', 2]], 'per schedule');
    // the same log, edited to another target: the next skip has another session and does not fold
    const s = h.sch.doc.schedules[0];
    assert.ok(h.sch.save({ ...s, edit: true, target: { session: 's2', agent: 'copilot' } }, () => true).ok);
    await h.advance(5 * MIN);
    assert.deepStrictEqual(log(h, ID).map((x) => [x.session, x.n]), [['s1', 2], ['s2', undefined]], 'another session: no fold');
    const f = harness({ pausedAll: false, schedules: [mkSched({ id: ID, folder: '/fail' })] });
    f.sch.start();
    await f.advance(5 * MIN);
    await f.advance(5 * MIN);
    assert.deepStrictEqual(log(f, ID).map((x) => [x.outcome, x.n]), [['failed', undefined], ['failed', undefined]], 'failed never folds');
  }
  // missed at start
  {
    const h = harness({ pausedAll: false, schedules: [mkSched({ id: ID, next: T0 - 10 * MIN }), mkSched({ id: 'bbbbbbbb-2222', every: undefined, next: undefined, at: T0 - 5 * MIN })] });
    h.sch.start();
    assert.deepStrictEqual(log(h, ID), [{ at: T0, outcome: 'missed' }]);
    assert.deepStrictEqual(log(h, 'bbbbbbbb-2222'), [{ at: T0, outcome: 'missed' }]);
    lastEqualsNewest(h);
  }

  // ---- FR-037: a fold is not an immediate write ----
  {
    const h = harness({ pausedAll: true, schedules: [mkSched({ id: ID })] });
    let pushed = 0;
    const h2 = harness({ pausedAll: true, schedules: [mkSched({ id: ID })] }, T0, { changed: () => { pushed++; } });
    h2.sch.start();
    const s0 = h2.saved;
    let maxSince = 0;
    for (let i = 0; i < 12; i++) {
      await h2.advance(5 * MIN);
      maxSince = h2.saved - s0;
    }
    assert.ok(maxSince <= 2, `an every-5-minutes schedule under Pause all for 1 h writes at most twice (wrote ${maxSince})`);
    assert.strictEqual(log(h2, ID).slice(-1)[0].n, 12, 'the folds were counted');
    assert.ok(pushed >= 12, 'the window is told at every tick');
    // a real change writes the dirty state; flush writes it too; flush with nothing dirty does not write
    const before = h2.saved;
    h2.sch.flush();
    assert.ok(h2.saved <= before + 1);
    const b2 = h2.saved;
    h2.sch.flush();
    assert.strictEqual(h2.saved, b2, 'nothing dirty: no write');
    await h2.advance(5 * MIN);
    assert.strictEqual(h2.saved, b2, 'a fold marks dirty only');
    h2.sch.flush();
    assert.strictEqual(h2.saved, b2 + 1, 'flush writes the dirty state');
    await h2.advance(5 * MIN);
    h2.sch.setPausedAll(false);
    assert.strictEqual(h2.saved, b2 + 2, 'a real change writes it');
    // after 60 minutes of folds only, the timer writes
    h2.sch.setPausedAll(true);
    await h2.advance(5 * MIN);
    const b3 = h2.saved;
    await h2.advance(61 * MIN);
    assert.ok(h2.saved >= b3 + 1 && h2.saved <= b3 + 2, 'within 60 minutes a fold-only change is written');
    void h;
  }
  // one-time schedules and state changes are written at once
  {
    const h = harness({ pausedAll: true, schedules: [] });
    h.sch.start();
    const r = h.sch.save({ folder: '/w', prompt: 'x', at: T0 + 10 * MIN }, () => true);
    const s0 = h.saved;
    await h.advance(10 * MIN);
    assert.ok(h.saved > s0 && h.sch.doc.schedules[0].done, 'a one-time schedule going done is a real change');
    void r;
  }

  // ---- FR-037 pass/fail: a full document is cheap to write ----
  {
    const schedules = Array.from({ length: 50 }, (_, i) => ({ id: `sched-${String(i).padStart(4, '0')}-${'a'.repeat(20)}`, folder: '/work/folder-' + i, prompt: 'x'.repeat(200), every: 30, next: T0 }) as Schedule);
    const runs: Record<string, ScheduleRun[]> = {};
    for (const s of schedules) runs[s.id] = Array.from({ length: 50 }, (_, i) => ({ at: T0 + i * MIN, outcome: i % 7 ? 'sent' : 'skipped-busy', session: 'agent-' + (i % 5) + '-' + 'b'.repeat(24), ...(i % 7 ? {} : { n: 3, until: T0 + i * MIN + 5 }) }) as ScheduleRun);
    const doc: SchedulesDoc = { pausedAll: false, schedules, runs };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-runs-'));
    const file = path.join(dir, 'durbar-schedules.json');
    const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
    saveSchedules(file, doc); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = cpu();
      saveSchedules(file, doc);
      times.push(cpu() - a);
    }
    times.sort((a, b) => a - b);
    console.log(`[schedules-runs] full 50x50 document: ${Math.round(fs.statSync(file).size / 1024)} KB, median ${times[2].toFixed(1)} ms CPU`);
    assert.ok(times[2] < 25, `serialising and writing a full document takes under 25 ms of CPU (median ${times[2].toFixed(1)} ms)`);
    // and it reads back whole
    const back = loadSchedules(file, T0);
    assert.strictEqual(Object.values(back.runs ?? {}).reduce((n, l) => n + l.length, 0), 2500);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- FR-036: a loop pass is one entry ----
  {
    // (the loop wiring is exercised in test-loops.ts; here the record rules of a pass)
    const { loopSupport } = await import('../src/main/schedules');
    loopSupport.enabled = true;
    const now = T0;
    let hh: ReturnType<typeof harness> | undefined;
    const h = harness({ pausedAll: false, schedules: [] }, T0, { mono: () => hh?.now ?? 0 }); // the loop's minimum between passes runs on the fake clock
    hh = h;
    h.sch.start();
    const r = h.sch.save({ folder: '/w', prompt: 'p', target: { session: 's1', agent: 'copilot' }, cap: { amount: 100, unit: 'aiu' }, loop: { minDelay: 5, maxDelay: 60, defaultDelay: 10, maxPasses: 5, endAt: now + 3 * 3_600_000 } }, () => true);
    assert.ok(r.ok);
    const id = r.ok ? r.schedule.id : '';
    await h.advance(0);
    assert.deepStrictEqual(log(h, id).map((x) => [x.outcome, x.session]), [['sent', 's1']], 'the pass that went out is one entry');
    h.sch.turnEnded('s1', { finalText: 'done\nLOOP: next 10 min' });
    assert.strictEqual(log(h, id).length, 1, 'the end of a good pass updates it, not adds');
    lastEqualsNewest(h);
    await h.advance(10 * MIN);
    assert.strictEqual(log(h, id).length, 2);
    h.sch.turnEnded('s1', { error: true });
    assert.deepStrictEqual(log(h, id).map((x) => x.outcome), ['sent', 'failed'], 'a pass that ends failed turns its entry into failed');
    lastEqualsNewest(h);
    h.sch.stopLoop(id);
    assert.deepStrictEqual(log(h, id).slice(-1)[0], { at: h.now, outcome: 'ended', session: 's1', reason: 'user' });
    lastEqualsNewest(h);
    loopSupport.enabled = false;
  }

  // ---- FR-044: the simulator keeps the same log with the same rules ----
  {
    // cut the simulator's `simRecord` out of sim.ts, compile it and run one sequence through it and through main's `record`
    const ts = require('typescript') as typeof import('typescript');
    const simSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'sim.ts'), 'utf8');
    const block = simSrc.slice(simSrc.indexOf('/* simrecord:begin */'), simSrc.indexOf('/* simrecord:end */'));
    assert.ok(block.includes('const simRecord'), 'the simulator marks its record helper');
    const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const simRecord = new Function(js + '\nreturn simRecord;')() as (sc: Record<string, unknown>, runs: Record<string, ScheduleRun[]>, outcome: string, now: number, x?: Record<string, unknown>) => boolean;
    type Step = [string, number, Record<string, unknown>?];
    const steps: Step[] = [];
    let at = T0;
    const push = (o: string, x?: Record<string, unknown>): void => { at += MIN; steps.push([o, at, x]); };
    for (let i = 0; i < 4; i++) push('skipped-busy');
    push('skipped-busy', { session: 's1' });
    push('sent', { session: 's1' });
    for (let i = 0; i < 3; i++) push('skipped-paused', { session: 's2' });
    push('failed', { reason: 'no-agent' });
    push('failed', { reason: 'send-error' });
    push('sent', { session: 's2', manual: true });
    for (let i = 0; i < 2; i++) push('held');
    push('skipped-door-full');
    push('skipped-door-full');
    push('missed');
    push('missed');
    push('sent', { session: 'bad session!' });
    for (let i = 0; i < 70; i++) push(i % 3 === 0 ? 'sent' : 'skipped-busy', { session: 's' + (i % 2) });
    const h = harness({ pausedAll: false, schedules: [mkSched({ id: ID })] });
    const simSc: Record<string, unknown> = { id: ID };
    const simRuns: Record<string, ScheduleRun[]> = {};
    const mainSc = h.sch.doc.schedules[0];
    for (const [o, when, x] of steps) {
      const a = simRecord(simSc, simRuns, o, when, x);
      const b = (h.sch as unknown as { record(s: Schedule, o: string, n: number, x?: unknown): boolean }).record(mainSc, o, when, x);
      assert.strictEqual(a, b, `folded or not: ${o} at ${when}`);
      assert.deepStrictEqual(simSc.last, mainSc.last, 'same last');
    }
    assert.deepStrictEqual(simRuns[ID], log(h, ID), 'the simulator and main keep the same log for one sequence');
    assert.strictEqual(log(h, ID).length, MAX_RUNS, 'the sequence goes past the cap');
    const loopSteps: Step[] = [['sent', T0 + 1_000_000_000, { session: 's1' }]];
    const h2 = harness({ pausedAll: false, schedules: [mkSched({ id: ID })] });
    const sr: Record<string, ScheduleRun[]> = {};
    const sc2: Record<string, unknown> = { id: ID };
    for (const [o, when, x] of loopSteps) { simRecord(sc2, sr, o, when, x); simRecord(sc2, sr, 'failed', when + 1, { session: 's1', update: true }); (h2.sch as unknown as { record(s: Schedule, o: string, n: number, x?: unknown): boolean }).record(h2.sch.doc.schedules[0], o, when, x); (h2.sch as unknown as { record(s: Schedule, o: string, n: number, x?: unknown): boolean }).record(h2.sch.doc.schedules[0], 'failed', when + 1, { session: 's1', update: true }); }
    assert.deepStrictEqual(sr[ID], log(h2, ID), 'the same update rule (a pass that ended failed)');
    // the sim's seed history follows the rules too: newest entry equals last, and nothing in it is text
    assert.ok(/simRecord\(s1, simSched\.runs, 'skipped-busy'/.test(simSrc) && /sim-gone-7/.test(simSrc), 'the seed history has a folded busy skip and a run to a chat that is gone');
  }

  // ---- Scheduler stays a class that keeps `doc` reachable for main ----
  assert.strictEqual(typeof Scheduler.prototype.flush, 'function');
  console.log('[schedules-runs] all checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
