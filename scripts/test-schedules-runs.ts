/** Scheduled prompts (spec 044 FR-036..FR-039, FR-043): the run log kept by main. Part of `npm run test:schedules`. Fake clock, no session, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_FOLD, MAX_RUNS, Scheduler, cleanRuns, runsReply, loadSchedules, parseSchedules, publicDoc, saveSchedules } from '../src/main/schedules';
import type { LoadIo, SaveIo, Schedule, ScheduleRun, SchedulesDoc } from '../src/main/schedules';
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
const TMP = (f: string): string => `${f}.${process.pid}.tmp`;
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
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
    const bq = mainSrc.slice(mainSrc.indexOf("app.on('before-quit'"));
    assert.ok(/scheduler\?\.flush\(\)/.test(bq.slice(0, bq.indexOf('\n});'))), 'the one before-quit handler writes a pending fold-only change (FR-037)');
    const wq = mainSrc.slice(mainSrc.indexOf("app.on('will-quit', () => {"));
    assert.ok(/scheduler\?\.flush\(\)/.test(wq.slice(0, wq.indexOf('\n});'))), 'will-quit writes it too (folds counted in the dispose window)');
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

  // a schedule deleted while its run is being sent leaves no orphan log behind (FR-039)
  {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ pausedAll: false, schedules: [mkSched({ id: ID })] }, T0, { send: async () => { await gate; return 'folder-agent'; } });
    h.sch.start();
    const run = h.advance(5 * MIN);
    await new Promise((r) => setImmediate(r));
    assert.ok(h.sch.remove(ID), 'deleted while the send is awaited');
    release();
    await run;
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(h.sch.doc.runs, undefined, 'no orphan log for a deleted schedule');
    assert.ok(!JSON.stringify(h.sch.doc).includes(ID));
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
    // ... also when its run folds into the previous entry of the same skip (edited to run again, busy again): the done flag is not a late write
    h.busy.add('/w');
    const one = h.sch.save({ folder: '/w', prompt: 'again', at: h.now + 10 * MIN }, () => true);
    const oid = one.ok ? one.schedule.id : '';
    await h.advance(10 * MIN);
    assert.deepStrictEqual(log(h, oid).map((x) => [x.outcome, x.n]), [['skipped-paused', undefined]], 'paused once');
    h.sch.setPausedAll(false);
    assert.ok(h.sch.save({ id: oid, edit: true, folder: '/w', prompt: 'again', at: h.now + 10 * MIN }, () => true).ok, 'edited to run again');
    h.sch.setPausedAll(true);
    const s1 = h.saved;
    await h.advance(10 * MIN);
    assert.deepStrictEqual(log(h, oid).map((x) => [x.outcome, x.n]), [['skipped-paused', 2]], 'the same skip folded');
    assert.ok(h.sch.doc.schedules.find((x) => x.id === oid)?.done && h.saved > s1, 'a one-time schedule going done is written at once, even when its run folded');
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
    // the cost measured is building, serialising and writing the document, not the disk's flush: fsync is a no-op here (the real one is covered by the ordering test below)
    const cpuIo: SaveIo = { platform: process.platform, pause: () => undefined, fs: { existsSync: fs.existsSync, openSync: fs.openSync, writeSync: fs.writeSync, closeSync: fs.closeSync, renameSync: fs.renameSync, rmSync: fs.rmSync, fsyncSync: (() => undefined) as typeof fs.fsyncSync } };
    saveSchedules(file, doc, cpuIo); // warm-up
    // CPU time, median of 5; under a loaded machine (a parallel tsc) one round can be slow, so up to 3 rounds, the best counts
    const rounds: number[] = [];
    for (let k = 0; k < 3; k++) {
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const a = cpu();
        saveSchedules(file, doc, cpuIo);
        times.push(cpu() - a);
      }
      times.sort((x, y) => x - y);
      rounds.push(times[2]);
      if (times[2] < 25) break;
    }
    const best = Math.min(...rounds);
    console.log(`[schedules-runs] full 50x50 document: ${Math.round(fs.statSync(file).size / 1024)} KB, median ${best.toFixed(1)} ms CPU`);
    assert.ok(best < 25, `serialising and writing a full document takes under 25 ms of CPU (medians ${rounds.map((x) => x.toFixed(1)).join(', ')} ms)`);
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

  // ---- spec 044 FR-124 (issue #843): a loop whose stored prompt is over the limit sends nothing and waits one pass ----
  {
    const { loopSupport } = await import('../src/main/schedules');
    loopSupport.enabled = true;
    const h = harness({ pausedAll: false, schedules: [] }, T0);
    h.sch.start();
    const r = h.sch.save({ folder: '/w', prompt: 'p', target: { session: 's1', agent: 'copilot' }, cap: { amount: 100, unit: 'aiu' }, loop: { minDelay: 5, maxDelay: 60, defaultDelay: 10, maxPasses: 5, endAt: T0 + 3 * 3_600_000 } }, () => true);
    assert.ok(r.ok);
    const id = r.ok ? r.schedule.id : '';
    h.sch.doc.schedules[0].prompt = 'z'.repeat(12_000); // as a hand-edited file would hold it
    await h.advance(0);
    assert.deepStrictEqual(h.sent, [], 'no pass is sent');
    assert.deepStrictEqual(log(h, id).map((x) => [x.outcome, x.session]), [['skipped-review', 's1']], 'the skip is recorded');
    assert.strictEqual(h.sch.doc.schedules[0].next, h.now + 10 * MIN, 'the next wake is one pass away');
    assert.ok(!h.sch.doc.schedules[0].loop?.inPass && !h.sch.doc.schedules[0].loop?.passes, 'and no pass started');
    await h.advance(10 * MIN);
    assert.deepStrictEqual(h.sent, [], 'still nothing sent');
    assert.strictEqual(log(h, id).length, 1, 'a repeat folds');
    assert.strictEqual(log(h, id)[0].n, 2);
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
    push('skipped-review');
    push('skipped-review');
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
    // an id that is also a name on Object.prototype, and a fold count at its cap, go through both the same way
    const mk2 = harness({ pausedAll: false, schedules: [mkSched({ id: 'constructor' })] });
    const simSc2: Record<string, unknown> = { id: 'constructor' };
    const simRuns2: Record<string, ScheduleRun[]> = {};
    const rec = (o: string, when: number, x?: Record<string, unknown>): void => {
      simRecord(simSc2, simRuns2, o, when, x);
      (mk2.sch as unknown as { record(s: Schedule, o: string, n: number, x?: unknown): boolean }).record(mk2.sch.doc.schedules[0], o, when, x);
    };
    rec('skipped-busy', T0 + 1);
    rec('skipped-busy', T0 + 2);
    const own = (o: Record<string, ScheduleRun[]>): ScheduleRun[] => Object.getOwnPropertyDescriptor(o, 'constructor')?.value as ScheduleRun[];
    own(simRuns2)[0].n = MAX_FOLD;
    log(mk2, 'constructor')[0].n = MAX_FOLD;
    rec('skipped-busy', T0 + 3);
    assert.strictEqual(own(simRuns2)[0].n, MAX_FOLD, 'the simulator caps the fold count');
    assert.deepStrictEqual(own(simRuns2), log(mk2, 'constructor'), 'same log for the inherited-name id and a capped count');
    const loopSteps: Step[] = [['sent', T0 + 1_000_000_000, { session: 's1' }]];
    const h2 = harness({ pausedAll: false, schedules: [mkSched({ id: ID })] });
    const sr: Record<string, ScheduleRun[]> = {};
    const sc2: Record<string, unknown> = { id: ID };
    for (const [o, when, x] of loopSteps) { simRecord(sc2, sr, o, when, x); simRecord(sc2, sr, 'failed', when + 1, { session: 's1', update: true }); (h2.sch as unknown as { record(s: Schedule, o: string, n: number, x?: unknown): boolean }).record(h2.sch.doc.schedules[0], o, when, x); (h2.sch as unknown as { record(s: Schedule, o: string, n: number, x?: unknown): boolean }).record(h2.sch.doc.schedules[0], 'failed', when + 1, { session: 's1', update: true }); }
    assert.deepStrictEqual(sr[ID], log(h2, ID), 'the same update rule (a pass that ended failed)');
    // the sim's seed history follows the rules too: newest entry equals last, and nothing in it is text
    assert.ok(/simRecord\(s1, simSched\.runs, 'skipped-busy'/.test(simSrc) && /sim-gone-7/.test(simSrc), 'the seed history has a folded busy skip and a run to a chat that is gone');
  }

  // ---- ids that are also names on Object.prototype are valid schedule ids and must not break the log ----
  {
    const ids = ['constructor', 'toString', 'hasOwnProperty'];
    const file = JSON.stringify({ pausedAll: false, schedules: ids.map((id, i) => ({ id, folder: i === 0 ? '/fail' : '/w', prompt: 'p', every: 5, next: T0 - 10 * MIN })), runs: { constructor: [{ at: 5, outcome: 'sent' }], toString: 'nope' } });
    const doc = parseSchedules(file, T0);
    assert.deepStrictEqual(doc.schedules.map((s) => s.id), ids, 'such ids load');
    assert.deepStrictEqual(Object.keys(doc.runs ?? {}), ['constructor'], 'a log under such an id is read as its own');
    const h = harness(doc);
    h.sch.start(); // records `missed` for each: must not throw
    await h.advance(5 * MIN);
    await h.advance(5 * MIN);
    for (const id of ids) {
      assert.ok(Array.isArray(h.sch.doc.runs?.[id]) && log(h, id).length >= 2, `${id}: runs recorded`);
      assert.ok(h.sch.runsOf(id).length >= 2);
    }
    assert.ok(log(h, 'constructor').some((r) => r.outcome === 'failed'), 'the failing folder under "constructor" recorded its failure');
    assert.ok(h.sch.remove('toString') && h.sch.runsOf('toString').length === 0);
    const again = parseSchedules(JSON.stringify(h.sch.doc), T0);
    assert.ok(again.runs && Array.isArray(again.runs.hasOwnProperty) === true, 'written and read back');
  }

  // ---- a loop pass whose send fails is a new entry, never an update of the pass before ----
  {
    const { loopSupport } = await import('../src/main/schedules');
    loopSupport.enabled = true;
    let failSend = false;
    let hh: ReturnType<typeof harness> | undefined;
    const h = harness({ pausedAll: false, schedules: [] }, T0, { mono: () => hh?.now ?? 0, send: async (_f, _p, s) => (failSend ? false : s.target?.session ?? 'x') });
    hh = h;
    h.sch.start();
    const r = h.sch.save({ folder: '/w', prompt: 'p', target: { session: 's1', agent: 'copilot' }, cap: { amount: 100, unit: 'aiu' }, loop: { minDelay: 5, maxDelay: 60, defaultDelay: 10, maxPasses: 9, endAt: T0 + 3 * 3_600_000 } }, () => true);
    const id = r.ok ? r.schedule.id : '';
    await h.advance(0);
    h.sch.turnEnded('s1', { finalText: 'ok\nLOOP: next 5 min' });
    failSend = true;
    await h.advance(5 * MIN);
    await h.advance(10 * MIN);
    assert.deepStrictEqual(log(h, id).map((x) => x.outcome), ['sent', 'failed', 'failed', 'ended'], 'good pass, two failed sends, loop ended: four entries');
    assert.deepStrictEqual(log(h, id).slice(1, 3).map((x) => x.reason), ['no-agent', 'no-agent']);
    loopSupport.enabled = false;
  }

  // ---- a torn write cannot lose the schedules: written beside the file and renamed over it ----
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-torn-'));
    const file = path.join(dir, 'durbar-schedules.json');
    const doc: SchedulesDoc = { pausedAll: false, schedules: [mkSched({ id: ID })], runs: { [ID]: [{ at: T0, outcome: 'sent' }] } };
    saveSchedules(file, doc);
    assert.ok(!fs.existsSync(TMP(file)), 'no temp file is left');
    assert.strictEqual(loadSchedules(file, T0).schedules.length, 1);
    // the temp path cannot be written (a directory stands there): the write fails, the old file stays whole
    fs.mkdirSync(TMP(file));
    saveSchedules(file, { pausedAll: true, schedules: [], runs: {} });
    assert.strictEqual(loadSchedules(file, T0).schedules.length, 1, 'a failed write leaves the previous file whole');
    fs.rmSync(TMP(file), { recursive: true });
    saveSchedules(file, { pausedAll: true, schedules: [], runs: {} });
    assert.strictEqual(loadSchedules(file, T0).pausedAll, true, 'and the next write goes through');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'the file is private (0600)');
    // a failed rename (a non-empty directory stands at the target) leaves no temp file and reports the failure
    const blocked = path.join(dir, 'blocked.json');
    fs.mkdirSync(blocked);
    fs.writeFileSync(path.join(blocked, 'x'), 'x');
    assert.strictEqual(saveSchedules(blocked, doc), false, 'a failed rename is reported');
    assert.ok(!fs.existsSync(TMP(blocked)), 'and no temp file is left');
    assert.strictEqual(saveSchedules(file, doc), true);
    // win32: a busy file is retried once after a short pause; another platform does not retry; a second failure is a failure
    for (const [platform, code, want, renames] of [['win32', 'EPERM', true, 2], ['win32', 'EBUSY', true, 2], ['linux', 'EPERM', false, 1], ['win32', 'ENOSPC', false, 1]] as const) {
      let n = 0, paused = 0;
      const io: SaveIo = { platform, pause: () => { paused++; }, fs: { existsSync: fs.existsSync, openSync: fs.openSync, writeSync: fs.writeSync, fsyncSync: fs.fsyncSync, closeSync: fs.closeSync, rmSync: fs.rmSync, renameSync: ((a: string, b: string) => { if (++n === 1) throw Object.assign(new Error('busy'), { code }); fs.renameSync(a, b); }) as typeof fs.renameSync } };
      assert.strictEqual(saveSchedules(file, doc, io), want, `${platform} ${code}`);
      assert.strictEqual(n, renames, `${platform} ${code}: renames tried`);
      assert.strictEqual(paused, want ? 1 : 0);
      assert.ok(!fs.existsSync(TMP(file)), 'no temp file left');
    }
    // the temp name carries the process id (two instances never share one), and the data is fsynced before the rename
    const order: string[] = [];
    const seen: string[] = [];
    const spy: SaveIo = { platform: 'linux', pause: () => undefined, fs: { existsSync: fs.existsSync, openSync: ((f: string, ...r: unknown[]) => { seen.push(f); return (fs.openSync as (...a: unknown[]) => number)(f, ...r); }) as typeof fs.openSync, writeSync: fs.writeSync, closeSync: fs.closeSync, rmSync: fs.rmSync,
      fsyncSync: ((fd: number) => { order.push('fsync'); fs.fsyncSync(fd); }) as typeof fs.fsyncSync, renameSync: ((a: string, b: string) => { order.push('rename'); fs.renameSync(a, b); }) as typeof fs.renameSync } };
    assert.strictEqual(saveSchedules(file, doc, spy), true);
    assert.deepStrictEqual(order, ['fsync', 'rename'], 'fsync before the rename');
    assert.deepStrictEqual(seen, [TMP(file)], 'the temp file is named with the process id');
    assert.ok(TMP(file).includes(`.${process.pid}.`));
    // an fsync that fails is only best effort
    const noSync: SaveIo = { ...spy, fs: { ...spy.fs, fsyncSync: (() => { throw new Error('EINVAL'); }) as typeof fs.fsyncSync } };
    assert.strictEqual(saveSchedules(file, doc, noSync), true, 'a failing fsync does not fail the save');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- a file that cannot be read is set aside, never overwritten (FR-038) ----
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-bad-'));
    const file = path.join(dir, 'durbar-schedules.json');
    assert.deepStrictEqual(loadSchedules(file, T0), { pausedAll: false, schedules: [] }, 'no file: empty, nothing set aside');
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    for (const [i, content] of ['{"schedules":[{"id":"aaaaaaaa-1","folder":"/w","prompt":"precious","every":30}', '', '[1,2]', 'null'].entries()) {
      fs.writeFileSync(file, content);
      const d = loadSchedules(file, T0 + i);
      assert.deepStrictEqual(d, { pausedAll: false, schedules: [] }, 'a corrupt file loads as no schedules');
      assert.ok(!fs.existsSync(file), 'and is moved away');
      assert.ok(saveSchedules(file, d), 'the next save writes a fresh file');
      const bad = fs.readdirSync(dir).filter((f) => f.includes('.bad-'));
      assert.ok(bad.some((f) => fs.readFileSync(path.join(dir, f), 'utf8') === content), `the corrupt content is kept in a .bad file (${content.slice(0, 20)})`);
      for (const f of fs.readdirSync(dir)) if (f !== path.basename(file)) fs.rmSync(path.join(dir, f));
      fs.rmSync(file);
    }
    // two corrupt files at the same time do not overwrite each other's .bad
    fs.writeFileSync(file, 'x1'); loadSchedules(file, T0);
    fs.writeFileSync(file, 'x2'); loadSchedules(file, T0);
    assert.deepStrictEqual(fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).sort(), ['x1', 'x2']);
    // unreadable (not merely missing): a directory stands where the file should be; it is set aside too, not read over
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true });
    fs.mkdirSync(file);
    assert.deepStrictEqual(loadSchedules(file, T0), { pausedAll: false, schedules: [] });
    assert.ok(!fs.existsSync(file) && fs.readdirSync(dir).some((f) => f.includes('.bad-')), 'an unreadable file is moved to a .bad file');
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true });
    // a good file is left alone
    fs.writeFileSync(file, JSON.stringify({ pausedAll: false, schedules: [mkSched({ id: ID })] }));
    assert.strictEqual(loadSchedules(file, T0).schedules.length, 1);
    assert.ok(fs.existsSync(file));
    fs.rmSync(dir, { recursive: true, force: true });
  }


  // ---- a file that could not be set aside is never written over (FR-038) ----
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-pend-'));
    const file = path.join(dir, 'durbar-schedules.json');
    const doc: SchedulesDoc = { pausedAll: false, schedules: [mkSched({ id: ID })] };
    const ebusy = (): never => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    fs.writeFileSync(file, 'CORRUPT {');
    const lio: LoadIo = { fs: { readFileSync: fs.readFileSync, existsSync: fs.existsSync, readdirSync: fs.readdirSync, rmSync: fs.rmSync, renameSync: ebusy as typeof fs.renameSync }, pause: () => undefined, alive: () => true, pid: process.pid };
    assert.deepStrictEqual(loadSchedules(file, T0, lio), { pausedAll: false, schedules: [] }, 'loaded empty');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'CORRUPT {', 'the move failed: the file is still there');
    let renames = 0, opened = 0, exists = 0;
    const busy: SaveIo = { platform: 'linux', pause: () => undefined, fs: { existsSync: ((f: string) => { exists++; return fs.existsSync(f); }) as typeof fs.existsSync, openSync: ((...r: Parameters<typeof fs.openSync>) => { opened++; return fs.openSync(...r); }) as typeof fs.openSync, writeSync: fs.writeSync, fsyncSync: fs.fsyncSync, closeSync: fs.closeSync, rmSync: fs.rmSync, renameSync: ((): never => { renames++; return ebusy(); }) as typeof fs.renameSync } };
    assert.strictEqual(saveSchedules(file, doc, busy), false, 'the save is refused while the file cannot be moved');
    assert.ok(renames >= 1, 'it retried the move first');
    assert.strictEqual(opened, 0, 'and wrote nothing, not even a temp file');
    assert.ok(exists >= 1, 'the retry of the move uses the injected existsSync, not the real fs');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'CORRUPT {', 'the corrupt content is still in place');
    assert.deepStrictEqual(fs.readdirSync(dir), ['durbar-schedules.json'], 'no temp file, no write');
    assert.strictEqual(saveSchedules(file, doc), true, 'once the move works, the save goes through');
    const bad = fs.readdirSync(dir).filter((f) => f.includes('.bad-'));
    assert.ok(bad.length === 1 && fs.readFileSync(path.join(dir, bad[0]), 'utf8') === 'CORRUPT {', 'the corrupt content is in the .bad file');
    assert.strictEqual(loadSchedules(file, T0).schedules.length, 1, 'and the new file is the fresh one');
    assert.strictEqual(saveSchedules(file, doc), true, 'nothing is pending any more');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- stale temp files of a dead process are removed at load (they may hold prompt text) ----
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-stale-'));
    const file = path.join(dir, 'durbar-schedules.json');
    fs.writeFileSync(file, JSON.stringify({ pausedAll: false, schedules: [] }));
    const mine = process.pid, live = 111, dead = 222;
    const names = [`${dead}`, `${live}`, `${mine}`, '0', '999999999999'].map((x) => `durbar-schedules.json.${x}.tmp`)
      .concat(['durbar-schedules.json.tmp', 'durbar-schedules.json.abc.tmp', `durbar-schedules.json.${dead}.tmp.bak`, `other.json.${dead}.tmp`, `x-durbar-schedules.json.${dead}.tmp`, `durbar-schedules.json.${dead}x.tmp`]);
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'PROMPT');
    const lio: LoadIo = { fs: { readFileSync: fs.readFileSync, existsSync: fs.existsSync, readdirSync: fs.readdirSync, renameSync: fs.renameSync, rmSync: fs.rmSync }, pause: () => undefined, alive: (p) => p === live, pid: mine };
    loadSchedules(file, T0, lio);
    const left = fs.readdirSync(dir);
    assert.ok(!left.includes(`durbar-schedules.json.${dead}.tmp`), 'a dead process\'s temp file is removed');
    for (const keep of [`${live}`, `${mine}`].map((x) => `durbar-schedules.json.${x}.tmp`).concat(names.slice(5))) assert.ok(left.includes(keep), `kept: ${keep}`);
    assert.ok(left.includes('durbar-schedules.json.0.tmp') && left.includes('durbar-schedules.json.999999999999.tmp'), 'ids that are not a process id are left alone');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- a read error on a good file is retried once before the file is set aside ----
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-retry-'));
    const file = path.join(dir, 'durbar-schedules.json');
    const good = JSON.stringify({ pausedAll: true, schedules: [] });
    fs.writeFileSync(file, good);
    for (const [fails, moved] of [[1, false], [2, true]] as const) {
      fs.writeFileSync(file, good);
      for (const f of fs.readdirSync(dir)) if (f !== 'durbar-schedules.json') fs.rmSync(path.join(dir, f));
      let reads = 0, paused = 0;
      const lio: LoadIo = { fs: { existsSync: fs.existsSync, readdirSync: fs.readdirSync, renameSync: fs.renameSync, rmSync: fs.rmSync, readFileSync: ((f: string, e: BufferEncoding) => { if (++reads <= fails) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return fs.readFileSync(f, e); }) as typeof fs.readFileSync }, pause: (ms) => { paused += ms; }, alive: () => true, pid: process.pid };
      const d = loadSchedules(file, T0, lio);
      assert.strictEqual(paused, 200, 'one short pause');
      assert.strictEqual(d.pausedAll, !moved, moved ? 'two failures: empty' : 'one failure: the good file loaded');
      assert.strictEqual(fs.existsSync(file), !moved, moved ? 'two failures: set aside' : 'one failure: not moved');
    }
    // invalid content is not retried
    fs.writeFileSync(file, '{');
    let p = 0;
    loadSchedules(file, T0, { fs: { readFileSync: fs.readFileSync, existsSync: fs.existsSync, readdirSync: fs.readdirSync, renameSync: fs.renameSync, rmSync: fs.rmSync }, pause: () => { p++; }, alive: () => true, pid: process.pid });
    assert.strictEqual(p, 0, 'invalid content is set aside at once');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- a failed write is not forgotten (FR-037) ----
  {
    let fail = true;
    let calls = 0;
    const h = harness({ pausedAll: false, schedules: [mkSched({ id: ID })] }, T0, { save: () => { calls++; return fail ? false : true; } });
    h.sch.start(); // the write fails
    assert.strictEqual(calls, 1);
    h.sch.flush();
    assert.strictEqual(calls, 2, 'a dirty (failed) state is written again by the quit flush');
    fail = false;
    await h.advance(61 * MIN); // the retry timer
    assert.ok(calls >= 3, 'the timer retries');
    const c = calls;
    h.sch.flush();
    assert.strictEqual(calls, c, 'once written, nothing is dirty');
  }

  // ---- the fold count stays within what a load accepts ----
  {
    const h = harness({ pausedAll: true, schedules: [mkSched({ id: ID })] });
    h.sch.start();
    await h.advance(5 * MIN);
    log(h, ID)[0].n = MAX_FOLD;
    await h.advance(5 * MIN);
    assert.strictEqual(log(h, ID)[0].n, MAX_FOLD, 'n is capped');
    assert.strictEqual(cleanRuns(JSON.parse(JSON.stringify(h.sch.doc.runs)), [ID])[ID][0].n, MAX_FOLD, 'and still loads');
  }

  // ---- Scheduler stays a class that keeps `doc` reachable for main ----
  assert.strictEqual(typeof Scheduler.prototype.flush, 'function');
  console.log('[schedules-runs] all checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
