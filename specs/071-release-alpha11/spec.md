# Feature Specification: Release v0.1.0-alpha.11 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.11 (pre-release)
status: **published as a pre-release 2026-10-22** (tag on `b76b79a`)
-->

**Feature Branch**: `071-release-alpha11`
**Created**: 2026-10-22
**Status**: **Published as a pre-release on 2026-10-22** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.11>; release PR #517; tag on `b76b79a`, whose CI, CodeQL, packaged check, installed-app check and UI checks on all three OSes were green; the Windows UI job passed on a rerun after the known `check-question-options` flake that #516 fixes). The draft had 8 files; every package matched `SHA256SUMS.txt` (against GitHub's own asset digests).
**Input**: Vikram (Telegram, 2026-10-21 21:48 UTC): "yes, prepare that pre release tomorrow" (for his morning test).

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.11`.
- **FR-002** `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.11` section; the README status names alpha.11 and no longer lists merged work as "in review". Four entries that merged after the alpha.10 tag but landed in the alpha.10 section (spec 041 T064-T066 MCP masking, #369; spec 059 rename, #420) move to alpha.11. Main changes since alpha.10:
  - **live activity on the desks** (spec 001 FR-028..FR-032) and **faster floor switches** (about 140 ms instead of 440-530 ms);
  - **a folder's own agent setup** shown and applied only after consent (spec 061), and Copilot no longer runs a repository's hooks unasked;
  - **plan first** (spec 066), **undo an agent's file changes** (spec 065), **rename a session** (spec 059);
  - **MCP sign-ins**: kept in the system keychain between Copilot sessions (spec 058 FR-070), "Needs sign-in" for Copilot, Claude Code and Codex MCP servers, OAuth challenges no longer read as the app's own sign-in, MCP output masked;
  - **fewer Keychain prompts on a Mac** (spec 019 FR-023: at most one read per run);
  - each session comes back in its own permission mode (spec 003), + Folder / + Workspace back in the top bar, question card and help and UI text, parts 1 and 2 (spec 052, #464; part 2 merged at `b4bad22` and included);
  - installs without Homebrew or Node (spec 060), UI checks and real-account end-to-end checks on three OSes in CI (specs 008, 062), packaged display names (spec 008);
  - macOS and Windows hand-checked by the owner (spec 001 T024, spec 012 T070).
- **FR-003** Tag `v0.1.0-alpha.11` on a commit of `main` whose CI is fully green; `release.yml` builds the draft; the draft is checked (flags, files, checksums) and published as a **pre-release** with notes written from what actually merged.
- **FR-004** Honest limits in the notes: unsigned and not notarized; Keychain prompts once per new build on a Mac until code signing (#4); Linux without a keyring keeps MCP sign-ins in plain files; what was and was not verified on real machines.
- **FR-005** Not in this release, still open as PRs: global MCP controls and per-tool toggles (spec 069), theme tokens (spec 070), coffee break (spec 068), the office rail, the composer toolbar, collapsible Previous sessions, Windows winget install options, the simulator refusing real calls, and others open on 2026-10-22.
