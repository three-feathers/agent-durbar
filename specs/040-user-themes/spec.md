# Feature Specification: User themes — personal packs with import/export (spec 040)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 035-040
title: User themes: `userData/themes/<id>/manifest.json`, import/export, validation
status: built
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

### 2026-10-30: AI theme maker quality, stage 1 (issue #903, FR-024..FR-030)

**Audit evidence.** The owner was not satisfied with the AI theme maker. An audit made 7 real themes with Claude Code (haiku, $0.06 in all) and screenshotted each in the simulator at both sizes: scores 3 to 5 out of 10, against 7 to 8 for the built-in courts. Findings: the themes read as Clean Office recoloured plus a hat per person (empty rooms, no wall, window or floor); in the corporate and court UI styles the lobby icons were invisible (1.2:1) and the primary buttons washed out, because `--brand-bg` fills them and the model was never told; the art was tiny and sparse (900 to 3,000 characters); the lobby art covered the "+" add-place button; folder paths and costs were dim (2.5 to 3.0:1) in dark themes; the result did not match the prompt (no wood, no synthwave sun); place names were cut. Stage 2 (a palette derived in code from seed colours, curated art blocks, a render-and-critique pass, a best-quality model option) is a follow-up issue.

- **FR-024** (R1) `[IMPLEMENTED]` `generateText` on Claude no longer reuses the 8,000-character hand-off cap (`HANDOFF_MAX_CHARS`, which cut a theme's JSON mid-art). One-shot data has its own bound, `ONE_SHOT_MAX_CHARS` = 128,000: the reply holds up to 19 art slots of 4,000 characters (76,000) plus about 150 colours, fonts and words (under 10,000), so 128,000 leaves margin and is still a hard bound. `cleanSummary` and `parseHandoffOutput` take the limit as an argument; the hand-off summary keeps 8,000. Codex and Copilot `generateText` never used the cap (checked: they return the model's text as is). The cleanup does no redaction or masking (it trims, unwraps a fence and cuts), so nothing was weakened. `test:` `test:claudeadapter` (a 30,000 and a 100,000-character reply survive intact; the summary still cuts at 8,000).
- **FR-025** (R2) `[IMPLEMENTED]` `GEN_ART` offers the scenery slots the renderer already draws: `room-back-wall`, `room-back-window`, `room-floor` (viewBox 0 0 320 118, stretched to the room; the floor into the bottom 38%) and `desk-back` (office scene coordinates, drawn over the desk and under the monitor), each with its geometry and what it is, drawn from how the built-in packs use them. They pass the renderer's sanitizer like every slot. `test:` `test:themegen`.
- **FR-026** (R3) `[IMPLEMENTED]` The prompt lists the colour tokens in groups (surfaces, text, room tints, brand, button inks, lines and focus, status, drawing colours), each with a short meaning taken from `styles.css` and `themes.css`: what it paints and what it must contrast with. It says that `--brand-bg` fills the lobby tile icons and the primary buttons in every UI style but "clean" (and the top bar of the Indian and European courts), and that the room path sits on the room tints. Every token is still listed once as `--name=value`. The prompt stays under 16,000 characters (about 14,100). `test:` `test:themegen`.
- **FR-027** (R5) `[IMPLEMENTED]` More checks, reported by `themeIssues` so the existing fix pass corrects them: `--room-path`, `--muted` and `--ink` against each room tint `--tint-sage|blue|sand|clay` at 4.5:1 (in `CONTRAST_PAIRS`, and the same list in `theme.js`, so a pack imported by hand is also repaired at run time; Clean Office meets them); and, only in the UI styles that paint with `--brand-bg` (`UI_PAIRS`, every style but "clean", whose pale `--brand-bg` is by design): `--brand-bg` against `--raised` and against `--bg` at 3:1 (non-text, WCAG 1.4.11: the lobby icon sits on a mix of the two) and the primary button text `--brand-mark` on `--brand-bg` at 4.5:1 (was 3:1 for all). A dark theme that left the light default tints now also reports the text on them. Run-time repair (2026-10-31, #905): a failing text-on-tint pair moves the text token only when the result keeps every non-tint pair that token is part of (so a dark theme's light `--ink` is never darkened to fit a light tint, which broke the status tooltip at 2.99:1); otherwise the tint is repaired (it paints only the rooms), and the text token only when no tint can reach the ratio. `test:` `test:themegen`, `test:theme-tokens`.
- **FR-028** (R7) `[IMPLEMENTED]` The prompt carries an art style guide (`ART_STYLE`): nothing thinner than about 3 px at rendered size (stroke-width at least 2 in scene art, 1.5 in icons), fill the slot's main area, one consistent palette reusing the theme's colours, scenery that evokes the prompt (wood, sun, shelves), no text. `artWarnings` warns (shown in the preview, not blocking, because the fix pass does not send art back) when a slot is too sparse (fewer than 4 shapes for a wall or floor, 5 for the lobby band, 3 for a window, 2 for `desk-back`, the robe and the headwear), has only lines thinner than 1.5 (1 for icons), or has only shapes smaller than 3 units. `test:` `test:themegen`.
- **FR-029** (R11) `[IMPLEMENTED]` A generated place name is at most 14 characters (what a lobby tile shows), in the prompt and in the parser, which keeps whole words that fit (else cuts at 14) and warns; other words keep 40. `test:` `test:themegen`.
- **FR-030** (R8) `[IMPLEMENTED]` The lobby art band no longer paints over the "+" add-place button (`.lobby .place-add` is positioned above the band like the tiles), and for a user theme the band is scaled with `preserveAspectRatio="xMidYMid slice"` instead of `none`, so circles stay round (it covers the lobby and is cropped to its middle: the prompt says to keep the motif in y 8-28 and the band faint). Built-in packs keep `none`: their bands were drawn to be stretched. The choice asks "is it built in?" directly (`THEME.lobbyArtAspect(id)` over `THEME.isBuiltIn(id)`), never "is it missing from `list()`" (which will hold user themes in stage E); `test:` `test:theme`. `test:` `check:theme-art` (tiles and button above the band, equal x and y scale, both sizes), `check:office` (the Add button is above the band).
- `[KNOWN GAP]` No real-harness before/after run yet: the same 7 prompts must be re-run by the owner's agent and the screenshots compared. The prompt and checks are verified by unit tests and the simulator only.

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> **built** (`test:userthemes`); delta 2026-10-19: make a theme with AI, light or dark with art, several passes, ideas (FR-014..FR-021, issue #182), and Export fixed (FR-019) built; delta 2026-10-20: the AI theme maker on Copilot (FR-015, T026, #301) built on a fake SDK; real check done 2026-10-20 (T027: 2 prompts, 0.50 AI credits; bare token names fixed, FR-022); delta 2026-10-21: a picked theme redraws desks, walkers and helper tiles, headwear over the hair, art on every scene kit (FR-023, `check:theme-art`) built


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

### 2026-10-21: a picked theme redraws the characters and gadgets everywhere (owner report)

*Owner (Telegram, 2026-10-21):* "When I create a new theme with AI, I don't see new characters or gadgets changing when the theme is created." "Once I created a Barbie theme, it created characters but they were only visible in the top bar of agents, not in the office layout."

Root causes (`read:` code, `sim:` reproduced with `scripts/fixtures/themes/pink-studio.json` before the fix: after picking it in Settings, 0 of 20 desk scenes and 0 of 5 walkers had the pack's art, while the chat strip's chips had it):

1. **Desks kept the old drawing.** The office patches the DOM by key; a desk scene is replaced only when its `data-sig` changes (`morphNode`, `app.js`). The office kit's signature named the status, look, size and mood but **not the theme**, so switching from Clean Office to a pack on the office kit (every AI theme that keeps `scene: "office"`) left every desk with Clean Office's SVG: old colours (the scene's `fill` values are resolved at draw time), no character art, no desk or monitor art, until that agent's status changed. The chips in the chat strip and the lobby place icons are not signature-guarded, so they did change: the "only in the top bar" of the report. The scene cache key had the theme id; the signature did not. `shots-themes.js` hid this by clearing `#stage` before its shot.
2. **Walkers kept the old figure.** A figure walking to or resting at a place was built once (`syncWalkers`) and never redrawn on a theme switch.
3. **The headwear was under the head.** `char-headwear` was drawn with the body layers, before the head circle and the hair, so a hat or headband (the prompt places it at y 24-36, over the head at cy 44 r 12.5) was mostly hidden.
4. **Art was dropped on every other scene kit.** The prompt told the model that "only office shows your character art", and the five other kits ignored `char-*`, `hair-acc`, `desk-*` and `monitor-art`: a generated theme that picked a court or pixel kit lost all of its characters and gadgets.
5. **A regenerated theme with the same id was not applied.** `setTheme` returned early when the id was already active, so a second preview of a pack with the same id (Try again) showed the first one.

- **FR-023** (fix) `[IMPLEMENTED]` Every applied theme gets a new cache key (`THEME.themeIdForCache()` = id and a revision that grows on every applied theme). It is part of every desk scene's signature (office kit and the other kits, after the size part, so `done|` and the mood at the end keep their places), of the scene cache key and of each walker, so a theme switch redraws every desk, helper tile and walking figure; reapplying the very same pack changes nothing. A manifest with the active id but other content is applied. Character art is drawn in two layers: body, robe and collar under the head; headwear (and `hair-acc`) over the hair, inside the head group so it moves with the head. The character, desk and monitor art is drawn over every scene kit (scene and walking figure) at the same places as on the office kit; built-in packs have none, so they draw exactly as before. The AI prompt no longer says that only the office kit shows the art.
  - `test:` `test:theme` (a switch changes the key, the same pack again does not, same id with other content applies its tokens and art), `test:scenekits` (every kit draws the four overlays, headwear inside the head after the hair, monitor art over the screen, the key in the signature, the walking figure wears the art; no art without a theme that has some).
  - `sim:` `npm run check:theme-art` (`scripts/check-theme-art.js`, in `check:ui`): the sample AI-style pack *Pink Studio* (`scripts/fixtures/themes/pink-studio.json`; a pink fashion studio, no trademarked names or art) is picked in Settings from Clean Office, at 1440x900 and 1280x800. Every desk and helper scene draws its robe, collar, headwear, desk art and monitor art; every main desk where the agent sits shows the pack's pinks on screen (pixels) and every awake one its chair colour; every walker wears the robe and headwear with pink on screen; the lobby draws its place icons and lobby art; every chip in the chat strip wears the robe; and back in Clean Office no desk or walker keeps any of it. Undoing the signature change or the walker refresh makes it fail (mutation-checked).
  - Not covered here: full tokenization of every visual property (fonts, radii, shadows, figure palettes, gadget shapes): spec 070.
  - Review of PR #496 (Ruben's agent, 2026-10-22): three mutations survived and are now caught. `test:scenekits` asserts that the headwear closes the head group (after the head, the hair, the face and any head top) on every kit, scene and walking figure; `check:theme-art` asserts on the office kit that each desk, walker and chip draws `char-headwear` after the head circle and the hair, and adds a pass at 1440x900 with the same pack on `scene: "court-indian"` (desks and walkers draw the robe, headwear, desk art and monitor art). Mutation-checked: kit headwear before the head (`test:scenekits` fails), office headwear before the head circle (`check:theme-art` fails), `app.js` passing no `art` to the kits (`check:theme-art` fails). The driver's default screenshot folder is `path.join(os.tmpdir(), 'theme-art-shots')` (Windows parity).
  - `[KNOWN GAP]` (2026-10-22) The art is shaped for the office figure and desk. On the other kits it is drawn at the same coordinates, so on corporate (glass desk) the robe shows through the desk and on court-japanese (low table) it shows under the table top. It reads fine; kit-shaped art would need per-kit slots (spec 070).

### 2026-10-31: the flat AI theme maker is retired (owner decision, spec 021 FR-067; planned, not built)

- **FR-031** **What goes, and when.** Frozen now: no new work on it. Removed in the same PR as spec 102's in-app world maker (102 FR-150, P6), so AI creation is never absent; a release never has neither. Goes: Settings' **Make a theme with AI…** (`thAi`), `aiTheme()`, `theme:generate`, `theme:ideas`, `generateTheme`, `themeIdeas`, `THEME_IDEAS`, `buildFixPrompt`, `buildRetryPrompt`, `parseGeneratedTheme`, `GEN_ART`, `ART_STYLE`, `MAX_PASSES`, `TOP_BAR_ISSUE`, `scripts/shots-040-aitheme.js`, `040-aitheme-*` screenshots, and FR-014..FR-021, FR-024..FR-029 become historical. `theme:import` goes too ("no new ones"), and 076's `allowThemeMaker`, `features.themeMaker` and `allowUserThemes` Import part become no-ops. **Stay**: `oneShot`, `generateText` (other specs use them), `oneShotCostLine`, `pickIdeas`, `themeIssues`, `CONTRAST_PAIRS`, `contrastFix`, `checkUserManifest`, `pickFolder`, `UserThemeStore`, and what 096 factors out of `aiTheme()`.
- **FR-032** **Saved themes keep working until the user removes them, and no new ones** (recommended, and the spec's wording until the owner says otherwise). They stay in the Theme list, tagged "yours"; **Export** stays. **Remove** must be added: today there is no way in the app to delete a saved theme (`git grep` found no remove channel), so `theme:remove` comes with a confirm; removing the theme in use goes to Clean Office, and its folder is deleted without following links. Theme generation stops; nothing is deleted by the update.
- **FR-033** **Status.** Spec 040 stays `built` while saved themes work, with a note that the maker is retired. When no theme path remains, it is `deprecated` by its own delta.
