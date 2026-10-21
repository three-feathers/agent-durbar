# Tasks 061

- [x] T001 [owner] Amend constitution principle III: Amendment 1, v1.1.0 (2026-10-20)
- [x] T003 [owner] Answer Q5 (2026-10-20: a + c, plus an AI explanation) [FR-011]
- [x] T002 R1 Claude, R2 Codex, R3 Copilot real checks (spec, *Research results*)
- [x] T005 Copilot: repository hooks off until accepted (`enableFileHooks: false`) [FR-017] (#415)
- [x] T010 Shared types and scanner (Claude, Codex, Copilot files; masking; per-item digests); unit tests on fixture folders [FR-001, FR-014]
- [x] T011 Decisions store (accepted/declined digests per folder); unit tests [FR-003, FR-010]
- [x] T020 IPC scan/decide/explain, window-only, with a test that pins it [FR-013]
- [x] T021 Dialog: grouped items in full, broad rules marked, unsupported greyed, hooks confirmation, Use these / Turn all off; opens on folder add and when the setup changed [FR-002, FR-003, FR-010, FR-011]
- [x] T030 Apply: StartOptions.folderSetup; Claude composed --settings; Copilot hookDirectories; MCP servers for all apps; contract tests on the fakes [FR-004]
- [x] T045 AI explanation of each hook through generateText, advisory only [FR-015, FR-016]
- [x] T040 Mode chip "Read-only + folder rules" [FR-012]
- [x] T050 Simulator driver + screenshots at 1440x900 and 1280x800; README, CHANGELOG; one real check per app [FR-006]

- [x] T050 Review on #424 (Paco's agent): required 1-6, S1-S3 and nits fixed with tests (2026-10-21) [FR-010, FR-011, FR-013, FR-014, FR-016]
- [x] T051 Re-review on #424 at aa554f2 (Paco's agent): team notes restored, MCP token-shape masking and shell/interpreter env flag, renderer default tick pinned, long rules as problems, scroll hint, Copilot hook folder in finally, FR-013 pin for require/bracket access [FR-013, FR-014]
- [x] T053 Simulator sample gains a long Stop hook and an MCP server hidden with a reason (fake values); `shots-061` asserts the scroll hint and the reason and captures `061-long-*` / `061-hidden-*` at 1440x900 and 1280x800 [FR-014]
- [x] T054 The confirmation tick ("I have read these hooks…") sits inline before its text, wrapped lines aligned after the box (shared `.dlg .chk` row); `shots-061` asserts it and the `061-*` screenshots are re-captured [FR-011]
- [x] T055 Re-review on #424 at 7537f86 (Paco's agent): env values shown through `shownCommand`, code-loading env variables and wrapped shells marked hidden with a reason, MCP arguments quoted, digest holds shown env values; tests for the NODE_OPTIONS, `env -S` and `timeout` probes [FR-010, FR-014]
- [x] T056 Env values whose name looks secret show `NAME=[hidden]` (spec 041 `secretFlag` + private/cert), listed as value hidden, kept out of the digest, item not unticked by that alone; tests [FR-010, FR-014]
- [x] T058 Re-review on #424 at 97dc616 (Paco's agent): any env value hidden by name marks the item hidden with a reason (option a); the reason text no longer says "read them above" for hidden values; `BASH_FUNC_*`, `MAKEFLAGS`, `MFLAGS` are code-loading; tests pin the watch, flock, script, su, wsl and concurrently probes [FR-014]
- [x] T059 Merge main after #460 (spec 045 FR-060): folder-setup IPC moved to `src/main/ipc/foldersetupipc.ts` (`register`), called from main.ts's IPC block; FR-013 pin follows the new path; `test:ipcchannels` passes [FR-013]
- [ ] T057 Merge `shownWord` (the display quoting in `src/main/foldersetup.ts`) with the quoting helper of #455 (spec 041) in whichever of the two PRs lands second, so there is one quoting helper [FR-014]
- [x] T052 [owner] S1: which allow rules count as broad: owner decided (Vikram, Telegram, 2026-10-21: "For bash - we go with paco's suggestion"): every shell allow rule (`Bash`, `Bash(...)` in any form, `PowerShell(...)`, `shell(...)`) needs the explicit tick; `isBroadRule`, tests and simulator sample updated [FR-011, FR-014]
