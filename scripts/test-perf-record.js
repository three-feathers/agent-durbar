/*
 * `npm run test:perfrecord` (spec 097 T145, FR-187/FR-188): the record's shape and the pure helpers of scripts/perf-record.js, from a fixture. No Electron,
 * no timing. The driver run itself is `sim:` evidence (npm run check:perf -- --record f.json), and check-perf stays in ui-suite's NOT_IN_SUITE.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { median, medianOf, runsOf, loadFlag, validateRecord, parseArgs, buildRecord, writeRecord, runGroup, scrub, scrubDeep, oneLine, nonFinite, PHASE_ENV, SCHEMA, LIMITS } = require('./perf-record.js');

assert.strictEqual(median([3, 1, 2]), 2);
assert.strictEqual(median([1, 2, 3, 10]), 2.5);
assert.strictEqual(median([]), null);
assert.deepStrictEqual(medianOf([{ a: 1, b: { c: 10 }, s: 'x' }, { a: 3, b: { c: 30 }, s: 'y' }, { a: 2, b: { c: 20 }, s: 'z' }]), { a: 2, b: { c: 20 }, s: 'x' });
assert.deepStrictEqual(loadFlag([9, 1, 1], 4, 'linux'), { loaded: true, known: true });
assert.deepStrictEqual(loadFlag([1, 1, 1], 4, 'darwin'), { loaded: false, known: true });
assert.deepStrictEqual(loadFlag([0, 0, 0], 4, 'win32'), { loaded: false, known: false }, 'Windows reports no load average: unknown, never flagged');
assert.deepStrictEqual(parseArgs(['--record', 'f.json', '--quick']).runs, 1);
assert.strictEqual(parseArgs(['--record', 'f.json', '--runs', '5']).runs, 5);
assert.deepStrictEqual(parseArgs(['--only', 'real-15,flat-40']).only, ['real-15', 'flat-40']);

const good = () => ({
  schema: SCHEMA, recordedAt: '2026-10-31T12:00:00.000Z', appSha: 'abc123',
  machine: { platform: 'darwin', release: '24.0.0', arch: 'arm64', cpuModel: 'Apple M3', cores: 8, loadavg: [1, 1, 1], loaded: false },
  devicePixelRatio: 2, gpu: { gpu_compositing: 'enabled' },
  cases: Object.fromEntries(['flat-15', 'flat-40', 'real-15', 'real-40'].map((k) => [k, k.startsWith('real') ? { available: false, reason: 'no Real office in this build' } : { available: true, runs: 3, rows: { update: { costP50: 12 }, idleVisible: { totalPct: 4 } }, switches: { openToCabinsFrameMs: 30 } }])),
});
assert.deepStrictEqual(validateRecord(good()), [], 'a sound record, with Real office absent, passes');
const no = (f) => { const r = good(); f(r); return validateRecord(r); };
assert.ok(no((r) => { delete r.gpu; }).some((p) => /gpu_compositing/.test(p)), 'the compositing status is required');
assert.ok(no((r) => { r.machine.loaded = undefined; }).some((p) => /loaded/.test(p)), 'the load flag is required');
assert.ok(no((r) => { r.appSha = ''; }).some((p) => /appSha/.test(p)));
assert.ok(no((r) => { r.devicePixelRatio = 0; }).some((p) => /devicePixelRatio/.test(p)));
assert.ok(no((r) => { delete r.cases['flat-40']; }).some((p) => /flat-40/.test(p)), 'a missing case fails');
assert.ok(no((r) => { r.cases['real-40'] = { available: false }; }).some((p) => /real-40/.test(p)), 'an absent case must say why');


/* ---- median and medianOf: NaN, the union of the keys, and how many runs each number came from ---- */
assert.strictEqual(median([NaN, 4, Infinity, 2]), 3, 'NaN and Infinity are not numbers of the sample');
assert.strictEqual(median([NaN, null, 'x']), null, 'nothing finite is null, never NaN');
assert.deepStrictEqual(medianOf([{ a: 1 }, { a: NaN }, { b: 2, a: 3 }]), { a: 2, b: 2 }, 'a key the first run lacks is kept (it was dropped)');
assert.deepStrictEqual(runsOf([{ a: 1 }, { a: NaN }, { b: 2, a: 3 }]), { a: 2, b: 1 }, 'n per key counts only the runs that gave a finite number');
assert.deepStrictEqual(medianOf([{ x: { y: 1 } }, { x: { z: 5 } }]), { x: { y: 1, z: 5 } }, 'the union holds at every depth');
assert.deepStrictEqual(medianOf([JSON.parse('{"__proto__":{"p":1},"a":1}'), { a: 3 }]), { a: 2 }, 'a __proto__ key is dropped, never assigned');
assert.deepStrictEqual(medianOf([null, undefined]), null);
assert.strictEqual(Object.getPrototypeOf(medianOf([{ a: 1 }])), Object.prototype);

/* ---- parseArgs: the cap, a flag is never a file name ---- */
assert.strictEqual(parseArgs(['--runs', '99']).runs, 9, 'the runs cap is 9');
assert.strictEqual(parseArgs(['--runs', '0']).runs, 3, 'zero is the default');
assert.strictEqual(parseArgs(['--runs', 'x']).runs, 3);
assert.strictEqual(parseArgs(['--runs', '4.7']).runs, 4);
assert.strictEqual(parseArgs(['--record', '--gpu']).record, null, '--record --gpu has no file (it wrote a file named --gpu)');
assert.strictEqual(parseArgs(['--record', '--gpu']).gpu, true, 'and --gpu is still read as a flag');
assert.strictEqual(parseArgs(['--record']).record, null);
assert.strictEqual(parseArgs(['--record', 'out.json', '--gpu']).record, 'out.json');
assert.deepStrictEqual(parseArgs(['--only', '--quick']).only, [], '--only without a value is empty, not "--quick"');
assert.strictEqual(parseArgs(['--only', '--quick']).quick, true);
assert.ok(typeof PHASE_ENV === 'string' && PHASE_ENV !== 'PERF_PHASE' && /^DURBAR_/.test(PHASE_ENV), 'the recorder env var is not the old, easily leftover name');

/* ---- buildRecord from fixture launch outputs ---- */
const env = { recordedAt: '2026-11-03T10:00:00.000Z', appSha: 'abc123def', loadStart: [0.5, 0.5, 0.5], loadEnd: [1, 1, 1], cores: 8, platform: 'linux', release: '6.1', arch: 'x64', cpuModel: 'Fixture CPU', memoryGB: 16 };
const runRows = (cost) => ({ update: { costP50: cost }, idleVisible: { totalPct: 5 }, activity10: { p95: 20 } });
const okMain = (cost = 12) => ({ meta: { devicePixelRatio: 2, gpu: { gpu_compositing: 'enabled' }, electron: '40.0.0', chrome: '140' }, available: true, rows: runRows(cost), switches: { openToCabinsFrameMs: 30 }, raw: [runRows(cost), runRows(cost + 2), runRows(null)] });
const startOk = { start: { fromProcessStartMs: 900 }, memoryAtStart: { processMB: 300 } };
const opts = { runs: 3, quick: false, only: null };
const all = (f) => Object.fromEntries(['flat-15', 'flat-40', 'real-15', 'real-40'].map((k) => [k, f(k)]));
{
  const { record, broke } = buildRecord(opts, all(() => ({ seed: { available: true }, starts: [startOk, startOk], main: okMain() })), env);
  assert.strictEqual(broke, 0);
  assert.deepStrictEqual(validateRecord(record), [], 'four good cases make a sound record');
  assert.strictEqual(record.schema, SCHEMA);
  assert.strictEqual(record.appSha, 'abc123def', 'the sha of the build is written');
  assert.strictEqual(record.recordedAt, env.recordedAt);
  assert.strictEqual(record.machine.cpuModel, 'Fixture CPU', 'the cpu model is the given one');
  assert.strictEqual(record.machine.platform, 'linux');
  assert.strictEqual(record.machine.loaded, false, 'a load of 1 on 8 cores is not loaded');
  assert.deepStrictEqual(record.machine.loadavgAtStart, [0.5, 0.5, 0.5]);
  assert.strictEqual(record.devicePixelRatio, 2);
  assert.strictEqual(record.gpu.gpu_compositing, 'enabled');
  assert.strictEqual(record.simulator, true);
  assert.deepStrictEqual(record.limits, LIMITS);
  const c = record.cases['flat-15'];
  assert.strictEqual(c.rows.start.fromProcessStartMs, 900, 'the app start medians are merged into the rows');
  assert.strictEqual(c.appStartRuns, 2);
  assert.deepStrictEqual(c.runsPerRow.update, { costP50: 2 }, 'the run with null does not count');
  assert.strictEqual(c.rows.update.costP50, 12, 'the rows are the driver\'s medians, kept as given');
}
{ // no cpu model, a broken launch, a case that is absent, empty rows, a missing metric
  const noModel = buildRecord(opts, all(() => ({ main: okMain() })), { ...env, cpuModel: undefined }).record;
  assert.strictEqual(noModel.machine.cpuModel, 'unknown');
  assert.strictEqual(buildRecord(opts, all(() => ({ main: okMain() })), { ...env, cpuModel: 5 }).record.machine.cpuModel, 'unknown', 'a cpu model that is not a string is unknown');
  const loaded = buildRecord(opts, all(() => ({ main: okMain() })), { ...env, loadEnd: [20, 1, 1] }).record;
  assert.strictEqual(loaded.machine.loaded, true, 'a load above the cores is flagged');
  const noSha = buildRecord(opts, all(() => ({ main: okMain() })), { ...env, appSha: '' }).record;
  assert.strictEqual(noSha.appSha, 'unknown', 'an empty sha is "unknown", never an empty string');

  const mix = {
    'flat-15': { seed: { available: true }, starts: [{ error: 'no output (exit 1)' }, startOk], main: okMain() },
    'flat-40': { main: { error: 'no output (timed out)' } },
    'real-15': { main: { meta: okMain().meta, available: false, reason: 'no Real office in this build' } },
    'real-40': { main: { ...okMain(), rows: {} } },
  };
  const { record, broke } = buildRecord(opts, mix, env);
  assert.strictEqual(broke, 3, 'a start that broke, a main that broke and a case with empty rows');
  assert.strictEqual(record.cases['flat-15'].available, true);
  assert.strictEqual(record.cases['flat-15'].startErrors.length, 1);
  assert.strictEqual(record.cases['flat-15'].appStartRuns, 1);
  assert.strictEqual(record.cases['flat-40'].available, false);
  assert.strictEqual(record.cases['flat-40'].driverBroke, true);
  assert.match(record.cases['flat-40'].reason, /timed out/);
  assert.strictEqual(record.cases['real-15'].available, false);
  assert.ok(!record.cases['real-15'].driverBroke, 'absent in this build is not a failure');
  assert.strictEqual(record.cases['real-40'].available, false, 'empty rows are not recorded as an available case');
  assert.match(record.cases['real-40'].reason, /update\.costP50/);
  assert.deepStrictEqual(validateRecord(record), [], 'a record with absent and broken cases is still well-formed (they say why)');
  // metrics missing one by one
  for (const [group, field] of [['update', 'costP50'], ['idleVisible', 'totalPct']]) {
    const m = okMain(); m.rows[group] = { [field]: null };
    const r = buildRecord(opts, { 'flat-15': { main: m } }, env);
    assert.strictEqual(r.record.cases['flat-15'].available, false, `${group}.${field} null: not recorded as numbers`);
    assert.ok(r.broke >= 1);
  }
  // a seed that broke is counted
  assert.ok(buildRecord(opts, { 'flat-15': { seed: { error: 'x' }, main: okMain() } }, env).broke >= 1);
  // --only: a case not asked for is absent with that reason and not run
  const only = buildRecord({ ...opts, only: ['flat-15'] }, all(() => ({ main: okMain() })), env).record;
  assert.strictEqual(only.cases['flat-15'].available, true);
  assert.match(only.cases['flat-40'].reason, /--only/);
  assert.ok(!only.cases['real-15'].driverBroke);
  // the gpu comes from the first case that has meta, whichever; a later case does not replace it
  const g = buildRecord(opts, { 'flat-15': { main: { ...okMain(), meta: { devicePixelRatio: 1, gpu: { gpu_compositing: 'first' } } } }, 'flat-40': { main: { ...okMain(), meta: { devicePixelRatio: 2, gpu: { gpu_compositing: 'second' } } } } }, env).record;
  assert.strictEqual(g.gpu.gpu_compositing, 'first', 'the first launch with meta names the gpu (the last case no longer wins)');
  assert.strictEqual(g.devicePixelRatio, 1);
  const none = buildRecord(opts, {}, env);
  assert.strictEqual(none.record.gpu.gpu_compositing.startsWith('unknown'), true);
  assert.strictEqual(none.record.devicePixelRatio, 1, 'no launch produced a ratio: 1, said as the default');
}

/* ---- validateRecord: the metrics, and non-finite numbers ---- */
{
  const sound = () => buildRecord(opts, all(() => ({ main: okMain() })), env).record;
  assert.deepStrictEqual(validateRecord(sound()), []);
  const bad = (f) => { const r = sound(); f(r); return validateRecord(r); };
  assert.ok(bad((r) => { r.cases['flat-15'].rows = {}; }).some((p) => /rows\.update\.costP50/.test(p)), 'rows:{} is not sound');
  assert.ok(bad((r) => { delete r.cases['flat-15'].rows.idleVisible; }).some((p) => /idleVisible\.totalPct/.test(p)), 'a missing idleVisible is named');
  assert.ok(bad((r) => { r.cases['flat-15'].rows.update.costP50 = NaN; }).some((p) => /costP50/.test(p)), 'NaN in a metric fails');
  assert.ok(bad((r) => { r.cases['flat-15'].raw[0].update.costP50 = Infinity; }).some((p) => /raw\[0\]/.test(p)), 'a non-finite number anywhere fails and names its place');
  assert.ok(bad((r) => { delete r.cases['flat-15'].switches; }).some((p) => /switches/.test(p)), 'switches are required for an available case');
  assert.ok(bad((r) => { r.machine.cpuModel = 1; }).some((p) => /cpuModel/.test(p)));
  assert.ok(bad((r) => { r.schema = 'x'; }).some((p) => /schema/.test(p)));
  assert.deepStrictEqual(nonFinite({ a: [1, NaN], b: { c: -Infinity } }), ['a[1]', 'b.c']);
}

/* ---- no path of this computer in a shared record ---- */
{
  const dirs = { home: '/home/alice', app: '/home/alice/work/agent-durbar', tmp: '/tmp/x' };
  assert.strictEqual(scrub('Error at /home/alice/work/agent-durbar/scripts/a.js:3 in /tmp/x/ud/f', dirs), 'Error at <app>/scripts/a.js:3 in <tmp>/ud/f');
  assert.strictEqual(scrub('open /home/alice/.config/x', dirs), 'open <home>/.config/x');
  assert.strictEqual(scrub('read /home/bob/notes and /Users/carol/a and C:\\Users\\Dan\\b and C:/Users/eve/c', dirs), 'read <home>/notes and <home>/a and <home>\\b and <home>/c', 'another user name goes too');
  // another user's folder, one OS form at a time, with this machine's own folders as the defaults (each form fails when its rule is removed)
  const other = { home: '/home/zed', app: '/opt/app', tmp: '/var/t' };
  assert.strictEqual(scrub('read /home/bob/x', other), 'read <home>/x', 'Linux: /home/<other user>');
  assert.strictEqual(scrub('read /Users/carol/x', other), 'read <home>/x', 'macOS: /Users/<other user>');
  assert.strictEqual(scrub('read C:\\Users\\Dan\\x', other), 'read <home>\\x', 'Windows: C:\\Users\\<other user>');
  assert.strictEqual(scrub('read D:/Users/eve/x', other), 'read <home>/x', 'Windows with forward slashes');
  assert.ok(!/bob|carol|Dan/.test(scrub('/home/bob /Users/carol C:\\Users\\Dan')), 'with the default folders too');
  assert.strictEqual(scrub('plain text', dirs), 'plain text');
  assert.ok(!/alice|bob|carol|Dan|eve/.test(oneLine('DRIVER FAILED Error: no /home/alice/x\n    at /home/alice/work/agent-durbar/y.js', 200, dirs)), 'the first line only, scrubbed');
  assert.strictEqual(oneLine('a\nb'), 'a');
  assert.strictEqual(oneLine('x'.repeat(500), 50).length, 50);
  const real = scrub(`${os.homedir()}/secret and ${os.tmpdir()}/t`);
  assert.ok(!real.includes(os.homedir()) || os.homedir().length < 2, 'this machine\'s home is replaced');
  assert.deepStrictEqual(scrubDeep({ a: ['/home/alice/x', 1], b: { c: '/tmp/x/y' } }, dirs), { a: ['<home>/x', 1], b: { c: '<tmp>/y' } });
  // through buildRecord: a failure message that carries a home path, from a launch, a start, a driver error and a reason
  const leak = `no output (exit 1): DRIVER FAILED Error at ${os.homedir()}/private/thing.js`;
  const recd = buildRecord(opts, {
    'flat-15': { starts: [{ error: leak }], main: { ...okMain(), switches: { error: `boom ${os.homedir()}/x` } } },
    'flat-40': { main: { error: leak } },
    'real-15': { main: { meta: okMain().meta, available: false, reason: `see ${os.homedir()}/y` } },
  }, { ...env, cpuModel: 'CPU' }).record;
  const text = JSON.stringify(recd);
  assert.ok(!text.includes(os.homedir()) || os.homedir().length < 2, 'no home path in a record, from any field');
  assert.ok(!/\/home\/[a-z]/.test(text.replace(/<home>/g, '')), 'no /home/<name> left');
  assert.ok(/<home>/.test(text), 'and it says where one was');
}

/* ---- writing: an existing record survives a failure; the file is resolved; no temp file is left ---- */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-rec-test-'));
  try {
    const file = path.join(dir, 'rec.json');
    writeRecord(file, { a: 1 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
    const cyc = {}; cyc.me = cyc;
    assert.throws(() => writeRecord(file, cyc));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 }, 'a failed write leaves the earlier record whole');
    assert.throws(() => writeRecord(path.join(dir, 'no-such-folder', 'rec.json'), { b: 2 }));
    const realWrite = fs.writeFileSync, seen = [];
    fs.writeFileSync = (f, ...rest) => { seen.push(String(f)); return realWrite(f, ...rest); };
    try { writeRecord(file, { c: 3 }); } finally { fs.writeFileSync = realWrite; }
    assert.ok(seen.length && seen.every((f) => f !== file), 'the record is written to a temp file and renamed, never straight over the old one');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { c: 3 });
    assert.deepStrictEqual(fs.readdirSync(dir), ['rec.json'], 'no temp file is left');
    const cwd = process.cwd();
    process.chdir(dir);
    try { assert.strictEqual(writeRecord('rel.json', { d: 4 }), path.join(fs.realpathSync(dir), 'rel.json'), 'a relative name is resolved against the cwd'); } finally { process.chdir(cwd); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* ---- a timed-out launch leaves nothing running: the whole group is killed (POSIX; Windows uses taskkill /T) ---- */
async function groupTests() {
  if (process.platform === 'win32') return;
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const grand = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('PID '+c.pid);setInterval(()=>{},1000)";
  const r = await runGroup(process.execPath, ['-e', grand], { cwd: __dirname, env: process.env, timeoutMs: 1500 });
  assert.strictEqual(r.timedOut, true, 'the time limit fired');
  const pid = Number(/PID (\d+)/.exec(r.out)[1]);
  let gone = false;
  for (let i = 0; i < 100 && !gone; i++) { gone = !alive(pid); if (!gone) await new Promise((x) => setTimeout(x, 50)); }
  assert.ok(gone, 'the grandchild (an Electron behind xvfb-run) is killed with the group, not left running');
  const quick = await runGroup(process.execPath, ['-e', "console.log('hi')"], { cwd: __dirname, env: process.env, timeoutMs: 20000 });
  assert.strictEqual(quick.status, 0);
  assert.match(quick.out, /hi/);
  assert.strictEqual(quick.timedOut, false);
  const lost = await runGroup('this-command-does-not-exist-perf', [], { cwd: __dirname, env: process.env, timeoutMs: 2000 });
  assert.ok(lost.error, 'a command that cannot start is an error, not a hang');
}

// the driver files stay out of the pull-request suite and assert no time (AGENTS.md Timing)
const root = path.join(__dirname, '..');
assert.ok(/'check-perf':/.test(fs.readFileSync(path.join(root, 'scripts', 'ui-suite.js'), 'utf8')), 'check-perf stays in NOT_IN_SUITE');
for (const f of ['perf-record.js', 'perf-record-driver.js']) {
  const src = fs.readFileSync(path.join(root, 'scripts', f), 'utf8');
  assert.ok(!/require\('assert'\)|shell:\s*true|execSync\(/.test(src), `${f} asserts nothing and spawns no shell`);
  assert.ok(!/\/home\/|\/proc\/self|python/.test(src.replace(/\/proc\/\$\{m\.pid\}[^`]*/g, '')), `${f} has no private path and no Python`);
}
groupTests().then(() => console.log('perf-record: ok'), (e) => { console.error(e); process.exit(1); });
