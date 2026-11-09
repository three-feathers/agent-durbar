# Implementation Plan (as built): Packaging, CI and draft releases

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

`electron-builder` packages `dist/` (compiled TypeScript + copied renderer assets) with one Copilot runtime package per target. GitHub Actions runs CI for every PR/push and a tag-driven release that only ever creates a draft.

## Technical Context

- **Tools**: Electron 44.9.1, electron-builder 26.15.3, Node 22 in CI, `npm ci`.
- **Files**: `package.json` (`build`, scripts `pack:dir`, `dist`, `dist:mac:arm64|x64`, `dist:win`, `dist:linux`), `scripts/prepare-runtime.js`, `scripts/after-pack.js`, `scripts/copy-assets.js`, `build/icon.*`, `.github/workflows/ci.yml`, `release.yml`, `src/adapters/runtime.ts`, `scripts/test-runtime.ts`.
- **Testing**: `npm run test:runtime`; CI matrix; `pack:dir` smoke (`afterPack` assertions).

## Constitution Check

| Principle | Result |
| --- | --- |
| III Safe by default / no secrets | Release workflow has no secrets beyond `github.token`; `contents: write` only in the draft job; actions pinned by SHA. OK |
| VI Parity | CI on 3 OSes; release builds 3 OSes; real use only on Linux. **Partial** |
| VII Gates | typecheck + build + test on 3 OSes; screenshots not applicable. OK |
| VIII Honest limits | README says unsigned/not notarized/no auto-update; FR-010 (never run on macOS/Windows) is stated in README as "macOS/Windows untested". OK |

## As-built architecture

```text
npm run dist:<target> = build (tsc + copy-assets) -> prepare-runtime <target> -> electron-builder --<os> --publish never
electron-builder -> asar (dist, package.json) + asarUnpack(@github/copilot-sdk-*, koffi) -> afterPack check -> dmg/zip | nsis/portable | AppImage
runtime: app (packaged) -> unpackedRuntimePath() -> CopilotClient(RuntimeConnection.forStdio({path}))

ci.yml        pull_request, push main: build-test (3 OS); office-check (ubuntu: build once, layout, then pack:dir:prebuilt; FR-194)
release.yml   tag v*: build (mac, win, linux; tag==version check; typecheck; test; package) -> draft-release (checksums, gh release create --draft)
```

## Project Structure (documentation)

```text
specs/008-packaging-and-release/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| `npm run pack:dir` on Linux, afterPack runtime check | run locally 2026-10-16 | pass (exit 0) |
| `npm run test:runtime` | `npm test` | pass 2026-10-16 |
| CI green on main (3 OS + smoke), tag run produced a draft release | `gh run list`, `gh release list` 2026-10-16 | pass; release is **Draft** |
| Packaged app launch on macOS/Windows, Gatekeeper/SmartScreen steps in README | none | **not verified** |
| Signing/notarization | none | not done (feature 014) |

## 2026-10-22: merge queue and shorter UI runs (T095, FR-098..FR-102)

- Workflows only; no app code. `merge_group` triggers on the two workflows whose checks are required (`ci.yml`, `spec-kit.yml`); `ui-platforms.yml` is not required and keeps running on PRs, `main` and nightly.
- The office layout and the UI suite already shard (`OFFICE_SHARDS`/`OFFICE_SHARD`, FR-021), so the split is matrix only. Linux's second office run in `ui-platforms.yml` is skipped for PR and push events by a matrix `exclude` built from an expression, and its first-half step checks the event.
- Measuring: `gh api .../actions/runs/<id>/jobs` for the PR's own runs against the 45-run baseline in the spec.
- The ruleset (`main protection`, id 25258904) gets a `merge_queue` rule with `gh api -X PUT` after the workflows are on `main` (owner approval 2026-10-22), read back afterwards.

## 2026-10-22: test runs not backgrounded when covered (T096, FR-103)

- **FR-103 (2026-10-22):** two lines in `src/main/main.ts`, next to the other test-run window options (`enableLargerThanScreen`, FR-093): `app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')` before ready, and `backgroundThrottling: false` in `webPreferences`, both only when `dev.DURBAR_DRIVER || dev.DURBAR_SHOT`.

## 2026-10-22: fewer runner tickets per PR, macOS after the merge (T097, FR-104..FR-110, owner decision)

- Workflows and one shell script only; no app code. The ruleset (`main protection`, 25258904) is not changed: its six required check names keep reporting (`Build and test (macos-latest)` from a Linux report job on PRs and queue entries, `Office layout check (xvfb)` from the single office job).
- `.github/scripts/ci-changes.sh` replaces the *What changed* job; each `ci.yml` job runs it after a `fetch-depth: 2` checkout of the test merge commit. Steps carry `if: steps.changes.outputs.code == 'true'` so a docs-only PR's jobs pass in seconds.
- The office layout reuses `scripts/check-parallel.js` (it already runs shards side by side, each with its own xvfb, with a memory guard); no new runner script.
- Matrices that drop macOS outside `schedule`/`workflow_dispatch` are built with `fromJSON(<event test> && '<all>' || '<no macOS>')`; `install-check.yml` filters `.github/platforms.json` with `jq` in its existing platforms job (spec 062 FR-004 keeps one list).
- `nightly-watch.yml` (`workflow_run` on the five workflows, scheduled runs only) uses `gh issue list/create/comment` with the job token (`issues: write` on that job only).
- Measuring: the PR's own runs with `gh api .../actions/runs/<id>/jobs` (queue = `started_at - created_at`, run = `completed_at - started_at`), compared with the before numbers in the spec.
- Pending runs were cleaned up by hand the same morning (owner-approved): superseded PR runs cancelled; the release PR (#517), `main`, tags, the real-account workflows and the newest run of each open PR kept.

## 2026-10-23: fold the release notes at tag time (T104, FR-117..FR-120, owner-approved)

- Reuse spec 025's fold: `changelog.js` gets `notes()` (the section `build` would write, or the version's existing section; writes nothing), `build --stdout` for the command line, and `--previous <tag>` on both (refuse when the previous release is not folded yet). `build` returns the section it wrote, so the notes and the fold PR are the same text.
- `scripts/release-notes.js` (new, plain Node, git through `execFileSync` with argument lists, no shell, no network) does every tag check and writes the notes file and the job summary. It is testable on throwaway git repositories, which a shell step in YAML would not be.
- `release.yml`: new `verify` job (`contents: read`, `persist-credentials: false`, `fetch-depth: 0`, no `npm ci`), `build` needs it, its tag step moves into it; `draft-release` needs both, downloads the packages by pattern and the notes by name, `--draft --prerelease --latest=false --notes-file`. No new permission anywhere.
- The fold into `CHANGELOG.md` stays a person's (or agent's) doc-only PR from the tag, then `git merge origin/main`: the workflow neither pushes nor opens PRs (reasons in FR-120).
- Docs: `changelog.d/README.md` (release steps), `docs/collaboration.md` (*For the maintainer*), AGENTS.md (*Keep docs in sync*: the fold PR, not a release PR), `README.md` (*Development* line), a fragment.

## 2026-10-23: test builds from branches (T105, FR-121..FR-124, owner decision, issue #658)

- One path for both kinds: `release.yml` keeps its trigger and jobs; `scripts/release-notes.js` classifies the tag (`tagKind`: `TEST_TAG_RE` first, then `TAG_RE`), so the pattern is in one tested place and not in YAML.
- Test tag: the FR-118 checks minus the ancestor check and the previous-release check; version = tag without `-test.M`; notes from `git rev-list --count` and `git log --max-count --format=%h%x09%s <main ref>..<commit>` (argument lists, no shell), each subject through `redact` then `cut` from `src/shared/redact.ts`, loaded with Node's type stripping (no `npm ci` in `verify`) and failing closed when it cannot load.
- Title: `--title-out release-title.txt` in `verify`, uploaded with the notes, read into `TITLE` in `draft-release` (no new expression, output or permission).
- Reuse: `redact`/`cut` (spec 012) rather than any new masking; `previousRelease` keeps `RELEASE_TAG_RE`, which already leaves test tags out.
- Tests in `scripts/test-changelog.js` on throwaway repositories (one `git fast-import` for the 102-commit cap case) and the static workflow checks; mutations listed in FR-124.
- Docs: `docs/collaboration.md` (*Cutting a test build*), `changelog.d/README.md` (test builds have no fragments to fold), README *Development* line, a fragment.

## 2026-11-07: the Build cost report (T131, T132, FR-181)

- Plain Node scripts, built-ins only (`http`, `fs`, `os`, `path`, `zlib`), no dependency, no spawn. `usage-lib.js` holds every rule on what may be kept (an allowlist of three attributes, value and name checks); `usage-receiver.js` is the loopback server and the atomic file write; `usage-day.js` reads the files, validates them again (same validator) and prints the table.
- Reuse: no existing usage code fits (spec 011 shows the app's own credits; this is the build team's spend, from Claude Code's telemetry); `scripts/test-suites.txt` and `run-tests.js` for the suite; the changelog fragment and docs-sync rules for docs.
- One file per machine label, so machines never write the same file; the report adds files. Delta temporality only.
- Docs: `docs/build-cost.md`, README, `docs/development.md`, `docs/collaboration.md`, `changelog.d/README.md`.

## 2026-11-08: pull requests skip the CI parts their change cannot affect (T144, FR-191, owner decision)

- One decision, `.github/scripts/ci-changes.js` (plain Node, built-ins only, git through `execFileSync` with argument arrays, no shell). `ci-changes.sh` stays the entry point every job already calls and only runs it, so FR-104's code and themes are unchanged and the new outputs (`ui`, `macos`) come from the same place.
- The UI closure is derived from the tree, not a hand list: roots from `ui-platforms.yml`'s `scripts/*.js`, `check-parallel.js`, `package.json`'s `build` and `pack:dir` and `build.afterPack`; then every string literal in a closure file naming a file or folder in `scripts/` (`require('./x')`, `path.join(__dirname, 'x.json')`, the DRIVERS names). scripts/ is listed once, so a decision takes about 40 ms.
- `ui-platforms.yml` gets a short Linux `changes` job the shards `need` (a skipped shard costs no runner; the decision job about 15 s, against 8 Windows and Linux shards); `macos-pr.yml` decides in the macOS job's first step (it runs rarely, so a decision job would cost more than it saves); `ci.yml` keeps FR-104's no-gate-job layout and only switches the office and package smoke steps from `code` to `ui`.
- `package.json` for `ui` is compared without `version` and without the npm scripts the UI run cannot reach (all but `build`, `pack:dir` and lifecycle hooks): the measurement showed tooling PRs adding an npm script line (`usage:spread`) running the UI suite seven times. "UI suite complete" passes on ui=false and fails when the decision job did not succeed.
- Reuse: FR-104's `ci-changes.sh` and its `fetch-depth: 2` test-merge diff; FR-189's aggregate job; `test-suites.txt` / `run-tests.js` for the new suite `test:cichanges`; `test-ui-suite.ts`'s `jobsOf` for the workflow wiring checks.
- Reviewed and left as they are (already path-filtered to their own files on pull requests, or cheap and required): `spec-kit.yml`, `pages.yml`, `world-matrix.yml`, `install-check.yml`, `installed-app.yml`, `packaged-check.yml`; scheduled and by-hand workflows. Every `npm ci` of the app already goes through `.github/actions/npm-ci` (the Electron download cache); `pages.yml` uses `--ignore-scripts` and loads no Electron.
- Review of PR #1349: the wrapper runs the base copy of the decision (`git show HEAD^1:` into `.ci-changes-base/`, relative so the Windows runner's Git Bash converts no path), as `spec-kit.yml` runs its base scripts (#1316); names print through `scripts/safe-print.js`; a `scripts/` path gone at head or with an unreadable name counts; roots follow `npm run` chains, lifecycle hooks and `.ts` files. `ui-platforms.yml` keeps no `merge_group` trigger (8 shards per queue entry for a check that is not required); the docs were corrected.
