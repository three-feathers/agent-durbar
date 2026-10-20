# Tasks: Rename sessions (spec 059, issue #372)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md).
**Clarified**: not yet. The tasks assume the recommended option of Q1-Q9; a task that rests on an answer names it.
**Format**: `[ID] [P?] [Story] Description [FR]`. `[P]` = can run in parallel (different files, no dependency). Each task is one small
PR-sized step with its own test. No task spends AI credits except Phase 5, which needs the owner's go-ahead.

## Phase 0: Clarify (owner)

- [ ] T001 Owner answers Q1-Q9; record them under spec.md `## Clarifications` and adjust the tasks below

## Phase 1: Foundation (blocking)

- [ ] T010 [P] `src/shared/names.ts`: `cleanDisplayName(v, max)` and `nameError(v, max)` (collapse and trim, code-point length, controls,
  the hidden-character list moved from `floors.ts`, `redact()` check); `floors.ts` uses it with no change in behaviour;
  `scripts/test-names.ts` (`test:names`) rule table; `test:floors` still green [FR-002] (Q3)
- [ ] T011 [P] `src/shared/sessionname.ts`: `displayNameOf`, `syncEntry`, `renameTarget`, `shortName(name, 40)`;
  `scripts/test-sessionname.ts` (`test:sessionname`) [FR-001, FR-007, FR-008, FR-011]
- [ ] T012 `SavedFolder.sessionNames` in `src/main/folders.ts`: parse (shape, id rule, cap 200, last wins), `setSessionName` (reset
  removes; no write when unchanged), `sessionNameOf`, `dropSessionName`, gone with the folder; `test:folders` [FR-005]

## Phase 2: User Story 1, Durbar-only names everywhere (P1, MVP)

- [ ] T020 `src/main/sessionnames.ts` `renameOp` with injected deps (own session, other office session of the folder, previous row
  re-checked, bad name, reset, in flight, store failure), no adapter call yet; `scripts/test-sessionnames.ts` (`test:sessionnames`)
  [FR-010, FR-013]
- [ ] T021 Wire `sessions:rename` in main, preload and `src/shared/api.ts`; `AgentInfo.alias`; broadcast `agents:renamed`; alias on add,
  restore and resume (`lastSession`, `openSessions`, Previous resume) [FR-013, FR-014]
- [ ] T022 Main title handler applies `syncEntry`; `sessions:listPrevious` returns `names` for present ids; test with a fake router
  [FR-009, FR-011]
- [ ] T023 [P] `askDialog` input option `submitOnEnter` (Enter in the field activates the primary button; Escape unchanged); case in the
  dialog test [FR-004]
- [ ] T024 Renderer: `renameSessionUi` (dialog words, prefill and select, inline error, announcement), **Rename…** in the chat header More
  menu and in `cardMenuActions` (desk card and list row); helpers excluded [FR-004, FR-006] (Q6)
- [ ] T025 Renderer: `a.name` from `displayNameOf`; `applyTitle` honours an alias; card, header, inbox and strip tooltips without the
  runtime title when aliased [FR-001, FR-003, FR-011]
- [ ] T026 Schedules: *This session (…)* option and the schedule list use the display name (40, word boundary, full name in `title`); a
  new schedule stores the short name; coordinate with spec 044 T041 (#371) [FR-008] (Q7)
- [ ] T027 Activity log: `logActivity` writes the alias in `agent` when set; `test:activity` case; no row for a rename [FR-012] (Q4)
- [ ] T028 Simulator: `renameSession` in memory, kinds with `'any'`, `'live'` and none, failure hook; `prev-1`/`prev-2` renameable
  [FR-015]
- [ ] T029 `scripts/check-rename.js` (`npm run check:rename`): every FR-001 surface shows the name, no runtime title in tooltips, Esc and
  empty reset, both sizes, Simple and Expert; `check:office` with 15 agents carrying 60-character names; screenshots
  `docs/screenshots/059-rename-*.png` [FR-016, SC-001, SC-002, SC-005]

## Phase 3: User Story 2, rename in the agent app (P2)

- [ ] T030 [P] Capability `renameSession?: 'live' | 'any'` and member `renameSession?()` in `capabilities.ts` / `types.ts`; fake adapter
  option with a call log and a failure switch; contract C2 [FR-007]
- [ ] T031 [P] Copilot: `'live'`; `rpc.name.set({ name })` on the live session; refuses a non-live id and a name with `"`; tested on a
  fake session only [FR-007] (Q2, Q8)
- [ ] T032 [P] Codex: `'any'`; `thread/name/set` on the live child or `probe()`; `thread/name/updated` → `title` event; tested on a fake
  RPC only [FR-007, FR-011]
- [ ] T033 `renameOp` calls the adapter when `renameTarget` says so; `inApp` on success; Durbar-only plus the note on error; cases in
  `test:sessionnames` [FR-007, FR-010] (Q1)
- [ ] T034 Dialog line "Also renames it in <app>…" / "Only in Agent Durbar…" / "Name in <app>: …" from the capability and liveness;
  partial-result toast; simulator shows all three [FR-004, FR-010]

## Phase 4: User Story 3, Previous sessions (P3; after spec 006 T036, issue #368)

- [ ] T040 **Rename…** in the Previous sessions row ⋯ menu for agent-session rows (not VS Code chats); row title and tooltip use the
  name; search matches it; Resume carries it; `check-rename.js` case [FR-006, FR-009] (Q5)

## Phase 5: Real checks (owner-gated, not in CI)

- [ ] T050 With the owner's go-ahead (Q9): Copilot, rename a session already open in Durbar and look at the Copilot CLI's resume list
  and VS Code; Codex, rename an existing thread and look at the Codex CLI's picker and VS Code. Record prompts and usage (expected 0)
  and results in research.md; turn the matching `[KNOWN GAP]` lines into `real:` [FR-007]

## Phase 6: Docs and converge

- [ ] T060 README (feature list, Previous sessions, Safety model: names are local, the app-side rename and that it cannot be removed,
  Copilot keeps named sessions from cleanup), CHANGELOG *Unreleased*, `specs/README.md` row, `[IMPLEMENTED]` tags; spec 006 FR-031 and
  spec 044 FR-021 cross-links [all]

## Dependencies

- T010, T011 → T012 → T020 → T021 → T022, T024..T029. T023 any time before T024.
- T030 → T031, T032 → T033 → T034.
- T040 needs spec 006 T036 merged.
- T050 after T034 and the owner's go-ahead. T060 last.
