# Implementation Plan: Masking probe harness (spec 119)

**Branch**: `119-masking-probe-harness` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

## Summary

A seeded fuzz tool under `scripts/fuzz/`: a pure core (PRNG, piece generators by class, case composer, the five oracles, value-free output) and a runner (options, a reference copy of the masks taken from git at a fixed commit and compiled in process, the run loop with caps, private rows, the network guard). A toy masker with planted regressions proves the harness catches what it should. CI runs a small budget on PRs that touch the masks (a new `mask` output of the one CI decider) and, after OP-1, a large budget nightly. No new dependency, no network, no shell.

## Technical context

- Masks under test: `src/shared/redact.ts` (shared masks, `unionMasks`, `withoutSplit`, work counters), `src/renderer/safetext.js` (the desk's masks), `src/renderer/liveact.js` (permission card, tool phrase), `src/shared/brainstate.ts` and `src/shared/brainsurface.ts` (brain view), loaded from Node as `scripts/test-redact-monotone.ts` loads them.
- Build: `tsconfig.scripts.json` compiles `scripts/**` to `dist-scripts/`; npm scripts run `tsc -p tsconfig.scripts.json && node dist-scripts/scripts/...` (the pattern of every `test:*` script).
- Tests: `scripts/run-tests.js`, `scripts/test-suites.txt`; suite time limit ~30 s (FR-048b).
- CI: `.github/scripts/ci-changes.js` (one decider, base branch's copy runs on PRs), `.github/workflows/ci.yml` (`Build and test (<os>)`, required; nightly schedule).
- Helpers reused: `scripts/safe-print.js` (`printable`, `emit`), `scripts/redact-growth-lib.ts` (`cpuMs`, backstop only), redact's `_*WorkForTest` counters.

## Constitution check

| Principle | How the plan holds it |
|---|---|
| I Spec Kit | This PR is spec, plan, tasks only; each build PR ticks its tasks and converges the spec. |
| II Adapters | Nothing touches `AgentAdapter`; the tool lives in `scripts/fuzz/`; the only `src/` change is a test-only read-only export (FR-005). |
| III Safe by default, no secrets | No value in any output (FR-014), seeds withheld for pre-existing failures in public output (FR-015), replay without disk (FR-016), private rows only from a git-ignored or outside path (FR-017), no network (FR-019), no shell (FR-022), cleared environment (FR-021), no shape lists in the tool (FR-003, FR-020, source scan). |
| IV No AI credits | No agent involvement; everything offline. |
| V Calm UI | No UI. |
| VI Parity | `execFileSync` with argument arrays, `path.join`, in-process TypeScript compile; the self-test runs in `npm test` on all three OSes; the seed digest is compared across them (SC-003). |
| VII Quality gates | Toy-masker regressions (FR-026) and the harness's own mutants (FR-027), each killed by a named assert on a fresh build. |
| VIII Honest limits | The terminal check of `--show` is a guard, written as `[KNOWN GAP]`; surfaces without exported readings or limits are counted as skipped, never as passed; the 47 % baseline is marked `read:`. |

## Design decisions

- **D1 Layout.** `scripts/fuzz/core/` (pure: `prng.ts`, `pieces.ts`, `compose.ts`, `oracles.ts`, `emit.ts`, `vocab.ts`), `scripts/fuzz/surfaces.ts` (the registry, FR-006), `scripts/fuzz/runner/` (`probe-mask.ts` CLI, `ref.ts` reference copy, `private.ts` rows reader, `guard.ts` network guard), `scripts/fuzz/fixtures/toy-mask.ts` (FR-026). Tests: `scripts/test-probe-mask-core.ts`, `scripts/test-probe-mask-runner.ts`, `scripts/test-probe-mask-self.ts` (each under 30 s; the npm script `test:probe-mask` runs all three in `npm test`). The core imports nothing from Node but types; the runner passes `fs`, `child_process` and the clock in, so tests inject fakes.
- **D2 Piece generators are functions.** Each class of FR-004 is one generator `(rnd, vocab) => string` (or a wrapper `(rnd, inner) => string`). Unicode classes are computed once per run from the code point space (NFKC mapping and general category `Cf` via `\p{Cf}` in a `u` regex), not stored. Escape classes are encoder functions applied at random positions. The composer draws 1..6 pieces by weight, nests wrappers to depth 3, plants a value from the vocabulary at a known offset, and records the piece classes and offsets for the explain view (kept in memory only).
- **D3 Vocabulary export.** `_probeVocabularyForTest()` in `src/shared/redact.ts` returns `{ names, tokenClasses, limits, readings }` built from the same constants the rules use (no copy); a test asserts identity with those constants. The renderer masks get the same export only where they hold their own vocabulary. A run samples the union of the head's and the reference's vocabularies (a word the head drops is still planted); for an older reference without the export, the head's vocabulary is used for both.
- **D4 Reference copy.** `ref.ts`: resolve the commit (`git rev-parse --verify <ref>^{commit}`), list the closure by following relative `import`/`require` string literals from the registry's entry files (the same literal-following idea as `ci-changes.js`'s UI closure), `git show <commit>:<path>` each into `.probe-ref/<commit>/<path>`, check each file's blob hash with `git rev-parse <commit>:<path>`, transpile `.ts` with `typescript.transpileModule` (CommonJS), load with `require` from that folder. Reused across runs for the same commit (a stamp file of the hashes). Fails closed (exit 2) on any step.
- **D5 Oracles in the core.** `o1(headOut, refOut, planted)`, `o2(surfaceOut, readingOuts)`, `o3(streamHead, streamRef)` (per state, built on `o1`), `o4(out, overLimit)`, `o5(workSmall, workLarge)`; each returns `{ ok, pieces? }` where `pieces` are offsets for the explain view, never text. O0 wraps each surface call (`try` / class name).
- **D6 Output.** One `emit(line)` in `core/emit.ts` with the batch's planted values and private rows registered; a line holding a 6-character stretch of any is replaced by `[withheld]` and sets the failure flag. The runner writes only through it (stdout); stderr gets only `emit`-filtered setup errors. Seeds per FR-015 decided in the runner from the reference verdict.
- **D7 Private rows.** `private.ts`: resolve the path (option, env, default), `git rev-parse --show-toplevel` from its folder (not in a repo: allowed), `git check-ignore -q` and `git ls-files --error-unmatch` with argument arrays, size and row caps, JSON per line, rows registered with `emit` before any case runs.
- **D8 Network guard.** `guard.ts` replaces `net.connect`, `net.createConnection`, `tls.connect`, `http.request`, `http.get`, `https.request`, `https.get`, `http2.connect`, `dns.lookup`, `dns.resolve*`, `dns.promises.*`, `dgram.createSocket` with throwing functions for the run; restored only at exit.
- **D9 CI decider.** `ci-changes.js` gets `mask`: the registry's closure computed the same way as D4 but from the working tree (literal-following from `scripts/fuzz/surfaces.ts`), plus `scripts/fuzz/**` and `scripts/test-probe-mask*`; unreadable = true. Because the base branch's copy of the decider runs on PRs, the output appears one PR after the decider change lands (as for every decider output; written in the spec's Changes when built).
- **D10 Seeds in CI.** PR lane seed = first 8 hex of the head sha (public, reproducible, new failures only). Nightly per OP-1; with OP-1 = A the seed is `HMAC-SHA256(secret, date)` truncated to 32 bits, computed in the workflow step from a secret in an environment variable that the tool reads only for `--ci nightly` and never prints.

## Testing plan (all offline)

| Test file | Covers | Planted mutants it must catch |
|---|---|---|
| `scripts/test-probe-mask-core.ts` | FR-003, FR-004, FR-012, FR-014, FR-020 source scan, oracles of FR-008..FR-011 on hand-built outputs | PRNG seeded from the clock; a generator returning a fixed list item; O1 comparing head with head; O2 passing a surface whose reading is dropped; O4 accepting a prefix; O5 on wall time; `emit` filter off; a string literal the masks change slipped into a generator file |
| `scripts/test-probe-mask-runner.ts` | FR-001, FR-007, FR-013, FR-015..FR-019, FR-021, FR-022 | reference loaded from the head; reference file hash not checked; seed printed for a pre-existing case with `CI` set; `--show` on a non-terminal; a tracked or not-ignored private path read; a private row printed; network guard off; environment not cleared; a file left in the temp working folder after a run; an option value reaching git unvalidated |
| `scripts/test-probe-mask-self.ts` | FR-026, SC-001, SC-003 digest | the toy unmodified gives a failure (false positive); each toy regression not caught within the fixed seed and budget |
| `scripts/test-ci-changes.ts` (existing, extended) | FR-023 `mask` output | a registry-closure file gives `mask=false`; an unreadable diff gives `false`; a docs-only PR gives `true` |

Mutants are run on a fresh build each; a kill counts only when the intended assert's text fails (agent-notes: mutant false kill).

## Rollout

P0 spec (this PR) → P1 core + toy masker + vocabulary export, with tests (no CI wiring) → P2 runner, reference copy, private rows, guard, replay; `npm run probe:mask` usable by authors → P3 CI `mask` output and the PR lane step, budget measured; docs; the nightly lane after OP-1. Each phase one PR, heavy profile, reviewed by Paco's side.

## Complexity tracking

None: no new dependency (the `typescript` package is already a dev dependency), no new process, no new workflow (a step in the existing required job; the nightly lane reuses the existing nightly schedule).
