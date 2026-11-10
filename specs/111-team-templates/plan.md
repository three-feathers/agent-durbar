# Implementation Plan: Team templates (spec 111)

**Branch**: `111-team-templates` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md) | **Issue**: #1306

## Summary

A team template is app-level configuration (members with name, role, brief, custom agent id, app, model, effort, mode, cap with its unit, character) kept in one `userData` store and read by one pure validator. Creating a room builds not-started agents through the restore path's lazy `infoFor` and a per-folder team record that follows the person's later changes, so every member comes back with its latest settings. Each member's framed, masked brief goes only in front of the person's first typed message of a session id, recorded in the team record. Export writes one template with `writeNotesExport`'s steps; import reads it as untrusted with spec 109's file rules and spec 110's scanner (this spec's settings; G7 waits for 110 T009), shows everything, and can only add a template. Built in ten small PRs (G1..G10), tests first, zero AI credits.

## Technical context

- **Language**: TypeScript (main, shared, adapters untouched), plain JS UMD modules in the renderer. No new runtime dependency.
- **Storage**: `<userData>/team-templates.json` (FR-001); the room team record as a new optional `team` field of `SavedFolder` (`src/main/folders.ts:22`), parsed by a new `parseTeamRecord` in the folder store's parser (`parseSavedFolders`, `folders.ts:254`).
- **Testing**: `scripts/test-*.ts` unit tests (pure validator, scanner, migrations, store, IPC handlers as pure functions), mutants for each safety rule, simulator drivers and `check:office`; no real session (T050 is the only real check, owner's OK).
- **Platforms**: Windows, macOS, Linux; no path in any template; `path` only for the store file location in main.
- **Constraints**: constitution III (read-only default, no secrets, main validates), V (10.5 px, 15 agents), II (no vendor types outside adapters).

## Constitution check

| Principle | How this plan meets it |
|---|---|
| I Spec Kit | This folder (spec, plan, tasks) is committed before any `src/` change; each group's PR ticks its tasks and converges the spec. |
| II Adapters are plug-ins | No adapter change: members use `AdapterInfo` ids, `models:list`, `listAgentProfiles`/`selectAgentProfile` where present (optional members), the brief is message text (Q1 A). Codex without profiles degrades (FR-152). |
| III Safe by default (non-negotiable) | Default mode Read-only; Allow all asked on every create (FR-035) and never raised by a file (FR-096); caps never loosen silently (FR-098); no secret, path or id in any file (FR-005, FR-081); every channel through `ipcHandle`, validated in main (FR-010, FR-039, FR-101); the import is size-capped, parsed as data, never executed (FR-090..FR-102); nothing starts on import or create (FR-034). |
| IV No AI credits in tests | Simulator fakes for every channel (FR-133); members lazy (FR-034); T050 real check only with the owner's OK. |
| V Calm UI | 10.5 px floor, `check:office` with two team rooms at both sizes and in every world (FR-063); words, not colour (FR-064). |
| VI Parity | Pure validator and scanner tested on all three CI runners; main's dialogs; LF out, CRLF in; 0600 on POSIX, Windows gap stated (FR-155). |
| VII Quality gates | Tests for the validator, scanner, store, restore and IPC handlers; screenshots at both sizes; README and docs in the same PRs. |
| VIII Honest limits | FR-150..FR-157 as `[KNOWN GAP]` / `read:`; the README and `docs/limits.md` get the same lines in G10. |

No violation; *Complexity tracking* is empty.

## Existing capability check (spec 021 FR-031)

| Need | Reused (path) | Change |
|---|---|---|
| Choosing app, model, effort, mode, cap for one agent | `newSession(a0, o)` (`src/renderer/app.js:8584`), `kindOptions`, `DurbarModels.showsKindPicker` (`src/renderer/modelswitch.js`) | Its row builders are split into a helper used by the member editor and the Create team rows; the dialog itself unchanged |
| Validating those choices in main | `sessionOptsOf`, `validMode` (`src/main/agentops.ts:40,44`), `readyAdapterIds`, `parseAdapterId` (`folders.ts:82`), `parseEffort` (`src/shared/effort.ts`), `parseCapIn`, `startCap` (`src/shared/credits.ts:43,51`) | none; called per member with the chosen app's `capUnit` |
| Model list, cost tier, org block | `models:list` (`src/main/ipc/model.ts:156`), `ModelChoice.priceClass`/`multiplier`/`orgBlocked` (`src/shared/api.ts:385`) | none |
| App state | `adapters:list` (`src/main/ipc/adapters.ts:11`), `AdapterInfo` (`src/shared/adapters.ts`) | none |
| Not-started agents | `infoFor(..., { lazy: true })` and `restoreFolders` (`src/main/main.ts:401,539`; `registry.has` skip at `:546`), `ensureLive` (`main.ts:485`), `startGuardOp` (spec 076) | `restoreFolders` reads the team record first (members' own settings, not counted in `MAX_OPEN_SESSIONS`); a new `addLazyMember` builds one member like a restored session |
| Latest mode per session | `sessionModes`, `modeForSession`, `restoreMode` (`src/main/folders.ts:90,119`), `setModeOp`, `setCapOp` (`agentops.ts`), `agents:setModel` (`ipc/model.ts:114`) | restore takes `modeForSession` first; the three ops also update the team record |
| Send path | `sendOp` (`main.ts:585`), `sendWithSlash` (`agentops.ts:203-211`), `maskOutgoing` | the brief block is masked and added after slash expansion; `scheduledSendOp` (`agentops.ts:333`) is untouched and never adds it |
| Session names | `setSessionName`, `applyStoredAlias` (spec 059, `folders.ts:568`) | member name set as the session name |
| Folder pick and add | `agents:addFolder`, `agents:addWorkspaceFile`, `folders:create` (`src/main/ipc/agents.ts:84-95`, `src/main/ipc/newfolder.ts:42`), `newfolder.js`; an existing room named by an agent id and `wsKey(a)` as `agents:newSession` (`ipc/agents.ts:167`) | an optional `team` choice in the options; with it main builds the Create team preview instead of one agent. `folderIdOf` (`src/main/profilefiles.ts:82`) was considered and not needed: previews are tokens |
| Custom agents | `listAgentProfilesFresh` (`src/main/profilefiles.ts`), `agents:selectProfile` rules (`src/main/ipc/profiles.ts:66`), 043 FR-003 confirmation; not `agents:listProfiles` at create (it calls `ensureLive`, `:58`) | listed and selected at a member's first start, after `ensureLive` |
| Starter briefs | `SAFETY_LINES`, `SUCCESS_SECTIONS` (`src/shared/profiletemplates.ts`) | none |
| Allow all confirmation | `confirmAllow(what, extra)` (window, spec 093 ctx) | called once per create with the member list |
| Desk and header text | `roleFor` (`app.js:5468`), the profile-name prefix (`app.js:1119,1153`), `listRole` (`app.js:2066`), `.ro-role` (`realoffice.js:668`), `updateAgentChip` | a `teamRole` on the renderer agent, prefixed the same way; one new header chip |
| Characters | `syncCrew` (`app.js:72`), `crew.js` `storeKey`/`idsFor` | the window assigns a member's character on `agent:added` |
| Names and hidden characters | `checkDisplayName`, `CONTROL_RE` (`src/shared/names.ts`), `HIDDEN_CHARS` (`src/shared/redact.ts:1749`) | `HIDDEN_CHARS` for role and brief always and for every string at level `imported` (`HIDDEN_RE` misses tag characters, variation selectors, LRM/RLM, U+061C, ZWJ/ZWNJ); empty refused |
| Masking | `maskOutgoing`, `maskTokenShapes`, `cut`, `redact` (`src/shared/redact.ts`) | `maskOutgoing` is the one mask for role and brief in previews and sends (`briefBlock`) |
| Capped no-follow read | `readCapped` (`src/shared/cappedread.ts`) | none |
| Safe export write | `writeNotesExport`, `exportFileName`, `exportDialogOptions` (`src/main/notesexport.ts:56,72,83`) | `what: 'team template'`, the FR-084 filter |
| Store save | `SettingsStore.save` pattern (`src/main/settings.ts:451`) | same steps in `TeamTemplateStore` |
| Untrusted JSON envelope | spec 109's file rules FR-050, FR-096 (its own walk, planned) and spec 110 FR-040..FR-042's scanner (`src/shared/jsonscan.ts`, 110 T009, planned) | not on `main`: see *Dependencies* |
| Lookalike names | `DurbarLookalike.check(text, kind)` (`src/renderer/lookalike.js`, spec 003 FR-113..FR-116) | called on template and member names in the editor and previews |
| Dialogs, focus, live region | `askDialog`/`DurbarDialog` (`src/renderer/dialog.js`), `#srAnnounce`, `settingsnav.js` | none |
| IPC guard and simulator | `ipcHandle`, `fromAppFrame` (`src/main/ipcguard.ts`), `simguard`, `src/renderer/sim.ts` | new `teams:*` channels; sim fakes |

Nothing existing creates several sessions at once or stores reusable agent setups: the store, validator and team record are new. Spec 109's setup file is the only other app-level export; FR-140 keeps one owner per format.

## Module layout

| Unit | Kind | Job | Spec |
|---|---|---|---|
| `src/shared/teamtemplate.ts` | pure TS, no imports beyond `names.ts`/`effort.ts`/`credits.ts`/`redact.ts` patterns (agent-notes: page-loadable shared modules have no imports; if needed, the renderer gets the limits through a compiled copy, as `profiletemplates.ts`) | Limits (FR-002, FR-003), `checkTeamTemplate(value, level)`, `checkMember`, migrations, the canonical serializer, the file envelope builder and reader on top of the scanner | FR-002..FR-012, FR-080, FR-092..FR-098 |
| `src/shared/jsonscan.ts` | pure TS, **spec 110's** (110 T009); used here, not built here | Iterative pre-scan with an options object `{ jsonc, maxDepth, maxValues, maxKeyLen, forbidKeys, dupKeys }`: depth, value count, key length, forbidden and duplicate keys, line and column; never returns input text; this spec passes `{ jsonc: false, maxDepth: 8, maxValues: 5000, maxKeyLen: 64, forbidKeys: [...3], dupKeys: 'refuse' }` | FR-090 |
| `src/shared/teamstarters.ts` | pure TS data | The starters | FR-070..FR-073 |
| `src/main/teamstore.ts` | main, no Electron import | `TeamTemplateStore`: load, set aside a bad file, list, put, duplicate, delete, save (temp, rename, 0600) | FR-001, FR-003, FR-021 |
| `src/main/teamops.ts` | main, pure logic with injected deps | Create preview (apps, models, org blocks, effort fallback, cost tiers, cap words), token store (10 min), create apply (lazy members, team record), save-room builder, export collect, import read/preview/apply | FR-030..FR-053, FR-084, FR-090..FR-101 |
| `src/main/ipc/teams.ts` | IPC | `teams:list`, `teams:put`, `teams:delete`, `teams:duplicate`, `teams:createPreview(target, templateId)`, `teams:create(token, choices)`, `teams:savePreview(agentId)`, `teams:saveRoom(agentId, rows)` (an agent id of the room, FR-030), `teams:export(id)`, `teams:importPick()`, `teams:importApply(token, choices)`, `teams:cancel(token)`; all `ipcHandle`, every argument type- and size-checked | FR-010, FR-039, FR-100, FR-101 |
| `src/main/folders.ts` | existing | `SavedFolder.team` (`parseTeamRecord`, at most 8 members), `setTeamRecord`, `setTeamMemberSession`, `dropTeamMember` | FR-040, FR-044 |
| `src/main/main.ts` | existing | `addLazyMember` (restore path's `infoFor`); `restoreFolders` reads the team record first (latest mode via `modeForSession`, unknown apps skipped); `sendOp` adds the masked, framed brief after `sendWithSlash`'s expansion when the session id has no `briefSent` in the record, and writes `briefSent` after a successful send (nothing in memory only) | FR-034, FR-036, FR-040 |
| `src/preload/preload.ts`, `src/shared/api.ts` | existing | Typed bridge members `teams*`, `TeamTemplateView`, `TeamPreview` (no brief text for foreign briefs beyond the preview) | FR-010 |
| `src/renderer/teams.js` (new UMD) + `scripts/copy-assets.js` + `index.html` | renderer | Settings section, editor, Create team, Save team, Import preview dialogs | FR-020..FR-024, FR-031, FR-050, FR-095 |
| `src/renderer/app.js`, `realoffice.js` | existing | Role prefix on desks, list, Real office, tooltip, `aria-label`; Role chip and menu in the chat header; character on `agent:added` | FR-060..FR-064, FR-038 |
| `src/renderer/sim.ts` | simulator | Fake store and channels, fake apps and models (FR-133), a two-team 15-agent scene | FR-133, FR-063 |

## Data flow (create)

1. Window: template id and target (an agent id of an existing room, or "pick a folder") to `teams:createPreview`. Main picks the folder with its own dialog if needed, resolves the template (store or starters), asks `adapters:list` and `models:list` per app in main, builds rows and a token. No profile listing (it would start a session).
2. Window shows rows; the person makes choices; `teams:create(token, choices)`: main re-validates every choice (FR-039), runs no adapter, builds each member with `addLazyMember`, sets the session name, writes the team record, emits `agent:added` per member.
3. First typed message to a member: `sendOp` -> `ensureLive` (076 guard, 011 cap) -> custom agent: `listAgentProfilesFresh` and select (043) -> `sendWithSlash` expansion -> the framed brief, masked with `maskOutgoing`, in front of the (expanded) text when the session id has no `briefSent` -> `briefSent` written. Scheduled, Autopilot, handover and remote sends never add it.

## Dependencies

- **Spec 110's scanner** (FR-090): `src/shared/jsonscan.ts` belongs to spec 110 (PR #1369, its T009: iterative JSONC scanner, depth 17). This spec is a consumer: it needs 110 T009 built with an options object `{ jsonc, maxDepth, maxValues, maxKeyLen, forbidKeys, dupKeys }`, which 110 takes on in its own PR (its owner's call; a delta there, never an edit of its branch). Spec 109 (PR #1374) has its own walk (`readEnvelope`) and no delta is asked of it for the scanner. **G7 waits for 110 T009.**
- **Spec 109's not-exported list**: 109 must name `SavedFolder.team` among what is not exported (FR-140); asked of 109's owner, in 109's PR.
- **Owner confirmation**: Q1 (brief sending) holds T013 in G4; Q3 and Q8 hold G7. Neither starts before an owner confirms.
- **Spec 109 section** (FR-140, FR-141): after both are built.
- **Priority** (AGENTS.md FR-081): this is a new feature (level 4); groups are picked after open bugs and parity work.

## Phases (one small PR per group)

| Group | Content | Risk / who | Waits for |
|---|---|---|---|
| G1 | Format, limits, `checkTeamTemplate`, migrations, serializer, tests and mutants (the scanner is spec 110's, used in G7) | High: senior | spec committed |
| G2 | `TeamTemplateStore`, `teams:list/put/delete/duplicate`, preload, sim fakes | High (IPC): senior | G1 |
| G3 | Settings > Team templates, editor, list actions | Low: junior | G2 |
| G4 | Create team: preview, choices, lazy members, team record, restore, brief on first send, custom agent, Allow all confirmation | High (main, sessions): senior | G2; T013 does not start before an owner confirms Q1 |
| G5 | Save room as template | Medium: junior, senior review of the main builder | G4 |
| G6 | Role and model on desks, list, Real office, Retro arcade, chat header chip; `check:office` | Low/medium UI: junior | G4 |
| G7 | Export and import (envelope, preview, briefs, Allow all, caps, names), **security review with Opus** | High: senior; reviewer-senior | G1, G2, spec 110 T009 built; does not start before an owner confirms Q3 and Q8 |
| G8 | Starter templates | Low: junior | G1, G3 |
| G9 | Spec 109 section (only if 109 is built) | Medium: senior | G7, spec 109 built |
| G10 | Docs, feature inventory, changelog, limits, converge | Low: junior | G3..G8 |

## Test plan (zero AI credits)

- `test:teamtemplate`: every field limit, unknown member keys fail closed, prototype and look-alike keys (`toString`, `hasOwnProperty`...), migrations, serializer stable bytes, starters valid.
- `test:jsonscan` (shared): depth, values, duplicates, forbidden keys, position, CPU bound; spy on `JSON.parse`.
- `test:teamimport`: the SC-002 fixture set (`scripts/fixtures/teams/`), FIFO and symlink swap with an injected fs, token rules.
- `test:teamstore`: bad file set aside, 0600, atomic save.
- `test:teamops`: preview rows for missing app, missing model, org block, effort fallback, cost words, caps; create builds lazy members only (fake adapter start count 0); restore of 8 members with their own settings; brief once per session; mutants for "preselect first model", "keep Allow all", "skip brief accept".
- Drivers (simulator): `shots-111-templates`, `shots-111-create`, `shots-111-import` in three worlds at 1440x900 and 1280x800; `check:office` with the two-team scene.

## Complexity tracking

(none)

## Risks

- **Prompt injection through briefs** (the main risk): mitigated by full display, per-member accept, a framed block that widens nothing, sending only with the person's typed message, *Role brief sent* and the *Imported* badge, imported members never Allow all; residual risk named (FR-153: approved reads, read-only-marked network MCP tools, the folder's own rules and hooks, the weight of a user message). G7 gets an Opus security review before merge.
- **Restore raising permissions**: if restore read the record over `sessionModes`, a lowered mode would come back raised. Mitigation: `modeForSession` first, the record updated on every change, a restart test and its mutant.
- **Cap units**: AIU, USD and none differ per app; a limit is never converted, and is dropped when the app changes.
- **Restore change**: the team record changes how a folder's sessions come back; a mistake could lose sessions or start the wrong model. Mitigation: members are an addition to `sessionsToRestore`, tests for mixed rooms (team plus plain sessions) and old files without `team`.
- **Brief in the first message** changes the text the agent receives and its input tokens (up to about 1,000; real money on Claude Code and Codex), and shows in the vendor's history and maybe in a derived title (FR-157). Mitigation: shown, switchable per member, documented.
- **Three specs share a scanner** (109, 110, 111): risk of drift. Mitigation: one module, one test, owners' PRs.
- **Office fit**: long roles and model ids on small densities; `check:office` at both sizes in every world.
