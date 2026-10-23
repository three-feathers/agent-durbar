/*
 * Spec 025 delta 2026-10-22 (`npm run test:changelog`, part of `npm test`): CHANGELOG fragments. Fragment parsing, the checks
 * (format, names, duplicates, the Unreleased transition and cut-over), the release fold (order, deletion, rest of the file
 * untouched, idempotence, refusals, one section per version), all in throwaway folders. The real repository is checked by
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

// --- spec 008 FR-117: build --amend adds fragments that landed after the release PR folded to that release's section ---
{
  const d = repo('', { 'a.md': '- A.\n' });
  const H = 'v9.0.0 ([pre-release](https://example.invalid/v9), 2026-10-23)';
  cl.build(d, { release: H });
  // the release manager writes the intro paragraph; then a fragment lands on main and the release branch merges it
  fs.writeFileSync(path.join(d, 'CHANGELOG.md'), read(d).replace(`## ${H}\n\n`, `## ${H}\n\nIntro for v9.\n\n`));
  fs.writeFileSync(path.join(d, 'changelog.d', 'b.md'), '- B.\n  more B.\n');
  assert.throws(() => cl.build(d, { release: H }), /--amend/, 'a second fold of the same version points to --amend');
  const r = cl.build(d, { release: H, amend: true });
  assert.deepStrictEqual(r.removed, [path.join('changelog.d', 'b.md')]);
  const txt = read(d);
  assert.ok(txt.includes(`## ${H}\n\nIntro for v9.\n\n- A.\n- B.\n  more B.\n\n## v0.1.0-alpha.10`), `appended to the v9 section, intro kept:\n${txt}`);
  assert.strictEqual(txt.split(`## ${H}`).length, 2, 'still one v9 section');
  assert.ok(txt.endsWith(RELEASED), 'released sections untouched');
  assert.strictEqual(fs.existsSync(path.join(d, 'changelog.d', 'b.md')), false);
  assert.deepStrictEqual(cl.check(d).errors, [], 'the amended file passes check');
  // never into a released section further down, never without a section
  fs.writeFileSync(path.join(d, 'changelog.d', 'c.md'), '- C.\n');
  assert.throws(() => cl.build(d, { release: 'v0.1.0-alpha.10 (x)', amend: true }), /only adds to the newest section/, 'a released section is never amended');
  assert.throws(() => cl.build(d, { release: 'v9.9.9 (x)', amend: true }), /no section for v9\.9\.9/, '--amend without a section refuses');
  assert.ok(fs.existsSync(path.join(d, 'changelog.d', 'c.md')), 'refusals change nothing');
}
{
  // a section that ends with prose gets a blank line before the added list
  const d = repo('', { 'a.md': '- A.\n' });
  cl.build(d, { release: 'v9.0.0 (x)' });
  fs.writeFileSync(path.join(d, 'CHANGELOG.md'), read(d).replace('- A.\n', '- A.\n\nA closing note.\n'));
  fs.writeFileSync(path.join(d, 'changelog.d', 'b.md'), '- B.\n');
  cl.build(d, { release: 'v9.0.0 (x)', amend: true });
  assert.ok(read(d).includes('A closing note.\n\n- B.\n\n## v0.1.0-alpha.10'), read(d));
}
{
  // the CLI passes --amend through
  const { execFileSync } = require('child_process');
  const d = repo('', { 'a.md': '- A.\n' });
  const cli = (...a) => execFileSync(process.execPath, [path.join(__dirname, 'changelog.js'), 'build', '--root', d, '--release', 'v9.0.0 (x)', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  cli();
  fs.writeFileSync(path.join(d, 'changelog.d', 'b.md'), '- B.\n');
  assert.throws(() => cli(), /--amend/, 'CLI without --amend refuses a second fold');
  assert.match(cli('--amend'), /removed 1 fragment/);
  assert.ok(read(d).includes('- A.\n- B.\n'), 'CLI --amend appended');
}

// --- spec 008 FR-117: a release that lands leaves no fragment unfolded (check --release) ---
{
  const v = (baseVersion, headVersion, fragments) => cl.releaseVerdict({ baseVersion, headVersion, fragments });
  assert.deepStrictEqual(v('1.0.0', '1.0.0', ['a.md']), { release: false, baseVersion: '1.0.0', headVersion: '1.0.0', unfolded: [], ok: true }, 'same version: not a release, fragments are fine');
  assert.deepStrictEqual(v('1.0.0', '1.0.1', ['README.md', '.gitkeep']), { release: true, baseVersion: '1.0.0', headVersion: '1.0.1', unfolded: [], ok: true }, 'release with only README/.gitkeep left passes');
  const r = v('1.0.0', '1.0.1', ['z.md', 'README.md', 'a.md']);
  assert.strictEqual(r.ok, false, 'release with a leftover fragment fails');
  assert.deepStrictEqual(r.unfolded, ['a.md', 'z.md'], 'every leftover named, sorted, README excluded');
}
{
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-relcheck-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  const pkg = (version) => put('package.json', JSON.stringify({ name: 'x', version }) + '\n');
  const commit = (m) => { git('add', '-A'); git('commit', '-q', '-m', m); return git('rev-parse', 'HEAD'); };
  const run = (base, head) => cl.releaseCheck(dir, { base, head });
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main'); // not "init -b": git before 2.28
  pkg('1.0.0'); put('changelog.d/README.md', '# readme\n'); put('CHANGELOG.md', '# c\n');
  const c0 = commit('base');
  // a feature lands a fragment on main
  put('changelog.d/feat-a.md', '- A.\n');
  const mainA = commit('feat a');
  // the release branch was cut from c0: bumps the version and folds what it saw (nothing then)
  git('checkout', '-q', '-b', 'rel', c0);
  pkg('1.0.1');
  const rel = commit('release');
  assert.strictEqual(run(c0, rel).ok, true, 'release on its own base: nothing to fold');
  assert.strictEqual(run(c0, rel).release, true);
  // the merge with current main (what CI's merge ref and the queue entry are): feat-a would stay unfolded
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', 'rel');
  const merged = git('rev-parse', 'HEAD');
  let m = cl.releaseCheck(dir, {}); // defaults HEAD^1 / HEAD, as in ci.yml
  assert.deepStrictEqual([m.release, m.ok, m.unfolded], [true, false, ['feat-a.md']], 'merge ref with a fragment that landed after the release notes fails');
  assert.deepStrictEqual(run(mainA, merged).unfolded, ['feat-a.md']);
  // the same through a tree from merge-tree (what pr-gate.sh builds, nothing checked out)
  // (merge-tree --write-tree needs git 2.38+: CI has it; an older local git skips only this case)
  let tree = null;
  try { tree = git('merge-tree', '--write-tree', mainA, rel); } catch { console.log('test-changelog: git < 2.38, merge-tree case skipped'); }
  if (tree) assert.deepStrictEqual(run(mainA, tree).unfolded, ['feat-a.md'], 'a merge-tree tree id works as --head');
  // the release author merges main and folds again: the fragment is gone, the check passes
  fs.unlinkSync(path.join(dir, 'changelog.d/feat-a.md'));
  const fixed = commit('fold again');
  assert.strictEqual(run(mainA, fixed).ok, true, 'refolded release passes');
  // a feature PR (no version change) with a fragment is not a release
  put('changelog.d/feat-b.md', '- B.\n');
  const feat = commit('feat b');
  assert.deepStrictEqual([run(fixed, feat).release, run(fixed, feat).ok], [false, true], 'a feature merge is not a release');
  // no changelog.d at all in the head: a release passes (nothing left)
  git('rm', '-q', '-r', 'changelog.d'); pkg('1.0.2');
  assert.strictEqual(run(feat, commit('no folder')).ok, true, 'missing changelog.d means no fragment');
  // fail closed: bad or unreadable revisions throw, never pass
  for (const bad of ['--output=/tmp/x', '-h', 'HEAD:package.json', 'a b', '', 'HEAD;rm']) assert.throws(() => run(bad, 'HEAD'), /not a git revision/, `refuses ${JSON.stringify(bad)} as base`);
  assert.throws(() => run('HEAD', '--exec=x'), /not a git revision/, 'refuses an option as head');
  assert.throws(() => run('HEAD', 'deadbeefdeadbeef'), /cannot read package\.json at deadbeef/, 'unknown head revision fails');
  assert.throws(() => run('deadbeefdeadbeef', 'HEAD'), /cannot read package\.json/, 'unknown base revision fails');
  put('package.json', '{"name":"x"}\n');
  const nov = commit('no version');
  assert.throws(() => run(feat, nov), /no "version"/, 'a package.json without version fails');
  // CLI: exit codes and messages
  const cli = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(__dirname, 'changelog.js'), ...a, '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  let c = cli('check', '--release', '--base', mainA, '--head', merged);
  assert.strictEqual(c.code, 1, 'CLI fails a stale release');
  assert.match(c.out, /feat-a\.md/);
  assert.match(c.out, /changelog:build/);
  c = cli('check', '--release', '--base', mainA, '--head', fixed);
  assert.strictEqual(c.code, 0, `CLI passes a refolded release: ${c.out}`);
  c = cli('check', '--release', '--base', fixed, '--head', feat);
  assert.strictEqual(c.code, 0);
  assert.match(c.out, /not a release/);
  c = cli('check', '--release', '--base', '-x', '--head', feat);
  assert.strictEqual(c.code, 1, 'CLI refuses an option-like revision');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('test-changelog: ok');
