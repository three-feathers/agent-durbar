/*
 * Spec 025 delta 2026-10-22 (`npm run test:specsindex`, part of `npm test`): the generated specs index. Block parsing and
 * writing, generation (groups, number order, hand-written text kept), the errors a broken block or group gives, and the import
 * (table -> blocks) round trip, in throwaway folders. The real repository is checked by `node scripts/specs-index.js --check`,
 * the suite's second step (warning only until the cut-over date, see the script).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const si = require('./specs-index.js');

// --- blocks ---
const blk = (body) => `# Feature Specification: X\n\n<!-- specs-index (note)\n${body}\n-->\n\n**Status**: Draft\n`;
assert.deepStrictEqual(si.parseBlock(blk('group: 046\ntitle: A *title*\nstatus: **built** `x`; delta 2026-10-22: y')), {
  meta: { group: '046', title: 'A *title*', status: '**built** `x`; delta 2026-10-22: y' },
  errors: [],
});
assert.deepStrictEqual(si.parseBlock('# no block\n'), { meta: null, errors: [] });
assert.ok(si.parseBlock(blk('group: 046\ntitle: T')).errors.some((e) => /"status:" is missing/.test(e)));
assert.ok(si.parseBlock(blk('group: 046\ntitle: a | b\nstatus: s')).errors.some((e) => /contains "\|"/.test(e)), 'a pipe would split the cell');
assert.deepStrictEqual(si.parseBlock(blk('group: 046\ntitle: a \\| b\nstatus: s')).errors, [], 'an escaped pipe is fine');
assert.ok(si.parseBlock(blk('group: 046\ntitle: T\nstatus: s\nowner: me')).errors.some((e) => /unknown key "owner"/.test(e)));
assert.ok(si.parseBlock(blk('group: 046\ntitle: T\nstatus: s\nstatus: t')).errors.some((e) => /given twice/.test(e)));
assert.ok(si.parseBlock(blk('group: 046\ntitle: T\nstatus: s\nnot a key line')).errors.some((e) => /bad line/.test(e)));
assert.deepStrictEqual(si.parseBlock(blk('group: 046\r\ntitle: T\r\nstatus: s').replace(/\n/g, '\r\n')).errors, [], 'CRLF read');

const meta = { group: 'g', title: 'T', status: 'S' };
const spec = '# Feature Specification: X\n\n**Feature Branch**: `x`\n';
const once = si.setBlock(spec, meta);
assert.strictEqual(once.split('\n')[0], '# Feature Specification: X', 'the title stays first');
assert.ok(once.endsWith('-->\n\n**Feature Branch**: `x`\n'), 'one blank line after the block');
assert.deepStrictEqual(si.parseBlock(once).meta, meta);
assert.strictEqual(si.setBlock(once, meta), once, 'writing the same block again changes nothing');
assert.deepStrictEqual(si.parseBlock(si.setBlock(once, { ...meta, status: 'S2' })).meta.status, 'S2', 'replaced in place');
assert.strictEqual(si.setBlock(once, { ...meta, status: 'S2' }).split('specs-index').length, 2, 'never two blocks');
const dollar = si.setBlock(once, { ...meta, status: 'a $& b $1 c $$ d' });
assert.strictEqual(si.parseBlock(dollar).meta.status, 'a $& b $1 c $$ d', 'replacement patterns in a status stay literal');
assert.ok(si.setBlock('# T\nText right under.\n\n<!-- other -->\n\n\nx\n', meta).endsWith('-->\n\nText right under.\n\n<!-- other -->\n\n\nx\n'), 'no blank under the title: one is added; the rest untouched');
assert.ok(si.setBlock('No title\n', meta).startsWith('<!-- specs-index'), 'no title: at the top');

assert.strictEqual(si.groupId('## Features 001-010: reverse-engineered'), '001-010');
assert.strictEqual(si.groupId('## Feature 019: milestone 8'), '019');
assert.strictEqual(si.groupId('## Index'), 'index');
assert.strictEqual(si.pastCutover(new Date(`${si.CUTOVER}T00:00:00Z`)), true);
assert.strictEqual(si.pastCutover(new Date('2026-10-22T12:00:00Z')), false);

// --- a throwaway repository ---
function repo(readme, specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-specs-'));
  fs.mkdirSync(path.join(dir, 'specs'));
  fs.writeFileSync(path.join(dir, 'specs', 'README.md'), readme);
  for (const [d, text] of Object.entries(specs)) {
    fs.mkdirSync(path.join(dir, 'specs', d));
    fs.writeFileSync(path.join(dir, 'specs', d, 'spec.md'), text);
  }
  fs.mkdirSync(path.join(dir, 'specs', '099-no-spec-file')); // a folder without spec.md is not a spec
  return dir;
}
const HAND = [
  '# Specs',
  '',
  'Intro kept as written.',
  '',
  '## Index',
  '',
  '| # | Feature | Status |',
  '| --- | --- | --- |',
  '| [001](001-one/spec.md) | One | built; `code` and **bold** |',
  '| [002](002-two/spec.md) | Two (issue #2) | draft |',
  '',
  'Text between tables.',
  '',
  '## Feature 010: later',
  '',
  '| # | Feature | Status |',
  '| --- | --- | --- |',
  '| [011](011-eleven/spec.md) | Eleven | built |',
  '| [010](010-ten/spec.md) | Ten | in progress |',
  '',
  '| Tag | Meaning |',
  '| --- | --- |',
  '| `x` | not a spec table |',
  '',
].join('\n');
const bare = (t) => `# Feature Specification: ${t}\n\n**Status**: x\n`;
{
  const d = repo(HAND, { '001-one': bare('One'), '002-two': bare('Two'), '010-ten': bare('Ten'), '011-eleven': bare('Eleven') });
  // before the import nothing is generated: every spec lacks its block
  assert.strictEqual(si.generate(d).errors.filter((e) => /no specs-index block/.test(e)).length, 4);

  const imp = si.importIndex(d);
  assert.deepStrictEqual(imp.errors, []);
  assert.strictEqual(imp.specs, 4);
  const readme = fs.readFileSync(path.join(d, 'specs', 'README.md'), 'utf8');
  assert.ok(readme.includes('## Index\n\n<!-- specs-index group=index -->\n| # | Feature | Status |'), 'marker above the first table');
  assert.ok(readme.includes('<!-- specs-index group=010 -->'), 'marker from the "Feature 010" heading');
  assert.strictEqual(readme.split('specs-index group=').length, 3, 'the Tag table is not a spec table');
  assert.deepStrictEqual(si.parseBlock(fs.readFileSync(path.join(d, 'specs', '001-one', 'spec.md'), 'utf8')).meta, { group: 'index', title: 'One', status: 'built; `code` and **bold**' });

  const gen = si.generate(d);
  assert.deepStrictEqual(gen.errors, []);
  const expected = readme.replace('| [011](011-eleven/spec.md) | Eleven | built |\n| [010](010-ten/spec.md) | Ten | in progress |', '| [010](010-ten/spec.md) | Ten | in progress |\n| [011](011-eleven/spec.md) | Eleven | built |');
  assert.strictEqual(gen.text, expected, 'generated = the imported table, rows in number order, every other line as written');
  fs.writeFileSync(path.join(d, 'specs', 'README.md'), gen.text);
  assert.strictEqual(si.generate(d).text, gen.text, 'idempotent');

  // a second import (after someone edited a row by hand) keeps the markers and moves the edit into the block
  fs.writeFileSync(path.join(d, 'specs', 'README.md'), gen.text.replace('| Two (issue #2) | draft |', '| Two (issue #2) | **built** 2026-10-22 |'));
  assert.deepStrictEqual(si.importIndex(d).errors, []);
  assert.strictEqual(fs.readFileSync(path.join(d, 'specs', 'README.md'), 'utf8').split('specs-index group=').length, 3, 'no second marker');
  assert.strictEqual(si.parseBlock(fs.readFileSync(path.join(d, 'specs', '002-two', 'spec.md'), 'utf8')).meta.status, '**built** 2026-10-22');
  assert.strictEqual(si.generate(d).text, fs.readFileSync(path.join(d, 'specs', 'README.md'), 'utf8'));

  // a spec edits only its own block; the index follows
  const p3 = path.join(d, 'specs', '010-ten', 'spec.md');
  fs.writeFileSync(p3, si.setBlock(fs.readFileSync(p3, 'utf8'), { group: '010', title: 'Ten', status: '**built**' }));
  assert.ok(si.generate(d).text.includes('| [010](010-ten/spec.md) | Ten | **built** |'));

  // a new spec in a group, a block error, a group without a marker
  fs.mkdirSync(path.join(d, 'specs', '012-twelve'));
  fs.writeFileSync(path.join(d, 'specs', '012-twelve', 'spec.md'), si.setBlock(bare('Twelve'), { group: '010', title: 'Twelve', status: 'specified' }));
  assert.ok(si.generate(d).text.includes('| [011](011-eleven/spec.md) | Eleven | built |\n| [012](012-twelve/spec.md) | Twelve | specified |\n'), 'a new spec lands in its group, last by number');
  fs.writeFileSync(path.join(d, 'specs', '012-twelve', 'spec.md'), si.setBlock(bare('Twelve'), { group: 'nowhere', title: 'Twelve', status: 's' }));
  assert.ok(si.generate(d).errors.some((e) => /group "nowhere" .* has no "<!-- specs-index group=nowhere -->" line/.test(e)));
  fs.writeFileSync(path.join(d, 'specs', '012-twelve', 'spec.md'), si.setBlock(bare('Twelve'), { group: '010', title: 'a | b', status: 's' }));
  assert.ok(si.generate(d).errors.some((e) => /012-twelve\/spec\.md: "title" contains/.test(e)));
}
{
  // import refuses what it cannot represent
  const d = repo(HAND.replace('| [002](002-two/spec.md) | Two (issue #2) | draft |', '| [002](002-two/spec.md) | Two | draft |\n| [002](002-two/spec.md) | Two again | x |'), { '001-one': bare('One'), '002-two': bare('Two'), '010-ten': bare('Ten'), '011-eleven': bare('Eleven') });
  assert.ok(si.importIndex(d, { write: false }).errors.some((e) => /002-two has two rows/.test(e)), 'duplicate rows (a union merge leftover) must be merged first');
}

console.log('test-specs-index: ok');
