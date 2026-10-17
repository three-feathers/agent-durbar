# Tasks: Release v0.1.0-alpha.3

- [x] T001 Verify CI on `main` is green before branching. [FR-001]
- [x] T002 Bump version to `0.1.0-alpha.3` (package.json, package-lock.json, simulator label). [FR-001]
- [x] T003 `CHANGELOG.md` section, README and CONTRIBUTING notes, specs index. [FR-002]
- [x] T004 Merge the pull request (admin), tag `v0.1.0-alpha.3`, wait for `release.yml`. [FR-003] (PR #23; tag on `ee0aece`; Release workflow succeeded)
- [x] T005 Check the draft: prerelease flag, assets, `SHA256SUMS.txt`; set the notes from the changelog. Leave it a draft. [FR-003] (checked 2026-10-17: draft, prerelease, 7 packages + `SHA256SUMS.txt`)
- [x] T006 (maintainer) Review the draft and publish by hand. Done by Vikram on 2026-10-17: published as a **pre-release**; the superseded alpha.2 draft was deleted by him (tag kept). Not done by the agent.
