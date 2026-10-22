# Feature Specification: Release v0.1.0-alpha.8 (pre-release)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 046
title: Release v0.1.0-alpha.8 (pre-release): agent app setup inside the app, five usability rounds, AI themes
status: **published as a pre-release 2026-10-20** (tag on `dd9de65`, CI fully green)
-->

**Feature Branch**: `053-release-alpha8`
**Created**: 2026-10-20
**Status**: Built and **published as a pre-release on 2026-10-20** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.8>; release PR #323; tag on `dd9de65`, CI fully green on that commit).
**Input**: Vikram, 2026-10-19, in his session: "cut a pre-release before 7 am tomorrow and continue working." AGENTS.md "Needs approval": publishing this release is approved in writing, for this release only. Release engineering only: a version bump, the changelog and the download notes.

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.8`. The release workflow refuses a tag that does not match.
- **FR-002** `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.8` section; the README status names alpha.8. The main changes since alpha.7:
  - **agent apps set up inside the app** (spec 051): install, update and sign in to Copilot, Claude Code and Codex from Settings > Agent apps, with a native confirmation that shows the exact program and arguments (FR-004b);
  - **five rounds of persona usability reviews** (spec 052, about 20 personas): the answer bar and the "Needs you" inbox, Simple and Expert views, the restore strip, the command palette and the Cost view, one word per concept, interaction polish, accessibility (High Contrast, focus, contrast), and calmer visuals with period textures in the themes;
  - **Make a theme with AI** (spec 040) and the project website (spec 050);
  - faster checks that keep the computer usable (spec 008).
- **FR-003** Tag `v0.1.0-alpha.8` on a commit of `main` whose CI is fully green; `.github/workflows/release.yml` builds unsigned macOS arm64 and x64 dmg and zip, the Windows installer and portable exe, the Linux AppImage and `SHA256SUMS.txt` into a **draft pre-release**. The draft is checked (flags, eight files, the checksums of the files that can be checked on Linux), given notes with the honest limits below, and published as a **pre-release**. The link is posted in the team's Telegram group.

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 needs a purchase). On macOS, use right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has been run by hand. A packaged-app check runs on macOS, Windows and Linux in CI, but nobody has used the macOS or Windows builds on real machines.
- `[KNOWN GAP]` Harness setup (spec 051):
  - real installs were not run on any OS;
  - the sign-in flows were started and cancelled on Linux only;
  - the native confirmation, winget `--source winget` and Windows paths are untested on Windows and macOS.
- Codex and Claude Code run the user's own installed and signed-in CLIs.
- `[KNOWN GAP]` Not seen on a real Copilot account: switching between two real models, the long-context tier, `confirmation_required`, a credit cap being reached.
- OS notifications and the badge (spec 052 FR-059) are checked in the simulator only.
- An in-place upgrade from alpha.7 was not checked. No auto-update.

## Release record

- **Where the tag went:** the merge of #323, `dd9de65`. Every workflow on that commit passed: CI, the packaged check, the project site and the push checks. At tagging there were 0 open code-scanning alerts and 0 open Dependabot alerts.
- **Build:** `release.yml` run 39347956615. The macOS, Windows, Linux and draft jobs succeeded.
- **Draft checked:**
  - draft and pre-release flags;
  - eight files: arm64 and x64 dmg and zip, the Windows installer and portable exe, the Linux AppImage, and `SHA256SUMS.txt`;
  - the portable exe and the AppImage were downloaded and match `SHA256SUMS.txt`;
  - the AppImage extracts, has `app.asar`, and its `package.json` says `0.1.0-alpha.8`.
- **Published:** the notes carry the honest limits above, and the release went out as a pre-release on 2026-10-20 at 00:36 UTC. The link was posted in the team's Telegram group.
- `[KNOWN GAP]` Nobody has run the published files on macOS or Windows.
