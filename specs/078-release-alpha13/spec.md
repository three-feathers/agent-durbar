# Feature Specification: Release v0.1.0-alpha.13 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.13 (pre-release)
status: release PR open (2026-10-23)
-->

**Feature Branch**: `078-release-alpha13`
**Created**: 2026-10-23
**Status**: Release PR open
**Input**: Vikram (Telegram DM, 2026-10-23 03:58 UTC), on cutting the next pre-release after the lounge (#554) merged: "Fantastic, do it"; at 04:01 UTC he asked for #535 (`/` suggestions) to be in it too, so the release waits for both #554 and #535.

## Context

alpha.12 was cut on owner request from the feature branch `043-profile-ai` (PR #505), not from `main`, so its CHANGELOG section never reached `main`. alpha.13 is the first pre-release cut from `main` since alpha.11, and the first one whose CHANGELOG entry is built from `changelog.d/` fragments with `npm run changelog:build` (spec 025 T015, #520).

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.13`.
- **FR-002** `CHANGELOG.md` gets the missing `v0.1.0-alpha.12` section, taken unchanged from `git show v0.1.0-alpha.12:CHANGELOG.md`, above alpha.11. The two *Unreleased* bullets that alpha.12 already listed (escaped-quote masking, MCP restart) are no longer under *Unreleased*.
- **FR-003** No item is listed twice: a fragment whose text alpha.12 already released word for word is deleted; a fragment that grew after alpha.12 (composer toolbar, Codex write requests, theme tokens) keeps only what is new, as an "after alpha.12" line.
- **FR-004** `npm run changelog:build -- --release "v0.1.0-alpha.13 (...)"` folds every remaining fragment into the alpha.13 section, deletes the fragments and writes the cut-over marker (spec 025 T015). The release manager adds the intro paragraph. Main changes since alpha.11 on `main`: bigger desks when there are few agents, the lobby with Boss, Bank and Postbox, the lounge for finished agents, Go to (keyboard navigator), MCP servers for all folders, harmonize, a server's tools and per-tool toggles, live file edits in the chat, coffee break, the composer toolbar, collapsible previous sessions, the profile editor and Create with AI, theme tokens, the masking fixes (escaped quotes, percent-encoded bytes, underscores, the desk tooltip), `/` suggestions for skills and prompts (spec 073, #535; owner 2026-10-23 04:01 UTC: in alpha.13), the simulator refusing real calls, CI speed and merge queue changes.
- **FR-005** The README status block names alpha.13 and says how CI now runs (macOS on `main` and nightly, real-account check daily).
- **FR-006** Tag `v0.1.0-alpha.13` (annotated) on the release PR's merge commit on `main` once every check for that commit is green (CI, CodeQL, packaged check, installed app, UI). `release.yml` builds the draft; it is checked (8 files as for alpha.11 and alpha.12, every package matches `SHA256SUMS.txt`, pre-release flag) and published as a **pre-release**, not "latest", with notes written from what actually merged.
- **FR-007** Honest limits in the notes: unsigned and not notarized; which items were checked in the simulator only and which on a real account or machine; known limits carried over from alpha.11.

## Not in this release

Open PRs on 2026-10-23: the Schedules button in the top bar (#560), the desk-text masking follow-up (#567) and the docs PRs (#561, #564, #566).
