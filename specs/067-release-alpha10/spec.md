# Feature Specification: Release v0.1.0-alpha.10 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.10 (pre-release)
status: **published as a pre-release 2026-10-21** (tag on `176d888`)
-->

**Feature Branch**: `067-release-alpha10`
**Created**: 2026-10-21
**Status**: **Published as a pre-release on 2026-10-21** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.10>; release PR #442; tag on `176d888`, whose CI, packaged check and installed-app check were green on all three OSes). The draft had 8 files; the AppImage was checked against `SHA256SUMS.txt`.
**Input**: Vikram (terminal, 2026-10-20, late evening): "and then perform a pre-release cut", then (2026-10-21) "you can take time until 10 am".

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.10`.
- **FR-002** `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.10` section; the README status names alpha.10. Main changes since alpha.9:
  - **continue a conversation in another agent app** (#409, spec 030), and **switching the model inside Claude Code and Codex** sessions;
  - **Copilot model switching checked on a paid account** (spec 030 Phase 3), real context windows and prices, and **Durbar enforces the Copilot spending limit** (spec 011; the runtime does not);
  - **remote control for Claude Code sessions** (spec 054 Phase 2);
  - **folder status in the chat** (spec 063) and **send to several sessions** (spec 064);
  - **10 usability rounds** over every screen (spec 052) and a **smoother app** (long chats about 20× faster, room-only office updates);
  - **finding agent apps in version-manager folders** and the login-shell PATH (spec 060 T030);
  - security: **packaged builds refuse debuggers** (Electron fuses), honest Copilot sign-in without Copilot access, MCP error masking, the merge gate requires full CI;
  - Claude Code sessions listed in `claude --resume`; Pin, Hide and Delete in Previous sessions; reasoning effort `none`;
  - the installed release package is checked on Linux, macOS and Windows runners (spec 008 T021), and the known gaps were revalidated with real checks.
- **FR-005** Not in this release, still open as PRs: UI checks on three OSes (#389), drivers that wait (#401), official installers and the real-account end-to-end check (#392, #393, #402), a folder's own agent setup (#424, waiting for review), Copilot file hooks off (#415, waiting for review), checkpoints and undo (#440), plan first (#441), rename sessions (#420).
- **FR-003** Tag `v0.1.0-alpha.10` on a commit of `main` whose CI is fully green; `release.yml` builds the draft; the draft is checked (flags, files, checksums) and published as a **pre-release** with notes written from what actually merged.
- **FR-004** Honest limits in the notes: unsigned and not notarized; what was and was not verified on real machines.
