/*
 * Spec 025 delta 2026-10-22 (`npm run test:changelog`, part of `npm test`): CHANGELOG fragments. Fragment parsing, the checks
 * (format, names, duplicates, the Unreleased transition and cut-over), the release fold (order, deletion, rest of the file
 * untouched, idempotence, refusals, one section per version), all in throwaway folders. The real repository is checked by
 * `node scripts/changelog.js check`, the suite's second step.
 * Spec 008 FR-117..FR-120 (fold at tag time): `notes` / `build --stdout`, `scripts/release-notes.js` on throwaway git repositories
 * (tag on main, version, previous release folded, the checked-out commit), and the wiring of `.github/workflows/release.yml`.
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
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_AUTHOR_DATE: '2026-10-23T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-23T10:00:00Z' };
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
  const opts = { tag: 'v0.1.0-alpha.11', repo: 'three-feathers/agent-durbar', mainRef: 'main' };
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
    execFileSync(process.execPath, [path.join(__dirname, 'release-notes.js'), '--root', d, '--tag', opts.tag, '--repo', opts.repo, '--main-ref', 'main', '--out', out, '--summary', sumFile], { env: gitEnv, stdio: 'ignore' });
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
    assert.throws(() => rn.releaseNotes(d, opts), /is not on main: only commits on main are released/);
    assert.throws(() => rn.releaseNotes(d, { ...opts, mainRef: 'origin/main' }), /no origin\/main in this checkout/, 'a missing main ref fails, it is not skipped');
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
    // a test build tag (no section by design) in between is not taken for the previous release
    g(d, 'tag', '-a', '-m', 'test', 'v0.1.0-alpha.12-mcptest.1', 'v0.1.0-alpha.11');
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
  assert.match(jobs.verify, /node scripts\/release-notes\.js --tag "\$TAG" --repo "\$REPO" --main-ref origin\/main --out release-notes\.md/, 'verify runs the checks on the tagged commit');
  for (const j of ['verify', 'draft-release']) for (const l of jobs[j].split('\n').filter((x) => x.includes('${{'))) assert.match(l, /^ {10}(TAG|REPO|GH_TOKEN|GH_REPO): \$\{\{ github\.[a-z_]+ \}\}$/, `${j}: an expression only as an env value, never inside a run script: ${l.trim()}`);
  assert.ok(!/^ {4}permissions:/m.test(jobs.build) && /^ {4}needs: verify$/m.test(jobs.build), 'build: read-only default, only after verify');
  assert.match(jobs['draft-release'], /^ {4}needs: \[verify, build\]\n {4}permissions:\n {6}contents: write\n {4}steps:/m, 'draft-release alone may write, after both');
  assert.match(jobs['draft-release'], /pattern: agent-durbar-\*/, 'the packages only, not the notes file, become release assets');
  assert.match(jobs['draft-release'], /gh release create "\$TAG" dist-artifacts\/\* --draft --prerelease --latest=false --verify-tag/, 'always a draft pre-release, never latest');
  assert.match(jobs['draft-release'], /--notes-file notes\/release-notes\.md/, 'the notes from verify');
  assert.match(wf, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/, 'signing unchanged: never looks for identities');
  assert.ok(!/git push|gh pr create|pull-requests:|gh release edit|--publish always/.test(wf), 'nothing pushes, opens a PR or publishes');
  for (const [, u] of wf.matchAll(/uses: (\S+)/g)) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${u} pinned by commit sha`);
}

console.log('test-changelog: ok');
