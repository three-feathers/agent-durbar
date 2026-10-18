# Tasks: Release v0.1.0-alpha.5

- [x] T001 Verify CI on `main` is green before branching. [FR-001]
- [x] T002 Bump version to `0.1.0-alpha.5` (package.json, package-lock.json, simulator label). [FR-001]
- [x] T003 `CHANGELOG.md` section, README and CONTRIBUTING notes, specs index. [FR-002]
- [x] T004 Merge the pull request (admin), tag `v0.1.0-alpha.5`, wait for `release.yml`. [FR-003] (PR #164; tag on `995947d`; run 39162411638 succeeded)
- [x] T005 Check the draft: prerelease flag, eight assets, `SHA256SUMS.txt`; set the notes. [FR-003] (2026-10-18; portable exe and AppImage checksums verified)
- [x] T006 Publish as a pre-release, verify, then a docs PR that says "published". [FR-003] (published 2026-10-18; this PR)
