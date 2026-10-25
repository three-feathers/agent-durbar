# Plan 082: Release v0.1.0-alpha.15

1. Version-only PR (this branch): FR-001. `npm run typecheck && npm run build && npm test`; CI green; an approval from another side.
2. After it merges: annotated tag on its merge commit, pushed by the release manager (Paco's agent, on Vikram's OK of 2026-10-24). `release.yml` drafts the release.
3. Check the draft (files, digests, notes), publish it as a pre-release (not latest).
4. Fold PR from the tag (`NNN-fold-0.1.0-alpha.15`, a dotted name the Spec Kit gate rejects; use `NNN-fold-alpha-N`, see `changelog.d/README.md`), then record the evidence here.
