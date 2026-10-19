# Implementation Plan: Profiles (049)

**Status**: Draft. Waits for the owner's answers in spec.md. Phase 2 also waits for research R1.

## Technical Context

Electron `userData` is set before the first read. `DURBAR_USER_DATA` already does this as a developer hook (spec 010). Adapters spawn their CLIs with argument arrays and an explicit env (spec 012).

## Constitution Check

- **III (non-negotiable).** Durbar stores only paths. Sign-in stays with each vendor's own login command, run by the user. No token is read, passed or stored.
- **II.** The harness homes are an optional field of the start options, applied inside each adapter.
- **V.** The profile marker shows a name and a colour, never colour alone.
- **VI.** The variables and paths are the same on all three OSes. R1 checks keychain behaviour per OS.
- **VIII.** "Shared sign-in" is shown where R1 finds separation impossible.

## Design

1. `src/main/profiles.ts`: the profile store (`profiles.json`, ids, names, colours) and a pure `userDataFor(id)`.
2. Startup: parse `--profile` and set `app.setPath('userData', …)` before any store opens. Profile `default` keeps today's folder.
3. Switch: confirm if agents are busy, end the sessions, then `app.relaunch({ args: ['--profile', id] })` and `app.exit(0)`.
4. Phase 2: `StartOptions.homes?: { copilot?, claude?, codex? }`, which becomes `baseDirectory` (Copilot), env `CLAUDE_CONFIG_DIR` (Claude) and env `CODEX_HOME` (Codex). Detection runs per profile.
