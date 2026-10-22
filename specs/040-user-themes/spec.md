# Feature Specification: User themes — personal packs with import/export (spec 040)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 035-040
title: User themes: `userData/themes/<id>/manifest.json`, import/export, validation
status: **built** (`test:userthemes`); delta 2026-10-19: make a theme with AI, light or dark with art, several passes, ideas (FR-014..FR-021, issue #182), and Export fixed (FR-019) built; delta 2026-10-20: the AI theme maker on Copilot (FR-015, T026, #301) built on a fake SDK; real check done 2026-10-20 (T027: 2 prompts, 0.50 AI credits; bare token names fixed, FR-022)
-->

**Feature Branch**: `035-theme-foundation` (issue #129)
**Created**: 2026-10-18
**Status**: Implemented on branch `035-theme-foundation` (PR #137): simulator and unit tests, 0 AIU; not released
**Input**: Vikram (issue #129): other users must be able to make their own theme.

## Clarifications (binding)

- A user theme is a **folder under per-user data**: `userData/themes/<id>/manifest.json` (+ nothing else required; the manifest carries tokens, art and words inline). No zip support, no network.
- Import = copy a folder (chosen with the system folder picker) **into** `userData/themes/`; export = copy the theme's folder **out** to a picked directory. A manifest is validated with the same schema and SVG sanitizer as built-ins; a malformed pack is rejected with a toast and never applied.

## User Scenarios & Testing

### Story 1 — My theme appears next to the built-ins
1. **Given** `userData/themes/ocean/manifest.json` with a valid manifest, **Then** Settings > Theme lists "Ocean" and I can switch to it like a built-in.
2. **Given** a broken manifest, **Then** the pack is ignored, a console warning names the file, and Clean Office stays.

### Story 2 — Import/export
1. **Given** Settings > Theme > Import, **Then** after picking a folder whose `manifest.json` validates, the folder is copied to `userData/themes/<id>/`, the theme is applied and appears on restart.
2. **Given** Export on the active user theme, **Then** the folder is copied to the picked directory unchanged.
3. **Given** an invalid folder (no manifest / malformed / unsafe SVG), **Then** a toast says what was wrong and nothing is copied or applied.
4. **Given** a user theme id equal to a built-in, **Then** import is refused ("id is a built-in").

## Requirements

- **FR-001** `[IMPLEMENTED]` Main: `theme:listUser` scans `userData/themes/*/manifest.json`, validates (id pattern, size caps: manifest ≤ 64 KB, ≤ 160 tokens (40 before 2026-10-19; raised so a generated dark theme can set every colour), ≤ 24 slots, ≤ 24 words, folder name = id), returns `{id,name}` per valid pack plus `{folder,error}` per invalid one.
- **FR-002** `[IMPLEMENTED]` Main: `theme:getUser(id)` returns the manifest JSON (validated again) for renderer application; unknown/invalid → `null`.
- **FR-003** `[IMPLEMENTED]` Main: `theme:import` (folder picker) validates, refuses built-in ids and path escapes, copies the folder (flat, ≤ 8 files, ≤ 64 KB each) to `userData/themes/<id>/`; `theme:export` copies the active user theme's folder out. Both return `{ok,error?}`.
- **FR-004** `[IMPLEMENTED]` Renderer: Theme section lists built-ins + user themes (tagged "yours"); picking a user theme applies its manifest via `THEME.setTheme(manifest object)` and persists the id; invalid picks toast and stay on the old theme.
- **FR-005** `[SUPERSEDED 2026-10-18]` ~~Sanitizer unchanged (same whitelist); pixel maps allowed as in spec 038.~~ See `## Changes`: the sanitizer now rebuilds fragments.

## Success Criteria
- Import a hand-made pack on disk → appears, applies, survives restart, exports byte-identical; a tampered manifest is refused with a clear toast; `npm test` covers the store/validate paths without Electron.

## Changes

### 2026-10-18: imported themes are untrusted input (review of PR #137)

**Symptom.** Paco's review found that the art-slot sanitizer checks a fragment with regexes and then returns the **original string**, which goes into `innerHTML`. An unquoted attribute value (`\S+`) also matches `<` and `>`, so `<rect fill=x><style>…</style>` passed and injected CSS into the whole window (`style-src 'unsafe-inline'`). While fixing it, two more holes of the same kind were found: theme **tokens** were copied without checks, `applyTokens` set *any* manifest key as an inline style on `<html>` (`{"display":"none"}` hides the app), and token values are inlined unescaped into SVG attributes (`fill="${token}"`), so a value with a `"` breaks out of the attribute. Words were already escaped where shown, but any key and any length was kept.

**Violated.** #129 invariants "data-only, no raw CSS" and "status, permission and credit wording never change"; FR-005 assumed the sanitizer was safe for untrusted input.

**Corrected wording.**
- **FR-005** `[IMPLEMENTED]` The sanitizer **rebuilds** each art fragment from allowed elements and attributes instead of passing the input through: every attribute value must be quoted, may not contain `<`, `>` or a backtick, and is re-serialized with `&`, `<`, `>`, `"` escaped; `url(...)` is allowed only as a local reference `url(#id)`. Anything else rejects the slot (the default drawing is used). Built-in slots are already in this canonical form and come out byte-identical.
- **FR-006** `[IMPLEMENTED]` Tokens: only the keys of Clean Office (`--name` custom properties) are kept, and each value must be a colour (`#hex`, `rgb()`/`rgba()`/`hsl()`/`hsla()` with numbers only), a number with an optional unit, or a single keyword, at most 64 characters. Other keys and values are dropped (the Clean Office value is used). The main process refuses to import a manifest with a token key that is not `--name` or a value outside this grammar, and says which token.
- **FR-007** `[IMPLEMENTED]` Words: only the scene-word keys of Clean Office are kept, each a string of at most 60 characters without control characters (the longest built-in, an accessible lobby label, is 42); others are dropped. They stay escaped wherever they are shown.
- **FR-009** `[IMPLEMENTED]` A user theme may name a `scene` kit from the fixed list (spec 035 FR-013); main refuses an unknown one with a message.
- **FR-010** `[IMPLEMENTED]` Art keys are limited to the slots the renderer draws (`ART_SLOTS`: plant, the three room layers, lobby, door, the five place icons and the office-kit overlays); the renderer drops any other key and main refuses it on import, naming the slot.
- **FR-008** `[IMPLEMENTED]` Review follow-ups: `theme:listUser` sends only id, name, ok and error to the renderer (no folder path); a failed import removes its temporary folder and returns `{ok:false}` instead of throwing; the `DURBAR_PICK` dev hook takes the whole value (Windows `C:\…` paths); `DURBAR_THEME` applies a theme for the run without saving it.

**Tests.** `test:theme` adds Paco's bypass strings and the token and word cases; `test:userthemes` adds a refused token and a failed copy that leaves no temporary folder.

### 2026-10-19: AI theme maker (issue #182, split from #129)

*Owner:* "can you work on some other issue in parallel like issue #182". The issue's open questions are settled here; the owner's request also covers the AI credits a generation spends.

- **FR-014** **Make a theme with AI.** Settings > Theme has **Make a theme with AI…**:
  1. The user describes a look in words ("a night-shift newsroom", "a ship's bridge"), at most 300 characters.
  2. The user picks a harness that can do it (one marked `oneShot`, see FR-015).
  3. Durbar asks that harness once and shows the result: name, colour swatches, UI style, scene kit and place names.
  4. **Try it** applies it live without saving. **Save as my theme** stores it as a user theme (FR-001, same folder and format), and it then appears in the list with "yours". **Discard** goes back to the theme that was active before; that is the undo.
- **FR-015** **Harness.** The optional adapter capability `oneShot` with `generateText(prompt)` runs one prompt with **no tools, no MCP servers and no session kept**, in an empty temporary folder:
  - **Claude Code:** `claude -p <prompt> --tools "" --no-session-persistence --strict-mcp-config --setting-sources "" --output-format json --max-budget-usd 0.25`; its dollar estimate is shown with the result.
  - **Codex:** an ephemeral thread with the read-only sandbox and no approvals.
  - **Copilot:** a throw-away SDK session, see the change of 2026-10-20 below.
  - **Simulator:** a canned theme.
- **FR-016** **Only the safe subset.** `src/shared/themegen.ts` writes the prompt, which lists the allowed fields and values and asks for JSON only. It then takes from the reply **only**:
  - a name of up to 40 characters, which becomes an id `ai-<slug>` that clashes with no built-in or saved theme;
  - `ui` and `scene` from the fixed lists (FR-007), with anything else falling back to Clean;
  - colours for **any token that Clean Office defines** (about 145), as `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgb()`/`rgba()`, which are converted to hex; anything else is dropped;
  - place and door words for a fixed list of keys, as plain text of at most 40 characters (`<`, `>`, `{` and `}` dropped);
  - **art** for the 15 scene slots (people, desks, monitors, plants and the like), each at most 4000 characters, **only through the art sanitiser** (`_sanitizeSlot`, the same one imported packs use: allowed shapes and attributes only, no scripts, no links, no `url()`, no styles). A slot the sanitiser refuses is left out with a warning. The prompt gives each slot's geometry, so the art lines up with the scene (for example, the monitor's screen stays clear for the agent state).
  - Missing tokens fall back to Clean Office (`extends: "clean-office"`). The result then passes the same `checkUserManifest` as an imported pack (FR-005..FR-010) and the renderer's own validator.
- **FR-017** **Legible, light or dark.** *Owner:* "ai can take multiple passes than hand tuning those retro pixel type themes no? rather than adding it as a limitation". An earlier draft allowed light themes only; that limit is gone. The prompt lists every token with its Clean value, so a dark look sets them all. `themeIssues` then checks:
  - 20 contrast pairs (WCAG): `--ink` on `--bg`, `--surface`, `--raised` and the three card colours, `--ink-2` on `--surface`, `--soft` and `--note` (4.5:1); `--muted` on `--surface` and `--room-path` on `--bg` (3:1); each status pill's text on its background (4.5:1); the drop zone, the brand mark and the idle stub;
  - **the top bar:** the corporate and retro styles fill it with `--ink`, and the Indian and European courts with `--brand-bg`, under fixed light text, so that colour must be dark enough (4.5:1);
  - **a dark page sets every light token:** when `--bg` is dark, any token still on a light Clean value is listed.

  The CSS now takes every surface from tokens: 25 hard-coded whites became `--raised`, translucent whites a `color-mix` of `--raised`, and card and note backgrounds got their own tokens (`--card`, `--card-waiting`, `--card-error`, `--soft`, `--note` and others). Each new token has its exact old value, so built-in themes look the same (`check:themes`).

  Status colours keep their meaning: the prompt asks for blue-ish working, amber waiting, red error and so on, and the status words are the same in every theme. The hue itself is not enforced.
- **FR-018** **Nothing is kept from the description.** It is sent once to the chosen harness and not stored. A saved theme stores only its manifest, with `author: "AI theme maker"` and the description as `description`, cut to 300 characters, so the user can see later where the theme came from.
- **FR-019** **Export works on the active theme** (the owner, on alpha.7: "export active theme did not work").
  - **The cause:** Settings painted the Export button and the theme list once, so after picking another theme on the same screen, Export still used the old theme (disabled for a built-in one, or exporting the wrong one), and the list kept the old "pressed" marker.
  - **The fix:**
    - Export reads the theme that is active **when clicked**;
    - on a built-in theme it says why there is nothing to export, instead of being silently disabled;
    - the list marks the new choice at once;
    - the export folder picker can create a new folder (macOS shows *New Folder* only with `createDirectory`).
- **FR-020** **Several passes, not hand tuning.** Generation is a loop in main, at most `MAX_PASSES = 3` calls:
  1. If a reply has no usable theme (no JSON, too few colours), it is asked again once with the error.
  2. If the theme has issues (FR-017), the model gets its own JSON back with the list of issues and fixes them (`buildFixPrompt`). The best result so far (fewest issues) is kept. **The art is not sent back:** the checks are about colours, and 15 art slots could make the prompt about 65,000 characters, more than one command line allows on Windows (32,767). The fix pass answers without art, and `keepArt` keeps the earlier pass's already sanitised art, if the theme still passes `checkUserManifest`. A fix prompt stays under 16,000 characters (unit test).
  3. After the passes, a top-bar issue that is left switches the UI style to `clean`, whose top bar follows `--surface` and `--ink`. Text that is still unreadable (`--ink`, `--ink-2` or `--muted`) refuses the theme; the user sees why and can **Try again**. Other issues left are shown as warnings with the preview.

  The preview says how many passes it took and the total dollar estimate (Claude).
- **FR-021** **Ideas and a try bar.** *Owner:* "give some ideas (random ones from a list you store) like what you are testing, pirate,.. so that users know how to prompt."
  - The dialog shows 4 random ideas from a stored list of 24 (`THEME_IDEAS`, for example "a pirate ship at night", "a Kyoto tea house in autumn"). Clicking one fills the description; **More ideas** draws 4 others.
  - **Try it** closes Settings and shows the theme on the whole app, with a small bar at the bottom: **Save as my theme**, **Details** (the preview again), **Try again** and **Discard**. Nothing is saved until the user says so.
- `[IMPLEMENTED]`:
  - `src/shared/themegen.ts` (`buildThemePrompt`, `buildRetryPrompt`, `buildFixPrompt`, `parseGeneratedTheme`, `themeIssues`, `firstJsonObject`, `toHex`, `contrast`, `THEME_IDEAS`, `pickIdeas`);
  - the pass loop in IPC `theme:generate`, and IPC `theme:ideas`; the token cap at 160; the new surface and card tokens in `theme.js` and `styles.css`;
  - `generateText` in `claude.ts` (`oneShotArgs`, an empty temp folder, removed after) and `codex.ts` (an ephemeral read-only thread in its own probe child);
  - the capability `oneShot`; IPC `theme:generate` and `theme:saveGenerated`; `UserThemeStore.saveManifest`;
  - Settings > Theme > **Make a theme with AI…** (ideas, describe, harness, preview with swatches, place names, passes and cost; Try it with the try bar, Save as my theme, Try again, Discard);
  - `previewTheme` in `app.js`; the simulator and the fake adapter.
- `test:`
  - `test:themegen`: the prompt; JSON extraction; the safe subset against art, CSS, `url()`, scripts, unknown keys, status colours and `<…>` in words; `rgb()` conversion; art through the sanitiser and refused art; the contrast pairs, the top bar per UI style and the dark-page check; the fix prompt; ideas; unique and accent-folded ids.
  - `test:claudeadapter`: `oneShotArgs`, the temp folder, a failure.
  - `test:runtime`: Codex `generateText` on the fake app-server, and contract C2 `generateText() <=> oneShot`.
- `sim:` `scripts/shots-040-aitheme.js` at 1440x900 and 1280x800:
  - Export on a built-in theme explains itself;
  - the dialog offers Claude but not Copilot;
  - the dialog shows idea chips, a click fills the description, and More ideas draws others;
  - the preview shows swatches and words; Try it closes Settings and shows the try bar; Discard restores; Details and Try again work from the bar;
  - Save lists the theme as "yours" and makes it active; Export then works; the list marks a new pick at once.
  - Screenshots: `docs/screenshots/040-aitheme-*.png` and `040-aitheme-preview-*.png`.
- `real:` 2026-10-19, the description "a ship's bridge at dawn":
  - **Claude Code 2.1.303 (haiku):** "Bridge at dawn" in 12 s for $0.0019; 37 colours, place names like "Logbook" and "Seal hatch"; passes every check.
  - **Codex 0.163:** "Dawn on the bridge" in 15 s; light, place names like "Chart Room" and "Observation Deck"; passes. Its first try came out dark with only part of the colours set, which looked broken and led to FR-017 and FR-020.
- `real:` 2026-10-19, after FR-017 and FR-020, Claude Code (haiku), "a pirate ship at night": pass 1 gave 145 colours and all 15 art slots with 1 contrast issue; pass 2 fixed it. About $0.01 in total. The render (built from the saved manifest in the simulator) shows a consistent dark theme: readable cards, room pills, lobby and top bar, and generated art on the people and desks. Screenshot: `docs/screenshots/040-aitheme-pirate-1440x900.png`.
- `real:` 2026-10-19, after the art-free fix pass, Claude Code (haiku), "a haunted Victorian library at midnight": pass 1 gave 144 colours and 14 art slots with 1 issue (`--room-path` on `--bg` 2.8:1); the fix prompt was 4,133 characters; pass 2 had no issues, and `keepArt` kept all 14 art slots. 56 s, $0.0091.
- `[KNOWN GAP]`:
  - Copilot cannot make a theme yet (a throw-away SDK session is needed);
  - the status hues are asked for in the prompt, not enforced;
  - a dark theme from Codex was not tried after FR-020 (Claude was);
  - the full app with a real harness was not driven through the dialog. The adapters were checked for real, and the dialog in the simulator.

### 2026-10-20: the AI theme maker on Copilot (issue #301, T026)

*Owner (issue #301):* "Copilot is not offered yet: it needs a throw-away SDK session with no tools, no MCP servers and nothing kept, then disposed."

- **FR-015** (Copilot) `[IMPLEMENTED]` (fake SDK only) The Copilot adapter reports `oneShot`. `generateText(prompt, { disabledMcpServers })` uses the shared runtime (no second process) and creates one session with `oneShotConfig`:
  - **no tools:** `availableTools: []`, and `excludedTools: ['builtin:*', 'mcp:*', 'custom:*']` as a second lock;
  - **no MCP:** `mcpServers: {}`, and `disabledMcpServers` naming every server the runtime would load by itself (the servers of `~/.copilot/mcp-config.json` and the built-in GitHub one; main reads the names, never the values);
  - **nothing else loaded:** `enableConfigDiscovery: false`, `enableSkills: false`, `customAgents: []`, `skipCustomInstructions: true`, `enableOnDemandInstructionDiscovery: false`, `enableFileHooks: false`, `enableHostGitOperations: false`, and an empty temporary folder as the working directory;
  - **nothing kept:** the SDK has no ephemeral session, so `infiniteSessions: { enabled: false }`, `memory: { enabled: false }`, `enableSessionStore: false`, `embeddingCacheStorage: 'in-memory'`, `remoteSession: 'off'`, no `name`; in a `finally` the session is disconnected and `client.deleteSession` removes it from disk (an error there is ignored), and the temp folder is removed;
  - **every permission request is denied** (`reject`); no question handler;
  - the model is `auto` with the `efficiency` routing, the same as a new `auto` session;
  - **a 3-minute limit** (as Claude and Codex): the turn is aborted, then the session disposed.

  The reply is the last top-level `assistant.message` (not a helper's) once `session.idle` arrives; a `session.error` ends it with its type only. The AI credits are the sum of `assistant.usage` `copilotUsage.totalNanoAiu`, returned as `nanoAiu`; `theme:generate` adds them up over the passes and the dialog shows "Used N AI credits (as reported by Copilot)". `GenerateTextResult` (`text`, `costUsd?`, `nanoAiu?`) is the shared result type. The simulator offers Copilot with a canned credit figure.
- `test:` `test:copilotoneshot` on the fake SDK: the config (tools, MCP, skills, agents, persistence off), denied permissions, the reply taken from the events (helper and tool-call messages ignored), usage summed, and disconnect, deletion and temp-folder removal on success, an empty answer, a session error, a failed send, a timeout (aborted first), a session that was never on disk, and a failed create.
- `[KNOWN GAP]` (superseded 2026-10-20, see below) Not run on a real account. Unverified: that `availableTools: []` really leaves the model with no tool, that `deleteSession` leaves nothing in `~/.copilot/session-state`, the real credit cost, and whether `excludedTools` patterns are accepted together with an empty `availableTools`. `real:` open (T027): needs the owner's go-ahead: 1 prompt on a free plan. The screenshots still show the dialog without Copilot (T028).

### 2026-10-20: real check of the Copilot theme maker (T027, issue #301)

- `real:` 2026-10-20, Copilot runtime 1.0.98, free plan, `auto`; the real `CopilotAdapter.generateText` with `buildThemePrompt("calm forest library")` and the built-in GitHub MCP server switched off by name, as `theme:generate` sends it (`scripts/themegen-copilot-real.ts`). **2 prompts, 0.26 + 0.24 = 0.50 AI credits**, about 30 s each:
  - text came back (about 8,000 characters of theme JSON);
  - **no tool ran**: the session's events had no `tool.*` and no permission request (`availableTools: []` with `excludedTools` was accepted);
  - **nothing kept**: `~/.copilot/session-state` had the same names before and after (compared by name only);
  - credits were reported through `assistant.usage`, so the dialog's "Used N AI credits" works.
- **Bug found:** Copilot wrote every token name without the leading `--` (`"bg"`, not `"--bg"`), so all 147 colours were dropped and the reply failed with "too few usable colours" on both runs.
- **FR-022** (fix) `[IMPLEMENTED]` A token name without `--` whose `--` form is a Clean Office token is read as that token; any other unknown name is still dropped. With the fix, the saved real reply parses to a full theme: 147 colours, 15 art slots, no issues. `test:` `test:themegen` (bare names give the same tokens as prefixed ones; an unknown bare name is dropped with the warning).
- The Copilot capability comment and the README no longer say "fake SDK only". The screenshots of the dialog with Copilot (T028) are unchanged.
