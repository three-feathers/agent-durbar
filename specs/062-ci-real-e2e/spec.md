# Feature Specification: End-to-end checks with real accounts in CI

**Feature Branch**: `062-ci-real-e2e`
**Created**: 2026-10-20
**Status**: Built (workflow, script, tests); first runs recorded under `## Changes`.
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
