# Keep docs in sync

This file is rule text, part of [AGENTS.md](../../AGENTS.md) (FR-082): read it before you open or update a PR. It binds like AGENTS.md, unlike the guidance files (review checklist, agent-notes, agent-apps); "here" and "this file" in it mean AGENTS.md with `docs/rules/`.

A PR that changes behaviour, scripts, permissions, settings, MCP or tools, release status or contributors updates in the same PR:
- **README**: status block (fold PR's), *Safety model* (**Read-only / Ask first / Allow all**), credits. Rest in `docs/`: `features.md`, `install.md`, `safety.md`, `development.md` (`npm run`), `limits.md`.
- **Changelog**: a `changelog.d/<branch>.md` fragment, never `CHANGELOG.md` (`changelog.d/README.md`).
- **Feature inventory** (FR-078): add, change or remove a user-visible feature, update its `docs/feature-inventory.md` row (`npm test`); every offered world, characters included, has it or an issue; no new world ships with gaps.
- **Spec**: task ticked, tags and the `specs-index` block current (new spec: `npm run specs:index -- --add specs/NNN-name`); no `specs/README.md` rows.
- **Screenshots**: retake every linked picture showing the change, any spec's (`npm run shots:docs`, both sizes), and look at each. New linked pictures need `DOC_SHOTS` or a reasoned `NO_DRIVER` in `scripts/shots-docs.js`.
- Touched pages of `docs/`, `CONTRIBUTING.md`, `SECURITY.md` (the website is generated; `docs/site/gallery.json` only for key screenshots); contributors in `src/shared/about.ts`, `package.json`, `LICENSE`, README (`npm run test:about`).
- Rules change here only; keep the PR template and `docs/collaboration.md` consistent.

No impact: tick *no docs impact* and write `Docs: n/a <reason>` (the *Docs check* reads it; never to hide a real change). Cannot (screenshots too): open and assign an `area:docs` *Task* issue, link it from the PR, say what is left; never skip silently.
