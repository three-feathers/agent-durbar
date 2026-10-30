# Tasks: 095 search every session's conversation

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII.3; SC-001..SC-005). Node tests and the simulator only; 0 AI credits; no network. Driver waits use `until()`.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`. `[P]` = can run in parallel. One task = one small testable step; a phase = one PR. Numbers taken: spec 095, FR-001..FR-052 (sparse by group), T001..T063.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block (`specs/095-search-conversations/`)
- [x] T002 Owner answers to Q1-Q9 recorded under *Clarifications* (Paco), and posted on issue #877 as a comment saying where they were given (AGENTS.md: chat feedback goes on the issue)
- [ ] T003 Cross-reference lines under `## Changes` in spec 006 (FR-023: titles-only box unchanged; content search is spec 095) and spec 052 (List view gets a results view) [FR-041]

## Phase 1: Pure core and readers (PR 1)

- [ ] T010 Decide and build main's access to `fold`/`terms`: `require` of `sessionsearch.js` from the built tree if it ships next to main, else `src/shared/foldtext.ts` with a parity test (file + test) [FR-040]
- [ ] T011 `DurbarSessionSearch.locate(text, query)`: folded match ranges mapped back to original offsets (index map, code point safe) + cases in `scripts/test-sessionsearch.ts` (accents, case, any order, `ß`, `İ`, emoji, empty, 20 000 characters) [FR-040]
- [ ] T012 [P] `HistoryLimits.textOnly` and a search `maxItems` in `eventsToHistory` / `claudeHistoryFromText` / `codexHistory` (default unchanged) + `scripts/test-history.ts` cases: tool items dropped, no 300 cap, replay output unchanged [FR-024, D2]
- [ ] T013 [P] `src/main/convmask.ts`: `maskedWindow(raw, rawRange)` = window, widen to whitespace, `redactMarkdown`, `maskHomePaths`, fail closed + `scripts/test-convmask.ts` with the secret fixtures at the edge, glued to Markdown and split across the boundary [FR-030; SC-002]
- [ ] T014 `src/main/convsearch.ts` excerpt builder: from a message and a query, up to 3 masked excerpts (≤ 180 characters), offsets, speaker, anchor `{n, head}`, hit dropped when the mask removed the match + test [FR-011, FR-013, FR-030, FR-031, A2]
- [ ] T015 `convsearch.ts` scan loop with injected readers, clock and yield: titles first, one session at a time, 15 ms slices, caps and the 60 s stop, cancel between sessions and messages, batches (20 / 250 ms), notes + `scripts/test-convsearch.ts` over fake readers of the four kinds (tool output never matches; not-installed, too-large, floors-off, hidden notes) [FR-014, FR-020..FR-023; SC-001, SC-003]
- [ ] T016 Generated-corpus test: 40 MB of fake sessions, longest slice < 50 ms by the fake clock, cancelled within one slice, nothing kept after a session [US4; SC-003]
- [ ] T017 Source test: `convsearch.ts` and `convmask.ts` import no network API, no `child_process`, no `fs` write call; no query in any log call [FR-025, FR-032; SC-005]
- [ ] T018 `package.json`: `test:convsearch` and `test:convmask` in the `npm test` list

## Phase 2: IPC and main wiring (PR 2)

- [ ] T020 `src/main/ipc/convsearch.ts`: `search:start` / `search:cancel` with `fromApp`, query bounds (≤ 200 characters, ≤ 8 words, control characters out, minimum per Q3), random `searchId`, one live scan, stale id ignored; `search:batch` / `search:done` to the starting window only [FR-033]
- [ ] T021 Scope builder from main state: open agents (floors on), `previousSessionsOf` per folder, `listChats` per folder, names and hides per Q5, Q9; the window names nothing [FR-020, FR-033; US5]
- [ ] T022 Wiring in `main.ts`; scan stops on window close and quit [FR-023]
- [ ] T023 IPC tests on a stand-in `electron`: not-`fromApp` refused, bounds, stale id, two starts = one scan, no folder/path accepted; MCP tools and remote control have no search; `test-ipcchannels.ts` owner-only list [FR-032, FR-033]
- [ ] T024 Preload, `DurbarApi` (`src/shared/api.ts`) types: `convSearchStart`, `convSearchCancel`, `onConvSearch`; no channel on `SIM_OPEN_CHANNELS`, `test:simguard` green [FR-033]
- [ ] T025 Simulator fake in `src/renderer/sim.ts`: canned corpus over open and earlier sessions, a slow mode for the progress state, no I/O [US1, US4]

## Phase 3: The window (PR 3)

- [ ] T030 [US1] `src/renderer/convsearch.js` (pure builders: group rows, excerpt HTML with `<mark>` from offsets and `esc()`, state lines, accessible names) + `scripts/test-convsearchui.ts`; load order in `index.html` [FR-010, FR-011, FR-015]
- [ ] T031 [US1] Top-bar box `#convSearch` (and the collapsed magnifier per Q1), 250 ms pause, `setView('list')` remembering the view, clear restores it; styles in the existing CSS files, no size under 10.5px [FR-001, FR-002, FR-050]
- [ ] T032 [US1] Results view in `#list`: In the office / Earlier sessions groups, List row cells reused from `renderList()`, Resume / View buttons, sort headers, "load more" order rule, 200-session cap note [FR-004, FR-010, FR-015]
- [ ] T033 [US3] Keyboard: shortcut per Q2 (keyboard sheet, Settings > Keyboard, palette action "Search conversations" that only focuses the box), Escape clears and returns, Down/J/K/Enter/Shift+F10 on results [FR-003, US3]
- [ ] T034 [US3] Live region: "Searching, N of M" every 2 s at most, final "N results in M sessions" / "No conversation matches"; accessible names; Stop button [FR-015, US3.4]
- [ ] T040 [US2] Find out how the chat and the replay mark messages (read `app.js` chat build and replay; note in `plan.md`); decide the anchor's DOM hook; update FR-013 [FR-013]
- [ ] T041 [US2] Open a result: open-session select, `sessions:resume` + history for previous, `vschat:read` for VS Code; refusal texts reused; no new resume path [FR-012]
- [ ] T042 [US2] `jumpToAnchor({n, head})` with `innerscroll.js`, mark for 2 s (reduced motion: no flash), head mismatch or cap shows the "older than the chat shows" note; unit test on a fake DOM list [FR-013; US2.4]
- [ ] T043 [US5] End-state line with the notes of FR-014 (not installed, too large, floors off, Copilot per Q4, capped) [FR-014]
- [ ] T044 Copilot earlier sessions per Q4 (title only with the note, or the chosen reader) [Q4; US5.2]
- [ ] T050 Driver `scripts/shots-095.js` (all cases of plan *Testing* 5) at 1440x900 and 1280x800 and in `npm run check:ui`; the 15-agent office with an empty box unchanged (`check:office`, geometry) [FR-051, FR-052; SC-004]
- [ ] T051 `npm run shots:docs`: `DOC_SHOTS` entries for the new pictures, retake every linked picture that shows the top bar or List view; look at each [AGENTS.md *Keep docs in sync*]

## Phase 4: Close-out

- [ ] T060 README (feature line, *Safety model*: local search, masked, nothing stored, tool output not searched), docs and website pages the change touches, keyboard sheet text
- [ ] T061 `changelog.d/095-p3-search-conversations.md` (user-visible, in the window PR)
- [ ] T062 Mutation check of plan *Testing* 6, each listed in the PR; `docs/agent-notes.md` entries learned (fold length changes, mask-before-cut windows, Copilot reader gap)
- [ ] T063 Spec housekeeping: tick tasks, `[IMPLEMENTED]` tags, specs-index status, `/speckit-converge`; owner `real:` checks on a real store (timings, Windows and macOS paths)

## Dependencies

- Phase 1 before Phase 2 before Phase 3. Inside Phase 1: T010 and T011 first; T012, T013 in parallel; T014 needs T011 and T013; T015 needs T012 and T014; T016-T018 after T015.
- Inside Phase 3: T040 first (it can change FR-013); T030, T031 before T032; T041 and T042 need T040; T044 needs the Q4 answer. Q1, Q2, Q3, Q5, Q9 must be answered before T031, T033, T020, T021.
