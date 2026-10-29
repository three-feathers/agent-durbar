/*
 * `npm run test:docsscripts` (spec 021 FR-063, T046): every `npm run <name>` in the live docs names a script that exists in package.json.
 * Files: README.md, CONTRIBUTING.md, AGENTS.md, docs/**\/*.md and specs/*\/quickstart.md. Placeholders (`npm run <name>`, `npm run $X`)
 * and `npm run x -- --args` are handled (only the name counts). docs/feature-history.md is read too: it is prose about the present
 * commands, not a dated log, so a dead name there misleads. Older specs, plans and tasks keep removed names as history and are not read.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Script names after `npm run` (and `npm run -s`) in a text; names that start with a letter or digit only, so `<name>` and `$X` are skipped, as is a prefix such as `test:<name>`. */
function runNames(text) {
  const out = [];
  const re = /\bnpm run (?:-s |--silent )?([A-Za-z0-9][\w:.-]*)(?![\w:.<*$-])/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/** The names in `text` that are not in `scripts`. */
function missing(text, scripts) {
  return [...new Set(runNames(text))].filter((n) => !Object.prototype.hasOwnProperty.call(scripts, n));
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function docFiles() {
  const files = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  files.push(...walk(path.join(ROOT, 'docs')));
  const specs = path.join(ROOT, 'specs');
  for (const d of fs.readdirSync(specs)) {
    const q = path.join(specs, d, 'quickstart.md');
    if (fs.existsSync(q)) files.push(q);
  }
  return files;
}

// the extractor
assert.deepStrictEqual(runNames('`npm run check:ui -- --only x`, npm run <name>, npm run $X, npm run -s test:a, npm run test:<x>'), ['check:ui', 'test:a']);
assert.deepStrictEqual(missing('npm run a and npm run b\nnpm run a', { a: '' }), ['b']);

const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
const bad = [];
for (const f of docFiles()) {
  const gone = missing(fs.readFileSync(f, 'utf8'), scripts);
  if (gone.length) bad.push(`${path.relative(ROOT, f)}: ${gone.map((n) => 'npm run ' + n).join(', ')}`);
}
assert.strictEqual(bad.length, 0, 'docs name npm scripts that package.json does not have:\n  ' + bad.join('\n  '));
console.log('docs-scripts: every `npm run <name>` in the live docs exists in package.json');
