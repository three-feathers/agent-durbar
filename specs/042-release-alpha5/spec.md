# Feature Specification: Release v0.1.0-alpha.5 (pre-release)

**Feature Branch**: `042-release-alpha5`
**Created**: 2026-10-18
**Status**: Release PR; tag, draft and publishing as a pre-release follow (tasks T004-T006).
**Input**: Vikram asked, after the themes PR (#137) was reviewed and pushed: "push, reply, merge and cut a release ... i mean pre release". AGENTS.md "Needs approval": publishing a release is approved here, in writing, for this release only, as for alpha.4 (spec 031). Release engineering only: a version bump, a changelog section and README download notes. No behavior change (the only `src/` edit is the simulator's displayed version string).

## Requirements

- **FR-001** `[IMPLEMENTED]` `package.json` and `package-lock.json` carry version `0.1.0-alpha.5`. The release workflow refuses a tag that does not match it (`v0.1.0-alpha.5`).
- **FR-002** `[IMPLEMENTED]` `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.5` section: themes with their own UI style and scene kit, user theme packs and the untrusted-input fixes (specs 035-040, PR #137) with a per-theme office check that really applies each theme (spec 036 FR-005 delta), main agents named by their Copilot session title (specs 001/002 deltas, PR #171, one real check), floors (spec 033), agents show how they are doing and rooms show their worst agent (spec 034), custom places and the Places list fixes (spec 024 deltas), usage totals kept across restarts (spec 011), redacted debug log and the Claude Code / Codex groundwork that is not wired yet (spec 012, simulator and fixtures only). The README "Install from releases" section says what changed for people installing it.
- **FR-003** `[PLANNED]` Tag `v0.1.0-alpha.5` on the merge commit of this branch's PR triggers `.github/workflows/release.yml` (spec 008): macOS arm64 and x64 dmg (plus zips), Windows installer and portable, Linux AppImage, `SHA256SUMS.txt`, attached to a **draft pre-release**; it is checked (eight files, checksums) and published as a pre-release.

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 is still a draft that needs approval, because certificates cost money). macOS needs right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has ever been run by hand. The macOS and Windows packages are built by CI and are **untested on real Macs and Windows PCs** (`read:`).
- `[KNOWN GAP]` Themes, floors, agent moods and custom places were checked on the simulator and with unit tests only, not on a real Copilot session. Theme display fonts are the system's serif and monospace fonts, so they look different per OS; only Linux was looked at.
- `[KNOWN GAP]` Claude Code and Codex are **not** supported: only their groundwork is in (detection, mappers, a JSON-RPC client), not wired, nothing run on a real account. Only Copilot is registered.
- `[KNOWN GAP]` Switching between two real models, the long-context tier and `confirmation_required` were never seen on a real account (spec 030).
- `[KNOWN GAP]` An in-place upgrade from alpha.4 (same app id) was not checked on any machine.
- No auto-update.
