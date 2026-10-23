# Implementation Plan: Harness setup inside the app

**Branch**: `051-harness-setup` | **Spec**: [spec.md](spec.md) | **Issue**: #299

## Technical context

- Electron main (TypeScript), preload (typed bridge), renderer (plain JS), as elsewhere.
- Reuses: `candidates()`, `CMD_UNSAFE`-style checks and `windowsCmd()` (detection, spec 012/045), `redact()` (spec 012 T051), `app:openExternal`'s http(s) check, the `adapters:list` refresh, the Settings screen sections and the `dialog()` helper.
- No new dependency.

## Constitution check

- **I Spec Kit:** spec, plan and tasks come before `src/`.
- **II Adapter boundary:**
  - Copilot's sign-in status is an optional adapter method (`authStatus`), so the renderer and `src/shared` see only `{ signedIn }`;
  - harness names and commands live in `src/shared/harnesssetup.ts` as data (ids, package names, hosts), not adapter types.
- **III Safe by default, no secrets:**
  - argv only, no shell, no downloaded scripts;
  - a one-time code goes only to Claude's own process;
  - links are allowlisted per harness;
  - output is shown through `redact()` and never logged.
- **IV No AI credits:** detection, `getAuthStatus()` and the flows themselves are free. Tests use fake processes.
- **V Calm UI:** one primary button per card; text at least 10.5px; the dialogs fit at 1280x800.
- **VI Windows/macOS/Linux:**
  - plans per OS;
  - `.cmd` handling as in detection;
  - the process tree is killed with `taskkill /T` on Windows and the process group elsewhere.
- **VIII Honest limits:** winget and Homebrew routes are from the docs and not tried here, and are marked so.

## Design

1. `src/shared/harnesssetup.ts` (pure, unit-tested):
   - `installPlans(kind, platform, found)`, `updatePlans(...)`;
   - `signInPlan(kind)`;
   - `parseSignIn(kind, text)`, which returns `{ url?, code?, needsPaste }`;
   - `stripAnsi`, `allowedSignInUrl(kind, url)`, `validPaste(text)`;
   - `OFFICIAL_PAGES`.
2. `src/main/harnesssetup.ts`, a `HarnessSetup` class with injected `spawn` and `findOnPath`:
   - `plans(kind)`, `run(op)`, `paste(text)`, `cancel()`;
   - events `harness:progress` (`{ phase, lines, url?, code?, needsPaste?, elapsedMs }`) and `harness:done` (`{ ok, code?, lines }`);
   - one operation at a time; timeouts; tree kill.
3. IPC: `harness:plans`, `harness:run`, `harness:paste`, `harness:cancel`, `harness:copilotAuth`; preload and `DurbarApi` additions.
4. The Copilot adapter's `authStatus()` goes through the shared client.
5. Renderer: the Harnesses section in `screens.js` (cards), the install and sign-in dialogs, and the entry points (welcome, New session hint).
6. Simulator: canned states and outputs in `sim.ts`.
7. Tests:
   - `scripts/test-harnesssetup.ts`, covering the pure module and the runner with a fake spawn;
   - the screenshot driver `scripts/shots-051-setup.js`.

## Complexity tracking

None beyond the issue's scope. Remote control and channels (#298) are a separate spec; they may reuse the dialog frame.

## Delta 2026-10-23: the signed-in account (FR-011..FR-015, issue #617)

- Reuses the sign-in path: the same calls the sign-in checks already make (Copilot `getAuthStatus()`, Claude `auth status --json` through `detect.ts`'s `execFound`, Codex's short-lived app-server `probe`), the `harness:*` IPC module and its `fromApp` guard, and the Settings cards in `harnesses.js`. No new dependency.
- `src/shared/account.ts` (pure, no imports): the type, `cleanName`, `accountLine`. Main formats the line; the window only shows `{ status, text }`.
- `src/main/accounts.ts`: a per-run cache (`createAccountCache`) with injected `check(id)` and a timeout; unit-tested. Wired in `src/main/ipc/harness.ts` (`harness:accounts`) and cleared from `afterSignIn`.
- Constitution III: account data is personal; it never leaves the window path (FR-015). II: vendor fields are mapped inside each adapter.
