# Plan 091: Release v0.1.0

1. Version-only PR (this branch): FR-001. `npm run typecheck && npm run build && npm test`; CI green; merge through the queue.
2. Annotated tag `v0.1.0` on `main`, pushed by the release manager; `release.yml` drafts a non-pre-release.
3. Check the draft, then `gh release edit v0.1.0 --draft=false --latest`; confirm *Latest*.
4. Fold PR (`NNN-fold-0-1-0`): `changelog:build --release "v0.1.0 ([release](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0), YYYY-MM-DD)"`, intro, README status block, `docs/site/landing.json` eyebrow and status plus `scripts/test-site.js`. Then record the evidence here.
