#!/usr/bin/env node
/*
 * Spec 008 FR-181: `npm run usage:readme -- --release vX.Y.Z [--date YYYY-MM-DD] [--files a.json,b.json] [--baseline docs/build-cost-baseline.json] [--readme README.md] [--check]`
 * rewrites the "Build cost so far" block of the README between its markers from the committed baseline plus the usage files'
 * days after the baseline's day, adds this release's row to docs/build-cost-history.json and regenerates docs/build-cost-badge.svg and docs/build-cost.svg. Pure text: no network, no spawn. `--check` prints the block and writes nothing. Run it in the doc-only fold PR
 * after each release (changelog.d/README.md).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./usage-lib');
const day = require('./usage-day');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv, env = process.env, nowMs = Date.now()) {
  const o = { release: null, history: path.join(ROOT, 'docs', 'build-cost-history.json'), badge: path.join(ROOT, 'docs', 'build-cost-badge.svg'), chart: path.join(ROOT, 'docs', 'build-cost.svg'), baseline: path.join(ROOT, 'docs', 'build-cost-baseline.json'), readme: path.join(ROOT, 'README.md'), check: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (['--release', '--baseline', '--readme', '--history', '--badge', '--chart'].includes(a)) {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else if (a === '--date' || a === '--files') { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); rest.push(a, argv[++i]); }
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.release) throw new Error('--release vX.Y.Z is required');
  return Object.assign(o, day.parseArgs(rest, env, nowMs), { release: o.release, baseline: o.baseline, readme: o.readme, check: o.check, history: o.history, badge: o.badge, chart: o.chart });
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

/** The new README text, history, badge and chart (nothing written). A missing usage folder is fine: the block then shows the baseline alone. */
function build(o) {
  const baseline = readBaseline(o.baseline);
  let states = [];
  if (o.files || fs.existsSync(o.dir)) { try { states = day.loadStates(o); } catch (e) { if (!/no usage files/.test(e.message)) throw e; } }
  const cum = lib.cumulative(states, o.date, baseline);
  const block = lib.readmeBlock(cum, o.date, o.release, baseline.note);
  const history = lib.upsertRow(readHistory(o.history), cum, o.date, o.release);
  return { block, text: lib.rewriteReadme(fs.readFileSync(o.readme, 'utf8'), block), history, badge: lib.badgeSvg(cum.total), chart: lib.chartSvg(history) };
}

function main() {
  try {
    const o = parseArgs(process.argv.slice(2));
    const r = build(o);
    if (o.check) process.stdout.write(r.block + '\n'); else {
      fs.writeFileSync(o.history, JSON.stringify(r.history, null, 2) + '\n'); fs.writeFileSync(o.badge, r.badge); fs.writeFileSync(o.chart, r.chart); fs.writeFileSync(o.readme, r.text);
      console.log('usage-readme: updated the README block, the history, the badge and the chart');
    }
  } catch (e) { console.error(`usage-readme: ${e.message}`); process.exit(1); }
}

module.exports = { parseArgs, build, readBaseline, readHistory };
if (require.main === module) main();
