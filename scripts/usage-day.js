#!/usr/bin/env node
/*
 * Spec 008 FR-181: `npm run usage:day [-- --date YYYY-MM-DD] [--files a.json,b.json]` prints the "Build cost" markdown table for a day
 * from the usage files the receiver wrote (one per machine). Without --files it reads every `usage-*.json` in `<home>/.durbar-usage`
 * (or DURBAR_USAGE_DIR). Collect the other machines' files into one folder (or name them with --files) and the report adds them up.
 * A usage file written by hand (same shape, its own machine label) adds a tool that sends no telemetry.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./usage-lib');
const { defaultDir } = require('./usage-receiver');

function parseArgs(argv, env = process.env, nowMs = Date.now()) {
  const o = { date: new Date(nowMs).toISOString().slice(0, 10), files: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date' || a === '--files') {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      const v = argv[++i];
      if (a === '--date') o.date = v; else o.files = v.split(',').map((s) => s.trim()).filter(Boolean);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!lib.DATE_RE.test(o.date) || Number.isNaN(Date.parse(o.date + 'T00:00:00Z')) || new Date(o.date + 'T00:00:00Z').toISOString().slice(0, 10) !== o.date) {
    throw new Error('--date must be a real day, YYYY-MM-DD (UTC)');
  }
  if (o.files && !o.files.length) throw new Error('--files names no file');
  o.dir = env.DURBAR_USAGE_DIR || defaultDir();
  return o;
}

function readState(file, opts = {}) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > lib.MAX_FILE_BYTES) throw new Error(`${path.basename(file)}: not a usage file`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`${path.basename(file)}: not JSON`); }
  return lib.validateState(raw, path.basename(file), opts);
}

/** Files to read: the --files list, else every `usage-*.json` of the folder. Two files for one machine label are refused (they would count twice). */
function loadStates(o) {
  const files = o.files || (fs.existsSync(o.dir) ? fs.readdirSync(o.dir).filter((n) => /^usage-[A-Za-z0-9_-]+\.json$/.test(n)).sort().map((n) => path.join(o.dir, n)) : []);
  if (!files.length) throw new Error('no usage files found (is the receiver running? see docs/build-cost.md)');
  const states = files.map(readState);
  const seen = new Set();
  for (const s of states) { if (seen.has(s.machine)) throw new Error(`two files for machine "${s.machine}"`); seen.add(s.machine); }
  return states;
}

function main() {
  try {
    const o = parseArgs(process.argv.slice(2));
    process.stdout.write(lib.report(loadStates(o), o.date));
  } catch (e) { console.error(`usage-day: ${e.message}`); process.exit(1); }
}

module.exports = { parseArgs, loadStates, readState };
if (require.main === module) main();
