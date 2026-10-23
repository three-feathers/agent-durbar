/*
 * Spec 025 delta 2026-10-22 (`npm run test:changelog`, part of `npm test`): CHANGELOG fragments. Fragment parsing, the checks
 * (format, names, duplicates, the Unreleased transition and cut-over), the release fold (order, deletion, rest of the file
 * untouched, idempotence, refusals, one section per version), all in throwaway folders. The real repository is checked by
 * `node scripts/changelog.js check`, the suite's second step.
 * Spec 008 FR-117..FR-120 (fold at tag time): `notes` / `build --stdout`, `scripts/release-notes.js` on throwaway git repositories
 * (tag on main, version, previous release folded, the checked-out commit), and the wiring of `.github/workflows/release.yml`.
 * Spec 008 FR-121..FR-124 (issue #658, test builds): the tag classifier, a test tag off main accepted while a regular one stays
 * refused, its notes (only the unmerged commits, masked then cut, capped), its version rule, and that it is never the previous release.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const cl = require('./changelog.js');
const rn = require('./release-notes.js');

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
assert.ok(cl.parseFragment('- x --!> y\n').errors.some((e) => /HTML comments/.test(e)), 'the --!> comment end too');
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
  assert.throws(() => cl.build(d, { release: 'v0.1.0-alpha.11 (2026-10-23, a typo in the date)' }), /already has a section for v0\.1\.0-alpha\.11/, 'the same version with another date or link is refused (review on #518)');
  assert.throws(() => cl.build(d, { release: 'Release twelve' }), /must start with the version/, 'a heading without a version is refused');
  assert.ok(fs.existsSync(path.join(d, 'changelog.d', 'next.md')), 'a refusal deletes nothing');
  cl.build(d, { release: 'v0.1.0-alpha.12 (2026-10-23)' });
  const t2 = read(d);
  assert.strictEqual(t2.split(cl.INTRO).length, 2, 'one intro');
  assert.strictEqual(t2.split(cl.MARKER).length, 2, 'one marker');
  assert.ok(t2.indexOf('## v0.1.0-alpha.12') < t2.indexOf('## v0.1.0-alpha.11'), 'newest release first');
  assert.match(t2, /after the alpha\.12 tag/);
}
{
  const d = repo('', { 'a.md': '# bad\n' });
  assert.throws(() => cl.build(d, { release: 'v9.0.0 (x)' }), /fix these first/, 'build refuses invalid fragments');
}
{
  const d = repo('');
  const before = read(d);
  assert.deepStrictEqual(cl.build(d, { release: 'v9.0.0 (x)' }), { changed: false, removed: [] }, 'nothing pending: no-op');
  assert.strictEqual(read(d), before);
}

// CRLF CHANGELOG (a Windows checkout) is read
{
  const d = repo('- Hand line.');
  fs.writeFileSync(path.join(d, 'CHANGELOG.md'), read(d).replace(/\n/g, '\r\n'));
  assert.strictEqual(cl.check(d).warnings.length, 1);
}

// --- spec 008 FR-117: the notes of a tag (build --stdout), from the tag's own files, writing nothing ---
{
  const d = repo('', { 'b.md': '- Fragment B.\n', 'a.md': '- Fragment A.\n' });
  const before = read(d);
  const h = 'v0.1.0-alpha.11 ([pre-release](https://example.invalid/a11), 2026-10-23)';
  const r = cl.notes(d, { release: h, previous: 'v0.1.0-alpha.10' });
  assert.deepStrictEqual(r, { section: `## ${h}\n\n- Fragment A.\n- Fragment B.`, source: 'fragments' }, 'the section build would write, fragments by name');
  assert.strictEqual(read(d), before, 'notes writes nothing');
  assert.deepStrictEqual(fs.readdirSync(path.join(d, 'changelog.d')).sort(), ['README.md', 'a.md', 'b.md'], 'notes deletes nothing');
  assert.strictEqual(cl.build(d, { release: h, dryRun: true }).section, r.section, 'the same section as the fold PR will write');
  assert.throws(() => cl.notes(d, { release: h, previous: 'v0.1.0-alpha.9x' }), /no section for the previous release v0\.1\.0-alpha\.9x: merge its fold PR/, 'an unfolded previous release is refused');
  assert.throws(() => cl.build(d, { release: h, previous: 'v0.1.0-alpha.9x' }), /previous release/, 'the fold refuses it too');
  assert.throws(() => cl.notes(d, { release: 'Release eleven' }), /must start with the version/);
  assert.throws(() => cl.notes(d, {}), /give the release heading/);
  // the CLI prints exactly the section
  const out = execFileSync(process.execPath, [path.join(__dirname, 'changelog.js'), 'build', '--root', d, '--release', h, '--stdout'], { encoding: 'utf8' });
  assert.strictEqual(out, `${r.section}\n`, 'build --stdout prints the section');
  assert.strictEqual(read(d), before, 'build --stdout writes nothing');
  // a version folded the old way (a release PR) gives its existing section; new fragments wait for the next release
  cl.build(d, { release: h });
  fs.writeFileSync(path.join(d, 'changelog.d', 'later.md'), '- Later change.\n');
  const old = cl.notes(d, { release: h });
  assert.strictEqual(old.source, 'changelog');
  assert.strictEqual(old.section, `## ${h}\n\n- Fragment A.\n- Fragment B.`, 'the existing section, up to the next one');
  assert.ok(!old.section.includes('Later change') && !old.section.includes('alpha.10'), 'nothing of the next section or of the new fragments');
  assert.throws(() => cl.notes(repo(''), { release: 'v9.0.0 (x)' }), /nothing to release for v9\.0\.0/, 'an empty release is refused');
  assert.throws(() => cl.notes(repo('', { 'a.md': '# bad\n' }), { release: 'v9.0.0 (x)' }), /fix these first/, 'invalid fragments are refused');
}

// --- spec 008 FR-117..FR-119: scripts/release-notes.js on throwaway git repositories ---
{
  // no user or system git config (signing, hooks, autocrlf): an empty file, which works on Windows too
  const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-gitconfig-')), 'config');
  fs.writeFileSync(emptyConfig, '');
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_AUTHOR_DATE: '2026-10-23T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-23T10:00:00Z' };
  const g = (d, ...args) => execFileSync('git', args, { cwd: d, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const pkg = (d, v) => fs.writeFileSync(path.join(d, 'package.json'), `${JSON.stringify({ name: 'x', version: v })}\n`);
  const commit = (d, msg) => { g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', msg); };
  // a repository whose main has alpha.10 tagged (its section is in RELEASED), then two fragments and the alpha.11 version bump
  const gitRepo = () => {
    const d = repo('', {});
    g(d, 'init', '-q', '-b', 'main');
    pkg(d, '0.1.0-alpha.10');
    commit(d, 'alpha.10');
    g(d, 'tag', '-a', '-m', 'alpha.10', 'v0.1.0-alpha.10');
    fs.writeFileSync(path.join(d, 'changelog.d', 'a.md'), '- Change A.\n');
    fs.writeFileSync(path.join(d, 'changelog.d', 'b.md'), '- Change B.\n');
    pkg(d, '0.1.0-alpha.11');
    commit(d, 'alpha.11 version');
    return d;
  };
  const opts = { tag: 'v0.1.0-alpha.11', repo: 'three-feathers/agent-durbar', mainRef: 'refs/heads/main' };
  {
    const d = gitRepo();
    g(d, 'tag', '-a', '-m', 'alpha.11', 'v0.1.0-alpha.11');
    fs.writeFileSync(path.join(d, 'changelog.d', 'c.md'), '- Change C after the tag.\n');
    commit(d, 'later'); // main moves on after the tag: the notes must not see it
    g(d, 'checkout', '-q', 'v0.1.0-alpha.11');
    const status = g(d, 'status', '--porcelain');
    const r = rn.releaseNotes(d, opts);
    const h = 'v0.1.0-alpha.11 ([pre-release](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.11), 2026-10-23)';
    assert.strictEqual(r.heading, h, 'heading: tag, release link, the tag date');
    assert.strictEqual(r.previous, 'v0.1.0-alpha.10');
    assert.strictEqual(r.notes, `${rn.PREAMBLE}\n\n## ${h}\n\n- Change A.\n- Change B.\n`, 'exactly the tagged commit\'s fragments, after the fixed paragraph');
    assert.strictEqual(g(d, 'status', '--porcelain'), status, 'no tracked file changed');
    const sum = rn.summary(r, opts.tag);
    assert.ok(sum.includes(`git switch -c <NNN>-fold-0.1.0-alpha.11 v0.1.0-alpha.11`) && sum.includes(`npm run changelog:build -- --release "${h}"`), 'the summary gives the fold PR commands, from the tag');
    assert.ok(!/git push/.test(sum), 'the summary never tells anyone to push to main');
    // the CLI writes --out and appends to --summary
    const out = path.join(d, '..', `${path.basename(d)}-notes.md`);
    const sumFile = path.join(d, '..', `${path.basename(d)}-summary.md`);
    fs.writeFileSync(sumFile, 'before\n');
    execFileSync(process.execPath, [path.join(__dirname, 'release-notes.js'), '--root', d, '--tag', opts.tag, '--repo', opts.repo, '--main-ref', 'refs/heads/main', '--out', out, '--summary', sumFile], { env: gitEnv, stdio: 'ignore' });
    assert.strictEqual(fs.readFileSync(out, 'utf8'), r.notes);
    assert.ok(fs.readFileSync(sumFile, 'utf8').startsWith('before\n### Release notes for v0.1.0-alpha.11'), 'the summary is appended');
    // the checked-out commit must be the tag's
    g(d, 'checkout', '-q', 'main');
    assert.throws(() => rn.releaseNotes(d, opts), /checked-out commit is not v0\.1\.0-alpha\.11's commit/);
  }
  {
    // a tag on a branch that never reached main is refused
    const d = gitRepo();
    g(d, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(d, 'side.txt'), 'x\n');
    commit(d, 'side');
    g(d, 'tag', '-a', '-m', 'side', 'v0.1.0-alpha.11');
    assert.throws(() => rn.releaseNotes(d, opts), /is not on refs\/heads\/main: only commits on main are released/);
    assert.throws(() => rn.releaseNotes(d, { ...opts, mainRef: 'refs/remotes/origin/main' }), /no refs\/remotes\/origin\/main in this checkout/, 'a missing main ref fails, it is not skipped');
    assert.strictEqual(rn.MAIN_REF, 'refs/remotes/origin/main', 'the default is the remote branch by its full name');
    // a tag named after the main ref must not stand in for the branch (short names resolve to refs/tags/ first)
    g(d, 'tag', 'main', 'side');
    g(d, 'tag', 'refs/heads/main', 'side');
    assert.throws(() => rn.releaseNotes(d, { ...opts, mainRef: 'main' }), /must be a full ref name/, 'a short main ref is refused');
    for (const bad of ['origin/main', 'refs/../x', '-q', '']) assert.throws(() => rn.releaseNotes(d, { ...opts, mainRef: bad }), /must be a full ref name/, `main ref "${bad}" refused`);
    assert.throws(() => rn.releaseNotes(d, opts), /is not on refs\/heads\/main/, 'the tags called main and refs/heads/main do not count');
    g(d, 'tag', '-d', 'main');
    // the same commit is fine once main has it
    g(d, 'checkout', '-q', 'main');
    g(d, 'merge', '-q', '--ff-only', 'side');
    g(d, 'checkout', '-q', 'v0.1.0-alpha.11');
    assert.strictEqual(rn.releaseNotes(d, opts).source, 'fragments');
  }
  {
    // version mismatch, bad names, no tag
    const d = gitRepo();
    g(d, 'tag', '-a', '-m', 'x', 'v0.1.0-alpha.12');
    g(d, 'checkout', '-q', 'v0.1.0-alpha.12');
    assert.throws(() => rn.releaseNotes(d, { ...opts, tag: 'v0.1.0-alpha.12' }), /does not match package\.json version v0\.1\.0-alpha\.11: land the version PR first/);
    assert.throws(() => rn.releaseNotes(d, opts), /no tag v0\.1\.0-alpha\.11/);
    for (const bad of ['main', 'v1', 'v1.2.3;rm', 'v1.2.3 x', '-v1.2.3', 'v1.2.3-', '']) assert.throws(() => rn.releaseNotes(d, { ...opts, tag: bad }), /is not a release tag/, `tag "${bad}" refused`);
    assert.throws(() => rn.releaseNotes(d, { ...opts, repo: 'a/b/c' }), /owner\/name/);
  }
  {
    // the previous release's fold PR has not merged: its section is missing, so the next tag is refused (no double listing)
    const d = gitRepo();
    g(d, 'tag', '-a', '-m', 'alpha.11', 'v0.1.0-alpha.11');
    pkg(d, '0.1.0-alpha.12');
    fs.writeFileSync(path.join(d, 'changelog.d', 'c.md'), '- Change C.\n');
    commit(d, 'alpha.12 version, no fold of alpha.11');
    g(d, 'tag', '-a', '-m', 'alpha.12', 'v0.1.0-alpha.12');
    // test build tags (no section by design) in between are not taken for the previous release, also one with a valid tag name
    g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.12-mcptest.1', 'v0.1.0-alpha.11');
    g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-test.1', 'v0.1.0-alpha.11');
    assert.ok(rn.TAG_RE.test('v0.1.0-test.1') && !rn.RELEASE_TAG_RE.test('v0.1.0-test.1'), 'a valid tag name that is not a release');
    assert.strictEqual(rn.previousRelease(d, g(d, 'rev-parse', 'v0.1.0-alpha.12^{commit}'), 'v0.1.0-alpha.12'), 'v0.1.0-alpha.11');
    g(d, 'checkout', '-q', 'v0.1.0-alpha.12');
    assert.throws(() => rn.releaseNotes(d, { ...opts, tag: 'v0.1.0-alpha.12' }), /no section for the previous release v0\.1\.0-alpha\.11: merge its fold PR/);
    // after the fold of alpha.11 (done from its tag, then main merged) the alpha.12 notes list only C
    g(d, 'checkout', '-q', '-b', 'fold', 'v0.1.0-alpha.11');
    cl.build(d, { release: 'v0.1.0-alpha.11 ([pre-release](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.11), 2026-10-23)' });
    commit(d, 'fold alpha.11');
    g(d, 'merge', '-q', '--no-edit', 'main');
    assert.deepStrictEqual(fs.readdirSync(path.join(d, 'changelog.d')).sort(), ['README.md', 'c.md'], 'the fold removes only the tag\'s fragments; later ones come back with main');
    g(d, 'checkout', '-q', 'main');
    g(d, 'merge', '-q', '--ff-only', 'fold');
    g(d, 'tag', '-f', '-a', '-m', 'alpha.12 again', 'v0.1.0-alpha.12');
    g(d, 'checkout', '-q', 'v0.1.0-alpha.12');
    const r = rn.releaseNotes(d, { ...opts, tag: 'v0.1.0-alpha.12' });
    assert.ok(r.notes.endsWith('- Change C.\n') && !r.notes.includes('Change A'), 'the next release lists only its own changes');
  }
  {
    // a final release sorts above its pre-releases (versionsort.suffix=-), so an unfolded v0.1.0 is not missed
    const d = repo('', {});
    g(d, 'init', '-q', '-b', 'main');
    pkg(d, '0.1.0-alpha.10');
    commit(d, 'alpha.10');
    g(d, 'tag', '-a', '-m', 'a10', 'v0.1.0-alpha.10');
    fs.writeFileSync(path.join(d, 'changelog.d', 'a.md'), '- Change A.\n');
    pkg(d, '0.1.0');
    commit(d, 'final');
    g(d, 'tag', '-a', '-m', 'final', 'v0.1.0');
    fs.writeFileSync(path.join(d, 'changelog.d', 'b.md'), '- Change B.\n');
    pkg(d, '0.1.1-alpha.1');
    commit(d, 'next');
    g(d, 'tag', '-a', '-m', 'next', 'v0.1.1-alpha.1');
    assert.strictEqual(rn.previousRelease(d, g(d, 'rev-parse', 'v0.1.1-alpha.1^{commit}'), 'v0.1.1-alpha.1'), 'v0.1.0', 'v0.1.0 is newer than v0.1.0-alpha.10');
    g(d, 'checkout', '-q', 'v0.1.1-alpha.1');
    assert.throws(() => rn.releaseNotes(d, { ...opts, tag: 'v0.1.1-alpha.1' }), /no section for the previous release v0\.1\.0: merge its fold PR/, 'the unfolded final release is caught');
  }
  // --- spec 008 FR-121..FR-124 (issue #658): test builds from branches ---
  {
    // the classifier: a release version plus -test.N is a test build; checked before TAG_RE (which also matches v1.2.3-test.4)
    for (const t of ['v0.1.0-alpha.15-test.1', 'v0.1.0-test.2', 'v1.2.3-rc.4-test.10', 'v0.1.0-beta.1-test.0', 'v10.20.30-alpha.99-test.123']) {
      assert.strictEqual(rn.tagKind(t), 'test', `${t} is a test build`);
      assert.ok(!rn.RELEASE_TAG_RE.test(t), `${t} is never a release`);
    }
    for (const t of ['v0.1.0-alpha.15', 'v0.1.0', 'v1.2.3-rc.1', 'v0.1.0-mcptest.1', 'v0.1.0-test.1.2', 'v0.1.0-test.x']) assert.strictEqual(rn.tagKind(t), 'release', `${t} takes the regular path (on main)`);
    for (const t of ['v0.1.0-alpha.14-mcptest.1', 'v0.1.0-alpha.15-test', 'v0.1.0-alpha.15-test.1.2', 'v0.1.0-alpha.15-test.x', 'v0.1.0-alpha.15-Test.1', 'v0.1.0-alpha.15-test.1\n',
      ' v0.1.0-test.1', 'v0.1.0-gamma.1-test.1', 'v0.1.0-alpha.15-test.1;rm', 'v0.1.0-alpha-test.1', 'v0.1.0-alpha.15-test.-1', 'v0.1.0-alpha.15-test.1-test.2', '', undefined, 7]) {
      assert.strictEqual(rn.tagKind(t), '', `${JSON.stringify(t)} refused`);
    }
    assert.strictEqual(rn.TEST_TAG_RE.exec('v0.1.0-alpha.15-test.3')[1], '0.1.0-alpha.15', 'the base version is the tag without -test.N');
  }
  if (!process.features.typescript) {
    console.log('test-changelog: test-build notes skipped (this Node has no type stripping, so src/shared/redact.ts cannot load; CI runs them)');
  } else {
    const { redact, cut } = rn.loadRedact();
    const TOKEN = `ghp_${'Ab1'.repeat(12)}`;
    const LONG = `Long subject with ${TOKEN} inside ${'word '.repeat(60)}end`;
    // a branch off main: the version bump commit is on main, three commits are not (one masked, one long, one naming a PR)
    const sideRepo = () => {
      const d = gitRepo();
      g(d, 'checkout', '-q', '-b', 'side');
      fs.writeFileSync(path.join(d, 'side.txt'), '1\n');
      commit(d, 'Fix the MCP sign-in (#123)');
      fs.writeFileSync(path.join(d, 'side.txt'), '2\n');
      commit(d, `Debug line with ${TOKEN} by mistake`);
      fs.writeFileSync(path.join(d, 'side.txt'), '3\n');
      commit(d, LONG);
      return d;
    };
    const topts = { ...opts, tag: 'v0.1.0-alpha.11-test.1' };
    {
      const d = sideRepo();
      g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.11-test.1');
      g(d, 'tag', '-a', '-m', 'release on the same commit', 'v0.1.0-alpha.11');
      g(d, 'checkout', '-q', 'v0.1.0-alpha.11-test.1');
      const status = g(d, 'status', '--porcelain');
      // a regular tag off main is still refused, even on the very commit a test tag may build
      assert.throws(() => rn.releaseNotes(d, opts), /is not on refs\/heads\/main: only commits on main are released/, 'a regular tag off main is still refused');
      const r = rn.releaseNotes(d, topts);
      assert.strictEqual(r.kind, 'test');
      assert.strictEqual(r.title, 'Agent Durbar v0.1.0-alpha.11-test.1 (test build)');
      assert.strictEqual(r.previous, '', 'a test build has no previous release');
      assert.strictEqual(r.source, 'commits');
      assert.strictEqual(r.commits, 3, 'only the commits that are not on main');
      const sha = (rev) => g(d, 'rev-parse', '--short=12', rev);
      const expected = [
        rn.TEST_PREAMBLE,
        '',
        '## v0.1.0-alpha.11-test.1 (test build, 2026-10-23)',
        '',
        'Commits not on `main` (3, newest first; [compare](https://github.com/three-feathers/agent-durbar/compare/main...v0.1.0-alpha.11-test.1)):',
        '',
        `- \`${sha('HEAD')}\` ${cut(redact(LONG), rn.TEST_SUBJECT_MAX)}`,
        `- \`${sha('HEAD~1')}\` Debug line with [redacted] by mistake`,
        `- \`${sha('HEAD~2')}\` Fix the MCP sign-in (#123)`,
        '',
        'Pull requests named in them: #123',
        '',
      ].join('\n');
      assert.strictEqual(r.notes, expected, 'the unmerged commits, newest first, masked, then cut; the PRs they name');
      assert.ok(!r.notes.includes('ghp_') && !r.notes.includes('Ab1Ab1'), 'no part of the token is left');
      const longLine = r.notes.split('\n').find((l) => l.includes('Long subject'));
      assert.ok(longLine.endsWith(' [truncated]') && longLine.length < rn.TEST_SUBJECT_MAX + 40, 'a long subject is cut');
      assert.ok(longLine.length > rn.TEST_SUBJECT_MAX, 'cut after the mask: the full length is kept for the text after the token');
      assert.ok(!/alpha\.11 version|alpha\.10|Change A|Change B/.test(r.notes), 'no commit of main and no changelog fragment');
      assert.strictEqual(g(d, 'status', '--porcelain'), status, 'no tracked file changed');
      const sum = rn.summary(r, topts.tag);
      assert.ok(sum.startsWith('### Test build v0.1.0-alpha.11-test.1') && /Commits not on `main`: 3/.test(sum) && /No fold PR/.test(sum), 'the summary says it is a test build');
      assert.ok(!/changelog:build|git switch|git push/.test(sum), 'no fold PR commands for a test build');
      // the CLI writes the notes and the title
      const out = path.join(d, '..', `${path.basename(d)}-tnotes.md`);
      const title = path.join(d, '..', `${path.basename(d)}-ttitle.txt`);
      execFileSync(process.execPath, [path.join(__dirname, 'release-notes.js'), '--root', d, '--tag', topts.tag, '--repo', opts.repo, '--main-ref', 'refs/heads/main', '--out', out, '--title-out', title], { env: gitEnv, stdio: 'ignore' });
      assert.strictEqual(fs.readFileSync(out, 'utf8'), r.notes);
      assert.strictEqual(fs.readFileSync(title, 'utf8'), 'Agent Durbar v0.1.0-alpha.11-test.1 (test build)\n');
      // fail closed: without type stripping redact.ts cannot load, and there are no notes rather than unmasked ones
      fs.rmSync(out);
      let failed;
      try {
        execFileSync(process.execPath, ['--no-experimental-strip-types', path.join(__dirname, 'release-notes.js'), '--root', d, '--tag', topts.tag, '--repo', opts.repo, '--main-ref', 'refs/heads/main', '--out', out], { env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { failed = e; }
      assert.ok(failed && failed.status === 1 && /masked with src\/shared\/redact\.ts, which needs Node 22\.18/.test(failed.stderr), 'no redaction: refused');
      assert.ok(!fs.existsSync(out), 'no redaction: no notes file');
      // the version: package.json must be the tag without -test.N
      g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.12-test.1');
      g(d, 'checkout', '-q', 'v0.1.0-alpha.12-test.1');
      assert.throws(() => rn.releaseNotes(d, { ...opts, tag: 'v0.1.0-alpha.12-test.1' }), /test tag v0\.1\.0-alpha\.12-test\.1 needs package\.json version 0\.1\.0-alpha\.12 \(the tag without -test\.N\): the branch has v0\.1\.0-alpha\.11/);
      // the checked-out commit must be the tag's, and the main ref must exist, for a test tag too
      g(d, 'checkout', '-q', 'main');
      assert.throws(() => rn.releaseNotes(d, topts), /checked-out commit is not v0\.1\.0-alpha\.11-test\.1's commit/);
      g(d, 'checkout', '-q', 'v0.1.0-alpha.11-test.1');
      assert.throws(() => rn.releaseNotes(d, { ...topts, mainRef: 'refs/remotes/origin/main' }), /no refs\/remotes\/origin\/main in this checkout/);
      assert.throws(() => rn.releaseNotes(d, { ...topts, mainRef: 'main' }), /must be a full ref name/);
      // a regular tag keeps its own version check
      assert.throws(() => rn.releaseNotes(d, { ...opts, tag: 'v0.1.0-alpha.12' }), /tag v0\.1\.0-alpha\.12 does not match package\.json version v0\.1\.0-alpha\.11: land the version PR first/);
    }
    {
      // a test tag on main lists no commits; a test tag is never the previous release of the next real one
      const d = gitRepo();
      g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.11-test.1');
      g(d, 'checkout', '-q', 'v0.1.0-alpha.11-test.1');
      const r = rn.releaseNotes(d, topts);
      assert.strictEqual(r.commits, 0);
      assert.ok(r.notes.includes('Commits not on `main`: none') && !r.notes.includes('Pull requests named'), 'on main: no commits to list');
      g(d, 'checkout', '-q', 'main');
      g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.10-test.1', 'v0.1.0-alpha.10');
      g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.11-test.2');
      pkg(d, '0.1.0-alpha.11');
      fs.writeFileSync(path.join(d, 'changelog.d', 'c.md'), '- Change C.\n');
      commit(d, 'one more change');
      g(d, 'tag', '-a', '-m', 'alpha.11', 'v0.1.0-alpha.11');
      assert.strictEqual(rn.previousRelease(d, g(d, 'rev-parse', 'v0.1.0-alpha.11^{commit}'), 'v0.1.0-alpha.11'), 'v0.1.0-alpha.10', 'test tags in between are skipped');
      g(d, 'checkout', '-q', 'v0.1.0-alpha.11');
      const rel = rn.releaseNotes(d, opts);
      assert.strictEqual(rel.kind, 'release');
      assert.strictEqual(rel.title, 'Agent Durbar v0.1.0-alpha.11');
      assert.ok(rel.notes.startsWith(rn.PREAMBLE) && rel.notes.endsWith('- Change A.\n- Change B.\n- Change C.\n'), 'the real release still gets its fragments');
    }
    {
      // at most TEST_COMMITS_MAX commits are listed, then a count of the rest
      const d = gitRepo();
      // one git fast-import for the empty commits (a git commit per step took seconds)
      const steps = Array.from({ length: rn.TEST_COMMITS_MAX + 2 }, (_, i) => `step ${i + 1}`);
      const stream = steps.map((m, i) => `commit refs/heads/many\ncommitter t <t@example.invalid> 1792749600 +0000\ndata ${m.length}\n${m}\n${i ? '' : 'from refs/heads/main^0\n'}\n`).join('');
      execFileSync('git', ['fast-import', '--quiet'], { cwd: d, env: gitEnv, input: stream, stdio: ['pipe', 'ignore', 'pipe'] });
      g(d, 'checkout', '-q', 'many');
      g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.11-test.1');
      g(d, 'checkout', '-q', 'v0.1.0-alpha.11-test.1');
      const r = rn.releaseNotes(d, topts);
      assert.strictEqual(r.commits, rn.TEST_COMMITS_MAX + 2);
      assert.strictEqual(r.notes.split('\n').filter((l) => /^- `[0-9a-f]{12}` step \d+$/.test(l)).length, rn.TEST_COMMITS_MAX, 'the cap');
      assert.ok(r.notes.includes(`- … and 2 more: see the compare link.`) && r.notes.includes(`step ${rn.TEST_COMMITS_MAX + 2}`) && !/ step 2$/m.test(r.notes), 'newest first, the rest counted');
    }
  }
}

// --- spec 008 FR-117..FR-120: the wiring of .github/workflows/release.yml (it only runs on GitHub) ---
{
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n?/g, '\n');
  const jobs = {};
  const body = wf.slice(wf.search(/^jobs:/m));
  const re = /^ {2}([\w-]+):\n([\s\S]*?)(?=^ {2}[\w-]+:\n|(?![\s\S]))/gm;
  for (let m = re.exec(body); m; m = re.exec(body)) jobs[m[1]] = m[2];
  assert.deepStrictEqual(Object.keys(jobs), ['verify', 'build', 'draft-release']);
  assert.match(wf, /^on:\n {2}push:\n {4}tags: \['v\*'\]\n\n/m, 'started by a tag push only');
  assert.match(wf, /^permissions:\n {2}contents: read\n/m, 'read-only by default');
  assert.match(jobs.verify, /^ {4}permissions:\n {6}contents: read\n {4}steps:/m, 'verify: contents read only');
  assert.match(jobs.verify, /persist-credentials: false/, 'verify keeps no token in the checkout');
  assert.match(jobs.verify, /fetch-depth: 0/, 'verify sees main and every tag');
  assert.ok(!/npm ci|secrets\.|GH_TOKEN|github\.token/.test(jobs.verify), 'verify: no dependency install, no secret, no token');
  assert.match(jobs.verify, /node scripts\/release-notes\.js --tag "\$TAG" --repo "\$REPO" --main-ref refs\/remotes\/origin\/main --out release-notes\.md/, 'verify runs the checks on the tagged commit');
  for (const j of ['verify', 'draft-release']) for (const l of jobs[j].split('\n').filter((x) => x.includes('${{'))) assert.match(l, /^ {10}(TAG|REPO|GH_TOKEN|GH_REPO): \$\{\{ github\.[a-z_]+ \}\}$/, `${j}: an expression only as an env value, never inside a run script: ${l.trim()}`);
  assert.ok(!/^ {4}permissions:/m.test(jobs.build) && /^ {4}needs: verify$/m.test(jobs.build), 'build: read-only default, only after verify');
  assert.match(jobs['draft-release'], /^ {4}needs: \[verify, build\]\n {4}permissions:\n {6}contents: write\n {4}steps:/m, 'draft-release alone may write, after both');
  assert.match(jobs['draft-release'], /pattern: agent-durbar-\*/, 'the packages only, not the notes file, become release assets');
  assert.match(jobs['draft-release'], /gh release create "\$TAG" dist-artifacts\/\* --draft --prerelease --latest=false --verify-tag/, 'always a draft pre-release, never latest');
  assert.match(jobs['draft-release'], /--notes-file notes\/release-notes\.md/, 'the notes from verify');
  // spec 008 FR-124: the title comes from verify ("(test build)" for a test tag), through the notes artifact; a missing file stops the job
  assert.match(jobs.verify, /--out release-notes\.md --title-out release-title\.txt /, 'verify writes the title');
  assert.match(jobs.verify, /^ {10}path: \|\n {12}release-notes\.md\n {12}release-title\.txt\n/m, 'the notes artifact carries the title');
  assert.match(jobs['draft-release'], /^ {10}TITLE="\$\(cat notes\/release-title\.txt\)"/m, 'draft-release reads the title first (bash -e)');
  assert.match(jobs['draft-release'], /--verify-tag \\\n {14}--title "\$TITLE" --notes-file/, 'the release is created with that title');
  assert.ok(!/main-ref (?!refs\/remotes\/origin\/main )/.test(wf) && !/-test/.test(jobs['draft-release']), 'one path for both kinds: no tag pattern in the workflow, the script decides');
  assert.match(wf, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/, 'signing unchanged: never looks for identities');
  assert.ok(!/git push|gh pr create|pull-requests:|gh release edit|--publish always/.test(wf), 'nothing pushes, opens a PR or publishes');
  // every checkout keeps no token; inside run scripts only matrix values are interpolated (never the tag or any github.* text)
  const checkouts = [...wf.matchAll(/- uses: actions\/checkout@\S+[^\n]*\n((?: {8}[^\n]*\n)*)/g)];
  assert.strictEqual(checkouts.length, 2, 'verify and build check out');
  for (const [, w] of checkouts) assert.match(w, /^ {10}persist-credentials: false$/m, 'every checkout: persist-credentials false');
  for (const [id, b] of Object.entries(jobs)) {
    for (const m of b.matchAll(/^( +)(?:- )?run: ?([^\n]*)\n((?:\1 {2,}[^\n]*\n|\s*\n)*)/gm)) {
      for (const [, expr] of `${m[2]}\n${m[3]}`.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)) assert.match(expr, /^matrix\.\w+$/, `${id}: only matrix values inside a run script, got \${{ ${expr} }}`);
    }
  }
  assert.match(jobs['draft-release'], /if \[ "\$\(gh release view "\$TAG" --json isDraft -q \.isDraft\)" != "true" \]; then\n[^\n]*\n {14}exit 1\n {12}fi\n {12}gh release upload "\$TAG" dist-artifacts\/\* --clobber/, 'files are replaced only on a draft, a published release is refused');
  for (const [, u] of wf.matchAll(/uses: (\S+)/g)) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${u} pinned by commit sha`);
}

console.log('test-changelog: ok');
