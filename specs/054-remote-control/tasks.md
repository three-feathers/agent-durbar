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
- [x] T009 Run `scripts/shots-054-remote.js` at 1440x900 and 1280x800 and commit `docs/screenshots/054-remote-*.png` (lead)
- [x] T010 Docs: README (Harnesses: remote control, not verified), CHANGELOG, specs index

## Phase 1: real check (needs the owner's go-ahead: it exports a session to GitHub)

- [x] T020 On a real Copilot account, in a throw-away GitHub repository folder: one read-only session, one tiny prompt (about 1 premium request), then Control from GitHub. Record: does `enable` work without `enableRemoteSessions` (Q1); is a GitHub repository folder required (Q2); `url` vs `shareUrl` (Q3); plan and cost (Q4); does the GitHub task stay after End session (FR-003); does steering from github.com reach Durbar's chat; does `remote_steerable_changed` arrive. Then Stop remote control and End session.
  - 2026-10-20 partly run (2 prompts, 0.24 AI credits, `scripts/remote-copilot-real.ts`; the throw-away folders had no GitHub remote, so nothing was published): in a plain folder and in a `git init` folder with no remote, `remote.enable({mode:'on'})` answered `{ started: false, remoteSteerable: false }` with no error and no URL; `visibility.get` said `{ synced: false }`; no remote event arrived; `disable()` worked. Q1 partly answered (no error without `enableRemoteSessions`, but nothing started either); Q2: not a plain folder and not a local-only git folder. Fixed: `started: false` is no longer shown as on (FR-002 delta). Still open: a folder with a GitHub remote (needs a throw-away GitHub repository, which is the owner's call), Q3, FR-003, steering from github.com.
  - 2026-10-20 on Copilot Pro: started in any folder with a github.com link (spec Changes).
  - `real:` 2026-10-21, owner (Vikram): "I did a real remote Copilot session today, it works perfectly" (Copilot Pro; on Copilot Free remote does not start, as recorded 2026-10-20). The owner did not say whether github.com or GitHub Mobile was used, or what happened to the GitHub task after End session. Closed by that report; FR-003 and the steering event stay `[KNOWN GAP]` (spec Changes 2026-10-21).

## Phase 2: Claude Code channels wizard (out of scope, owner 2026-10-21; moved to idea #485)

Not done and not planned here: the owner moved Claude channels to idea #485 ("For Claude, no need to support Telegram"). T030 and T032-T035 are struck out, not run; T031 was answered by Phase 2.

- [x] ~~T030 Check `claude -p --output-format stream-json --channels plugin:telegram@claude-plugins-official` with the plugin installed and a test bot: does a Telegram message reach the session as input, and does the reply go back? (costs about 2 prompts)~~ (moved to #485, not run)
- [x] T031 Check whether Remote Control (`claude remote-control` or `/remote-control` sent as a prompt) works for a stream-json session Durbar drives (costs about 1 prompt) (done 2026-10-20 by Phase 2: the `remote_control` control request works over `claude -p` stream-json, `real:`; see T050-T052; not part of the move to #485)
- [x] ~~T032 Find a non-interactive way to run the plugin's configure (`/telegram:configure`) and access (`/telegram:access`) steps without the token entering a model's context (0 prompts if a CLI route exists, else note it)~~ (moved to #485, not run)
- [x] ~~T033 Record how "Channels are not currently available" shows in stream-json output (0-1 prompt)~~ (moved to #485, not run)
- [x] ~~T034 Bun detection and the plugin install command on Linux, macOS and Windows (no prompts)~~ (moved to #485, not run)
- [x] ~~T035 Only after T030..T034: spec the wizard in detail (FR-020..FR-026), then plan and tasks~~ (moved to #485, not run)

## Phase 3: Codex mobile (host integration research)

- [x] T040 Research whether ChatGPT mobile reaches `codex app-server` sessions and whether there is a method or flag [FR-030]. `read:` OpenAI documents mobile access through a connected desktop/SSH host using a managed app-server; its daemon controls are not a per-thread method for Durbar's separate stdio child. `real:` 2026-10-24, Codex CLI 0.164.0: one read-only prompt through `CodexAdapter` returned its expected response, but the owner could not see the thread in the already-paired mobile app. The managed daemon was running; desktop UI was closed and remote-control state was not verified. One prompt used; usage not measured. See spec Changes for scope and limitation. [KNOWN GAP] not verified on a real phone with an active connected host.
- [x] T041 Disposition: do not add `CodexAdapter.setRemote` to the existing per-session capability. Mobile access requires managed host/app-server integration, a distinct architecture and permission-boundary design; defer until separately scoped and approved. No implementation planned in this task [FR-031].
- [x] T011 FR-011 security review: native consent in main, refused in Allow all (and Allow all refused while on), off on GitHub before End/Remove/quit, activity log rows, fromApp on remote/mode/schedule handlers; notification body without the command

## Phase 2: Claude Remote Control (2026-10-20)

- [x] T050 `remoteService` capability, `allowedRemoteUrl(url, host)`, main checks the adapter's host, texts use the service's name [FR-060]
- [x] T051 `ClaudeAdapter.setRemote` over `remote_control`; relaunch turns it back on; `remote` event when that fails [FR-061, FR-062]
- [x] T052 Copilot "not started" message [FR-063]; README Codex line [FR-064]
- [x] T053 Unit tests (fake CLI and remote ops), simulator Claude kind with remote, driver and screenshots (`054-remote-claude-link-*`); real: `remote_control` over `claude -p` stream-json returned a claude.ai `session_url` (2026-10-20); through Durbar's window: sim only [FR-060..FR-064]

## 2026-10-23 delta (owner, spec 017 doors)
- [x] T054 Door closed by you: remote control off and refused, and the window offers to open the door (FR-040; built in spec 017 T013, T019) (renumbered from T040 in review: main's T040 is the Codex check, owned by PR 710)

## 2026-10-28 delta (SDK 1.0.26 drops `remoteSession`)
- [x] T055 `remoteSession: 'off'` kept as a 1.0.22-only hint with a comment; tests stop presenting it as a control; `test:remote` pins that `remote.enable` is reached only by `setRemote(id, true)` from `remoteops.ts`; "SDK 1.0.22" comments refreshed; real 1.0.103 check stays a KNOWN GAP [FR-070, FR-071]
