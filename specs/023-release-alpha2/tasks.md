# Tasks: Release v0.1.0-alpha.2

- [x] T001 Verify CI on `main` is green before branching. [FR-001]
- [x] T002 Bump version to `0.1.0-alpha.2` (package.json, package-lock.json, simulator label). [FR-001]
- [x] T003 `CHANGELOG.md` and README download notes. [FR-002]
- [x] T004 Merge the pull request (admin), tag `v0.1.0-alpha.2`, wait for `release.yml`. [FR-003] (PR #14; tag on `ad680ed`)
- [x] T005 Check the draft: prerelease flag, assets, `SHA256SUMS.txt`; set the notes from the changelog. Leave it a draft. [FR-003] (re-checked 2026-10-17: draft, prerelease, 7 packages + `SHA256SUMS.txt`)
- [x] T006 (maintainer) Not published. On 2026-10-17 Vikram deleted this draft in favour of `v0.1.0-alpha.3` (spec 026); the git tag `v0.1.0-alpha.2` remains.
