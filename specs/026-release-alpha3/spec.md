# Feature Specification: Release v0.1.0-alpha.3 (published pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 026
title: Release v0.1.0-alpha.3 (version bump, changelog, download notes)
status: built; **published as a pre-release** by the maintainer (2026-10-17); alpha.2 draft removed
-->

**Feature Branch**: `026-release-alpha3`
**Created**: 2026-10-17
**Status**: Built and **published as a pre-release by the maintainer on 2026-10-17** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.3>). Release engineering only: a version bump, a changelog section and README download notes. No behavior change (the only `src/` edit is the simulator's displayed version string).
**Input**: Vikram approved cutting `v0.1.0-alpha.3` as a **draft pre-release** (2026-10-17); the agent did not publish it (AGENTS.md "Needs approval", spec 008 FR-008). Vikram then reviewed and published it himself as a **pre-release** the same day, and deleted the superseded `v0.1.0-alpha.2` draft (never published; its git tag remains; `v0.1.0-alpha.1` is still an unpublished draft).

## Requirements

- **FR-001** `[IMPLEMENTED]` `package.json` and `package-lock.json` carry version `0.1.0-alpha.3`. The release workflow refuses a tag that does not match it (`v0.1.0-alpha.3`).
- **FR-002** `[IMPLEMENTED]` `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.3` section: permission modes Read-only / Ask first / Allow all (PR #15), office and per-folder usage totals (PR #17), Windows grant-scope tests (PR #16), docs sync (PR #22). The README "Install from releases" section says what changed for people installing it.
- **FR-003** `[IMPLEMENTED]` Tag `v0.1.0-alpha.3` on the merge commit of this branch's PR triggers `.github/workflows/release.yml` (spec 008): macOS arm64 and x64 dmg (plus zips), Windows installer and portable, Linux AppImage, `SHA256SUMS.txt`, attached to a **draft pre-release** by the workflow; the maintainer published it by hand. `[IMPLEMENTED]`

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 is still a draft that needs approval, because certificates cost money). macOS needs right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has ever been run by hand. The macOS and Windows packages are built by CI and are **untested on real Macs and Windows PCs** (`read:`).
- `[KNOWN GAP]` Windows grant keys are not yet compared case-insensitively (spec 003 T028).
- `[KNOWN GAP]` An in-place upgrade from alpha.2 (same app id) was not checked on any machine.
- No auto-update.
