# Pre-review bot (spec 103)

Team tooling, not app code. A read-only first read of one of our PRs for the coordinating session. **Never an approval; it posts nothing to GitHub** unless the off-by-default path of spec 103 FR-027 is switched on by all three owners.

- `cli.mts`: the only file that imports the Agent SDK. Everything else is `scripts/prereview-*.ts`, SDK-free and tested by `npm run test:prereview` with a fake SDK, a fake `gh` and `npm`, the real pinned SDK binary against a loopback mock, a local git remote, a generated App key and a fake `fetch`. Tests spend nothing.
- `prompts/`: the starting prompts. A run uses the installed copy of reviewed `main` (`prereview install`), never the PR's own files.
- `package.json`, `package-lock.json`: pinned SDK and `tsx`, **not** a dependency of the app or of root `npm ci`; `test:supplychain` checks this lockfile. The SDK is under Anthropic's Commercial Terms: installed on the server, never shipped or vendored.

Commands: `prereview --help` (it prints the limits, FR-025), `prereview <N>`, `prereview post <N> <sha>`, `prereview install --dest <dir>`. Run with `node_modules/.bin/tsx cli.mts` from the installed copy.

Setup, the key and the limits: [docs/agent-setup/README.md](../../docs/agent-setup/README.md#pre-review-bot-optional-linux).

Pitfalls found while building it (2026-11-01; agent-notes is at its word budget, so they live here):
- A git config of the account (hooks path, fsmonitor, textconv, external diff) must not reach the bot's git: it runs with a built environment, `GIT_CONFIG_GLOBAL=/dev/null`, a command-line `core.hooksPath`, `--no-ext-diff --no-textconv`; the test plants a hostile global config with a marker.
- The `init` message of the SDK arrives only after the prompt is given to `query()`, so a wrong box is aborted at `init` but the first request may already be in flight; the ledger counts that pass at its ceiling anyway.
- A pass that stops at `init` states no cost, and an unknown cost blocks the next run until a person acknowledges it (an `ack` line in the ledger). That is deliberate.
- `.ts` files of the repo are CommonJS; `cli.mts` (ESM, run by tsx) must import them as a default export.
- `--run-as` runs `node --import <tsx loader by path> cli.mts run` (a plain `node cli.mts run` cannot read TypeScript); `test:prereview` runs that exact command when tsx is installed in this folder (CI's root `npm ci` does not install it, so there it is skipped).
- The binary trims a Read path but not a Grep or Glob path: `" /abs/dir"` was resolved by the hook as a look-alike folder and read as `/abs/dir` by the tool. Any whitespace, quote or control character at either end of a path or glob is refused; a fake SDK cannot show this, so `test:prereview` also drives the real binary against a loopback mock (fake key, no network). Run `npm ci --ignore-scripts` here first (CI does it on the Ubuntu job).
- A deny-list of names is the wrong shape for a boundary: allow-list characters, and check what the real binary reports at `init` (the pinned SDK adds `StructuredOutput` and loads built-in plugins and agents that cannot be switched off).
- A deny-list of path names is the wrong shape for a boundary: check real readability (`access`) and allow-list characters.
- A PR-shipped `.ignore` or `.rgignore` hides files from the Grep tool (checked with the real binary); `stripLinks` deletes them at any depth. `.gitignore` is inert without a `.git`, and the whole `.git` is removed.
- Mask only after stripping invisible characters, and mask strings before `JSON.stringify` (it writes a control character as six visible characters). The key goes to the claude process on fd 3, not in its environment.
- Mask every spelling of a key, not the one you have seen: a key glued to a letter (`xsk-ant-…`), a PGP block (`PRIVATE KEY BLOCK`), lower case and runs of spaces. Files with a NUL byte and folders such as `.svn` are invisible to Grep and to the diff text, so the report names them (`NOT SEARCHED`).
