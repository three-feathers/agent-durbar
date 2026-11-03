/** Unit test (spec 008 FR-115): `npm test --bail` stops at the first failing suite and kills what runs, with fakes (no process is started or killed). */
import * as assert from 'assert';
import * as path from 'path';
import { EventEmitter } from 'events';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rt = require(path.join(__dirname, '..', '..', 'scripts', 'run-tests.js')) as {
  parseArgs: (argv: string[], env: Record<string, string | undefined>) => { bail: boolean; ignoredBail: boolean; filters: string[] };
  readSuiteList: (text?: string) => string[];
  unlistedSuites: (scripts: Record<string, string>, names?: string[], allow?: string[]) => string[];
  NOT_SUITES: string[];
  loadSuites: (pkg: unknown, filters: string[], names?: string[]) => { name: string; steps: string[][] }[];
  stopChild: (c: unknown, o: unknown) => void;
  runSuites: (o: Record<string, unknown>) => Promise<{ failed: string[]; bailed: string | null }>;
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
  done = true;
  console.log('run-tests --bail: ok');
})().catch((e) => { console.error(e); process.exit(1); });
