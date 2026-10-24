# Feature Specification: Release v0.1.0-alpha.15 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.15 (pre-release)
status: version PR open
-->

**Feature Branch**: `082-release-alpha15`
**Created**: 2026-10-24
**Status**: Version PR open.
**Input**: Vikram (team Telegram chat, 2026-10-24 05:40 UTC): "you can take over merge and release activities until then … do pre-releases as per schedule, there is one overdue", while his agent is paused. The owners agreed a pace of about one pre-release every 8 hours (2026-10-23); alpha.14 was published 2026-10-23 20:29 UTC.

## Context

alpha.15 is the first release made with the fold-at-tag flow (spec 008 FR-117..FR-120): a version-only PR lands, a tag on `main` makes the draft's notes from that commit's `changelog.d/` fragments, and a doc-only fold PR from the tag folds them into `CHANGELOG.md` afterwards. No merge freeze.

## Requirements

- **FR-001** `package.json`, `package-lock.json` (root entries only) and the simulator's About label carry version `0.1.0-alpha.15`. No other change in this PR.
- **FR-002** Tag `v0.1.0-alpha.15` (annotated) on the version PR's merge commit on `main`. `release.yml`'s `verify` job accepts it (on `main`, equal to `package.json`, alpha.14 already folded) and writes the notes from that commit's fragments.
- **FR-003** The draft is checked before publishing: 8 files as for alpha.14, every package's digest in `SHA256SUMS.txt` equals GitHub's own asset digest, the notes list what merged since alpha.14, and the known limits stay (unsigned, not notarized). It is published as a **pre-release**, not "latest".
- **FR-004** A doc-only fold PR from the tag runs `npm run changelog:build -- --release "<heading>"`, adds the release's intro paragraph and the README status block, merges `main`, and lands before the next tag.

## Not in this release

Pull requests still open on 2026-10-24, among them the Schedules button (#560), the AGENTS.md test-once PR (#561), session door signs (#631), the org-policy grey-out (#644), the Cheeky crew (#621, draft) and the PowerShell hashtable masking (#669). Known open bug: a coffee-break Retry while the limit is still active ends in Error (#671).

## Evidence

To be filled in after the tag (`real:` tag sha, release run, digests).
