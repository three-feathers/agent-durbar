# Feature Specification: Release v0.1.0-alpha.10 (pre-release)

**Feature Branch**: `067-release-alpha10`
**Created**: 2026-10-21
**Status**: In progress.
**Input**: Vikram (terminal, 2026-10-20, late evening): "and then perform a pre-release cut", then (2026-10-21) "you can take time until 10 am".

## Requirements

- **FR-001** `package.json`, `package-lock.json` and the simulator's About label carry version `0.1.0-alpha.10`.
- **FR-002** `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.10` section; the README status names alpha.10.
- **FR-003** Tag `v0.1.0-alpha.10` on a commit of `main` whose CI is fully green; `release.yml` builds the draft; the draft is checked (flags, files, checksums) and published as a **pre-release** with notes written from what actually merged.
- **FR-004** Honest limits in the notes: unsigned and not notarized; what was and was not verified on real machines.
