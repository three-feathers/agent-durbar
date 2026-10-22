# Feature Specification: Release v0.1.0-alpha.2 (draft pre-release)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 023
title: Release v0.1.0-alpha.2 as a draft pre-release (version bump, changelog, download notes)
status: built; draft was removed, never published (superseded by 026)
-->

**Feature Branch**: `023-release-alpha2`
**Created**: 2026-10-16
**Status**: Built in this feature. Release engineering only: a version bump, a changelog and README download notes. No behavior change (the only `src/` edit is the simulator's displayed version string).
**Update 2026-10-17**: alpha.2 was never published. Its draft release was deleted in favour of `v0.1.0-alpha.3` ([spec 026](../026-release-alpha3/spec.md)); the git tag remains.
**Input**: Vikram approved cutting `v0.1.0-alpha.2` as a **draft pre-release** (2026-10-16). It is **not published**: publishing needs his explicit yes (AGENTS.md "Needs approval", spec 008 FR-008).

## Requirements

- **FR-001** `[IMPLEMENTED]` `package.json` and `package-lock.json` carry version `0.1.0-alpha.2`. The release workflow refuses a tag that does not match it (`v0.1.0-alpha.2`).
- **FR-002** `[IMPLEMENTED]` `CHANGELOG.md` lists what is new since `v0.1.0-alpha.1`; the README "Install from releases" section says what changed for people installing it (new app id, still unsigned).
- **FR-003** `[IMPLEMENTED]` Tag `v0.1.0-alpha.2` on the merge commit of this branch's PR triggers `.github/workflows/release.yml` (spec 008): macOS arm64 and x64 dmg (plus zips), Windows installer and portable, Linux AppImage, `SHA256SUMS.txt`, attached to a **draft pre-release**. `[KNOWN GAP]` Nothing here publishes it; the older draft `v0.1.0-alpha.1` is left as it is.

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 is still a draft that needs approval, because certificates cost money). macOS needs right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has ever been run by hand. The macOS and Windows packages are built by CI and are **untested on real Macs and Windows PCs** (`read:`).
- No auto-update. A new app id means the old test install (`io.github.vikramgorla.agentdurbar`) is a separate app: its settings and saved folders are not carried over.
