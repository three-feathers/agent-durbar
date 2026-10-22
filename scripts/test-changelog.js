/*
 * Spec 025 delta 2026-10-22 (`npm run test:changelog`, part of `npm test`): CHANGELOG fragments. Fragment parsing, the checks
 * (format, names, duplicates, the Unreleased transition and cut-over), the release fold (order, deletion, rest of the file
 * untouched, idempotence, refusals) and the one-time migration, all in throwaway folders. The real repository is checked by
 * `node scripts/changelog.js check`, the suite's second step.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cl = require('./changelog.js');

const RELEASED = [
  '## v0.1.0-alpha.10 ([pre-release](https://example.invalid/a10), 2026-10-21)',
  '',
  '- Old entry one.',
  '- Old entry two',
  '  with a continuation line.',
  '',
  '## v0.1.0-alpha.9 (2026-10-20)',
  '',
  '- Older entry.',
  '',
].join('\n');
const head = (unreleased) => `# Changelog\n\nIntro paragraph.\n\n## Unreleased (on \`main\`, after the alpha.10 tag)\n\n${unreleased}${unreleased ? '\n\n' : ''}`;

function repo(unreleased, fragments = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-changelog-'));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), head(unreleased) + RELEASED);
  fs.mkdirSync(path.join(dir, 'changelog.d'));
  fs.writeFileSync(path.join(dir, 'changelog.d', 'README.md'), '# not a fragment\n\nprose\n');
  for (const [f, t] of Object.entries(fragments)) fs.writeFileSync(path.join(dir, 'changelog.d', f), t);
  return dir;
}
const read = (dir, f = 'CHANGELOG.md') => fs.readFileSync(path.join(dir, f), 'utf8');

// --- fragment parsing ---
assert.deepStrictEqual(cl.parseFragment('- One.\n').bullets, ['- One.']);
assert.deepStrictEqual(cl.parseFragment('- One\n  more\n  - sub\n\n- Two\n').bullets, ['- One\n  more\n  - sub', '- Two'], 'continuations and sub-bullets stay with their bullet');
assert.deepStrictEqual(cl.parseFragment('- CRLF one\r\n- two\r\n').bullets, ['- CRLF one', '- two'], 'CRLF (a Windows checkout) is read');
assert.match(cl.parseFragment('').errors[0], /empty/);
assert.match(cl.parseFragment('## Heading\n- x\n').errors[0], /no headings/);
assert.match(cl.parseFragment('Prose line\n').errors[0], /starts with "- "/);
assert.match(cl.parseFragment('  indented first\n').errors[0], /must follow/);
assert.ok(cl.parseFragment('- x <!-- hidden -->\n').errors.some((e) => /HTML comments/.test(e)), 'comments refused (they could hide the cut-over marker)');

// --- check ---
{
  const d = repo('', { 'b-second.md': '- Second.\n', 'a-first.md': '- First.\n', 'Bad-Name.md': '- x\n', 'notes.txt': '- y\n' });
  const frs = cl.readFragments(d);
  assert.deepStrictEqual(frs.map((f) => f.file), ['Bad-Name.md', 'a-first.md', 'b-second.md', 'notes.txt'], 'sorted, README.md left out');
  const { errors, warnings } = cl.check(d);
  assert.strictEqual(warnings.length, 0);
  assert.ok(errors.some((e) => /Bad-Name\.md: name must be lower case/.test(e)), 'upper case name refused (case-insensitive disks)');
  assert.ok(errors.some((e) => /notes\.txt: name/.test(e)), 'a non-.md file refused');
  assert.strictEqual(errors.length, 2);
}
{
  const d = repo('', { 'a.md': '- Same entry.\n', 'b.md': '-   Same   entry.\n', 'c.md': '- Old entry one.\n' });
  const { errors } = cl.check(d);
  assert.ok(errors.some((e) => /b\.md: the entry "- Same entry\.…" is already in changelog\.d\/a\.md/.test(e)), 'duplicate across fragments (spacing ignored)');
  assert.ok(errors.some((e) => /c\.md: .* already in CHANGELOG\.md/.test(e)), 'duplicate of a released entry');
}
{
  const d = repo('- Hand-written line.', { 'a.md': '- Fragment.\n' });
  let r = cl.check(d);
  assert.deepStrictEqual(r.errors, []);
  assert.match(r.warnings[0], /1 bullet\(s\) under "Unreleased".*transition/, 'before the cut-over a hand line only warns');
  r = cl.check(d, { strict: true });
  assert.match(r.errors[0], /under "Unreleased"/, '--strict fails on it');
  const d2 = repo(`${cl.MARKER}\n\n- Hand-written after the cut-over.`);
  assert.match(cl.check(d2).errors[0], /under "Unreleased"/, 'after the cut-over marker a hand line fails');
}

// --- build (the release fold) ---
{
  const d = repo('- Transition line A.\n- Transition line B\n  continued.', { 'b.md': '- Fragment B.\n', 'a.md': '- Fragment A1.\n- Fragment A2.\n' });
  const before = read(d);
  assert.throws(() => cl.build(d, {}), /give the release heading/);
  const dry = cl.build(d, { release: 'v0.1.0-alpha.11 (2026-10-22)', dryRun: true });
  assert.ok(dry.changed);
  assert.strictEqual(read(d), before, '--dry-run writes nothing');
  assert.ok(fs.existsSync(path.join(d, 'changelog.d', 'a.md')), '--dry-run deletes nothing');

  const r = cl.build(d, { release: 'v0.1.0-alpha.11 ([pre-release](https://example.invalid/a11), 2026-10-22)' });
  assert.deepStrictEqual(r.removed.map((f) => path.basename(f)), ['a.md', 'b.md']);
  assert.deepStrictEqual(fs.readdirSync(path.join(d, 'changelog.d')), ['README.md'], 'fragments deleted, README kept');
  const text = read(d);
  const expected =
    '# Changelog\n\nIntro paragraph.\n\n## Unreleased (on `main`, after the alpha.11 tag)\n\n' +
    `${cl.INTRO}\n\n${cl.MARKER}\n\n` +
    '## v0.1.0-alpha.11 ([pre-release](https://example.invalid/a11), 2026-10-22)\n\n' +
    '- Fragment A1.\n- Fragment A2.\n- Fragment B.\n- Transition line A.\n- Transition line B\n  continued.\n\n' +
    RELEASED;
  assert.strictEqual(text, expected, 'fragments by file name, then the transition lines; the tag in Unreleased moves on; released sections untouched');
  assert.deepStrictEqual(cl.check(d), { errors: [], warnings: [] }, 'clean after the fold');

  // idempotent: nothing left to fold, nothing changes (also with the same heading again)
  assert.deepStrictEqual(cl.build(d, { release: 'v0.1.0-alpha.11 ([pre-release](https://example.invalid/a11), 2026-10-22)' }), { changed: false, removed: [] });
  assert.strictEqual(read(d), text);

  // next cycle: a new fragment folds under the same Unreleased intro, which is not duplicated
  fs.writeFileSync(path.join(d, 'changelog.d', 'next.md'), '- Next change.\n');
  assert.throws(() => cl.build(d, { release: 'v0.1.0-alpha.11 ([pre-release](https://example.invalid/a11), 2026-10-22)' }), /already has/, 'an existing heading is refused');
  cl.build(d, { release: 'v0.1.0-alpha.12 (2026-10-23)' });
  const t2 = read(d);
  assert.strictEqual(t2.split(cl.INTRO).length, 2, 'one intro');
  assert.strictEqual(t2.split(cl.MARKER).length, 2, 'one marker');
  assert.ok(t2.indexOf('## v0.1.0-alpha.12') < t2.indexOf('## v0.1.0-alpha.11'), 'newest release first');
  assert.match(t2, /after the alpha\.12 tag/);
}
{
  const d = repo('', { 'a.md': '# bad\n' });
  assert.throws(() => cl.build(d, { release: 'v9 (x)' }), /fix these first/, 'build refuses invalid fragments');
}
{
  const d = repo('');
  const before = read(d);
  assert.deepStrictEqual(cl.build(d, { release: 'v9 (x)' }), { changed: false, removed: [] }, 'nothing pending: no-op');
  assert.strictEqual(read(d), before);
}

// --- migrate (one time, at the merge of this change) ---
{
  const d = repo('- Old way one.\n\n- Old way two\n  more.', { 'x.md': '- New way.\n' });
  const r = cl.migrate(d);
  assert.strictEqual(r.moved, 2);
  assert.strictEqual(read(d, path.join('changelog.d', 'before-fragments.md')), '- Old way one.\n- Old way two\n  more.\n');
  assert.deepStrictEqual(cl.check(d), { errors: [], warnings: [] }, 'no hand lines left');
  assert.ok(read(d).includes(`## Unreleased (on \`main\`, after the alpha.10 tag)\n\n${cl.INTRO}\n\n## v0.1.0-alpha.10`), 'intro added, rest kept');
  assert.ok(read(d).endsWith(RELEASED));
  assert.deepStrictEqual(cl.migrate(d), { moved: 0 }, 'second run: nothing to move');
  assert.throws(() => cl.migrate(d, { name: '../escape.md' }), /bad fragment name/, 'the name stays inside changelog.d');
  const d2 = repo('- Old way.', { 'x.md': '- New way.\n' });
  assert.throws(() => cl.migrate(d2, { name: 'x.md' }), /exists already/, 'never overwrites a fragment');
  assert.ok(read(d2).includes('- Old way.'), 'nothing moved on a refusal');
}

// CRLF CHANGELOG (a Windows checkout) is read
{
  const d = repo('- Hand line.');
  fs.writeFileSync(path.join(d, 'CHANGELOG.md'), read(d).replace(/\n/g, '\r\n'));
  assert.strictEqual(cl.check(d).warnings.length, 1);
}

console.log('test-changelog: ok');
