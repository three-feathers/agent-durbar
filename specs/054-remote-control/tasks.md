# Tasks: Remote control and chat channels (spec 054, issue #298)

## Phase 1: Copilot remote steering per session

- [x] T001 `src/shared/remote.ts`: `RemoteState`, `allowedRemoteUrl` (https, `github.com` only), `cleanRemoteError` [FR-001, FR-005]
- [x] T002 Capability `remote` and optional `setRemote` on `AgentAdapter`; contract test C2 line [FR-001]
- [x] T003 Copilot `setRemote`: `rpc.remote.enable({ mode: 'on' })` / `disable()`, `rpc.visibility.get()` when present, feature detection, errors, URL filtering; never on by default [FR-002]
- [x] T004 IPC `agents:setRemote` (validated) and `agents:openRemote` (stored URL, allowlist again); state dropped when the session ends or the agent is removed; preload and `DurbarApi` [FR-003, FR-004, FR-005]
- [x] T005 Renderer: More menu and palette item, the confirmation dialog (Cancel first), the link dialog (Copy link, Open on GitHub), Stop remote control, the Remote chip in the header and " · Remote" in the desk card's role line; hidden without the capability [FR-006, FR-007, FR-009]
- [x] T006 Simulator: canned `setRemote` / `openRemote` for Copilot sim agents only [FR-008]
- [x] T007 `scripts/test-remote.ts` (`test:remote`): allowlist and the adapter on a fake session [SC-003]
- [x] T008 Driver `scripts/shots-054-remote.js` written (prints `[054] PASS`) [FR-006, FR-007]
- [ ] T009 Run `scripts/shots-054-remote.js` at 1440x900 and 1280x800 and commit `docs/screenshots/054-remote-*.png` (lead)
- [x] T010 Docs: README (Harnesses: remote control, not verified), CHANGELOG, specs index

## Phase 1: real check (needs the owner's go-ahead: it exports a session to GitHub)

- [ ] T020 On a real Copilot account, in a throw-away GitHub repository folder: one read-only session, one tiny prompt (about 1 premium request), then Control from GitHub. Record: does `enable` work without `enableRemoteSessions` (Q1); is a GitHub repository folder required (Q2); `url` vs `shareUrl` (Q3); plan and cost (Q4); does the GitHub task stay after End session (FR-003); does steering from github.com reach Durbar's chat; does `remote_steerable_changed` arrive. Then Stop remote control and End session.

## Phase 2: Claude Code channels wizard (planned; research first, on a real account)

- [ ] T030 Check `claude -p --output-format stream-json --channels plugin:telegram@claude-plugins-official` with the plugin installed and a test bot: does a Telegram message reach the session as input, and does the reply go back? (costs about 2 prompts)
- [ ] T031 Check whether Remote Control (`claude remote-control` or `/remote-control` sent as a prompt) works for a stream-json session Durbar drives (costs about 1 prompt)
- [ ] T032 Find a non-interactive way to run the plugin's configure (`/telegram:configure`) and access (`/telegram:access`) steps without the token entering a model's context (0 prompts if a CLI route exists, else note it)
- [ ] T033 Record how "Channels are not currently available" shows in stream-json output (0-1 prompt)
- [ ] T034 Bun detection and the plugin install command on Linux, macOS and Windows (no prompts)
- [ ] T035 Only after T030..T034: spec the wizard in detail (FR-020..FR-026), then plan and tasks

## Phase 3: Codex mobile (planned; research only)

- [ ] T040 Check whether Codex in the ChatGPT mobile app sees a session run by `codex app-server`, and whether the app-server has a method or flag for it (costs about 1 prompt) [FR-030]
- [ ] T041 If yes: plan Codex `setRemote` on the same capability (FR-031)
