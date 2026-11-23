#!/usr/bin/env node
/*
 * Spec 117 FR-386: the fast lane's runner (.github/workflows/fast-lane.yml, advisory, never a required check). It runs ONLY the `npm test`
 * suites the PR's diff touches, as .github/scripts/ci-changes.js `--suites` (the one decision) picked them, so a Windows or macOS bug is
 * heard about in minutes instead of at the end of the full Build and test leg. The required jobs still run every suite.
 *
 *   FAST_SUITES="test:a test:b" node scripts/fast-lane.js       (or the names as arguments)
 *
 * Since FR-390 the lane keeps a time budget and a deadline (planSuites, runLane below) and says in the job summary what it left out.
 * Every name must be a suite of scripts/test-suites.txt, or the run fails (no name reaches a shell; suites run through run-tests.js's own
 * runner, `node <file>` steps spawned without a shell). Only the selected test files are compiled (with the helpers, fakes and src files
 * tsconfig.scripts.json includes), not all ~280; the app is built first only when a selected suite's step file reads dist/. The time
 * of each phase goes to the job summary, so the lane's own runs measure it (spec 117 *Changes*).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { readSuiteList, loadSuites, runSuites, summaryHeader, summaryRow, formatSummary } = require('./run-tests');
const { printable } = require('./safe-print');

const ROOT = path.join(__dirname, '..');

/** The suites to run, in the decider's order (its direct picks first): every name must be on the list (an unknown name is an error,
 *  never skipped); a name given twice runs once. */
function pickSuites(names, pkg, list = readSuiteList()) {
  const unknown = names.filter((n) => !list.includes(n));
  if (unknown.length) throw new Error(`not a suite of scripts/test-suites.txt: ${unknown.map(printable).join(', ')}`);
  return loadSuites(pkg, [], [...new Set(names)]);
}

// spec 117 FR-390: the lane stays fast. Recorded seconds per suite (scripts/test-suite-timings.json, Windows medians; a suite with no
// entry counts as the median). A suite recorded over HEAVY_S is left to Build and test; the others are taken in the given order while
// the recorded total stays within BUDGET_S (a suite that does not fit is skipped and the next one tried); the suites get DEADLINE_MS of
// wall time, after which every running suite's process tree is stopped and the lane ends green with a note (it is advisory).
const HEAVY_S = 120;
const BUDGET_S = 480;
const DEADLINE_MS = 300 * 1000;
/** The recorded times, or null when the file is missing, unreadable or holds no number (the plan then fails closed). */
function readTimes(text) {
  try { const j = JSON.parse(text === undefined ? fs.readFileSync(path.join(__dirname, 'test-suite-timings.json'), 'utf8') : text); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
}
/** Which named suites run, by recorded time: { run, tooSlow, overBudget, seconds, broken } (names, in the given order). With no readable
 *  time at all (a missing or broken timings file) nothing runs: every suite is left to Build and test and `broken` says why (review of
 *  #2049: a broken file must never make every suite free). A suite missing from a readable file counts as the median. */
function planSuites(names, times = readTimes(), { heavy = HEAVY_S, budget = BUDGET_S } = {}) {
  const known = Object.values(times || {}).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!known.length) return { run: [], tooSlow: [...names], overBudget: [], seconds: 0, broken: true };
  const median = known[Math.floor(known.length / 2)];
  const t = (n) => (Number.isFinite(times[n]) ? times[n] : median);
  const run = [], tooSlow = [], overBudget = [];
  let seconds = 0;
  for (const n of names) {
    if (t(n) > heavy) tooSlow.push(n);
    else if (seconds + t(n) > budget) overBudget.push(n);
    else { run.push(n); seconds += t(n); }
  }
  return { run, tooSlow, overBudget, seconds: Math.round(seconds), broken: false };
}
/** From the decider's names to what runs: every asked name must be a suite (the ones left out too), then the plan, then the suites
 *  of the plan's run list only. The one path `main` takes, so the plan cannot be bypassed. */
function prepareRun(asked, pkg, times = readTimes(), list = readSuiteList()) {
  pickSuites(asked, pkg, list);
  const plan = planSuites([...new Set(asked)], times);
  return { plan, suites: plan.run.length ? pickSuites(plan.run, pkg, list) : [] };
}
/** The job summary lines for a plan (also printed). */
function planLines(plan, asked) {
  const out = [];
  if (plan.broken) out.push(`the timings file (scripts/test-suite-timings.json) is missing or unreadable: the lane runs nothing; Build and test runs all ${asked} picked suite(s)`);
  else if (!plan.run.length) out.push(`${asked} suite(s) picked, all over the time limits: left to Build and test`);
  else out.push(`${plan.run.length} of ${asked} picked suite(s), ${plan.seconds} s recorded (budget ${BUDGET_S} s): ${plan.run.join(' ')}`);
  if (!plan.broken && plan.tooSlow.length) out.push(`left to Build and test, recorded over ${HEAVY_S} s: ${plan.tooSlow.join(' ')}`);
  if (plan.overBudget.length) out.push(`left to Build and test, over the time budget: ${plan.overBudget.join(' ')}`);
  return out;
}
const SIGNALS = [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]];
const KILL_WAIT_MS = 10000;
/** Resolves when every child has exited (one already gone counts at once; an error counts as exited), or after `ms`. */
function waitForExit(children, ms, setTimer = setTimeout, clearTimer = clearTimeout) {
  const open = children.filter((c) => c && c.exitCode === null && c.signalCode == null);
  if (!open.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = open.length;
    const t = setTimer(resolve, ms);
    const done = () => { if (--left === 0) { clearTimer(t); resolve(); } };
    for (const c of open) { let once = false; const end = () => { if (!once) { once = true; done(); } }; c.once('close', end); c.once('error', end); }
  });
}
/** Run the suites with a wall-clock deadline. Children are spawned detached (bail mode of run-tests.js), so a stop takes each suite's
 *  whole process tree (POSIX process group; Windows taskkill /T): nothing is left running. SIGINT, SIGTERM and SIGHUP stop them the same
 *  way (the handlers are removed when the run ends) and give 128 + the signal number. Resolves to { code, note, times }: 1 when a suite
 *  failed, 0 when all passed or when the deadline stopped the rest (advisory: those run in Build and test; the note names them).
 *  `onSuite` gets each finished suite (the summary rows). Everything outside is injectable for tests. */
async function runLane({ suites, jobs, deadlineMs = DEADLINE_MS, run = runSuites, setTimer = setTimeout, clearTimer = clearTimeout, proc = process, onSuite = () => {}, spawnFn = spawn, killWaitMs = KILL_WAIT_MS }) {
  const ctl = {};
  // Windows: a stop is `taskkill /PID n /T /F`, a process of its own that run-tests.js does not wait for (review of #2049: the lane
  // returned while taskkill was still killing the tree). Every taskkill started here is awaited (bounded) before the lane returns.
  const killers = [];
  const spawnTracked = (cmd, args, opts) => { const c = spawnFn(cmd, args, opts); if (/^taskkill(\.exe)?$/i.test(path.basename(String(cmd)))) killers.push(c); return c; };
  let late = false, signalled = 0;
  const finished = new Set();
  const handlers = SIGNALS.map(([sig, n]) => { const h = () => { if (!signalled) signalled = 128 + n; if (ctl.abort) ctl.abort(); }; proc.on(sig, h); return [sig, h]; });
  const timer = setTimer(() => { late = true; if (ctl.abort) ctl.abort(); }, deadlineMs);
  let r;
  try {
    r = await run({ suites, jobs, bail: true, ctl, spawnFn: spawnTracked, onSuite: (t) => { finished.add(t.name); try { onSuite(t); } catch { /* the summary is optional */ } } });
  } finally {
    clearTimer(timer);
    for (const [sig, h] of handlers) proc.removeListener(sig, h);
  }
  await waitForExit(killers, killWaitMs, setTimer, clearTimer);
  const times = (r && r.times) || [];
  const failed = ((r && r.failed) || []).filter(Boolean);
  const rest = suites.map((x) => x.name).filter((n) => !finished.has(n));
  if (signalled) return { code: signalled, note: `stopped by a signal: the running suites were stopped; not finished: ${rest.join(' ') || 'none'}`, times };
  if (failed.length) return { code: 1, note: `failed: ${failed.join(' ')}`, times };
  if (late) return { code: 0, note: `deadline of ${Math.round(deadlineMs / 1000)} s reached: ${finished.size} suite(s) finished; stopped or not started (Build and test runs them): ${rest.join(' ') || 'none'}`, times };
  return { code: 0, note: 'all passed', times };
}

/** The TypeScript sources of the suites' steps (dist-scripts/X.js is X.ts). */
function tsSources(suites) {
  const out = new Set();
  for (const s of suites) for (const args of s.steps) {
    const m = /^dist-scripts\/(.+)\.js$/.exec(args[0] || '');
    if (m) out.add(`${m[1]}.ts`);
  }
  return [...out];
}

/** A tsconfig that compiles only these test files: the scripts project with every other scripts/test-*.ts left out. */
function fastTsconfig(sources, root = ROOT) {
  const abs = (p) => path.join(root, ...p.split('/')).split(path.sep).join('/');
  return {
    extends: abs('tsconfig.scripts.json'),
    files: sources.map(abs),
    exclude: [abs('scripts/prereview/**'), abs('scripts/test-*.ts')],
  };
}

// a step file that reads the app build (dist/, not dist-scripts/) needs `npm run build` first
const READS_DIST = /(^|[^\w-])dist(\/|['"`])/;
function needsBuild(suites, read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } }) {
  return suites.some((s) => s.steps.some((args) => {
    const f = args[0] || '';
    const src = /^dist-scripts\/(.+)\.js$/.test(f) ? f.replace(/^dist-scripts\/(.+)\.js$/, '$1.ts') : f;
    return READS_DIST.test(read(src));
  }));
}

/** Prepare the run: compile the picked test files, build the app when a step file reads dist/, fetch Electron for the suites that need it.
 *  Returns { ok, phases } (phase labels with seconds, for the summary). */
/** Write the temporary tsconfig for these test files in a folder INSIDE the repository root (a `.fast-lane-` folder, git-ignored), never the
 *  OS temp folder (spec 117, bug on #2052): TypeScript finds automatic types (node_modules/@types) from the config's folder upwards, so
 *  from the temp folder it found none and loaded Electron's nested @types/node beside the root one (two `http` modules, TS2345 that the
 *  full compile does not have). Returns { file, remove }. */
function writeFastTsconfig(sources, root = ROOT) {
  const dir = fs.mkdtempSync(path.join(root, '.fast-lane-'));
  const file = path.join(dir, 'tsconfig.json');
  fs.writeFileSync(file, JSON.stringify(fastTsconfig(sources, root), null, 2));
  return { file, remove: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left for git clean; ignored */ } } };
}
function prepareFiles(suites) {
  const phases = [];
  const phase = (label, fn) => { const t = Date.now(); const ok = fn(); phases.push(`${label} ${((Date.now() - t) / 1000).toFixed(1)} s`); return ok; };
  const tsc = (args) => spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), ...args], { cwd: ROOT, stdio: 'inherit', shell: false }).status === 0;
  const sources = tsSources(suites);
  if (sources.length) {
    const cfg = writeFastTsconfig(sources);
    let ok = false;
    try { ok = phase(`compile ${sources.length} test file(s)`, () => tsc(['-p', cfg.file])); } finally { cfg.remove(); }
    if (!ok) return { ok: false, phases };
  }
  if (needsBuild(suites) && !phase('build the app', () => tsc(['-p', 'tsconfig.json']) && spawnSync(process.execPath, ['scripts/copy-assets.js'], { cwd: ROOT, stdio: 'inherit', shell: false }).status === 0)) return { ok: false, phases };
  if (suites.some((s) => /checkfuses|macos/.test(s.name))) {
    const { ensureElectron } = require('./ensure-electron');
    phase('fetch Electron', () => ensureElectron());
  }
  return { ok: true, phases };
}
/** The lane from the decider's names to an exit code, on ONE path (review of #2049): the suites that run are only the ones
 *  `prepare` (prepareRun) returns; with none, nothing is prepared or run. Everything outside is injected, so the test drives it. */
async function laneMain({ asked, pkg, prepare = prepareRun, files = prepareFiles, lane = runLane, summary = () => {}, put = () => {}, jobs = 1, platform = process.platform, now = Date.now }) {
  if (!asked.length) { summary('fast lane: no suite to run'); return 0; }
  const { plan, suites } = prepare(asked, pkg);
  for (const line of planLines(plan, new Set(asked).size)) summary(`Fast lane (${platform}): ${line}`);
  if (!suites.length) return 0;
  const prep = files(suites);
  if (!prep.ok) { summary(`${prep.phases.join('; ')}: the test files did not compile or build`); return 1; }
  const t0 = now();
  put('\n' + summaryHeader(suites.length, { jobs })); // spec 117 FR-017: one row per suite as it ends, then the slowest suites
  const { code, note, times } = await lane({ suites, jobs, onSuite: (t) => put(summaryRow(t)) });
  if (times.length) put('\n' + formatSummary(times, { jobs, top: 10 }).replace('### Suite times', '### Slowest suites') + '\n');
  summary(`${prep.phases.join('; ')}${prep.phases.length ? '; ' : ''}suites ${((now() - t0) / 1000).toFixed(1)} s; ${note}`);
  return code;
}

function main() {
  const asked = (process.argv.slice(2).length ? process.argv.slice(2) : String(process.env.FAST_SUITES || '').split(/\s+/)).filter(Boolean);
  const put = (text) => { if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text); } catch { /* no summary */ } };
  const summary = (line) => { console.log(line); put(line + '\n'); };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const jobs = Math.max(1, Number(process.env.TEST_JOBS) || Math.min(os.cpus().length, 8));
  laneMain({ asked, pkg, summary, put, jobs }).then((code) => process.exit(code), (e) => { console.error(e && e.message ? printable(e.message) : e); process.exit(1); });
}

module.exports = { laneMain, prepareFiles, writeFastTsconfig, pickSuites, tsSources, fastTsconfig, needsBuild, READS_DIST, readTimes, planSuites, prepareRun, planLines, runLane, waitForExit, SIGNALS, HEAVY_S, BUDGET_S, DEADLINE_MS };
if (require.main === module) main();
