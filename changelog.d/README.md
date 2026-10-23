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

At release time the release PR runs

```bash
npm run changelog:build -- --release "v0.1.0-alpha.N ([pre-release](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.N), YYYY-MM-DD)"
```

which writes a new section under *Unreleased* with every fragment (by file name), then any bullet still under *Unreleased*, and
deletes the fragments. The release manager then adds the release's intro paragraph as before.

**Fragments that land after the release PR was written** (spec 008 FR-117, a stopgap until the release workflow folds at tag
time): a release PR (one that changes `"version"` in `package.json`) fails the required check *Build and test (ubuntu-latest)*,
and `scripts/pr-gate.sh`, when its merge with current `main` still holds a fragment. Merge `main` into the release branch, add
the new fragments to the release section you already wrote, and push:

```bash
npm run changelog:build -- --release "<the same heading>" --amend   # appends them to the newest section; your intro paragraph stays
```

`--amend` only adds to the section right under *Unreleased* (the one this release PR wrote), never to a released one. Check it
yourself before you push:

```bash
# HEAD^1 against HEAD (on a merge commit, as CI does)
npm run changelog:check -- --release
# your branch merged into current main, as a tree: nothing is checked out (git 2.38+)
git fetch origin main && npm run changelog:check -- --release --base origin/main --head "$(git merge-tree --write-tree origin/main HEAD)"
```
