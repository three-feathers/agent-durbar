# Feature Specification: Masking probe harness, public tool, private cases

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Masking probe harness (owner decision 2026-11-22, Paco, three conditions): a public seeded fuzz tool that composes random inputs from pieces and checks the masks against a frozen main copy, so authors run before review what reviewers run by hand; no committed shapes, gaps or repros
status: draft
note: spec, plan, tasks only; nothing built; heavy review profile (Paco); OP-1 (nightly seed) open
-->

**Feature Branch**: `119-masking-probe-harness` (spec, plan and tasks only). The build is one small PR per phase (P1..P3 in [tasks.md](tasks.md)).

**Created**: 2026-11-22

**Status**: Draft. Nothing built, nothing in `src/` or `scripts/` changes in this PR, no dependency is added. One owner question is open (OP-1, the nightly seed); everything else is decided.

**Input**: Owner decision (Paco, relayed by his bot in the team chat, 2026-11-22 18:14 UTC; asked for by Vikram's standing order for a first-time-right kit): **yes** to a public masking probe harness, the fuzz harness reviewers run by hand today and authors cannot, on three conditions: (1) values are generated at random from pieces inside the tool, never from a committed list of secret shapes, known gaps or bypass classes; (2) the tool is published, not the repros: cases that found leaks stay in the owners' private group or private test pieces, never in the repo, issues, PRs, specs or docs; (3) it gets its own spec, is built on Vikram's side, and Paco reviews it under the **heavy** profile (spec 117 FR-020).

## Summary

Masking PRs (spec 012, spec 041, spec 106's brain view) are reviewed with a differential fuzz that the reviewer writes and runs by hand, against `main`. The author has no such tool, so leaks are found in review and fixed in another round. The coordinator's speed review for spec 117 (2026-11-22) put the rework on such PRs at about 47 % (`read:` the brief's figure, not re-measured in this spec).

This spec adds one command, `npm run probe:mask`, that:

1. **composes random inputs from pieces** (transformation classes, FR-004), seeded and deterministic (FR-012);
2. runs them through every masking surface of the **head** and of a **frozen reference copy** of the masks taken from git at a fixed commit (FR-007);
3. checks five oracles (FR-008..FR-011): nothing the reference hides is shown, union readings hide what each reading hides, brain-view streams per state show no more than the reference, over-limit input arrives empty, and the masks' own work counters grow linearly;
4. **prints counts and seeds only, never a value** (FR-014..FR-016), so no log, CI output or pasted summary carries a leaking input;
5. reads reviewers' private cases from a **git-ignored file at run time** (FR-017), never from the repository.

Authors run it before asking for review; PR CI runs a small budget when a masking file changes; a large budget runs nightly.

## What exists today (spec 021 FR-031: reuse first)

| Capability | Where, and what it does | This spec |
|---|---|---|
| Frozen-reference differential | `scripts/test-redact-monotone.ts` (spec 012 FR-182): committed, hash-pinned copies of the masks as they were before one PR (`scripts/fixtures/*-main-ref.*`), a seeded PRNG, fixed piece lists, a fixed set of surfaces | **pattern**: the surface set and the "the reference is not the head" guard are reused; the committed copies are **not** (they freeze one old commit; the probe takes its reference from git at run time, FR-007). The suite itself stays as it is |
| Hidden-character differential | `scripts/test-maskoutgoing-fuzz.ts` (spec 095 T065): seeded, clears the environment before the run | **pattern**: the environment clear (FR-021) |
| Work counters | `src/shared/redact.ts` `_splitWorkForTest`, `_linkWorkForTest`, `_linkPassesForTest`, `_breakCallsForTest` | **reused** by FR-011 |
| CPU-time growth helpers | `scripts/redact-growth-lib.ts` `cpuMs`, `judgeCpu` (agent-notes: CPU time, not wall time) | **reused** only as a backstop beside the work counters (FR-011) |
| Union of readings | `src/shared/redact.ts` `unionMasks`, `withoutSplit`, `_unionMasksForTest` (spec 012 FR-182) | **reused** by FR-009 |
| Brain-view reducer | `src/shared/brainstate.ts` `brainState`, `src/shared/brainsurface.ts` (spec 106 FR-001, FR-021) | **reused** by FR-010 |
| CI by diff | `.github/scripts/ci-changes.js`, the one decider (spec 008 FR-104, FR-191; spec 117 FR-011) | **extended**: one new output `mask` (FR-023) |
| Safe printing | `scripts/safe-print.js` `printable`, `emit` | **reused** for every printed name (FR-014) |
| Review profile | spec 117 FR-020/FR-021 (heavy unless on the light list) | **reused**: `scripts/fuzz/**` is not on the light list, so it is heavy (FR-028) |
| Shared fuzz harness rule | spec 021 FR-084 point 1 and task T061 (both only on draft PR #1247, branch `021-delivery-speed`, not on `main`): one harness under `scripts/fuzz/`, run before a security-relevant PR's first push | **built here** (FR-030); its "probe sets from the reviews of" six named PRs is replaced by owner condition 1 |
| `npm run test:probe` | already taken by the office layout probe (spec 001 FR-033) | **not reused**; the new names are `probe:mask` and `test:probe-mask` |

What does not exist and this spec adds: piece generators by class, a run-time reference taken from git, the five oracles as one pure core, the value-free output path, the private-rows reader, the `mask` CI output, and the self-test against a toy masker with planted regressions.

## Clarifications

### Owner decisions

- **2026-11-22, Paco (team chat 18:14 UTC, relayed by his bot), yes on three conditions.** Recorded as FR-003 and FR-020 (condition 1), FR-014..FR-018 (condition 2), FR-028 and this spec's existence (condition 3).

### Open owner question

- **OP-1 Nightly seed.** The nightly run (FR-024) prints its results in a public Actions log. A seed printed there for a case that fails on `main` would be a public repro. Options: **A** the seed is derived from an owner-held Actions secret and the date (`HMAC-SHA256(secret, YYYY-MM-DD)`); the log shows the date and counts only, and an owner holding the secret replays it locally (needs one repository secret: a repo setting, owner approval); **B** the nightly prints counts only and keeps no seed; an owner reruns a large local budget to find the case again (may not find it); **C** no nightly in Actions; the large budget runs on an owner's machine on a schedule, and Actions runs only the PR budget on `main` pushes. Recommended: **A**. Until OP-1 is answered, P3 builds the PR lane only (T016 waits).

### Decided in this spec (not owner decisions)

- **Scope of condition 1**: it binds the new tool, its tests and its fixtures (`scripts/fuzz/**`, `scripts/test-probe-mask*.ts`). The existing masking suites keep their own fixtures; this spec does not change them.
- **The note on spec 021 FR-084/T061 lives here, not in spec 021.** FR-084 and T061 exist only on draft PR #1247; a dated delta on `main` would name a task `main` does not have and would collide with that PR's edits of the same file. T020 adds the pointer in spec 021 once #1247 has landed.

## User Scenarios & Testing *(mandatory)*

### User Story 1: an author finds the leak before review (Priority: P1)

Asha changes a mask in `src/shared/redact.ts`. Before asking for review she runs `git fetch origin main` and `npm run probe:mask -- --budget 20000`. The tool takes the reference copy from the merge-base with `origin/main`, runs 20,000 cases, and prints one line per oracle and surface. One line fails: `FAIL O1 surface=maskSecretArgs seed=40711 case=1834`. She runs `npm run probe:mask -- --replay 40711:1834` and sees which piece classes and offsets the head shows and the reference hides, never the characters; she fixes the mask and reruns with the same seed: 0 failures. Her `checks run at <sha>` comment carries only the summary line.

**Acceptance**: 1. A head with a planted regression (the toy masker mutant of FR-026) gives a failing line with oracle, surface, seed and case. 2. The same seed and budget give the same failing case on Linux, Windows and macOS. 3. Neither the run nor the replay writes a value to disk (FR-016, SC-005).

### User Story 2: a reviewer runs private cases without publishing them (Priority: P1)

Paco's bot keeps the cases that found leaks in earlier reviews in a private file outside the repository. It runs `npm run probe:mask -- --private <path> --budget 200000` on the PR head. The output names failing rows by line number only. Findings go to the author through the owners' private group; the PR comment says "probe finding (private): oracle O1, surface S, 1 case".

**Acceptance**: 1. A private file inside the repository that git does not ignore, or that git tracks, is refused before it is read (exit 2). 2. Rows are never printed, in any mode. 3. Without the file the run says `private rows: none` and goes on.

### User Story 3: CI runs a small probe on masking PRs only (Priority: P1)

A PR touching `src/renderer/safetext.js` gets `mask=true` from the CI decider; the Linux `Build and test` job runs the probe with the PR budget against the PR's base commit. A PR touching only a world pack does not run it.

**Acceptance**: 1. `mask=true` for any file the surfaces registry reaches by relative import, and for `scripts/fuzz/**`; `false` for docs, specs and unrelated renderer files; an unreadable diff runs it (fail open). 2. A case that also fails on the base commit is counted as pre-existing and printed **without** a seed (FR-015). 3. The step stays under 60 s on the Linux runner (SC-004).

### User Story 4: the tool proves it can catch regressions (Priority: P1)

`npm test` runs `test:probe-mask`: the harness against a toy masker built from pieces, first unmodified (0 failures: no false positives), then each planted regression (each one caught by its own oracle within the fixed self-test budget).

### User Story 5: a large budget runs nightly (Priority: P2, waits for OP-1)

The nightly CI run probes `main` against the latest release tag with a large budget and prints counts only (seed handling per OP-1).

### Edge cases

- No `origin/main` or no merge-base: exit 2, `fetch origin main first (the probe never uses the network)`.
- Reference equals head (no masking change): the differential oracles pass trivially and the summary says `ref = head`; the absolute oracles still run.
- The reference copy does not compile or load (a very old commit): exit 2 with the module name only.
- A surface new in the head (absent in the reference): its differential oracles are skipped and counted as `new surface: absolute oracles only`.
- A surface throws on a case: counted as a failure of oracle O0 (the surface must not throw), printed with the error's class name only, never its message (FR-014).
- The time cap is reached before the budget: exit 3, `budget not reached: N of M cases` (a failure in CI, a warning locally).
- A run on a machine where a secret-like environment variable is set: the case runs see a cleared environment (FR-021), so results do not depend on the machine.

## Requirements *(mandatory)*

### The command

- **FR-001** **One command.** `npm run probe:mask -- [--seed N] [--budget M] [--ref <commit>] [--surfaces a,b] [--oracles O1,O2] [--max-seconds S] [--replay <seed>:<case>] [--show] [--private <path>] [--ci pr|nightly]`. Defaults: a random 32-bit seed (printed at the start), budget 2,000 cases, reference = `git merge-base HEAD origin/main`, every surface, every oracle, a 300 s cap. Every option value is validated (integers in range, a known surface or oracle name, a commit that `git rev-parse --verify` accepts); anything else is exit 2 with the option name only. Exit codes: 0 pass, 1 an oracle failed, 2 usage or setup error, 3 budget not reached.
- **FR-002** **Home and split.** The tool lives in `scripts/fuzz/` (the folder spec 021 FR-084 point 1 names): a **pure core** (piece generators, case composer, oracles, output formatting; no `fs`, no `child_process`, no `process.env`, no clock) and a **runner** (options, the reference copy, the run loop, caps, private rows, the network guard). The core is tested without the runner.

### Values from pieces (owner condition 1)

- **FR-003** **Random from pieces, inside the tool.** Every case is composed at run time by piece generators: each generator is a function that produces random output of one transformation class (FR-004) from the seeded PRNG. The tool, its tests and its fixtures contain **no** literal list, table, regular expression, fixture or data file of secret shapes, of known gaps, of bypass classes, or of review cases; concrete name words and token character classes come at run time from the masking modules under test (FR-005), never copied into the tool. A new piece class is a general transformation class (as broad as those in FR-004); a class narrower than one of them is refused in review.
- **FR-004** **Piece classes, by class only.** (a) separators and spacing; (b) quoting and nested quoting; (c) line breaks and line continuations; (d) letter case; (e) Unicode lookalikes, generated at run time from Unicode data (characters whose NFKC form is a token character); (f) invisible joiners and format characters, generated at run time from Unicode general category `Cf`; (g) escapes and encodings, as functions applied at random positions (percent-encoding, character references, string-literal escapes); (h) markup and text-format marks; (i) wrappers in the form each surface receives (a command line, an argument list, a URL, Markdown, an event payload); (j) length and budget edges: each surface's exported length limits, minus one, at, plus one and far over (FR-005), and a geometric spread of lengths up to the case size cap. A case composes 1 to 6 pieces in random order with nesting depth at most 3; each class has a weight, printed in the summary.
- **FR-005** **Vocabulary and limits at run time.** The masking modules expose one read-only, test-only export each (`_probeVocabularyForTest()` in `src/shared/redact.ts`, and in the renderer masks where they have their own vocabulary) returning the name words, token character classes and length limits their rules already use. The tool samples from it, and mixes in random words from no vocabulary as controls. When the reference commit predates the export, the head's vocabulary serves both sides. The export adds no behaviour; a test checks it returns the same values the rules use (no second copy to drift).

### Reference and oracles

- **FR-006** **Surfaces registry.** `scripts/fuzz/surfaces.ts` names every surface the probe runs, each as `name -> (module set) -> (input) -> output`: at least the set `test-redact-monotone.ts` covers (the shared masks, the desk's masks, the permission card and tool phrase, the outgoing and note masks) plus the brain view's texts (FR-010). The registry is the single list the CI decider follows (FR-023).
- **FR-007** **Frozen reference copy.** The reference is the masks at one commit (`--ref`, default the merge-base with `origin/main`; in PR CI the base commit; nightly per FR-024): the runner reads every file the registry reaches by relative import with `git show <commit>:<path>` (`execFileSync('git', [...])`, no shell), writes them with the same relative layout into `.probe-ref/<commit>/` (git-ignored, code only, never a case), compiles TypeScript in process with the repository's own `typescript` package (`transpileModule`, no `tsc` or `npx` spawn), and loads it. The copy is checked to be the commit's text (a hash per file, against `git rev-parse <commit>:<path>`) and **not** the head (at least one file differs, or the summary says `ref = head`). The probe never fetches; the author fetches.
- **FR-008** **O1, words the reference hides shown = 0** (differential). For each case and surface, both outputs are cut into pieces at blanks and at mask marks; a piece of the head's output that the reference's output replaced by a mask, or a stretch of a planted value (8 characters of a body, or the whole value when shorter) that the reference hides and the head shows, is one failure. O0 (no surface throws) runs with every oracle.
- **FR-009** **O2, union readings hide what each reading hides** (absolute). For a surface built as a union of readings, where the module exports the single readings (`withoutSplit` and the split reading, FR-005's export lists them), every span a single reading hides is hidden in the surface's output. A surface without exported readings is counted as `skipped (no readings)`, never as passed.
- **FR-010** **O3, brain streams per state** (differential). Generated event sequences (tool starts, updates, completions, failures, thinking, replies, permission events, with generated arguments) drive `brainState` and the brain surface texts of the head and the reference; for every state the reducer reaches, each emitted text obeys O1 against the reference's text for the same sequence and state.
- **FR-011** **O4, over-limit input arrives empty, and O5, work grows linearly** (absolute). O4: input over a surface's exported limit (FR-005) gives an empty output (or the surface's documented empty form), never a partly masked prefix; a surface with no exported limit is counted as `skipped (no limit)`. O5: a case is run at two sizes 8x apart and the masks' own work counters (`_splitWorkForTest` and the others) may grow by at most 8 times a fixed slack (16 at most); wall time is never asserted, and CPU time (`cpuMs`) is only a loose backstop.

### Determinism and caps

- **FR-012** **Deterministic by seed.** One PRNG (mulberry32 over a 32-bit seed) in the core; same seed, budget and tool version give the same cases on every OS and supported Node version. Generation reads no `Math.random`, clock or environment. The self-test compares a digest over the whole run's inputs (never per value) between two runs and across the three CI operating systems.
- **FR-013** **Caps.** `--budget` counts cases; `--max-seconds` stops the run (a safety stop, not an oracle); case size is capped at 64 KiB except the O4 and O5 cases (at most 1 MiB). Memory stays bounded: cases are generated one at a time and dropped after their oracles.

### Output without values (owner condition 2)

- **FR-014** **Counts and seeds only.** Per oracle and surface the summary prints cases run, passed, failed, skipped and pre-existing. A failure prints oracle id, surface name, seed and case index (subject to FR-015). It never prints an input, an output, a value, an excerpt, a value's length or hash, the piece sequence of a case (outside the local replay, FR-016), a surface's error message (only its class name), or a stack trace. All output goes through one `emit()` in the core that keeps every planted value and private row of the current batch (not the control words, surface or oracle names) and refuses a line holding a stretch of 6 or more of their characters: the line is replaced by `[withheld]` and the run fails. Names are printed through `scripts/safe-print.js`.
- **FR-015** **Seeds in public output.** When `CI` or `GITHUB_ACTIONS` is set, or `--ci` is given, a failing case's seed and index are printed only when the reference passes the same oracle on that case (the failure is new in this change). A case that fails on the reference too is counted (`pre-existing: N`) and never seeded. Locally (none of those set) every failure is seeded.
- **FR-016** **Local replay, no disk.** `--replay <seed>:<case>` re-creates one case in memory and prints the explain view: oracle, surface, the piece classes in order (class names only), offsets, and which pieces the head shows and the reference hides; no characters. `--show` adds the characters only when stdout and stderr are both terminals and `CI`/`GITHUB_ACTIONS` are unset; otherwise it is refused (exit 2). Every replay starts with `private: do not paste into GitHub, specs, docs or chat outside the owners' private group`. Nothing is written to disk: no temp file, cache or log. An agent's shell is usually not a terminal, so agents get the explain view only; `[KNOWN GAP]` the terminal check is a guard, not a guarantee (a terminal recorder or scrollback can keep what `--show` printed).
- **FR-017** **Private rows at run time.** Extra cases are read from `--private <path>`, else `DURBAR_PROBE_PRIVATE`, else `<repo>/.probe-private/rows.jsonl`; `.probe-private/` is added to `.gitignore`. Before reading, a path inside a git work tree is refused unless `git check-ignore` reports it ignored, and refused when `git ls-files --error-unmatch` finds it tracked (both by `execFileSync` with an argument array). Format: one JSON object per line, `{"surface": "<name>", "input": "<text>"}` (a row may carry a free `label`, which is never printed); at most 10,000 rows and 1 MiB; a bad line is skipped and counted by its line number. Rows run through every oracle that applies; output names a failing row by line number only. No workflow creates, uploads or caches the file.
- **FR-018** **Where cases live.** A case that found a leak (a seed, a replay, a private row, a reviewer's own input) moves between owners only through the owners' private group or private files; never through the repository, issues, PRs, PR comments, specs, docs, Actions logs or artifacts, or gists. The PR that fixes it describes it as `probe finding (private)` with oracle and surface name only, and adds no case-specific assert; the case stays in the private rows. Docs describe the file and this rule, never a row.

### Safety

- **FR-019** **No network.** Before the first case the runner replaces the connect and request functions of `net`, `tls`, `http`, `https`, `http2`, `dns` and `dgram` with functions that throw; a test plants a call from a surface and sees the run fail with O0.
- **FR-020** **What the tool and its output must never contain** (the safety review list for every PR touching `scripts/fuzz/**`): (a) a literal that looks like a credential of a real service, or a list, table or pattern of secret shapes; (b) a list of known gaps, bypass classes, or review cases, issue numbers or labels tied to a leak; (c) a reproduction: a fixed input, seed or recipe that once leaked; (d) any private row or its content; (e) generated values in output (FR-014); (f) environment values; (g) tokens. Checked by `test:probe-mask`: a source scan fails when a string literal in `scripts/fuzz/**` is changed by the head's `redact()` (a literal the masks treat as a secret is a shape), or when a generator file holds an array literal of 3 or more strings (generators are functions, not lists).
- **FR-021** **Machine-independent runs.** Case runs see a cleared copy of the environment (the masks read secret-like environment values), restored afterwards, as `test-maskoutgoing-fuzz.ts` does.
- **FR-022** **No shell, every OS.** Git is called by `execFileSync('git', args, { shell: false })` with arguments only from validated values (a commit after `rev-parse --verify`, repository paths from the registry); paths through `path.join`/`path.resolve`; no POSIX-only path or shell assumption. `npm test` runs the self-test on Linux, Windows and macOS.

### CI, authors and reviewers

- **FR-023** **PR lane.** `.github/scripts/ci-changes.js` gains `mask=true|false`: true when a changed path is in the closure the registry (FR-006) reaches by relative import, or under `scripts/fuzz/`, or cannot be read (fail open). On a pull request with `mask=true`, the Linux leg of the existing required `Build and test` job runs `npm run probe:mask -- --ci pr --ref HEAD^1 --budget <B> --seed <first 8 hex of the head sha>` (a step in that job, under its required name, spec 117 FR-018; no new non-required job). `<B>` is set at build time so the step ends under 60 s on the Linux runner, and written in this spec.
- **FR-024** **Nightly lane** (waits for OP-1). The nightly CI run probes `main` against the latest release tag with a budget of 1,000,000 cases or a 45-minute cap, one Linux job, counts only; seed handling as OP-1 decides.
- **FR-025** **Author's run.** Before asking for review on a PR that changes a file in the registry's closure: `git fetch origin main`, then `npm run probe:mask -- --budget 20000` (the local time is measured at build and written in `docs/development.md`); a failure is fixed before review. The `checks run at <sha>` comment carries only the summary line (`probe:mask at <sha>: <N> cases, 0 failures, ref <sha>`).
- **FR-026** **Self-test against a toy masker.** `scripts/fuzz/fixtures/toy-mask.ts`: a small masker for an **invented** token family whose letters and name words are drawn from pieces with a fixed internal seed when the module loads (no real-world meaning), with one surface per oracle shape (a plain surface, a union of two readings, a stream with states, a length limit, a counted loop). Planted regressions, each switched on by a flag: one per piece class of FR-004 (the step that reads that class is skipped), the union drops one reading, the stream shows more in one state, over-limit returns a prefix, the loop turns quadratic. `test:probe-mask` runs the harness with the toy as both reference and head (0 failures) and with each regression as head (caught by its own oracle within the fixed seed and a budget of at most 5,000 cases).
- **FR-027** **The harness's own mutants.** Each killed by its own named assert, on a fresh build (a mutant "killed" by a compile error or a missing script is not killed): O1 comparing the head with itself; `emit()`'s filter off (a canary value reaches stdout); a seed printed for a pre-existing case in CI mode; `--show` allowed without a terminal; a tracked or not-ignored private path accepted; the network guard off; the PRNG seeded from the clock; O5 asserting wall time; the reference loaded from the head.
- **FR-028** **Heavy profile.** Every PR touching `scripts/fuzz/**`, `scripts/test-probe-mask*.ts` or the `_probeVocabularyForTest` exports is reviewed under the heavy profile (spec 117 FR-020; these paths are not on the light list), by Paco's side for this spec's build (owner condition 3), with mutants and the FR-020 list.
- **FR-029** **Docs.** `docs/development.md`: the command, its options, the author's run, the private rows file and FR-018's rule. `docs/review-checklist.md`: the mask line points to the probe. `docs/agent-notes.md`: the *Fuzzing a masking change* line is replaced by a pointer to the probe (one line out, one in); the *Shell-wrapper fuzz args* line stays (a platform fact the wrapper class follows). No user-visible change, so no README or `docs/features.md` row.
- **FR-030** **Spec 021 FR-084 point 1 and T061.** This spec builds the shared fuzz harness that FR-084 point 1 and T061 (draft PR #1247) describe, under the owner's three conditions: there are no committed probe sets from earlier reviews (condition 1 replaces that clause); `npm test` runs the self-test and a small fixed-seed probe (FR-026, T013). The dated pointer in spec 021 is added once #1247 has landed (T020).

## Success Criteria *(mandatory)*

- **SC-001** The self-test catches every planted regression of FR-026 with the fixed seed and at most 5,000 cases, and reports 0 failures on the unmodified toy.
- **SC-002** In the runner tests, planted canary values pushed through every output path (summary, failure line, thrown error, assert message, replay without `--show`) never reach stdout or stderr.
- **SC-003** The same seed and budget give the same whole-run digest on the Linux, Windows and macOS CI legs.
- **SC-004** The PR lane's step takes under 60 s on the Linux runner; `test:probe-mask` under 30 s (FR-048b).
- **SC-005** A probe run and a replay create or change no file in the working tree other than `.probe-ref/` (code only), and none outside it (checked on a temporary working folder before and after).
- **SC-006** Indicator for the weekly retro, never a gate: the share of masking PRs that need a fix round after their first heavy review, two weeks after P2 lands, against the 47 % baseline of the brief.

## Assumptions

- The masks stay importable from Node (as `test-redact-monotone.ts` imports them today), including the renderer's CommonJS-style modules.
- GitHub's PR checkout is the test merge commit with `fetch-depth: 2`, so `HEAD^1` is the base (as `ci-changes.js` relies on).
- The repository's `typescript` package can transpile older commits' masking files (if one cannot, the run says so, exit 2).

## Out of scope

- Changing the existing masking suites or their fixtures; new masking rules (each found leak is fixed in its own spec 012 delta); fuzzing non-masking parsers (links, paths outside the masks, IPC); a hosted service; any network use.

## Changes

- **2026-11-22, spec created** (owner decision of Paco, team chat 18:14 UTC, relayed by his bot): spec, plan and tasks only. Spec 021 FR-084 point 1 / T061 (draft PR #1247) is built by this spec (FR-030); the pointer in spec 021 waits for #1247 (T020), because a delta on `main` now would name a task `main` lacks and would collide with that PR's edits.
