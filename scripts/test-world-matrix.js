/* Spec 098 T040/T041: the pure parts of scripts/world-matrix.js and the safety shape of .github/workflows/world-matrix.yml.
   The page checks themselves (10.5 px, overlap, contrast, a missing root) run in Electron: `node scripts/world-matrix.js --selftest`. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const wm = require('./world-matrix.js');
const ROOT = path.join(__dirname, '..');

const reg = { worlds: { a: {}, b: {} }, moments: [{ id: 'm1', code: 'present', worlds: { a: 'built', b: 'designed' } }, { id: 'm2', code: 'planned', worlds: { a: 'missing', b: 'missing' } }] };
assert.strictEqual(wm.plan(reg).length, 4, 'every moment x every world');
assert.deepStrictEqual(wm.plan(reg, ['b']).map((c) => c.moment + c.world), ['m1b', 'm2b'], '--worlds narrows');
assert.throws(() => wm.plan(reg, ['zzz']), /unknown world/, 'an unknown world is an error, not an empty run');
assert.strictEqual(wm.verdict({ code: 'planned', state: 'missing' }, { found: false, problems: [] }).status, 'skipped');
assert.strictEqual(wm.verdict({ code: 'present', state: 'built' }, { found: true, problems: ['x'] }).status, 'fail');
assert.strictEqual(wm.verdict({ code: 'present', state: 'fallback-flat' }, { found: true, problems: ['x'] }).status, 'fail');
for (const s of ['designed', 'missing']) assert.strictEqual(wm.verdict({ code: 'present', state: s }, { found: true, problems: ['x'] }).status, 'reported', `${s} is reported, not failed (FR-056)`);
assert.strictEqual(wm.verdict({ code: 'present', state: 'designed' }, { found: false, problems: ['no root'] }).status, 'fail', 'a missing root never passes');
assert.strictEqual(wm.verdict({ code: 'present', state: 'built' }, { noScene: true }).status, 'fail', 'a present moment without a scene never passes');
assert.strictEqual(wm.verdict({ code: 'present', state: 'built' }, { found: true, problems: [] }).status, 'ok');
const m1 = wm.mergeRun(null, { size: '1280x800', forcedColors: false, cells: [1] });
const m2 = wm.mergeRun(wm.mergeRun(m1, { size: '1440x900', forcedColors: false, cells: [2] }), { size: '1280x800', forcedColors: false, cells: [3] });
assert.deepStrictEqual(m2.runs.map((r) => r.cells[0]).sort(), [2, 3], 'a run replaces its own key and keeps the others');

const src = fs.readFileSync(path.join(ROOT, 'scripts', 'world-matrix.js'), 'utf8');
assert.ok(!/docs[/\\]screenshots/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'the driver names no docs/screenshots path');
assert.ok(!/world-matrix|check-world-tools/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'shots-docs.js'), 'utf8')), 'not in shots-docs (FR-054)');
assert.ok(/^out\/$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')), 'out/ is git-ignored');

const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'world-matrix.yml'), 'utf8');
const code = y.replace(/^\s*#.*$/gm, '');
assert.ok(!/pull_request_target/.test(code), 'no pull_request_target');
assert.ok(!/secrets\./.test(code), 'no secret');
assert.ok(!/ANTHROPIC|OPENAI|COPILOT|CLAUDE/i.test(code), 'no AI credentials');
assert.ok(!/github\.event\.pull_request\.(title|body|head\.ref)|github\.head_ref/.test(code), 'no title or branch name');
for (const step of code.split(/\n\s+run: /).slice(1)) assert.ok(!/\$\{\{/.test(step.split('\n')[0]) , 'no expression on a run: line');
const runBlocks = [...code.matchAll(/run: \|?\n?([\s\S]*?)(?=\n\s+- |\n\s+[a-z-]+:|$)/g)].map((m) => m[1]);
assert.ok(runBlocks.every((b) => !/\$\{\{/.test(b)), 'no ${{ }} in any run script');
assert.ok(/timeout-minutes: 12/.test(code), 'the PR subset has timeout-minutes: 12');
const subset = code.slice(code.indexOf('  subset:'), code.indexOf('  weekly:'));
assert.ok(/permissions:\s*\n\s+contents: read\s*$/m.test(subset) && !/issues:/.test(subset), 'the PR job is contents: read only (FR-052, FR-063)');
assert.ok(/--size 1280x800/.test(subset) && !/1440x900/.test(subset), 'the PR subset runs at 1280x800 only');
for (const p of ['src/renderer/realoffice/**', 'docs/experience/**', 'scripts/world-matrix.js', 'scripts/check-world-tools.js', '.github/workflows/world-matrix.yml']) assert.ok(code.includes(`- '${p}'`), `path filter has ${p}`);
assert.ok(!/- 'src\/renderer\/(app|styles|screens)/.test(code), 'shared renderer files do not start the subset (D5)');
for (const m of code.matchAll(/uses: (\S+)/g)) assert.ok(/@[0-9a-f]{40}$/.test(m[1]), `pinned: ${m[1]}`);
assert.ok(/retention-days: 14/.test(code), 'artifacts kept 14 days');
console.log('world matrix: pure parts and workflow shape ok');
