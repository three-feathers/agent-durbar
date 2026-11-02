# Feature Specification: End-to-end checks with real accounts in CI

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: End-to-end checks with real CI accounts on every supported OS: install, sign in, models, one turn through Durbar's adapters; one platform list for OS workflows
status: built
note: real runs green on 3 OSes 2026-11-02 (#856); daily schedule back; Windows has no OS sandbox for Claude or Copilot on the runner
-->

**Feature Branch**: `062-ci-real-e2e`
**Created**: 2026-10-20
**Status**: Built; run 4 on 2026-10-20 passed 9 of 9 (3 apps × 3 OSes), see `## Changes`.
**Input**: Vikram (Telegram, 2026-10-20): "i have created a new dedicated account for ci, stored claude, codex and github tokens as repo secrets - you can use it in ci tests to see if end to end tests work including installation of cli, login, see models,..." and "for all 3 operating systems and new os we support in future as well".

## User Scenarios

### Story 1 - Every supported OS proves the whole path with real accounts (P1)
On each supported OS (Linux, macOS, Windows today, and any OS added later), a CI job installs each agent app the way Durbar does, signs in with the CI account, lists models and runs one tiny read-only turn, all through Durbar's own adapters. A failure names the app, the step and the OS.

**Acceptance**:
1. The job installs Claude Code, Copilot CLI and Codex through `HarnessSetup` (the first route Durbar offers: least privilege first, spec 060).
2. It signs in from the repository secrets only (no interactive login). Detection reports the app as installed, and `verifySignIn` as signed in.
3. `listModelOptions` returns at least one model.
4. One read-only session per app answers "ok" to a one-line prompt. Its usage is recorded and the session is stopped.
5. A Markdown table goes into the job summary and JSON into an artifact. The job fails if any app fails any step.

### Story 2 - A new supported OS is picked up without editing every workflow (P2)
The list of supported CI platforms lives in one file, `.github/platforms.json`. The e2e and install-check workflows read their matrix from it, and a unit test fails if a workflow hard-codes its own list.

## Requirements

- **FR-001** Workflow `.github/workflows/e2e-real.yml`. It runs:
  - on `workflow_dispatch`;
  - daily (`schedule`; was weekly, FR-006);
  - ~~on pushes to `main` that change adapters, install code or the workflow~~ (removed 2026-10-22, FR-006);
  - **never on `pull_request`**, so PR code never runs with the secrets.

  `permissions: contents: read`. The secrets go only to the one step that runs the check.
- **FR-002** Secrets:
  - `COPILOT_CODEX_GITHUB_FINE_GRAINED_TOKEN` → `COPILOT_GITHUB_TOKEN` (the Copilot runtime reads it from its environment);
  - `ANTHROPIC_API_KEY` (Claude Code reads it from its environment);
  - `OPENAI_API_KEY` → `codex login --with-api-key` over stdin.

  **No secret is ever printed, logged, written to a file or put on a command line.** Every line the script prints goes through `redact()`; secret values are also masked by Actions.
- **FR-003** `scripts/e2e-real.ts` runs install → detect → sign-in → models → one turn per app, with fixed limits: 12 min per install, 3 min per turn. Models: `auto` for Copilot, `haiku` for Claude, a small Codex model (FR-008; was the app's default). It never writes outside a temp folder and the app's own install locations.
- **FR-004** The matrix comes from `.github/platforms.json` (`fromJSON` in a small setup job). `scripts/test-platforms.ts` checks that the file is valid and that `e2e-real.yml` and `install-check.yml` use it.
- **FR-005** Honest limits: the CI account's plans decide which models are listed. A `[KNOWN GAP]` is recorded per app and OS until a run passes there.

## Constitution
- III: real accounts only in this opt-in workflow, never in `npm test` or PR CI. Secrets are never stored, logged or committed.
- IV (credits): about 9 one-line prompts per run (3 apps × 3 OSes), well under a cent each on API keys. Owner-approved on 2026-10-20 (the account and secrets were made for this).

## Changes

### 2026-11-02: a failed turn says what happened (#856)

**Why:** the failures of 2026-10-25..2026-10-28 are only `no "ok" in the answer: (empty)` for Copilot and Claude, which does not say where the turn went. The "No network layer" install failures were fixed on 2026-10-27 (spec 081; the scripts pass `nodeDownloadGet`) and Windows/macOS were green on 10-28.
**Change:** the `Detail` of a turn without "ok" adds `events <type:count,...>; status <words>[; sandbox on/off]`, a fixed vocabulary, never message text, then passes through `clean()`. No check is loosened.
**Tasks:** T010.
**Owner decision (Vikram, 2026-11-02, team chat):** fix now and restore the daily run; stability over cost.
**Cost per week** (counted from the hand runs of 2026-11-02, 41374046702 / 41374405248 / 41375398060): the turn runs daily on Linux (7) plus Monday on macOS and Windows (1 each), so 9 turns per app a week; the other days macOS and Windows list models only (no tokens). Copilot 0.068 AIU a turn on Linux and macOS, up to 0.166 on Windows, so about 0.7 AIU; Claude (Haiku) about $0.001 a turn, up to $0.0025 once, so about $0.01 to $0.02; Codex about 13.3k input and 5 output tokens a turn, so about 120k input and 45 output tokens. Retries by hand add to this.

**Cause found by the hand run 41373742601 (2026-11-02):** on Linux (Claude) and Windows (Claude, Copilot) the turn ended with `events sandbox:2,status:2; status idle>stopped` and no message: since spec 087 (2026-10-25) Durbar sends nothing when the agent app's OS sandbox cannot start (`Not sent: the OS sandbox could not start`) and offers *Continue without the OS sandbox*. The check read that early `idle` as the end of the turn. That matches the first red day (10-25). The earlier `No network layer` failures were the missing download getter (fixed 2026-10-27, spec 081).
**Change 2:** the turn takes that offer (`continueWithoutSandbox`, then sends again) **only where this spec records that the runner cannot have the sandbox**: Windows, for Claude and Copilot (`mayContinueWithoutSandbox`, unit-tested in `test-platforms.ts`). There the row's *Read-only turn* column carries the adapter's notice, a recorded gap, not a failure. On Linux and macOS a sandbox that cannot start fails the row with the trace and the notice as detail (a regression, never loosened; a flaky Copilot start on Linux shows red and is reported). The "ok" check is unchanged. The decision in `turn()` is tested with a fake adapter on each platform (`test-platforms.ts`), not only in the helper.
**Change 3 (T009):** the workflow installs `bubblewrap` and `socat` on Linux so Claude's sandbox starts there (the run showed `needs socat`); the `schedule:` block and the cron check in `test-platforms.ts` are back, FR-009's "no schedule" ends (FR-001 and FR-006 daily apply again). On Windows neither Claude Code ("no OS sandbox on Windows") nor Copilot ("requires BaseContainer", the runner's Windows) can start one: that stays a recorded `[KNOWN GAP]` in the row, not a failure.


### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> **built**; real run 2026-10-20: 9/9 (Copilot Free, Claude, Codex on Linux, macOS, Windows); found and fixed the Codex API-key sign-in and the Windows Codex install folder


### 2026-10-29: schedule paused until the red runs are fixed (owner, Vikram; retro #854 B7; tracking issue #856)

**Why:** the scheduled run failed on 4 days in a row (2026-10-25..2026-10-28) at the step "Install, sign in, list models, one turn", on all 3 OSes until 10-27 and on Linux on 10-28, and each run spends real credits. Owner: "pause it until someone fixes it".

- **FR-009** `.github/workflows/e2e-real.yml` has **no `schedule` trigger** (the block is kept as a comment, with a pointer here and to #856). `workflow_dispatch` (with `full_turn`) stays, so it can be run by hand. Supersedes the "daily" part of FR-001 and FR-006 until T009 is done. Not disabled in the repo settings. `scripts/test-platforms.ts` checks that no live `schedule` key exists and that the manual trigger does.

### 2026-10-22: cheaper runs (owner, Vikram, 21:42 UTC)

**Why:** on 2026-10-22 the workflow cost about $2.06 on OpenAI and $0.10 on Anthropic, from about 8 runs × 3 OSes started by pushes to `main` (FR-001's push trigger). Codex ran on its default model with its default reasoning effort. The owner approved cutting it.

Replaces parts of FR-001 and FR-003:
- **FR-006** Triggers: `workflow_dispatch` and a **daily** `schedule` (`17 5 * * *`) only. **No `push` trigger** (and still never `pull_request`). So at most one scheduled run a day.
- **FR-007** The one tiny turn runs **daily on Linux only**. macOS and Windows run install → detect → sign-in → list models every day (no prompt, no tokens) and the turn too on **Mondays** (the weekly full run) or on a manual run with the input `full_turn: true`. The workflow chooses, from the OS, the event and the UTC weekday, whether to pass `--no-turn` to `scripts/e2e-real.ts`; the script then stops after the model list and records the turn as skipped. Redaction and the stdin-only Codex key are unchanged.
- **FR-008** Codex runs a small model with the lowest tested effort, like Claude on `haiku`:
  - model: `E2E_CODEX_MODEL` when set (a Codex id, `codexModelFlag`); otherwise the first model in Codex's own `model/list` whose id has `mini` (then `nano`); otherwise Codex's default (recorded in the table so a run shows which model ran);
  - effort: `E2E_CODEX_EFFORT` when set; otherwise `low` when the model offers it (the effort the spec 012 FR-142 real run used: "a Read-only turn on `gpt-5.6-luna` / `low` answered"), else the first effort the model lists;
  - the prompt stays one line ("Reply with only the word ok."). Codex's app-server has no max-output setting that Durbar's adapter sends (`turn/start` takes `model` and `effort` only, `read:` `src/adapters/codex.ts` FR-142), so the reply is capped by the prompt only.
  - Why not a fixed name: the repo has no recorded Codex model list for the CI account's API key (the only real list, spec 012 FR-142, is a ChatGPT Plus login and names only `gpt-6.1-sol` and `gpt-5.6-luna`), so a hard-coded `-mini` name could not be verified (`read:` spec 012 FR-142, spec 030 research, `scripts/fixtures/models/` which are Copilot's lists).
- Expected spend (estimate, not measured): before, about 9 turns per run and several runs a day from pushes; after, 3 turns a day on Linux plus 6 on Monday's macOS and Windows runs, about 27 turns a week, Codex on a small model.
- `[KNOWN GAP]` not run: no real run was made for this change (to save credits). Whether the CI account's `model/list` offers a `mini` model, and what the first daily run costs, show in its summary table (`Model` column, `Usage`).

### 2026-10-20: first runs (verification pushes from the branch; that trigger is removed)

`real:` four runs on GitHub's ubuntu, macOS and Windows runners, with the CI account (Copilot Free, an Anthropic API key, an OpenAI API key). **Run 4 (39496442403): 9 of 9 passed**:

| App | Linux | macOS | Windows |
|---|---|---|---|
| Copilot (official script; npm on Windows) | ok, `auto`, 0.16 AIU | ok | ok |
| Claude Code 2.1.305 (official) | ok, haiku, ≈ $0.0009 | ok | ok |
| Codex 0.163.0 (official) | ok, read-only turn too | ok with full access; read-only: macOS refused `sandbox-exec` (very likely the symlinked `codex` bug, spec 012 FR-162, fixed 2026-10-23; not re-run) | ok with full access; read-only: elevated sandbox not set up |

What the runs found, each fixed in this change unless noted:
1. **Codex API-key sign-in reported as signed out** (spec 012 FR-156 delta). `account/rateLimits/read` refuses an API-key sign-in although it works; now `getAuthStatus` decides.
2. **Codex not found after OpenAI's Windows installer** (fixed in spec 060, #393): it installs to `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`.
3. **Codex's macOS sandbox refused** on the runner: a plain message now (spec 012 FR-140 delta). *2026-10-23:* very likely caused by starting Codex through a link (`~/.local/bin/codex`), which the sandbox cannot re-run (openai/codex#41493, confirmed on the owner's Mac); Durbar now starts the resolved path (spec 012 FR-162). Not re-run on the runner yet. Owner decision (FR-087 delta, option c): no refusal text suggests a mode, and a **Change mode…** button opens the usual mode menu.
4. **Copilot needed Copilot enabled on the account** (a 403 until the owner turned on Copilot Free). Copilot Free lists **no models** and runs `auto`, so an empty list is recorded, not failed.
5. Script fixes: Codex's `login status` line carried a masked key tail, so only the kind of sign-in is printed now; Windows temp-folder cleanup retries (`EBUSY`).

`[KNOWN GAP]`:
- Claude's sign-in check says "unknown" with an API key ("confirmed at the first message"); the turn proves it;
- Codex read-only on macOS and Windows runners (environment);
- the workflow's `workflow_dispatch` and weekly runs start only after the merge.
