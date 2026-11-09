# Feature Specification: Export and import the whole setup

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Export and import the whole setup as one JSON file (issue #559): floors, folders, MCP extras, folder rules, schedules, themes, layout, shortcuts, Settings and notes; no secrets, home paths as `~`, hostile-file validation, preview with per-item boxes, path mapping, merge or replace, backup and undo
status: specified
note: spec, plan, tasks; Q1..Q5 answered 2026-11-09 (recommended defaults); nothing built
-->

**Feature Branch**: `109-setup-export-import` (spec, plan and tasks only). The build is one small PR per task group (G1..G9).
**Created**: 2026-11-09
**Status**: Specified. Nothing built. Q1..Q5 (Clarifications) were answered by the owner on 2026-11-09 (the recommended default of each); no group waits for an answer. No dependency is added.
**Input**: Issue [#559](https://github.com/three-feathers/agent-durbar/issues/559) (owner request, Ruben, 2026-10-22), with these decisions and notes from trusted authors:

- **Ruben, 2026-10-22 (the issue)**: "Save, export and import your whole Agent Durbar setup as one file, so you can back it up, take it to another computer, and load it there in one go." It lists what goes in the file, what never does (no secrets, no session content, no harness config), a preview with per-item checkboxes and the exact MCP commands, path mapping, merge or replace with an automatic backup and one-click undo, imported MCP servers and folder rules untrusted, accept only by a person in the window, a versioned JSON format with `schemaVersion`, and Windows, macOS and Linux parity.
- **Ruben, 2026-10-30 (comment)**: spec 083 keeps each folder's notes in `<userData>/notes/` (one `<fingerprint>.json` per folder, 0600, folder 0700, plus `.lock` and `.json.bad-<UTC>` files); "any path built for this issue that resets, wipes or replaces Durbar's data (... an import with *replace* ...) must include `<userData>/notes/`; and export/import should carry the notes too (spec 083 FR-048, `[LATER]`)".
- **Vikram, 2026-11-02 (comment)**: "Owner decision 2026-11-02: keep; spec soon. No secrets in the file; paths are checked on import."
- **Vikram, triage 2026-11-09 (Telegram 06:59 UTC, recorded on the issue)**: "the first version covers everything the issue lists (not only floors, folders and Settings)".

## Summary

Settings gets a **Setup file** section with **Export…** and **Import…**. Export writes one readable JSON file with everything Durbar itself keeps about how the office is set up: floors, folders and their choices, Durbar's per-folder MCP extras, folder-rule choices, schedules, theme and characters, layout and display choices, the navigator shortcut, app settings and folder notes. It never holds a token, key, MCP `env` or header value, chat, prompt history, harness config, window position or machine id, and paths under the home folder are written as `~` plus folder names, never the user name. Import reads a file chosen in main's own open dialog, checks it as hostile input (size, JSON only, strict schema with limits, no prototype keys, no paths written from file text), shows a **preview** with a box per item and the exact MCP commands, maps folders that do not exist here, merges or replaces, takes a **backup** first, applies all or nothing, and offers **Undo**. Everything that can run something (MCP servers, folder rules, schedules) arrives **untrusted, off or paused** and goes through the normal trust prompt. Only a person in the window can accept.

## Context: what exists today (spec 021 FR-031, reuse first)

Each item the issue lists, where it lives on `main` (`read:` 2026-11-09, `afb3803c9`), and what this feature reuses:

| Issue item | Kept in | Owner spec | Reused for |
|---|---|---|---|
| Floors (names, order, on/off) | `durbar-folders.json`: `floors`, `lastFloor` via `FolderStore` (`src/main/folders.ts` `parseSavedFloors`), pure ops in `src/shared/floors.ts` (`parseFloors`, `MAX_FLOORS` 40, `MAX_FLOOR_NAME` 40) | 033 | export and import parse |
| Basement and rooftop | **Not built** (issue #555 open) | #555 | format reserves a field (FR-016) |
| Folder: floor, display name, hidden, permission mode, model, effort, context tier, credit cap, agent app, default custom agent | `durbar-folders.json` `folders[]` (`SavedFolder`, `parseSavedFolders`, `parseLabel`, `parseAdapterId`, `parseDefaultAgent`, `MAX_FOLDERS` 200) | 006, 030, 011, 033, 043 | export and import parse |
| Door state | **Removed**: door plates are gone (spec 017 FR-034); an old `closed` flag is ignored on read (`hasLegacyClosed`) | 017 | nothing to export (FR-017) |
| Manual room, desk and place order | `durbar-folders.json` `order` (`parseSavedOrder`, `src/shared/roomorder.ts`, `MAX_ORDER_*`) | 033 (delta 2026-11-01) | layout section |
| MCP per-folder extras and their trust | `durbar-mcp.json` via `McpStore` (`src/main/mcpstore.ts`): per folder key, servers with `transport`, `command`, `args`, `workingDirectory`, `url`, `tools`, `enabled`, `trust` (`trustHash`), `env`/`headers` as key plus a ref into one encrypted `vault` (`safeStorage`); tools-off lists | 019, 020 | `McpStore.upsert` creates imported servers off and untrusted, as `mcpimport.ts` (`previewFolderImport`, `applyFolderImport`, 020 FR-020..FR-031) already does |
| Folder rules choices (a folder's own setup) | `folder-setup.json` via `FolderSetupStore` (`src/main/foldersetupstore.ts`): per folder key, `accepted` and `declined` item digests | 061 (constitution III Amendment 1) | declined only (FR-034) |
| Custom agent confirmations | `durbar-agent-trust.json` (`AgentTrustStore`, `src/main/agenttrust.ts`) | 043 | **not exported**: a trust decision (FR-021) |
| Schedules | `durbar-schedules.json` (`loadSchedules`, `saveSchedules`, `cleanSchedule`, `MAX_SCHEDULES` 50, `MAX_PROMPT` 10,000, `pausedReason`) in `src/main/schedules.ts` | 044, 072 | `cleanSchedule` on import |
| Theme, characters, scene kit | `durbar-settings.json` `theme` (`parseThemeId`), `characters` (`parseCharacters`); a theme names its scene kit (`scenekits.js`, 035 FR-013); user theme packs in `<userData>/themes/<id>/manifest.json` (`src/main/themes.ts`, spec 040); seat characters in the window's `localStorage` `durbar.crew` / `durbar.crew.<crew>` (`crew.js`) | 035, 040, 077 | ids only (Q3) |
| Layout and densities, world | the window's `localStorage`: `durbar.density`, `durbar.officeview`, `durbar.world`, `durbar.floorView`, `durbar.floor`, `durbar.shutters`, `durbar.liveActivity`, `durbar.composerHeight`, `durbar.railWidth`, `durbar.logo`, `durbar.flatLook`, `durbar.realpeople*` | 001, 052, 097, 102 | display section (FR-015) |
| Chat panel docking | **Not built** (issue #452 open); today only the composer height and rail width are kept | #452 | format reserves a field (FR-016) |
| Keyboard shortcuts | only the navigator shortcut is recordable: `localStorage` `durbar.navKey`; clash check `clashOf(combo, mac)` in `src/renderer/navigator.js` (`window.DurbarNav`) | 074 FR-013, FR-014, FR-017 | the clash check on import (FR-047) |
| App settings | `durbar-settings.json` via `SettingsStore` (`src/main/settings.ts`), shape `AppSettings` and tolerant `parseSettings` in `src/shared/credits.ts`; IPC setters through the `setting()` helper in `src/main/ipc/settings.ts` | 011, 024, 034, 052, 058, 068, 080, 081, 087, 093, 099, 100 | per-key allow-list (FR-013) |
| Language | **No language setting exists** today | n/a | nothing (FR-017) |
| Folder notes | `<userData>/notes/<folderFingerprint(key)>.json` via `NotesStore` (`src/main/notesstore.ts`), fingerprint `folderFingerprint` (`src/main/usagetotalsstore.ts`, `normaliseFolderKey`), limits `NOTES_LIMITS` (`src/shared/notes.ts`), masking `maskNoteText` | 083 FR-048 | notes section (FR-018) |

Other pieces reused:

- **Masking**: `src/shared/redact.ts` (specs 012, 041): `maskSecretCommand`, `maskSecretArgs`, `maskSecretUrl`, `maskHomePaths`, `maskTokenShapes`, `maskNoteText`, `maskOutgoing`, `redact`, `cut` ("mask, then cut"); MCP display masking in `src/main/mcpmask.ts`.
- **Writing a file the person picked**: `writeNotesExport` in `src/main/notesexport.ts` (spec 083 FR-048, also used by the activity export, 052 FR-071): main shows the save dialog, `O_CREAT|O_EXCL|O_NOFOLLOW`, 0600, re-check, rename. `exportFileName` and `exportDialogOptions` give the pattern for the name and dialog options.
- **Choosing a file**: main's `dialog.showOpenDialog`, as `ipc/themes.ts`, `ipc/agents.ts` (Add folder) and `ipc/newfolder.ts` do. The window never sends a path.
- **IPC**: `ipcHandle` and `fromAppFrame` (`src/main/ipcguard.ts`); under the simulator only `SIM_OPEN_CHANNELS` (`src/main/simguard.ts`) pass.
- **Confirmation by a person**: `nativeConfirm` (`src/main/nativeconfirm.ts`), an OS dialog main shows; spec 041's rule that every change from the Durbar MCP server is confirmed in Durbar's window.
- **Dialogs and checks in the window**: `askDialog` (`src/renderer/dialog.js`, `check`, `picks`, `size`, `custom`); the Settings section list builds itself from the rendered headings (`settingsnav.js`, 052 FR-226), so a new section needs no list edit.
- **Organization policy**: `orgpolicy.ts` and `policyfile.ts` (spec 076): a managed value wins over anything imported.
- **Profiles** (spec 049, draft): export and import act on the profile in use; nothing here crosses profiles.
- **Harness-owned config** (never touched here): `~/.copilot` (incl. `mcp-config.json`), `~/.claude`, `~/.claude.json`, `~/.codex` (spec 069 edits them through `mcpglobal.ts` and `mcpglobalio.ts`, not this feature).

## User scenarios

### US1 (P1) Move my office to a new laptop

**Why this priority**: the owner's main case. **Independent test**: export on a seeded profile, import on a clean profile, compare (SC-001).

1. **Given** Settings > Setup file, **When** I press *Export…*, **Then** a dialog lists the sections with a box each (all ticked) and the sentence "No tokens, keys, MCP secret values, chats or history go in the file. Paths in your home folder are saved as ~." **When** I press *Save…*, **Then** main's save dialog offers `agent-durbar-setup-2026-11-09.json`, and a toast says "Setup saved: 3 floors, 12 folders, 5 MCP servers, 4 schedules, notes of 7 folders."
2. **Given** a clean profile on another computer, **When** I press *Import…* and pick that file in the system's open dialog, **Then** a preview lists every item with a box, grouped by section, with nothing applied yet.
3. **Given** the preview, **When** I press *Import*, **Then** a system dialog asks "Import 3 floors, 12 folders, ...? A backup of your current setup is taken first." and, after *Import*, the office shows the same floors, rooms, names and order as on the first computer.

### US2 (P1) Nothing secret leaves, nothing runs by itself

1. **Given** an MCP server with `env` `GITHUB_TOKEN` and a header `Authorization`, **When** I export, **Then** the file holds the key names with the value `"<needs a value on this machine>"` and never the value (FR-020).
2. **Given** that file imported, **Then** the server is listed with its exact command, marked *Off, not trusted, needs 2 values*, and after import it is off; switching it on shows the normal trust dialog and asks for the values (FR-031, FR-032).
3. **Given** a file whose schedules were active, **Then** they arrive paused with the reason "Imported: check and resume" (FR-035).
4. **Given** a file edited to say `"trusted": true` or carrying a `trust` hash or an `env` value, **Then** those fields are ignored and the preview says "Values and trust in the file are never used" (FR-030).

### US3 (P1) Paths differ between machines

1. **Given** a file from macOS with `~/code/web` and this Windows computer has `C:\Users\me\code\web`, **Then** the folder is matched to it automatically and shown as "Found here: ~\code\web".
2. **Given** `~/code/api` does not exist here, **Then** the row offers *Choose folder…* (main's folder dialog), *Skip* and *Keep as missing* (FR-042).
3. **Given** a file from Windows with `D:\work\site` imported on Linux, **Then** that row offers only *Choose folder…* and *Skip* (FR-042).

### US4 (P1) A hostile file does nothing

1. **Given** a file over 16 MiB, not JSON, nested deeper than 16 levels, or with a `__proto__` or `constructor` key anywhere, **Then** the import stops before the preview with one plain sentence and nothing changes (FR-050..FR-053, FR-057).
2. **Given** a file with a newer `schemaVersion`, **Then** the import says "This file was made by a newer Agent Durbar (0.40.0, format 2). This version reads format 1. Update Agent Durbar to import it." (FR-011).
3. **Given** a folder whose path has a `..` part or a separator inside a part, **Then** that row (and its MCP servers, schedules and notes) is disabled with "Path not allowed", and the rest of the file can still be imported (FR-040, FR-057).

### US5 (P2) Merge or replace, with undo

1. **Given** an office with 5 folders and a file with 8 (3 the same paths), **When** I choose *Merge*, **Then** 5 new folders are *Add* rows (ticked) and the 3 shared ones are *Change* rows listing each differing field, unticked ("Keep mine" is the default) (FR-044).
2. **When** I choose *Replace*, **Then** the current items missing from the file are *Remove* rows (ticked), and their notes stay unless I tick *Also delete their notes* (FR-045).
3. **Given** an import was applied, **When** I press *Undo import* in Settings > Setup file, **Then** after a system confirmation the setup is as it was before, notes included (FR-062).

### US6 (P2) Keep my keyboard and screen reader

1. **Given** the preview with a screen reader, **Then** each section is a group with its name and counts, and each box reads its action and item ("Add folder web, on floor Research", "Change permission mode of api: Ask to Read-only"); the summary line is announced when counts change (FR-081).
2. **Given** keyboard only, **Then** Tab reaches the mode choice, each section's *All* box, each row's box and its *Choose folder…*, and *Import*; Space toggles; Esc cancels and returns focus to *Import…* (FR-080).

### US7 (P3) The same in every world

1. **Given** Real office or Retro arcade, **When** I open Settings > Setup file and the preview, **Then** they take the world's colours, radii and fonts through tokens only, with no art behind text, and the 10.5 px floor holds (FR-085).

## Edge cases

- **Duplicate keys** in one JSON object: `JSON.parse` keeps the last; the preview shows the parsed value, which is what applies.
- **A UTF-8 BOM** or CRLF line ends (a file edited on Windows): accepted. UTF-16, invalid UTF-8 or a NUL byte: refused (FR-051).
- **The same folder twice** in the file (paths equal after platform comparison on this computer): the second row is disabled with "Listed twice in the file" (FR-057).
- **Two file folders map to one local folder**: the second mapping is refused in the row ("already used by web").
- **A mapped folder is a link** (symlink, junction): its real path is used and shown (FR-043).
- **Agents are working** (a turn running, a permission pending, a schedule run or loop in flight): *Import* is disabled with "Wait until no agent is working, or stop them" (FR-064).
- **The file names an agent app not set up here** (Claude Code, Codex): the folder imports and its row says "Claude Code is not set up on this computer"; it starts after setup, as restore does today (`restorable`).
- **A model, effort or context tier unknown here**: kept as saved; the session falls back as spec 030 does today.
- **A theme id unknown here** (removed built-in, or a user pack not installed): Clean Office, and the row says so (FR-048).
- **The navigator shortcut clashes** on this OS: not applied; the row says which shortcut owns it (FR-047).
- **More floors than `MAX_FLOORS`, folders than `MAX_FOLDERS`, servers than `MAX_SERVERS` per folder, schedules than `MAX_SCHEDULES`** after merge: the rows that do not fit are shown unticked and disabled with "No room: 40 floors at most".
- **An organization policy** (spec 076) manages a setting: the row is disabled with "Set by your organization".
- **The disk fills or a rename fails** mid-apply: everything written so far is put back from the backup, and the message says "Nothing was changed" (FR-061).
- **The app quits or crashes** mid-apply: the next start finds the journal and finishes the roll back before any store loads (FR-061).
- **The export would pass 16 MiB** (many long notes): the export says which folders' notes do not fit and offers *Save without them*; notes can still be exported per folder with Notes > *Export…* (083 FR-048).
- **An import file inside a folder an agent can write**: not trusted more or less; everything is validated and untrusted anyway (FR-030).
- **The simulator** (`DURBAR_SIM`): the channels are refused by the sim guard; the preview UI is fed by the simulator's own fixture (plan, Test strategy).

## Requirements

### A. The file format

- **FR-001** **One JSON file.** UTF-8 without BOM, LF line ends, 2-space indent, a final LF. Top-level keys in this fixed order: `format` (always `"agent-durbar-setup"`), `schemaVersion` (integer, `1` for this spec), `app` (`{ "name": "Agent Durbar", "version": "<semver>" }`), `createdAt` (ISO 8601 UTC, seconds), `sourceOs` (`"win32"`, `"darwin"` or `"linux"`), `notice` (a fixed English sentence that says what is not in the file), then the sections in this order: `settings`, `display`, `floors`, `folders`, `order`, `mcp`, `folderRules`, `schedules`, `notes`. A section the person unticked at export is absent.
- **FR-002** **Stable order.** Inside each object keys are sorted by code point; arrays keep their meaning order (floors, rooms, notes as stored). Exporting the same state twice gives the same bytes except `createdAt` (test).
- **FR-003** **No machine identity.** No host name, user name, machine id, MAC address, profile path, `userData` path, window position or size, display id, time zone or locale. `sourceOs` is the OS family only, needed for path mapping (FR-040).
- **FR-004** **Default file name** `agent-durbar-setup-<YYYY-MM-DD>.json` (local date), cleaned like `exportFileName`. Save and open dialogs filter `{ name: "Agent Durbar setup", extensions: ["json"] }`.

### B. Versions and compatibility

- **FR-010** **Older files are read.** A file with `schemaVersion` from 1 up to this build's version is upgraded in memory by pure, ordered migrations (`1 -> 2 -> ...`), never refused for being old. Each migration has a fixture test.
- **FR-011** **Newer files are refused whole.** A `schemaVersion` above this build's, or one that is not a positive integer, stops the import before the preview with the sentence of US4.2, naming `app.version` (masked, cut to 32 characters) and both format numbers. Nothing is read further.
- **FR-012** **Unknown fields, only where safe.** In a known schema version:
  - an unknown **top-level section** is not read; the preview lists its name (only `[a-z][A-Za-z0-9]{0,31}`, else "1 unnamed section") under "Not read by this version";
  - an unknown **key in a display or settings item** is ignored and counted ("2 choices not read");
  - an unknown **key in a folder, MCP server, folder-rule or schedule item** makes that **item** not offered (row shown disabled: "Uses something this version cannot read") — fail closed, because an unknown key there could change what runs or what is allowed.
  A writer that adds a field to a safety item therefore needs no version bump: older readers refuse that item.

### C. What goes in the file

- **FR-013** **App settings** (`settings`): an explicit allow-list of `AppSettings` keys: `defaultMaxAiCredits`, `placeMap`, `customPlaces`, `seriousMode`, `motion`, `autoFollowWork`, `theme`, `characters`, `notifyNeedsMe`, `autopilotLimit`, `breakResume`, `chatLinksIn`, `chatLinksNewTab`, `stillHighlights`, `checkUpdatesAtStart`, `mcpSignInRefresh`, `mcpWarnLevels`. **Not exported** (machine or one-time state): `announcedVersions`, `browserNoteAccepted` (a note the person accepts once per profile), `sandboxAlwaysContinue` ("on this computer", spec 087), `newFolderParent` (a path, spec 093), `diagnostics` (an import must not switch on a debug log). A test fails when `AppSettings` gains a key that is in neither list.
- **FR-014** **Floors** (`floors`): `id`, `name`, `on`, in order, and `lastFloor`, as `parseFloors` reads them.
- **FR-015** **Display** (`display`): an explicit allow-list of the window's choices with a validator each: density, office view (Flat or Real office), world, floor view, last floor, shutters, live activity, composer height, rail width, logo choice, Flat look, Real office people set, seat characters (`durbar.crew*`, only entries keyed by a folder that is exported, mapped like folders), and the navigator shortcut stored platform-neutral (`Mod` for Ctrl or ⌘, plus `code`). **Not exported**: `durbar.ui` (open chat and recent chat ids), `durbar.chatNo` (numbered chats are sessions), `durbar.prevOpen`, `durbar.schedSeen`, `durbar.railFolds`, `durbar.profileEditor.mode`, `durbar.simorder`, `durbar.detail`, `durbar.doorsigns` (removed). A test fails when the renderer uses a `durbar.*` storage key that is in neither list.
- **FR-016** **Reserved for features not built yet.** Basement and rooftop floors (#555) and chat panel docking (#452) do not exist on `main` today. When each lands, the same PR adds its fields here (floors and display) and to the FR-013/FR-015 lists, or the classification tests fail. Until then they are `[KNOWN GAP]` (FR-110), not a reason to hold this feature (owner 2026-11-09: v1 covers everything the issue lists that exists).
- **FR-017** **Things the issue names that do not exist**: door state (removed by spec 017 FR-034) and a language setting (none). The export carries neither; an old file's `closed` flag is ignored.
- **FR-018** **Notes** (`notes`): per exported folder, its notes as spec 083 stores them (title, text, done, order; not ids, revisions, tombstones, session ids, `.lock` or `.bad-*` files), masked again with `maskNoteText` on export. All notes text together at most 8 MiB; over that, the export says which folders' notes are left out (Edge cases). The folder's `notesProject` mirror flag is exported, but see FR-036.
- **FR-019** **Folders** (`folders`): per folder: `path` (FR-040), `label`, `floor`, `hidden`, `permMode`, `model`, `effort`, `contextTier`, `autoTier`, `maxAiCredits`, `adapterId`, `defaultAgent`, `notesProject`. **Not exported** (sessions and history): `lastSession`, `openSessions`, `sessionNames`, `prevPinned`, `prevHidden`, `sessionModes`, `notesIgnoreOwn` (an inode identity on this disk).
- **FR-019a** **MCP extras** (`mcp`): per folder (by `path`), each server's `name`, `transport`, `command`, `args`, `workingDirectory`, `url`, `tools`, `wasOn` (information only), the `env` and `headers` **key names**, and the folder's tools-off list. Masked per FR-020.
- **FR-019b** **Folder rules** (`folderRules`): per folder, the **declined** item digests only (FR-034).
- **FR-019c** **Schedules** (`schedules`): `id`, folder `path`, `prompt` (masked: `maskOutgoing`, then `cut` to `MAX_PROMPT`), `every`, `at`, `rule`, `cap` (unit and amount). **Not exported**: `target` (a session id), `next`, `last`, `paused`, `pausedReason`, `done`, `spent`, `spentUnknown`, run logs, and `loop` schedules (spec 072: a loop belongs to one session; the export lists them as "1 loop not carried").
- **FR-019d** **Order** (`order`): the manual room, desk and place order, with folder keys as FR-040 paths.

### D. What never goes in the file (constitution III)

- **FR-020** **Placeholders and drops.** The placeholder is the exact string `"<needs a value on this machine>"` (one constant, `NEEDS_VALUE`).
  | Field | Export |
  |---|---|
  | MCP `env` values, `headers` values | **placeholder** (every value, not only ones that look secret: `McpStore` treats all of them as secrets) |
  | MCP vault blob, value refs, `legacyEnc`, `trust` hash, `enabled` | **dropped** (`enabled` becomes informational `wasOn`) |
  | MCP `args` an argument `maskSecretArgs` changes | that argument becomes the **placeholder** |
  | MCP `command` | `maskSecretCommand`; if it changed, the server is marked `needsValue` |
  | MCP `url` | `maskSecretUrl`; if it changed, the URL is kept masked and the server is marked `needsValue` |
  | Home paths inside `command`, `args`, `workingDirectory` | `~` (FR-040), with `maskHomePaths` as a final pass for other users' homes |
  | Schedule prompts, note text, labels, floor and place names | masked with the shared masks (`maskOutgoing`, `maskNoteText`, `maskTokenShapes`); a changed value keeps its mask text |
  | Tokens, API keys, OAuth credentials, cookies, `.env` values | **never read** by the export (Durbar does not store them, constitution III) |
  | Chats, prompts sent, outputs, session ids, history, usage, activity, costs, summaries, checkpoints, held prompts | **dropped** (none of their files is read: `durbar-tool-usage.json`, `durbar-usage-totals.json`, `activity.json`, `durbar-mcp-costs.json`, `durbar-summary-days.json`, `checkpoints/`, `durbar-doors.json`) |
  | Harness config `~/.copilot`, `~/.claude`, `~/.claude.json`, `~/.codex`, VS Code chat stores | **never read** |
  | Window place and size, quit time (`durbar-app-state.json`), crash markers | **dropped** |
  | Custom agent confirmations (`durbar-agent-trust.json`), accepted folder-rule digests | **dropped** (trust is decided on the new machine) |
- **FR-021** **Masked twice.** The export builds the document from the stores' parsed views, masks each free-text field with the shared helper (mask, then cut), and before writing runs `maskTokenShapes` over the whole serialized text as a backstop; a change at that step is a bug, counted in a test, and the text written is the masked one.
- **FR-022** **Said plainly.** The export dialog and the file's `notice` say that prompts and notes are the person's own text, masked for known token shapes but not read for every secret, and to look before sharing the file.

### E. Paths

- **FR-040** **Home-relative, never the user name.** A path is stored as `{ "base": "home", "parts": [...] }` when it is inside this computer's home folder (`os.homedir()`, compared with `normaliseFolderKey` rules: case-insensitive on Windows and macOS), else `{ "base": "abs", "root": "<root>", "parts": [...] }` with `root` `/`, a drive (`D:\`) or a UNC share (`\\server\share\`) (Q2, answered (A) 2026-11-09), and always with the file's `sourceOs`. `parts` are plain names: no separator, no `.` or `..`, no empty part, no NUL or control character, each at most 255 characters, at most 64 parts. `.code-workspace` files keep their file name as the last part. Text fields that hold a home path (MCP `command`, `args`, `workingDirectory`) use a leading `~` plus `/`, then `maskHomePaths`.
- **FR-041** **Resolved here, never against `userData`.** On import, `home` paths are joined to this computer's home with `path.join` (this OS's separators); `abs` paths are used only when `sourceOs` is this OS family and the root exists. No file content is ever used to build a path under `userData` or the backup folder: store files have fixed names, and notes file names come from `folderFingerprint` of the **local** mapped path (FR-018), never from the file.
- **FR-042** **Map, skip or keep missing.** Each folder whose resolved path does not exist (or cannot be resolved) gets three choices: *Choose folder…* (main's folder dialog), *Skip* (default when nothing is found) and *Keep as missing* (only when the resolved path is a valid absolute path on this OS: it is saved like an unplugged drive is today, and not shown until it exists). A foreign `abs` path offers only *Choose folder…* and *Skip*. MCP extras, folder rules, schedules, notes, order entries and seat characters of a skipped folder are skipped with it; the preview says how many.
- **FR-043** **Checked before it becomes a folder.** A folder (found or chosen) is imported only after main checks it now: it exists, `lstat` then `realpath`, is a directory (or a regular `.code-workspace` file), and is not inside `userData`. The real path is the key. The person sees the result in the row before *Import*.
- **FR-039** **Imported `~` in MCP fields** is expanded to this home only after mapping, and the preview shows the final command exactly as it will run.

### F. Import: reading a hostile file

- **FR-050** **Main picks and reads.** *Import…* asks main to show `dialog.showOpenDialog` (one file, the FR-004 filter). The window never sends a path. Main `lstat`s the chosen name (a regular file, not a link to a device, FIFO or socket), opens it, checks the size with `fstat` (**at most 16 MiB**) and reads at most 16 MiB + 1 byte; more is refused.
- **FR-051** **Decoding.** `TextDecoder('utf-8', { fatal: true })`; a leading BOM is dropped; a NUL byte refuses the file.
- **FR-052** **JSON only.** `JSON.parse` and nothing else: no `eval`, `Function`, `require`, `import()`, YAML, JSON5, comments or reviver that builds objects; the result must be a plain object.
- **FR-053** **Shape limits before anything else.** One linear walk checks: depth at most 16, at most 200,000 values in total, every key at most 128 characters, and **no key named `__proto__`, `constructor` or `prototype` at any depth** (the file is refused, not cleaned). Strings at most 64 KiB unless a field sets less.
- **FR-054** **Strict schema per field.** Every field has a type, length and count limit, taken from the store that owns it (one limit end to end): names through the existing parsers (`parseFloors`, `parseLabel`, `parseAdapterId`, `parseDefaultAgent`, `parseCap`, `parseThemeId`, `parseCharacters`, `parseSettings`'s per-key rules, `validateInput` and `NAME_RE` for MCP, `cleanSchedule` with `MAX_PROMPT`, `NOTES_LIMITS`), counts at most `MAX_FLOORS` (40), `MAX_FOLDERS` (200), `MAX_SERVERS` (100) per folder, 64 args, 64 env and 64 header keys per server, `MAX_SCHEDULES` (50), 300 notes per folder, digests `^[0-9a-f]{32}$` (400 per folder). Numbers must be finite; integers where the store wants integers.
- **FR-055** **Copied through allow-lists.** Valid values are copied into new objects created with known keys only (own properties, `Object.create(null)` or literal objects); nothing from the file is spread, merged or assigned onto an existing object.
- **FR-056** **Text is data.** Every string from the file shown in the preview is masked again (`maskTokenShapes`), cut for display, and set as text (never HTML); hidden and bidi characters are refused in names (`names.ts`) and shown as `\u` escapes elsewhere.
- **FR-057** **Bad items vs a bad file.** A broken envelope (FR-050..FR-053, `format`, `schemaVersion`) refuses the whole file with one sentence. A broken item (one folder, one server) is shown disabled with its reason; the rest can be imported.
- **FR-058** **Bounded time.** Parsing and building the preview of a 16 MiB file stays linear; a test bounds CPU time on the largest fixture (checklist "hostile lists in linear time").

### G. Nothing runs by itself

- **FR-030** **Trust and values in the file are ignored.** Fields named `trust`, `trusted`, `enabled`, `accepted`, any `env` or header **value**, and any placeholder are never used to decide anything: a server is created exactly as `mcpimport.ts` creates one today (`McpStore.upsert`: **off, untrusted**), its secret keys listed with no value. The preview says "Values and trust in the file are never used".
- **FR-031** **MCP servers off and untrusted.** Each imported server is off; switching it on shows the existing trust dialog with the final command (FR-039); servers marked `needsValue` or with secret keys cannot be switched on until values are entered in the existing MCP dialog.
- **FR-032** **Exact commands in the preview.** Each MCP row shows transport, the full command and arguments (placeholders shown as such), working directory or URL, exactly as they will be saved, masked only where FR-020 masked them.
- **FR-033** **Permission mode.** Read-only and Ask are imported as they are. **Allow all** is imported as **Ask**, and the row has a separate box "Keep Allow all for this folder", unticked (Q1, answered (A) 2026-11-09). Imported modes apply to new chats; open sessions keep theirs.
- **FR-034** **Folder rules.** Accepted digests are never imported: those items are pending and asked again when the folder is opened (spec 061). Declined digests are imported (declining runs nothing).
- **FR-035** **Schedules paused.** Every imported schedule is saved `paused` with a new `pausedReason` `'imported'`, shown as "Imported: check and resume"; it targets the folder's next session when resumed; a once-schedule whose time has passed stays paused and asks for a new time.
- **FR-036** **No writes into projects.** `notesProject` is imported as off, with the row saying "Notes file in the project: off (turn on in Notes)"; Durbar writes nothing into an imported folder by itself.
- **FR-037** **Custom agents** keep their id as the folder's default; the agent file is confirmed again on first use (spec 043).
- **FR-038** **Caps never loosen silently.** A credit cap (folder, default, schedule) that would be higher than the current one, or would remove one, is a *Change* row marked "raises the limit", unticked in both modes.

### H. Preview, choices and apply

- **FR-044** **Merge** (default). New items are *Add* rows, ticked. Items present in both are *Change* rows listing each differing field (mine, then the file's), unticked: "Keep mine" is the default. Matching: floors by name (trimmed, NFC, case-insensitive); folders by local path (`normaliseFolderKey`: case-insensitive on Windows and macOS); MCP servers by folder and name (case-insensitive, as `McpStore`); schedules by `id` (same id: *Take the file's*, *Keep mine* (default), *Keep both* with a new id); settings and display by key; notes by folder, a note equal in title and text to an existing one is not added again; declined digests are a union.
- **FR-045** **Replace.** For each section the person ticks, the section becomes the file's: current items not in the file are *Remove* rows (ticked). Replace with *Folders* removes folders through the existing remove-folder path (sessions closed); their notes stay unless *Also delete their notes* is ticked (unticked, as 083 FR-048). Replace with *Notes* makes `<userData>/notes/` hold exactly the file's notes for the imported folders (Ruben 2026-10-30); every file changed there is in the backup.
- **FR-046** **Per-item boxes.** Every row has a box; every section has an *All* box (ticked, unticked or mixed); a row that cannot be imported is disabled with its reason. Dependencies are kept: unticking a folder unticks its MCP servers, rules, schedules, notes and seat characters (and says so); ticking one of those ticks its folder.
- **FR-047** **Shortcut.** The navigator shortcut is checked with spec 074's `clashOf(combo, mac)` on this OS before it is offered; a clash disables the row with the owner's name.
- **FR-048** **Themes and characters.** A theme id this build cannot use (`parseThemeId` drops it, or a user pack is not in `<userData>/themes/`) is imported as Clean Office, and the row says "Theme <name> is not on this computer" (Q3, answered (A) 2026-11-09).
- **FR-049** **Summary line.** The preview's footer says what will happen in words ("Add 3 floors, 8 folders, 5 MCP servers (off), 4 schedules (paused); change 2 settings; remove nothing") and *Import* is disabled when nothing is ticked.
- **FR-060** **Backup first.** Before any write, main copies every file the apply may change into `<userData>/setup-backups/<UTC-time>/` (folder 0700, files 0600 on POSIX): the store files, `notes/*.json` (not `.lock`; `.bad-*` files stay where they are), and the window's display values; plus a manifest of what was copied. At most 3 backups are kept (Q4, answered (A) 2026-11-09); the oldest goes when a fourth is made. A failed backup stops the import with nothing changed.
- **FR-061** **All or nothing.** Main builds every new document in memory and validates it with the stores' own parsers; writes each to a temp file next to its target (`O_CREAT|O_EXCL`, 0600, `fsync`); writes a journal (`setup-import.journal`: the list of targets and the backup folder); renames each into place in a fixed order; deletes the journal. A failure at any step puts back every target already renamed from the backup and deletes temp files; the result says "Nothing was changed". At start-up, before any store loads, a journal left behind is rolled back the same way. The stores then reload from disk, and the window applies the display section last (a display write that fails is reported; Undo still covers it).
- **FR-062** **Undo.** Settings > Setup file shows *Undo import (<time>)* for the newest import backup. Undo asks with `nativeConfirm`, takes a backup of the current state first, and restores the import's backup with FR-061's steps. Undo is refused while agents are working (FR-064).
- **FR-063** **Only a person in the window.** The channels are window-only (`ipcHandle` with `fromAppFrame`). The import needs both main's open dialog (the file) and main's `nativeConfirm` (the apply). There is no Durbar MCP tool (spec 041), remote-control action (spec 054), schedule action, menu item that applies without the preview, command-line flag or environment variable that imports or applies; a test checks the Durbar MCP tool list and the remote channels have none.
- **FR-064** **Not while working.** Import and Undo are refused while any session is mid-turn, has a pending permission, a schedule run or a loop is in flight; the message names how many.
- **FR-065** **One pending import.** Main keeps the parsed file in memory under a random token for at most 10 minutes or until the preview closes; every later call names the token and item ids from that preview only; unknown ids are refused.

### I. Export

- **FR-070** **Export dialog.** *Export…* opens a dialog with a box per section (all ticked; *Notes* says "your own text, masked for tokens") and FR-022's sentence; *Save…* asks main to collect, mask, serialize and show its save dialog (`showOverwriteConfirmation`, `createDirectory`); the window sends only the section choices and its display values (validated in main by the FR-015 allow-list).
- **FR-071** **Written safely.** The file is written with `writeNotesExport`'s steps (new temp, `O_NOFOLLOW` where defined, 0600 and `fchmod` 0600 on POSIX, re-check, rename; Windows retry once). On Windows the file takes the folder's permissions (`[KNOWN GAP]`, FR-112).
- **FR-072** **Result.** A toast with counts (US1.1) and what was left out (loops, notes over the limit, servers needing values); no path in the toast (the file name only).

### J. Worlds, keyboard and screen reader

- **FR-080** **Keyboard.** The preview is a modal dialog (focus trapped, Esc cancels, focus returns to *Import…*). Order: mode (*Merge* / *Replace* radio group), sections (each a disclosure with its *All* box), rows (box, then *Choose folder…*, *Skip*, *Keep as missing* as a radio group), *Import*, *Cancel*. Space toggles a box; Enter on *Import* only. Sections over 20 rows start collapsed with their counts, so 200 folders stay usable.
- **FR-081** **Screen reader.** Each section is a `fieldset` with a `legend` ("Folders: 8 to add, 3 to change"); each box's name is its action and item (US6.1); disabled rows have their reason as description; the summary line (FR-049) is a polite live region updated at most once a second; the refusal sentence of a bad file goes to `#srAnnounce`.
- **FR-082** **Not by colour.** *Add*, *Change*, *Remove*, *Off*, *Paused*, *Not trusted*, *Needs a value*, *Raises the limit* are words (and icons), never colour alone.
- **FR-083** **Fits.** Text at least 10.5 px; the preview fits 1280x800 and 1440x900 with its own scroll inside the dialog, no page overflow.
- **FR-084** **Where it lives.** A Settings section **Setup file** (heading, so `settingsnav.js` lists it) with *Export…*, *Import…* and, after an import, *Undo import (<time>)*. The macOS app menu's File menu gets *Export setup…* and *Import setup…* that open the same dialogs (never apply by themselves).
- **FR-085** **All worlds.** Open office (Flat), Real office and Retro arcade: the section and both dialogs take the world's tokens only (097 FR-113, 102), no art behind text; Retro arcade's pixel font stays at least 10.5 px; screenshots in each world at both sizes.

### K. Platforms (constitution VI)

- **FR-090** **Paths with `path`.** Pure path code takes `path.win32` or `path.posix` and an injected home, so every OS case is tested on every runner: drive letters, UNC roots, `C:\Users\me` vs `/Users/me` vs `/home/me`, case-insensitive compare on Windows and macOS (`normaliseFolderKey`), a `parts` element with `\` on POSIX or `/` on Windows refused.
- **FR-091** **Line ends.** The file is written with LF on every OS; CRLF is accepted on read; note and prompt text keep their own line ends normalised to LF.
- **FR-092** **Dialogs.** The same filter on all three (GTK, Windows, macOS); Linux gets `showOverwriteConfirmation`.
- **FR-093** **File modes.** Export file, backups and journal 0600 (folders 0700) on POSIX; on Windows the folder's ACL (`[KNOWN GAP]`).
- **FR-094** **Modifier keys.** The navigator shortcut is stored as `Mod` and shown as ⌘ on macOS, Ctrl elsewhere (074 FR-017).

### L. Honest limits

- **FR-110** `[KNOWN GAP]` Basement and rooftop (#555) and chat panel docking (#452) are not in the file until they exist (FR-016).
- **FR-111** `[KNOWN GAP]` Free text (prompts, notes, names) is masked for known token shapes only; a secret written in plain words can be exported (FR-022 says so).
- **FR-112** `[KNOWN GAP]` Windows file permissions of the export and backups are the folder's (no ACL change).
- **FR-113** `[KNOWN GAP]` A crash between two renames is rolled back at the next start (FR-061), not instantly; a file system that does not make rename atomic (some network drives) is not protected.
- **FR-114** `[KNOWN GAP]` Built and checked on the simulator, unit tests and Linux; a real move between macOS, Windows and Linux machines is a separate check by the machines' owners (T030). No real agent session is needed.
- **FR-115** User theme packs and their art are not in the file in v1 (Q3, answered (A) 2026-11-09); seat characters refer to built-in characters only.

## Success criteria

- **SC-001** Round trip: a seeded profile (3 floors, 12 folders with every FR-019 field, 5 MCP servers with env, headers and a secret arg, rules, 4 schedules, notes, display values) exported and imported on an empty profile gives the same `durbar-folders.json` floors, folders and order, the same settings and display values, the same notes, MCP servers equal except off, untrusted and values empty, schedules equal except paused. Unit test, every OS.
- **SC-002** No secret: with planted values (env, header, token-shaped arg, token in a prompt and a note, `/home/<user>` and `C:\Users\<user>` paths), the exported bytes contain none of them nor the user name (test, also on the serialized text).
- **SC-003** Hostile files: each FR-050..FR-058 fixture (oversize, BOM-less UTF-16, NUL, deep nesting, `__proto__` / `constructor` / `prototype` at depth 1 and 10, `..` part, absolute part, 201 folders, huge string, `NaN`-like values, unknown major version, trust fields set) is refused or ignored exactly as specified, and no file under `userData` changes (test compares a hash of the folder).
- **SC-004** Nothing runs: after any import no MCP server is on, no schedule is unpaused, no accepted folder-rule digest exists that did not before, no folder is Allow all unless its box was ticked (test).
- **SC-005** All or nothing: a fault injected at each write and rename step leaves every store file byte-identical to before (test with an injected fs); a journal left by a simulated crash is rolled back at start.
- **SC-006** Undo restores byte-identical store files and notes (test).
- **SC-007** The preview is usable with keyboard only and named for a screen reader (driver), fits both sizes in all three worlds (screenshots).
- **SC-008** Zero AI credits: no adapter send during any test or driver.

## Assumptions

- The person exports on a computer they trust and moves the file themselves; the file is not encrypted or signed (a passphrase is out of scope for v1; nothing secret is in it).
- Merge and replace act on the current profile (spec 049).
- The stores keep their own parsers as the source of truth for limits; this feature calls them rather than copying limits.

## Clarifications

All five were answered on 2026-11-09 by the owner (Vikram, Telegram 07:24 UTC, "All ok", recorded on PR #1374): the recommended default of each was accepted. The options are kept for the record.

- **Q1 Allow all in an imported file.** (A) Imported as Ask, with a per-folder box "Keep Allow all for this folder", unticked (**recommended**: Allow all stays an explicit choice on this machine, constitution III); (B) never imported (always Ask or lower); (C) imported as it is, as restore does (spec 003 FR-025). **Answered 2026-11-09 (Vikram): (A)** (the recommended default).
- **Q2 Paths outside the home folder** (`D:\work`, `/srv/x`). (A) Written as they are with the root and `sourceOs`, listed in the export dialog so the person can untick (**recommended**: they rarely hold a user name and are needed for mapping); (B) dropped from the file (those folders do not travel); (C) written with all but the last folder name replaced by `…` (the person always maps them). **Answered 2026-11-09 (Vikram): (A)** (the recommended default).
- **Q3 User theme packs (spec 040).** (A) Only the theme id; a pack not on the new computer falls back to Clean Office and says so (**recommended** for v1: packs hold images, and loading files from an import widens the hostile-input surface); (B) the pack's manifest and images embedded (at most 8 MiB, re-checked by spec 040's loader rules) in a later version. **Answered 2026-11-09 (Vikram): (A)** (the recommended default).
- **Q4 Backups and undo.** (A) Keep the last 3 import backups; *Undo* for the newest one until the next import (**recommended**); (B) keep 1; (C) keep 30 days. **Answered 2026-11-09 (Vikram): (A)** (the recommended default).
- **Q5 Free text at export.** Schedule prompts and notes are exported masked for token shapes. (A) Ticked by default, with FR-022's sentence (**recommended**: the owner wants the whole setup); (B) unticked by default. **Answered 2026-11-09 (Vikram): (A)** (the recommended default).

## Changes

- **2026-11-09, owner answers.** Vikram (Telegram 07:24 UTC, "All ok") accepted the recommended default of Q1..Q5, all (A): Allow all is imported as Ask with an unticked "Keep Allow all for this folder" box (FR-033); paths outside the home folder are written as they are with their root and `sourceOs`, listed for unticking at export (FR-040); a user theme pack travels as its id only, falling back to Clean Office (FR-048, FR-115); the last 3 backups are kept, with Undo for the newest (FR-060); schedule prompts and notes are ticked by default with FR-022's sentence. The spec's defaults are now the decisions; T016 is done.
