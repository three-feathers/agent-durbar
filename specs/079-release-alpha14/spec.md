# Feature Specification: Release v0.1.0-alpha.14 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.14 (pre-release)
status: release PR open
-->

**Feature Branch**: `079-release-alpha14`
**Created**: 2026-10-23
**Status**: Release PR open.
**Input**: Vikram (Telegram DM, 2026-10-23 12:20 UTC), on the three linked MCP pull requests: "I can wait, give me all those as they are all linked", so the release is cut from `main` after #598 (Copilot MCP Sign in), #630 (MCP health) and #625 (fewer macOS keychain prompts) have all merged. He then tests it on his Mac.

## Context

alpha.13 (spec 078) was the first release built from `changelog.d/` fragments. alpha.14 is the second, cut from `main`: the branch was cut at `f4379840` (the #625 merge), then took `main` up to `5dbe518e` on reviewer request (Paco), so the later merges (#626 spare height, #614 `/` list masking, #597 Go to keys, #633 and #564 process docs) are in it and their fragments are folded too. A test pre-release, `v0.1.0-alpha.14-mcptest.1`, was built earlier from the integration branch `099-mcp-test-build` so the owner could try #598 and #625 on a Mac before they merged; this release replaces it.

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.14`.
- **FR-002** `npm run changelog:build -- --release "v0.1.0-alpha.14 (...)"` folds every fragment on `main` into the alpha.14 section and deletes them; none is left under *Unreleased*. The release manager adds an intro paragraph that puts the MCP work first: Sign in, MCP health (failure reasons, when, Copy diagnostics, the chip dot) and fewer macOS keychain prompts, with the note that after updating a Mac may ask for *Always Allow* on two launches, then not again.
- **FR-003** The README status block names alpha.14 and that the MCP Sign in and keychain change were tried on the owner's Mac with the test build.
- **FR-004** Tag `v0.1.0-alpha.14` (annotated) on the release PR's merge commit on `main`. `release.yml` builds the draft; it is checked (8 files as for alpha.13, every package matches `SHA256SUMS.txt` and GitHub's own asset digests) and published as a **pre-release**, not "latest", with notes written from what merged: highlights, what was checked on a real account or machine and what only in the simulator, and known limits (unsigned, not notarized, the keychain note).
- **FR-005** After publishing, the test pre-release `v0.1.0-alpha.14-mcptest.1` is kept but its notes say it is superseded by `v0.1.0-alpha.14`, and the branch `099-mcp-test-build` is deleted.

## Not in this release

Pull requests still open on 2026-10-23, among them Claude Code MCP sign-in (#635), the compact composer (#632), session door signs (#631), the Schedules button (#560) and the AGENTS.md PR (#561).
