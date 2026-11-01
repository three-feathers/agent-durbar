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
 *
 * With --bail no new suite starts after the first failure and the running ones are stopped (POSIX: the suite's whole process group;
 * Windows: `taskkill /T /F` on its tree), so no Electron or Xvfb is left behind. The final run, PR CI and the merge queue run everything.
 * Every suite writes its own temp folders; a suite's output is printed when it ends, whole, so lines never interleave.
 */
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TSC_PREFIX = /^tsc -p tsconfig\.scripts\.json\s*&&\s*/;

// spec 008 FR-115: `--bail` or TEST_BAIL=1 (anything but empty, 0, false); the other arguments are name filters
// Under CI (CI set, not empty/0/false) the flag is ignored: CI always runs everything (ignoredBail says so, the caller prints a line).
const truthy = (v) => !['', '0', 'false'].includes(String(v || '').toLowerCase());
function parseArgs(argv, env) {
  const asked = argv.includes('--bail') || truthy(env.TEST_BAIL);
  const ci = truthy(env.CI);
  return { bail: asked && !ci, ignoredBail: asked && ci, filters: argv.filter((a) => !a.startsWith('-')) };
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

// Stop one child this runner started, with everything it started, and only that. POSIX: the child was spawned detached (its pid is
// its process group id), so SIGTERM goes to the group; anything still alive after GRACE_MS gets SIGKILL, and so does the group once the
// child's pipes close (a grandchild that ignores TERM keeps them open, so the child would never close). Windows: taskkill /T /F forces
// the whole tree at once, spawned without a shell.
const GRACE_MS = 5000;
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

// Run the suites with `jobs` at a time. Returns { failed: [names], bailed: name | null }. Everything the outside world touches
// (spawn, kill, platform, output, clock) is injected so scripts/test-run-tests.ts can drive it with fakes.
async function runSuites({ suites, jobs, bail = false, cwd = ROOT, env = process.env, platform = process.platform, spawnFn = spawn, kill = process.kill,
  write = (t) => process.stdout.write(t), now = Date.now, running = new Set(), stopOpts = {}, ctl = {} }) {
  const failed = [];
  let bailed = null;
  let next = 0;
  const runStep = (args) =>
    new Promise((resolve) => {
      const p = spawnFn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: bail && platform !== 'win32' });
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
      for (const args of s.steps) {
        if (bailed) return;
        const r = await runStep(args);
        log += r.out;
        if (r.code !== 0) { code = r.code || 1; break; }
      }
      if (bailed) return; // stopped by another suite's failure: its result means nothing
      const secs = ((now() - st) / 1000).toFixed(1);
      if (code) {
        failed.push(s.name);
        write(`\nFAIL ${s.name} (${secs} s)\n${log}\n`);
        if (bail) { bailed = s.name; stopAll(); }
      } else write(`ok   ${s.name} (${secs} s)\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, worker));
  return { failed, bailed };
}

// The wiring of a run: handlers, the run, the summary and the exit code. `exit` is injectable. When bailing, Ctrl-C or a kill of this runner
// stops the suites the same way a bail does (TERM, then KILL after the grace period) and the exit code is 128 + the signal number
// (SIGINT 130, SIGTERM 143, SIGHUP 129), not 1.
function runMain({ suites, jobs, bail, t0 = Date.now(), exit = process.exit, running = new Set(), stopOpts = {}, env = process.env }) {
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
  return runSuites({ suites, jobs, bail, running, stopOpts, ctl, env }).then(({ failed, bailed }) => {
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

module.exports = { parseArgs, readSuiteList, unlistedSuites, NOT_SUITES, loadSuites, stopChild, runSuites, runMain };

if (require.main === module) {
  const { ensureElectron } = require('./ensure-electron');
  const pkg = require(path.join(ROOT, 'package.json'));
  const { bail, ignoredBail, filters } = parseArgs(process.argv.slice(2), process.env);
  if (ignoredBail) console.log('--bail ignored under CI: running every suite');
  const suites = loadSuites(pkg, filters);

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
  runMain({ suites, jobs, bail, t0 });
}
