#!/usr/bin/env node
/*
 * Spec 008 FR-181: `npm run usage:readme -- --release vX.Y.Z [--date YYYY-MM-DD] [--files a.json,b.json] [--baseline docs/build-cost-baseline.json] [--readme README.md] [--check] [--publish]`
 * rewrites the "Build cost so far" block of the README between its markers from the committed baseline plus the usage files'
 * days after the baseline's day, adds this release's row to docs/build-cost-history.json and regenerates docs/build-cost-badge.svg and docs/build-cost.svg. Pure text: no network, no spawn. `--check` prints the block and writes nothing. Run it in the doc-only fold PR
 * after each release (changelog.d/README.md).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./usage-lib');
const day = require('./usage-day');
const spreadLib = require('./usage-spread');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv, env = process.env, nowMs = Date.now()) {
  const o = { release: null, history: path.join(ROOT, 'docs', 'build-cost-history.json'), badge: path.join(ROOT, 'docs', 'build-cost-badge.svg'), chart: path.join(ROOT, 'docs', 'build-cost.svg'), days: path.join(ROOT, 'docs', 'build-cost-days.svg'), data: path.join(ROOT, 'docs', 'build-cost', 'data'), spread: path.join(ROOT, 'docs', 'build-cost-spread.json'), publish: false, baseline: path.join(ROOT, 'docs', 'build-cost-baseline.json'), readme: path.join(ROOT, 'README.md'), doc: path.join(ROOT, 'docs', 'build-cost.md'), check: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--publish') o.publish = true;
    else if (['--release', '--baseline', '--readme', '--doc', '--history', '--badge', '--chart', '--days', '--data', '--spread'].includes(a)) {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else if (a === '--date' || a === '--files') { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); rest.push(a, argv[++i]); }
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.release) throw new Error('--release vX.Y.Z is required');
  return Object.assign(o, day.parseArgs(rest, env, nowMs), { release: o.release, baseline: o.baseline, readme: o.readme, doc: o.doc, check: o.check, history: o.history, badge: o.badge, chart: o.chart, days: o.days, data: o.data, spread: o.spread, publish: o.publish });
}

function readBaseline(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > 100000) throw new Error('baseline: not a baseline file');
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('baseline: not JSON'); }
  return lib.validateBaseline(raw);
}

function readHistory(file) {
  if (!fs.existsSync(file)) return { version: 1, rows: [] };
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > 1000000) throw new Error('history: not a history file');
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('history: not JSON'); }
  return lib.validateHistory(raw);
}

function readSpread(file) {
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > 1000000) throw new Error('spread: not a spread file');
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('spread: not JSON'); }
  return spreadLib.validateSpread(raw);
}

/** Every machine's committed file (docs/build-cost/data/usage-<machine>.json) merged with the receiver folder or --files (a later day of the same machine wins). */
function loadAll(o) {
  let local = [];
  if (o.files || fs.existsSync(o.dir)) { try { local = day.loadStates(o); } catch (e) { if (!/no usage files/.test(e.message)) throw e; } }
  return spreadLib.mergeStates([spreadLib.readCommitted(o.data, day.readState), local]);
}

/** `--publish`: copy the receiver folder's (or --files) machine files into docs/build-cost/data, merged with what is committed. Only the validated fields are written. */
function publish(o) {
  let local = [];
  try { local = day.loadStates(o); } catch (e) { if (!/no usage files/.test(e.message)) throw e; }
  if (!local.length) throw new Error('--publish: no usage files to publish');
  fs.mkdirSync(o.data, { recursive: true });
  for (const st of spreadLib.mergeStates([spreadLib.readCommitted(o.data, day.readState), local])) {
    if (!local.some((l) => l.machine === st.machine)) continue;
    fs.writeFileSync(path.join(o.data, `usage-${st.machine}.json`), JSON.stringify(st, null, 2) + '\n');
  }
}

/** The new README text, history, badge and chart (nothing written). A missing usage folder is fine: the block then shows the baseline alone. */
function build(o) {
  const baseline = readBaseline(o.baseline);
  const states = loadAll(o);
  const cum = lib.cumulative(states, o.date, baseline);
  const spread = readSpread(o.spread);
  let rows = null; let note; let estUsd = 0;
  if (spread) {
    rows = spreadLib.dailyRows(spread, states, baseline, o.date);
    const shown = rows.reduce((a, r) => a + r.measCents + r.estCents, 0);
    if (shown !== cum.totalCents) throw new Error(`the daily chart adds up to US$${(shown / 100).toFixed(2)} but the total is US$${cum.total.toFixed(2)}: run "npm run usage:spread -- --write" again`);
    const est = rows.reduce((a, r) => a + r.estCents, 0) / 100; estUsd = est; const n = rows.filter((r) => r.estCents > 0).length;
    if (n) note = lib.DAY_SPREAD_LINE(est, n, rows.find((r) => r.estCents > 0).date, [...rows].reverse().find((r) => r.estCents > 0).date);
  }
  const block = lib.readmeBlock(cum, o.date, o.release, !!rows, estUsd);
  const detail = lib.detailBlock(cum, o.date, o.release, baseline.note, note);
  const history = lib.upsertRow(readHistory(o.history), cum, o.date, o.release);
  return { block, detail, text: lib.rewriteBadgeAlt(lib.rewriteReadme(fs.readFileSync(o.readme, 'utf8'), block), cum.total), docText: lib.rewriteDetail(fs.readFileSync(o.doc, 'utf8'), detail), history, badge: lib.badgeSvg(cum.total), chart: lib.chartSvg(history), days: rows ? lib.chartDaysSvg(rows) : null };
}

function main() {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.publish && !o.check) publish(o);
    const r = build(o);
    if (o.check) process.stdout.write(r.block + '\n'); else {
      fs.writeFileSync(o.history, JSON.stringify(r.history, null, 2) + '\n'); fs.writeFileSync(o.badge, r.badge); fs.writeFileSync(o.chart, r.chart); if (r.days) fs.writeFileSync(o.days, r.days); fs.writeFileSync(o.readme, r.text); fs.writeFileSync(o.doc, r.docText);
      console.log('usage-readme: updated the README block and badge text, the docs/build-cost.md numbers, the history, the badge and the chart');
    }
  } catch (e) { console.error(`usage-readme: ${e.message}`); process.exit(1); }
}

module.exports = { parseArgs, build, loadAll, publish, readSpread, readBaseline, readHistory };
if (require.main === module) main();
