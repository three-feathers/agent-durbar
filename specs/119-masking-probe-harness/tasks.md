# Tasks: 119 Masking probe harness

**Input**: [spec.md](spec.md), [plan.md](plan.md). Tests first, 0 AI credits, no network in any test or run. One PR per phase (P1..P3), in order, each under the **heavy** review profile with Paco's side as reviewer (owner condition 3, FR-028). Every PR of this spec carries the FR-020 list in its self-review and names no shape, gap or repro in its public text (FR-018). Numbers: a spec that is new on `main` numbers from 001 (`scripts/spec-numbers.js`, issue #1935 rule); checked with `npm run specs:numbers` on 2026-11-22 against `origin/main` and the open PR heads.

## P0: spec

- [x] T001 Spec, plan, tasks and the `specs-index` block. Check: `npm run specs:check`, `npm run specs:numbers`, `npm run rules:check`, `npm run changelog:check`.

## P1: pure core and toy masker (depends on P0; no CI wiring)

- [ ] T002 [P] `scripts/test-probe-mask-core.ts` first (PRNG determinism and the clock mutant), then `scripts/fuzz/core/prng.ts` (mulberry32, 32-bit seed) [FR-012]
- [ ] T003 [P] Piece generators by class in `scripts/fuzz/core/pieces.ts` and the composer in `scripts/fuzz/core/compose.ts` (1..6 pieces, depth 3, planted value with offsets kept in memory); tests: every class of FR-004 appears within a fixed seed, no generator returns an item of a stored list (mutant) [FR-003, FR-004]
- [ ] T004 `_probeVocabularyForTest()` in `src/shared/redact.ts` (and the renderer masks that hold their own vocabulary), built from the rules' own constants; identity test; `scripts/fuzz/core/vocab.ts` with the head-for-both fallback [FR-005]
- [ ] T005 [P] Oracles O0..O5 in `scripts/fuzz/core/oracles.ts` on hand-built outputs, with the plan's mutants (head compared with head, dropped reading passes, prefix accepted, wall-time assert) [FR-008, FR-009, FR-010, FR-011]
- [ ] T006 [P] `scripts/fuzz/core/emit.ts`: value-free lines, the 6-character filter over planted values and private rows, `safe-print.js` for names; canary tests through every output path [FR-014, SC-002]
- [ ] T007 `scripts/fuzz/fixtures/toy-mask.ts` (invented family from pieces, one surface per oracle shape, one regression flag per FR-004 class plus the union, stream, over-limit and quadratic ones) and the source scan of FR-020 (literals the head `redact()` changes, string-array literals in generator files) [FR-020, FR-026]

## P2: runner and frozen reference (depends on P1; authors can run it)

- [ ] T008 `scripts/test-probe-mask-runner.ts` first, then `scripts/fuzz/runner/probe-mask.ts`: options and validation, exit codes, caps, cleared environment, `npm run probe:mask` [FR-001, FR-002, FR-013, FR-021, FR-022]
- [ ] T009 `scripts/fuzz/surfaces.ts` (the registry: at least `test-redact-monotone.ts`'s surfaces plus the brain view's texts) [FR-006, FR-010]
- [ ] T010 `scripts/fuzz/runner/ref.ts`: commit resolve, relative-import closure, `git show` into `.probe-ref/<commit>/` (git-ignored), blob-hash check, `transpileModule`, "not the head" check; `.probe-ref/` in `.gitignore` [FR-007]
- [ ] T011 Seeds in public output and local replay: the reference verdict decides seeding under `CI`/`--ci`; `--replay` explain view; `--show` only on two terminals and without `CI`; the temp-folder no-file check [FR-015, FR-016, SC-005]
- [ ] T012 [P] `scripts/fuzz/runner/private.ts`: path order, `git check-ignore` and `git ls-files` refusals, caps, line-number-only reports; `.probe-private/` in `.gitignore` [FR-017, FR-018]
- [ ] T013 `scripts/fuzz/runner/guard.ts` network guard; `scripts/test-probe-mask-self.ts` (toy unmodified: 0 failures; each regression caught; whole-run digest) and `test:probe-mask` in `scripts/test-suites.txt` with a small fixed-seed probe of the real masks; each suite under 30 s; the harness mutants of FR-027 run on fresh builds and listed in the PR [FR-019, FR-026, FR-027, SC-001, SC-003, SC-004]

## P3: CI and docs (depends on P2)

- [ ] T014 `mask` output in `.github/scripts/ci-changes.js` (registry closure, `scripts/fuzz/**`, fail open) with cases in `scripts/test-ci-changes.ts`; spec 008 dated delta for the new output [FR-023]
- [ ] T015 The PR lane step in the Linux leg of `Build and test` in `.github/workflows/ci.yml` (`--ci pr --ref HEAD^1`, seed from the head sha, values through quoted `env:` only); measure and write the budget `<B>` in FR-023 so the step ends under 60 s [FR-023, SC-004]
- [ ] T016 Nightly lane as OP-1 decides (one Linux job on the existing nightly schedule, latest release tag as reference, counts only; with OP-1 = A an owner adds the secret) [FR-024] *(waits for OP-1; a repository secret needs owner approval)*
- [ ] T017 Docs: `docs/development.md` (command, options, the author's run with its measured local time, the private rows file, the FR-018 rule), `docs/review-checklist.md` mask line, `docs/agent-notes.md` *Fuzzing a masking change* line replaced by a pointer [FR-025, FR-029]
- [ ] T018 Converge: evidence tags (`test:`, `[IMPLEMENTED]`, `[KNOWN GAP]`) on every FR, `specs-index` status, Changes entry per phase [FR-001..FR-030]

## After the build

- [ ] T019 Retro indicator: two weeks after P2 lands, the share of masking PRs that needed a fix round after their first heavy review, against the 47 % baseline (`npm run ci:stats` where it can tell; review objects otherwise) [SC-006]
- [ ] T020 Once draft PR #1247 has landed: a dated delta under spec 021 *Changes* saying FR-084 point 1 and T061 are built by spec 119 under the owner's three conditions (no committed probe sets), and T061 ticked with that pointer [FR-030]

## Dependencies

P0 → P1 → P2 → P3; T016 waits for OP-1; T020 waits for #1247. Within P1, T002, T003, T005 and T006 are parallel; T004 before T007. Within P2, T012 is parallel to T010 and T011.
