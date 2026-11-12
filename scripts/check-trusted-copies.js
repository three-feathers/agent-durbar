// Spec 021 FR-092: scripts/trusted-authors.js is the one JavaScript/TypeScript reader of scripts/trusted-authors.txt (trusted-lib.sh is the
// one shell reader). This finds a second one: a code file (scripts/, src/, .github/ workflows and scripts; not tests, not the loader) that
// (A) holds the login-line pattern, (B) reads trusted-authors.txt with a file read, or (C) hard-codes trusted logins (a human login and a
// "[bot]" account in one statement). Plain Node, no shell. `node scripts/check-trusted-copies.js [--root D]` exits 1 and lists them.
'use strict';
const fs = require('fs');
const path = require('path');

const LOADER = 'scripts/trusted-authors.js';
const CODE = /\.(ts|mts|cts|js|mjs|cjs|yml|yaml)$/;
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'dist-scripts']);
const HUMANS = ['vikramgorla', 'fjcabello', 'rubenlupi'];

function walk(root, rel, out) {
  let ents;
  try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(root, r, out); } else if (e.isFile() && CODE.test(e.name)) out.push(r);
  }
}

/** Problems in one file's text: strings naming the copy found. Comment lines are not code. */
function copyProblems(text) {
  const out = [];
  const lines = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l));
  const code = lines.join('\n');
  if (/A-Za-z0-9-\]\+\(\\+\[bot\\+\]\)\?/.test(code)) out.push('holds the trusted-login pattern (a second parser)');
  if (lines.some((l) => /trusted-authors\.txt/.test(l) && /readFile|createReadStream|openSync/.test(l))) out.push('reads trusted-authors.txt itself');
  if (lines.some((l) => /['"`]\S*\[bot\]['"`]/.test(l) && HUMANS.some((h) => new RegExp(`['"\`]${h}['"\`]`).test(l)))) out.push('hard-codes trusted logins');
  return out;
}

/** Every `<file>: <problem>` under `root`, tests (`scripts/test-*`, `scripts/shots-*`) and the loader aside. */
function strayCopies(root) {
  const files = [];
  for (const d of ['scripts', 'src', '.github']) walk(root, d, files);
  const found = [];
  for (const f of files) {
    if (f === LOADER || f === 'scripts/check-trusted-copies.js' || /^scripts\/(test-|shots-)/.test(f)) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    for (const p of copyProblems(text)) found.push(`${f}: ${p}`);
  }
  return found;
}

if (require.main === module) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 ? path.resolve(process.argv[i + 1]) : path.join(__dirname, '..');
  const found = strayCopies(root);
  if (found.length) { console.error(`check-trusted-copies: use scripts/trusted-authors.js instead (spec 021 FR-092):\n  ${found.join('\n  ')}`); process.exit(1); }
  console.log('check-trusted-copies: ok, no second copy of the trusted-author list or its parser');
}
module.exports = { copyProblems, strayCopies };
