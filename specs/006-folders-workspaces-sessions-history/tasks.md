# Tasks: Folders, workspaces, sessions and history

## Done (as built)

- [x] T001 Add folder / workspace file dialogs, one agent per workspace, `resolveWorkspaceCwd` with JSONC parsing [FR-001]
- [x] T002 `FolderStore` + `parseSavedFolders`, atomic private writes, tests [FR-002, SC-001]
- [x] T003 Restore as lazy agents; `ensureLive` resume-or-create under the same id [FR-003]
- [x] T004 New session dialog and `#n` naming [FR-004]
- [x] T005 Folders popover: New session, Hide/Show, Remove with confirm [FR-005]
- [x] T006 `previousSessionsFor`, `sameDir`, `cleanTitle`, `eventsToHistory` with caps, tests [FR-006, SC-002]
- [x] T007 Resume IPC with folder re-check and replace-after-success; history replay [FR-007]
- [x] T008 Toast and auto-open for earlier sessions [FR-008]

## Open

- [x] T020 (2026-10-19) Give workspace sessions access to all roots (SDK `additionalDirectories`-style option, check the SDK first) or document the limit in the README. [FR-010, FR-019: Copilot `additionalDirectories`, Claude `--add-dir`, tests, docs]
- [x] T021 (2026-10-19) Decide whether per-folder session count should persist (clarify). [FR-011] Decided 2026-10-19 by the owner: the last session continues (FR-020, FR-021): store, restore, wake IPC with history replay, simulator, real check on Copilot and Claude, docs
- [ ] T022 Extract the main-process add/restore/resume logic into testable modules (inject adapter and store) and add credit-free tests. [FR-015]
- [x] T023 Capture a real `events.jsonl`/`getEvents()` (redacted) as a fixture and re-run `test:history` on it (needs feature 013). [FR-009] (2026-10-19: `scripts/fixtures/events/real-getevents-restart.json`, from the FR-021 real check's own throwaway session, read by resuming it without a prompt; `test:history` replays it to its two turns)
- [x] T024 Real-session check of lazy start and resume (feature 013). [FR-009]
- [ ] T025 Offer sessions started in subfolders (clarify matching rule). [FR-013]

## Changes 2026-10-18 (issue #170)

- [x] T026 Pure `broadFolderKind(path, home, flavour)` in `src/shared/broadfolder.ts` (home, parent of home, root, else none; Windows drive and UNC roots; case-insensitive on win32/darwin) with `scripts/test-broadfolder.ts` [FR-016]
- [x] T027 Main returns `warnings` with the add result (folders and the folders of a `.code-workspace`); the renderer shows one calm toast; simulator hook; screenshots at 1440x900 and 1280x800; docs [FR-016]

## Changes 2026-10-18 (remove a session, rename a folder)

- [x] T028 `agents:remove` in main (refuses the last main session of a folder and helpers), bridge, simulator; **Remove session** in the chat header with a confirm when busy [FR-017]
- [x] T029 `label` in `SavedFolder` (parse, save, restore) with `test:folders`; `folders:rename` in main, bridge, simulator; Folders > **Rename** dialog; room name everywhere [FR-018]
- [x] T030 Screenshots at 1440x900 and 1280x800, README, CHANGELOG, specs index [FR-017, FR-018]
- [x] T031 Search box in Previous sessions: title filter (case- and accent-insensitive) over Copilot sessions and VS Code chats, "N of M", "No sessions match", Escape clears; matcher unit test, simulator, `check:office` at both sizes, docs (issue #252) [FR-023]

- [x] T026 (2026-10-19) Remove folder where the user is: chat header for a single-session folder, right-click folder menu on the room header [FR-022]

## Changes 2026-10-20 (issue #368): Pin, Hide and Delete in Previous sessions

- [x] T032 `prevPinned`/`prevHidden` in `SavedFolder`: parse (shape, cap 200, duplicates), save, `markPrevious` (pin and hide exclusive, no rewrite when unchanged), `dropPrevious`, gone with the folder; `test:folders` [FR-026]
- [ ] T033 Pure `arrangeSessions` in `src/renderer/sessionsearch.js` (pinned first newest first, hidden out unless shown, search over what is shown, counts) with cases in `scripts/test-sessionsearch.ts` [FR-024, FR-025, FR-023]
- [ ] T034 `sessions:mark` IPC, preload and `api.ts` types; `pinned`/`hidden` in the `sessions:listPrevious` and `vschat:list` results (filtered to present ids); simulator marks in memory [FR-026]
- [ ] T035 Exclude resume ids of office agents from `sessions:listPrevious` and the resume re-check; unit test with a fake router [FR-032]
- [ ] T036 Renderer: per-row ⋯ button and row menu (shared `#modeMenu`, arrows, Escape, Shift+F10, right-click, focus return), Pin/Unpin, Hide/Unhide, Show hidden (N) toggle, pin mark, Hidden tag, visible counts in *Previous (N)*, toast and auto-open, live announcements, focus after Hide [FR-024, FR-025, FR-027]
- [ ] T037 Capability `deleteSession` and `deleteSession?()` in `capabilities.ts`/`types.ts`, router helper, fake adapter option with a call log, contract check C2 [FR-028]
- [ ] T038 Copilot `deleteSession` through `client.deleteSession` (refuses a live id), tested on a fake client only [FR-028]
- [ ] T039 Codex `deleteSession` through `thread/delete` on a probe (refuses live Durbar and thread ids), tested on a fake RPC only; Claude stays without it [FR-028]
- [ ] T040 `src/main/prevsessions.ts` delete op with injected deps and `scripts/test-prevsessions.ts` (no capability, bad id, refused with `code: 'in-office'` and the Q1 wording for a card by Durbar id / resume id / live / lazy / ended, not in folder, in flight, adapter error, success drops marks and logs once); wire `sessions:delete` and the in-flight check in `sessions:resume`; preload and types [FR-029, FR-032]
- [ ] T041 Activity decision `session-deleted` (sanitizer, CSV/JSON, word "Session deleted"), recorded by T040's op with the action "Session deleted · <agent app> · <short id> · last used <date>" and no title (Q2); `test:activity` [FR-031]
- [ ] T042 Renderer delete flow: Delete… only for agent sessions, disabled with the reason when the adapter has no delete; red confirmation with Cancel focused and the FR-030 wording per app; busy state; success and error toasts; refusal dialog "This session is still in the office" with Go to session and Remove from office (left out, with the start-a-new-session line, for a folder's only session); assert no desk card, office List-view row, card menu or chat header offers Delete (Q1); simulator `deleteSession` and the refusal hook [FR-030]
- [ ] T043 `scripts/shots-006-prevmarks.js` at 1440x900 and 1280x800 (menu open, pinned rows, Show hidden on, delete confirmation, refusal, disabled Delete…), row-fit assertions; `npm run check:office`; screenshots `docs/screenshots/006-prev-*.png` [FR-027, FR-030]
- [ ] T044 Docs and converge: README (Previous sessions, Safety model: Delete only through the app's own API, never VS Code chats, not for Claude Code), CHANGELOG, `specs/README.md` row, `[IMPLEMENTED]` tags [all]
