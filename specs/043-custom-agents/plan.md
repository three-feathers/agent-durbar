# Implementation Plan: Custom agent per session

**Branch**: `043-custom-agents` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

## Summary

A generic "agent profile" in the adapter interface; Copilot maps it to the SDK's `rpc.agent.*` with explicit agent folders; main guards repository agents with a saved confirmation; the renderer adds an Agent chip and menu in the chat header, a confirmation dialog and a waiting switch. Simulator first, then one real check.

## Technical Context

**Language/Version**: TypeScript (main, adapters), plain JS (renderer), Electron 44.
**Primary Dependencies**: `@github/copilot-sdk` 1.0.22 (`rpc.agent.list/select/deselect/getCurrent`, `agentDirectories`, events `subagent.selected` / `subagent.deselected`; all `@experimental`).
**Storage**: confirmations in the existing settings store (`durbar-settings.json`): `{ folder, agentId, sha256 }`, at most 200, no file content.
**Testing**: unit tests on a fake Copilot session (`test:copilotmodel`), a new `test:agentprofiles` (store, IPC validation, mapping), simulator drivers, one real check.
**Target Platform**: Windows, macOS, Linux (paths with `path.join`, `os.homedir()`).
**Constraints**: constitution I (no Copilot types outside the adapter), II/III (safe by default: the permission broker still sees every tool call; repository agents need a confirmation), IV (simulator first), V (10.5 px text, 15 agents fit).

## Constitution Check

- I Adapters are plug-ins: profile type and event in `src/adapters/types.ts`, generic; Copilot specifics in `copilot.ts`. Pass.
- II/III Safe by default: the session's mode is not changed; repository agents are confirmed with their tools, model and MCP servers shown; no config discovery (no repository skills). Pass.
- IV Do not spend credits: simulator and unit tests; one real check (owner's standing permission). Pass.
- V Calm UI: one chip in the chat header (fits at 1280x800 with the other chips), menu like the model menu. Check with screenshots. Pass.
- VI Parity: paths built with `path` and `os.homedir()`. Pass.
- VIII Honest limits: `@experimental` SDK calls and what was not run are recorded. Pass.

## Design

1. `types.ts`: `AgentProfile`, `AgentProfileEvent` (`type: 'agentProfile'`, `profile: AgentProfile | null`), optional `listAgentProfiles`, `selectAgentProfile`.
2. `copilot.ts`: `agentDirectories` in the session config; `profileOf(AgentInfo)` (pure, exported for tests); list/select/deselect; `getCurrent` after create/resume emits `agentProfile`; map the two events in `map.ts`.
3. `src/main/agentprofiles.ts` (pure + fs): `hashFile(path)`, confirmation store helpers on the settings store; IPC handlers in `main.ts`.
4. Renderer: `agentChipHTML`, `openAgentMenu`, `confirmRepoAgent` (dialog.js `askDialog`), waiting switch (`a.pendingProfile`), Stop drop; card subtitle.
5. Simulator: `SIM_PROFILES`, `listAgentProfiles` / `selectAgentProfile` on the fake bridge, events.

## 2026-10-21: profile file editor (FR-010..FR-017, T012)

**Constitution check.** I: no adapter types in the renderer; the folder rules come from the adapters' own exported helpers (`agentDirsFor`, the Claude config folder). III: main owns every path (ids only from the window, realpath checks, no symlink, size cap, atomic write, no logging of contents); preview through the spec 016 sanitiser; links through `app:openExternal` (http/https). IV: simulator and unit tests only, no real session. V: text ≥10.5px, theme tokens, checked at 1440x900 and 1280x800 in a light and a dark theme. VI: `path`, `os.homedir()`, CRLF kept; atomic rename works on Windows when the target is not open elsewhere (`fs.renameSync` replaces). VIII: no quit guard and Copilot's mid-session reload are recorded as known gaps.

**Design.**

1. `src/main/profilefiles.ts` (fs, no Electron): `profileDirs(folders, env)` (Copilot and Claude folders, user and per folder), `listProfileFiles(dirs)`, `readProfileFile(dirs, id)`, `saveProfileFile(dirs, id, text, baseSha, overwrite)`, `createProfileFile(dirs, app, place, name)`. Id = first 32 hex of SHA-256 of the file path. `resolve` lists again and re-checks realpaths (folder must still be an allowed one, file directly inside, not a link). EOL and BOM kept. Write: `<dir>/.<name>.<random>.tmp` with `wx`, then `renameSync`; the temp file is removed on failure.
2. `src/main/ipc/profiles.ts` gains `profiles:listFiles`, `profiles:read`, `profiles:save`, `profiles:create`, `profiles:openInVSCode`; the folder list is the office's agents' folders (`a.folders` or `a.cwd`), first 50. `save` and `create` also check `fromApp(e)` (added to `test:ipcchannels`' list).
3. `src/shared/api.ts` and the preload: `listProfileFiles`, `readProfileFile`, `saveProfileFile`, `createProfileFile`, `openProfileInVSCode`.
4. `src/renderer/profileeditor.js` (plain script, `window.DurbarProfileEditor`; in Node `require` gives the pure parts): `parseFrontmatter(text)` (FR-015), `throttle`, the editor dialog, New profile form, the conflict and discard questions through `askDialog`. Preview = `DurbarMD.render(body)` plus a header built with `textContent`.
5. `app.js`: an **Edit** button on each profile row of the Profile menu (rows stay radio items); `screens.js`: Settings section *Profiles (custom agents)* with Open and New profile….
6. `sim.ts`: in-memory profile files and the five bridge calls.
7. Tests: `test:profilefiles` (main: list, id-only resolve, `..`/separator names refused, symlink file and symlinked folder escape refused, size cap, atomic save round trip in a temp folder, CRLF and BOM kept, conflict on external change, overwrite, create, read-only); `test:profileeditor` (front matter parser; preview sanitisation of `<script>`, `onerror`, `javascript:` links through `markdown.js` in jsdom). Driver `shots-043-editor.js` (modes, split widths, typing → preview, save round trip, unsaved guard, New profile, menu entry) with screenshots at both sizes in Clean Office and a dark theme; added to `check:ui`.
