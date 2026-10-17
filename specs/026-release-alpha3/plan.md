# Implementation Plan: Release v0.1.0-alpha.3

1. Branch `026-release-alpha3` from the latest `origin/main` (CI green). Number 026 was free: 024 exists on `origin/024-office-places`, 025 is docs-sync.
2. Bump `version` in `package.json` and `package-lock.json`; update the simulator's displayed version string.
3. Move the CHANGELOG *Unreleased* items into a `v0.1.0-alpha.3` section; update README status, "Install from releases" and "What's new"; update the CONTRIBUTING release example and the specs index (docs-sync rule, AGENTS.md).
4. Pull request, CI green, merge with `--admin` (maintainer, approved for this release).
5. Tag `v0.1.0-alpha.3` on the merge commit; `release.yml` builds and creates the **draft** pre-release. Replace the generic notes with the changelog (still a draft). The agent does not publish; the maintainer published it as a pre-release on 2026-10-17.

Constitution check: no new code paths, no secrets, no AI credits (no real Copilot session is run), honest limits recorded above (principle VIII).
