# Implementation Plan: Release v0.1.0-alpha.4

1. Branch `031-release-alpha4` from the latest `origin/main` (CI green). Number 031 was free: 027 to 029 are docs branches without a spec folder, 030 is switch model and context.
2. Bump `version` in `package.json` and `package-lock.json`; update the simulator's displayed version string.
3. Move the CHANGELOG *Unreleased* items into a `v0.1.0-alpha.4` section; update the README status line, "Install from releases" and "What's new"; update the CONTRIBUTING release example and the specs index (docs-sync rule, AGENTS.md). `AGENTS.md` itself is a protected path and is not touched here (its "Where things are" list is the maintainer's to update).
4. Pull request, CI green, merge with `--admin` (approved for this release).
5. Tag `v0.1.0-alpha.4` on the merge commit; `release.yml` builds and creates the **draft** pre-release. Check the eight assets, replace the generic notes with plain notes and the honest limits, publish as a **pre-release**, verify, then a small docs PR says "published" (as PR #26 did for alpha.3).

Constitution check: no new code paths, no secrets, no AI credits (no real Copilot session is run), honest limits recorded above (principle VIII).
