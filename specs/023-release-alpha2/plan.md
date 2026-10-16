# Implementation Plan: Release v0.1.0-alpha.2

1. Branch `023-release-alpha2` from the latest `origin/main`, once main CI is green (it was: CI run 38944184611 on `22a9074`).
2. Bump `version` in `package.json` and `package-lock.json`; update the simulator's displayed version string.
3. Add `CHANGELOG.md`; update README "Install from releases" and the CONTRIBUTING release example.
4. Pull request, CI green, merge with `--admin` (maintainer, approved for this release).
5. Tag `v0.1.0-alpha.2` on the merge commit; `release.yml` builds and creates the **draft** pre-release. Replace the generic notes with the changelog (still a draft). Do not publish.

Constitution check: no new code paths, no secrets, no AI credits (no real Copilot session is run), honest limits recorded above (principle VIII).
