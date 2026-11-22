#!/usr/bin/env node
/* spec 008 FR-193: CI has no separate typecheck step before build because `npm run build` runs the same tsc project. This keeps that true: `npm run test:citypecheck`. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const project = (cmd) => { const m = /(?:^|&&\s*)tsc\b[^&]*?\s-p\s+(\S+)/.exec(cmd); return m && m[1]; };

// the jobs of ci.yml that run `npm test` (spec 117 FR-018: the "Build and test (<os>) part i/2" jobs; the summary runs no suites), each from its job key to the next
const testJobs = (text) => {
  const body = text.slice(text.search(/^jobs:/m));
  const out = [];
  const re = /^ {2}([\w-]+):\n([\s\S]*?)(?=^ {2}[\w-]+:\n|(?![\s\S]))/gm;
  for (let m = re.exec(body); m; m = re.exec(body)) if (/^\s+run: npm test\s*$/m.test(m[2])) out.push([m[1], m[2]]);
  assert.ok(out.length >= 1, 'ci.yml has jobs that run npm test');
  return out;
};
function check(pkg, workflows) {
  const tc = project(pkg.scripts.typecheck);
  const bd = project(pkg.scripts.build);
  assert.ok(tc, 'package.json typecheck script runs tsc -p <project>');
  assert.strictEqual(bd, tc, `build uses tsc -p ${bd} but typecheck uses ${tc}: CI cannot drop the typecheck step`);
  for (const [file, whole] of Object.entries(workflows)) {
    for (const [job, text] of file === 'ci.yml' ? testJobs(whole) : [['', whole]]) {
      const where = job ? `${file} ${job}` : file;
      assert.ok(/run:\s*npm run build\s*$/m.test(text), `${where} still runs npm run build`);
      assert.ok(!/run:\s*npm run typecheck\s*$/m.test(text) || !/run:\s*npm run build\s*$/m.test(text),
        `${where} runs typecheck and build: build already runs the same tsc`);
    }
  }
}

// Windows checks files out with CRLF: normalise so the regexes and the mutants see one line ending (CI run 42536047148)
const read = (f) => fs.readFileSync(path.join(process.env.CITC_ROOT || ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const ci = read('.github/workflows/ci.yml');
const mac = read('.github/workflows/macos-pr.yml');
const rel = read('.github/workflows/release.yml'); /* FR-193 amended (T180): the release run's npm test needs dist/ too (v0.1.20 run 43685791437) */
check(pkg, { 'ci.yml': ci, 'macos-pr.yml': mac, 'release.yml': rel });

// mutants: each must fail with the intended assert text
const fails = (fn, re) => assert.throws(fn, (e) => re.test(e.message), 'mutant not caught: ' + re);
const other = { scripts: { ...pkg.scripts, build: pkg.scripts.build.replace('tsconfig.json', 'tsconfig.scripts.json') } };
fails(() => check(other, { 'ci.yml': ci }), /build uses tsc -p tsconfig\.scripts\.json but typecheck uses tsconfig\.json/);
fails(() => check(pkg, { 'ci.yml': ci.replace(/run: npm run build\s*$/gm, 'run: echo skipped') }), /ci\.yml test-ubuntu still runs npm run build/);
// spec 117 FR-018: every part job is checked, not only the first (review of #2031): a typecheck step in the Windows or macOS part fails
const inJob = (id, from, to) => { const i = ci.indexOf(`\n  ${id}:\n`); assert.ok(i >= 0, `ci.yml has ${id}`); const j = ci.indexOf(from, i); assert.ok(j > i, `${id} has ${from}`); return ci.slice(0, j) + to + ci.slice(j + from.length); };
fails(() => check(pkg, { 'ci.yml': inJob('test-windows', '        run: npm run build\n', '        run: npm run build\n      - run: npm run typecheck\n') }), /ci\.yml test-windows runs typecheck and build/);
fails(() => check(pkg, { 'ci.yml': inJob('test-macos', '        run: npm run build\n', '        run: echo no build\n') }), /ci\.yml test-macos still runs npm run build/);
assert.deepStrictEqual(testJobs(ci).map(([id]) => id), ['test-ubuntu', 'test-windows', 'test-macos'], 'the three part jobs are the ones checked');
fails(() => check(pkg, { 'ci.yml': ci.replace(/( *)- if: (.*)\n( *)run: npm run build/, '$1- run: npm run typecheck\n$1- if: $2\n$3run: npm run build') }), /ci\.yml test-ubuntu runs typecheck and build/);
fails(() => check(pkg, { 'release.yml': rel.replace(/run: npm run build\s*$/m, 'run: npm run typecheck') }), /release\.yml still runs npm run build/);
fails(() => check(pkg, { 'release.yml': rel.replace(/( *)- run: npm run build\s*$/m, '$1- run: npm run typecheck\n$1- run: npm run build') }), /release\.yml runs typecheck and build/);
console.log('ci typecheck: ok');
