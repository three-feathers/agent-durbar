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
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCHEMA = 'durbar-perf-record/1';
const MODES = ['flat', 'real'];
const SIZES = [15, 40];
/** The env var only `recordAll` sets, so a leftover one in a shell never turns `npm run check:perf` into the recorder. */
const PHASE_ENV = 'DURBAR_PERF_RECORD_PHASE';
const MAX_RUNS = 9;

/** Median of the numbers in `a` (the mean of the middle two when even); null for none. */
function median(a) {
  const s = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
}

/**
 * The value of runs shaped alike, and how many runs each number came from. Objects: the union of the keys of every run (a key the first run lacks
 * is kept), at every depth; numbers: the median of the finite ones, `n` counting only those; anything else takes the first run's value. Arrays are kept from the first run.
 * `n` has the shape of the value, so a number that only 2 of 3 runs produced says 2.
 */
function summarise(runs) {
  const list = runs.filter((r) => r !== undefined && r !== null);
  if (!list.length) return { value: null, n: 0 };
  const nums = list.filter((r) => typeof r === 'number');
  const objs = list.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (nums.length && nums.length >= objs.length) return { value: median(nums), n: nums.filter(Number.isFinite).length };
  if (objs.length) {
    const value = {}, n = {};
    const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))].filter((k) => k !== '__proto__');
    for (const k of keys) { const r = summarise(objs.map((o) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined))); value[k] = r.value; n[k] = r.n; }
    return { value, n };
  }
  return { value: list[0], n: list.length };
}
const medianOf = (runs) => summarise(runs).value;
const runsOf = (runs) => summarise(runs).n;

/** The machine is under load when the one-minute load average exceeds its cores. Windows reports 0, so it is never flagged there (and the record says so). */
function loadFlag(loadavg, cores, platform) {
  if (platform === 'win32') return { loaded: false, known: false };
  return { loaded: loadavg[0] > cores, known: true };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Every number in `v` that is NaN or infinite, as a path (`rows.update.costP50`). JSON would turn them into null without a word. */
function nonFinite(v, at = '', out = []) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(at || '(root)'); }
  else if (Array.isArray(v)) v.forEach((x, i) => nonFinite(x, `${at}[${i}]`, out));
  else if (isObj(v)) for (const k of Object.keys(v)) nonFinite(v[k], at ? `${at}.${k}` : k, out);
  return out;
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
  need(typeof m.cpuModel === 'string' && m.cpuModel.length > 0, 'machine.cpuModel');
  need(Number.isInteger(m.cores) && m.cores > 0, 'machine.cores');
  need(Array.isArray(m.loadavg) && m.loadavg.length === 3, 'machine.loadavg');
  need(typeof m.loaded === 'boolean', 'machine.loaded (FR-188)');
  need(typeof r.devicePixelRatio === 'number' && r.devicePixelRatio > 0, 'devicePixelRatio');
  need(r.gpu && typeof r.gpu.gpu_compositing === 'string', 'gpu.gpu_compositing (FR-188)');
  need(r.cases && typeof r.cases === 'object', 'cases');
  for (const mode of MODES) {
    for (const n of SIZES) {
      const key = `${mode}-${n}`;
      const c = r.cases && r.cases[key];
      need(c && typeof c === 'object', `case ${key} is present (as rows or as skipped with a reason)`);
      if (!c) continue;
      if (c.available === false) { need(typeof c.reason === 'string' && c.reason.length > 0, `case ${key} says why it is absent`); continue; }
      need(c.available === true && isObj(c.rows) && Number.isInteger(c.runs), `case ${key} has rows and runs`);
      if (!isObj(c.rows)) continue;
      for (const [g, f] of REQUIRED_METRICS) need(isObj(c.rows[g]) && finite(c.rows[g][f]), `case ${key}: rows.${g}.${f} is a finite number`);
      need(isObj(c.switches), `case ${key} has switches (a timeline or its error)`);
    }
  }
  for (const p of nonFinite(r)) bad.push(`${p} is not a finite number`);
  return bad;
}

/** The metrics every recorded case must carry: row group, field. (The spec 097 table's update cost and idle CPU; the rest may be absent where a mode lacks it.) */
const REQUIRED_METRICS = [['update', 'costP50'], ['idleVisible', 'totalPct']];

/* ---- no path of this computer in a record meant to be shared ---- */

/** `text` with this machine's home, app and temp folders, and any user folder of Linux, macOS or Windows, replaced by a label. */
function scrub(text, dirs) {
  const d = dirs || { home: os.homedir(), app: ROOT, tmp: os.tmpdir() };
  let s = String(text);
  const win = process.platform === 'win32';
  for (const [label, dir] of [['<app>', d.app], ['<tmp>', d.tmp], ['<home>', d.home]]) {
    if (!dir || dir.length < 2) continue;
    for (const v of new Set([dir, dir.replace(/\\/g, '/'), dir.replace(/\//g, '\\')])) {
      s = win ? s.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), label) : s.split(v).join(label);
    }
  }
  return s.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s:'"]+/gi, '<home>').replace(/\/(?:home|Users)\/[^/\s:'"]+/g, '<home>');
}
/** The first line, scrubbed, at most `n` characters: all a failure may put in a shared record. */
const oneLine = (text, n = 200, dirs) => scrub(String(text).split('\n')[0], dirs).slice(0, n);
/** Every string of `v` scrubbed (a copy). */
function scrubDeep(v, dirs) {
  if (typeof v === 'string') return scrub(v, dirs);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, dirs));
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = scrubDeep(v[k], dirs); return o; }
  return v;
}

function appSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  const sha = r.status === 0 ? String(r.stdout).trim() : '';
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'src', 'scripts'], { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  return sha ? sha + (dirty.status === 0 && String(dirty.stdout).trim() ? '-dirty' : '') : String(process.env.GITHUB_SHA || 'unknown');
}

/** The value after a flag, or undefined when there is none or it is the next flag (`--record --gpu` has no file). */
function valueAt(argv, i) {
  const v = argv[i + 1];
  return typeof v === 'string' && v.length && !v.startsWith('--') ? v : undefined;
}

function parseArgs(argv) {
  const o = { record: null, runs: 3, quick: false, gpu: false, only: null, cases: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--record') { const v = valueAt(argv, i); if (v !== undefined) { o.record = v; i++; } }
    else if (a === '--runs') { const v = valueAt(argv, i); if (v !== undefined) i++; o.runs = Math.max(1, Math.min(MAX_RUNS, Math.floor(Number(v)) || 3)); }
    else if (a === '--quick') o.quick = true; // short windows, 1 run: a smoke of the driver, not a record
    else if (a === '--gpu') o.gpu = true; // also the A/B rows of T162 (blur, blending, animations on and off) in Real office
    else if (a === '--only') { const v = valueAt(argv, i); if (v !== undefined) i++; o.only = String(v || '').split(',').filter(Boolean); } // e.g. real-15,flat-40
  }
  if (o.quick) o.runs = 1;
  return o;
}

/**
 * One child with its whole process group under a time limit: on a timeout (or when the leader ends and leaves children) the group is killed, so no
 * Electron or Xvfb is left behind. Async `spawn`, an args array, no shell. Resolves { status, signal, timedOut, out, error }.
 */
function runGroup(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    let child;
    try { child = spawn(cmd, args, { cwd, env, shell: false, windowsHide: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { resolve({ status: null, signal: null, timedOut: false, out: '', error }); return; }
    let out = '', timedOut = false;
    const add = (d) => { if (out.length < (1 << 26)) out += d; };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const killGroup = () => {
      try { if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false }); else process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: null, signal: null, timedOut, out, error }); });
    child.on('close', (status, signal) => { clearTimeout(timer); killGroup(); resolve({ status, signal, timedOut, out }); });
  });
}

/** One Electron launch with the record driver; returns the JSON it wrote, or { error }. Needs xvfb-run on Linux without a display. */
async function launch(electron, env, outFile, timeoutMs) {
  const args = ['.'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const e = { ...process.env, ...env, DURBAR_DRIVER: path.join(__dirname, 'check-perf.js'), PERF_OUT: outFile };
  const xvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const r = xvfb ? await runGroup('xvfb-run', ['-a', electron, ...args], { cwd: ROOT, env: e, timeoutMs }) : await runGroup(electron, args, { cwd: ROOT, env: e, timeoutMs });
  if (!fs.existsSync(outFile)) {
    const why = r.error ? oneLine(r.error.message) : r.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s, killed` : `exit ${r.status}${r.signal ? ' ' + r.signal : ''}`;
    // one line each, scrubbed and cut: a stack's home path or user name never reaches a record that is shared
    const failed = r.out.split('\n').filter((l) => /DRIVER FAILED|\[perf-record\]/.test(l)).slice(-3).map((l) => oneLine(l, 160)).join(' | ');
    return { error: `no output (${why})${failed ? ': ' + failed : ''}` };
  }
  try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (err) { return { error: 'unreadable output: ' + oneLine(err.message) }; }
}

/**
 * The record, from what the launches wrote (pure: no Electron, no disk, no clock). `results[key]` is { seed, starts: [...], main } as `launch` returned them;
 * `env` is { recordedAt, appSha, loadStart, loadEnd, cores, platform, release, arch, cpuModel, memoryGB }. Returns { record, broke }: `broke` counts launches that
 * broke and cases whose output lacks a required metric (such a case is recorded as absent with its reason, never as numbers it does not have).
 */
function buildRecord(opts, results, env) {
  const record = {
    schema: SCHEMA,
    recordedAt: env.recordedAt,
    appSha: env.appSha || 'unknown',
    simulator: true,
    quick: !!opts.quick,
    machine: null,
    devicePixelRatio: null,
    gpu: null,
    setup: { window: '1440x900', runs: opts.runs, launchesPerCase: 1, medians: true, activity: 'simspeed=10, 20 s', note: 'rAF deltas; no assert on any number' },
    cases: {},
    limits: LIMITS,
  };
  let broke = 0;
  for (const mode of MODES) {
    for (const n of SIZES) {
      const key = `${mode}-${n}`;
      const res = results[key];
      if (!res || (opts.only && !opts.only.includes(key))) { record.cases[key] = { mode, n, available: false, reason: 'not asked for (--only)' }; continue; }
      const starts = Array.isArray(res.starts) ? res.starts : [];
      if (res.seed && res.seed.error) broke++;
      for (const s of starts) if (s && s.error) broke++;
      const main = res.main;
      if (!main || main.error) { broke++; record.cases[key] = { mode, n, available: false, reason: 'the driver broke: ' + oneLine((main && main.error) || 'no result'), driverBroke: true }; continue; }
      if (isObj(main.meta) && !record.gpu) {
        record.devicePixelRatio = main.meta.devicePixelRatio;
        record.gpu = main.meta.gpu;
        record.electron = main.meta.electron;
        record.chrome = main.meta.chrome;
      }
      if (main.available === false) { record.cases[key] = { mode, n, available: false, reason: typeof main.reason === 'string' && main.reason ? main.reason : 'no reason given' }; continue; }
      const goodStarts = starts.filter((s) => s && !s.error && s.start).map((s) => ({ start: s.start, memoryAtStart: s.memoryAtStart }));
      const rows = { ...(isObj(main.rows) ? main.rows : {}), ...(goodStarts.length ? medianOf(goodStarts) : {}) };
      const missing = REQUIRED_METRICS.filter(([g, f]) => !isObj(rows[g]) || !finite(rows[g][f])).map(([g, f]) => `${g}.${f}`);
      if (missing.length) { broke++; record.cases[key] = { mode, n, available: false, reason: `the driver's output lacks ${missing.join(', ')}`, driverBroke: true }; continue; }
      record.cases[key] = {
        mode, n, available: true, runs: opts.runs,
        rows,
        runsPerRow: isObj(main.raw) || Array.isArray(main.raw) ? runsOf(main.raw) : undefined,
        appStartRuns: goodStarts.length,
        startErrors: starts.filter((s) => s && s.error).map((s) => oneLine(s.error)),
        switches: main.switches || undefined,
        raw: main.raw,
        ab: main.ab || undefined,
      };
    }
  }
  const load = (a) => a.map((x) => Math.round(x * 100) / 100);
  record.machine = {
    platform: env.platform, release: env.release, arch: env.arch, cores: env.cores, cpuModel: typeof env.cpuModel === 'string' && env.cpuModel ? env.cpuModel : 'unknown',
    memoryGB: env.memoryGB, loadavg: load(env.loadEnd), loadavgAtStart: load(env.loadStart),
    ...loadFlag([Math.max(env.loadStart[0], env.loadEnd[0]), env.loadEnd[1], env.loadEnd[2]], env.cores, env.platform), electron: record.electron, chrome: record.chrome,
  };
  record.devicePixelRatio = record.devicePixelRatio || 1;
  record.gpu = record.gpu || { gpu_compositing: 'unknown (no launch produced output)' };
  return { record: scrubDeep(record), broke };
}

/** Write `record` as JSON to `file` (resolved against the cwd) through a temp file and a rename: a crash or a throw leaves an existing record whole. */
function writeRecord(file, record) {
  const target = path.resolve(file);
  const text = JSON.stringify(record, null, 1) + '\n';
  const tmp = `${target}.tmp-${process.pid}`;
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, target); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } throw e; }
  return target;
}

async function recordAll(opts) {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) { console.error('dist/ missing: run npm run build first'); return 2; }
  const electron = require('electron');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-perf-rec-'));
  try {
    const base = { PERF_SECONDS_SCALE: opts.quick ? 'quick' : 'full', PERF_RUNS: String(opts.runs), PERF_GPU: opts.gpu ? '1' : '' };
    const results = {};
    const loadStart = os.loadavg();
    for (const mode of MODES) {
      for (const n of SIZES) {
        const key = `${mode}-${n}`;
        if (opts.only && !opts.only.includes(key)) continue;
        const per = path.join(work, key);
        fs.mkdirSync(per);
        const userData = path.join(per, 'ud');
        fs.mkdirSync(userData);
        const env = { ...base, DURBAR_SIM: String(n), DURBAR_USER_DATA: userData, PERF_MODE: mode };
        fs.mkdirSync(path.join(per, 'ud-main'));
        console.log(`[perf-record] ${key}: seed`);
        const seed = await launch(electron, { ...env, [PHASE_ENV]: 'seed' }, path.join(per, 'seed.json'), 120000);
        const starts = [];
        if (!seed.error && seed.available !== false) {
          for (let i = 0; i < opts.runs; i++) {
            console.log(`[perf-record] ${key}: app start ${i + 1}/${opts.runs}`);
            const s = await launch(electron, { ...env, [PHASE_ENV]: 'start' }, path.join(per, `start-${i}.json`), 120000);
            starts.push(s.error ? { error: s.error } : s);
          }
        }
        console.log(`[perf-record] ${key}: steady (${opts.runs} run${opts.runs > 1 ? 's' : ''})`);
        const main = await launch(electron, { ...env, [PHASE_ENV]: 'main', DURBAR_USER_DATA: path.join(per, 'ud-main') }, path.join(per, 'main.json'), 3600000);
        results[key] = { seed, starts, main };
      }
    }
    const cores = os.cpus().length;
    const { record, broke } = buildRecord(opts, results, {
      recordedAt: new Date().toISOString(), appSha: appSha(), loadStart, loadEnd: os.loadavg(), cores, platform: process.platform, release: os.release(), arch: process.arch,
      cpuModel: (os.cpus()[0] || {}).model, memoryGB: Math.round(os.totalmem() / 1073741824 * 10) / 10,
    });
    if (opts.record) writeRecord(opts.record, record);
    const problems = validateRecord(record);
    for (const p of problems) console.log('[perf-record] record problem: ' + p);
    const ok = Object.values(record.cases).filter((c) => c.available).length;
    const absent = Object.entries(record.cases).filter(([, c]) => !c.available && !c.driverBroke).map(([k]) => k);
    console.log(`[perf-record] ${ok} case(s) recorded; absent (no mode in this build): ${absent.join(', ') || 'none'}; gpu_compositing=${record.gpu.gpu_compositing}; load ${record.machine.loadavg[0]} on ${cores} cores${record.machine.loaded ? ' (LOADED: flagged, not for ratios)' : ''}`);
    return broke || problems.length || !ok ? 1 : 0;
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* temp folder; the OS cleans it */ }
  }
}

const LIMITS = [
  'Frames are requestAnimationFrame deltas: they see main-thread work and a late frame, not compositor-only or GPU-process jank, raster time, scrolling done off the main thread, or tearing.',
  'With gpu_compositing disabled_software (Xvfb, a runner) the GPU process CPU is Skia drawing in software: blending, blur and raster are far worse than on a GPU. Only main-thread rows carry over.',
  'Device pixel ratio 1 hides Retina (4 times the pixels); a record names the ratio it ran at.',
  'CPU is /proc ticks on Linux (percent of one core); elsewhere Electron percentCPUUsage, whose scale differs by OS. Memory is PSS on Linux and working set elsewhere: compare within one OS only.',
  'Activity is the simulator at simspeed=10, not a real agent; the runs of a case share one launch; the mode-switch rows are taken first, in the fresh profile of that launch, and app start has a launch of its own per run.',
  'A machine under load (load average above its cores; unknown on Windows) is flagged and is not for ratios.',
];

module.exports = { SCHEMA, MODES, SIZES, LIMITS, PHASE_ENV, REQUIRED_METRICS, median, medianOf, runsOf, loadFlag, validateRecord, nonFinite, scrub, scrubDeep, oneLine, parseArgs, buildRecord, writeRecord, runGroup, recordAll };
