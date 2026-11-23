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
const { spawnSync } = require('child_process');
const { readSuiteList, loadSuites, runSuites } = require('./run-tests');
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
function readTimes() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'test-suite-timings.json'), 'utf8')); } catch { return {}; } }
/** Which named suites run, by recorded time: { run, tooSlow, overBudget, seconds } (names, in the given order). */
function planSuites(names, times = readTimes(), { heavy = HEAVY_S, budget = BUDGET_S } = {}) {
  const known = Object.values(times).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 0;
  const t = (n) => (Number.isFinite(times[n]) ? times[n] : median);
  const run = [], tooSlow = [], overBudget = [];
  let seconds = 0;
  for (const n of names) {
    if (t(n) > heavy) tooSlow.push(n);
    else if (seconds + t(n) > budget) overBudget.push(n);
    else { run.push(n); seconds += t(n); }
  }
  return { run, tooSlow, overBudget, seconds: Math.round(seconds) };
}
/** Run the suites with a wall-clock deadline. Children are spawned detached (bail mode of run-tests.js), so a stop takes each suite's
 *  whole process tree (POSIX process group; Windows taskkill /T): nothing is left running. Resolves to { code, note }: 1 when a suite
 *  failed, 0 when all passed or when the deadline stopped the rest (advisory: those run in Build and test). Injectable for tests. */
async function runLane({ suites, jobs, deadlineMs = DEADLINE_MS, run = runSuites, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const ctl = {};
  let late = false;
  const timer = setTimer(() => { late = true; if (ctl.abort) ctl.abort(); }, deadlineMs);
  const r = await run({ suites, jobs, bail: true, ctl });
  clearTimer(timer);
  const failed = (r.failed || []).filter(Boolean);
  if (failed.length) return { code: 1, note: `failed: ${failed.join(' ')}` };
  if (late) return { code: 0, note: `deadline of ${Math.round(deadlineMs / 1000)} s reached: the suites still running were stopped (advisory; Build and test runs them)` };
  return { code: 0, note: 'all passed' };
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

function main() {
  const asked = (process.argv.slice(2).length ? process.argv.slice(2) : String(process.env.FAST_SUITES || '').split(/\s+/)).filter(Boolean);
  const summary = (line) => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n'); } catch { /* no summary */ } };
  if (!asked.length) { console.log('fast lane: no suite to run'); return; }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  pickSuites(asked, pkg); // every asked name must be a suite, the ones left out too
  const plan = planSuites([...new Set(asked)]);
  summary(`Fast lane (${process.platform}): ${plan.run.length} of ${asked.length} picked suite(s), ${plan.seconds} s recorded (budget ${BUDGET_S} s): ${plan.run.join(' ') || 'none'}`);
  if (plan.tooSlow.length) summary(`left to Build and test, recorded over ${HEAVY_S} s: ${plan.tooSlow.join(' ')}`);
  if (plan.overBudget.length) summary(`left to Build and test, over the time budget: ${plan.overBudget.join(' ')}`);
  if (!plan.run.length) return;
  const suites = pickSuites(plan.run, pkg);
  const times = [];
  const phase = (label, fn) => { const t = Date.now(); const ok = fn(); times.push(`${label} ${((Date.now() - t) / 1000).toFixed(1)} s`); return ok; };
  const tsc = (args) => spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), ...args], { cwd: ROOT, stdio: 'inherit', shell: false }).status === 0;
  const sources = tsSources(suites);
  if (sources.length) {
    const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fast-lane-')), 'tsconfig.json');
    fs.writeFileSync(cfg, JSON.stringify(fastTsconfig(sources), null, 2));
    if (!phase(`compile ${sources.length} test file(s)`, () => tsc(['-p', cfg]))) process.exit(1);
  }
  if (needsBuild(suites)) {
    if (!phase('build the app', () => tsc(['-p', 'tsconfig.json']) && spawnSync(process.execPath, ['scripts/copy-assets.js'], { cwd: ROOT, stdio: 'inherit', shell: false }).status === 0)) process.exit(1);
  }
  if (suites.some((s) => /checkfuses|macos/.test(s.name))) {
    const { ensureElectron } = require('./ensure-electron');
    phase('fetch Electron', () => ensureElectron());
  }
  const t0 = Date.now();
  const jobs = Math.max(1, Number(process.env.TEST_JOBS) || Math.min(os.cpus().length, 8));
  runLane({ suites, jobs }).then(({ code, note }) => {
    summary(`${times.join('; ')}${times.length ? '; ' : ''}suites ${((Date.now() - t0) / 1000).toFixed(1)} s; ${note}`);
    process.exit(code);
  });
}

module.exports = { pickSuites, tsSources, fastTsconfig, needsBuild, READS_DIST, planSuites, runLane, HEAVY_S, BUDGET_S, DEADLINE_MS };
if (require.main === module) main();
