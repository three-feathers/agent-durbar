# Feature Specification: Release v0.1.0-alpha.16 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.16 (pre-release)
status: in progress (version PR open)
-->

**Feature Branch**: `086-release-alpha16`
**Created**: 2026-10-25
**Status**: In progress
**Input**: Vikram (owner, Telegram DM 2026-10-25 05:37 UTC): the standing OK of 2026-10-23 for a pre-release (not latest) about every 8 hours; alpha.15 was published 2026-10-24 09:55 UTC and this one is overdue.

## Context

Same fold-at-tag flow as alpha.15 (spec 082, spec 008 FR-117..FR-120): version-only PR, annotated tag on `main`, doc-only fold PR from the tag. No merge freeze.

## Requirements

- **FR-001** `package.json`, `package-lock.json` (root entries only) and the simulator's About label carry version `0.1.0-alpha.16`. No other change in this PR.
- **FR-002** Tag `v0.1.0-alpha.16` (annotated) on a commit on `main` after the version PR; `release.yml`'s `verify` accepts it and writes the notes from that commit's fragments.
- **FR-003** The draft is checked (files, digests, notes, known limits) and published as a **pre-release**, not "latest".
- **FR-004** A doc-only fold PR from the tag folds the fragments, adds the intro paragraph and the README status block, and lands before the next tag.

## Evidence

- Pending: filled in by the fold PR.
