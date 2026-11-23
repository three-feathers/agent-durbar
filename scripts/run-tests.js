#!/usr/bin/env node
/*
 * `npm test` (spec 008 delta 2026-10-19: faster CI). The suites are the `npm run test:*` names in scripts/test-suites.txt (one per line;
 * spec 008 delta 2026-11-01, it was one 4 KB line in package.json that conflicted in every PR pair), the single list. Here the scripts are compiled ONCE (each `test:*` script
 * starts with its own `tsc`, 40 compiles of about 5 s), then the suites run in parallel, each suite's own steps in order.
 *
 *   npm test                     all suites, parallel (TEST_JOBS=n to change the worker count; default: CPUs minus one, at most 8; nice 10)
 *   npm test -- folders claude   only suites whose name contains one of the words
 *   npm test -- --bail           (or TEST_BAIL=1) stop at the first failing suite, for iterating; the default still runs everything
 *   npm run test:serial          (--serial) one suite after another, same list
 *   npm test -- --shard 1/2      (or TEST_SHARD=1/2) part 1 of 2 of the list, split by recorded time (spec 117 FR-018: CI runs each part as its own job)
 *
 * With --bail no new suite starts after the first failure and the running ones are stopped (POSIX: the suite's whole process group;
 * Windows: `taskkill /T /F` on its tree), so no Electron or Xvfb is left behind. The final run, PR CI and the merge queue run everything.
 * Spec 117 FR-017: with GITHUB_STEP_SUMMARY set, the run appends each suite's wall and CPU seconds to the job summary (longest first), on every OS.
 * CPU is the suite's own node steps' main processes (a preload, scripts/cpu-report.js, reports process.cpuUsage() at exit); every child a step starts (a fork() included, an Electron too) is not counted. The summary is written as the suites end (a header, one row per suite), so a run cut short keeps the suites done so far.
 * Spec 117 FR-018: the five heaviest suites (#1983) start first, longest first; the same suites run, none is dropped.
 * Every suite runs with its own empty TMPDIR and fails if a `durbar-*` entry is left in it (spec 012 FR-166). A suite's output is printed when it ends, whole, so lines never interleave.
 */
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const { parseShardSpec, medianOf, timeParts } = require('./time-shard');

const ROOT = path.join(__dirname, '..');
const TSC_PREFIX = /^tsc -p tsconfig\.scripts\.json\s*&&\s*/;

// spec 008 FR-115: `--bail` or TEST_BAIL=1 (anything but empty, 0, false); the other arguments are name filters
// Under CI (CI set, not empty/0/false) the flag is ignored: CI always runs everything (ignoredBail says so, the caller prints a line).
// The value after `--shard` is not a filter (parseShard reads it).
const truthy = (v) => !['', '0', 'false'].includes(String(v || '').toLowerCase());
function parseArgs(argv, env) {
  const asked = argv.includes('--bail') || truthy(env.TEST_BAIL);
  const ci = truthy(env.CI);
  return { bail: asked && !ci, ignoredBail: asked && ci, filters: argv.filter((a, k) => !a.startsWith('-') && argv[k - 1] !== '--shard') };
}

// spec 117 FR-018 (#1983): `--shard i/n` (or `--shard=i/n`, or TEST_SHARD=i/n; the flag wins) runs part i of n. A bare `--shard` is refused, never
// "every suite"; an empty or unset TEST_SHARD means the whole list. Returns the spec string, or '' for the whole list.
function parseShard(argv, env) {
  const k = argv.findIndex((a) => a === '--shard' || a.startsWith('--shard='));
  if (k < 0) return String(env.TEST_SHARD || '');
  const v = argv[k] === '--shard' ? argv[k + 1] : argv[k].slice('--shard='.length);
  if (!v || v.startsWith('-')) throw new Error('run-tests: --shard wants a value i/n (1 <= i <= n), got none');
  return v;
}

// scripts/test-suite-timings.json: recorded seconds per suite, only to balance the parts; a suite with no entry counts as the median
const SUITE_TIMES = path.join(__dirname, 'test-suite-timings.json');
function readSuiteTimes(text = fs.readFileSync(SUITE_TIMES, 'utf8')) { return JSON.parse(text); }

// Part i of n of the suite names, by recorded time (scripts/time-shard.js, the split ui-suite.js uses too): the heavy redact suites land in different
// parts. Before returning, every part is computed and checked: each name of the list is in exactly one part and no part is empty, so a suite cannot
// fall out of CI between the shard jobs (a failed check fails the shard job, and with it the required "Build and test (<os>)" summary). `split` is
// injectable so scripts/test-run-tests.ts can prove the check catches a split that drops or repeats a suite. No spec: the whole list.
function shardNames(names, spec, times = readSuiteTimes(), split = timeParts) {
  if (!spec) return { names, parts: [names] };
  const { i, n } = parseShardSpec(spec, 'run-tests');
  const median = medianOf(times);
  const w = (name) => (Number.isFinite(times[name]) ? times[name] : median);
  const parts = split(names, n, w);
  const where = new Map(names.map((x) => [x, 0]));
  for (const p of parts) for (const x of p) {
    if (!where.has(x)) throw new Error(`run-tests: the split put ${x} in a part, but it is not in test-suites.txt`);
    where.set(x, where.get(x) + 1);
  }
  for (const [x, c] of where) if (c !== 1) throw new Error(`run-tests: ${x} is in ${c} of the ${n} parts, expected exactly 1: the parts must hold every suite once`);
  if (parts.length !== n || parts.some((p) => !p.length)) throw new Error(`run-tests: --shard ${spec} needs ${n} parts that each hold a suite`);
  return { names: parts[i - 1], parts, seconds: parts.map((p) => Math.round(p.reduce((a, x) => a + w(x), 0))) };
}

// scripts/test-suites.txt: one `test:*` script name per line; blank lines and `#` comments are ignored; a name twice is an error
const SUITE_LIST = path.join(__dirname, 'test-suites.txt');
function readSuiteList(text = fs.readFileSync(SUITE_LIST, 'utf8')) {
  const names = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const seen = new Set();
  for (const n of names) { if (seen.has(n)) throw new Error(`test-suites.txt lists ${n} twice`); seen.add(n); }
  return names;
}

// `test:*` scripts that are not suites on purpose: chains that run listed suites, and the manual matrix against the real Claude CLI (no AI credits in `npm test`)
const NOT_SUITES = ['test:serial', 'test:runtime', 'test:notes', 'test:claudecli'];
// every `test:*` script of package.json that neither the list nor NOT_SUITES names: a forgotten suite, which would never run
function unlistedSuites(scripts, names = readSuiteList(), allow = NOT_SUITES) {
  return Object.keys(scripts).filter((k) => /^test:/.test(k) && !names.includes(k) && !allow.includes(k));
}

// the suites: the names of the list, each as the ordered `node <file>` steps of its script
function loadSuites(pkg, filters, names = readSuiteList()) {
  return names
    .filter((n) => !filters.length || filters.some((f) => n.includes(f)))
    .map((name) => {
      const cmd = pkg.scripts[name];
      if (!cmd) throw new Error(`test-suites.txt names ${name}, which is not a script`);
      const steps = cmd.replace(TSC_PREFIX, '').split('&&').map((s) => s.trim().split(/\s+/));
      for (const s of steps) if (s[0] !== 'node') throw new Error(`${name}: only "node <file>" steps are supported here, got "${s.join(' ')}"`);
      return { name, steps: steps.map((s) => s.slice(1)) };
    });
}

// What a command line runs: the part `--shard`/TEST_SHARD names (of the whole list, so every job of a CI run splits the same list), then the name
// filters inside it. `note` is the line printed for a part (its count, and that every suite is in exactly one part). Throws on a bad shard value.
function selectSuites(pkg, argv, env, names = readSuiteList(), times = readSuiteTimes()) {
  const spec = parseShard(argv, env);
  const part = shardNames(names, spec, times);
  const suites = loadSuites(pkg, parseArgs(argv, env).filters, part.names);
  const note = spec ? `shard ${spec}: ${part.names.length} of ${names.length} suites; every suite is in exactly one of the ${part.parts.length} parts (suites per part: ${part.parts.map((p) => p.length).join(', ')}; recorded seconds per part: ${part.seconds.join(', ')})` : '';
  return { suites, part, note };
}

// spec 117 FR-018 (#1983): the five heaviest suites, longest first (Windows seconds in #1983: 507, 338, about 300 each). They start first so the
// last suites to run are short and a slow runner does not end on a 500 s suite. Only the ORDER changes: the same suites run (orderSuites keeps the
// rest in list order, adds none, drops none; scripts/test-run-tests.ts asserts it on the real list).
const HEAVY_FIRST = ['test:runtime-redact', 'test:brainstate', 'test:redact-monotone', 'test:redact-monotone-b', 'test:redact-monotone-c'];
function orderSuites(suites, heavy = HEAVY_FIRST) {
  const rank = (s) => { const i = heavy.indexOf(s.name); return i < 0 ? heavy.length : i; };
  return suites.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

// spec 117 FR-017: the job summary table (markdown): one row per suite, wall seconds longest first, then CPU seconds
// (`n/a` when a suite's steps reported none); a total row. `times` is [{ name, wall, cpu }] (cpu null when unknown).
function formatSummary(times, { os: osName = process.platform, jobs = 0, top = 0 } = {}) {
  const sorted = [...times].sort((a, b) => b.wall - a.wall || a.name.localeCompare(b.name));
  const f = (n) => (n === null || n === undefined ? 'n/a' : n.toFixed(1));
  const wall = times.reduce((n, t) => n + t.wall, 0);
  const cpu = times.reduce((n, t) => n + (t.cpu || 0), 0);
  const lines = [`### Suite times (${osName}, ${times.length} suites${jobs ? `, ${jobs} at a time` : ''})`, '', '| Suite | Wall s | CPU s |', '|---|---:|---:|'];
  for (const t of top ? sorted.slice(0, top) : sorted) lines.push(`| ${t.name} | ${f(t.wall)} | ${f(t.cpu)} |`);
  lines.push(`| **total (sum of suites)** | ${f(wall)} | ${f(cpu)} |`, '');
  return lines.join('\n');
}

// the CPU seconds the preload wrote for one suite (one number per line, microseconds, one line per node process); null when none
// the incremental part of the summary (written as each suite ends, so a job cancelled at its limit keeps what finished)
const summaryHeader = (count, { os: osName = process.platform, jobs = 0 } = {}) => `### Suite times as they finish (${osName}, ${count} suites${jobs ? `, ${jobs} at a time` : ''})\n\n| Suite | Wall s | CPU s |\n|---|---:|---:|\n`;
const summaryRow = (t) => `| ${t.name} | ${t.wall.toFixed(1)} | ${t.cpu === null || t.cpu === undefined ? 'n/a' : t.cpu.toFixed(1)} |\n`;

function readCpuSeconds(file) {
  try {
    const us = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
    return us.length ? us.reduce((a, b) => a + b, 0) / 1e6 : null;
  } catch (_) { return null; }
}

// Stop one child this runner started, with everything it started, and only that. POSIX: the child was spawned detached (its pid is
// its process group id), so SIGTERM goes to the group; anything still alive after GRACE_MS gets SIGKILL, and so does the group once the
// child's pipes close (a grandchild that ignores TERM keeps them open, so the child would never close). Windows: taskkill /T /F forces
// the whole tree at once, spawned without a shell.
const GRACE_MS = 5000;
const CPU_REPORT = path.join(__dirname, 'cpu-report.js');
function stopChild(child, { platform = process.platform, spawnFn = spawn, kill = process.kill, graceMs = GRACE_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!child || !child.pid) return;
  try {
    if (platform === 'win32') {
      const t = spawnFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      if (t && t.on) t.on('error', () => {});
      return;
    }
    kill(-child.pid, 'SIGTERM');
  } catch (_) { return; /* already gone */ }
  const force = () => { try { kill(-child.pid, 'SIGKILL'); } catch (_) { /* nothing left */ } };
  const timer = setTimer(force, graceMs);
  if (child.once) child.once('close', () => { clearTimer(timer); force(); });
}

// spec 012 FR-166 (#1093): every suite gets its own empty temp folder (TMPDIR/TEMP/TMP, so os.tmpdir() is inside it). When the suite ends, a
// `durbar-*` entry left in it is a leak: the suite fails and names the entry. The folder is removed either way, so a leak never piles up.
function suiteTmpEnv(env, dir) { return { ...env, TMPDIR: dir, TEMP: dir, TMP: dir }; }
function makeSuiteTmp(base = os.tmpdir()) { return fs.mkdtempSync(path.join(base, 'suite-tmp-')); }
function leftBehind(dir) {
  try { return fs.readdirSync(dir).filter((n) => n.startsWith('durbar-')).sort(); } catch (_) { return []; }
}
function removeSuiteTmp(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* the OS cleans its temp folder */ } }

// Run the suites with `jobs` at a time. Returns { failed: [names], bailed: name | null }. Everything the outside world touches
// (spawn, kill, platform, output, clock) is injected so scripts/test-run-tests.ts can drive it with fakes.
async function runSuites({ suites, jobs, bail = false, cwd = ROOT, env = process.env, platform = process.platform, spawnFn = spawn, kill = process.kill,
  write = (t) => process.stdout.write(t), now = Date.now, cpuDir = null, onSuite = () => {}, running = new Set(), stopOpts = {}, ctl = {}, tmp = { make: makeSuiteTmp, left: leftBehind, remove: removeSuiteTmp } }) {
  const failed = [];
  const times = [];
  let bailed = null;
  let next = 0;
  // cpuDir (spec 117 FR-017): each step is started with `--require scripts/cpu-report.js`, which appends its CPU microseconds to DURBAR_CPU_FILE
  // (a folder of its own, not the suite's TMPDIR, so the leak check and suites that list their temp folder never see it). Off when null.
  const runStep = (args, stepEnv, cpuFile) =>
    new Promise((resolve) => {
      const p = spawnFn(process.execPath, cpuFile ? ['--require', CPU_REPORT, ...args] : args, { cwd, env: cpuFile ? { ...stepEnv, DURBAR_CPU_FILE: cpuFile } : stepEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: bail && platform !== 'win32' });
      running.add(p);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', (code) => { running.delete(p); resolve({ code, out }); });
      p.on('error', (e) => { running.delete(p); resolve({ code: 1, out: out + String(e) }); });
    });
  const stopAll = () => { for (const p of running) stopChild(p, { platform, spawnFn, kill, ...stopOpts }); };
  // ctl.abort(): stop everything for a signal; nothing is reported as a failure after it
  ctl.abort = () => { bailed = bailed || '(signal)'; stopAll(); };
  const worker = async () => {
    while (next < suites.length && !bailed) {
      const s = suites[next++];
      const st = now();
      let log = '';
      let code = 0;
      const tmpDir = tmp.make();
      const cpuFile = cpuDir ? path.join(cpuDir, `${next}.cpu`) : null;
      for (const args of s.steps) {
        if (bailed) break;
        const r = await runStep(args, suiteTmpEnv(env, tmpDir), cpuFile);
        log += r.out;
        if (r.code !== 0) { code = r.code || 1; break; }
      }
      const leaks = bailed ? [] : tmp.left(tmpDir);
      tmp.remove(tmpDir);
      if (bailed) return;
      if (!code && leaks.length) {
        code = 1;
        log += `${s.name} left ${leaks.length} durbar-* temp entr${leaks.length === 1 ? 'y' : 'ies'} behind (${leaks.slice(0, 5).join(', ')}${leaks.length > 5 ? ', ...' : ''}): remove what the suite makes (try/finally) or use a helper that does\n`;
      }
      const wallS = (now() - st) / 1000;
      const secs = wallS.toFixed(1);
      const entry = { name: s.name, wall: wallS, cpu: cpuFile ? readCpuSeconds(cpuFile) : null };
      times.push(entry);
      try { onSuite(entry); } catch (_) { /* the summary is optional */ }
      if (code) {
        failed.push(s.name);
        write(`\nFAIL ${s.name} (${secs} s)\n${log}\n`);
        if (bail) { bailed = s.name; stopAll(); }
      } else write(`ok   ${s.name} (${secs} s)\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, worker));
  return { failed, bailed, times };
}

// The folder the CPU files go to, removed on every way out of this process: a normal exit and process.exit (the 'exit' event) and, when `signals`
// is set (no --bail: with --bail runMain's handlers exit, which lands here too), SIGINT, SIGTERM and SIGHUP (exit code 128 + n). Windows has no
// catchable TERM, so there a killed runner can leave it (it is in the OS temp folder). null when no folder could be made (no CPU column then).
function makeCpuDir({ proc = process, tmpdir = os.tmpdir(), signals = true } = {}) {
  let dir = null;
  try { dir = fs.mkdtempSync(path.join(tmpdir, 'suite-cpu-')); } catch (_) { return null; }
  proc.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ } });
  if (signals) for (const [sig, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) proc.on(sig, () => proc.exit(128 + n));
  return dir;
}

// What the command line does after the suites are chosen: the CPU folder (its own signal handlers only without --bail: with --bail runMain's handlers
// stop the running suites first and exit, and the folder goes with that exit) and the run. Exported so a test drives the same wiring.
function startMain({ suites, jobs, bail, t0 = Date.now(), env = process.env }) {
  const cpuDir = makeCpuDir({ signals: !bail });
  return runMain({ suites, jobs, bail, t0, cpuDir, env });
}

// The wiring of a run: handlers, the run, the summary and the exit code. `exit` is injectable. When bailing, Ctrl-C or a kill of this runner
// stops the suites the same way a bail does (TERM, then KILL after the grace period) and the exit code is 128 + the signal number
// (SIGINT 130, SIGTERM 143, SIGHUP 129), not 1.
function runMain({ suites, jobs, bail, t0 = Date.now(), exit = process.exit, running = new Set(), stopOpts = {}, env = process.env, cpuDir = null, appendFile = fs.appendFileSync }) {
  let signalled = 0;
  const ctl = {};
  if (bail) {
    for (const [sig, n] of [['SIGINT', 2], ['SIGHUP', 1], ['SIGTERM', 15]]) {
      process.on(sig, () => {
        if (signalled) return;
        signalled = 128 + n;
        if (ctl.abort) ctl.abort();
        // safety: leave when the suites are gone, or soon after the grace period
        const end = Date.now() + GRACE_MS + 1000;
        setInterval(() => { if (!running.size || Date.now() > end) exit(signalled); }, 100);
      });
    }
  }
  // spec 117 FR-017: the suite times go to the job summary as each suite ends, pass or fail (a job cancelled at its limit keeps the suites done so far);
  // never fatal: the first write error prints one note and the rest are skipped
  const summary = env.GITHUB_STEP_SUMMARY;
  let summaryOk = !!summary;
  const put = (text) => {
    if (!summaryOk) return;
    try { appendFile(summary, text); } catch (e) { summaryOk = false; console.log(`note: could not write the suite times to the job summary (${e.code || e.message})`); }
  };
  put(summaryHeader(suites.length, { jobs }));
  return runSuites({ suites, jobs, bail, running, stopOpts, ctl, env, cpuDir, onSuite: (t) => put(summaryRow(t)) }).then(({ failed, bailed, times }) => {
    if (times.length) put('\n' + formatSummary(times, { jobs, top: 10 }).replace('### Suite times', '### Slowest suites') + '\n');
    const total = ((Date.now() - t0) / 1000).toFixed(1);
    if (signalled) { console.log(`\nstopped by a signal after ${total} s; the suites were stopped, so the run is not complete`); exit(signalled); return; }
    if (bailed) {
      console.log(`\nstopped at the first failure (--bail): ${bailed} failed after ${total} s; the other suites were cut short, so the run is not complete`);
      exit(1);
      return;
    }
    if (failed.length) {
      console.log(`\n${failed.length} of ${suites.length} suites failed in ${total} s: ${failed.join(', ')}`);
      exit(1);
      return;
    }
    console.log(`\nall ${suites.length} suites passed in ${total} s (${jobs} at a time)`);
  });
}

module.exports = { summaryHeader, summaryRow, suiteTmpEnv, leftBehind, parseArgs, parseShard, readSuiteTimes, shardNames, selectSuites, readSuiteList, unlistedSuites, NOT_SUITES, loadSuites, stopChild, runSuites, runMain, startMain, HEAVY_FIRST, orderSuites, formatSummary, readCpuSeconds, makeCpuDir };

if (require.main === module) {
  const { ensureElectron } = require('./ensure-electron');
  const pkg = require(path.join(ROOT, 'package.json'));
  const { bail, ignoredBail } = parseArgs(process.argv.slice(2), process.env);
  if (ignoredBail) console.log('--bail ignored under CI: running every suite');
  let suites;
  try { const sel = selectSuites(pkg, process.argv.slice(2), process.env); suites = orderSuites(sel.suites); if (sel.note) console.log(sel.note); } catch (e) { console.error(e.message); process.exit(2); }

  const t0 = Date.now();
  const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.scripts.json'], { cwd: ROOT, stdio: 'inherit' });
  if (tsc.status !== 0) process.exit(tsc.status || 1);
  console.log(`compiled the test scripts once in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${suites.length} suites${bail ? ' (--bail: stops at the first failure)' : ''}`);

  // Electron 44 has no postinstall: the first `require('electron')` downloads the binary. Two suites doing that in parallel (test:checkfuses,
  // test:macos) raced on a fresh CI runner and one read a half-written binary ("Could not find sentinel", Windows, #424). Fetch it once here
  // (scripts/ensure-electron.js, shared with check-parallel.js and ui-suite.js: spec 008 FR-114).
  if (suites.some((s) => /checkfuses|macos/.test(s.name))) {
    if (!ensureElectron()) console.log('note: the Electron binary could not be fetched up front; the suites that need it will say why');
  }

  // leave a core for the desktop and run at low priority, so the machine stays usable while the suites run
  const jobs = process.argv.includes('--serial') ? 1 : Math.max(1, Number(process.env.TEST_JOBS) || Math.min(os.cpus().length - 1, 8));
  try { os.setPriority(10); } catch (_) { /* not allowed: normal priority */ }
  startMain({ suites, jobs, bail, t0 });
}
