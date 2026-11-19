# Implementation Plan: Chat list filter and Search conversations with a chat open (spec 113)

**Branch**: `113-chat-list-filter` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md) | **Issue**: #1870

## Summary

Decisions: Q1..Q8 decided by the owner (Paco, terminal, 2026-11-19), every recommended option (spec *Clarifications*).

One pure module (`src/renderer/railfilter.js`, `window.DurbarRailFilter`) folds and matches each rail row's text (name, folder, app, chat number) with `DurbarSessionSearch`. `app.js` adds the field to `railHTML()`, filters inside `renderStrip()` before `morphHTML`, keeps the words across the `openPanel` rebuild, adds the Escape / ArrowDown / Enter keys, the count and no-match line, and a last "Search messages for …" row that hands the words to spec 095's own `csRun`. Spec 095's shortcut, while a chat is open, focuses the rail field instead of closing the chat; a search started from the rail returns to that chat. Renderer only: no IPC, no main, no saved state, no new dependency.

## Technical context

- Plain JS renderer; `app.js` is one IIFE (agent-notes: drivers read `window.__durbarSimUi` and the DOM). Rail code `app.js:8057-8131`, CSS `styles.css:855-901`.
- Pure modules use the UMD pattern of `railorder.js` / `sessionsearch.js`, tested from `scripts/*.ts`; a new renderer script needs its `scripts/copy-assets.js` line and `<script>` tag after `sessionsearch.js` and `railorder.js` (agent-notes).
- Electron 44 (Chromium 142): `CSS.highlights` available (`read:` Chromium docs; not yet tried in the app, spec 112 FR-007 not built).
- Zero AI credits: `DURBAR_SIM=15` and Node tests only.

## Constitution check

| Principle | How this plan holds it |
|---|---|
| I Spec Kit | Spec, plan, tasks first; pointer deltas to 005 (FR-190 rows, FR-195 limit) and 095 (FR-002/FR-003) in the build PRs; no 074 delta (Q5 a); Q1..Q8 decided 2026-11-19. |
| II Adapters | Renderer only; `appOf` gives an app word already normalized (`kindWord`); no vendor type. |
| III Safe, no secrets | Nothing saved or sent beyond what `#convSearch` already sends (095 FR-033 checks in main unchanged). The query is shown back only masked (`safeMask`), cut to 60, as text. No shell, no new IPC. |
| IV No credits | Unit test and simulator driver only. |
| V Calm UI | ≥ 10.5 px; both sizes, five worlds; no motion; count via the one live region; the rail's scroll budget measured first and the limit amended in 005 (Q3 a), not silently broken. |
| VI Parity | No paths; key labels from `keys.js`; the shortcut is `SEARCH_KEY` (already per-OS). |
| VII Gates | typecheck, build, test; screenshots at both sizes; driver + unit test with mutants. |
| VIII Honest limits | Screen readers, a real Mac and the packaged highlight stay `[KNOWN GAP]`. |

## Existing capability check (spec 021 FR-031)

Line numbers below are at `e35ebf76a` (2026-11-18); each build phase re-checks them by the function or selector name in the middle column.

| Need | Reused | Where |
|---|---|---|
| Fold, words, ranges | `DurbarSessionSearch.fold`, `terms`, `locate` | `src/renderer/sessionsearch.js:8-10`, `:36-41` |
| Rail rows, groups, order, folds, focus kept by key | `railGroups`, `DurbarRail.group`, `renderStrip`, `RAIL_FOLDS` | `app.js:8078`, `railorder.js`, `app.js:8112`, `:8065-8076` |
| App word, chat number, folder name | `appOf`, `chatNoOf`, `roomOf(a).name` | `app.js:2256`, `:53` |
| Field look | `.nt-find` | `styles.css:2189-2190` |
| Escape clears first; focus and selection kept across a repaint | `#prevQ` pattern | `app.js:4642`, `:9993`, `:10004` |
| No-match line, masked and cut | `noMatch(query, mask)` rule; own copy in `railfilter.js` with an equality test (`notes.js` unchanged) | `notes.js:139-144` |
| Mask | `safeMask` (DurbarSafeText) | `app.js:447` |
| Announce | `announce()` | `app.js:4852` |
| Conversation search: run, results, min length, availability | `csRun`, `csEnd`, `CS.panel`, `DurbarConvSearch.longEnough`, `csAvailable` | `app.js:2311`, `:2412`, `:2446-2466`, `convsearch.js:18`, `app.js:2300` |
| Shortcut and recorder | `SEARCH_KEY`, `searchKeyBound`, the keydown branch | `app.js:36-37`, `:4586-4589` |
| Highlight | spec 112 FR-007's `durbar-find` rule (shared CSS; added here if 112 is not built first) | `specs/112-settings-search/spec.md` FR-007 |
| Driver base | `check-rail.js` (worlds, sizes, darwin drag areas, `until`) | `scripts/check-rail.js` |

Not reused, with reasons: `DurbarNav.rank` (ranking would reorder the rail; FR-194's order stays); `filterSessions` (works on `{title}` only; the rail needs four fields joined); the List view's `matchStatus` (status words are not matched, Q4 a; the List view is not changed, Q8 a).

## Module layout

- `src/renderer/railfilter.js` (new, pure): `rowText({name, folder, app, no})` (joined with spaces, folded, cap 2 000 chars), `match(rows, query)` → `Set` of ids; `countText(n)`; `noMatch(query, mask)`; `searchRowText(query, mask)`.
- `src/renderer/app.js`:
  - `railHTML()`: the field row, a `.rail-find` row after `.rail-door` (Q3 a).
  - module state `RF = {q:'', had:false, sel:null, back:null}`.
  - `railGroups()` or `renderStrip()`: when `RF.q` is set, keep only matching ids per group (before `morphHTML`), "k of n" counts, show collapsed folders' matches without touching `RAIL_FOLDS`, the open chat's row always kept and marked "open, does not match" (Q7 a), the no-match line and the search row.
  - `openPanel` (`:3090` rebuild): write `RF.q` back into the new field; restore focus and selection only if `RF.had`.
  - `closePanel` (`:4287`): clear `RF` (Q6 a).
  - keydown: Escape branch for `#railFind` beside `#prevQ` (`:4642`); ArrowDown / Enter on the field in its own listener.
  - `csFocusBox` / the shortcut branch (`:4586`): with `body.panel-open`, focus `#railFind` instead (Q5 a); the navigator branch (`:4581`) is not touched.
  - `railSearchMessages()`: set `#convSearch` value, set `CS.panel=ui.selected` and a new `CS.fromRail=true` so `csRun` does not drop it (`:2313`), close the chat, `csRun(v)`; `csEnd` and the box's Escape reopen `CS.panel` when `CS.fromRail` (FR-022).
- `src/renderer/styles.css`: `.rail-find` row, `::highlight(durbar-find)` (if spec 112 has not added it). No Mac `no-drag` rule: the row is inside `.rail`, outside the `.rail-top` drag area; the driver checks it.

## Data flow

input → 150 ms → `RF.q` → `renderStrip()` (filter rows, paint, highlight) → announce if count changed. Search row → `railSearchMessages()` → 095 `csRun` → List results → Escape → `csEnd` → `openPanel(CS.panel)`.

## Phases (one small PR each)

- **P1** pure module and unit test (T003-T006). No UI change.
- **P2** measure first (T007), then field, filter, count, no match, Escape/ArrowDown/Enter, lifetime (T008-T015); spec 005 pointer delta.
- **P3** Search conversations from a chat: search row, return to chat, shortcut (T016-T020); spec 095 pointer delta.
- **P4** highlight (T021-T022).
- **P5** driver completion, mutants, screenshots, docs, converge (T023-T030).
- **P6 Recent order** (FR-040..FR-044, owner request 2026-11-19): `DurbarRail.recent` (pure, beside `group`), a `youAt` stamp on your own sends kept like the chat numbers (`CHATNO_KEY`, only with `rememberOn()`), a Folders | Recent control in the filter row, and a flat list in `renderStrip` with the folder per row. After P2 (the filter row exists); independent of P3..P5.

## Test plan (zero AI credits)

- `test:railfilter`: fields, fold, AND, blank, cap, linear time (CPU, two sizes), `noMatch` equal to `notes.js` on one corpus; mutants AND→OR, fold removed, folder ignored.
- `check-rail-filter` (ui-suite): flat, retro, real photo, cave, loft x 1440x900 and 1280x800, plus rail at 180 px and 640x480, plus `data-platform="darwin"`; every FR's acceptance; mutants of spec FR-032.
- `check-rail` with the new limit (T007's measure, Q3 a); `shots-095` unchanged for office starts.
- Screenshots `docs/screenshots/113-rail-filter-{1440x900,1280x800}.png` via `scripts/shots-docs.js`.

## Risks

- **Rebuild on chat switch** (`openPanel` replaces `#panel`): words and focus lost unless restored; driver step + mutant.
- **Escape order**: the field's Escape must stop before `if(ui.selected){closePanel()}` (`:4656`); mutant.
- **Folds written by the filter**: a filter that calls `toggleFold`/`saveFolds` would lose the person's state; read `durbar.railFolds` before/after.
- **095 coupling**: `csRun` drops `CS.panel` once a scan starts (`:2313`); the rail path needs its own flag, and `shots-095` must stay green for office starts.
- **Fit**: +~32 px of rail (unverified until T007); `check-rail`'s 34 px limit is raised to the measured value in the same PR, with the spec 005 delta (Q3 a).
- **Announce storms**: `renderStrip` runs on every render; announce only on settle and on count change.
- **Highlight with morphHTML**: ranges point at text nodes the morph may replace; recompute after each paint.
