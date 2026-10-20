# Feature Specification: End-to-end checks with real accounts in CI

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
  - weekly (`schedule`);
  - on pushes to `main` that change adapters, install code or the workflow;
  - **never on `pull_request`**, so PR code never runs with the secrets.

  `permissions: contents: read`. The secrets go only to the one step that runs the check.
- **FR-002** Secrets:
  - `COPILOT_CODEX_GITHUB_FINE_GRAINED_TOKEN` → `COPILOT_GITHUB_TOKEN` (the Copilot runtime reads it from its environment);
  - `ANTHROPIC_API_KEY` (Claude Code reads it from its environment);
  - `OPENAI_API_KEY` → `codex login --with-api-key` over stdin.

  **No secret is ever printed, logged, written to a file or put on a command line.** Every line the script prints goes through `redact()`; secret values are also masked by Actions.
- **FR-003** `scripts/e2e-real.ts` runs install → detect → sign-in → models → one turn per app, with fixed limits: 12 min per install, 3 min per turn. Models: `auto` for Copilot, `haiku` for Claude, the app's default for Codex. It never writes outside a temp folder and the app's own install locations.
- **FR-004** The matrix comes from `.github/platforms.json` (`fromJSON` in a small setup job). `scripts/test-platforms.ts` checks that the file is valid and that `e2e-real.yml` and `install-check.yml` use it.
- **FR-005** Honest limits: the CI account's plans decide which models are listed. A `[KNOWN GAP]` is recorded per app and OS until a run passes there.

## Constitution
- III: real accounts only in this opt-in workflow, never in `npm test` or PR CI. Secrets are never stored, logged or committed.
- IV (credits): about 9 one-line prompts per run (3 apps × 3 OSes), well under a cent each on API keys. Owner-approved on 2026-10-20 (the account and secrets were made for this).

## Changes

### 2026-10-20: first runs (verification pushes from the branch; that trigger is removed)

`real:` four runs on GitHub's ubuntu, macOS and Windows runners, with the CI account (Copilot Free, an Anthropic API key, an OpenAI API key). **Run 4 (39496442403): 9 of 9 passed**:

| App | Linux | macOS | Windows |
|---|---|---|---|
| Copilot (official script; npm on Windows) | ok, `auto`, 0.16 AIU | ok | ok |
| Claude Code 2.1.305 (official) | ok, haiku, ≈ $0.0009 | ok | ok |
| Codex 0.163.0 (official) | ok, read-only turn too | ok with full access; read-only: macOS refused `sandbox-exec` | ok with full access; read-only: elevated sandbox not set up |

What the runs found, each fixed in this change unless noted:
1. **Codex API-key sign-in reported as signed out** (spec 012 FR-156 delta). `account/rateLimits/read` refuses an API-key sign-in although it works; now `getAuthStatus` decides.
2. **Codex not found after OpenAI's Windows installer** (fixed in spec 060, #393): it installs to `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`.
3. **Codex's macOS sandbox refused** on the runner: a plain message now (spec 012 FR-140 delta). Owner decision (FR-087 delta, option c): no refusal text suggests a mode, and a **Change mode…** button opens the usual mode menu.
4. **Copilot needed Copilot enabled on the account** (a 403 until the owner turned on Copilot Free). Copilot Free lists **no models** and runs `auto`, so an empty list is recorded, not failed.
5. Script fixes: Codex's `login status` line carried a masked key tail, so only the kind of sign-in is printed now; Windows temp-folder cleanup retries (`EBUSY`).

`[KNOWN GAP]`:
- Claude's sign-in check says "unknown" with an API key ("confirmed at the first message"); the turn proves it;
- Codex read-only on macOS and Windows runners (environment);
- the workflow's `workflow_dispatch` and weekly runs start only after the merge.
