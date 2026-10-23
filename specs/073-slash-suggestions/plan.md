# Implementation Plan: Slash suggestions in the chat composer

**Branch**: `073-slash-suggestions` (based on `main`; its first base, `005-composer-toolbar`, landed as #498) | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

A shared, dependency-free discovery module reads each agent app's skill, command and prompt files from the session's folders and the
documented user directories (capped, real-path checked). Each adapter exposes it through two optional `AgentAdapter` members:
`listSlashCommands(sessionId)` and `expandSlashCommand(sessionId, text)`. Main lists entries over a window-only IPC channel and, in the
one send path (`sendOp`, also used by schedules), asks the adapter to expand a leading `/name` before `send`. The renderer adds an ARIA
combobox to the composer's message box, built on the toolbar menus' look and placement (spec 005 FR-037).

## Technical Context

- **Language**: TypeScript (main, adapters, shared), plain JS renderer. **No new dependency.**
- **Storage**: none (files are read on demand; the window keeps a 30 s copy per agent).
- **Testing**: `scripts/test-slashcommands.ts` (fixtures in temp folders, symlinks, caps, expansion, per-adapter places), contract test
  update, `scripts/check-slash-suggest.js` simulator driver (keyboard flow, a11y attributes, geometry at both sizes, screenshots).
- **Platforms**: paths via `path`; real-path containment compares case-insensitively on Windows and macOS (existing
  `isInsideRoots` in `src/adapters/permissions.ts`). Symlink tests skip where the OS refuses to create links (Windows without rights).
- **Performance**: listing reads at most 8 KB of at most 300 files; done off the send path except for one directory scan at send.

## Reused capabilities (AGENTS.md: look for an existing capability first)

- **Discovery**: modelled on spec 043's `listClaudeAgents` / `readDir` in `src/adapters/claudeAgents.ts` (repo first, then user, caps,
  `lstat`), and its front-matter reader is moved into the new module as `parseFrontMatter` and reused by `parseClaudeAgent` (one parser).
  Copilot's user home rule follows `agentDirsFor` in `src/adapters/copilot.ts`.
- **Containment**: `isInsideRoots` from `src/adapters/permissions.ts` (the broker's own path rule).
- **Claude built-ins**: the existing no-prompt CLI probe `ClaudeAdapter.probeModels` (an `initialize` control request) now keeps the
  answer's `commands` as well as `models`, cached once per run.
- **UI**: the toolbar menus' `.mode-menu` look and `placeMenu()` (spec 005, PR #498) for the list; `announce()` for the live region;
  the message box's existing keydown handler order (`msgInput`).
- **Main**: the profile IPC pattern (`src/main/ipc/profiles.ts`: agent looked up by id, `ensureLive` without a prompt, `fromApp`
  window-only) and `infoFor`'s optional-member flag (`profiles`) become `slash`.
- **Not reused, on purpose**: Copilot `session.rpc.commands.list` / `skills.list` and Codex `skills/list`. The first lists built-ins
  that `session.send` does not run (real), the skill calls only see what the runtime loaded (nothing from the folder under Durbar's
  config). One file reader for all three keeps the security rules in one tested place.

## Constitution Check

| Principle | How it holds |
| --- | --- |
| I Spec Kit | spec, plan, tasks committed before `src/`; analyze run. |
| II Adapters are plug-ins | Two optional members with normalized types; place rules live in each adapter; renderer and `src/shared` get only `SlashCommandInfo`. |
| III Safe by default | Reads only inside the folders and user dirs, real paths checked, caps, no shell, no execution of `!` lines, contents never logged. The expanded text goes through the same send and permission broker as any message; nothing widens a mode; only allow-listed built-ins are offered, so a new one never appears by default (FR-007). |
| IV No credits | Simulator and unit tests only; 3 real prompts spent once for the vendor table (owner approved, recorded). |
| V Calm UI | 10.5px floor, tokens, at most 8 rows, no overlap with the box; keyboard and screen-reader (combobox). |
| VI Parity | `path`, case-insensitive containment, env-injected homes for tests. |
| VII Gates | typecheck, build, `npm test`, driver with screenshots at both sizes. |
| VIII Honest limits | Vendor table tags; Codex not run; Copilot built-ins not offered; nested folders not listed. |

## Design

1. **`src/adapters/slashcommands.ts`** (no Electron): `parseFrontMatter`, `SlashPlace` (`dir`, `root`, `scope`, `kind`,
   `layout: 'skill-dirs' | 'md-files'`, `prefix?`), `discoverSlash(places, opts)` → internal entries (normalized + `file`, `dir`),
   `expandSlash(text, entries, read)` → `{ text, where } | undefined`, `BUILTIN_ALLOW` and `cleanBuiltins(list)` for Claude, the caps.
   `SlashCache` (review on #535): one per adapter; `list(places, {refresh})` and `expand(text, places)`, which tests the `/name` line
   pattern before any IO, reuses a discovery under 30 s old whose directories' mtimes are unchanged, and reads only the entry's file.
   Places per app: `claudeSlashPlaces(roots, configDir)`, `copilotSlashPlaces(roots, home)`, `codexSlashPlaces(roots, home, codexHome)`
   (pure, tested with `path.posix` / `path.win32` inputs).
2. **Types**: `SlashCommand` in `src/adapters/types.ts`; `listSlashCommands?` and `expandSlashCommand?` on `AgentAdapter`;
   `SlashCommandInfo` in `src/shared/api.ts` plus `slashCommands?(id)` on the bridge and `AgentInfo.slash?: true`.
3. **Adapters**: Claude (folder/user files + cached built-ins), Copilot (files), Codex (files + prompts). The contract test lists both
   members among those `FakeAdapter` does not implement (as `listAgentProfiles`).
4. **Main**: `src/main/ipc/slash.ts` registers `agents:slashCommands` (window-only, id checked, `ensureLive`, strings re-cut, 300 max);
   `sendOp` calls `sendWithSlash` (`src/main/agentops.ts`: `expandSlashCommand`, then `send`; `slash: where` on success; a rejected
   expansion sends the typed text); `infoFor` sets `slash`.
5. **Renderer**: `src/renderer/slashsuggest.js` (a small module loaded before `app.js`, pure helpers exposed on `window.DurbarSlash`:
   `tokenAt(value, caret)`, `filter(entries, q)`, `order`) and the combobox wiring in `app.js` next to the message box handlers; CSS in
   `styles.css` with tokens. The note "Sent the text of …" is added under the user message when `bridge.send` answers `slash`.
6. **Simulator**: `sim.ts` answers `slashCommands` per kind and `send` returns `slash` for a canned folder entry.

## Project Structure

```text
src/adapters/slashcommands.ts        new: discovery, expansion, places, built-in filter
src/adapters/{types,claude,claudeAgents,copilot,codex,fake}.ts
src/main/ipc/slash.ts                new: agents:slashCommands
src/main/{main.ts,ipc/types.ts}      sendOp expansion, info flag
src/preload/preload.ts, src/shared/api.ts
src/renderer/{slashsuggest.js (new),app.js,index.html,styles.css,sim.ts}
scripts/test-slashcommands.ts (new), scripts/check-slash-suggest.js (new), scripts/test-adapter-contract.ts, scripts/ui-suite.js, package.json
```

## Complexity Tracking

None.
