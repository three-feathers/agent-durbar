# Feature Specification: Security and quality sweep before v0.1.0-alpha.6

**Feature Branch**: `045-security-sweep`
**Created**: 2026-10-19
**Status**: Built (2026-10-19)
**Input**: Vikram, 2026-10-19: "look at all security and quality issues and add it to pre release". The sources were GitHub code scanning (30 open CodeQL alerts), Dependabot (1 open alert) and `npm audit` (8 moderate findings, all one chain).

## Triage

| Source | Alerts | Where | Decision |
| --- | --- | --- | --- |
| CodeQL `js/biased-cryptographic-random` (high) | #32 | `src/main/settings.ts` `randomPlaceId` | **Fix** (FR-001) |
| CodeQL `js/double-escaping` (high) | #1 | `src/renderer/app.js` remove-folder confirm | **Fix** (FR-002) |
| CodeQL `js/shell-command-injection-from-environment` (medium) | #31 | `src/main/vscode.ts` (and the same pattern in `src/adapters/detect.ts`) | **Fix** (FR-003) |
| CodeQL `js/incomplete-url-substring-sanitization` (high) | #33 | `scripts/test-codex-modes.ts` | False positive: a test assertion that a summary string mentions a host, not a URL check. Dismissed with that reason. |
| CodeQL `js/bad-code-sanitization` (medium) | #2-#30 | `scripts/e2e-driver.js`, `scripts/shots-*.js` | Dev-only simulator drivers. They build page code from constants with `JSON.stringify` and run it in the local test window; nothing comes from outside. Dismissed as "used in tests". |
| Dependabot / `npm audit`: `sprintf-js` 1.1.3 DoS (moderate) | Dependabot #1, 8 audit lines | build-time only: `electron-builder` > `app-builder-lib` > `@electron/get` > `global-agent` > `roarr` > `sprintf-js` | **Not shipped in the app** and **no patched version exists**. The suggested `electron-builder` "fix" is an old major. Kept, recorded here and in the release notes; dismissed as tolerable risk. |

## Requirements

- **FR-001** `randomPlaceId` draws each of its six characters with `crypto.randomInt(36)`, which is uniform. Before, `randomBytes` modulo 36 favoured the first 4 characters (256 = 7 × 36 + 4). The id shape is unchanged (`c-` + 6 of `[a-z0-9]`). `test:` shape and alphabet over many draws.
- **FR-002** The remove-folder confirmation turns its escaped text back into plain text in **one pass** (`&amp;`, `&lt;`, `&gt;`, `&quot;` each read once). Before, four chained replacements turned `&amp;lt;`, a folder name with `&lt;` in it, into `<`. `test:` the unescape helper on such names.
- **FR-003** On Windows, the `cmd.exe` used for a `.cmd` shim (VS Code's `code.cmd`, spec 009; agent CLIs' `.cmd` shims, spec 012 FR-036) is `%SystemRoot%\System32\cmd.exe` when `SystemRoot` is an absolute path. `ComSpec` is used only when it is an absolute path to a file named `cmd.exe`; otherwise plain `cmd.exe`. Before, any `ComSpec` value from the environment was run. `test:` the choice for each of these inputs.

## Honest limits

- FR-003 is unit-tested only; Windows was not run by hand (as for every Windows path in this project).
- The dismissed alerts stay listed here, so the reasons are in the repository, not only on GitHub.
