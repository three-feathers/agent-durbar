# Implementation Plan: Release v0.1.0-alpha.5

1. Branch `041-release-alpha5` from the latest `origin/main` after PR #137 merged (CI green). Number 041 is the next free one: 035-040 are the theme specs.
2. `npm version 0.1.0-alpha.5 --no-git-tag-version` (package.json and package-lock.json); update the simulator's displayed version string.
3. Move the CHANGELOG *Unreleased* items into a `v0.1.0-alpha.5` section; README status line, "Install from releases" and "What's new"; the CONTRIBUTING release example; the specs index (docs-sync rule, AGENTS.md). `AGENTS.md` is a protected path and is not touched here.
4. Pull request, CI green, merge with `--admin` (approved for this release).
5. Tag `v0.1.0-alpha.5` on the merge commit; `release.yml` builds the **draft** pre-release. Check the eight assets and checksums, set plain notes with the honest limits, publish as a **pre-release**, verify, then a small docs PR says "published" (as PR #119 did for alpha.4).

Constitution check: no new code paths, no secrets, no AI credits (no real Copilot session), honest limits recorded in the spec (principle VIII).
