/** Unit test (spec 008 FR-115): `npm test --bail` stops at the first failing suite and kills what runs, with fakes (no process is started or killed). */
import * as assert from 'assert';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rt = require(path.join(__dirname, '..', '..', 'scripts', 'run-tests.js')) as {
  parseArgs: (argv: string[], env: Record<string, string | undefined>) => { bail: boolean; ignoredBail: boolean; filters: string[] };
  readSuiteList: (text?: string) => string[];
  unlistedSuites: (scripts: Record<string, string>, names?: string[], allow?: string[]) => string[];
  NOT_SUITES: string[];
  loadSuites: (pkg: unknown, filters: string[], names?: string[]) => { name: string; steps: string[][] }[];
  stopChild: (c: unknown, o: unknown) => void;
  runSuites: (o: Record<string, unknown>) => Promise<{ failed: string[]; bailed: string | null; times: { name: string; wall: number; cpu: number | null }[] }>;
  runMain: (o: Record<string, unknown>) => Promise<void>;
  HEAVY_FIRST: string[];
  orderSuites: (suites: { name: string }[], heavy?: string[]) => { name: string }[];
  formatSummary: (times: { name: string; wall: number; cpu: number | null }[], o?: Record<string, unknown>) => string;
  readCpuSeconds: (file: string) => number | null;
  makeCpuDir: (o?: Record<string, unknown>) => string | null;
  startMain: (o: Record<string, unknown>) => Promise<void>;
};

type Fake = EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; file: string };
// A fake spawn: every call makes a child that stays "running" until the test ends it (exit(code)) or it is killed.
function harness(plan: Record<string, number>) {
  const children: Fake[] = [];
  const spawned: { cmd: string; args: string[]; opts: { detached?: boolean; shell?: unknown } }[] = [];
  const kills: [number, string][] = [];
  const spawnFn = (cmd: string, args: string[], opts: { detached?: boolean; shell?: unknown }) => {
    spawned.push({ cmd, args, opts });
    const c = new EventEmitter() as Fake;
    c.pid = 1000 + spawned.length;
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.file = args[0];
    if (cmd === 'taskkill') {
      const target = children.find((x) => String(x.pid) === args[1]);
      if (target) setImmediate(() => target.emit('close', null));
    } else {
      children.push(c);
      // a suite that is in `plan` ends by itself with that code (next tick); others hang until killed
      const code = plan[path.basename(args[0])];
      if (code !== undefined) setImmediate(() => { c.stdout.emit('data', `out of ${path.basename(args[0])}\n`); c.emit('close', code); });
    }
    return c;
  };
  const kill = (pid: number, sig: string) => {
    kills.push([pid, sig]);
    const c = children.find((x) => -x.pid === pid);
    if (c) setImmediate(() => c.emit('close', null));
  };
  return { spawnFn, kill, spawned, kills, children };
}
const suite = (name: string) => ({ name, steps: [[`dist/${name}.js`]] });
const run = (h: ReturnType<typeof harness>, suites: ReturnType<typeof suite>[], o: Record<string, unknown>) => {
  const out: string[] = [];
  return rt.runSuites({ suites, spawnFn: h.spawnFn, kill: h.kill, stopOpts: { setTimer: () => 0, clearTimer: () => undefined }, write: (t: string) => out.push(t), now: () => 0, ...o }).then((r) => ({ ...r, out: out.join('') }));
};

// an unfinished promise would let node exit 0 in silence: fail then
let done = false;
process.on('exit', () => { if (!done) { console.error('test-run-tests: did not finish'); process.exitCode = 1; } });

(async () => {
  // flag, env var and filters
  assert.deepStrictEqual(rt.parseArgs([], {}), { bail: false, ignoredBail: false, filters: [] });
  assert.strictEqual(rt.parseArgs(['--bail'], {}).bail, true, '--bail turns it on');
  assert.strictEqual(rt.parseArgs([], { TEST_BAIL: '1' }).bail, true, 'TEST_BAIL=1 turns it on');
  assert.strictEqual(rt.parseArgs([], { TEST_BAIL: '0' }).bail, false, 'TEST_BAIL=0 is off');
  assert.strictEqual(rt.parseArgs([], { TEST_BAIL: '' }).bail, false, 'an empty TEST_BAIL is off');
  assert.deepStrictEqual(rt.parseArgs(['folders', '--bail', 'claude'], {}), { bail: true, ignoredBail: false, filters: ['folders', 'claude'] }, 'filters combine with --bail');
  // under CI the flag and the env var are ignored (any non-empty CI value except false/0)
  for (const ci of ['true', '1', 'yes']) {
    assert.deepStrictEqual(rt.parseArgs(['--bail'], { CI: ci }), { bail: false, ignoredBail: true, filters: [] }, `CI=${ci} ignores --bail`);
    assert.deepStrictEqual(rt.parseArgs([], { CI: ci, TEST_BAIL: '1' }), { bail: false, ignoredBail: true, filters: [] }, `CI=${ci} ignores TEST_BAIL`);
  }
  for (const ci of ['', '0', 'false']) assert.strictEqual(rt.parseArgs(['--bail'], { CI: ci }).bail, true, `CI=${ci} is not CI`);
  assert.deepStrictEqual(rt.parseArgs([], { CI: 'true' }), { bail: false, ignoredBail: false, filters: [] }, 'nothing asked, nothing ignored');
  const pkg = { scripts: { 'test:a': 'tsc -p tsconfig.scripts.json && node a.js && node a2.js', 'test:folders': 'node f.js', 'test:folderx': 'node x.js' } };
  const list = rt.readSuiteList('# a comment\ntest:a\n\n  test:folders  # trailing\r\ntest:folderx\n');
  assert.deepStrictEqual(list, ['test:a', 'test:folders', 'test:folderx'], 'the list: one name per line, comments and blanks ignored');
  assert.throws(() => rt.readSuiteList('test:a\ntest:a\n'), /twice/, 'a name listed twice is an error');
  assert.deepStrictEqual(rt.loadSuites(pkg, [], list).map((s) => s.name), ['test:a', 'test:folders', 'test:folderx']);
  assert.deepStrictEqual(rt.loadSuites(pkg, ['folder'], list).map((s) => s.name), ['test:folders', 'test:folderx'], 'the name filter still works');
  assert.deepStrictEqual(rt.loadSuites(pkg, [], list)[0].steps, [['a.js'], ['a2.js']], 'a suite keeps its steps in order');
  assert.throws(() => rt.loadSuites({ scripts: { 'test:z': 'echo hi' } }, [], ['test:z']), /only "node <file>"/);
  assert.throws(() => rt.loadSuites({ scripts: {} }, [], ['test:nope']), /not a script/);
  {
    // the real list: every name is a script, nothing twice, and every `test:*` script is listed or is one of the few chains
    const real = require(path.join(__dirname, '..', '..', 'package.json')) as { scripts: Record<string, string> };
    const names = rt.readSuiteList();
    assert.strictEqual(new Set(names).size, names.length);
    for (const n of names) assert.ok(real.scripts[n], `${n} is a script`);
    assert.ok(names.includes('test:checknames') && names.length > 100, 'the real list is read');
    // every test:* script is listed or is an allowed chain: a forgotten suite would never run
    assert.deepStrictEqual(rt.unlistedSuites(real.scripts), [], 'a test:* script is in neither scripts/test-suites.txt nor NOT_SUITES');
    for (const n of rt.NOT_SUITES) assert.ok(real.scripts[n] && !names.includes(n), `${n} is a real script and not in the list`);
    // mutant: a test script that is not in the list is found; a listed one and an allowed chain are not
    assert.deepStrictEqual(rt.unlistedSuites({ ...real.scripts, 'test:forgotten': 'node x.js' }), ['test:forgotten'], 'red: a test not in the list');
    assert.deepStrictEqual(rt.unlistedSuites({ 'test:a': 'x', 'test:chain': 'x', build: 'x' }, ['test:a'], ['test:chain']), [], 'listed, allowed and non-test scripts pass');
    assert.strictEqual(real.scripts['test:serial'], 'node scripts/run-tests.js --serial');
  }

  // default: everything runs even after a failure
  {
    const h = harness({ 'a.js': 0, 'b.js': 1, 'c.js': 0, 'd.js': 0 });
    const r = await run(h, ['a', 'b', 'c', 'd'].map(suite), { jobs: 1, bail: false });
    assert.deepStrictEqual(r.failed, ['b']);
    assert.strictEqual(r.bailed, null);
    assert.strictEqual(h.spawned.length, 4, 'all four suites ran');
    assert.strictEqual(h.kills.length, 0, 'nothing was killed');
    assert.ok(h.spawned.every((x) => x.opts.detached === false), 'without --bail the suites are spawned as before (not detached)');
    assert.ok(/ok   a/.test(r.out) && /FAIL b/.test(r.out) && /ok   d/.test(r.out) && /out of b\.js/.test(r.out));
  }
  // --bail, one at a time: nothing starts after the failure
  {
    const h = harness({ 'a.js': 0, 'b.js': 1, 'c.js': 0, 'd.js': 0 });
    const r = await run(h, ['a', 'b', 'c', 'd'].map(suite), { jobs: 1, bail: true });
    assert.deepStrictEqual(r.failed, ['b']);
    assert.strictEqual(r.bailed, 'b');
    assert.strictEqual(h.spawned.length, 2, 'c and d never started');
    assert.ok(/FAIL b[\s\S]*out of b\.js/.test(r.out), 'the failing suite output is printed');
  }
  // --bail, in parallel: the ones still running are killed by group (POSIX), their results are not reported
  {
    const h = harness({ 'b.js': 1 }); // a and c hang
    const r = await run(h, ['a', 'b', 'c', 'd'].map(suite), { jobs: 3, bail: true, platform: 'linux' });
    assert.strictEqual(r.bailed, 'b');
    assert.deepStrictEqual(r.failed, ['b'], 'the killed suites are not counted as failures');
    assert.strictEqual(h.spawned.length, 3, 'd never started');
    assert.ok(h.spawned.every((s) => s.opts.detached === true && s.opts.shell === undefined), 'POSIX children are detached (own group), no shell');
    const hung = h.children.filter((c) => c.file !== 'dist/b.js').map((c) => c.pid).sort();
    const term = h.kills.filter((k) => k[1] === 'SIGTERM');
    assert.deepStrictEqual(term.map((k) => k[0]).sort(), hung.map((p) => -p).sort(), 'exactly the two running suites got a TERM to their group (-pid)');
    assert.deepStrictEqual(h.kills.filter((k) => k[1] === 'SIGKILL').map((k) => k[0]).sort(), hung.map((p) => -p).sort(), 'once their pipes closed, the group is killed for sure');
    assert.ok(!/FAIL a|FAIL c|ok   a|ok   c/.test(r.out));
  }
  // --bail on Windows: taskkill /T /F per running pid, no process.kill, no shell
  {
    const h = harness({ 'b.js': 1 });
    const r = await run(h, ['a', 'b', 'c'].map(suite), { jobs: 3, bail: true, platform: 'win32' });
    assert.strictEqual(r.bailed, 'b');
    assert.strictEqual(h.kills.length, 0, 'no group kill on Windows');
    const tk = h.spawned.filter((s) => s.cmd === 'taskkill');
    assert.strictEqual(tk.length, 2, 'one taskkill per running suite');
    const pids = h.children.filter((c) => c.file !== 'dist/b.js').map((c) => String(c.pid)).sort();
    assert.deepStrictEqual(tk.map((t) => t.args[1]).sort(), pids);
    assert.ok(tk.every((t) => t.args[0] === '/PID' && t.args[2] === '/T' && t.args[3] === '/F' && t.opts.shell === undefined));
    assert.ok(h.spawned.filter((s) => s.cmd !== 'taskkill').every((s) => s.opts.detached === false));
  }
  // a failing first step stops the rest of that suite, and with --bail a later step of a stopped suite does not start
  {
    const h = harness({ 'a.js': 1, 'a2.js': 0 });
    const r = await run(h, [{ name: 'a', steps: [['a.js'], ['a2.js']] }], { jobs: 1, bail: false });
    assert.deepStrictEqual(r.failed, ['a']);
    assert.strictEqual(h.spawned.length, 1, 'step 2 does not run after step 1 failed');
  }
  // the grace period: TERM first, SIGKILL to the group only when the timer fires (a grandchild that ignores TERM keeps the child open)
  {
    const kills: [number, string][] = [];
    let fire: (() => void) | null = null;
    let cleared = false;
    const child = Object.assign(new EventEmitter(), { pid: 77 });
    rt.stopChild(child, { platform: 'linux', kill: (p: number, sg: string) => kills.push([p, sg]), graceMs: 5000, setTimer: (f: () => void, ms: number) => { assert.strictEqual(ms, 5000); fire = f; return 1; }, clearTimer: () => { cleared = true; } });
    assert.deepStrictEqual(kills, [[-77, 'SIGTERM']], 'TERM first, nothing harsher yet');
    assert.ok(fire, 'a force timer was set');
    (fire as unknown as () => void)();
    assert.deepStrictEqual(kills, [[-77, 'SIGTERM'], [-77, 'SIGKILL']], 'after the grace period the group gets SIGKILL');
    child.emit('close', null);
    assert.ok(cleared, 'the timer is cleared when the child closes');
    // Windows: one forced tree kill, no timer
    const calls: string[][] = [];
    rt.stopChild({ pid: 8 }, { platform: 'win32', spawnFn: (c: string, a: string[]) => { calls.push([c, ...a]); return new EventEmitter(); }, setTimer: () => { throw new Error('no timer on Windows'); } });
    assert.deepStrictEqual(calls, [['taskkill', '/PID', '8', '/T', '/F']]);
  }
  // stopChild alone: no pid, nothing happens; an already gone group is not an error
  rt.stopChild(null, {});
  rt.stopChild({ pid: 5 }, { platform: 'linux', kill: () => { throw new Error('ESRCH'); } });
  // spec 012 FR-166 (#1093): each suite runs with its own empty TMPDIR; a `durbar-*` entry left in it fails the suite, which is named; the folder is removed
  {
    const h = harness({ 'leaky.js': 0, 'clean.js': 0 });
    const dirs: Record<string, string> = {};
    const spawnFn = (cmd: string, args: string[], opts: { env: Record<string, string>; detached?: boolean; shell?: unknown }) => {
      const name = path.basename(args[0]);
      assert.ok(opts.env.TMPDIR && opts.env.TEMP === opts.env.TMPDIR && opts.env.TMP === opts.env.TMPDIR, 'TMPDIR, TEMP and TMP point at the suite folder');
      assert.deepStrictEqual(fs.readdirSync(opts.env.TMPDIR), [], 'the folder starts empty');
      dirs[name] = opts.env.TMPDIR;
      if (name === 'leaky.js') {
        fs.mkdirSync(path.join(opts.env.TMPDIR, 'durbar-leak-AbC123'));
        fs.mkdirSync(path.join(opts.env.TMPDIR, 'other-thing')); // not ours to judge: only durbar-* counts
      }
      return h.spawnFn(cmd, args, opts);
    };
    const r = await run(h, [suite('leaky'), suite('clean')], { jobs: 2, bail: false, spawnFn });
    assert.deepStrictEqual(r.failed, ['leaky'], 'only the suite that left a durbar-* folder fails');
    assert.ok(/leaky left 1 durbar-\* temp entry behind \(durbar-leak-AbC123\)/.test(r.out), r.out);
    assert.notStrictEqual(dirs['leaky.js'], dirs['clean.js'], 'each suite has its own folder');
    for (const d of Object.values(dirs)) assert.ok(!fs.existsSync(d), 'the suite folder is removed');
  }
  // spec 117 FR-017: per-suite wall and CPU seconds. Each step starts with the cpu-report preload and its own DURBAR_CPU_FILE (outside the suite's TMPDIR);
  // the lines the steps write are summed; a suite that reports none has cpu null; the summary table is longest first and goes to GITHUB_STEP_SUMMARY
  {
    const h = harness({ 'a.js': 0, 'b.js': 0, 'c.js': 0 });
    const cpuDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rt-cpu-test-'));
    const clock = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map((_, i) => i * 1000); // every now() call advances 1 s
    let ci = 0;
    const spawnFn = (cmd: string, args: string[], opts: { env: Record<string, string>; detached?: boolean; shell?: unknown }) => {
      const real = args.slice(2);
      assert.strictEqual(args[0], '--require');
      assert.ok(/cpu-report\.js$/.test(args[1]), args[1]);
      assert.ok(opts.env.DURBAR_CPU_FILE && path.dirname(opts.env.DURBAR_CPU_FILE) === cpuDir, 'the CPU file is in its own folder, not the suite TMPDIR');
      assert.notStrictEqual(path.dirname(opts.env.DURBAR_CPU_FILE), opts.env.TMPDIR);
      const name = path.basename(real[0]);
      if (name === 'a.js') fs.appendFileSync(opts.env.DURBAR_CPU_FILE, '2500000\n500000\n'); // two node processes: 3.0 s
      if (name === 'b.js') fs.appendFileSync(opts.env.DURBAR_CPU_FILE, '1000000\n');
      return h.spawnFn(cmd, real, opts);
    };
    const r = await run(h, [suite('a'), suite('b'), suite('c')], { jobs: 1, bail: false, spawnFn, cpuDir, now: () => clock[ci++] });
    assert.deepStrictEqual(r.failed, []);
    assert.deepStrictEqual(r.times.map((t) => [t.name, t.cpu]), [['a', 3], ['b', 1], ['c', null]]);
    assert.ok(r.times.every((t) => t.wall > 0), 'wall seconds are measured');
    // off by default: no preload, no env var (so every other test here sees the plain args)
    const h2 = harness({ 'a.js': 0 });
    await run(h2, [suite('a')], { jobs: 1, bail: false });
    assert.strictEqual(h2.spawned[0].args[0], 'dist/a.js');
    const table = rt.formatSummary([{ name: 'quick', wall: 2, cpu: 1.5 }, { name: 'slow', wall: 30.25, cpu: 12 }, { name: 'nocpu', wall: 3, cpu: null }], { os: 'linux', jobs: 4 });
    assert.ok(table.includes('### Suite times (linux, 3 suites, 4 at a time)'), table);
    const rows = table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Suite'));
    assert.deepStrictEqual(rows.map((l) => l.split('|')[1].trim()), ['slow', 'nocpu', 'quick', '**total (sum of suites)**'], 'longest first, total last');
    assert.ok(rows[0].includes('30.3') || rows[0].includes('30.2'), rows[0]);
    assert.ok(rows[1].includes('n/a'), 'unknown CPU says n/a');
    assert.ok(rows[3].includes('35.3') && rows[3].includes('13.5'), rows[3]);
    fs.rmSync(cpuDir, { recursive: true, force: true });
  }
  // runMain writes the table to GITHUB_STEP_SUMMARY, pass or fail, and a write error is not fatal: checked with real tiny node steps and the real preload
  {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rt-real-'));
    const okJs = path.join(dir, 'ok.js'); const badJs = path.join(dir, 'bad.js');
    fs.writeFileSync(okJs, 'let x = 0; for (let i = 0; i < 3e6; i++) x += Math.sqrt(i); if (x < 0) throw new Error("never");');
    fs.writeFileSync(badJs, 'process.exit(3);');
    const cpuDir = fs.mkdtempSync(path.join(dir, 'cpu-'));
    for (const [file, code] of [[okJs, 0], [badJs, 3]] as [string, number][]) {
      const wrote: string[] = [];
      let exited: number | undefined;
      const exitCode = new Promise<void>((resolve) => {
        rt.runMain({ suites: [{ name: 'real', steps: [[file]] }], jobs: 1, bail: false, cpuDir, exit: (c: number) => { exited = c; resolve(); }, env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') }, appendFile: (f: string, t: string) => { wrote.push(f + '\n' + t); } }).then(() => resolve());
      });
      await exitCode;
      assert.strictEqual(exited, code === 0 ? undefined : 1);
      // header, one row as the suite ends, then the slowest-first table with the total: pass or fail
      assert.strictEqual(wrote.length, 3, 'the summary is written as the suite ends, pass or fail');
      assert.ok(wrote[0].includes('### Suite times as they finish'), wrote[0]);
      const row = wrote[1].split('\n').find((l) => l.startsWith('| real |')) || '';
      assert.ok(wrote[2].includes('### Slowest suites') && wrote[2].includes('total (sum of suites)'), wrote[2]);
      const cpu = row.split('|')[3].trim();
      assert.ok(/^\d+\.\d$/.test(cpu), `the real preload reported CPU seconds: ${row}`);
    }
    // a summary write error does not fail the run
    // and the note prints exactly once however many suites and writes follow (the first error turns the writes off)
    {
      const notes: string[] = []; let writes = 0;
      const log = console.log; console.log = (...a: unknown[]) => { notes.push(a.join(' ')); };
      try {
        await rt.runMain({ suites: [{ name: 'real', steps: [[okJs]] }, { name: 'real2', steps: [[okJs]] }, { name: 'real3', steps: [[okJs]] }], jobs: 1, bail: false, cpuDir, exit: () => { throw new Error('must not exit'); }, env: { ...process.env, GITHUB_STEP_SUMMARY: '/x' }, appendFile: () => { writes++; throw Object.assign(new Error('x'), { code: 'EACCES' }); } });
      } finally { console.log = log; }
      assert.strictEqual(notes.filter((n) => n.includes('could not write the suite times')).length, 1, 'the note prints exactly once');
      assert.strictEqual(writes, 1, 'after the first error no more writes are tried');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // spec 117 FR-017 (SC-003): a run cut short keeps the suites done so far. A real runner process is killed midway (SIGKILL: no handler runs, as when a
  // job hits its time limit); the summary file already holds the header and the finished suite's row, and not the unfinished one
  {
    const { spawn } = require('child_process') as typeof import('child_process');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rt-kill-'));
    const quick = path.join(dir, 'quick.js'); const slow = path.join(dir, 'slow.js'); const summary = path.join(dir, 'summary.md');
    fs.writeFileSync(quick, '0;'); fs.writeFileSync(slow, 'setTimeout(() => {}, 60000);');
    const driver = path.join(dir, 'driver.js');
    fs.writeFileSync(driver, `const rt = require(${JSON.stringify(path.join(__dirname, '..', '..', 'scripts', 'run-tests.js'))});
rt.runMain({ suites: [{ name: 'quick-one', steps: [[${JSON.stringify(quick)}]] }, { name: 'slow-one', steps: [[${JSON.stringify(slow)}]] }], jobs: 1, bail: false, env: { ...process.env, GITHUB_STEP_SUMMARY: ${JSON.stringify(summary)} } });`);
    const child = spawn(process.execPath, [driver], { stdio: 'ignore' });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !(fs.existsSync(summary) && /\| quick-one \|/.test(fs.readFileSync(summary, 'utf8')))) await new Promise((r) => setTimeout(r, 50));
    const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
    child.kill('SIGKILL');
    await closed;
    const text = fs.readFileSync(summary, 'utf8');
    assert.ok(text.includes('### Suite times as they finish (') && text.includes('2 suites'), `the header is there: ${text}`);
    assert.ok(/\| quick-one \| \d+\.\d \| /.test(text), `the finished suite's row survives a kill: ${text}`);
    assert.ok(!/slow-one/.test(text), 'the unfinished suite has no row');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // the CPU temp folder is removed on every way out: a normal exit, process.exit, and (no --bail) SIGINT, SIGTERM and SIGHUP; with fakes first
  {
    const handlers: Record<string, () => void> = {};
    let exited: number | undefined;
    const proc = { on: (e: string, f: () => void) => { handlers[e] = f; }, exit: (c: number) => { exited = c; handlers.exit && handlers.exit(); } };
    const base = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rt-cpudir-'));
    const dir = rt.makeCpuDir({ proc, tmpdir: base, signals: true }) as string;
    assert.ok(dir && fs.existsSync(dir) && path.basename(dir).startsWith('suite-cpu-'));
    assert.deepStrictEqual(Object.keys(handlers).sort(), ['SIGHUP', 'SIGINT', 'SIGTERM', 'exit']);
    handlers.SIGTERM();
    assert.strictEqual(exited, 143, 'SIGTERM exits 128+15');
    assert.ok(!fs.existsSync(dir), 'the folder is gone after the signal');
    const h2: Record<string, () => void> = {};
    const dir2 = rt.makeCpuDir({ proc: { on: (e: string, f: () => void) => { h2[e] = f; }, exit: () => {} }, tmpdir: base, signals: false }) as string;
    assert.deepStrictEqual(Object.keys(h2), ['exit'], 'with --bail runMain owns the signals: only the exit cleanup is added');
    h2.exit();
    assert.ok(!fs.existsSync(dir2));
    assert.strictEqual(rt.makeCpuDir({ tmpdir: path.join(base, 'no', 'such') }), null, 'no folder, no CPU column, no throw');
    // a real process killed with SIGTERM (Windows has no catchable TERM: there only the exit cleanup applies)
    if (process.platform !== 'win32') {
      const { spawn } = require('child_process') as typeof import('child_process');
      const driver = path.join(base, 'driver.js');
      fs.writeFileSync(driver, `const rt = require(${JSON.stringify(path.join(__dirname, '..', '..', 'scripts', 'run-tests.js'))});
const d = rt.makeCpuDir({ tmpdir: ${JSON.stringify(base)} }); console.log(d); setInterval(() => {}, 1000);`);
      for (const sig of ['SIGTERM', 'SIGINT'] as const) {
        const child = spawn(process.execPath, [driver], { stdio: ['ignore', 'pipe', 'ignore'] });
        const made = await new Promise<string>((resolve) => child.stdout.once('data', (d) => resolve(String(d).trim())));
        assert.ok(fs.existsSync(made), 'the planted run made its folder');
        const code = await new Promise<number | null>((resolve) => { child.on('close', (c) => resolve(c)); child.kill(sig); });
        assert.strictEqual(code, sig === 'SIGTERM' ? 143 : 130, `${sig} exit code`);
        assert.ok(!fs.existsSync(made), `no folder is left behind after ${sig}`);
      }
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
  // the preload prints NOTHING (stdout and stderr both empty, whether the file is set, unset or unwritable) and counts only its own process: a fork()
  // child inherits --require but not the variable, so it reports nothing
  {
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rt-preload-'));
    const preload = path.join(__dirname, '..', '..', 'scripts', 'cpu-report.js');
    const file = path.join(dir, 'a.cpu');
    for (const [label, envFile] of [['set', file], ['unset', undefined], ['unwritable', path.join(dir, 'no', 'such', 'x.cpu')]] as [string, string | undefined][]) {
      const env = { ...process.env } as Record<string, string | undefined>; delete env.DURBAR_CPU_FILE; if (envFile) env.DURBAR_CPU_FILE = envFile;
      const r = spawnSync(process.execPath, ['--require', preload, '-e', 'let x = 0; for (let i = 0; i < 1e6; i++) x += i;'], { env: env as NodeJS.ProcessEnv, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `${label}: the preload never fails the step`);
      assert.strictEqual(r.stdout, '', `${label}: the preload prints nothing to stdout`);
      assert.strictEqual(r.stderr, '', `${label}: the preload prints nothing to stderr`);
    }
    assert.strictEqual(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1, 'one line for the one process');
    fs.rmSync(file);
    const child = path.join(dir, 'child.js'); const parent = path.join(dir, 'parent.js');
    fs.writeFileSync(child, 'let x = 0; for (let i = 0; i < 3e6; i++) x += i;');
    fs.writeFileSync(parent, `const cp = require("child_process"); cp.fork(${JSON.stringify(child)}).on("exit", () => {});`);
    const r = spawnSync(process.execPath, ['--require', preload, parent], { env: { ...process.env, DURBAR_CPU_FILE: file }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1, 'a fork() child is not counted: only the step\'s own process reports');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // startMain (what the command line runs) hands the CPU folder to the run: the summary row of a real step has a CPU number, not n/a
  {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rt-start-'));
    const okJs = path.join(dir, 'ok.js'); fs.writeFileSync(okJs, 'let x = 0; for (let i = 0; i < 3e6; i++) x += Math.sqrt(i);');
    const summary = path.join(dir, 'summary.md');
    await rt.startMain({ suites: [{ name: 'viastart', steps: [[okJs]] }], jobs: 1, bail: true, env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
    const row = fs.readFileSync(summary, 'utf8').split('\n').find((l) => l.startsWith('| viastart |')) || '';
    assert.ok(/^\d+\.\d$/.test((row.split('|')[3] || '').trim()), `startMain passes the CPU folder, so the row has CPU seconds: ${row}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // spec 117 FR-018: the heavy suites start first, longest first; the same suites run (nothing added, nothing dropped, the rest keep list order)
  {
    const names = rt.readSuiteList();
    const all = names.map((n) => ({ name: n }));
    const ordered = rt.orderSuites(all).map((s) => s.name);
    assert.deepStrictEqual(rt.HEAVY_FIRST, ['test:runtime-redact', 'test:brainstate', 'test:redact-monotone', 'test:redact-monotone-b', 'test:redact-monotone-c']);
    for (const n of rt.HEAVY_FIRST) assert.ok(names.includes(n), `${n} is a listed suite (a rename would silently lose the ordering)`);
    assert.deepStrictEqual(ordered.slice(0, 5), rt.HEAVY_FIRST);
    assert.deepStrictEqual([...ordered].sort(), [...names].sort(), 'the same suites run');
    assert.strictEqual(ordered.length, names.length);
    assert.deepStrictEqual(ordered.slice(5), names.filter((n) => !rt.HEAVY_FIRST.includes(n)), 'the others keep list order');
    // a filtered run (`npm test -- redact`) keeps only what it has; a heavy name that is not there is skipped, not invented
    assert.deepStrictEqual(rt.orderSuites([{ name: 'x' }, { name: 'test:brainstate' }, { name: 'y' }]).map((s) => s.name), ['test:brainstate', 'x', 'y']);
  }
  done = true;
  console.log('run-tests --bail: ok');
})().catch((e) => { console.error(e); process.exit(1); });
