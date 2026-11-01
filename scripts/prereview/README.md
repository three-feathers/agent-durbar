# Pre-review bot (spec 103)

Team tooling, not app code. A read-only first read of one of our PRs for the coordinating session. **Never an approval; it posts nothing to GitHub** unless the off-by-default path of spec 103 FR-027 is switched on by all three owners.

- `cli.mts`: the only file that imports the Agent SDK. Everything else is `scripts/prereview-*.ts`, SDK-free and tested by `npm run test:prereview` with a fake SDK, a fake `gh`, `codex` and `npm`, a local git remote, a generated App key and a fake `fetch`. Tests spend nothing.
- `prompts/`: the starting prompts. A run uses the installed copy of reviewed `main` (`prereview install`), never the PR's own files.
- `package.json`, `package-lock.json`: pinned SDK and `tsx`, **not** a dependency of the app or of root `npm ci`; `test:supplychain` checks this lockfile. The SDK is under Anthropic's Commercial Terms: installed on the server, never shipped or vendored.

Commands: `prereview --help` (it prints the limits, FR-025), `prereview <N>`, `prereview post <N> <sha>`, `prereview install --dest <dir>`. Run with `node_modules/.bin/tsx cli.mts` from the installed copy.

Setup, the key, the limits and the Codex runner: [docs/agent-setup/README.md](../../docs/agent-setup/README.md#pre-review-bot-optional-linux).

Pitfalls found while building it (2026-11-01; agent-notes is at its word budget, so they live here):
- A git config of the account (hooks path, fsmonitor, textconv, external diff) must not reach the bot's git: it runs with a built environment, `GIT_CONFIG_GLOBAL=/dev/null`, a command-line `core.hooksPath`, `--no-ext-diff --no-textconv`; the test plants a hostile global config with a marker.
- The `init` message of the SDK arrives only after the prompt is given to `query()`, so a wrong box is aborted at `init` but the first request may already be in flight; the ledger counts that pass at its ceiling anyway.
- A pass that stops at `init` states no cost, and an unknown cost blocks the next run until a person acknowledges it (an `ack` line in the ledger). That is deliberate.
- `.ts` files of the repo are CommonJS; `cli.mts` (ESM, run by tsx) must import them as a default export.
- `--run-as` runs `node --import <tsx loader by path> cli.mts run` (a plain `node cli.mts run` cannot read TypeScript); `test:prereview` runs that exact command when tsx is installed in this folder (CI's root `npm ci` does not install it, so there it is skipped).
- Codex has no hook: it refuses to start when any key file is readable by its user, so give it a unix user of its own. A glob is allowed only in plain characters (no braces or brackets); a model that wants `*.{ts,tsx}` asks twice.
- A deny-list of path names is the wrong shape for a boundary: check real readability (`access`) and allow-list characters.
