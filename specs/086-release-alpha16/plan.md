# Plan 086: Release v0.1.0-alpha.16

1. Version-only PR (this branch): FR-001. `npm run typecheck && npm run build && npm test`; CI green; merge through the queue.
2. Annotated tag on `main` (after PR #720 if it lands in time), pushed by the release manager; `release.yml` drafts the release.
3. Check the draft, publish as a pre-release (not latest).
4. Fold PR from the tag (`NNN-fold-0.1.0-alpha.16`, a dotted name the Spec Kit gate rejects; use `NNN-fold-alpha-N`, see `changelog.d/README.md`), then record the evidence here.
