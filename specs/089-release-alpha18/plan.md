# Plan 089: Release v0.1.0-alpha.18

1. Version-only PR (this branch): FR-001. `npm run typecheck && npm run build && npm test`; CI green; merge through the queue.
2. Annotated tag on `main`, pushed by the release manager; `release.yml` drafts the release.
3. Check the draft, publish as a pre-release (not latest).
4. Fold PR from the tag (`089-fold-alpha-18`, no dots, see `changelog.d/README.md`), then record the evidence here.
