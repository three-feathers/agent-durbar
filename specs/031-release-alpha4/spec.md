# Feature Specification: Release v0.1.0-alpha.4 (pre-release)

**Feature Branch**: `031-release-alpha4`
**Created**: 2026-10-17
**Status**: Release PR (2026-10-17); the tag, the draft and publishing as a **pre-release** follow, and a docs PR then records that it is published (the maintainer asked for it explicitly: "proceed until pre-release"). Release engineering only: a version bump, a changelog section and README download notes. No behavior change (the only `src/` edit is the simulator's displayed version string).
**Input**: Vikram asked for `v0.1.0-alpha.4` to be cut after the places-in-the-office PR (#109) merged, the way alpha.3 was (spec 026), and published as a **pre-release** (AGENTS.md "Needs approval": publishing a release is approved here, in writing, for this release only).

## Requirements

- **FR-001** `[IMPLEMENTED]` `package.json` and `package-lock.json` carry version `0.1.0-alpha.4`. The release workflow refuses a tag that does not match it (`v0.1.0-alpha.4`).
- **FR-002** `[IMPLEMENTED]` `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.4` section: places in the office (spec 024), per-folder import of MCP servers from VS Code (spec 020), keyboard focus in the Allow all confirmation (spec 003), switching model and context window inside a session (spec 030 Phases 1 and 2 on the simulator and a fake session, Phase 3 checks on a free plan with `auto` only), compaction cost counted in the usage totals, refreshed README pictures and docs-only specs (012, 030). The README "Install from releases" section says what changed for people installing it.
- **FR-003** `[IMPLEMENTED]` Tag `v0.1.0-alpha.4` on the merge commit of this branch's PR triggers `.github/workflows/release.yml` (spec 008): macOS arm64 and x64 dmg (plus zips), Windows installer and portable, Linux AppImage, `SHA256SUMS.txt`, attached to a **draft pre-release** by the workflow; it is then published as a pre-release.

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 is still a draft that needs approval, because certificates cost money). macOS needs right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has ever been run by hand. The macOS and Windows packages are built by CI and are **untested on real Macs and Windows PCs** (`read:`).
- `[KNOWN GAP]` Switching between two real models, the long-context tier and the `confirmation_required` path were never seen on a real account: a free plan lists only `auto`. Those parts are tested on the simulator and on fake sessions.
- `[KNOWN GAP]` Places in the office were checked on the simulator, with unit tests and on a short real session (3 prompts); the Windows layout was not looked at. Custom places and per-folder extras in the Places list are open issues (#115, #116, #117).
- `[KNOWN GAP]` Windows grant keys are not yet compared case-insensitively (spec 003 T028).
- `[KNOWN GAP]` An in-place upgrade from alpha.3 (same app id) was not checked on any machine.
- No auto-update.
