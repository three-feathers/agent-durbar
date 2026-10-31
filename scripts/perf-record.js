/*
 * `check-perf.js --record <file>` (spec 097 FR-187, FR-188, T145): the plain-Node half. It starts one Electron per launch (the
 * simulator, never a real session: 0 AI credits), merges what `perf-record-driver.js` writes into one JSON record, and has the pure
 * helpers (medians, the record's shape check) that `npm run test:perfrecord` runs without Electron.
 *
 * No timing assert anywhere: a number is recorded, never judged (AGENTS.md *Timing*, spec 021 FR-048b). Exit 0 unless the driver
 * itself breaks (no Electron, no output, a launch that crashed).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCHEMA = 'durbar-perf-record/1';
const MODES = ['flat', 'real'];
const SIZES = [15, 40];

/** Median of the numbers in `a` (the mean of the middle two when even); null for none. */
function median(a) {
  const s = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
}

/** Medians of runs shaped alike: numbers by key at every depth; anything else takes the first run's value. Arrays are kept from the first run. */
function medianOf(runs) {
  const list = runs.filter((r) => r !== undefined && r !== null);
  if (!list.length) return null;
  const first = list[0];
  if (typeof first === 'number') return median(list);
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const out = {};
    for (const k of Object.keys(first)) out[k] = medianOf(list.map((r) => (r && typeof r === 'object' ? r[k] : undefined)));
    return out;
  }
  return first;
}

/** The machine is under load when the one-minute load average exceeds its cores. Windows reports 0, so it is never flagged there (and the record says so). */
function loadFlag(loadavg, cores, platform) {
  if (platform === 'win32') return { loaded: false, known: false };
  return { loaded: loadavg[0] > cores, known: true };
}

/** Problems with a record's shape, as strings; [] when it is sound. A fixture in test-perf-record.js and the CLI both use it. */
function validateRecord(r) {
  const bad = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  need(r && r.schema === SCHEMA, `schema is ${SCHEMA}`);
  if (!r || typeof r !== 'object') return bad;
  need(typeof r.recordedAt === 'string' && !Number.isNaN(Date.parse(r.recordedAt)), 'recordedAt is a date');
  need(typeof r.appSha === 'string' && r.appSha.length > 0, 'appSha is set (a sha, or "unknown")');
  const m = r.machine || {};
  need(typeof m.platform === 'string' && typeof m.release === 'string' && typeof m.arch === 'string', 'machine names the OS, release and arch');
  need(Number.isInteger(m.cores) && m.cores > 0, 'machine.cores');
  need(Array.isArray(m.loadavg) && m.loadavg.length === 3, 'machine.loadavg');
  need(typeof m.loaded === 'boolean', 'machine.loaded (FR-188)');
  need(typeof r.devicePixelRatio === 'number' && r.devicePixelRatio > 0, 'devicePixelRatio');
  need(r.gpu && typeof r.gpu.gpu_compositing === 'string', 'gpu.gpu_compositing (FR-188)');
  need(r.cases && typeof r.cases === 'object', 'cases');
  for (const mode of MODES) {
    for (const n of SIZES) {
      const c = r.cases && r.cases[`${mode}-${n}`];
      need(c && typeof c === 'object', `case ${mode}-${n} is present (as rows or as skipped with a reason)`);
      if (!c) continue;
      if (c.available === false) need(typeof c.reason === 'string' && c.reason.length > 0, `case ${mode}-${n} says why it is absent`);
      else need(c.available === true && c.rows && typeof c.rows === 'object' && Number.isInteger(c.runs), `case ${mode}-${n} has rows and runs`);
    }
  }
  return bad;
}

function appSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  const sha = r.status === 0 ? String(r.stdout).trim() : '';
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'src', 'scripts'], { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  return sha ? sha + (dirty.status === 0 && String(dirty.stdout).trim() ? '-dirty' : '') : String(process.env.GITHUB_SHA || 'unknown');
}

function parseArgs(argv) {
  const o = { record: null, runs: 3, quick: false, gpu: false, only: null, cases: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--record') o.record = argv[++i];
    else if (a === '--runs') o.runs = Math.max(1, Math.min(9, Number(argv[++i]) || 3));
    else if (a === '--quick') o.quick = true; // short windows, 1 run: a smoke of the driver, not a record
    else if (a === '--gpu') o.gpu = true; // also the A/B rows of T162 (blur, blending, animations on and off) in Real office
    else if (a === '--only') o.only = String(argv[++i] || '').split(',').filter(Boolean); // e.g. real-15,flat-40
  }
  if (o.quick) o.runs = 1;
  return o;
}

/** One Electron launch with the record driver; returns the JSON it wrote, or { error }. Needs xvfb-run on Linux without a display. */
function launch(electron, env, outFile, timeoutMs) {
  const args = ['.'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const e = { ...process.env, ...env, DURBAR_DRIVER: path.join(__dirname, 'check-perf.js'), PERF_OUT: outFile };
  const xvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const r = xvfb
    ? spawnSync('xvfb-run', ['-a', electron, ...args], { cwd: ROOT, env: e, encoding: 'utf8', shell: false, timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 26 })
    : spawnSync(electron, args, { cwd: ROOT, env: e, encoding: 'utf8', shell: false, timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 26 });
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  if (!fs.existsSync(outFile)) {
    const why = r.error ? String(r.error.message) : `exit ${r.status}${r.signal ? ' ' + r.signal : ''}`;
    const failed = log.split('\n').filter((l) => /DRIVER FAILED|\[perf-record\]/.test(l)).slice(-3).join(' | ');
    return { error: `no output (${why})${failed ? ': ' + failed : ''}` };
  }
  try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (err) { return { error: 'unreadable output: ' + err.message }; }
}

function recordAll(opts) {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) { console.error('dist/ missing: run npm run build first'); return 2; }
  const electron = require('electron');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-perf-rec-'));
  const base = { PERF_SECONDS_SCALE: opts.quick ? 'quick' : 'full', PERF_RUNS: String(opts.runs), PERF_GPU: opts.gpu ? '1' : '' };
  const record = {
    schema: SCHEMA,
    recordedAt: new Date().toISOString(),
    appSha: appSha(),
    simulator: true,
    quick: opts.quick,
    machine: null,
    devicePixelRatio: null,
    gpu: null,
    setup: { window: '1440x900', runs: opts.runs, launchesPerCase: 1, medians: true, activity: 'simspeed=10, 20 s', note: 'rAF deltas; no assert on any number' },
    cases: {},
    limits: LIMITS,
  };
  let broke = 0;
  const start = os.loadavg();
  for (const mode of MODES) {
    for (const n of SIZES) {
      const key = `${mode}-${n}`;
      if (opts.only && !opts.only.includes(key)) { record.cases[key] = { mode, n, available: false, reason: 'not asked for (--only)' }; continue; }
      const per = path.join(work, key);
      fs.mkdirSync(per);
      const userData = path.join(per, 'ud');
      fs.mkdirSync(userData);
      const env = { ...base, DURBAR_SIM: String(n), DURBAR_USER_DATA: userData, PERF_MODE: mode };
      fs.mkdirSync(path.join(per, 'ud-main'));
      console.log(`[perf-record] ${key}: seed`);
      const seed = launch(electron, { ...env, PERF_PHASE: 'seed' }, path.join(per, 'seed.json'), 120000);
      const starts = [];
      if (!seed.error && seed.available !== false) {
        for (let i = 0; i < opts.runs; i++) {
          console.log(`[perf-record] ${key}: app start ${i + 1}/${opts.runs}`);
          const s = launch(electron, { ...env, PERF_PHASE: 'start' }, path.join(per, `start-${i}.json`), 120000);
          if (s.error) { starts.push({ error: s.error }); broke++; } else starts.push(s);
        }
      }
      console.log(`[perf-record] ${key}: steady (${opts.runs} run${opts.runs > 1 ? 's' : ''})`);
      const main = launch(electron, { ...env, PERF_PHASE: 'main', DURBAR_USER_DATA: path.join(per, 'ud-main') }, path.join(per, 'main.json'), 3600000);
      if (main.error) { broke++; record.cases[key] = { mode, n, available: false, reason: 'the driver broke: ' + main.error, driverBroke: true }; continue; }
      if (main.meta && !record.machine) {
        record.devicePixelRatio = main.meta.devicePixelRatio;
        record.gpu = main.meta.gpu;
        record.electron = main.meta.electron;
        record.chrome = main.meta.chrome;
      }
      if (main.available === false) { record.cases[key] = { mode, n, available: false, reason: main.reason }; continue; }
      const goodStarts = starts.filter((s) => !s.error && s.start).map((s) => ({ start: s.start, memoryAtStart: s.memoryAtStart }));
      record.cases[key] = {
        mode, n, available: true, runs: opts.runs,
        rows: { ...main.rows, ...(goodStarts.length ? medianOf(goodStarts) : {}) },
        appStartRuns: goodStarts.length,
        startErrors: starts.filter((s) => s.error).map((s) => s.error),
        switches: main.switches || undefined,
        raw: main.raw,
        ab: main.ab || undefined,
      };
    }
  }
  const end = os.loadavg();
  const cores = os.cpus().length;
  record.machine = {
    platform: process.platform, release: os.release(), arch: process.arch, cores, cpuModel: (os.cpus()[0] || {}).model || 'unknown',
    memoryGB: Math.round(os.totalmem() / 1073741824 * 10) / 10, loadavg: end.map((x) => Math.round(x * 100) / 100), loadavgAtStart: start.map((x) => Math.round(x * 100) / 100),
    ...loadFlag([Math.max(start[0], end[0]), end[1], end[2]], cores, process.platform), electron: record.electron, chrome: record.chrome,
  };
  record.devicePixelRatio = record.devicePixelRatio || 1;
  record.gpu = record.gpu || { gpu_compositing: 'unknown (no launch produced output)' };
  if (opts.record) fs.writeFileSync(opts.record, JSON.stringify(record, null, 1) + '\n');
  const problems = validateRecord(record);
  for (const p of problems) console.log('[perf-record] record problem: ' + p);
  const ok = Object.values(record.cases).filter((c) => c.available).length;
  const absent = Object.entries(record.cases).filter(([, c]) => !c.available && !c.driverBroke).map(([k]) => k);
  console.log(`[perf-record] ${ok} case(s) recorded; absent (no mode in this build): ${absent.join(', ') || 'none'}; gpu_compositing=${record.gpu.gpu_compositing}; load ${record.machine.loadavg[0]} on ${cores} cores${record.machine.loaded ? ' (LOADED: flagged, not for ratios)' : ''}`);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* temp folder; the OS cleans it */ }
  return broke || problems.length || !ok ? 1 : 0;
}

const LIMITS = [
  'Frames are requestAnimationFrame deltas: they see main-thread work and a late frame, not compositor-only or GPU-process jank, raster time, scrolling done off the main thread, or tearing.',
  'With gpu_compositing disabled_software (Xvfb, a runner) the GPU process CPU is Skia drawing in software: blending, blur and raster are far worse than on a GPU. Only main-thread rows carry over.',
  'Device pixel ratio 1 hides Retina (4 times the pixels); a record names the ratio it ran at.',
  'CPU is /proc ticks on Linux (percent of one core); elsewhere Electron percentCPUUsage, whose scale differs by OS. Memory is PSS on Linux and working set elsewhere: compare within one OS only.',
  'Activity is the simulator at simspeed=10, not a real agent; the runs of a case share one launch; the mode-switch rows are taken first, in the fresh profile of that launch, and app start has a launch of its own per run.',
  'A machine under load (load average above its cores; unknown on Windows) is flagged and is not for ratios.',
];

module.exports = { SCHEMA, MODES, SIZES, LIMITS, median, medianOf, loadFlag, validateRecord, parseArgs, recordAll };
