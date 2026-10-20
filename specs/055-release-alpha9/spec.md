# Feature Specification: Release v0.1.0-alpha.9 (pre-release)

**Feature Branch**: `055-release-alpha9`
**Created**: 2026-10-20
**Status**: Prepared; **publishing waits for the owner's go-ahead in his session** (AGENTS.md "Needs approval": the written approval covered alpha.8 only).
**Input**: Vikram asked on Telegram (2026-10-20, 00:33 UTC) for another pre-release at 8am. A channel message is not taken as approval to publish, so everything up to the tag is prepared and the publish step waits for a go-ahead in the Claude session.

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.9`.
- **FR-002** `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.9` section; the README status names alpha.9. Main changes since alpha.8:
  - **remote control from GitHub web and mobile** for a Copilot session (spec 054 Phase 1), with a native confirmation, never together with Allow all, and turned off on GitHub when a session ends;
  - **scheduled prompts Phase 2** (spec 044): weekdays and weekly rules, the daylight-saving fix, per-session schedules, a per-schedule limit;
  - **MCP elicitation forms and URL mode** (spec 012 FR-151..FR-155);
  - **the AI theme maker with Copilot** (spec 040 FR-015);
  - **rounds 6 and 7 of the usability pass** (spec 052):
    - truthful status ("Failing"), last activity, diffs on edit requests, full commands;
    - a dense, sortable list and a local **Activity log** with export;
    - motion with meaning; Windows first-run fixes;
    - house rules (`docs/design-rules.md`), readability, and plain words for people who don't code;
  - **rounds 8 and 9** (spec 052): macOS conventions (a menu, ⌘ keys, hiding on close), daily use (the window and view remembered, every open session restored, "Since you were away", a quit prompt, End all sessions, Ctrl+` back to the last chat), and pre-release fixes;
  - **every IPC call checks its sender** (spec 045 FR-008) and remote control hardening (spec 054 FR-011);
  - **a new website**: a landing page plus a docs page (spec 050).
- **FR-003** Tag `v0.1.0-alpha.9` on a commit of `main` whose CI is fully green; `release.yml` builds the draft; the draft is checked (flags, eight files, the checksums of the files that can be checked on Linux), given notes with the honest limits, and published as a **pre-release** only after the owner's go-ahead.

## Honest limits (for the release notes)

- Unsigned and not notarized. **Only Linux has been run by hand**; macOS and Windows builds are checked in CI only.
- Not checked on a real account:
  - remote control (it exports a session to GitHub);
  - the Copilot AI theme maker (1 prompt);
  - MCP elicitation on a real server;
  - the Copilot agent-schedule events.
- OS notifications, the badge, Alt+letters on Windows, the winget Links folder, the PowerShell 7 hint and High Contrast were checked in the simulator and code only.
- An in-place upgrade from alpha.8 was not checked. No auto-update.

## Release record

(filled in when published)
