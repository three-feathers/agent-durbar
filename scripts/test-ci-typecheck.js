#!/usr/bin/env node
/* spec 008 FR-193: CI has no separate typecheck step before build because `npm run build` runs the same tsc project. This keeps that true: `npm run test:citypecheck`. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const project = (cmd) => { const m = /(?:^|&&\s*)tsc\b[^&]*?\s-p\s+(\S+)/.exec(cmd); return m && m[1]; };

// the "Build and test" job of ci.yml: from its `name:` line to the next job key
const buildJob = (text) => { const i = text.indexOf('name: Build and test'); assert.ok(i >= 0, 'ci.yml has the Build and test job'); const rest = text.slice(i); const j = rest.search(/\n  [\w-]+:\n/); return j < 0 ? rest : rest.slice(0, j); };
function check(pkg, workflows) {
  const tc = project(pkg.scripts.typecheck);
  const bd = project(pkg.scripts.build);
  assert.ok(tc, 'package.json typecheck script runs tsc -p <project>');
  assert.strictEqual(bd, tc, `build uses tsc -p ${bd} but typecheck uses ${tc}: CI cannot drop the typecheck step`);
  for (const [file, whole] of Object.entries(workflows)) {
    const text = file === 'ci.yml' ? buildJob(whole) : whole;
    assert.ok(/run:\s*npm run build\s*$/m.test(text), `${file} still runs npm run build`);
    assert.ok(!/run:\s*npm run typecheck\s*$/m.test(text) || !/run:\s*npm run build\s*$/m.test(text),
      `${file} runs typecheck and build: build already runs the same tsc`);
  }
}

// Windows checks files out with CRLF: normalise so the regexes and the mutants see one line ending (CI run 42536047148)
const read = (f) => fs.readFileSync(path.join(process.env.CITC_ROOT || ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const ci = read('.github/workflows/ci.yml');
const mac = read('.github/workflows/macos-pr.yml');
check(pkg, { 'ci.yml': ci, 'macos-pr.yml': mac });

// mutants: each must fail with the intended assert text
const fails = (fn, re) => assert.throws(fn, (e) => re.test(e.message), 'mutant not caught: ' + re);
const other = { scripts: { ...pkg.scripts, build: pkg.scripts.build.replace('tsconfig.json', 'tsconfig.scripts.json') } };
fails(() => check(other, { 'ci.yml': ci }), /build uses tsc -p tsconfig\.scripts\.json but typecheck uses tsconfig\.json/);
fails(() => check(pkg, { 'ci.yml': ci.replace(/run: npm run build\s*$/gm, 'run: echo skipped') }), /ci\.yml still runs npm run build/);
fails(() => check(pkg, { 'ci.yml': ci.replace(/( *)- if: (.*)\n( *)run: npm run build/, '$1- run: npm run typecheck\n$1- if: $2\n$3run: npm run build') }), /ci\.yml runs typecheck and build/);
console.log('ci typecheck: ok');
