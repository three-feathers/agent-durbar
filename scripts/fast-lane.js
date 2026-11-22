#!/usr/bin/env node
/*
 * Spec 117 FR-386: the fast lane's runner (.github/workflows/fast-lane.yml, advisory, never a required check). It runs ONLY the `npm test`
 * suites the PR's diff touches, as .github/scripts/ci-changes.js `--suites` (the one decision) picked them, so a Windows or macOS bug is
 * heard about in minutes instead of at the end of the full Build and test leg. The required jobs still run every suite.
 *
 *   FAST_SUITES="test:a test:b" node scripts/fast-lane.js       (or the names as arguments)
 *
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
const { readSuiteList, loadSuites, runMain } = require('./run-tests');
const { printable } = require('./safe-print');

const ROOT = path.join(__dirname, '..');

/** The suites to run: every name must be on the list (an unknown name is an error, never skipped). */
function pickSuites(names, pkg, list = readSuiteList()) {
  const unknown = names.filter((n) => !list.includes(n));
  if (unknown.length) throw new Error(`not a suite of scripts/test-suites.txt: ${unknown.map(printable).join(', ')}`);
  return loadSuites(pkg, [], list.filter((n) => names.includes(n)));
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
  const names = (process.argv.slice(2).length ? process.argv.slice(2) : String(process.env.FAST_SUITES || '').split(/\s+/)).filter(Boolean);
  if (!names.length) { console.log('fast lane: no suite to run'); return; }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const suites = pickSuites(names, pkg);
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
  const summary = (line) => { if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n'); } catch { /* no summary */ } };
  const t0 = Date.now();
  const jobs = Math.max(1, Number(process.env.TEST_JOBS) || Math.min(os.cpus().length, 8));
  summary(`Fast lane (${process.platform}): ${suites.length} suite(s): ${suites.map((s) => s.name).join(' ')}`);
  runMain({ suites, jobs, bail: false, t0, exit: (code) => {
    summary(`${times.join('; ')}${times.length ? '; ' : ''}suites ${((Date.now() - t0) / 1000).toFixed(1)} s; exit ${code}`);
    process.exit(code);
  } }).then(() => { summary(`${times.join('; ')}${times.length ? '; ' : ''}suites ${((Date.now() - t0) / 1000).toFixed(1)} s; all passed`); });
}

module.exports = { pickSuites, tsSources, fastTsconfig, needsBuild, READS_DIST };
if (require.main === module) main();
