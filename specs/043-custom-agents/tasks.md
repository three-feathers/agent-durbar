# Tasks: Custom agent per session (043)

## Phase 1

- [x] T001 Types: `AgentProfile`, `agentProfile` event, optional adapter members (generic) [FR-001]
- [x] T002 Copilot: `agentDirectories`, list/select/deselect/getCurrent, event mapping; fake-session tests [FR-002, FR-006]
- [x] T003 Main: IPC `agents:listProfiles` / `agents:selectProfile`, repository confirmation (hash, store); tests [FR-003, FR-006]
- [x] T004 Renderer: Agent chip and menu, repository dialog, waiting switch and Stop drop, card subtitle [FR-004]
- [x] T005 Simulator profiles and events; screenshots at 1440x900 and 1280x800; `check:office` [FR-005]
- [x] T006 (real-account, owner allowed) Free plan, throwaway folder with one repository agent: list, select, reply follows the agent, deselect [FR-006]
- [x] T007 Docs: README, CHANGELOG, specs index [all]

## Phase 2 (not started)

- [x] T010a (2026-10-19) Agent in the New session dialog (same list and confirmation as the chip; applied when the session has started)
- [x] T010 (2026-10-19) Per-folder default agent [FR-009]: `defaultAgent` in the folder store (parse, set, clear on remove), IPC `folders:setDefaultAgent`, the dialog checkbox and preselect, simulator driver at both sizes, docs
- [ ] T011 Claude and Codex mapping (spec 012); Claude half: T011a
- [x] T011a (Claude) agent files listed by the adapter, `--agents`/`--agent` on relaunch [FR-008]
- [x] T012 (2026-10-21, owner request) View and edit profile files [FR-010..FR-017]
  - [x] T012a main: `profilefiles.ts` (list, resolve by id, read, atomic save with EOL/BOM kept and conflict check, create) and its unit test `test:profilefiles` (path escape, symlink, size, round trip in a temp folder)
  - [x] T012b IPC `profiles:*` in `ipc/profiles.ts`, preload and `api.ts`; `test:ipcchannels` list
  - [x] T012c renderer: `profileeditor.js` (Edit / Split / Preview, front matter check, throttled preview, Save and Ctrl/Cmd+S, unsaved guard, conflict, New profile), Edit in the Profile menu, Settings section; `test:profileeditor` (front matter, preview sanitisation)
  - [x] T012d simulator files and the driver `shots-043-editor.js` (modes, widths, save round trip, unsaved guard), screenshots at 1440x900 and 1280x800, light and dark; `check:ui`
  - [x] T012e docs: README, CHANGELOG, specs index
- [x] T016 (2026-10-21, owner request) Create an Agent Success Profile with AI: describe or questionnaire, one-shot through the theme maker's path, checked reply, draft in the editor [FR-026..FR-030]
  - [x] T016a shared prompt builder and reply check; unit tests (answers in, no paths; missing sections, broader tools, `*`, HTML refused)
  - [x] T016b IPC `profiles:generate`, the shared one-shot helper in main, `profiles:create` with text
  - [x] T016c editor draft, the Create with AI dialog, simulator canned generation, driver and screenshots at both sizes
  - [x] T016d docs
  - [x] T017 (real, owner's go-ahead 2026-10-22) One questionnaire generation on Claude haiku through the one-shot path, checked, opened as a draft in Split view (`scripts/profilegen-real.ts`; spec Evidence). Named programs such as `git` are not tools yet: `[KNOWN GAP]`, owner decision
- [x] T018 (2026-10-22, review on #505) Tools only from the Extra tools field; stricter reply check [FR-031..FR-037]
  - [x] T018a shared `parseToolList`, grant rule from the field only, mentioned-tool warnings and the granted-tools note, `name` set only inside the front matter (inserted when missing), byte cap after neutralising (`MAX_PROFILE_BYTES` shared); `test:profilegen` ("never use Bash", "no bash", "don't let it run Bash", "never Edit files" grant nothing; `Bash(git:*)` only when listed; no-name key; `name:` in the body; growth past the cap through `&lt;`; a reply that fails only on size)
  - [x] T018b `profiles:generate` as a testable function with an injected one-shot (`src/main/profilegen.ts`); `test:profilegen` handler cases (bad name, unknown `by`, caps, short description, bad tools entry, a refused reply writes nothing); `test:profilefiles` `createProfileFile` with text (empty, non-string, too large, valid, exclusive)
  - [x] T018c dialog: Extra tools line and its words, `--dlg-w-l`, two-row answers, target app first, Create disabled after Stop waiting until the first request ends; simulator passes the tools; `shots-043-ai` (tool note and warning, Stop waiting: loading text, answers kept, Create disabled, late reply dropped)
  - [x] T018d merge leftovers (ui-suite comment, agent-notes entry moved to #514), docs
- [x] T019 (2026-10-22, re-review on #505) One name for a quoted `name` key; at most one paid request through Cancel, Escape and a reopened dialog [FR-038, FR-039]
  - [x] T019a `setFrontmatterName` through the editor parser (quoted, single-quoted, spaced keys; block values), parse again and refuse unless exactly one chosen name; `test:profilegen` cases
  - [x] T019b main holds one `profiles:generate` request at a time (`busy` refusal before any request; the simulator too); `test:profilegen` handler races with a fake one-shot (cancel-then-create, same tick, after an end, a failure and a refused reply)
  - [x] T019c dialog: a window-wide count, Cancel and Escape while waiting stop waiting first, a reopened dialog keeps Create disabled until the first request ends; `shots-043-ai` (Escape, Cancel, reopen, Create disabled, one simulated paid request)
  - [x] T019d CHANGELOG: only this PR's line, updated (64 KB for Claude Code, Extra tools); docs
- [x] T013 (2026-10-21, owner decisions on #488) Agent Success Profile and Standard agent templates, the default preselected; editor words "Agent Success Profiles" [FR-018, FR-019]
- [x] T014 (2026-10-22, review on #488) New profile sends a folder id, main accepts it only if it is an office folder now [FR-020]; `test:profilefiles`; Copilot `*.md` vs `*.agent.md` recorded as a known gap
- [x] T015 (2026-10-22, review round 2 on #488) Claude files use the adapter's 64 KB cap [FR-021]; the cap on the encoded bytes [FR-022]; Windows device names refused in main and the form [FR-023]; the hint shows the real user folders [FR-024]; editor and form sizes per spec 052 FR-167 and three `check:ui-text` surfaces [FR-025]; tests for the check before `mkdir` and the atomic rename
