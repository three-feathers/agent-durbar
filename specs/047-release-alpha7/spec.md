# Feature Specification: Release v0.1.0-alpha.7 (pre-release)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 046
title: Release v0.1.0-alpha.7 (pre-release): Codex offered, the Claude dollar cap, new session with a summary, the Schedules starter kit
status: **published as a pre-release 2026-10-19** (tag on `05b2783`, CI fully green)
-->

**Feature Branch**: `047-release-alpha7`
**Created**: 2026-10-19
**Status**: Built and **published as a pre-release on 2026-10-19** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.7>; release PR #283; tag on `05b2783`, CI fully green on that commit).
**Input**: Vikram, 2026-10-19, in his session, asked "Cut the next pre-release (v0.1.0-alpha.7) with Codex as a harness, the Claude cost cap and 'new session with a summary'?" and answered "yes and also review overall readme…". AGENTS.md "Needs approval": publishing this release is approved in writing, for this release only. This is release engineering only: a version bump, the changelog and the download notes.

## Requirements

- **FR-001** `package.json` and `package-lock.json` carry version `0.1.0-alpha.7`, and so does the simulator's About label. The release workflow refuses a tag that does not match.
- **FR-002** `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.7` section, and the README status names alpha.7. The "New app icon" line moves to alpha.6, which shipped it. The main changes since alpha.6:
  - **OpenAI Codex offered** next to Copilot and Claude Code (spec 012 FR-137..FR-149): modes, resume, models, history, questions, MCP, helpers;
  - **a dollar cost cap for Claude Code** (spec 012 FR-150);
  - **new session with a reviewed summary** (spec 030 FR-034..FR-037);
  - **the Schedules starter kit**, *every day at*, and a decision at the end (spec 044 FR-006..FR-008);
  - a findable *Remove folder*, VS Code Insiders and VSCodium, the Linux window icon;
  - a shorter README with themes, faster CI, and a packaged check on three OSes in CI.
- **FR-003** Tag `v0.1.0-alpha.7` on the merge commit of this branch's PR triggers `.github/workflows/release.yml`. It builds unsigned macOS arm64 and x64 dmg and zip, the Windows installer and portable exe, the Linux AppImage, and `SHA256SUMS.txt`, attached to a **draft pre-release**. The draft is checked (flags, eight files, checksums of the files that can be checked on Linux), given notes with the honest limits below, and published as a **pre-release**. The link is posted in the team's Telegram group.

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 needs a purchase). macOS needs right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has been run by hand. A packaged-app check runs on macOS, Windows and Linux in CI (spec 012 T044), but nobody has used the macOS or Windows builds on real machines.
- Codex and Claude Code run the user's own installed and signed-in CLIs. On Ubuntu 24.04 and later, Codex's Read-only and Ask first need an AppArmor profile for bubblewrap (README).
- `[KNOWN GAP]` Not seen on a real Copilot account:
  - switching between two real models, the long-context tier, `confirmation_required`;
  - `summarizeForHandoff`;
  - a credit cap being reached.
- An in-place upgrade from alpha.6 was not checked.
- No auto-update.

## Release record

- **Where the tag went:** the release PR merged as `d90fcd4`. Its CI was cancelled three times by later merges to `main` (#284, #285, #245), because `ci.yml` cancelled in-progress runs on every ref. That is fixed by #286 (spec 008). The packaged check passed on `d90fcd4`.
  - The tag `v0.1.0-alpha.7` is on `05b2783`, the merge of #245, whose CI was **fully green**: build and test on all three OSes, the package smoke check and the office layout check.
  - Besides the release, `05b2783` adds only #245 (Durbar MCP read tools, not wired to any server; spec 041 T016) and the process docs of #284 and #285.
  - Open code-scanning and Dependabot alerts at tagging: 0.
- `release.yml` run 39293705471: the Windows, macOS, Linux and draft jobs succeeded.
- **Draft checked:**
  - draft and pre-release flags;
  - eight files: arm64 and x64 dmg and zip, the Windows installer and portable exe, the Linux AppImage, and `SHA256SUMS.txt`;
  - the portable exe and the AppImage were downloaded and match `SHA256SUMS.txt`;
  - the AppImage extracts, has `app.asar`, and its `package.json` says `0.1.0-alpha.7`.
- Notes set with the honest limits above, and **published as a pre-release on 2026-10-19 at 17:31 UTC**. The link was posted in the team's Telegram group.
- `[KNOWN GAP]` Nobody has run the published files on macOS or Windows.
