/*
 * Office layout checks in parallel (spec 008 delta 2026-10-19): one build, then every theme (or none) split into shards,
 * each in its own Electron (and its own xvfb display on Linux). Same checks as running them one by one.
 *
 *   node scripts/check-parallel.js            the default theme            (npm run check:office:fast)
 *   node scripts/check-parallel.js --themes   the 6 built-in themes and the user-theme fixture   (npm run check:themes)
 *
 * The machine must stay usable while it runs (an earlier version started 4 Electrons on a 4-core laptop with 2 GB free
 * and froze it). So:
 *   - at most half the CPUs at once (at least 1, at most 4), CHECK_JOBS=n to change it;
 *   - a job starts only while at least 1.5 GB of memory is available (MemAvailable on Linux);
 *   - if available memory falls under 600 MB, the newest job is stopped (its whole process group) and queued again;
 *   - everything runs at low priority (nice 10), so the desktop and the editor come first;
 *   - a job that takes longer than CHECK_TIMEOUT seconds (default 900) is stopped and counts as failed.
 * CHECK_SHARDS=n splits each theme into n shards (default 2). A failing job prints its full output; the rest print one line.
 * Motion is reduced (OFFICE_REDUCED_MOTION=1: walks are instant, nothing animates; about 30% faster): these runs check the layout
 * per theme, and the plain `npm run check:office` keeps motion on. CHECK_MOTION=1 keeps it on here too (CI's office job, spec 008 FR-105).
 * Before the first job, Electron is installed once (scripts/ensure-electron.js, spec 008 FR-114): parts that each fetched it raced on
 * the same file and exited 126 "Text file busy" (PR #546).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureElectron } = require('./ensure-electron');

const ROOT = path.join(__dirname, '..');
const themes = process.argv.includes('--themes');
const SHARDS = Math.max(1, Number(process.env.CHECK_SHARDS) || 2);
const JOBS = Math.max(1, Number(process.env.CHECK_JOBS) || Math.min(4, Math.floor(os.cpus().length / 2)));
const TIMEOUT_MS = (Number(process.env.CHECK_TIMEOUT) || 900) * 1000;
const MB = 1024 * 1024;
const START_MIN = 1536 * MB, PANIC_MIN = 600 * MB;
const WIN = process.platform === 'win32';

/** Memory a new process can get: MemAvailable on Linux (os.freemem() leaves out the page cache there on old Node), else freemem. */
const available = () => {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (m) return Number(m[1]) * 1024;
  } catch (_) { /* not Linux */ }
  return os.freemem();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const variants = themes
  ? ['clean-office', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese', 'cheeky-crew'].map((t) => ({ name: t, env: { DURBAR_THEME: t, OFFICE_THEME: t } }))
      .concat([{ name: 'user theme', env: { OFFICE_USER_THEME: 'scripts/fixtures/themes/check-user.json' } }])
  : [{ name: 'default', env: {} }];
const jobs = [];
for (const v of variants) for (let k = 0; k < SHARDS; k++) jobs.push({ label: `${v.name} ${k + 1}/${SHARDS}`, env: { ...v.env, OFFICE_SHARDS: String(SHARDS), OFFICE_SHARD: String(k) } });

const running = new Set();
/** Stop a job and everything it started (xvfb-run, Electron and its helpers): its own process group outside Windows. */
const stop = (r) => {
  try {
    if (WIN) spawn('taskkill', ['/pid', String(r.child.pid), '/t', '/f']);
    else process.kill(-r.child.pid, 'SIGKILL');
  } catch (_) { /* already gone */ }
};

const run = (job) => new Promise((resolve) => {
  const t0 = Date.now();
  const motion = process.env.CHECK_MOTION === '1' ? {} : { OFFICE_REDUCED_MOTION: '1' };
  const child = spawn(process.execPath, [path.join(__dirname, 'check-office-overlap.js')], { cwd: ROOT, env: { ...process.env, ...motion, ...job.env }, detached: !WIN });
  const r = { child, job, t0, why: '' };
  running.add(r);
  const timer = setTimeout(() => { r.why = 'timeout'; stop(r); }, TIMEOUT_MS);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => {
    clearTimeout(timer);
    running.delete(r);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (r.why === 'memory') { console.log(`  wait ${job.label.padEnd(22)} stopped: memory low, queued again (${secs}s)`); resolve('again'); return; }
    const summary = (out.match(/office check: .*/) || ['(no summary line)'])[0];
    if (code === 0) console.log(`  ok   ${job.label.padEnd(22)} ${summary} (${secs}s)`);
    else console.log(`  FAIL ${job.label.padEnd(22)} ${r.why || 'exit ' + code} (${secs}s)\n${out.split('\n').filter((l) => !/^\s+ok /.test(l)).join('\n')}`);
    resolve(code === 0 && !r.why ? 'ok' : 'fail');
  });
});

/**
 * Run every job and return how many failed. `ensure`, `runJob`, `available` and `log` are for tests (scripts/test-ui-suite.ts):
 * the defaults install Electron, start check-office-overlap.js and read the real memory.
 */
async function main({ ensure = ensureElectron, runJob = run, available: avail = available, jobs: list = jobs, workers = JOBS, log = console.log } = {}) {
  const t0 = Date.now();
  log(`check:parallel: ${list.length} jobs (${variants.length} x ${SHARDS} shards), up to ${workers} at a time, nice 10, motion ${process.env.CHECK_MOTION === '1' ? 'on' : 'reduced'}`);
  // FR-114: one install before the fan-out; without the binary every part would fail, so stop here and say why
  if (!ensure()) {
    log('check:parallel: the Electron binary is not installed and could not be fetched (see above); no part was started');
    return list.length;
  }
  // the guard: under PANIC_MIN, stop the newest job (it has done the least work) and queue it again
  const guard = setInterval(() => {
    if (running.size < 2 || avail() >= PANIC_MIN) return;
    const newest = [...running].sort((a, b) => b.t0 - a.t0)[0];
    newest.why = 'memory';
    stop(newest);
  }, 1000);
  const queue = list.slice();
  let failed = 0;
  await Promise.all(Array.from({ length: Math.min(workers, list.length) }, async (_, worker) => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      // worker 0 always runs (one job at a time is what the serial check did); the others wait for memory
      while (worker > 0 && avail() < START_MIN) await sleep(2000);
      const res = await runJob(j);
      if (res === 'again') { queue.push(j); await sleep(5000); } else if (res === 'fail') failed++;
    }
  }));
  clearInterval(guard);
  log(`\ncheck:parallel: ${list.length - failed}/${list.length} jobs passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return failed;
}

module.exports = { main, jobs };

if (require.main === module) {
  try { os.setPriority(10); } catch (_) { /* not allowed: run at normal priority */ }
  // the jobs have their own process groups, so Ctrl-C or a kill of this runner must take them along
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { for (const r of running) stop(r); process.exit(130); });
  main().then((failed) => process.exit(failed ? 1 : 0));
}
