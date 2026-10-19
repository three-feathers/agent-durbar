# Plan: Security and quality sweep (045)

- FR-001: `src/main/settings.ts`, `crypto.randomInt`; test in `scripts/test-settings.ts` (or the places test that already covers ids).
- FR-002: a pure `unescapeHtml` next to `esc` in `src/renderer/app.js`. Its test is a copy of the one-liner in a unit test, kept in step by a source check.
- FR-003: a pure `windowsCmd(env)` in `src/shared/wincmd.ts`, used by `src/main/vscode.ts` and `src/adapters/detect.ts`; tests in `scripts/test-wincmd.ts` (added to `npm test`).
- Alerts: dismiss #2-#30 ("used in tests") and #33 ("false positive") with comments after the fixes merge. Dependabot #1 ("tolerable risk"). The fixed alerts close on the next scan of `main`.
