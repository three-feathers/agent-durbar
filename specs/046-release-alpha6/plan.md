# Plan: Release v0.1.0-alpha.6 (046)

Same steps as alpha.4 and alpha.5 (specs 031, 042):

1. Version bump with `npm version 0.1.0-alpha.6 --no-git-tag-version`, plus the simulator's About label in `src/renderer/sim.ts`, the only `src/` change.
2. Move the CHANGELOG *Unreleased* items into the release section; update the README status, *Install from releases* and "What's new"; add the specs index row.
3. Merge the PR once CI is green, then tag the merge commit `v0.1.0-alpha.6`. `.github/workflows/release.yml` builds macOS, Windows and Linux and creates a draft pre-release.
4. Check the draft (flags, eight files, `SHA256SUMS.txt`; the AppImage and portable exe checksums verified on Linux), set the notes with the honest limits, and publish as a pre-release.
5. Docs PR: spec status and release record, README "published"; post the link in the team's Telegram group.
