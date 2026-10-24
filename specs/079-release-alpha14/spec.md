# Feature Specification: Release v0.1.0-alpha.14 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.14 (pre-release)
status: **published as a pre-release 2026-10-23** (tag on `9eb68f81`)
-->

**Feature Branch**: `079-release-alpha14`
**Created**: 2026-10-23
**Status**: **Published as a pre-release on 2026-10-23** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.14>; release PR #637; annotated tag on `9eb68f81`). Not marked latest. No Mac run by the agent: the owner is testing on his Mac.
**Input**: Vikram (Telegram DM, 2026-10-23 12:20 UTC), on the three linked MCP pull requests: "I can wait, give me all those as they are all linked", so the release is cut from `main` after #598 (Copilot MCP Sign in), #630 (MCP health) and #625 (fewer macOS keychain prompts) have all merged. He then tests it on his Mac.

## Context

alpha.13 (spec 078) was the first release built from `changelog.d/` fragments. alpha.14 is the second, cut from `main`: the branch was cut at `f4379840` (the #625 merge), then took `main` up to `36b851c6` on reviewer request (Paco), merging `main` again whenever it moved before the merge, so the later merges (#626 spare height, #614 `/` list masking, #597 Go to keys, #633 and #564 process docs, #639 review checklist, #635 Claude Code MCP Sign in, #643 label backfill, #632 compact composer row) are in it and their fragments are folded too. A test pre-release, `v0.1.0-alpha.14-mcptest.1`, was built earlier from the integration branch `099-mcp-test-build` so the owner could try #598 and #625 on a Mac before they merged; this release replaces it.

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.14`.
- **FR-002** `npm run changelog:build -- --release "v0.1.0-alpha.14 (...)"` folds every fragment on `main` into the alpha.14 section and deletes them; none is left under *Unreleased*. The release manager adds an intro paragraph that puts the MCP work first: Sign in, MCP health (failure reasons, when, Copy diagnostics, the chip dot) and fewer macOS keychain prompts, with the note that after updating a Mac may ask for *Always Allow* on two launches, then not again.
- **FR-003** The README status block names alpha.14 and that the MCP Sign in and keychain change were tried on the owner's Mac with the test build.
- **FR-004** Tag `v0.1.0-alpha.14` (annotated) on the release PR's merge commit on `main`. `release.yml` builds the draft; it is checked (8 files as for alpha.13, every package matches `SHA256SUMS.txt` and GitHub's own asset digests) and published as a **pre-release**, not "latest", with notes written from what merged: highlights, what was checked on a real account or machine and what only in the simulator, and known limits (unsigned, not notarized, the keychain note).
- **FR-005** After publishing, the test pre-release `v0.1.0-alpha.14-mcptest.1` is kept but its notes say it is superseded by `v0.1.0-alpha.14`, and the branch `099-mcp-test-build` is deleted.

## Not in this release

Pull requests still open on 2026-10-23, among them session door signs (#631), the Schedules button (#560) and the AGENTS.md PR (#561).

## Evidence

- `real:` annotated tag `v0.1.0-alpha.14` points at `9eb68f812a6aa7408b9fe795e4a64a3da59b8ea8` (the #637 merge commit on `main`), checked with `git ls-remote`.
- `real:` release <https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.14>: published 2026-10-23 20:29 UTC, `isPrerelease: true`, `isDraft: false`, 8 assets (`gh release view`).
- `real:` `release.yml` run 40016756422 (push of the tag) concluded `success`.
- `real:` the 8 files match: each package's digest in `SHA256SUMS.txt` equals GitHub's own asset digest for that file.
- `real:` every push check on `9eb68f81` is green (CI Build and test on Linux, Windows and macOS; Packaged check; Package smoke; Installed app; UI checks; Office layout check; CodeQL Analyze x2; Build site; Spec Kit gate; Draft release; Deploy to GitHub Pages). Skipped: the matrix Theme layout jobs and Docs check (by design on `main`). One check is red and is not a build check: a Dependabot *update job* (`npm_and_yarn` for `zod`, run 40016618659) fails because the patched `zod` would downgrade `@github/copilot-sdk` from 1.0.22 to 1.0.14. It does not touch the release artifacts.
- `real:` FR-005: `v0.1.0-alpha.14-mcptest.1` notes begin with a "Superseded by v0.1.0-alpha.14" line, and `git ls-remote --heads origin 099-mcp-test-build` is empty.
- Not verified by the agent: no installation or run of any package on macOS (or any real session); the owner is testing the MCP Sign in and keychain change on his Mac. The packages stay unsigned and not notarized.
