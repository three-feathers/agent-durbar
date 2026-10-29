/*
 * Spec 025 delta 2026-10-22 (`npm run test:specsindex`, part of `npm test`): the generated specs index, whose rows are not committed.
 * Block parsing and writing (pipes, comment ends, "$&"), generation (groups, number order, hand-written text kept, markers left out),
 * the check (committed rows, missing blocks, groups, marker-based strictness with no clock, the CLI exit codes), --add for a new
 * spec made from the Spec Kit template, and the import (table -> blocks, rows removed), in throwaway folders. The real repository is
 * checked by `node scripts/specs-index.js --check`, the suite's second step.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const si = require('./specs-index.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(__dirname, 'specs-index.js');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

// --- blocks ---
const blk = (body) => `# Feature Specification: X\n\n<!-- specs-index (note)\n${body}\n-->\n\n**Status**: Draft\n`;
assert.deepStrictEqual(si.parseBlock(blk('group: 046\ntitle: A *title*\nstatus: built\nnote: open: `x`; delta 2026-10-22: y')), {
  meta: { group: '046', title: 'A *title*', status: 'built', note: 'open: `x`; delta 2026-10-22: y' },
  errors: [],
});
assert.deepStrictEqual(si.parseBlock('# no block\n'), { meta: null, errors: [] });
assert.ok(si.parseBlock(blk('group: 046\ntitle: T')).errors.some((e) => /"status:" is missing/.test(e)));
assert.ok(si.parseBlock(blk('group: 046\ntitle: a | b\nstatus: draft')).errors.some((e) => /contains "\|"/.test(e)), 'a pipe would split the cell');
assert.deepStrictEqual(si.parseBlock(blk('group: 046\ntitle: a \\| b\nstatus: draft')).errors, [], 'an escaped pipe is fine');
assert.ok(si.parseBlock(blk('group: 046\ntitle: T\nstatus: draft\nowner: me')).errors.some((e) => /unknown key "owner"/.test(e)));
assert.ok(si.parseBlock(blk('group: 046\ntitle: T\nstatus: draft\nstatus: built')).errors.some((e) => /given twice/.test(e)));
assert.ok(si.parseBlock(blk('group: 046\ntitle: T\nstatus: draft\nnot a key line')).errors.some((e) => /bad line/.test(e)));
assert.deepStrictEqual(si.parseBlock(blk('group: 046\r\ntitle: T\r\nstatus: draft').replace(/\n/g, '\r\n')).errors, [], 'CRLF read');
// a comment end inside a value is refused, not silently cut (review on #518)
for (const v of ['a --> b', 'a --!> b']) {
  const r = si.parseBlock(blk(`group: 046\ntitle: T\nstatus: draft\nnote: ${v}`));
  assert.strictEqual(r.meta.note, v, `"${v}" is read whole (the block ends only at a line that is "-->")`);
  assert.ok(r.errors.some((e) => /would end the comment block/.test(e)), `"${v}" is an error`);
  assert.throws(() => si.setBlock('# T\n', { group: 'g', title: 'T', status: 'draft', note: v }), /end the comment block/, `"${v}" is never written`);
}

// spec 021 FR-063: the status is one word from a fixed list, the note is short (planted bad values are refused)
for (const w of si.STATUSES) assert.deepStrictEqual(si.parseBlock(blk(`group: g\ntitle: T\nstatus: ${w}`)).errors, [], `"${w}" is allowed`);
assert.deepStrictEqual([...si.STATUSES], ['draft', 'specified', 'building', 'built', 'released', 'superseded']);
for (const bad of ['done', 'implemented', '**built**', 'Built', 'built; delta 2026-10-22: y', 'in progress']) {
  const r = si.parseBlock(blk(`group: g\ntitle: T\nstatus: ${bad}`));
  assert.ok(r.errors.some((e) => /"status" must be one of/.test(e)), `status "${bad}" is refused`);
  assert.throws(() => si.setBlock('# T\n', { group: 'g', title: 'T', status: bad }), /must be one of/, `"${bad}" is never written`);
}
assert.deepStrictEqual(si.parseBlock(blk(`group: g\ntitle: T\nstatus: built\nnote: ${'x'.repeat(si.NOTE_MAX)}`)).errors, [], 'a note of exactly the limit is fine');
assert.ok(si.parseBlock(blk(`group: g\ntitle: T\nstatus: built\nnote: ${'x'.repeat(si.NOTE_MAX + 1)}`)).errors.some((e) => /"note" is 161 characters/.test(e)), 'a note over the limit is refused');
assert.ok(si.parseBlock(blk('group: g\ntitle: T\nstatus: built\nnote: a | b')).errors.some((e) => /"note" contains "\|"/.test(e)), 'a pipe in a note would split the cell');

assert.deepStrictEqual(si.parseBlock('# X\n\n<!-- specs-index (n)\ngroup: g\ntitle: T\nstatus: built\n--!>\n').meta, { group: 'g', title: 'T', status: 'built' }, 'a block closed by "--!>" (also an HTML comment end) is read');
const meta = { group: 'g', title: 'T', status: 'built' };
const spec = '# Feature Specification: X\n\n**Feature Branch**: `x`\n';
const once = si.setBlock(spec, meta);
assert.strictEqual(once.split('\n')[0], '# Feature Specification: X', 'the title stays first');
assert.ok(once.endsWith('-->\n\n**Feature Branch**: `x`\n'), 'one blank line after the block');
assert.deepStrictEqual(si.parseBlock(once).meta, meta);
assert.strictEqual(si.setBlock(once, meta), once, 'writing the same block again changes nothing');
assert.deepStrictEqual(si.parseBlock(si.setBlock(once, { ...meta, status: 'draft' })).meta.status, 'draft', 'replaced in place');
assert.strictEqual(si.setBlock(once, { ...meta, status: 'draft' }).split('specs-index').length, 2, 'never two blocks');
const dollar = si.setBlock(once, { ...meta, note: 'a $& b $1 c $$ d' });
assert.strictEqual(si.parseBlock(dollar).meta.note, 'a $& b $1 c $$ d', 'replacement patterns in a note stay literal');
assert.ok(si.setBlock('# T\nText right under.\n\n<!-- other -->\n\n\nx\n', meta).endsWith('-->\n\nText right under.\n\n<!-- other -->\n\n\nx\n'), 'no blank under the title: one is added; the rest untouched');
assert.ok(si.setBlock('No title\n', meta).startsWith('<!-- specs-index'), 'no title: at the top');

assert.strictEqual(si.groupId('## Features 001-010: reverse-engineered'), '001-010');
assert.strictEqual(si.groupId('## Feature 019: milestone 8'), '019');
assert.strictEqual(si.groupId('## Index'), 'index');

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
const rd = (d, f) => fs.readFileSync(path.join(d, 'specs', f), 'utf8');
const HAND = [
  '# Specs',
  '',
  'Intro kept as written.',
  '',
  '## Index',
  '',
  '| # | Feature | Status |',
  '| --- | --- | --- |',
  '| [001](001-one/spec.md) | One | built |',
  '| [002](002-two/spec.md) | Two (issue #2) | draft |',
  '',
  'Text between tables.',
  '',
  '## Feature 010: later',
  '',
  '| # | Feature | Status |',
  '| --- | --- | --- |',
  '| [011](011-eleven/spec.md) | Eleven | built |',
  '| [010](010-ten/spec.md) | Ten | building |',
  '',
  '| Tag | Meaning |',
  '| --- | --- |',
  '| `x` | not a spec table |',
  '',
].join('\n');
const bare = (t) => `# Feature Specification: ${t}\n\n**Status**: x\n`;
const SPECS = { '001-one': bare('One'), '002-two': bare('Two'), '010-ten': bare('Ten'), '011-eleven': bare('Eleven') };
{
  const d = repo(HAND, SPECS);
  // before the import: every spec lacks its block
  const c = si.check(d);
  assert.strictEqual(c.problems.filter((e) => /no specs-index block/.test(e)).length, 4);
  assert.strictEqual(c.strict, false, 'no strict marker: warnings only');

  const imp = si.importIndex(d);
  assert.deepStrictEqual(imp.errors, []);
  assert.strictEqual(imp.specs, 4);
  const readme = rd(d, 'README.md');
  assert.strictEqual(
    readme,
    '# Specs\n\nIntro kept as written.\n\n## Index\n\n<!-- specs-index group=index -->\n\nText between tables.\n\n## Feature 010: later\n\n<!-- specs-index group=010 -->\n\n| Tag | Meaning |\n| --- | --- |\n| `x` | not a spec table |\n',
    'the rows leave specs/README.md; markers mark the tables; the Tag table stays'
  );
  assert.deepStrictEqual(si.parseBlock(rd(d, '001-one/spec.md')).meta, { group: 'index', title: 'One', status: 'built' });
  assert.deepStrictEqual(si.check(d, { strict: true }).problems, [], 'clean after the import');

  const gen = si.generate(d);
  assert.deepStrictEqual(gen.errors, []);
  assert.strictEqual(gen.committedRows, 0);
  assert.strictEqual(
    gen.text,
    HAND.replace('| [011](011-eleven/spec.md) | Eleven | built |\n| [010](010-ten/spec.md) | Ten | building |', '| [010](010-ten/spec.md) | Ten | building |\n| [011](011-eleven/spec.md) | Eleven | built |'),
    'generated = the old hand table, rows in number order, every other line as written, no markers'
  );
  assert.deepStrictEqual(si.importIndex(d), { readme, specs: 0, errors: [] }, 'a second import finds nothing to move');
  assert.strictEqual(rd(d, 'README.md'), readme, 'and changes nothing');

  // two PRs that change neighbouring specs touch two different files: nothing shared to conflict in
  const before = rd(d, 'README.md');
  for (const [dir, [st, note]] of [['010-ten', ['built', '']], ['011-eleven', ['built', 'too']]]) {
    const p = path.join(d, 'specs', dir, 'spec.md');
    const t = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, si.setBlock(t, { ...si.parseBlock(t).meta, status: st, note }));
  }
  assert.strictEqual(rd(d, 'README.md'), before, 'specs/README.md untouched by a status change');
  assert.ok(si.generate(d).text.includes('| [010](010-ten/spec.md) | Ten | built |\n| [011](011-eleven/spec.md) | Eleven | built: too |'));

  // a row committed by hand (an old-style PR) is reported and ignored
  fs.writeFileSync(path.join(d, 'specs', 'README.md'), before.replace('<!-- specs-index group=010 -->\n', '<!-- specs-index group=010 -->\n| # | Feature | Status |\n| --- | --- | --- |\n| [010](010-ten/spec.md) | Ten | hand |\n'));
  assert.ok(si.check(d).problems.some((e) => /3 table line\(s\) under its specs-index markers/.test(e)), 'committed rows reported');
  assert.ok(!si.generate(d).text.includes('| hand |'), 'the generated index ignores them');
  // the CLI: warns (exit 0) without the marker, fails (exit 1) with the marker or --strict; no clock involved
  let r = cli('--check', '--root', d);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /warning: .*table line/);
  r = cli('--check', '--strict', '--root', d);
  assert.strictEqual(r.status, 1, 'committed rows + --strict: exit 1');
  fs.writeFileSync(path.join(d, 'specs', 'README.md'), `${rd(d, 'README.md')}\n<!-- specs-index: strict -->\n`);
  assert.strictEqual(si.check(d).strict, true, 'the marker line makes it strict');
  r = cli('--check', '--root', d);
  assert.strictEqual(r.status, 1, 'committed rows + marker: exit 1');
  assert.ok(!si.generate(d).text.includes('specs-index: strict'), 'the marker is not part of the index');
  fs.writeFileSync(path.join(d, 'specs', 'README.md'), `${before}\n<!-- specs-index: strict -->\n`);
  r = cli('--check', '--root', d);
  assert.strictEqual(r.status, 0, `current + marker: exit 0 (${r.stdout}${r.stderr})`);
  assert.match(r.stdout, /specs:check ok/);

  // spec 021 FR-063: --check (specs:check) refuses a free-text status and an over-long note, and exits 1 under the strict marker
  const p10 = path.join(d, 'specs', '010-ten', 'spec.md');
  const good10 = fs.readFileSync(p10, 'utf8');
  fs.writeFileSync(p10, good10.replace('status: built', 'status: built; delta 2026-10-22: free text'));
  assert.ok(si.check(d).problems.some((e) => /010-ten\/spec\.md: "status" must be one of/.test(e)), 'a free-text status is a problem');
  fs.writeFileSync(p10, good10.replace('status: built', `status: built\nnote: ${'n'.repeat(161)}`));
  assert.ok(si.check(d).problems.some((e) => /010-ten\/spec\.md: "note" is 161 characters/.test(e)), 'an over-long note is a problem');
  fs.writeFileSync(p10, good10);
  // spec 021 FR-063: a retired number (an old release folder) cannot come back, in --check or --add
  assert.strictEqual(si.RETIRED.length, 18);
  fs.mkdirSync(path.join(d, 'specs', '023-something'));
  fs.writeFileSync(path.join(d, 'specs', '023-something', 'spec.md'), bare('Reused'));
  assert.ok(si.check(d).problems.some((e) => /023-something: number 023 is retired/.test(e)), 'a folder named 023-something fails the check');
  assert.strictEqual(cli('--check', '--strict', '--root', d).status, 1, 'and the CLI exits 1');
  assert.throws(() => si.addBlock(d, 'specs/023-something'), /number 023 is retired/, '--add refuses it too');
  fs.rmSync(path.join(d, 'specs', '023-something'), { recursive: true });
  // a group marked twice, a group without a marker, a bad block
  fs.writeFileSync(path.join(d, 'specs', 'README.md'), `${before}\n<!-- specs-index group=010 -->\n`);
  assert.ok(si.check(d).problems.some((e) => /group 010 is marked twice/.test(e)), 'a group marked twice');
  fs.writeFileSync(path.join(d, 'specs', 'README.md'), before);
  fs.mkdirSync(path.join(d, 'specs', '012-twelve'));
  const p12 = path.join(d, 'specs', '012-twelve', 'spec.md');
  fs.writeFileSync(p12, si.setBlock(bare('Twelve'), { group: 'nowhere', title: 'Twelve', status: 'draft' }));
  assert.ok(si.check(d).problems.some((e) => /group "nowhere" .* has no "<!-- specs-index group=nowhere -->" line/.test(e)));
  fs.writeFileSync(p12, blk('group: 010\ntitle: a | b\nstatus: draft'));
  assert.ok(si.check(d).problems.some((e) => /012-twelve\/spec\.md: "title" contains/.test(e)));

  // --add: a spec made from the Spec Kit template gets a Draft block in the newest spec's group and passes --strict
  const tpl = fs.readFileSync(path.join(ROOT, '.specify', 'templates', 'spec-template.md'), 'utf8').replace('[FEATURE NAME]', 'Twelve things');
  fs.writeFileSync(p12, tpl);
  assert.ok(si.check(d).problems.some((e) => /012-twelve\/spec\.md: no specs-index block/.test(e)), 'the template alone has no block');
  r = cli('--add', 'specs/012-twelve', '--root', d);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(si.parseBlock(fs.readFileSync(p12, 'utf8')).meta, { group: '010', title: 'Twelve things', status: 'draft' });
  assert.strictEqual(cli('--check', '--strict', '--root', d).status, 0, 'a new spec from the template passes --check --strict');
  assert.ok(si.generate(d).text.includes('| [011](011-eleven/spec.md) | Eleven | built: too |\n| [012](012-twelve/spec.md) | Twelve things | draft |'), 'it lands in its group, last by number');
  assert.strictEqual(cli('--add', 'specs/012-twelve', '--root', d).status, 1, 'never a second block');
}
{
  // import refuses what it cannot represent, and writes nothing then
  const dup = HAND.replace('| [002](002-two/spec.md) | Two (issue #2) | draft |', '| [002](002-two/spec.md) | Two | draft |\n| [002](002-two/spec.md) | Two again | x |');
  const d = repo(dup, SPECS);
  assert.ok(si.importIndex(d).errors.some((e) => /002-two has two rows/.test(e)), 'duplicate rows (a union merge leftover) must be merged first');
  assert.strictEqual(rd(d, 'README.md'), dup, 'nothing written');
  const d2 = repo(HAND.replace('| Two (issue #2) | draft |', '| Two (issue #2) | a --> b |'), SPECS);
  assert.ok(si.importIndex(d2).errors.some((e) => /row 002: "status" contains "-->"/.test(e)), 'a comment end in a row is refused by the import');
  assert.strictEqual(si.parseBlock(rd(d2, '002-two/spec.md')).meta, null, 'no block written');
}

console.log('test-specs-index: ok');
