# Feature Specification: Release v0.1.0-alpha.7 (pre-release)

**Feature Branch**: `047-release-alpha7`
**Created**: 2026-10-19
**Status**: In progress (release PR, then tag, then publish)
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

(Filled in after publishing.)
