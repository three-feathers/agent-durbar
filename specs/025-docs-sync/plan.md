# Plan: 025 docs sync

1. Branch `025-docs-sync` from fresh `origin/main` (new worktree). Numbers 022 and 023 were taken by branches, 024 by `024-office-places` on origin; 025 is free in `specs/`, branches and PRs.
2. Audit README, CHANGELOG, CONTRIBUTING, SECURITY, `docs/`, `specs/README.md`, AGENTS/CLAUDE/copilot-instructions and screenshot links against `main`; fix what is stale (FR-004).
3. `AGENTS.md` "Keep docs in sync" (FR-001), pointers in the other agent files and docs.
4. PR template Docs section (FR-002).
5. `.github/scripts/docs-check.sh` + `test-docs-check.sh` + a separate job in `spec-kit.yml` (FR-003). `spec-gate.sh` is not touched, so the required *Spec Kit gate* cannot be affected.
6. Pull request with a statement that `AGENTS.md` and `.github/` are changed on purpose (Vikram's request); CI green; merge with `gh pr merge --squash --admin` like earlier PRs.

Constitution check: no code paths, no secrets, no AI credits (no real session run), honest limits recorded (principle VIII); non-blocking by design so contributors are not stopped.

## Delta 2026-10-22: changelog fragments and a generated specs index (FR-007..FR-016)

Branch `025-changelog-fragments` (owning spec: this one, it owns "Keep docs in sync" and the Docs check).

1. `scripts/changelog.js` (plain Node, CommonJS like `build-site.js`; exported functions plus a CLI): `check`, `preview`, `build --release` (one section per `v...` token). Parsing is line based on `\r?\n`-normalised text; only `changelog.d/` and `CHANGELOG.md` are read or written; fragment names are validated by a regex, so no path leaves the folder. The transition is data driven: the cut-over marker that the first `build` writes decides when a hand-written *Unreleased* bullet turns from a warning into an error. No date, so a release cannot surprise anyone.
2. `scripts/specs-index.js`: block parser and writer, `generate` (the hand-written `specs/README.md` text with each marked table built from the blocks), `check`, `--add`, `--import`, `--print`. **Rows are not committed** (review on #518): any committed generated file still conflicts when two PRs change neighbouring rows, and since no bot may push to `main`, the only conflict-free design is not to commit them. GitHub readers get the table on the website's docs page (`build-site.js` calls `generate`), and contributors get it from `npm run specs:index` (`specs/INDEX.md`, git-ignored). Rows are sorted by folder name within a group, so no `order` key is needed. Strictness follows a marker line in `specs/README.md` (`<!-- specs-index: strict -->`), not a date, so `main` cannot turn red without a commit.
3. Group ids come from the section heading above each table (`## Features 001-010` -> `001-010`, `## Index` -> `index`), so the import is repeatable on any later version of the table (the merge-time re-run).
4. Tests: `scripts/test-changelog.js`, `scripts/test-specs-index.js` (throwaway folders); the suites' second steps run the real checks (`changelog.js check`, `specs-index.js --check`). Both are `node <file>` steps, as `scripts/run-tests.js` requires.
5. Docs check: `changelog\.d/` counts as docs; two new warnings (hand CHANGELOG bullet outside a release, a spec row (`| [NNN](...)`) added to `specs/README.md`), cases in `test-docs-check.sh`.
6. Rules and docs (FR-016). Owner approved the `AGENTS.md` change directly (team chat 2026-10-22).
7. **Merge timing**: this PR lands **after** the current stack (merge plan of 2026-10-22) and is not stacked on it. The alpha.11 release (#517) has merged. At merge time (#520): merge `origin/main` into the branch; on a `specs/README.md` conflict take `main`'s version; run `npm run specs:index -- --import` (blocks updated, rows removed); run `npm test`; push; gate; merge. Later, once no open PR edits the rows, a small PR adds `<!-- specs-index: strict -->`.

Constitution check: no `src/` change, no app behaviour change, no secrets, no network, no shell with user strings (Node `fs` only; the bash Docs check reads only `git diff`), no AI credits. Windows/macOS/Linux: `path.join`, CRLF-tolerant reads, lower-case fragment names. Honest limits: Linux only by hand; `[KNOWN GAP]` fold order.

## Delta 2026-11-01: feature inventory

A Markdown table is the data (no second file): the check parses its rows. Reuses `world-moments.json` (spec 098) for moment ids and `shippable`, `package.json` scripts and `scripts/` for proof tags, and each `spec.md` `specs-index` status. No `src/` change.
