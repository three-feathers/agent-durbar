# Development and how we work

Build, test and run from source; the npm scripts; the spec-driven way of working. Moved out of the [README](../README.md) on 2026-10-31 so the README stays short (spec 021 FR-065); the text is unchanged except for its links.

## Build from source

```bash
npm ci
npm run typecheck && npm run build && npm test   # unit suites in parallel (~20 s); `npm test -- folders` filters; `npm test -- --bail` (or `TEST_BAIL=1`) stops at the first failing suite, for iterating, and the final run still runs everything
npm start                 # the app, with the harnesses you have installed and signed in
DURBAR_SIM=15 npm start   # 15 simulated agents: no sessions, no AI credits (main refuses every call that could reach a real agent app)
npm run test:claudecli    # opt-in, not in `npm test`: the flags Durbar's Claude adapter can send against every installed Claude Code CLI's `--help` (~/.local/share/claude/versions/*, `claude` on PATH, or DURBAR_CLAUDE_BINS=path:path); only `--version` and `--help`, no session, no credits
DURBAR_CLAUDE_BIN=/abs/path/claude npm start   # dev/test only: use that Claude Code file first (absolute path to an existing file; ignored in a packaged build; prints a warning)
npm run check:office      # layout check at 1440x900 and 1280x800 (Electron; xvfb on Linux), simulator only
npm run shots:docs        # retake every screenshot the README and the website link (simulator, one Electron at a time; -- --only, --list, --out <dir>); every picture it writes is palette-compressed (about 60% smaller, with a quality guard)
npm run shots:compress    # compress screenshots by hand: the linked ones, or the files you name (-- --check only lists; DURBAR_SHOTS_COMPRESS=off turns it off in shots:docs)
npm run check:geometry    # Retro lays out exactly like Clean Office (CHECK_ALL_THEMES=1: every theme, about a minute)
npm run check:ui          # every simulator driver that asserts, one after another, on any OS (UI_SUITE_XVFB=1 keeps windows off a Linux desktop); -- --list names them, -- --only check-notes,check-edits runs just those
npm run check:themes      # on demand: the full layout check in every theme, a few at a time, low priority, memory limits
npm run pack:dir          # unpacked app for this OS in release/ (also dist, dist:mac:arm64, dist:mac:x64, dist:win, dist:linux; unsigned); then checks the Electron fuses and the display names
npm run check:fuses-launch  # on demand, after pack:dir: the packed Linux app opens its window and offers no debugger (xvfb on Linux)
npm run specs:index       # the full specs index from each spec's specs-index block, into specs/INDEX.md (git-ignored); --add specs/NNN-x for a new spec; specs:check in npm test, which also refuses conflict markers
npm run labels:backfill   # dry run: the labels each issue and PR is missing (spec 021 FR-045); -- --create-labels --apply adds them (add-only)
npm run changelog:check   # check the changelog.d/ fragments (in npm test); changelog:preview lists them; a tag's notes come from them, then changelog:build folds them (changelog.d/README.md)
npm run rules:check       # word budgets of the rule files (AGENTS.md, CLAUDE.md, agent notes, checklist, ...; in npm test): one rule in, one rule out
```

`npm run smoke` and `npm run verify:cap` use a real Copilot login and may spend credits: run them only on purpose. Under `DURBAR_SIM` the main process refuses every window call except the install-route list and the app version and never creates a real adapter, so a simulator run or driver cannot spend credits; a deliberate real check runs without `DURBAR_SIM` (spec 010 FR-022..FR-027). The **E2E real accounts** workflow (spec 062) installs the three agent apps on Linux, macOS and Windows, signs in with the CI account's secrets and lists models (when run); one tiny turn each (Claude on Haiku, Codex on a small model) runs on Linux and, on macOS and Windows, on Mondays or by hand with `full_turn`. The daily schedule is **paused since 2026-10-29** (it was red from 2026-10-25; issue #856): it runs by hand only, and never on a push or a pull request. The supported CI platforms are listed once, in `.github/platforms.json`. GitHub Actions also runs the UI checks (geometry, office layout, the Mac title bar, `check:ui`) on Windows and Linux for each pull request and on macOS nightly, and keeps the screenshots of each run (workflow *UI on three OSes*; simulator only). macOS does not run on pull requests: build and test runs on every push to `main`, the other macOS checks nightly, and a failed nightly run opens an issue (spec 008 FR-106). Releases are built by GitHub Actions from `v*` tags on `main` into a draft release that the maintainer publishes by hand; a test-build tag (`v0.1.0-alpha.N-test.M`) builds a draft pre-release from any branch, with the unmerged commits as its notes (spec 008 FR-121).

**Layout of the repository:**
- `src/main` (Electron main), `src/preload`, `src/renderer` (plain HTML/CSS/JS, the simulator);
- `src/adapters` (Copilot, Claude Code and Codex adapters, the permission broker), `src/shared`;
- `scripts/` (tests and screenshot drivers), `specs/` (Spec Kit specs), `docs/`.

## How we work

Agent Durbar is spec-driven with [GitHub Spec Kit](https://github.com/github/spec-kit): **no code without a spec, a plan and tasks.**
- Every feature has a folder in [`specs/`](../specs/README.md). Each requirement is tagged `[IMPLEMENTED]` or `[KNOWN GAP]`, with how it was checked.
- The rules are in the [constitution](../.specify/memory/constitution.md).
- A CI check fails a pull request that changes `src/` without changing `specs/`.
- Coding agents follow [AGENTS.md](../AGENTS.md). People start with [CONTRIBUTING.md](../CONTRIBUTING.md) and [docs/collaboration.md](collaboration.md).
- Claim an issue on the [project board](https://github.com/orgs/three-feathers/projects/1) before you start.
