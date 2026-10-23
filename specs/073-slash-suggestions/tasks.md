# Tasks 073: Slash suggestions in the chat composer

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md). One issue = this feature (owner request 2026-10-22). Tests are written with the code.

## Phase 1: Setup

None: no new dependency or project structure (plan).

## Phase 2: Foundational (blocks every story)

- [x] T001 New `src/adapters/slashcommands.ts`: `parseFrontMatter` (moved from `parseClaudeAgent`, which now calls it), `discoverSlash` with
  caps, `lstat` / real-path containment via `isInsideRoots`, name rule, `user-invocable: false`, de-duplication and order [FR-002, FR-003]
- [x] T002 `src/adapters/slashcommands.ts`: `expandSlash` (command/prompt placeholders, skill wrapper, re-read with cap, unreadable → undefined) and
  `cleanBuiltins` with the FR-007 deny list [FR-005, FR-006, FR-007]
- [x] T003 `src/adapters/slashcommands.ts`: `claudeSlashPlaces`, `copilotSlashPlaces`, `codexSlashPlaces` (homes injected) [FR-004]
- [x] T004 `scripts/test-slashcommands.ts` + `test:slashcommands` in `package.json` (and `test:serial`): fixtures for each app's places,
  front matter, caps (count, size), symlink out (skipped when the OS refuses links), `..` names, ordering, de-duplication,
  expansion cases, deny list, win32/posix place paths; `test-agentprofiles` still green [SC-004]



- [x] T005 `src/adapters/types.ts`: `SlashCommand`, `listSlashCommands?`, `expandSlashCommand?`; `scripts/test-adapter-contract.ts` lists
  both as members the fake does not implement (like `listAgentProfiles`) [FR-001]
- [x] T006 Main: new `src/main/ipc/slash.ts` (`agents:slashCommands`, window-only, re-cut, 300 max), `sendOp` in `src/main/main.ts`
  expands and returns `slash`, `infoFor` sets the `slash` flag; `src/preload/preload.ts`, `src/shared/api.ts` (`SlashCommandInfo`,
  `slashCommands?`, `send` result); `test:ipcchannels` covers the channel [FR-005, FR-010]

## Phase 3: User Story 1 - pick a folder skill or command (P1, MVP)

Independent test: simulator chat, keyboard only (quickstart steps 2-4).

- [x] T007 [US1] `src/adapters/claude.ts`: `listSlashCommands` / `expandSlashCommand` over the folder and user files [FR-004, FR-005]
- [x] T008 [P] [US1] New `src/renderer/slashsuggest.js` (pure: token at caret, filter, order, option HTML) loaded before `app.js` from
  `src/renderer/index.html`; unit-tested in `scripts/test-slashcommands.ts` through a VM load [FR-008]
- [x] T009 [US1] `src/renderer/app.js`: combobox on `#msgInput` (open on `/` at a word start, filter, arrows wrap, Tab/Enter insert, Esc
  closes first, click inserts, IME guard, live-region count, fetched on the first "/" and again after 30 s), list placed with `placeMenu` above the box; "Sent the text
  of …" note; `src/renderer/styles.css` with tokens, 10.5px floor, 8 rows then scroll [FR-008, SC-001..SC-003]
- [x] T010 [US1] `src/renderer/sim.ts`: `slashCommands` canned per kind and `send` answering `slash` [FR-011]

## Phase 4: User Story 2 - the app's built-ins, only where they run (P2)

Independent test: a Claude simulated chat lists `app` entries after folder and user ones; a Copilot one lists none.

- [x] T011 [US2] `src/adapters/claude.ts`: built-ins from the model probe's cached `initialize` `commands`, filtered by `cleanBuiltins`
  [FR-006, FR-007, FR-009]

## Phase 5: User Story 3 - each app's own places (P2)

Independent test: unit fixtures per app (T004) and the adapters' listing on temp folders.

- [x] T012 [P] [US3] `src/adapters/copilot.ts` and `src/adapters/codex.ts`: `listSlashCommands` / `expandSlashCommand` over their places
  (Codex prompts too); empty-list wording in `src/renderer/app.js` [FR-004, FR-009]

## Phase 6: Polish and cross-cutting

- [x] T013 New `scripts/check-slash-suggest.js` driver + `check:slash-suggest` script + `ui-suite.js` entry: keyboard flow, ARIA attributes,
  Esc order, no overlap with the box, inside the panel, at most 8 rows visible, no text under 10.5px, at 1440x900 and 1280x800, a dark
  theme pass; time from `/` to the list showing under 100 ms; the "Sent the text of" note; screenshots
  `docs/screenshots/073-slash-1440x900.png`, `073-slash-1280x800.png` [SC-001..SC-003]
- [x] T014 [P] Docs: `README.md` feature list and known limits, changelog fragment `changelog.d/073-slash-suggestions.md`, the specs-index block in `spec.md`, `docs/agent-notes.md`
  entries (Claude `--setting-sources ""` hides folder commands; built-ins run in print mode; Copilot `session.send` does not run
  built-ins; Codex prompts are TUI-only) [VIII]
- [x] T015 `npm run typecheck && npm run build && npm test` (nice), then `/speckit-converge`

## Phase 7: Review on #535 (rubenlupi, 2026-10-22; spec *Changes*)

- [x] T019 `src/adapters/slashcommands.ts`: `SlashCache` (per set of places; 30 s and unchanged dir mtimes; `refresh` on list) and
  `expand` that tests the line pattern before any IO and reads only the named entry's file; Claude, Copilot and Codex adapters use it
  [FR-002, FR-005]
- [x] T020 `src/main/agentops.ts`: `sendWithSlash(ad, id, msg)` used by `sendOp` in `src/main/main.ts` [FR-005]
- [x] T021 `src/adapters/slashcommands.ts`: `BUILTIN_ALLOW` replaces `BUILTIN_DENY` in `cleanBuiltins` [FR-007, FR-009]
- [x] T022 `copilotSlashPlaces` takes the Copilot home (`COPILOT_HOME`, default `~/.copilot`); Claude uses `claudeConfigDir()` [FR-004]
- [x] T023 Tests: `scripts/test-slashcommands.ts` (counting fake fs: 0 reads for "hi", one file for a warm `/name`, cache invalidation by
  mtime and age, refresh; unknown built-in such as `sandbox` not offered; Copilot home), `scripts/test-agentops.ts` (`sendWithSlash`)
- [x] T024 `src/renderer/app.js` / `styles.css`: the list at `--menu-w` with the menu padding, name with an ellipsis, the row's `title`
  with name, description and place, the hint takes only the room left (a short name is never cut: `check:slash-suggest`);
  `scripts/check-ui-text.js` surface `chat-slash-list` and its pass `chat-slash-long` (`simslash=long` in `sim.ts`: 64-character name,
  long hint, 200-character description, 480px panel); `docs/design-rules.md` names the list among the menus [FR-008, FR-011]
- [x] T025 `npm run typecheck && npm run build && npm test`, `check:slash-suggest`, `check:ui-text` for the new surfaces; mutation checks

- [x] T027 Merge of `main` (2026-10-23): spec 010's sim guard (`src/main/simguard.ts`, #514) lists `listSlashCommands` and
  `expandSlashCommand` as optional members with no capability, so the simulator's stand-in adapter has neither (`test:simguard`)

## Phase 8: Review on #535 (fjcabello, 2026-10-23; spec *Changes*)

- [x] T028 `src/adapters/slashcommands.ts`: one `entryFile` check for discovery and expansion: real path inside the root, named
  `SKILL.md` (skills) or `*.md`, not under `.git`; tests for links to `.env`, `.git/config`, a `.md` under `.git`, `../auth.json`
  (Codex home) and a `SKILL.md` linked to `.env`, each neither listed nor expanded [FR-002]
- [x] T029 `readHead` opens with `O_RDONLY | O_NONBLOCK` (0 where the OS has none) and reads only a regular file; test: a FIFO swapped
  in after discovery gives no expansion within a time limit (child process; skipped on Windows) [FR-002, FR-005]
- [x] T030 Test: a `SKILL.md` swapped after discovery for a link out of the folder is not expanded (kills the mutation that drops the
  re-check in `expansionOf`) [FR-005]
- [x] T031 `slashsuggest.js`: `optionHtml` (moved from `app.js`) escapes every field, unit-tested with a hostile entry; `filter` uses
  `DurbarNav.rank` (navigator.js) with `label: name`, `kw: description` [FR-008]
- [x] T032 Mutation-check T028-T031; `npm run typecheck && npm run build`, `test:slashcommands`, `check:slash-suggest`

## Known gaps (open tasks, not this PR)

- [ ] T026 [KNOWN GAP] Run the allow-listed Claude built-ins other than `/context` (`compact`, `cost`, `init`, `review`,
  `security-review`) through Durbar once (real prompts, owner's budget) and record the result in *Vendor behaviour*

- [ ] T016 [KNOWN GAP] Codex: send a chosen skill as the native `{type:'skill'}` input item instead of its text (needs a real check)
- [ ] T017 [KNOWN GAP] Copilot built-ins through `session.rpc.commands.invoke` (experimental API; needs a real check and a safe list)
- [ ] T018 [KNOWN GAP] Nested command folders and parent-folder skill discovery; Codex named `$KEY` arguments

## Story map

- US1 (P1, MVP): T007-T010, checked by T013. US2 (P2): T011. US3 (P2): T012.
- Parallel: T008 with T005-T007; T012 with T007/T011; T014 with T013.

## Dependencies

T001-T003 → T004 and T005 → T006 → T007, T011, T012 → T009 (needs T008) → T010 → T013 → T015.

## Implementation strategy

MVP = Phase 2 + US1 (Claude Code folder entries in the composer); then US2 and US3; docs and checks last, one PR.
