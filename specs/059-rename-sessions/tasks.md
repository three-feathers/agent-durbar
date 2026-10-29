# Tasks: Rename sessions (spec 059, issue #372)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md).
**Clarified**: the owner answered Q1-Q9 on 2026-10-20, option A for each, then changed Q2 to B and added Q10 (spec.md *Changes*, 2026-10-20). A task that rests on an
answer names it.
**Format**: `[ID] [P?] [Story] Description [FR]`. `[P]` = can run in parallel (different files, no dependency). Each task is one small
PR-sized step with its own test. No task spends AI credits except Phase 5, which needs the owner's go-ahead.

## Phase 0: Clarify (owner)

- [x] T001 Owner answers Q1-Q9; record them under spec.md `## Clarifications` and adjust the tasks below (2026-10-20, all A)

## Phase 1: Foundation (blocking)

- [x] T010 [P] `src/shared/names.ts`: `cleanDisplayName(v, max)` and `nameError(v, max)` (collapse and trim, code-point length, controls,
  the hidden-character list moved from `floors.ts`, `redact()` check); `floors.ts` uses it with no change in behaviour;
  `scripts/test-names.ts` (`test:names`) rule table; `test:floors` still green [FR-002] (Q3 A)
- [x] T011 [P] `src/shared/sessionname.ts`: `displayNameOf`, `syncEntry`, `renameTarget`, `shortName(name, 40)`;
  `scripts/test-sessionname.ts` (`test:sessionname`) [FR-001, FR-007, FR-008, FR-011]
- [x] T012 `SavedFolder.sessionNames` in `src/main/folders.ts`: parse (shape, id rule, cap 200, last wins), `setSessionName` (reset
  removes; no write when unchanged), `sessionNameOf`, `dropSessionName`, gone with the folder; `test:folders` [FR-005]

## Phase 2: User Story 1, Durbar-only names everywhere (P1, MVP)

- [x] T020 `src/main/sessionnames.ts` `renameOp` with injected deps (own session, other office session of the folder, previous row
  re-checked, bad name, reset, in flight, store failure), no adapter call yet; `scripts/test-sessionnames.ts` (`test:sessionnames`)
  [FR-010, FR-013]
- [x] T021 Wire `sessions:rename` in main, preload and `src/shared/api.ts`; `AgentInfo.alias`; broadcast `agents:renamed`; alias on add,
  restore and resume (`lastSession`, `openSessions`, Previous resume) [FR-013, FR-014]
- [x] T022 Main title handler applies `syncEntry`; `sessions:listPrevious` returns `names` for present ids; test with a fake router
  [FR-009, FR-011]
- [x] T023 [P] `askDialog` input option `submitOnEnter` (Enter in the field activates the primary button; Escape unchanged); case in the
  dialog test [FR-004]
- [x] T024 Renderer: `renameSessionUi` (dialog words, prefill and select, inline error, announcement), **Rename…** in the chat header More
  menu and in `cardMenuActions` (desk card and list row); helpers excluded [FR-004, FR-006] (Q6 A)
- [x] T025 Renderer: `a.name` from `displayNameOf`; `applyTitle` honours an alias; card, header, inbox and strip tooltips without the
  runtime title when aliased [FR-001, FR-003, FR-011]
- [x] T026 Schedules: *This session (…)* option and the schedule list use the display name (40, word boundary, full name in `title`); a
  new schedule stores the short name; coordinate with spec 044 T041 (#371) [FR-008] (Q7 A)
- [x] T027 Activity log: `logActivity` writes the alias in `agent` when set; `test:activity` case; no row for a rename [FR-012] (Q4 A)
- [x] T028 Simulator: `renameSession` in memory, kinds with `'any'`, `'next-turn'` and none, failure hook; `prev-1`/`prev-2` renameable
  [FR-015]
- [x] T029 `scripts/check-rename.js` (run by hand, not in CI: `NOT_IN_SUITE`, spec 021 FR-057) (`npm run check:rename`): every FR-001 surface shows the name, no runtime title in tooltips, Esc and
  empty reset, both sizes, Simple and Expert; `check:office` with 15 agents carrying 60-character names; screenshots
  `docs/screenshots/059-rename-*.png` [FR-016, SC-001, SC-002, SC-005]

## Phase 3: User Story 2, rename in the agent app (P2)

- [x] T030 [P] Capability `renameSession?: 'any' | 'next-turn'` and member `renameSession?()` in `capabilities.ts` / `types.ts`; fake adapter
  option with a call log and a failure switch; contract C2 [FR-007]
- [x] T031 [P] Copilot: `'any'`; live session -> `rpc.name.set({ name })`; not live -> prompt-free `resumeSession`, `name.set`, `disconnect`
  (released also on error); refuses a name with `"` or over 100 UTF-16 units; tested on a fake client only [FR-007] (Q2 B, Q8 A)
- [x] T032 [P] Codex: `'any'`; `thread/name/set` on the live child or `probe()`; `thread/name/updated` -> `title` event; tested on a fake
  RPC only [FR-007, FR-011]
- [x] T035 [P] Claude: `'next-turn'`; `claudeArgs` adds `--name <name>`; a pending name per session, relaunch before the next message, the
  `title` event after the first turn that follows; tested on fake transports and `claudeArgs` only [FR-007, FR-011] (Q10)
- [x] T033 `renameOp` calls the adapter for every session; `inApp` on success (`pending` for `'next-turn'`); Durbar-only plus the note on
  error; requeue of a `pending` name on restore and resume; cases in `test:sessionnames` [FR-007, FR-010, FR-014] (Q1 A)
- [x] T034 Dialog line "Also saved in <app>… may sync" / "Also saved in Claude Code at your next message" / "Only in Agent Durbar…" /
  "Name in <app>: …" from the capability; partial-result toast; simulator shows all three [FR-004, FR-010, FR-017]
- [x] T036 Escape test: an HTML-looking name through every display path and the MCP read tool text [FR-018]

## Phase 4: User Story 3, Previous sessions (P3; spec 006's row menu, PR #379, is merged)

- [x] T040 **Rename…** in the Previous sessions row ⋯ menu for agent-session rows (not VS Code chats); row title and tooltip use the
  name; search matches it; Resume carries it; `check-rename.js` case [FR-006, FR-009] (Q5 A)

## Phase 5: Real checks (owner-gated, not in CI)

- [x] T050a Copilot, rename a session that is **not** open (prompt-free resume), which folder that resume runs in, and the Copilot CLI's resume list (`real:` 2026-10-21 by Vikram's agent on his machine, PR head 1633d4e, SDK 1.0.22, runtime 1.0.98, CLI 1.0.100; 0 prompts, 0 credits; results on PR #420)
- [ ] T050 With the owner's go-ahead (Q9 A), the rest: VS Code's lists (all three apps); Claude `/resume` for a renamed session (Mac); a Copilot session held open by another client; Codex, rename an existing thread and look at VS Code; one run through the full Durbar UI (window, IPC, `renameOp`); and after a reconnect (`refreshAuth` re-resume) or a restart, the first `session.title_changed` equals the user's name (FR-011). Record prompts and usage (expected 0)
  Results go in research.md; turn the matching `[KNOWN GAP]` lines into `real:` [FR-007]. Already `real:` (Vikram's agent, 2026-10-20, the calls
  and the CLI lists of all three apps, see spec.md FR-007).

## Phase 6: Docs and converge

- [x] T060 README (feature list, Previous sessions, Safety model: names are local, the app-side rename and that it cannot be removed,
  Copilot keeps named sessions from cleanup), CHANGELOG *Unreleased*, `specs/README.md` row, `[IMPLEMENTED]` tags; spec 006 FR-031 and
  #388 (spec 044 FR-021) cross-link: one cutter, `cuttext.js` [all]

## Phase 7: Long unbroken names (issue #536)

- [x] T061 FR-019: a name that is one long token (a URL in a first prompt) stays inside its box on every surface (2-line clamp on full desk cards; roomy and compact keep one line with …, ellipsis
  elsewhere); `simnames=long` gets a URL-like name; `check:office` asserts no card `.name` overflows at 1440x900 and 1280x800; before/after screenshots
  `docs/screenshots/059-long-url-name-*.png`; CHANGELOG [all]

## Phase 8: Rename in place (issue #636, absorbs #595; spec.md *Changes* 2026-10-23, plan *Rename in place*)

Decisions D1..D9: coordinator, under Ruben's delegation. Renderer only; no IPC, store or adapter change; 0 AI credits.

- [x] T070 [P] `src/renderer/inlinename.js` pure part (`keyAction`, `pasteText`, `outcome`, `blurAction`) and `scripts/test-inlinename.ts`
  (`test:inlinename` in `npm test`). Done when: composing Enter and keyCode 229 → `null`; LF, CR, CRLF, TAB → one space each, U+2028 kept;
  `outcome('Ab', '  Ab ')==='same'`, `''` and `'   '` → `'reset'`; window blur → `'keep'`, blur with a rule error → `'revert'`; each of the
  three plan mutations makes the test fail [FR-021, FR-027]
- [x] T071 Split `renameSessionUi` and `renameFolder` into submit parts (`submitSessionName`, `submitFolderName`) that the dialogs call;
  no behaviour change. Done when: `npm run check:rename` and `test:dialog` pass unchanged; `grep` finds one `bridge.renameSession` and one
  `bridge.renameFolder` call site in `app.js` [FR-022, D5, D6]
- [x] T072 DOM part of `inlinename.js` (`open`, `follow`, close, error line, busy, one instance) and its CSS (theme tokens, ≥10.5px);
  wired at the end of `renderAll`, `renderPrev`, `renderFolders`, on resize and floor scroll. Done when: a status tick, a density change and a
  list rebuild keep the field's value and selection; a removed anchor closes it without a call; Esc/Enter/Tab never reach the global
  keydown (the chat stays open) [FR-021, FR-023 items 4-6]
- [x] T073 Chat header: `#panelTitle` with `aria-label` and the inner title button, `repaintName` updates labels but never the field,
  click / F2 / Enter start the edit, the double-click and 400 ms guard, the decorative pencil cue and tooltip. Done when: acceptance
  scenarios 1, 2, 3, 11, 17 pass in the driver; focus on open (`focus==='title'`, `remoteBack`) opens no field; a helper chat's title is
  plain text [FR-020 item 1, FR-023 items 1, 7, D1, D7, D9]
- [x] T074 Desk cards (every density) and list rows: sibling pencil buttons (`data-ren`, keyed for the morph), list rows wrapped in
  `.lrow-w`, the delegated click checks `[data-ren]` first, F2 on `[data-id]`, `ICON('rename')`. Done when: a card or row click still opens
  the chat; scenarios 4, 5, 15, 16 pass; J/K in the list and `shots-034-list` still pass; `check:office` with pencils forced visible has
  no overlap and still fits 15 agents at both sizes [FR-020 items 2, 5, 6, FR-025, D2, D8]
- [x] T075 Previous sessions rows (agent rows, hidden rows too; no VS Code rows) and folder names (room header, Folders panel row; no
  pencil in the list Folder cell; F2 on `[data-door]` and `[data-foldermenu]`). Done when: scenarios 13 and 14 pass; the renamed row keeps search and Resume
  (FR-009); a folder reset brings back the folder's own name; demo mode shows no pencil [FR-020 items 3, 4, FR-023 item 2]
- [x] T076 Simulator hooks (`retitle`, `renamedElsewhere`, `renameRoomElsewhere`, `endAgent`, `removeAgent`, `inline()`, call counters on
  the fake `renameSession` / `renameFolder`) and `scripts/check-rename-inline.js` (`npm run check:rename-inline`, in `ui-suite.js`
  `DRIVERS`), 1440x900 and 1280x800, Expert and Simple. Done when: every acceptance scenario 1-17 is asserted; it prints "all checks passed";
  each plan mutation (Esc propagation, input inside `.name`, no `detail` guard, submit on unchanged, `visibility:hidden` pencil) makes it
  print `DRIVER FAILED` [FR-015, FR-027]
- [x] T077 Accessibility and fit checks: shortcut sheet row "F2: rename the focused session or folder"; focus return after save and
  cancel on every surface; `check:ui-text` surface `rename-inline` and rule `inline-edit-fit`; header not a drag region with
  `data-platform="darwin"`. Done when: `npm run check:ui-text` passes and fails with a 10px field font or a field that moves the header by 1px
  [FR-024, FR-025]
- [x] T078 Docs and screenshots: README (feature list line on renaming, the room ⋯ line), `changelog.d/059-rename-in-place.md`, spec
  `[KNOWN GAP]` → `[IMPLEMENTED]` with `sim:`/`test:` evidence, specs-index status, `docs/screenshots/059-rename-inline-*` at both sizes;
  `npm run shots:docs -- --only shots-hero,shots-003-011,shots-005-cardmenu,shots-006-prevmarks,shots-052-ux,shots-074-navigator`, look at
  each, commit those that changed and list the rest in the PR; close #595 as a duplicate of #636 when the PR opens (D9). Done when:
  `npm run changelog:check`, `npm run specs:check` and `npm test` (`test:uisuite`, `test:site`) pass [FR-026, FR-027]
- [x] T079 Driver: the focused-pencil step of `scripts/check-rename-inline.js` gives the window real focus, waits for `document.hasFocus()`, and reads
  the pencil's target opacity with its transition off (issue #715, Windows CI). Done when: `check:rename-inline` passes focused and with
  `RI_UNFOCUSED=1`, and fails when `.unit:focus-within>.ren` is planted to opacity 0 [FR-021, FR-025]
- [x] T080 `placeRen` anchors on the mode icon only when it shares the name's line, else on the name; `pageCheck` in `scripts/check-office-overlap.js`
  fails a pencil over the first half of its name (issue #781). Done when: `check:office` passes on a wide card with the icon wrapped below the name [FR-020, FR-025]

## Dependencies

- T010, T011 → T012 → T020 → T021 → T022, T024..T029. T023 any time before T024.
- T030 → T031, T032, T035 → T033 → T034, T036.
- T040 needs spec 006 T036 merged (PR #373 carries the spec delta).
- T050 after T034 and the owner's go-ahead. T060 last.
- T070 → T072; T071 any time before T073. T072 → T073, T074, T075 → T076 → T077 → T078. Phase 8 does not depend on T050.
- [x] T081 Issue #788 (FR-169): the room header's pencil in flow after the name; `placeRen` and `placePencils` no longer handle folder pencils; `check:office` fails a folder pencil over the name

