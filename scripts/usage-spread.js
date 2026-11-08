#!/usr/bin/env node
/*
 * Spec 008 FR-181 (delta 2026-11-08, owner Vikram): the part of the build cost that telemetry did not measure per day (the baseline's
 * lump, `docs/build-cost-baseline.json`) is shown SPREAD over the days it covers, not booked on one day. `npm run usage:spread`
 * reads the repo's own history (`git log` on `origin/main`: lines changed per day and merged PRs per day) and writes
 * `docs/build-cost-spread.json`; `npm run usage:readme` reads that file (no git) for the daily chart. The weighting:
 *     weight(day) = 0.5 * (day's lines / all lines) + 0.5 * (day's merged PRs / all merged PRs)
 * over the days from the baseline's `since` to its `through` day that have NO measured data for a baseline machine. Lines are added plus
 * deleted from `git log --numstat`, without lockfiles, pictures and other binaries, generated and build-cost files. Money is split in
 * whole cents (largest remainder), so the sum is exactly the lump minus what telemetry measured on those machines. Days with measured
 * data keep their real numbers. Per-model split of a spread day = the lump's model mix (an assumption). No network, no shell string.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('./usage-lib');

const ROOT = path.join(__dirname, '..');
const WEIGHTS = { lines: 0.5, prs: 0.5 };
const EXCLUDE = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/, /\.lock$/,
  /\.(png|jpe?g|gif|webp|avif|svg|ico|icns|bmp|tiff?|mp4|webm|mov|mkv|mp3|wav|ogg|flac|pdf|woff2?|ttf|otf|eot|zip|gz|tgz|7z|bin|wasm)$/i,
  /(^|\/)(dist|dist-scripts|out|build|coverage|node_modules)\//, /\.min\.(js|css)$/, /\.map$/,
  /^docs\/screenshots\//, /^docs\/build-cost/, // generated pictures and the build-cost files themselves (no circular weights)
];
const isCounted = (file) => !EXCLUDE.some((re) => re.test(file.replace(/\\/g, '/')));
const isPr = (subject) => /^Merge pull request #\d+/.test(subject) || /\(#\d+\)$/.test(subject);

/** `git log --numstat --format=@%ad` text -> Map day -> lines (added + deleted); binary files ("-") and excluded paths are skipped. */
function parseNumstat(text) {
  const out = new Map(); let day = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('@')) { day = line.slice(1).trim(); if (!out.has(day)) out.set(day, 0); continue; }
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m || day === null || m[1] === '-' || m[2] === '-' || !isCounted(m[3])) continue;
    out.set(day, out.get(day) + Number(m[1]) + Number(m[2]));
  }
  return out;
}
/** `git log --first-parent --format=%ad<TAB>%s` text -> Map day -> merged PRs. */
function parsePrs(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('\t'); if (i < 0) continue;
    if (isPr(line.slice(i + 1))) out.set(line.slice(0, i), (out.get(line.slice(0, i)) || 0) + 1);
  }
  return out;
}

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function daysBetween(from, to) { const o = []; for (let d = from; d <= to; d = addDays(d, 1)) o.push(d); return o; }

/** Measured cents per model on baseline machines' days up to `through`: those days are "measured", the rest of the lump is not. */
function measuredOfBaseline(states, baseline) {
  const byDay = new Map(); // day -> {model: cents}
  for (const st of states) {
    if (!Object.prototype.hasOwnProperty.call(baseline.machines, st.machine)) continue;
    for (const day of Object.keys(st.days)) {
      if (day < baseline.since || day > baseline.through) continue;
      const slot = byDay.get(day) || {};
      for (const [model, m] of Object.entries(st.days[day].models)) slot[model] = (slot[model] || 0) + Math.round(m.costUsd * 100);
      byDay.set(day, slot);
    }
  }
  return byDay;
}

/**
 * The spread. `stats` = Map day -> {lines, prs} (any days); `states` = usage states (measured data). Returns a plain object (the file).
 * Throws when nothing is left to spread over.
 */
function computeSpread(baseline, states, stats, ref = 'origin/main', commit = null) {
  const measured = measuredOfBaseline(states, baseline);
  const days = daysBetween(baseline.since, baseline.through).filter((d) => !measured.has(d));
  if (!days.length) throw new Error('spread: every day of the baseline is measured, nothing to spread');
  const remainder = {};
  for (const [model, usdv] of Object.entries(baseline.models)) {
    let c = Math.round(usdv * 100);
    for (const slot of measured.values()) c -= slot[model] || 0;
    remainder[model] = Math.max(0, c);
  }
  // measured money on a model the lump does not list (it was inside the lump's total): taken from the largest model, so the total is kept
  let extra = 0;
  for (const slot of measured.values()) for (const [model, c] of Object.entries(slot)) if (!Object.prototype.hasOwnProperty.call(baseline.models, model)) extra += c;
  const biggest = Object.keys(remainder).sort((a, b) => remainder[b] - remainder[a] || (a < b ? -1 : 1))[0];
  if (biggest !== undefined) remainder[biggest] = Math.max(0, remainder[biggest] - extra);
  const rows = days.map((date) => ({ date, lines: (stats.get(date) || {}).lines || 0, prs: (stats.get(date) || {}).prs || 0 }));
  const L = rows.reduce((a, r) => a + r.lines, 0); const P = rows.reduce((a, r) => a + r.prs, 0);
  const raw = rows.map((r) => {
    if (L > 0 && P > 0) return WEIGHTS.lines * (r.lines / L) + WEIGHTS.prs * (r.prs / P);
    if (L > 0) return r.lines / L; if (P > 0) return r.prs / P; return 1 / rows.length;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  rows.forEach((r, i) => { r.weight = raw[i] / sum; r.cents = {}; });
  for (const model of Object.keys(remainder).sort()) {
    const C = remainder[model];
    const parts = rows.map((r, i) => { const x = C * r.weight; return { i, floor: Math.floor(x + 1e-9), frac: x - Math.floor(x + 1e-9) }; });
    let left = C - parts.reduce((a, p) => a + p.floor, 0);
    if (left < 0) throw new Error('spread: rounding went below zero');
    for (const p of parts.slice().sort((a, b) => b.frac - a.frac || a.i - b.i)) { if (left > 0) { p.floor += 1; left -= 1; } }
    parts.forEach((p) => { rows[p.i].cents[model] = p.floor; });
  }
  return {
    version: 1,
    method: 'weight = 0.5 * share of lines changed + 0.5 * share of merged PRs, over the days without measured data; per-model split = the lump\'s model mix; whole cents, largest remainder',
    ref, commit, since: baseline.since, through: baseline.through,
    weights: WEIGHTS, totals: { lines: L, prs: P }, remainderCents: remainder,
    measuredDays: [...measured.keys()].sort(),
    days: rows.map((r) => ({ date: r.date, lines: r.lines, prs: r.prs, weight: Number(r.weight.toFixed(10)), cents: r.cents })),
  };
}

/** The file, checked field by field (it is committed, so a bad one fails clearly). */
function validateSpread(raw) {
  const bad = (m) => { throw new Error(`spread: ${m}`); };
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.days) || !raw.days.length || raw.days.length > 2000) bad('not a spread file');
  if (!lib.DATE_RE.test(raw.since) || !lib.DATE_RE.test(raw.through)) bad('bad dates');
  const days = raw.days.map((d) => {
    if (!d || !lib.DATE_RE.test(d.date) || !d.cents || typeof d.cents !== 'object') bad('bad day');
    for (const k of ['lines', 'prs', 'weight']) if (typeof d[k] !== 'number' || !Number.isFinite(d[k]) || d[k] < 0) bad('bad number');
    const cents = {};
    for (const [m, c] of Object.entries(d.cents)) { if (!lib.MODEL_RE.test(m) || !Number.isInteger(c) || c < 0) bad('bad cents'); cents[m] = c; }
    return { date: d.date, lines: d.lines, prs: d.prs, weight: d.weight, cents };
  });
  return { since: raw.since, through: raw.through, weights: raw.weights, totals: raw.totals, days };
}

/** Rows for the daily chart: per day `est` (spread) and `meas` (telemetry) dollars by model, from `since` to `date`. Throws when estimated + measured does not add up to the README total. */
function dailyRows(spread, states, baseline, date) {
  const rows = new Map(); const get = (d) => { if (!rows.has(d)) rows.set(d, { date: d, est: {}, meas: {} }); return rows.get(d); };
  const addTo = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  for (const d of spread.days) if (d.date <= date) for (const [m, c] of Object.entries(d.cents)) addTo(get(d.date).est, m, c);
  for (const st of states) {
    const inBase = Object.prototype.hasOwnProperty.call(baseline.machines, st.machine);
    for (const day of Object.keys(st.days)) {
      if (day > date || (inBase && day < baseline.since)) continue;
      for (const [m, v] of Object.entries(st.days[day].models)) addTo(get(day).meas, m, Math.round(v.costUsd * 100));
    }
  }
  const out = [...rows.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return out.map((r) => {
    const estCents = sum(r.est); const measCents = sum(r.meas);
    for (const k of ['est', 'meas']) for (const m of Object.keys(r[k])) r[k][m] /= 100;
    return { ...r, estCents, measCents };
  });
}

// ---- states: committed data files (docs/build-cost/data/usage-<machine>.json) merged with the receiver's folder ----
function mergeStates(lists) {
  const by = new Map();
  for (const list of lists) for (const st of list) {
    if (!by.has(st.machine)) { by.set(st.machine, lib.emptyState(st.machine)); }
    const into = by.get(st.machine);
    for (const day of Object.keys(st.days)) into.days[day] = st.days[day]; // later list wins a day
  }
  return [...by.values()];
}
function readCommitted(dir, readState) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /^usage-[A-Za-z0-9_-]+\.json$/.test(n)).sort().map((n) => readState(path.join(dir, n), { requireScope: true })); // a committed file must declare scope "agent-durbar"
}

function gitStats(ref, through, root = ROOT) {
  const env = Object.assign({}, process.env, { TZ: 'UTC' });
  const run = (args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 29 });
  const num = parseNumstat(run(['log', ref, '--no-merges', '--numstat', '--date=format-local:%Y-%m-%d', '--format=@%ad']));
  const prs = parsePrs(run(['log', ref, '--first-parent', '--date=format-local:%Y-%m-%d', '--format=%ad\t%s']));
  const stats = new Map();
  for (const d of new Set([...num.keys(), ...prs.keys()])) if (d <= through) stats.set(d, { lines: num.get(d) || 0, prs: prs.get(d) || 0 });
  return stats;
}

function main() {
  try {
    const argv = process.argv.slice(2); const o = { ref: 'origin/main', write: false };
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--write') o.write = true;
      else if (argv[i] === '--ref' && argv[i + 1]) o.ref = argv[++i];
      else throw new Error(`unknown argument ${argv[i]}`);
    }
    if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(o.ref) || o.ref.startsWith('-')) throw new Error('--ref must be a plain branch name');
    const day = require('./usage-day');
    const baseline = lib.validateBaseline(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'build-cost-baseline.json'), 'utf8')));
    const states = readCommitted(path.join(ROOT, 'docs', 'build-cost', 'data'), day.readState);
    const commit = execFileSync('git', ['rev-parse', '--verify', o.ref + '^{commit}'], { cwd: ROOT, encoding: 'utf8' }).trim(); // pinned: a later merge of an old-dated commit cannot change the weights
    const spread = computeSpread(baseline, states, gitStats(commit, baseline.through), o.ref, commit);
    const text = JSON.stringify(spread, null, 2) + '\n';
    if (o.write) { fs.writeFileSync(path.join(ROOT, 'docs', 'build-cost-spread.json'), text); console.log(`usage-spread: wrote docs/build-cost-spread.json (${spread.days.length} days)`); }
    else process.stdout.write(text);
  } catch (e) { console.error(`usage-spread: ${e.message}`); process.exit(1); }
}

module.exports = { EXCLUDE, isCounted, parseNumstat, parsePrs, daysBetween, measuredOfBaseline, computeSpread, validateSpread, dailyRows, mergeStates, readCommitted, gitStats, WEIGHTS };
if (require.main === module) main();
