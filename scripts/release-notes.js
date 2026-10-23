#!/usr/bin/env node
/*
 * Spec 008 FR-117..FR-120 (2026-10-23): fold at tag time. The release workflow (`.github/workflows/release.yml`, job `verify`)
 * runs this on exactly the tagged commit, before anything is built:
 *
 *   node scripts/release-notes.js --tag v0.1.0-alpha.N --repo owner/name --out release-notes.md [--main-ref refs/remotes/origin/main] [--summary <file>]
 *
 * It refuses the tag unless: the name is a version (`v1.2.3` or `v1.2.3-pre.N`), it equals `v` + package.json's version, the
 * checked-out commit is the tag's commit, that commit is an ancestor of the main ref (only tags on main are released; a full
 * `refs/...` name, so a tag called `origin/main` cannot stand in for the branch), and the
 * newest earlier release tag already has its section in CHANGELOG.md (its fold PR merged). Then it writes the release notes
 * (the fixed unsigned-build paragraph and the section `changelog:build` would fold, from the tag's own changelog.d/) to --out,
 * prints the heading, and appends the fold PR's commands to --summary (the job summary). It changes no tracked file, needs no
 * token and no network: git is called without a shell (execFileSync with an argument list), so it runs the same on Windows.
 * These checks catch mistakes, not a hostile writer: the tag push runs the tagged commit's own copy of this file (spec 008
 * FR-118 `[KNOWN GAP]`; a `v*` tag ruleset is the real control).
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cl = require('./changelog.js');

const ROOT = path.join(__dirname, '..');
const TAG_RE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
// the tags whose sections CHANGELOG.md keeps; test builds such as v0.1.0-alpha.14-mcptest.1 or -theme.2 have none
const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PREAMBLE =
  'Unsigned alpha build of Agent Durbar. Not code-signed or notarized: see the README for the macOS Gatekeeper and Windows SmartScreen steps. ' +
  'Requires GitHub Copilot (copilot login). Independent project, not affiliated with GitHub or Microsoft.';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitOk(root, args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/*
 * The newest release tag reachable from the parent of `commit` (the release before this one), or '' when there is none.
 * versionsort.suffix=- sorts v0.1.0 above v0.1.0-alpha.N (without it git puts the final release below its pre-releases).
 */
function previousRelease(root, commit, tag) {
  if (!gitOk(root, ['rev-parse', '--verify', '--quiet', `${commit}^`])) return '';
  const list = git(root, ['-c', 'versionsort.suffix=-', 'tag', '--merged', `${commit}^`, '--list', 'v*', '--sort=-v:refname']).split('\n');
  return list.map((t) => t.trim()).find((t) => t && t !== tag && RELEASE_TAG_RE.test(t)) || '';
}

/* Every check, then the notes. Returns { heading, previous, notes, source }; throws with the reason on a refusal. */
const MAIN_REF = 'refs/remotes/origin/main';

function releaseNotes(root, { tag, repo, mainRef = MAIN_REF }) {
  // a short name such as origin/main resolves to refs/tags/origin/main first when such a tag exists (fetch-depth 0 fetches tags)
  if (!/^refs\/[A-Za-z0-9_./-]+$/.test(mainRef) || /\.\./.test(mainRef)) throw new Error(`the main ref must be a full ref name (refs/...): got "${mainRef}"`);
  if (!tag || !TAG_RE.test(tag)) throw new Error(`"${tag}" is not a release tag (v1.2.3 or v1.2.3-alpha.N)`);
  if (!repo || !REPO_RE.test(repo)) throw new Error(`"${repo}" is not an owner/name repository`);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (tag !== `v${version}`) throw new Error(`tag ${tag} does not match package.json version v${version}: land the version PR first`);
  if (!gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])) throw new Error(`no tag ${tag} in this checkout`);
  const commit = git(root, ['rev-parse', `refs/tags/${tag}^{commit}`]);
  if (git(root, ['rev-parse', 'HEAD^{commit}']) !== commit) throw new Error(`the checked-out commit is not ${tag}'s commit ${commit}`);
  if (!gitOk(root, ['show-ref', '--verify', '--quiet', mainRef])) throw new Error(`no ${mainRef} in this checkout (fetch every branch: fetch-depth 0)`);
  if (!gitOk(root, ['merge-base', '--is-ancestor', commit, mainRef])) throw new Error(`${tag} (${commit}) is not on ${mainRef}: only commits on main are released`);
  const previous = previousRelease(root, commit, tag);
  const date = git(root, ['for-each-ref', '--format=%(creatordate:short)', `refs/tags/${tag}`]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`could not read the date of ${tag}`);
  const heading = `${tag} ([pre-release](https://github.com/${repo}/releases/tag/${tag}), ${date})`;
  const { section, source } = cl.notes(root, { release: heading, previous });
  return { heading, previous, source, notes: `${PREAMBLE}\n\n${section}\n` };
}

/* The job summary: what was checked and the fold PR's commands with the exact heading (changelog.d/README.md). */
function summary({ heading, previous, source }, tag) {
  const fold = source === 'fragments'
    ? [
        'Fold PR (a normal pull request through the queue; nothing pushes to `main`), from the tag so later fragments stay for the next release:',
        '',
        '```bash',
        `git fetch origin --tags && git switch -c <NNN>-fold-${tag.slice(1)} ${tag}`,
        `npm run changelog:build -- --release "${heading}"`,
        'git merge origin/main   # the fragments merged after the tag come back for the next release',
        '# a modify/delete conflict on a fragment edited after the tag: keep the deletion (git rm it), new text goes in a new fragment',
        '```',
      ]
    : ['The section was already in `CHANGELOG.md` (folded by a release PR): no fold PR needed.'];
  return [
    `### Release notes for ${tag}`,
    '',
    `- Heading: \`${heading}\``,
    `- Previous release: ${previous ? `\`${previous}\` (its section is in CHANGELOG.md)` : 'none found'}`,
    `- Notes from: ${source === 'fragments' ? 'the tag\'s `changelog.d/` fragments' : 'its existing `CHANGELOG.md` section'}`,
    '',
    ...fold,
    '',
  ].join('\n');
}

module.exports = { MAIN_REF, TAG_RE, RELEASE_TAG_RE, PREAMBLE, previousRelease, releaseNotes, summary };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const tag = opt('--tag');
    const out = opt('--out');
    if (!out) throw new Error('give --out <file> for the notes');
    const root = opt('--root') ? path.resolve(opt('--root')) : ROOT;
    const r = releaseNotes(root, { tag, repo: opt('--repo'), mainRef: opt('--main-ref') || MAIN_REF });
    fs.writeFileSync(out, r.notes);
    if (opt('--summary')) fs.appendFileSync(opt('--summary'), summary(r, tag));
    console.log(r.heading);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
