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

A follow-up PR on the same branch edits its own file. `npm run changelog:preview` prints what the next release will list.

## At release time: fold at tag time (spec 008 FR-117..FR-120)

No release PR folds the notes before the tag any more (its notes went stale while the merge queue kept landing fragments), and
no merge freeze is needed:

1. A **version-only PR** sets the new version (`package.json`, `package-lock.json`, the simulator's About label).
2. The release manager **tags a commit on `main`**. `release.yml`'s `verify` job checks the tag (on `main`, equal to
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
   # the first STABLE release (spec 050 FR-013): also change docs/site/landing.json: hero.eyebrow ("early alpha") and status ("Alpha · unsigned …"), they are hand-written and checked against the README status block
   git merge origin/main   # fragments that landed after the tag come back for the next release
   ```

Branch names must match the Spec Kit gate (lowercase letters, digits and hyphens, `NNN-slug`; no dots), so use `NNN-fold-alpha-N` rather than the tag's dots. A dotted name fails CI.

   `changelog:build` writes a new section under *Unreleased* with every fragment (by file name), then any bullet still under
   *Unreleased*, and deletes the fragments. The PR goes through the queue like any other; the workflow never pushes to `main`
   or opens it. Merge it before the next tag: `verify` refuses a tag while the previous release has no section.

   A fragment edited on `main` after the tag gives a **modify/delete conflict** in `git merge origin/main`. Keep the deletion
   (`git rm changelog.d/<file>`): the tag's text is what was released. If the edit added something genuinely new, put that in
   a new fragment for the next release.

## Test builds (spec 008 FR-121..FR-124)

A test-build tag (`vX.Y.Z[-alpha|beta|rc.N]-test.M`, allowed on a branch) does not use the fragments at all: its notes list the
branch's commits that are not on `main`, nothing is folded, and its fragments stay where they are until the branch merges and a
real release folds them. Steps in [docs/collaboration.md](../docs/collaboration.md).
