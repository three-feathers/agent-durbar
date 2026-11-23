/**
 * Unit test (spec 117 FR-386): the fast lane, scripts/fast-lane.js and .github/workflows/fast-lane.yml. The runner runs only names on
 * scripts/test-suites.txt, compiles only the picked test files, builds the app only for a suite that reads dist/; the workflow is
 * advisory and safe for fork PRs (pull_request only, no secrets, read-only token, no kept credential, PR-number concurrency group).
 * No git, no network, no Electron. Mutants of the workflow each die at their own assert.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fl = require(path.join(ROOT, 'scripts', 'fast-lane.js')) as {
  pickSuites: (names: string[], pkg: { scripts: Record<string, string> }, list?: string[]) => { name: string; steps: string[][] }[];
  tsSources: (suites: { name: string; steps: string[][] }[]) => string[];
  fastTsconfig: (sources: string[], root?: string) => { extends: string; files: string[]; exclude: string[] };
  needsBuild: (suites: { name: string; steps: string[][] }[], read?: (p: string) => string) => boolean;
};
type Plan = { run: string[]; tooSlow: string[]; overBudget: string[]; seconds: number };
type RunOpts = { bail: boolean; ctl: { abort?: () => void }; onSuite?: (t: { name: string; wall: number; cpu: null }) => void; spawnFn?: (cmd: string, args: string[], opts: object) => unknown };
type Proc = { on(sig: string, h: () => void): unknown; removeListener(sig: string, h: () => void): unknown };
type Lane = {
  planSuites: (names: string[], times?: Record<string, unknown> | null, o?: { heavy?: number; budget?: number }) => Plan & { broken: boolean };
  readTimes: (text?: string) => Record<string, unknown> | null;
  prepareRun: (asked: string[], pkg: { scripts: Record<string, string> }, times?: Record<string, unknown> | null, list?: string[]) => { plan: Plan; suites: { name: string }[] };
  planLines: (plan: Plan & { broken: boolean }, asked: number) => string[];
  runLane: (o: { suites: { name: string }[]; jobs: number; deadlineMs?: number; run?: (o: RunOpts) => Promise<{ failed: string[]; times?: unknown[] }>; setTimer?: (f: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void; proc?: Proc; onSuite?: (t: { name: string }) => void; spawnFn?: (cmd: string, args: string[], opts: object) => unknown }) => Promise<{ code: number; note: string; times: unknown[] }>;
  laneMain: (o: { asked: string[]; pkg: { scripts: Record<string, string> }; files?: (s: { name: string }[]) => { ok: boolean; phases: string[] }; lane?: (o: { suites: { name: string }[]; jobs: number; onSuite: (t: unknown) => void }) => Promise<{ code: number; note: string; times: unknown[] }>; summary?: (l: string) => void; put?: (t: string) => void }) => Promise<number>;
  HEAVY_S: number; BUDGET_S: number; DEADLINE_MS: number;
};
const norm = (t: string) => t.replace(/\r\n?/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let laneDone: Promise<void> = Promise.resolve();
process.exitCode = 1; // set to 0 only when the async checks finish, so a check that never ends cannot pass silently

// the runner: only list names, in list order, as run-tests.js loads them
const fake = { scripts: { 'test:a': 'tsc -p tsconfig.scripts.json && node dist-scripts/scripts/test-a.js', 'test:b': 'node scripts/test-b.js && node scripts/b.js' } };
const got = fl.pickSuites(['test:b', 'test:a', 'test:b'], fake, ['test:a', 'test:b']);
assert.deepStrictEqual(got.map((s) => s.name), ['test:b', 'test:a'], "suites run in the decider's order (its direct picks first), each once");
assert.deepStrictEqual(got[0].steps, [['scripts/test-b.js'], ['scripts/b.js']], 'each suite keeps its own steps in order');
assert.throws(() => fl.pickSuites(['test:a', 'test:nope'], fake, ['test:a', 'test:b']), /not a suite of scripts\/test-suites\.txt: test:nope/, 'a name not on the list fails the run, never skipped');
assert.throws(() => fl.pickSuites(['test:a\n::error::x'], fake, ['test:a']), (e: Error) => !/\n/.test(e.message) && !/::error/.test(e.message), 'a hostile name is printed escaped');
assert.ok(fl.pickSuites(['test:cichanges'], pkg).length === 1, 'a real suite of the live list loads');
// compile only the picked test files
assert.deepStrictEqual(fl.tsSources(got), ['scripts/test-a.ts'], 'only compiled steps need tsc: dist-scripts/X.js is X.ts');
const cfg = fl.fastTsconfig(['scripts/test-a.ts'], '/r');
assert.ok(cfg.extends.endsWith('/r/tsconfig.scripts.json') && cfg.files.length === 1 && cfg.files[0].endsWith('/r/scripts/test-a.ts'), 'the config extends the scripts project and lists the picked file');
assert.ok(cfg.exclude.some((e) => e.endsWith('/r/scripts/test-*.ts')) && cfg.exclude.some((e) => e.endsWith('/r/scripts/prereview/**')), 'every other test file and the prereview package are left out');
assert.ok([cfg.extends, ...cfg.files, ...cfg.exclude].every((p) => !p.includes('\\')), 'paths use / on every OS (tsconfig reads them as globs)');
// build only when a step file reads the app build
const reads = (text: string) => fl.needsBuild([{ name: 'x', steps: [['dist-scripts/scripts/test-x.js']] }], (p) => (p === 'scripts/test-x.ts' ? text : ''));
assert.strictEqual(reads("path.join(ROOT, 'dist', 'main.js')"), true, "path.join(..., 'dist') is the app build");
assert.strictEqual(reads("require('../dist/src/main/x')"), true, 'a dist/ path is the app build');
assert.strictEqual(reads("require('../dist-scripts/x')"), false, 'dist-scripts is not');
assert.strictEqual(reads("const distance = 1;"), false, 'a word starting with dist is not');

// ---- spec 117 FR-390: the lane stays fast (time plan, deadline, process trees stopped). Each rule is checked on the real file and on
// mutants of its source (LF-normalised first, and on a CRLF copy too: the Windows checkout), each dying at its own assert.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('module') as { new (id: string, parent: unknown): { filename: string; paths: string[]; exports: unknown; _compile(src: string, file: string): void }; _nodeModulePaths(dir: string): string[] };
  const file = path.join(ROOT, 'scripts', 'fast-lane.js');
  const raw = fs.readFileSync(file, 'utf8');
  const load = (text: string): Lane => { const m = new Module(file, null); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(text, file); return m.exports as Lane; };
  const times = { 'test:a': 10, 'test:b': 200, 'test:c': 300, 'test:d': 150, 'test:e': 50 };
  /** What is wrong with a fast-lane.js's plan and deadline rules (empty = fine). */
  async function laneProblems(l: Lane): Promise<string[]> {
    const bad: string[] = [];
    if (!(l.HEAVY_S <= 120 && l.BUDGET_S <= 480 && l.DEADLINE_MS <= 300000)) bad.push('limits above the spec (120 s heavy, 480 s budget, 300 s deadline)');
    const p = l.planSuites(['test:a', 'test:c', 'test:b', 'test:d', 'test:e', 'test:zz'], times, { heavy: 250, budget: 300 });
    if (!p.tooSlow.includes('test:c')) bad.push('a suite recorded over the heavy limit still runs');
    if (p.run.join(' ') !== 'test:a test:b test:e') bad.push(`the plan does not keep the given order within the budget (got ${p.run.join(' ')})`);
    if (!p.overBudget.includes('test:d')) bad.push('a suite over the budget still runs');
    if (p.seconds !== 10 + 200 + 50) bad.push(`the plan's recorded total is wrong (got ${p.seconds} s)`);
    const m = l.planSuites(['test:zz'], times, { heavy: 1000, budget: 1000 }).seconds; // median of 10, 50, 150, 200, 300
    if (m !== 150) bad.push(`a suite with no recorded time does not count as the median (got ${m} s)`);
    const live = l.planSuites(['test:runtime-redact', 'test:redact-monotone', 'test:cichanges']);
    if (live.run.join(' ') !== 'test:cichanges' || live.tooSlow.length !== 2) bad.push('with the live timings the heavy redact suites still run');
    // broken or missing timings fail closed: nothing runs (review of #2049: never "every suite is free")
    for (const [what, tm] of [['missing', null], ['empty', {}], ['without numbers', { _note: 'x' }], ['unparsable', l.readTimes('{ broken')]] as [string, Record<string, unknown> | null][]) {
      let b2: (Plan & { broken: boolean }) | null = null;
      try { b2 = l.planSuites(['test:runtime-redact', 'test:a'], tm); } catch (e) { bad.push(`a ${what} timings file still runs suites (it threw: ${(e as Error).message})`); continue; }
      if (b2.run.length || !b2.broken) bad.push(`a ${what} timings file still runs suites (got ${b2.run.join(' ')})`);
    }
    // main's one path: asked -> plan -> the plan's suites only
    const fpkg = { scripts: Object.fromEntries(['test:a', 'test:b', 'test:c', 'test:d', 'test:e'].map((n) => [n, `node scripts/${n.slice(5)}.js`])) };
    const prep = l.prepareRun(['test:c', 'test:a', 'test:b', 'test:d', 'test:e'], fpkg, times, ['test:a', 'test:b', 'test:c', 'test:d', 'test:e']);
    const want = l.planSuites(['test:c', 'test:a', 'test:b', 'test:d', 'test:e'], times).run;
    if (prep.suites.map((x) => x.name).join(' ') !== want.join(' ')) bad.push(`prepareRun does not run exactly the plan's suites (got ${prep.suites.map((x) => x.name).join(' ')}, plan ${want.join(' ')})`);
    const brokenLine = l.planLines({ run: [], tooSlow: ['test:x'], overBudget: [], seconds: 0, broken: true }, 1)[0] || '';
    if (!/timings file .* is missing or unreadable: the lane runs nothing/.test(brokenLine)) bad.push(`the broken-timings summary line is wrong (got ${brokenLine})`);
    // laneMain, main's one path: only the suites prepareRun returns run, and with none nothing is prepared or run (real list and timings)
    const ran: string[][] = [], prepared: string[][] = [];
    const lm = (asked: string[]) => l.laneMain({ asked, pkg, files: (x) => { prepared.push(x.map((y) => y.name)); return { ok: true, phases: [] }; }, lane: async (o) => { ran.push(o.suites.map((y) => y.name)); return { code: 0, note: 'all passed', times: [] }; } });
    try {
      await lm(['test:cichanges', 'test:runtime-redact']);
      if (ran.length !== 1 || ran[0].join(' ') !== 'test:cichanges') bad.push(`laneMain does not run exactly the plan's suites (got ${JSON.stringify(ran)})`);
      ran.length = 0; prepared.length = 0;
      await lm(['test:runtime-redact']);
      if (ran.length || prepared.length) bad.push(`laneMain prepares or runs something when the plan is empty (got ${JSON.stringify({ ran, prepared })})`);
    } catch (e) { bad.push(`laneMain does not run exactly the plan's suites (it threw: ${(e as Error).message})`); }
    const none = l.planLines({ run: [], tooSlow: ['test:x'], overBudget: ['test:y'], seconds: 0, broken: false }, 2)[0] || '';
    if (!/2 suite\(s\) picked, all over the time limits: left to Build and test/.test(none)) bad.push(`the all-over-budget text is wrong (got ${none})`);
    // the deadline, on a fake runner and a fake clock: one suite finishes, the other runs until stopped
    const suites2 = [{ name: 'test:a' }, { name: 'test:b' }];
    let detached = false, stopped = false, delay = -1, finish: (v: { failed: string[] }) => void = () => {};
    const seen: string[] = [];
    const hang = (o: RunOpts) => new Promise<{ failed: string[] }>((resolve) => {
      finish = resolve; detached = o.bail;
      if (o.onSuite) o.onSuite({ name: 'test:a', wall: 1, cpu: null });
      o.ctl.abort = () => { stopped = true; resolve({ failed: [] }); };
    });
    const timers: (() => void)[] = [];
    const proc1 = new EventEmitter();
    const pending = l.runLane({ suites: suites2, jobs: 1, deadlineMs: 1234, run: hang, proc: proc1, onSuite: (t) => seen.push(t.name), setTimer: (f, ms) => { delay = ms; timers.push(f); return 1; }, clearTimer: () => {} });
    for (const f of timers) f();
    finish({ failed: [] }); // a lane that did not stop its suites would wait here for ever: end the fake run so the check can report it
    const late = await pending;
    if (delay !== 1234) bad.push(`the deadline timer is not set to deadlineMs (got ${delay} ms)`);
    if (!stopped) bad.push('the deadline does not stop the running suites');
    if (!detached) bad.push('suites are not spawned detached, so a stop would leave their child processes');
    if (late.code !== 0 || !/deadline/.test(late.note)) bad.push(`the deadline does not end the lane green with a note (got ${late.code} ${late.note})`);
    if (!/test:b/.test(late.note) || /not started[^:]*:.*test:a/.test(late.note)) bad.push(`the deadline note does not name the suites stopped or not started (got ${late.note})`);
    if (seen.join(' ') !== 'test:a') bad.push('finished suites do not reach onSuite (the summary rows)');
    // a signal stops the suites the same way, gives 128 + n, and the handlers are removed afterwards (no leak across calls)
    let sigStopped = false;
    const proc2 = new EventEmitter();
    const sigRun = (o: RunOpts) => new Promise<{ failed: string[] }>((resolve) => { o.ctl.abort = () => { sigStopped = true; resolve({ failed: [] }); }; setImmediate(() => { proc2.emit('SIGTERM'); resolve({ failed: [] }); }); });
    const sig = await l.runLane({ suites: suites2, jobs: 1, run: sigRun, proc: proc2, setTimer: () => 1, clearTimer: () => {} });
    if (!sigStopped) bad.push('SIGTERM does not stop the running suites');
    if (sig.code !== 143) bad.push(`SIGTERM does not give 143 (got ${sig.code})`);
    for (const p2 of [proc1, proc2]) for (const n of ['SIGINT', 'SIGTERM', 'SIGHUP']) if (p2.listenerCount(n) !== 0) bad.push(`the ${n} handler is left installed after the run`);
    let installed = 0;
    const proc3 = new EventEmitter();
    await l.runLane({ suites: [], jobs: 1, proc: proc3, run: async () => { installed = ['SIGINT', 'SIGTERM', 'SIGHUP'].filter((n) => proc3.listenerCount(n) === 1).length; return { failed: [] }; }, setTimer: () => 1, clearTimer: () => {} });
    if (installed !== 3) bad.push(`SIGINT, SIGTERM and SIGHUP are not all handled while the suites run (${installed} of 3)`);
    // Windows stops a suite with `taskkill /T /F`, a process of its own: the lane waits for it to exit before it returns (review of
    // #2049: the lane returned while the tree was still being killed); one that has already exited does not hold it up
    const killer = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null });
    let returned = false;
    const killRun = async (o: RunOpts) => { if (o.spawnFn) o.spawnFn('taskkill', ['/PID', '1', '/T', '/F'], {}); return { failed: [] }; };
    const pk = l.runLane({ suites: [], jobs: 1, proc: new EventEmitter(), run: killRun, spawnFn: () => killer, setTimer: () => 1, clearTimer: () => {} }).then(() => { returned = true; });
    await new Promise((r) => setImmediate(r));
    if (returned) bad.push('the lane returns before taskkill has exited');
    killer.exitCode = 0; killer.emit('close', 0);
    await Promise.race([pk, new Promise((r) => setTimeout(r, 1000))]);
    if (!returned) bad.push('the lane does not return once taskkill has exited');
    const gone = { exitCode: 0, signalCode: null, once: () => gone };
    let back = false;
    const pg = l.runLane({ suites: [], jobs: 1, proc: new EventEmitter(), run: killRun, spawnFn: () => gone, setTimer: () => 1, clearTimer: () => {} }).then(() => { back = true; });
    await Promise.race([pg, new Promise((r) => setTimeout(r, 1000))]);
    if (!back) bad.push('a taskkill that has already exited holds the lane up');
    const fail = await l.runLane({ suites: [], jobs: 1, proc: new EventEmitter(), run: async () => ({ failed: ['test:x'] }), setTimer: () => 1, clearTimer: () => {} });
    if (fail.code !== 1) bad.push('a failing suite does not fail the lane');
    const ok = await l.runLane({ suites: [], jobs: 1, proc: new EventEmitter(), run: async () => ({ failed: [] }), setTimer: () => 1, clearTimer: () => {} });
    if (ok.code !== 0 || ok.note !== 'all passed') bad.push('a clean run is not green');
    return bad;
  }
  const toLf = (t: string) => t.replace(/\r\n?/g, '\n');
  const crlf = (t: string) => toLf(t).replace(/\n/g, '\r\n');
  const run = async () => {
    for (const [copy, text] of [['checkout', toLf(raw)], ['CRLF copy', toLf(crlf(raw))]] as [string, string][]) {
      assert.deepStrictEqual(await laneProblems(load(text)), [], `FR-390 rules hold (${copy})`);
      const swap = (from: string, to: string) => { assert.ok(text.includes(from), `mutant anchor found (${copy}): ${from}`); return load(text.replace(from, () => to)); };
      const mutants: [string, Lane, RegExp][] = [
        ['no heavy rule', swap('if (t(n) > heavy) tooSlow.push(n);', 'if (false) tooSlow.push(n);'), /over the heavy limit still runs/],
        ['no budget rule', swap('else if (seconds + t(n) > budget) overBudget.push(n);', 'else if (false) overBudget.push(n);'), /over the budget still runs/],
        ['a missing time counts as zero', swap('(Number.isFinite(times[n]) ? times[n] : median)', '(Number.isFinite(times[n]) ? times[n] : 0)'), /median/],
        ['the plan stops at the first suite that does not fit', swap('else if (seconds + t(n) > budget) overBudget.push(n);', 'else if (seconds + t(n) > budget || overBudget.length) overBudget.push(n);'), /given order within the budget/],
        ['a heavy limit of 600 s', swap('const HEAVY_S = 120;', 'const HEAVY_S = 600;'), /limits above the spec/],
        ['no stop at the deadline', swap('late = true; if (ctl.abort) ctl.abort();', 'late = true;'), /does not stop the running suites/],
        ['children not detached', swap('bail: true, ctl,', 'bail: false, ctl,'), /not spawned detached/],
        ['the deadline at ten times its delay', swap('}, deadlineMs);', '}, deadlineMs * 10);'), /not set to deadlineMs/],
        ['no signal handlers', swap('proc.on(sig, h);', 'void sig;'), /not all handled/],
        ['signal handlers left installed', swap('proc.removeListener(sig, h);', 'void h;'), /left installed/],
        ['a signal exits 0', swap('if (!signalled) signalled = 128 + n;', 'if (!signalled) signalled = 0;'), /SIGTERM does not give 143/],
        ['the deadline note names no suite', swap("stopped or not started (Build and test runs them): ${rest.join(' ') || 'none'}", 'some were stopped'), /does not name the suites/],
        ['no summary rows', swap('try { onSuite(t); } catch', 'try { void t; } catch'), /do not reach onSuite/],
        ['a broken timings file makes every suite free', swap('if (!known.length) return { run: [], tooSlow: [...names], overBudget: [], seconds: 0, broken: true };', ''), /timings file still runs suites/],
        ['main runs what was asked, not the plan', swap('suites: plan.run.length ? pickSuites(plan.run, pkg, list) : []', 'suites: pickSuites([...new Set(asked)], pkg, list)'), /exactly the plan's suites/],
        ['the all-over-budget text', swap("suite(s) picked, all over the time limits: left to Build and test", 'no suite is touched'), /all-over-budget text/],
        ['the deadline is red', swap("if (late) return { code: 0, note:", "if (late) return { code: 1, note:"), /does not end the lane green/],
        ['no wait for taskkill', swap('await waitForExit(killers, killWaitMs, setTimer, clearTimer);', ''), /returns before taskkill has exited/],
        ['taskkill not tracked', swap('killers.push(c);', 'void c;'), /returns before taskkill has exited/],
        ['an exited taskkill waited for', swap('c && c.exitCode === null && c.signalCode == null', 'c'), /already exited holds the lane up/],
        ['the broken-timings line dropped', swap('if (plan.broken) out.push(', 'if (false) out.push('), /broken-timings summary line/],
        ['main bypasses the plan', swap('const { plan, suites } = prepare(asked, pkg);', 'const { plan } = prepare(asked, pkg); const suites = pickSuites([...new Set(asked)], pkg);'), /laneMain does not run exactly the plan/],
        ['main runs on an empty plan', swap('if (!suites.length) return 0;', ''), /laneMain prepares or runs something when the plan is empty/],
        ['a failure is green', swap("if (failed.length) return { code: 1,", "if (failed.length) return { code: 0,"), /failing suite does not fail/],
      ];
      for (const [name, l, expect] of mutants) { const bad = await laneProblems(l); assert.ok(bad.some((b) => expect.test(b)), `mutant "${name}" (${copy}) dies at its own assert (got: ${bad.join('; ') || 'nothing'})`); }
    }
    // one real run (review of #2049): a suite that sleeps and starts a grandchild, a 1.5 s deadline, the real runner. The lane ends green
    // within seconds, names the suite, and neither the suite nor its grandchild is left running (process group / taskkill /T).
    const os = require('os') as typeof import('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-lane-'));
    const pidFile = path.join(tmp, 'grandchild.pid');
    // fixed code; the pid file's path arrives as an argument (process.argv[1] under -e), never spliced into the source (CodeQL #113)
    const code = "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});require('fs').writeFileSync(process.argv[1],String(c.pid));setTimeout(()=>{},60000);";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rt = require(path.join(ROOT, 'scripts', 'run-tests.js')) as { runSuites: (o: Record<string, unknown>) => Promise<{ failed: string[]; times: unknown[] }> };
    const { spawn } = require('child_process') as typeof import('child_process');
    const pids: number[] = [];
    const t0 = Date.now();
    const real = await load(toLf(raw)).runLane({
      suites: [{ name: 'test:sleep', steps: [['-e', code, pidFile]] } as unknown as { name: string }], jobs: 1, deadlineMs: 1500,
      // the lane's own spawn (it tracks taskkill on Windows) stays in the chain; only the suite's own node process is recorded
      run: (o) => rt.runSuites({ ...o, spawnFn: (cmd: string, args: string[], opts: object) => { const c = (o.spawnFn || spawn)(cmd, args, opts) as import('child_process').ChildProcess; if (cmd === process.execPath && c.pid) pids.push(c.pid); return c; } }),
    });
    const took = Date.now() - t0;
    assert.ok(real.code === 0 && /deadline/.test(real.note) && /test:sleep/.test(real.note), `a real run past the deadline ends green and names the suite (got ${real.code} ${real.note})`);
    assert.ok(took < 15000, `the real run ends soon after its deadline (took ${took} ms)`);
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let gc = 0;
    for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
    if (fs.existsSync(pidFile)) gc = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(gc > 0, 'the sleeping suite started its grandchild');
    for (let i = 0; i < 100 && (pids.some(alive) || alive(gc)); i++) await new Promise((r) => setTimeout(r, 50)); // bounded: 5 s
    assert.strictEqual(pids.length, 1, 'one suite process was started (taskkill is not counted)');
    assert.ok(!alive(pids[0]), 'the suite process is stopped');
    assert.ok(!alive(gc), 'the grandchild is stopped too (the whole tree)');
    // the win32 path, emulated here on every OS (review of #2049: on Windows the test counted taskkill as a suite): run-tests.js stops
    // the suite through `taskkill` with the same spawn, here a stand-in that kills the pid. Only the suite's node process is a suite;
    // the lane waits for the stand-in to exit; the suite is gone.
    const wpids: number[] = [], cmds: string[] = [];
    const w = await load(toLf(raw)).runLane({
      suites: [{ name: 'test:sleep', steps: [['-e', 'setTimeout(()=>{},60000)']] } as unknown as { name: string }], jobs: 1, deadlineMs: 1000,
      spawnFn: (cmd: string, args: string[], opts: object) => {
        cmds.push(path.basename(cmd));
        // the stand-in taskkill: fixed code, the pid as an argument (taskkill's /PID value), never spliced into the source
        if (cmd === 'taskkill') return spawn(process.execPath, ['-e', "try{process.kill(Number(process.argv[1]),'SIGKILL')}catch(e){}", String(Number(args[1]))], { stdio: 'ignore' });
        return spawn(cmd, args, opts);
      },
      run: (o) => rt.runSuites({ ...o, platform: 'win32', spawnFn: (cmd: string, args: string[], opts: object) => { const c = (o.spawnFn || spawn)(cmd, args, opts) as import('child_process').ChildProcess; if (cmd === process.execPath && c.pid) wpids.push(c.pid); return c; } }),
    });
    assert.ok(cmds.includes('taskkill'), `the emulated win32 stop goes through taskkill (spawned: ${cmds.join(' ')})`);
    assert.strictEqual(wpids.length, 1, 'win32: only the suite node process is counted, not taskkill');
    for (let i = 0; i < 100 && alive(wpids[0]); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!alive(wpids[0]) && w.code === 0 && /test:sleep/.test(w.note), `win32: the suite is stopped and the lane ends green naming it (got ${w.code} ${w.note})`);
    // spec 117 T080 (bug on #2052): the lane's temporary tsconfig resolves types like the full compile. A picked set that imports
    // demo-oauth-mcp.ts lists one @types/node copy, the root one, as the full project does (tsc --listFilesOnly: no type check, fast);
    // the mutant that writes the config under the OS temp folder loads Electron's nested copy too and dies here.
    const tscBin = require.resolve('typescript/bin/tsc', { paths: [ROOT] });
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const nodeModules = fs.realpathSync(path.join(ROOT, 'node_modules')); // paths relative to it (a linked node_modules resolves elsewhere)
    const nodeTypes = (cfgFile: string) => execFileSync(process.execPath, [tscBin, '-p', cfgFile, '--listFilesOnly'], { cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/).map((f) => f.replace(/\\/g, '/')).filter((f) => /\/@types\/node\/http\.d\.ts$/.test(f)).map((f) => path.relative(nodeModules, f).replace(/\\/g, '/')).sort();
    const full = nodeTypes(path.join(ROOT, 'tsconfig.scripts.json'));
    assert.deepStrictEqual(full, ['@types/node/http.d.ts'], `the full scripts project loads one @types/node, the root one (got ${full.join(', ')})`);
    type W = { writeFastTsconfig: (src: string[], root?: string) => { file: string; remove: () => void } };
    const picked = (w: W) => { const c = w.writeFastTsconfig(['scripts/test-demo-oauth-mcp.ts']); try { return { types: nodeTypes(c.file), file: c.file }; } finally { c.remove(); } };
    const real2 = picked(load(toLf(raw)) as unknown as W);
    assert.deepStrictEqual(real2.types, full, `the lane's compile of a picked set loads the same @types/node as the full compile (got ${real2.types.join(', ')})`);
    assert.ok(!path.relative(ROOT, real2.file).startsWith('..') && !fs.existsSync(path.dirname(real2.file)), 'the temporary config sits inside the repository and is removed after');
    const tmpFrom = 'fs.mkdtempSync(path.join(root, \'.fast-lane-\'))';
    for (const text of [toLf(raw), toLf(crlf(raw))]) assert.ok(text.includes(tmpFrom), 'mutant anchor: the config folder inside the repository');
    const inTemp = picked(load(toLf(raw).replace(tmpFrom, () => "fs.mkdtempSync(path.join(require('os').tmpdir(), 'fast-lane-'))")) as unknown as W);
    assert.notDeepStrictEqual(inTemp.types, full, `mutant "config in the OS temp folder" dies: it loads other @types/node files (got ${inTemp.types.join(', ')})`);
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  laneDone = run();
}

// the workflow
const wfRaw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'fast-lane.yml'), 'utf8');
const wf = norm(wfRaw);
/** Every shell line of a workflow: each `run:` value and each line of a `run: |` block. No `${{ }}` may appear in one. */
function runLines(text: string): string[] {
  const out: string[] = [];
  const ls = text.split('\n');
  for (let i = 0; i < ls.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(ls[i]);
    if (!m) continue;
    if (/^[|>]/.test(m[2])) { const ind = m[1].length; while (i + 1 < ls.length && (ls[i + 1].trim() === '' || ls[i + 1].search(/\S/) > ind)) out.push(ls[++i]); } else out.push(m[2]);
  }
  return out;
}
/** What is wrong with the lane's workflow (empty = fine). */
function problems(text: string): string[] {
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const bad: string[] = [];
  if (/pull_request_target/.test(code)) bad.push('pull_request_target');
  if (!/^on:\n {2}pull_request:\n/m.test(code) || /^ {2}(push|merge_group|schedule|workflow_dispatch|workflow_run):/m.test(code)) bad.push('trigger is not pull_request only');
  if (/secrets\./.test(code)) bad.push('uses a secret');
  if (!/^permissions:\n {2}contents: read\n(?! )/m.test(code) || /write/.test(code)) bad.push('token is not read-only');
  if (!/persist-credentials: false/.test(code)) bad.push('checkout keeps its credential');
  if (!/group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}/.test(code) || !/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/.test(code)) bad.push('no PR-number concurrency group that cancels');
  if (!/os: \[ubuntu-latest, windows-latest, macos-latest\]/.test(code)) bad.push('not on the three OSes');
  if (!/run: bash \.github\/scripts\/ci-changes\.sh --suites\n/.test(code)) bad.push('the base copy of the one decision does not pick');
  if (runLines(code).some((l) => l.includes('${{'))) bad.push('a value from the PR in a shell string');
  if (!/FAST_SUITES: \$\{\{ steps\.pick\.outputs\.suites \}\}\n\s+run: node scripts\/fast-lane\.js\n/.test(code)) bad.push('the suites do not reach the runner through env');
  if (/continue-on-error/.test(code)) bad.push('continue-on-error hides a red lane');
  if (!/CAPPED: \$\{\{ steps\.changes\.outputs\.capped \|\| steps\.own\.outputs\.capped \}\}/.test(code) || !/if \[ -z "\$suites" \] && \[ -n "\$CAPPED" \]; then echo "No npm test suite picked: [^"]*more than 40 files/.test(code)) bad.push('the summary does not say when a big folder was the only link (capped)');
  const m = /timeout-minutes: (\d+)/.exec(code);
  if (!m || Number(m[1]) > 10) bad.push('no timeout of at most 10 minutes');
  return bad;
}
assert.deepStrictEqual(problems(wf), [], 'fast-lane.yml: advisory, three OSes, safe for fork PRs');
// Windows checks files out with CRLF (review of #2032): the same check on a CRLF copy, normalised first, passes; without the
// normalisation it does not, so the normalisation is what makes it pass there
const crlf = (t: string) => norm(t).replace(/\n/g, '\r\n');
assert.deepStrictEqual(problems(norm(crlf(wfRaw))), [], 'fast-lane.yml checks pass on a CRLF copy (normalised first)');
assert.ok(problems(crlf(wfRaw)).length > 0, 'mutant "normalisation stripped": a raw CRLF copy fails the checks');
const swap = (from: string | RegExp, to: string) => { const t = wf.replace(from, to); assert.notStrictEqual(t, wf, `mutant anchor found: ${String(from)}`); return t; };
const mutants: [string, string, string][] = [
  ['pull_request_target', swap('on:\n  pull_request:\n', 'on:\n  pull_request_target:\n'), 'pull_request_target'],
  ['a push trigger', swap('on:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\n', 'on:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\n  push:\n'), 'trigger is not pull_request only'],
  ['a secret', swap('          FAST_SUITES:', '          T: ${{ secrets.X }}\n          FAST_SUITES:'), 'uses a secret'],
  ['write permission', swap('permissions:\n  contents: read\n', 'permissions:\n  contents: write\n'), 'token is not read-only'],
  ['credential kept', swap('          persist-credentials: false\n', ''), 'checkout keeps its credential'],
  ['no cancel', swap("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: false'), 'no PR-number concurrency group that cancels'],
  ['Windows dropped', swap('os: [ubuntu-latest, windows-latest, macos-latest]', 'os: [ubuntu-latest, macos-latest]'), 'not on the three OSes'],
  ["the PR's copy decides", swap('run: bash .github/scripts/ci-changes.sh --suites\n', 'run: node .github/scripts/ci-changes.js --suites\n'), 'the base copy of the one decision does not pick'],
  ['suites in the shell string', swap('run: node scripts/fast-lane.js\n', 'run: node scripts/fast-lane.js ${{ steps.pick.outputs.suites }}\n'), 'a value from the PR in a shell string'],
  ['continue-on-error', swap('        run: node scripts/fast-lane.js\n', '        continue-on-error: true\n        run: node scripts/fast-lane.js\n'), 'continue-on-error hides a red lane'],
  ['no capped summary line', swap(/ {10}if \[ -z "\$suites" \] && \[ -n "\$CAPPED" \][^\n]*\n {10}elif/, '          if'), 'the summary does not say when a big folder was the only link (capped)'],
    ['a long timeout', swap(/timeout-minutes: \d+/, 'timeout-minutes: 25'), 'no timeout of at most 10 minutes'],
];
for (const [name, text, expect] of mutants) assert.ok(problems(text).includes(expect), `mutant "${name}" dies at its own assert (got: ${problems(text).join('; ') || 'nothing'})`);
// advisory: the lane's check names are not in the required list the spec records (spec 117 O1 table)
const spec = norm(fs.readFileSync(path.join(ROOT, 'specs', '117-delivery-speed-2', 'spec.md'), 'utf8'));
const required = spec.split('\n').filter((l) => /^\| [^|]+ \| yes\b/.test(l)).map((l) => l.split('|')[1].trim());
assert.ok(required.includes('Build and test (windows-latest)') && !required.some((n) => /fast lane/i.test(n)), 'no Fast lane check is required (the lane is advisory)');
laneDone.then(() => { process.exitCode = 0; console.log(`fast-lane: ok (${mutants.length} workflow mutants, the FR-390 mutants on two copies and a real deadline run caught)`); }, (e) => { console.error(e); process.exitCode = 1; });
