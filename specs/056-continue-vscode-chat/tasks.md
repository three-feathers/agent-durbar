---
description: "Tasks for spec 056: continue a VS Code chat in Durbar"
---

# Tasks: Continue a VS Code chat in Durbar (spec 056, issue #344)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [quickstart.md](quickstart.md)
**Tests**: required (constitution VII: new logic in the VS Code reader and a new pure module). Simulator and unit tests only; no AI credits (Phase 8 is parked; the Phase 9 real check needs the owner's go-ahead).
**Status**: nothing built. The owner answered Q1-Q9 on 2026-10-20 (spec *Clarifications*); implementation can start once the spec PR is merged. One issue per task (AGENTS.md).

Format: `- [ ] Tnnn [P?] [Story?] Description in file [FR/SC]`. `[P]` = can run in parallel (different files).

## Phase 1: Setup

- [ ] T001 Add the `test:chatcontext` script (`tsc -p tsconfig.scripts.json && node dist-scripts/scripts/test-chatcontext.js`) and its name in `test:serial` in package.json, with an empty `scripts/test-chatcontext.ts` that passes

## Phase 2: Foundational (blocks every story)

- [ ] T002 [P] Keep the matched `workspace.json` folder on `ChatStore` and `ChatFileRef.folder` in src/adapters/vscodeChat.ts; test with posix and win32 fixture paths in scripts/test-vscodechat.ts [FR-005]
- [ ] T003 [P] Add `file` (base name) to `tool` blocks made from `textEditGroup` in src/adapters/vscodeChat.ts; the view output is unchanged; test in scripts/test-vscodechat.ts [FR-005]
- [ ] T004 Create src/shared/chatcontext.ts with `estimateTokens`, the constants and `turnsOf` (grouping, `[attached:]`, `[tool:]` with the 20-per-turn limit, `[edited:]`, `[note:]`, 8,000-character cuts) [FR-005, FR-007]
- [ ] T005 Add `selectTurns` (newest that fit, all, explicit list; lone oversized turn cut to fit) to src/shared/chatcontext.ts [FR-007, FR-009, SC-004]
- [ ] T006 Add `buildDraft` (header with title, folder, "Turns included: X of Y", reader notes, files touched up to 30; fixed delimiters and the record-not-instructions line; closing "What I want now: " line; half-window `tooBig`) to src/shared/chatcontext.ts [FR-005, FR-006, FR-008]
- [ ] T007 Apply `redact()` to every text in `buildDraft` and count the replacements; add `finalizeText` (type, empty, 400,000-character limit, `changed`) in src/shared/chatcontext.ts [FR-010]
- [ ] T008 Unit tests for T004-T007 in scripts/test-chatcontext.ts: a synthetic 120-turn chat, a single 50,000-character message, attachments, tool storms, notes, an empty-user first turn, the delimiters and the record-not-instructions line, a win32 and a posix folder in the header, planted `ghp_`/`github_pat_`/`sk-ant-`/bearer/JWT/AWS/URL-credential tokens absent from `text` and from `finalizeText` output, `changed` true after a pasted token [FR-006, FR-016, SC-003, SC-004]
- [ ] T009 IPC `vschat:draft` and `vschat:finalize` with input validation (data-model.md) in src/main/main.ts; a removed agent gives the "no longer in Durbar" error; no content logged [FR-005, FR-010, FR-013]
- [ ] T010 Bridge entries `vschatDraft` and `vschatFinalize` in src/preload/preload.ts and the `DurbarApi` types in src/shared/api.ts [FR-005]
- [ ] T011 No-write test in scripts/test-chatcontext.ts: list, read and draft a fixture store built by `buildVscodeFixture`, then compare names, sizes and mtimes of every file under it before and after [FR-013, SC-005]

**Checkpoint**: main can build and finalize a draft for any listed chat; nothing is visible yet.

## Phase 3: User Story 1 - Continue from the view (P1) MVP

- [ ] T012 [US1] Canned `vschatDraft` and `vschatFinalize` for the sim bridge in src/renderer/sim.ts (same turn shapes; over-cap on the 346-message chat; a planted `ghp_` token exercises `changed`)
- [ ] T013 [US1] *Continue in Durbar…* in the `.vsbar` of `viewVs` and the new banner and Previous sessions group wording in src/renderer/app.js [FR-001]
- [ ] T014 [US1] Options step: `newSession(a, {vsChat})` mode in src/renderer/app.js (title, Read-only preselected, ready apps only, no summary checkbox, *Next: review the message*; none ready → *Open Settings > Agent apps*) [FR-003, FR-004]
- [ ] T015 [US1] Review box (follows docs/design-rules.md: control heights, one primary last, no `.btn.danger`, shared chevron for *Details*): generalise `reviewHandoff` in src/renderer/app.js (editable text, Cancel/Escape start nothing, empty text disables Start with the reason, the honest-limits line, focus and Escape handling; draft errors such as an unreadable chat or a removed folder are shown and start nothing) [FR-011, FR-015, FR-017]
- [ ] T016 [US1] Start: `vschatFinalize` → masked text shown again when `changed`; else `bridge.newSession` then `sendLive`, then the "Started from a copy…" note; start errors shown, nothing sent, in src/renderer/app.js [FR-010, FR-012, SC-002]
- [ ] T017 [US1] Simulator driver scripts/shots-056-continue.js: open the view, Continue, Next, edit, Start (new agent's first message equals the edited text), Cancel and Escape at each step start nothing, the `changed` path; prints `[056] PASS` at 1440x900 and 1280x800 [SC-001, SC-002]

- [ ] T016a [US1] Sign-in: in the options step use the adapter list's sign-in state (spec 012 FR-156); a *Not signed in* app offers Sign in (`DurbarHarnesses.signIn`) and Open Settings > Agent apps; on an `errorKind: 'auth'` refusal of the first message keep the full reviewed text in memory and resend it unchanged after sign-in on the user's click (not through the 100,000-character prompt memory), in src/renderer/app.js; cover `simauth=out` and `simauth=expired` in scripts/shots-056-continue.js [FR-004a]

**Checkpoint**: US1 works on the simulator end to end.

## Phase 4: User Story 2 - Size cap and turn picker (P1)

- [ ] T018 [US2] Turn list in the review box (time, preview, size, checkbox), *Newest that fit* and *All*, over-cap warning through the live region, in src/renderer/app.js and src/renderer/styles.css [FR-007, FR-009, FR-015]
- [ ] T019 [US2] Rebuild on selection change via `vschatDraft`, with a confirm before replacing edited text, in src/renderer/app.js [FR-009]
- [ ] T020 [US2] Send the chosen model's `contextWindow` (`windowOf`) with the draft request and refuse Start when `tooBig`, showing both numbers, in src/renderer/app.js [FR-008]
- [ ] T021 [US2] Extend scripts/shots-056-continue.js: the warning, unticking and ticking a turn changes the estimate, the confirm on edited text [FR-009]

## Phase 5: User Story 3 - Size and cost estimate (P2)

- [ ] T022 [P] [US3] `contextCostLine(tokens, caps, model, cap, simple)` in src/renderer/modelswitch.js: AIU only from a verified price via `estimateInputCredits`, Claude "reports its dollar estimate after the reply" plus the dollar limit, Codex tokens only, never two units, Simple wording without token numbers [FR-014, SC-006]
- [ ] T023 [P] [US3] Tests for `contextCostLine` in scripts/test-modelswitch.ts (each unit, unverified price, no price, over the session limit, Simple) [FR-014, SC-006]
- [ ] T024 [US3] Show the size and cost line in the review box, updated live while typing (`ceil(len/4)`), in src/renderer/app.js [FR-014]

## Phase 6: User Story 4 - Continue from Previous sessions (P3; owner Q4: only if it fits at 1280x800 with the narrowest panel)

- [ ] T025 [US4] *Continue…* on each VS Code chat row (`data-pv="continue"`) opening the same flow, in src/renderer/app.js and src/renderer/styles.css [FR-002]
- [ ] T026 [US4] Extend scripts/shots-056-continue.js: the row at 1280x800 with the narrowest panel, no overlap or clipping, text ≥ 10.5px [FR-002, FR-015]

## Phase 7: Polish and docs

- [ ] T027 Run scripts/shots-056-continue.js and commit docs/screenshots/056-continue-*.png (options, review, over-cap, Simple) at 1440x900 and 1280x800; `npm run check:office` passes [FR-015]
- [ ] T028 [P] README VS Code section and known limits (Continue in Durbar, estimates, not verified on a real store or session), CHANGELOG *Unreleased* line, specs/README.md row status, in README.md and CHANGELOG.md [FR-017]
- [ ] T029 [P] Spec cross-references at build time: spec 009 `## Changes` (the 2026-10-20 planned note becomes built; banner wording; the "never uploaded" reading of FR-013a) and spec 006 (VS Code group header wording) in specs/009-vscode-integration/spec.md and specs/006-folders-workspaces-sessions-history/spec.md [FR-001]
- [ ] T030 Security review of the whole diff (opaque keys, input validation, redaction before display and send, nothing logged, no writes outside Durbar, no shell) and `npm run typecheck && npm run build && npm test`; tick tasks and update `[IMPLEMENTED]` tags in spec.md [FR-010, FR-013, FR-013a]

## Phase 8: Summarise first (option B): PARKED, not planned (owner, Q8, 2026-10-20: not built for now, no budget)

Kept for the record. Do not open issues for these tasks or build them until the owner un-parks option B.

- [ ] T040 (parked) Spec delta for FR-018 in specs/056-continue-vscode-chat/spec.md (prompt, cost wording, which apps, the budget the owner sets), only if the owner un-parks option B
- [ ] T041 (parked) IPC that sends only the selected, redacted turns to the chosen app's `generateText` with a fixed prompt and `cleanSummary`, in src/main/main.ts; fake-adapter tests in scripts/test-chatcontext.ts [FR-018]
- [ ] T042 (parked) *Summarise first* button in the review box (says before that it uses the model; shows the reported cost after), simulator canned summary, in src/renderer/app.js and src/renderer/sim.ts [FR-018]

## Phase 9: Real check (needs the owner's go-ahead)

- [ ] T070 On Linux: read one real VS Code chat store (read only, no writes, confirm with mtimes) and continue it with one ready app in Read-only with one tiny first message (about 1 prompt; cost stated to the owner first); record `real:` results and cost in spec.md and close the matching `[KNOWN GAP]`s

## Dependencies & Execution Order

- T001 first. T002-T003 [P] and T004 can start together; T005-T007 follow T004; T008 follows T007; T009 needs T002, T006, T007; T010 needs T009; T011 needs T009.
- US1 (T012-T017, T016a) needs Phase 2; T016a needs T014 and T016. US2 (T018-T021) needs T015. US3 T022-T023 can run in parallel with US1; T024 needs T015 and T022. US4 needs T014.
- Phase 7 after the stories that are built. Phase 8 is parked; Phase 9 only with the owner's written OK.

## Implementation Strategy

MVP = Phases 1-4 (US1 + US2: the owner's size rule is part of the decision). Then US3, then US4 (kept only if T026 shows it fits; otherwise drop the row button and record why in spec.md). Each phase ends with `npm run typecheck && npm run build && npm test`.
