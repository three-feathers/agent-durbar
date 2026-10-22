# Feature Specification: Release v0.1.0-alpha.5 (pre-release)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 042
title: Release v0.1.0-alpha.5 as a pre-release (version bump, changelog, download notes)
status: built; **published as a pre-release** (2026-10-18)
-->

**Feature Branch**: `042-release-alpha5`
**Created**: 2026-10-18
**Status**: Built and **published as a pre-release on 2026-10-18** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.5>; release PR #164 merged by Vikram after Ruben's approval; tag on `995947d`, the merge of #172, after #171 and #172 landed; CI green on that commit).
**Input**: Vikram asked, after the themes PR (#137) was reviewed and pushed: "push, reply, merge and cut a release ... i mean pre release". AGENTS.md "Needs approval": publishing a release is approved here, in writing, for this release only, as for alpha.4 (spec 031). Release engineering only: a version bump, a changelog section and README download notes. No behavior change (the only `src/` edit is the simulator's displayed version string).

## Requirements

- **FR-001** `[IMPLEMENTED]` `package.json` and `package-lock.json` carry version `0.1.0-alpha.5`. The release workflow refuses a tag that does not match it (`v0.1.0-alpha.5`).
- **FR-002** `[IMPLEMENTED]` `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.5` section: themes with their own UI style and scene kit, user theme packs and the untrusted-input fixes (specs 035-040, PR #137) with a per-theme office check that really applies each theme (spec 036 FR-005 delta), main agents named by their Copilot session title (specs 001/002 deltas, PR #171, one real check), floors (spec 033), agents show how they are doing and rooms show their worst agent (spec 034), custom places and the Places list fixes (spec 024 deltas), usage totals kept across restarts (spec 011), redacted debug log and the Claude Code / Codex groundwork that is not wired yet (spec 012, simulator and fixtures only). The README "Install from releases" section says what changed for people installing it.
- **FR-003** `[IMPLEMENTED]` Tag `v0.1.0-alpha.5` on the merge commit of this branch's PR triggers `.github/workflows/release.yml` (spec 008): macOS arm64 and x64 dmg (plus zips), Windows installer and portable, Linux AppImage, `SHA256SUMS.txt`, attached to a **draft pre-release**; it is checked (eight files, checksums) and published as a pre-release.

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 is still a draft that needs approval, because certificates cost money). macOS needs right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has ever been run by hand. The macOS and Windows packages are built by CI and are **untested on real Macs and Windows PCs** (`read:`).
- `[KNOWN GAP]` Themes, floors, agent moods and custom places were checked on the simulator and with unit tests only, not on a real Copilot session. Theme display fonts are the system's serif and monospace fonts, so they look different per OS; only Linux was looked at.
- `[KNOWN GAP]` Claude Code and Codex are **not** supported: only their groundwork is in (detection, mappers, a JSON-RPC client), not wired, nothing run on a real account. Only Copilot is registered.
- `[KNOWN GAP]` Switching between two real models, the long-context tier and `confirmation_required` were never seen on a real account (spec 030).
- `[KNOWN GAP]` An in-place upgrade from alpha.4 (same app id) was not checked on any machine.
- No auto-update.

## Release record (2026-10-18)

- Tag `v0.1.0-alpha.5` on `995947d`; `release.yml` run 39162411638: macOS, Windows and Linux builds and the draft job succeeded.
- Draft checked: draft and pre-release flags, eight files (arm64 and x64 dmg and zip, Windows installer and portable, Linux AppImage, `SHA256SUMS.txt`). The portable exe and AppImage were downloaded and match `SHA256SUMS.txt`.
- `[KNOWN GAP]` The packaged app turns its developer hooks off (spec 010), so the shipped files were not driven by a test; CI's unpacked-app smoke check passed on the tagged commit. Nobody ran the published files on macOS or Windows.
- Notes set with the honest limits above; published as a pre-release by the maintainer's agent on his instruction ("push, reply, merge and cut a release ... i mean pre release").

