#!/usr/bin/env node
/*
 * Spec 008 FR-170: every `src/renderer/*.js` parses (`node --check`). A conflict resolution once left `app.js` unparsable while the suites a merging
 * agent ran did not load it. Fast (no build, no Electron, no network). No shell: the file name is an argument, never a command string.
 *
 *   npm run test:rendersyntax
 *
 * The check proves itself on a temp copy: a stray quote in a copy of `app.js` must fail it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/** `node --check` on one file: undefined when it parses, else the first lines of node's complaint. */
function syntaxError(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? undefined : (r.stderr || r.stdout || `exit ${r.status}`).split('\n').slice(0, 4).join('\n');
}

function main() {
  const dir = path.join(ROOT, 'src', 'renderer');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  if (files.length < 20 || !files.includes('app.js')) throw new Error(`the scan found ${files.length} renderer files and ${files.includes('app.js') ? 'app.js' : 'no app.js'}`);
  const bad = files.map((f) => [f, syntaxError(path.join(dir, f))]).filter(([, e]) => e);
  if (bad.length) {
    for (const [f, e] of bad) console.error(`src/renderer/${f} does not parse:\n${e}`);
    process.exit(1);
  }
  // the check fails on a stray quote (a temp copy; the source is never touched)
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rendersyntax-'));
  try {
    const src = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    const copy = path.join(tmp, 'app.js');
    fs.writeFileSync(copy, `${src}\nconst stray = 'oops;\n`);
    if (!syntaxError(copy)) throw new Error('a stray quote in a copy of app.js was not caught');
    fs.writeFileSync(copy, src);
    if (syntaxError(copy)) throw new Error('an unchanged copy of app.js does not parse');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`test-renderer-syntax: ${files.length} renderer files parse; a stray quote is caught`);
}

if (require.main === module) main();
module.exports = { syntaxError };
