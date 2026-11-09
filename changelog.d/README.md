# changelog.d: one file per change

Pull requests do **not** edit `CHANGELOG.md`'s *Unreleased* section any more (spec 025, delta 2026-10-22): every PR there clashed
with every other. Instead, add one small file here, named after your branch, for example `changelog.d/063-folder-status.md`:

```markdown
- **Folder status in the chat** (spec 063): the folder chip shows the git branch and how many files changed; a click lists the changed files. Read-only.
```

Rules (checked by `npm run changelog:check`, part of `npm test`):

- one or more Markdown bullets (`- ...`), written like a CHANGELOG line: what changed for the user, the spec, how it was checked;
  an indented line under a bullet continues it; no headings, no HTML comments;
- the file name is lower case: letters, digits, `.`, `_`, `-`, ending in `.md` (use your branch name);
- the same entry may not be in another fragment or already in `CHANGELOG.md`.
- optional, at the end of the fragment (spec 008 FR-173): `  Highlight: <one line>` puts the change in the release's
  five-line *Highlights* block (its bold name and one short clause, at most 100 characters, no spec numbers; plain text only:
  letters, digits, spaces, `. , ; : ' - / + % ?` and `**bold**`, so no link, mention, `#` reference, code or HTML), and
  `  Scene: <id>` shows it in the release clip (`node scripts/release-video.js --list` names the scenes). Both are indented,
  one of each at most, after the last bullet; the fold drops them from the text. Most fragments have neither:

  ```markdown
  - **Monster Crew** (spec 077 FR-075): a fourth crew in Settings, Characters ...
    Highlight: **Four new character crews**: Pirate, Monster, Royal and Animal Rebels, in Settings, Characters.
    Scene: crews
  ```

A follow-up PR on the same branch edits its own file. `npm run changelog:preview` prints what the next release will list.

## At release time: fold at tag time (spec 008 FR-117..FR-120)

No release PR folds the notes before the tag any more (its notes went stale while the merge queue kept landing fragments), and
no merge freeze is needed:

0. **No spec folder per release** (spec 021 FR-063): a release adds one row to the *Release table* in [spec 008](../specs/008-packaging-and-release/spec.md#release-table) (tag, date, release link, one-line notes, corrective Yes/No/Unknown), in the version PR or the fold PR.
1. A **version-only PR** sets the new version (`package.json` and `package-lock.json` only: the simulator's About label reads `package.json` at build time, spec 008 FR-179).
2. The release manager **tags a commit on `main`** (annotated; the daily stable release needs no owner OK, spec 021 FR-064; any other tag does). `release.yml`'s `verify` job checks the tag (on `main`, equal to
   `package.json`, the previous release already folded) and writes the draft's notes from exactly that commit's fragments:
   `node scripts/changelog.js build --release "<heading>" --stdout` prints the same section and edits nothing.
   Before you tag, classify the release for the DORA records (AGENTS.md, *Bug and deployment incident triage*): list the
   incidents with `gh issue list --label incident --state all`, decide whether this release is an unplanned corrective
   response to one (`Yes`), an ordinary planned release (`No`) or unclear (`Unknown`), and once it is published record the
   tag on each incident issue. A `-test.M` test build is not a deployment for DORA.
3. A **doc-only fold PR**, from the tag, with the heading from the run's job summary:

   ```bash
   git fetch origin --tags && git switch -c NNN-fold-alpha-N v0.1.0-alpha.N
   npm run changelog:build -- --release "v0.1.0-alpha.N ([pre-release](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.N), YYYY-MM-DD)"
   # add the release's intro paragraph and the README status block, commit
   # the first STABLE release (spec 050 FR-013): also change docs/site/landing.json: hero.eyebrow ("early alpha") and status ("Alpha · unsigned …"), they are hand-written and checked against the README status block (test:site only checks that the page shows what landing.json says)
   git merge origin/main   # fragments that landed after the tag come back for the next release
   ```

Branch names must match the Spec Kit gate (lowercase letters, digits and hyphens, `NNN-slug`; no dots), so use `NNN-fold-alpha-N` rather than the tag's dots. A dotted name fails CI.

   `changelog:build` writes a new section under *Unreleased* with every fragment (by file name), then any bullet still under
   *Unreleased*, and deletes the fragments. The PR goes through the queue like any other; the workflow never pushes to `main`
   or opens it. Merge it before the next tag: `verify` refuses a tag while the previous release has no section.

   A fragment edited on `main` after the tag gives a **modify/delete conflict** in `git merge origin/main`. Keep the deletion
   (`git rm changelog.d/<file>`): the tag's text is what was released. If the edit added something genuinely new, put that in
   a new fragment for the next release.

4. **The release clip** (spec 008 FR-174, FR-175; a stable or pre-release tag, never a `-test.M` build), after `release.yml` has made the draft and before you publish. It never holds a release.
   Not added to older releases.
   1. Record, on a checkout of the tag (needs ffmpeg; about 2 minutes; no AI credits): `npm run release:video -- --version <tag> --out <dir>`.
      Without `--scenes` the clip shows the scenes the release's fragments name (`Scene:` fields, and the scenes whose `refs` a bullet's spec and FR numbers match; spec 008 FR-183). If it says no scene shows the release, pick with `--scenes <ids>` (`--list`), and add a scene or a `refs` entry afterwards.
   2. Look at the stills in `<dir>` (FR-176: simulator data only, no path, name, token or chat text; captions in the band, nothing broken).
   3. Upload to the draft: `gh release upload <tag> <dir>/release-<tag>.mp4 <dir>/release-<tag>.gif`.
   4. Add the image line at the very top of the draft's notes (the Highlights block is already in them, built from the fragments' `Highlight:` fields by `scripts/release-notes.js`):
      `[![<tag> in <N> seconds](https://github.com/three-feathers/agent-durbar/releases/download/<tag>/release-<tag>.gif)](https://github.com/three-feathers/agent-durbar/releases/download/<tag>/release-<tag>.mp4)`
   5. On any failure (no ffmpeg, a check or size refused, the upload failed) publish **without** the image line, keep the Highlights block, and say so in the team chat.
   6. After publishing the first release with a clip, open its page and check the GIF renders inline and the MP4 link works; else use the fallback in FR-174 (T124).
   The site gets the clip later through spec 104; no YouTube.
5. Check the draft, then publish it by hand as a **pre-release**, not *latest* (a stable tag: next section).

- In the doc-only fold PR (from 2026-11-07, spec 008 FR-181, owner request): `npm run usage:readme -- --release vX.Y.Z --publish` with your machine's `usage-*.json` in `~/.durbar-usage` (or `--files`): it copies it into `docs/build-cost/data/` and builds from **all machines' files, refreshed at each release** (every team machine runs the same receiver and publishes its `docs/build-cost/data/usage-<machine>.json` the same way). It rewrites the README's *Build cost so far* block, appends the release's row to `docs/build-cost-history.json` and regenerates `docs/build-cost-badge.svg`, `docs/build-cost.svg` and `docs/build-cost-days.svg` (estimated days faded); commit those files and the data file. Method: [docs/build-cost.md](../docs/build-cost.md).

## A stable release (spec 008 FR-129)

A tag without a `-` (`v1.2.3`) is handled by the same flow with these differences, all decided by `releaseKind()` in
`scripts/release-notes.js` and passed to the workflow as `verify`'s outputs:

- The draft is **not** a pre-release. A tag with a `-` (alpha, beta, rc, `-test.M`) stays a draft pre-release, never latest.
- The notes use the stable intro (unsigned and not notarized, no "alpha") and the heading
  `v1.2.3 ([release](<url>), YYYY-MM-DD)`; `changelog:build --release` accepts it.
- The fold branch is `NNN-fold-1-2-3` (no dots).
- It stays a **draft**: the release manager checks it (all assets, `SHA256SUMS.txt`, the notes), then publishes it **and marks it latest**. "Latest" is not set while it is a
  draft, so run (the job summary prints it too): `gh release edit v1.2.3 --draft=false --latest`. It ran on GitHub for
  `v0.1.0` (2026-10-26); check the published release shows as *Latest*.
- The fold PR for a stable tag also updates the hand-written alpha wording that tests assert: the landing page eyebrow and
  status in `docs/site/landing.json` with their asserts in `scripts/test-site.js`, and the README status block.

- Optional: add the day's *Build cost* table (`npm run usage:day -- --date YYYY-MM-DD`, an API list-price estimate, not billing) to the notes; setup and privacy in [docs/build-cost.md](../docs/build-cost.md).

## Test builds (spec 008 FR-121..FR-124)

A test-build tag (`vX.Y.Z[-alpha|beta|rc.N]-test.M`, allowed on a branch) does not use the fragments at all: its notes list the
branch's commits that are not on `main`, nothing is folded, and its fragments stay where they are until the branch merges and a
real release folds them. Use one, for example, to try unmerged fixes on a real Mac; an owner's OK first, like any tag (AGENTS.md, *Needs approval*).

1. On the branch, keep `package.json`'s version (say `0.1.0-alpha.15`) and tag the commit `v0.1.0-alpha.15-test.1` (annotated;
   the next try is `-test.2`). The exact pattern is `vX.Y.Z[-alpha|beta|rc.N]-test.M`, and the version must be the tag without
   `-test.M`. Old names such as `-mcptest.1` are not test tags and are refused off `main`.
2. `release.yml` builds it into a **draft pre-release, never latest**, titled `Agent Durbar <tag> (test build)`. Its notes list
   the branch's commits not on `main` (subject lines only, masked and shown as code, at most 100) and the PRs they name, with a
   compare link. No fold PR, no `CHANGELOG.md` or README change; a test tag is never the "previous release" of a real one.
3. Share the draft with the tester; delete the draft and the tag when done. If you publish it, keep it a pre-release, not
   *latest*. Regular tags (no `-test.M`) must still be on `main`.

Dry run before you push the tag: `node scripts/release-notes.js --tag <tag> --repo three-feathers/agent-durbar --out ../notes.md --title-out ../title.txt`
on a checkout of the tag with `origin/main` fetched (Node 22.18 or later, for the masking).
