#!/usr/bin/env node
/*
 * `npm test` (spec 008 delta 2026-10-19: faster CI). The suites are the `npm run test:*` names in the `test:serial` script,
 * which stays the single list and still runs everything one by one. Here the scripts are compiled ONCE (each `test:*` script
 * starts with its own `tsc`, 40 compiles of about 5 s), then the suites run in parallel, each suite's own steps in order.
 *
 *   npm test                     all suites, parallel (TEST_JOBS=n to change the worker count; default: CPUs minus one, at most 8; nice 10)
 *   npm test -- folders claude   only suites whose name contains one of the words
 *   npm run test:serial          the old way, one after another
 *
 * Every suite writes its own temp folders; a suite's output is printed when it ends, whole, so lines never interleave.
 */
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const TSC_PREFIX = /^tsc -p tsconfig\.scripts\.json\s*&&\s*/;

const names = pkg.scripts['test:serial'].split('&&').map((s) => s.trim().replace(/^npm run /, ''));
const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = names
  .filter((n) => !filters.length || filters.some((f) => n.includes(f)))
  .map((name) => {
    const cmd = pkg.scripts[name];
    if (!cmd) throw new Error(`test:serial names ${name}, which is not a script`);
    const steps = cmd.replace(TSC_PREFIX, '').split('&&').map((s) => s.trim().split(/\s+/));
    for (const s of steps) if (s[0] !== 'node') throw new Error(`${name}: only "node <file>" steps are supported here, got "${s.join(' ')}"`);
    return { name, steps: steps.map((s) => s.slice(1)) };
  });

const t0 = Date.now();
const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.scripts.json'], { cwd: ROOT, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status || 1);
console.log(`compiled the test scripts once in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${suites.length} suites`);

// Electron 44 has no postinstall: the first `require('electron')` downloads the binary. Two suites doing that in parallel (test:checkfuses,
// test:macos) raced on a fresh CI runner and one read a half-written binary ("Could not find sentinel", Windows, #424). Fetch it once here.
if (suites.some((s) => /checkfuses|macos/.test(s.name))) {
  const e = spawnSync(process.execPath, ['-e', "require('electron')"], { cwd: ROOT, stdio: 'inherit' });
  if (e.status !== 0) console.log('note: the Electron binary could not be fetched up front; the suites that need it will say why');
}

// leave a core for the desktop and run at low priority, so the machine stays usable while the suites run
const jobs = Math.max(1, Number(process.env.TEST_JOBS) || Math.min(os.cpus().length - 1, 8));
try { os.setPriority(10); } catch (_) { /* not allowed: normal priority */ }
const runStep = (args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });

const failed = [];
let next = 0;
const worker = async () => {
  while (next < suites.length) {
    const s = suites[next++];
    const st = Date.now();
    let log = '';
    let code = 0;
    for (const args of s.steps) {
      const r = await runStep(args);
      log += r.out;
      if (r.code !== 0) { code = r.code || 1; break; }
    }
    const secs = ((Date.now() - st) / 1000).toFixed(1);
    if (code) {
      failed.push(s.name);
      process.stdout.write(`\nFAIL ${s.name} (${secs} s)\n${log}\n`);
    } else process.stdout.write(`ok   ${s.name} (${secs} s)\n`);
  }
};

Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, worker)).then(() => {
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  if (failed.length) {
    console.log(`\n${failed.length} of ${suites.length} suites failed in ${total} s: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nall ${suites.length} suites passed in ${total} s (${jobs} at a time)`);
});
