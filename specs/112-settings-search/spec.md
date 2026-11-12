# Feature Specification: Search in Settings

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Search in Settings (issue #1471, owner 2026-11-10): a search field filters the Settings page and its section list to the sections that hold the words, marks them, Cmd/Ctrl+F and Escape
status: draft
note: spec, plan, tasks; Q1..Q10 decided by the owner (Paco, 2026-11-10); nothing built
-->

**Feature Branch**: `112-settings-search` (spec, plan and tasks); code branches `112-pN-slug`, one per phase

**Created**: 2026-11-10

**Status**: Draft. Nothing built. Q1..Q10 (*Clarifications*) are decided by the owner (Paco, terminal, 2026-11-10): every recommended option was accepted.

**Issue**: #1471 (fjcabello, owner request, 2026-11-10). Refs, not Closes, until the last phase.

**Input**: "Settings has grown long (many sections, a section list on the left since v0.1.13). Paco (owner) asks for a **search field in Settings**, like the one in macOS System Settings: type a word ("sandbox", "theme", "Telegram", "limit") and get straight to the setting." The issue leaves to the spec: what is searched, how results show, keyboard (Cmd/Ctrl+F, Escape, arrows, a screen-reader count), empty and no-match states, every world, both sizes, the narrow row, and reuse of the section list.

## Why a new spec and not a delta

The section list is spec 052 FR-226 (T219; delta 2026-11-07, `src/renderer/settingsnav.js`), and Settings itself has no single owning spec: each section belongs to the spec of its feature (051 Agent apps, 043 profiles, 011 limits, 044 schedules, 033 floors, 076 organization, 024 places, 058 MCP...). Search is new behaviour (AGENTS.md: `/speckit.specify` for new behaviour), with its own matcher, keys, states and driver, so it gets its own spec. Spec 052 gets a dated pointer delta for the one change to FR-226 (the list shows only the sections a search leaves, FR-006), and spec 074 a pointer for the shortcut (FR-008), both in the build PR.

## Context: what exists today (spec 021 FR-031, reuse first)

- **The Settings screen** is one function, `paintSettings(focus)` (`src/renderer/screens.js:309`). Every section is an HTML template string built in that function or in a helper, then joined into one `r.innerHTML` (`screens.js:474`): `<nav class="scr-nav" id="scrNav">` beside `<div class="scr-body">`. Labels and help text are **static English strings inside those templates**, mixed with a few live values (versions, totals, user names of places, servers, folders, schedules). Several parts are painted **after** the main paint: Organization (`screens.js:495-504`, and the section removes itself when there is no policy, `:501`), the Agent apps account lines, quota and OS sandbox lines (`harnesses.js` `loadAccounts`, `loadQuota`, `loadSandbox`, called at `screens.js:494`, `:505`, `:506`), Floors (`#floorsSet`, painted by `app.js`), Schedules (`#schedSet`, painted by `app.js`). `paintSettings` runs again on many changes (world pick, usage reset, sign-in...), replacing the whole page (the new `.scr-body` starts at the top); state that must survive is kept in module variables (`advOpen`, `screens.js:106`). Two handlers save the open state of a `<details>`: `$('advMcp').ontoggle` (`screens.js:513`: sets `advOpen`, and when `liveStale` is set runs `repaintLive(true)`, a bridge call) and `onLiveToggle` (`:128`, wired `:512`: remembers an open `details.lv-more` in `liveMore`); a `toggle` event cannot tell a click from a program write.
- **Sections today, in page order** (`screens.js:474`; 22 headings, the count FR-226 measured). Controls are approximate, read from the code (`read:`), and depend on the build and the simulator:

  | # | Heading (h3 id) | Built at | Controls (approx.) | Help text |
  |---|---|---|---|---|
  | 1 | Agent apps (`hsH`) | `harnesses.js:104-130` | 3 app cards, each 2-5 buttons (install, update, sign in, check again), account, quota and OS sandbox lines filled later | intro + per-card notes |
  | 2 | Agent Success Profiles (custom agents) (`pfH`) | `screens.js:77-86`, `:457` | one Open per profile file, New... | intro, per-app groups (h4) |
  | 3 | Display (`detH`) | `screens.js:458`, rows `:729-761` | Spacing (2), Live activity on desks (switch), Finished agents rest in the lounge (switch), Office layout (2), World (radio, Real office with 2+ worlds only) | one note per row |
  | 4 | Keyboard (`keyH`) | `screens.js:462` | Change..., Reset | 2 notes |
  | 5 | What Durbar does not do (`notH`) | `screens.js:468` | none (5 bullets; one names the OS sandbox) | the bullets |
  | 6 | Theme (`themeH`) | `screens.js:402-410` | one card per theme, Export..., Remove... | note + `More` |
  | 7 | Characters (`chH`) | `screens.js:419` | 8 cards | note |
  | 8 | Logo (`lgH`) | `screens.js:425` | 4 cards | note |
  | 9 | Motion (`motionH`) | `screens.js:431` | 1 switch | note |
  | 10 | Highlights (`stillH`) | `screens.js:438` | 1 switch | note |
  | 11 | Spending limit (`capH`) | `screens.js:330` | number field, Save, Reset usage totals (h4 *Usage totals*) | note + `More` |
  | 12 | Agent mood (`moodH`) | `screens.js:341` | 1 switch | note |
  | 13 | Coffee break (`brkH`) | `screens.js:345` | 1 switch | note |
  | 14 | Chat links (`lnkH`) | `screens.js:349` | 1 select | note |
  | 15 | Notifications (`ntfH`) | `screens.js:353` | 1 switch | note |
  | 16 | Auto-follow work (`afH`) | `screens.js:357` | 1 switch | note |
  | 17 | Schedules (`schH`) | `screens.js:385` | the schedule list painted by `app.js` | note + `More` |
  | 18 | Floors (`flH`) | `screens.js:380` | the floor controls painted by `app.js` | note + `More` |
  | 19 | Organization (`orgH`) | `screens.js:390` | none (read-only rows, async) | note |
  | 20 | Places in the office (`plH`) | `screens.js:360-378` | Add a place, Edit/Delete per own place, one select per MCP server | note + `More`, 2 h4 |
  | 21 | Advanced: MCP servers (extra tools for agents) (`<details id="advMcp">`, closed by default) | `screens.js:475-492` | holds two h3 sections, *MCP servers* (`mcpH`: live list, switches, Remove..., warn levels, sign-in refresh, costs) and *Extras for one folder* (`extH`) | many notes, `More` |
  | 22 | About (`aboutH`) | `screens.js:442` | none | 2 lines |

  Theme and Characters leave the page with spec 102 T266 (FR-226 amendment, 2026-11-03); search must need no edit then.
- **Collapsed text**: most sections put their longer help in `<details class="scr-more"><summary>More</summary>` (for example `screens.js:332`), closed by default; the whole MCP block is a closed `<details>` (`advOpen` false unless opened for `mcp`, `screens.js:27`).
- **The section list** (spec 052 FR-226): `wireSettingsNav()` (`screens.js:772-826`) builds its entries from the rendered headings (`SN_HEADS = '.scr-body>.scr-sec>h3,.scr-body>.scr-adv>summary>h3'`, `:772`) through the pure `DurbarSettingsNav.build` / `current` / `step` (`src/renderer/settingsnav.js:11-43`), hides itself under 2 entries (`:785`), jumps with `DurbarScroll.reveal` (`:807-814`), marks `aria-current` from the scroll (`:792-805`), and rebuilds on a `childList` change of `.scr-body` (`:825`). It does **not** skip hidden sections today. Narrow windows (container under 760 px) turn it into a row above the page (`screens.css:532-537`). Tests: `test:settingsnav` (`scripts/test-settings-nav.ts`), driver `check-settings-nav` (`scripts/check-settings-nav.js`, five worlds, both sizes, 640 wide), picture `052-settings-nav-1440x900.png` (`scripts/shots-docs.js:67`).
- **Matching already in the window**: `DurbarSessionSearch.fold` and `terms` (`src/renderer/sessionsearch.js:8-10`: NFD, accents removed, lower case; words split on spaces), used by Previous sessions (spec 006 FR-023) and spec 095; `DurbarNav.rank` (`src/renderer/navigator.js:12-18`: label starts with, a word starts with, contains, keyword contains), shared by Ctrl+K and the navigator and reused by notes search (`src/renderer/notes.js:130-135`).
- **Search fields already in the window**: Previous sessions `#prevQ` (`app.js:9514`, `.prev-q` `styles.css:1017`); Notes drawer `#ntSearch` and Notes screen `#nsSearch` (`app.js:3253`, `:3435`, `.nt-find` `styles.css:2170-2171`, `screens.css:506`). The Notes screen is the closest precedent: a search on a full screen that filters the list, announces "N notes match" or "No notes match" (`app.js:3590`), shows a masked, cut no-match line (`notes.js:139-144`, `noMatch(query, mask)`), and **Escape clears the search first** before closing the screen (`app.js:4222`; same for `#prevQ`, `:4221`).
- **Announcer**: `announce(text, prio)` (`app.js:4428`) into `#srAnnounce` (`index.html:108`, `aria-live="polite"`), passed to screens as `X.announce` (`app.js:9793`).
- **Which screen is open**: `DurbarScreens.isOpen()` (`screens.js:41`) is true for every screen (Settings, Notes, MCP extras, Tools), so it cannot say "Settings"; the find key needs `cur.kind==='settings'` (FR-008, plan).
- **Escape on a screen** closes it unless a dialog is open (`app.js:4224`).
- **Cmd/Ctrl+F is taken**: it is the default shortcut of the Go-to navigator (spec 074 FR-002; `DEFAULT_COMBO` `navigator.js:130`: "the page has no find"), matched in a bubbling `document` keydown listener **from anywhere, text fields included** (`app.js:4158`, branch `:4165-4168`), and the user can record another one (Settings > Keyboard, `TAKEN` and `clashOf`, `navigator.js:156-200`). Spec 095 Q2 already had to pick another key for the same reason. ⌘, opens Settings on a Mac (`TAKEN`, `navigator.js:162`). Ctrl+K's palette has one *Settings* item (`app.js:4948`) and no item per section.
- **Missing**: any search over Settings; a way for the section list to leave out sections; any highlight of a word on a page (`CSS.highlights` is not used anywhere in `src/renderer`, `read:` grep).
- **Not a setting today**: "Telegram" (the issue's example) appears in no Settings text (`read:` grep of `src/renderer`, 2026-11-10); Claude Code channels are out of scope of spec 054. A search for it finds nothing (Q9).

## Clarifications

**Decided by the owner (Paco, terminal, 2026-11-10): every recommended option below was accepted** (Q1 d, Q2 a, Q3 a, Q4 b, Q5 b, Q6 a, Q7 a, Q8 a, Q9 a, Q10 a). The options not taken are kept here only as the record of what was weighed; the FRs carry the decided behaviour.

- **Q1 What is searched.** (a) section headings only; (b) headings and control labels; (c) b and every help text on the page, collapsed `More` text included; (d) c and a short list of extra English keywords per section, written as a `data-find` attribute on the section in its own template (never a parallel list). Spanish or other-language synonyms: not included (the UI is English only). **Decided: (d)** (owner, 2026-11-10, terminal). Why: "sandbox" only appears in help text (Agent apps sandbox line, What Durbar does not do), and "dark mode", "cost", "budget" or "shortcut" need a keyword to reach Theme, Spending limit or Keyboard.
- **Q2 How results show.** (a) macOS style filter: sections with no match are hidden, the section list shows only the sections left (it becomes the result list), the page stays one scrolling page; (b) a results drop-down under the field, one row per match, Enter jumps and highlights the control, the page is not filtered; (c) no field in Settings: Ctrl+K's palette lists "Settings: <section>" items. **Decided: (a)** (owner, 2026-11-10, terminal). It reuses the section list and its jump as is, and every matching setting stays usable in place.
- **Q3 What a match shows.** (a) the whole section that holds a match; (b) only the matching rows of a section, with its heading. **Decided: (a)** (owner, 2026-11-10, terminal). Rows have several layouts (FR-226 `[KNOWN GAP]`, one row layout not done) and many controls only make sense with their section's note; (b) would need a row model the page does not have. Advanced: MCP servers is one unit (one `.scr-adv`, one list entry): a word found in it, such as `extras`, shows the whole box, MCP servers included. Intended (review answer, Changes 2026-11-12).
- **Q4 Keyboard.** (a) no shortcut: the field is the first Tab stop of the screen; (b) Cmd/Ctrl+F (fixed, not the recorded navigator key) focuses the field while Settings is open and no dialog is; pressed again while the focus is in the field, it does what it does today (the navigator); (c) Cmd/Ctrl+F always focuses the field in Settings, and the navigator is unreachable by that key there. In all: Escape with text clears it first (a second Escape closes Settings, as today); ArrowDown in the field moves to the first entry of the section list; Enter jumps to the first matching section. **Decided: (b)** (owner, 2026-11-10, terminal). It is what the issue asks and the macOS habit, and the second press keeps spec 074 FR-002 one key away. It changes FR-002's "from anywhere" for one screen: spec 074 gets a pointer delta. `mod+KeyF` is **not** added to `TAKEN` (it would refuse the navigator's own default).
- **Q5 Highlight of the words.** (a) none; (b) the matched words are marked with the CSS Custom Highlight API (`::highlight()`, no change to the page's nodes), in a token colour with an underline so it is not colour alone; (c) b plus an edge mark on the row that holds the first match. **Decided: (b)** (owner, 2026-11-10, terminal). No node is rewritten, so wired controls keep working; `read:` Electron 44 is Chromium 142, which has the API (not tried in the app yet).
- **Q6 Collapsed parts.** (a) searched, and a `<details>` (a `More`, or Advanced: MCP servers) that holds a match is opened while the search lasts, then put back as it was when the search is cleared (unless the person toggled it meanwhile); (b) searched but left closed, its summary marked "match inside"; (c) not searched. **Decided: (a)** (owner, 2026-11-10, terminal).
- **Q7 Where the field is.** (a) at the top of the section list's column (the macOS sidebar place), always shown even when the list hides itself; in the narrow layout a full-width field above the row; (b) in the screen head beside the title. **Decided: (a)** (owner, 2026-11-10, terminal).
- **Q8 Live and user text.** (a) every text the page shows is searched, parts painted later included (accounts, sandbox lines, organization, floors, schedules, place and server names), with masking only on what the window shows back (the no-match line); (b) only the app's own words (headings, labels, help, keywords), not names or values. **Decided: (a)** (owner, 2026-11-10, terminal): "find my server github-mcp" is a real use, and nothing leaves the window.
- **Q9 No match.** (a) "No settings match "<words>"" (the words masked and cut to 60 characters as `notes.js` `noMatch` does) with a Clear search button, the section list hidden, announced; (b) a also suggests the sections whose keywords are near. **Decided: (a)** (owner, 2026-11-10, terminal). A query such as "Telegram" for which no setting exists gets this line, never an invented result.
- **Q10 How long a search lasts.** (a) kept across repaints while Settings stays open, cleared when Settings closes or opens at a section (`openSettings('mcp')` and the like); (b) kept until cleared, across closes. **Decided: (a)** (owner, 2026-11-10, terminal).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a setting by a word (Priority: P1)

Lena (a fictional user) remembers that "there was something about a sandbox" in Settings but not where.

**Independent Test**: simulator, Settings open, type in the field, read which sections stay and which list entries are shown.

**Acceptance Scenarios**:

1. **Given** Settings is open, **When** Lena types `sandbox`, **Then** only the sections whose text holds it stay (expected from the code, `read:`; the driver records the real list): Agent apps (the OS sandbox lines, `harnesses.js:495-502`, from the simulator's `sandboxHosts`, `sim.ts:3499`), What Durbar does not do (`screens.js:469`) and, when the build has `setMcpSignInRefresh`, Advanced: MCP servers (`SIGNIN_REFRESH_LINE`, `:277`, names "OS sandbox"); the section list shows only those, the word is marked where it appears, and "3 sections match" (or the real count) is announced.
2. **Given** the search `theme`, **Then** at least Theme stays, and Characters (`:416`, `:420`), and Display while Real office with a world is shown (`worldWords`, `:16`); nothing without the word. The driver records the real list.
3. **Given** the search `limit`, **Then** at least these stay: Spending limit (`:330-333`), Agent mood (`:342`), Coffee break (`:346-347`), Notifications (`:354`), Auto-follow work (`:358`), What Durbar does not do (`:470`), Advanced: MCP servers (`SIGNIN_REFRESH_LINE`, `:277`) and Agent apps ("Account limits", `harnesses.js:206`, `:257`): about 8 of the 22 sections, the driver records the exact list. The closed `More about the limit` of Spending limit is open while the search lasts. This is what Q1 (d) with Q3 (a) means for a common word: `limit` leaves about a third of the page, the whole of each section, so a person narrows with a second word (`limit spending`).
4. **Given** the search `LIMIT` or `límit`, **Then** it matches as `limit` would (case and accents folded, `DurbarSessionSearch.fold`).
5. **Given** two words `still motion`, **Then** a section stays only when it holds both (any order).

### User Story 2 - Get there and back with the keyboard (Priority: P1)

**Acceptance Scenarios**:

1. **Given** Settings is open and the focus is anywhere on it but the field, **When** Lena presses ⌘F (Ctrl+F elsewhere), **Then** the focus moves to the search field (Q4).
2. **Given** the focus is in the field, **When** she presses ⌘F again, **Then** the navigator opens as today.
3. **Given** a search with results, **When** she presses Enter, **Then** the page jumps to the first matching section and its heading gets the focus (the section list's jump). **When** she presses ArrowDown instead, **Then** the focus moves to the first entry of the section list.
4. **Given** text in the field, **When** she presses Escape, **Then** the field is cleared, every section is back, `<details>` are as before, and Settings stays open. **When** she presses Escape again, **Then** Settings closes.

### User Story 3 - Nothing matches (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the search `Telegram`, **Then** the page shows "No settings match "Telegram"" and a Clear search button, the section list is hidden, and "No settings match" is announced.
2. **Given** a pasted token-shaped string, **Then** the no-match line shows it masked (no secret is drawn back on screen).

### User Story 4 - Every world, both sizes, the narrow row (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the Flat office, Retro, and Real office in photo, cave and loft, at 1440x900 and 1280x800, **Then** the field sits at the top of the section list's column, its text is at least 10.5px, nothing overlaps or scrolls sideways, and the page behind does not scroll.
2. **Given** a 640 px wide window, **Then** the field is full width above the row of sections, and filtering shortens the row.

### Edge Cases

- A section painted later (Organization, sandbox lines, accounts, schedules) arrives while a search is on: it is matched when it arrives; a section that removes itself (Organization with no policy) leaves the results.
- A repaint (`paintSettings` again, for example after a World pick) keeps the words and the results; the focus goes back to the field only if the field had it (FR-011), and the page does not jump to the top because of the search (FR-004).
- Only one section matches: the section list hides itself (FR-226 rule, under 2 entries); the field stays; ArrowDown jumps like Enter (FR-008).
- Very long input: the field keeps at most 200 characters; matching stays linear in the page's text.
- Settings opened at a section (`openSettings('harnesses' | 'mcp' | 'schedules')`): the search is empty (Q10).
- The person types while a page change is on its way: the newest words win.
- Reduced motion: nothing animates (jumps are already instant, FR-226).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** **A search field in Settings.** A `<input type="search">` named "Search settings" with the placeholder "Search settings", at the top of the section list's column (Q7), `autocomplete="off"`, `spellcheck="false"`, at most 200 characters, styled with the existing `.nt-find` search-field rules (`styles.css:2170-2171`; no new size or colour literals, spec 070 ratchet), shown whenever Settings is (also when the section list hides itself). *Acceptance:* in `check-settings-find`, the field exists, has its accessible name, and is inside the screen at both sizes in every world.
- **FR-002** **What is searched** (Q1 d, Q8 a). For each section (`.scr-body>.scr-sec`, `.scr-body>.scr-adv`) the searchable text is its visible text, the text inside its closed `<details>`, the choice names of its `<select>` and radio controls, the `aria-label`s of its controls, and the words of its `data-find` attribute (extra English keywords, written in the section's own template). Subtrees with `hidden` or `aria-hidden="true"` (and `script`, `style`) are left out, a closed `<details>` is not "hidden" and stays in; the text nodes are joined with a space so two parts cannot make a word that is on the page in neither (`Spend`+`ing`). It is read from the rendered page, never from a list kept elsewhere, so a section that appears, goes or changes needs no edit to the search. *Acceptance:* unit test of the pure index over a fixture of sections (a `hidden` subtree not found; two adjacent parts do not join into a false match); driver: `sandbox` finds a word that is only in help text.
- **FR-003** **Matching.** The words are folded (`DurbarSessionSearch.fold`: case, accents) and split on spaces; a section matches when every word is contained in its folded text (any order). An empty or blank field matches everything (the page as today). *Acceptance:* `test:settingsfind`: case, accents, two words in any order, a word in a keyword only, a blank query, a query of 200 characters on a 100 KB page within the linear-time check of `docs/agent-notes.md` (CPU time, two sizes).
- **FR-004** **Filtering the page** (Q2 a, Q3 a). While the field holds words, sections with no match are hidden (`hidden`), matching sections are shown whole, in page order; the page scrolls to its top **only when the person's typing changed the words**. A repaint (FR-011) and a part arriving late (FR-010) never scroll to the top because of the search: after a late part the scroll stays where it was, and after a repaint it is what a repaint without a search gives today (the new `.scr-body` starts at the top). Clearing the field shows every section again at the scroll position the page had before the search began, when that is still the same `.scr-body`. *Acceptance:* driver counts shown sections for `sandbox`, `limit`, `theme`, and none hidden after clearing; with a search on and the page scrolled down, a late part arriving leaves `scrollTop` as it was, and a World pick (repaint) leaves it where a repaint with no search does.
- **FR-005** **Collapsed parts** (Q6 a). A `<details>` (a section's `More`, or Advanced: MCP servers) that holds a match is opened while the search lasts; one the search opened is closed again when the search is cleared, unless the person toggled it during the search. **A search-driven open or close is kept out of the two toggle handlers**: when the search writes `open` on a `<details>` it records the state it wrote (in a `WeakMap` element to open state); `$('advMcp').ontoggle` (`screens.js:513`) and `onLiveToggle` (`:128`) first look: a `toggle` whose state equals the recorded one is the search's own, so the record is dropped and the handler does nothing (no `advOpen` write, no `liveMore` write, no `repaintLive(true)`). Any other `toggle` is the person's (a click, Enter or Space on the summary, or a state different from what the search wrote) and runs as today, `liveStale` reload included. So `advOpen` changes only by the person's own toggle, and a search never makes a bridge call. A search-opened Advanced shows the live list as last painted, which may be stale until the person opens it by hand (honest limit). *Acceptance:* driver: `limit` opens *More about the limit*; clearing closes it; a hand toggle during the search is kept; `github` opens Advanced, clearing closes it, `advOpen` is still false (a repaint with an empty search shows it closed) and no live-list bridge call ran (a counter the driver wraps around the call `repaintLive` makes).
- **FR-006** **The section list follows** (spec 052 FR-226, pointer delta). The list is built from the headings of the sections that are **not hidden**; it hides itself under 2 entries as today; its jump, `aria-current`, keys and narrow row are unchanged. *Acceptance:* `test:settingsnav` gains a case (hidden headings are left out); driver: with `sandbox`, the list's labels equal the shown sections' headings.
- **FR-007** **Highlight** (Q5 b). Every occurrence of a searched word in the shown sections' visible text is marked with a CSS Custom Highlight (`CSS.highlights`, named `durbar-find`), its ranges from `DurbarSessionSearch.locate` (`sessionsearch.js:36`, spec 095 FR-040) per text node, drawn with a theme token background and an underline (`text-decoration`); `::highlight()` accepts only `color`, `background-color` and `text-decoration` (and a few related text properties), so those are the only ones used, and `color` is left alone so the section's own text colour shows on the mark; no node of the page is changed. Where `CSS.highlights` is missing the search works without marks. **Contrast, which pairs:** the mark is a background drawn behind the text, so (1) the text colours that sit on it, `--ink` (headings, labels, controls' text) and `--ink-2` (notes, small notes), against the mark's background token must be at least 4.5:1; (2) the mark's background against `--surface`, the card it sits on, at least 3:1 (non-text contrast); and the underline keeps the mark from being colour alone. Both are measured in every world, Retro's dark page included, from the computed values in the driver. *Acceptance:* driver reads the highlight's ranges for `sandbox` (count > 0, each range's text folds to the word) and the two contrast checks above in every world.
- **FR-008** **Keys** (Q4 b). While Settings is open and no dialog is: ⌘F on a Mac, Ctrl+F elsewhere (the fixed key, whatever the navigator's recorded key is) moves the focus to the field and selects its text, unless the focus is already in the field, in which case the key does what spec 074 FR-002 says (the navigator, when it is the navigator's key; if the person recorded another navigator combo, the second ⌘F / Ctrl+F in the field does nothing). So the first press is not a surprise, the Keyboard section's note and the `?` sheet name this Settings behaviour (T022). The find key is **ignored while the navigator key is being recorded** (`navRecording`, Settings > Keyboard): the recorder listens on `window` in capture (`screens.js:915-920`) and stops the event, which is only safe while the find branch stays in the `document` bubbling handler, behind a `!navRecording` guard. Escape in the field with text clears it and keeps Settings open (as `#prevQ` and `#nsSearch`, `app.js:4221-4222`); with an empty field Escape closes Settings as today. Enter jumps to the first shown section and focuses its heading (the list's `go`). ArrowDown moves the focus to the first entry of the section list; when the list hides itself (one match, under 2 entries) ArrowDown does what Enter does (jump to that section and focus its heading), so it never does nothing. `mod+KeyF` is not added to the navigator's `TAKEN`. Spec 074 gets a pointer delta. *Acceptance:* driver, real key events; the Mac branch is only `IS_MAC`, which lives in `app.js`, not `screens.js`, so the driver runs the key step with the platform the page reports (`IS_MAC`) and checks the other branch's event (⌘F on a Mac, Ctrl+F elsewhere; the other modifier does nothing) by `process.platform`; a step with a recorded navigator combo (second press does nothing) and one while recording (find key ignored); ArrowDown with one match jumps.
- **FR-009** **Count and no-match** (Q9 a). After the words settle (150 ms after the last key), the count is announced through `X.announce`: "1 section matches", "N sections match", or "No settings match". With no match, the page shows one line "No settings match "<words>"", the words masked with the window's masker and cut to 60 characters (the `noMatch` pattern of `notes.js:139-144`), and a **Clear search** button that clears the field and moves the focus back to it. The line is built with `textContent` (or `esc()` when it goes into an `innerHTML` string, as most of `screens.js` does): the masked words are text, never markup, so a field holding `<img src=x onerror=...>` draws those characters and runs nothing. **Clearing is announced too** (Escape, the Clear search button, or emptying the field): "All sections shown" through `X.announce`, once per clear, so a screen-reader user hears that the whole page came back. *Acceptance:* driver reads `#srAnnounce` for each case, "All sections shown" after Escape and after Clear search included; a token-shaped query shows masked; a hostile-markup query (`<img src=x onerror=window.__pwn=1>`) with no match shows the text, creates no `img` in the line and leaves `window.__pwn` unset.
- **FR-010** **Live parts.** A section or text painted after the main paint (FR-002 list) is matched when it arrives; a section that removes itself leaves the results; the count is announced again only when it changed. *Acceptance:* driver: a search for a word of the simulator's Organization or sandbox line, typed before that part paints, ends with it shown.
- **FR-011** **Lifetime** (Q10 a). The words are kept in the screen module across `paintSettings` repaints (the field is filled again and the results restored; the focus goes back to the field **only if the field held it before the repaint**, with its selection kept, the `#prevQ` pattern `app.js:9509`, `:9520`; otherwise the focus stays where the repaint's own code puts it: the World radio after a pick, `pickWorld` `screens.js:748-750`, the Edit button after a place edit, `:881`); they are cleared when Settings closes and when it opens at a section. *Acceptance:* driver: search, focus in the field, a repaint: the words, the results and the focus in the field are still there; search, then pick a World by keyboard (arrow on the radio): the words and results are still there and the focus is on the World radio, not the field.
- **FR-012** **Calm UI and parity.** Text at least 10.5px; at 1440x900 and 1280x800 in the Flat office, Retro, and Real office photo, cave and loft the field and list fit with no overlap or sideways scroll; a 640 px window shows the field above the row; no motion is added; works the same on Windows, macOS and Linux (only the shortcut's label differs). *Acceptance:* `check-settings-find` at both sizes and every world above, plus 640 px; screenshots `112-settings-find-{1440x900,1280x800}.png`.
- **FR-013** **Tests.** Pure matcher and index: `scripts/test-settings-find.ts` (`npm run test:settingsfind`, in `scripts/test-suites.txt`), mutation-checked (word AND to OR; fold removed; keywords ignored). Driver `scripts/check-settings-find.js` in `ui-suite.js`, mutation-checked with five mutants for the main behaviour (filter off; list not following hidden sections; Escape closes instead of clearing; find key always the navigator; find key always the field) and one per review fix (the no-match line without `esc`/`textContent`; focus restored to the field on every repaint; a search-set open counted as the person's toggle; the clear announcement removed; the `hidden` subtree searched), each failing the driver or the unit test. Simulator only, no AI credits.

### Key Entities

- **Search entry** (in memory only): a section element, its folded searchable text, its heading id. Nothing is saved to disk.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `sandbox`, `theme` and `limit` each leave exactly the sections that hold the word (at least the lists in *User Story 1*; the driver computes the expected list from the page's own text and records it), in the simulator, in every world and at both sizes.
- **SC-002**: From an open Settings, reaching a setting takes the find key, the word and Enter (3 steps), with no mouse.
- **SC-003**: Filtering after a key costs under one frame on the simulator's Settings page at 1440x900 (`performance.measure`, median of 20).
- **SC-004**: `check-settings-nav` still passes unchanged with an empty search.

## Assumptions

- The UI is English only; keywords are English.
- Settings stays one page; spec 102 T266 removing Theme and Characters needs no edit here.
- No result ranking: page order is kept (the list is short).
- `[KNOWN GAP]` until a person checks: screen reader behaviour (VoiceOver, NVDA) of the field and the announcements; a real Mac (`real:`); the Custom Highlight API in the packaged app.

## Changes

### 2026-11-10: Q1..Q10 decided (owner)

Paco (owner, terminal, 2026-11-10) accepted every recommended option: Q1 d, Q2 a, Q3 a, Q4 b, Q5 b, Q6 a, Q7 a, Q8 a, Q9 a, Q10 a. *Clarifications* records them as decided; FR-001..FR-013 already carry those options. Plan choices fixed with them: the field uses `.nt-find`; the highlight takes its ranges from `DurbarSessionSearch.locate` (no new range code); `settingsfind.js` has its own `noMatch`, with an equality test against `notes.js`.

### 2026-11-12: review rounds on PR #1472 (Vikram's reviews of 2026-11-10 and 2026-11-12), fixes and answers

Every finding is fixed in this PR (FR-030); the text above carries the result, this lists where.

- Round 1: (1) FR-007 names the contrast pairs and ratios and the `::highlight()` properties; (2) FR-009 announces the clear ("All sections shown"); (3) FR-004 and FR-011 say what the scroll does on a repaint and on a late part; (4) FR-013 carries all five main mutants, FR-008's acceptance has the platform step; (5) FR-008 says what the second press does with a recorded navigator key and that the Keyboard note and `?` sheet name the Settings behaviour; (6) T001 ticked, `npm run specs:check` named in the PR.
- Round 2: (7) FR-011 restores focus to the field only if it held it; (8) FR-005 names `ontoggle` and `onLiveToggle` and keeps a search-driven open out of them; (9) *User Story 1* and SC-001 list the sections the code gives; (10) FR-009 and T011 require `textContent`/`esc()` and a hostile-markup driver case; (11) `spec:112` needs no row in `.github/labels.tsv`: that file says the `spec:NNN` labels are generated from the folders in `specs/` (110 and 111 have no row either), so nothing to add; (12) line references refreshed against `main` at 2026-11-12 and the navigator key described as a bubbling `document` listener (`app.js:4158`).
- Answers to the five questions: (a) FR-002 leaves out `hidden` and `aria-hidden` subtrees, keeps a closed `<details>` and the choice names of selects, and joins text nodes with a space; (b) ArrowDown with one match jumps like Enter (FR-008); (c) Advanced counts as one unit under Q3 (a), intended (Q3 note); (d) FR-008 says the find key is ignored while the navigator key is recorded; (e) the plan's reuse table says why `DurbarScreens.isSettings()` is needed (`isOpen()` is true for every screen).
