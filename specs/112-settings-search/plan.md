# Implementation Plan: Search in Settings (spec 112)

**Branch**: `112-settings-search` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md) | **Issue**: #1471

## Summary

Decisions: Q1..Q10 decided by the owner (Paco, terminal, 2026-11-10), every recommended option (spec *Clarifications*).

One pure module (`src/renderer/settingsfind.js`) folds and matches the text of the rendered Settings sections; `screens.js` adds the field above the section list, hides the sections that do not match, opens the `<details>` that hold a match, marks the words with a CSS Custom Highlight and announces the count. The section list (spec 052 FR-226) is reused as the result list: it only learns to leave out hidden sections. Renderer only: no IPC, no main, no saved state, no new dependency.

## Technical context

- Plain JS renderer (`src/renderer/screens.js`, one IIFE; `paintSettings` `:309` rebuilds the page with `innerHTML`), CSS in `screens.css`, Electron 44 (Chromium 142: `CSS.highlights` and `::highlight()` available, `read:` Chromium docs, not tried in the app).
- Pure modules follow the UMD pattern of `settingsnav.js` / `sessionsearch.js` (window global in the page, `module.exports` in Node, tested from `scripts/*.ts`).
- A new renderer script needs its line in `scripts/copy-assets.js` and its `<script>` tag in `index.html` (agent-notes: "A new renderer script needs a line...").
- Tests: zero AI credits, the simulator (`DURBAR_SIM=15`) and Node unit tests.

## Constitution check

| Principle | How this plan holds it |
|---|---|
| I Spec Kit | This spec, plan and tasks first; pointer deltas to 052 (FR-226) and 074 (FR-002) in the build PR. |
| II Adapters | Renderer only; no adapter or vendor type touched. |
| III Safe, no secrets | Nothing saved or sent; the query is shown back only through the window's masker, cut to 60 characters (FR-009); no shell, no IPC. |
| IV No credits | Unit test and simulator driver only. |
| V Calm UI | Text >= 10.5px; both sizes, every world; no motion; the mark is not colour alone (underline); live region for the count. |
| VI Parity | No OS paths; the shortcut label comes from `keys.js` (`keyLabels`), the Mac branch by `IS_MAC` (in `app.js`, so the key step is in `app.js`'s handler, not `screens.js`). |
| VII Gates | typecheck, build, test; screenshots at both sizes; driver and unit test listed. |
| VIII Honest limits | Screen readers, a real Mac and the packaged highlight are `[KNOWN GAP]` until checked. |

## Existing capability check (spec 021 FR-031)

| Need | Reused | Where |
|---|---|---|
| Fold case and accents, split words | `DurbarSessionSearch.fold`, `terms` | `src/renderer/sessionsearch.js:8-10` |
| Match ranges in the original text (highlight) | `DurbarSessionSearch.locate` (spec 095 FR-040, built on `foldMap`) | `sessionsearch.js:16-40` |
| Result list, jump, `aria-current`, keys, narrow row | Settings section list | `screens.js:772-826`, `settingsnav.js` |
| Scroll inside `.scr-body`, focus without scrolling ancestors | `DurbarScroll.reveal`, `focusIn` | `innerscroll.js`, `screens.js:5` |
| Field look | `.nt-find` rules | `styles.css:2170-2171`, `screens.css:506` |
| No-match line with masking and cut | the `noMatch(query, mask)` pattern | `notes.js:139-144`; `settingsfind.js` has its own `noMatch` with the same rule (mask first, cut to 60, plain line when the masker throws), and `test:settingsfind` runs both on one corpus and asserts the same masked, cut words (the copy rule of `docs/agent-notes.md`); `notes.js` is not changed |
| Escape clears first | the `#prevQ` / `#nsSearch` branch | `app.js:4221-4222` |
| Count announcement | `X.announce` | `app.js:4428`, `:9793` |
| Navigator key and clash table | `NAV.comboMatches`, `TAKEN` (not extended) | `navigator.js:130-160`, `app.js:4158` (the bubbling `document` keydown listener), branch `:4165` |
| Which screen is open | `DurbarScreens.isOpen()` (`screens.js:41`, `!!cur`) is true for every screen, so it cannot tell Settings from Notes, MCP extras or Tools; `isSettings()` is the one small addition: `cur&&cur.kind==='settings'`, needed because the keydown handler lives in `app.js`, outside the screens IIFE, and the focus can be outside `#screen` (body, a top-bar button) | `screens.js:41`, `:1938` |
| Open state of a `<details>` | the two existing toggle handlers, `$('advMcp').ontoggle` (`screens.js:513`) and `onLiveToggle` (`:128`), each gain the search's write-record check (FR-005); no new handler | `screens.js:128`, `:513` |

Not reused, with the reason: `DurbarNav.rank` ranks labels; Settings keeps page order and matches all words over long text, so `fold` + substring AND is enough. Ctrl+K palette entries (Q2 c) were not chosen (owner, 2026-11-10: Q2 a).

## Module layout

- `src/renderer/settingsfind.js` (new, pure, `window.DurbarSettingsFind`):
  - `textOf(parts)` joins a section's parts (visible text, closed `<details>` text, `aria-label`s, `data-find`) into one folded string (cap 200 000 characters per section).
  - `match(entries, query)` -> `{ terms, shown: [index...] }`; blank query shows all.
  - no own range code: the highlight takes its ranges from `DurbarSessionSearch.locate(textNode.data, query)` per text node of a shown section.
  - `countText(n)` and `noMatch(query, mask)`.
- `src/renderer/screens.js`:
  - `paintSettings`: the field inside a new side column wrapper before `<nav id="scrNav">` (`:474`); sections gain `data-find="..."` keywords in their own templates (Q1 d).
  - `wireSettingsFind()` after `wireSettingsNav()` (`:508`): input handler (150 ms settle), `apply()` (hide, open details, highlight, announce), Escape / Enter / ArrowDown on the field, a subtree `MutationObserver` on `.scr-body` (debounced; ignores its own `hidden` and `open` writes) for FR-010.
  - `wireSettingsNav`'s `paintNav` (`:778`) skips headings whose section is `hidden` (FR-006); `paintNav` is exposed inside the module so `apply()` can call it.
  - Module state: `findQ` (FR-011), `findOpened` (the `<details>` the search opened, FR-005), `findScroll` (the scroll before the search).
- `src/renderer/app.js`: the find key in the global keydown before the navigator branch (`:4165`): only when `DurbarScreens.isSettings()` (new tiny accessor) and no modal, `!navRecording` and the focus is not in the field; Escape branch for the field id beside `#prevQ` (`:4221`).
- `src/renderer/screens.css`: the side column (field + list), the narrow layout (field above the row, inside the existing `@container scrset (max-width:759px)`, `:532`), `::highlight(durbar-find)`. Tokens only, inside the `test:theme-tokens` ratchet (052 delta 2026-11-08).

## Data flow

keydown/input in the field -> 150 ms -> `findQ` -> for each section `textOf` (read once per paint, refreshed by the observer) -> `match` -> set `hidden` on sections, open details, `paintNav()`, `CSS.highlights.set('durbar-find', ...)`, announce if the count changed. Clearing reverses each step and restores `findScroll`.

## Phases (one small PR each)

- **P1** pure module and its unit test (T003-T006; T005 wires `locate`).
- **P2** field, filter, list following, Escape, Enter, ArrowDown, count, no-match, lifetime (T007-T015).
- **P3** highlight, collapsed parts, live parts, keywords (T016-T020).
- **P4** find key and spec 074 delta (T021-T022).
- **P5** driver, screenshots, docs, converge (T023-T030).

## Test plan (zero AI credits)

- `test:settingsfind`: fold, AND, keywords, blank, `locate` ranges over accents for the highlight, noMatch masking and cut (and equal to `notes.js` on one corpus), linear time (CPU time, two sizes 8x apart, `docs/agent-notes.md`).
- `test:settingsnav`: a hidden section's heading is left out.
- `check-settings-find` (ui-suite): five worlds (flat, retro, real photo, cave, loft as `check-settings-nav` sets them) x 1440x900 and 1280x800, plus 640 wide; mutants listed in FR-013. Steps added by the review rounds: contrast pairs (FR-007), clear announcement (FR-009), hostile markup (FR-009), scroll on late part and repaint (FR-004), focus after a World pick (FR-011), Advanced opened by search leaves `advOpen` and the live list alone (FR-005), the find key per platform, with a recorded navigator combo and while recording (FR-008), ArrowDown with one match (FR-008).
- `check-settings-nav` unchanged and green (SC-004).
- Screenshots `docs/screenshots/112-settings-find-{1440x900,1280x800}.png` through a `DOC_SHOTS` entry in `scripts/shots-docs.js`.

## Complexity tracking

None.

## Risks

- **Repaint storms**: `paintSettings` replaces the page; the field must be rebuilt with its value and focus (FR-011). Driver covers a World pick repaint.
- **Observer loops**: `apply()` writes `hidden` and `open`; the observer must ignore attribute writes and react only to `childList`/`characterData`, debounced.
- **Key clash**: the find key sits before the navigator branch; mutant "always navigator" and "always find" both fail the driver.
- **Ratchet**: new CSS must reuse tokens and existing class sets (052 delta 2026-11-08 shows the failure mode).
- **Highlight API absence** in some test context: feature-detect, search still works.
- **Search writes counted as the person's**: `toggle` cannot tell a program write from a click; the search records the state it wrote per `<details>` and both handlers skip a toggle that equals it (FR-005); a driver case proves `advOpen` and the live list are untouched. A search-opened Advanced may show a stale live list (no reload from typing).
- **Focus theft on repaint**: the field takes focus back only if it held it (FR-011); the World radio and the place Edit button keep theirs.
- **Scroll on repaint or late part**: only the person's typing scrolls to the top (FR-004).
- **Escaping**: the no-match line is text, never markup (FR-009); a hostile-markup case in the driver.
- **Navigator key recording**: the find branch sits behind `!navRecording` in the bubbling handler (FR-008).
