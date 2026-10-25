# Feature Specification: Remote control and chat channels for sessions

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Remote control and chat channels: Copilot remote steering from github.com and GitHub Mobile (Phase 1); Claude Code Remote Control from claude.ai and the Claude app (Phase 2); Claude Code channels wizard out of scope, moved to idea #485 (owner 2026-10-21)
status: **Phases 1-2 built** (unit, simulator driver); Copilot real check 2026-10-20: not started on a free plan, also in a private GitHub repository, started on Pro; owner used a real Copilot remote session 2026-10-21 ("works perfectly"); Claude `remote_control` real over `claude -p`, Durbar window sim only; Codex mobile is documented for connected desktop/SSH hosts using managed app-server, but Durbar's per-session stdio process did not appear in one live test; active connected-host workflow remains unverified
-->

**Feature Branch**: `054-remote-control`
**Created**: 2026-10-20
**Status**: Phase 1 built (Copilot remote steering per session: simulator and unit tests; real checks 2026-10-20: never started on Copilot Free, started in any folder on Copilot Pro). **Phase 2 built** (FR-060..FR-064, Claude Code Remote Control per session: unit tests and simulator driver; the `remote_control` request was checked on a real account over `claude -p`; through Durbar's window `[KNOWN GAP]`). Copilot remote session used for real by the owner 2026-10-21 (Changes). Codex mobile access is documented for connected desktop/SSH hosts using a managed app-server; Durbar's separate per-session stdio process did not appear in one live test, and the active connected-host workflow remains `[KNOWN GAP]` (FR-030/FR-031). Claude channels wizard: **out of scope** (owner 2026-10-21), moved to idea issue #485.
**Input**: Issue #298. Owner (Telegram, 2026-10-19; Ruben raised it the day before): "support remote controls and channels". The issue's first open question ("which first: the Copilot `--remote` link or the Claude channels wizard?") is answered by doing the Copilot link first: it is generally available, needs no plugin or extra runtime, and the SDK Durbar already uses exposes it per session.

## Summary

Someone running agents in Durbar on their computer wants to follow and steer a session from their phone or another computer. Each harness has, or is building, its own route:

| Harness | Remote route | Status in Durbar |
|---|---|---|
| **Copilot** | Remote control: a session exported to GitHub and steerable from github.com and GitHub Mobile. | **Phase 1, built** (sim, unit). Real run not done. |
| **Claude Code** | Remote Control (claude.ai / Claude app) and Channels (Telegram, Discord, iMessage plugins; research preview). | Remote Control: **built** (Phase 2, FR-060..FR-064). Channels: **out of scope** (owner 2026-10-21, idea #485). |
| **Codex** | Codex in the ChatGPT mobile app. | ChatGPT documents connected desktop/SSH hosts backed by a managed app-server. A one-prompt Durbar adapter test did not appear in the owner's already-paired mobile app; the desktop UI was not running and daemon remote-control state was not changed or verified. See the dated result below. |

Phase 1 adds one item to a live Copilot chat's **More** menu and to the command palette: **Control from GitHub (web and mobile)…**. Durbar explains what it does, asks, turns remote control on for that one session, and shows the GitHub link with *Copy* and *Open on GitHub*. A small **Remote** marker shows on the desk card and in the chat header while it is on. **Stop remote control** turns it off.

## Research (2026-10-20, `@github/copilot-sdk` as pinned in `package.json`; nothing run against a real account)

- `read:` `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts` (session RPC, around line 34987), marked `@experimental`:
  - `remote.enable(params: { mode?: 'off' | 'export' | 'on' }): Promise<{ url?: string; remoteSteerable: boolean }>`. "Enables remote session export or steering"; with no mode it "defaults to enabling both export and remote steering". `url` is the "GitHub frontend URL for this session".
  - `remote.disable(): Promise<void>`: "Disables remote session export and steering."
  - `remote.notifySteerableChanged(...)`: for hosts that own their own exporter; not used.
  - `RemoteSessionMode`: `"off"` local only; `"export"` exports session events to GitHub without steering; `"on"` export **and** steering.
  - `visibility.get(): Promise<{ synced: boolean; status?: 'repo' | 'unshared'; shareUrl?: string }>`. `repo` = "visible to anyone with read access to the repository"; `unshared` = "restricted to the creator and collaborators". When `synced` is false, the session has no GitHub task and `status`/`shareUrl` are absent.
  - `visibility.set({ status })`: not used by Durbar (Phase 1 never widens who can see a session).
- `read:` `dist/types.d.ts`:
  - client option `enableRemoteSessions?: boolean` (default false): "Enable remote session support (Mission Control integration). When true, sessions in a GitHub repository working directory are accessible from GitHub web and mobile." `read:` `dist/client.js` (around lines 2304 and 2486): it only adds `--remote` to the runtime's arguments.
  - `SessionConfig.remoteSession?: RemoteSessionMode`, "per-session remote behavior control", default `"off"`.
- `read:` `dist/generated/session-events.d.ts`: `session.remote_steerable_changed { remoteSteerable }`, and `remoteSteerable` in the `session.start` / `session.resume` data.
- `read:` `dist/session.d.ts` line 98: sessions expose `session.rpc`.
- **Open question Q1 (Copilot).** Does `remote.enable` work on a runtime started **without** `enableRemoteSessions` (`--remote`)? The types do not say it is needed. Durbar shares one runtime for every Copilot session, and `--remote` on that runtime might make every session in a GitHub repository reachable from GitHub, which is the opposite of "off by default". So Durbar does **not** set `enableRemoteSessions`; if enable fails, the error is shown as it comes (FR-006). To be settled by the real check (T020).
- **Open question Q2 (Copilot).** Does the session have to be in a GitHub repository working directory (the client option's wording)? Assumed yes; the runtime's own error is shown otherwise.
- **Open question Q3 (Copilot).** Is the `url` from `enable` the same as `visibility.shareUrl`? Durbar shows `enable`'s `url`, falling back to `shareUrl`.
- **Open question Q4 (Copilot).** Does it cost anything, and does it work on a free plan? Copilot's remote control is GA since 2026-05-18; Business and Enterprise need an admin policy (issue #298 research). Not checked.

## Requirements

### Phase 1: Copilot remote steering per session (built)

- **FR-001** **Adapter capability `remote`** (adapter-neutral) `[IMPLEMENTED]`:
  - `AdapterCapabilities.remote?: boolean` (missing = false);
  - `AgentAdapter.setRemote?(sessionId, on: boolean): Promise<RemoteState>`, present exactly when the flag is true (spec 012 FR-027, contract test C2);
  - `RemoteState` (in `src/shared/remote.ts`, no vendor types): `{ ok: boolean; on?: boolean; url?: string; steerable?: boolean; visibility?: 'repo' | 'unshared'; error?: string }`.
  - The renderer and `src/shared` never see a Copilot type (constitution II).
- **FR-002** **Copilot implementation** `[IMPLEMENTED]`:
  - on: `session.rpc.remote.enable({ mode: 'on' })`; then `session.rpc.visibility.get()` when it exists. Its failure is ignored (the visibility is then unknown); `shareUrl` is used only when `enable` gave no URL;
  - off: `session.rpc.remote.disable()`;
  - **feature detection**: when `rpc.remote` (or the method needed) is missing, `{ ok: false, error: 'This Copilot version cannot be controlled from GitHub.' }`, and nothing is called;
  - an unknown or ended session gives `{ ok: false, error: 'This session is not running.' }`;
  - a rejected call gives `{ ok: false, error: <the runtime's message, one line, at most 300 characters> }`;
  - a returned URL that is not an allowed GitHub URL (FR-005) is dropped, never shown;
  - **never on by default**: the adapter never sets `remoteSession` on create or resume and never sets the client's `enableRemoteSessions` (Q1).
- **FR-003** **Remote ends with the session** `[IMPLEMENTED]`: ending the session (End session, Remove, quit) drops Durbar's remote state for it; the menu and markers go back to off. Whether the runtime keeps the GitHub task alive after the session ends is not known (`[KNOWN GAP]`, T020).
- **FR-004** **IPC `agents:setRemote(id, on)`** `[IMPLEMENTED]`:
  - validated in main: a known agent id, `on` a boolean; the agent's adapter must have `setRemote` (else `{ ok: false, error: 'This agent app cannot be controlled from GitHub.' }`); the session must be live (a lazy or ended session: `{ ok: false, error: 'Send a message first so the session is running, then turn on remote control.' }`);
  - main keeps the last state per agent id (only `on`, the allowed URL, steerable, visibility) to answer `agents:openRemote`; it is dropped when the session ends or the agent is removed;
  - nothing about it is logged. If a debug line is ever added, it goes through the redacting sink.
- **FR-005** **Opening the link** `[IMPLEMENTED]`:
  - `allowedRemoteUrl(url)` (pure, `src/shared/remote.ts`): `https:` only, host exactly `github.com` (no subdomain, user info or port), at most 2048 characters;
  - IPC `agents:openRemote(id)` opens the URL **main stored for that agent**, not a URL sent by the page, after the check again, and passes `new URL(url).href` to `shell.openExternal`.
- **FR-006** **Turning it on (renderer)** `[IMPLEMENTED]`:
  - the item **Control from GitHub (web and mobile)…** shows in a live main Copilot agent's chat **More** menu and in the command palette (for the open chat), only when the agent's kind has `remote` and the bridge has `setRemote`; it is hidden, not disabled, otherwise (spec 012 SC-003);
  - choosing it opens the dialog: *Control this session from GitHub?* "Durbar turns on remote control for this session. Its messages are sent to GitHub, so you can follow and steer it from github.com and GitHub Mobile. Anyone who can see this session on GitHub can steer it." Then one line on visibility when known (before the first enable it is usually not known: "Who can see it is decided by GitHub: you and the repository's collaborators, or everyone who can read the repository."), and the buttons **Cancel** (focused first) and **Turn on**;
  - on success: a dialog *Remote control is on* with the link as text, "Open this link in GitHub Mobile to steer from your phone.", the visibility line when known ("Visible to: anyone who can read the repository" / "you and collaborators"), and **Copy link**, **Open on GitHub** and **Done**; a toast says "Remote control is on for <name>";
  - when GitHub gives no link: "Remote control is on, but GitHub did not give a link. Find the session on github.com." (no Open button);
  - when `steerable` is false: "GitHub can show this session but cannot steer it yet.";
  - on failure: an error toast with the plain error; nothing changes.
- **FR-007** **While it is on** `[IMPLEMENTED]`:
  - the desk card's role line adds " · Remote" (text in the existing line; **no size change** to desk cards, constitution V); its accessible name adds "remote control on";
  - the chat header's chip row adds a **Remote** chip (the existing `mchip` style); clicking it opens the link dialog again;
  - the More menu item and the palette item read **Stop remote control**; choosing it calls `setRemote(id, false)` without a dialog (turning it off only narrows exposure) and toasts "Remote control is off".
- **FR-008** **Simulator** `[IMPLEMENTED]`: Copilot sim agents have `remote`; `setRemote` answers after a short delay with `https://github.com/three-feathers/agent-durbar/sessions/sim-<n>`, `steerable: true`, `visibility: 'unshared'`; `openRemote` logs "would open" and opens nothing. Claude, Codex and basic sim kinds have no `remote`, so the item is hidden for them.
- **FR-009** **Escaping**: every text from the adapter (URL, error) is set with `textContent` or `esc()`, never as HTML `[IMPLEMENTED]`.
- **FR-010** **Not done in Phase 1** `[KNOWN GAP]`:
  - `session.remote_steerable_changed` is not mapped: a change made elsewhere (turned off on GitHub, or by another client) is not reflected until the user acts in Durbar;
  - remote is not offered for a session that has not started yet, and is not remembered across a restart (each session asks again);
  - Durbar never changes visibility (`visibility.set`); the user does that on GitHub;
  - no QR code (the CLI shows one): the link is copied or opened, and the dialog suggests GitHub Mobile.

### Phase 2: Claude Code channels wizard (out of scope since 2026-10-21, moved to idea #485; no code)

Owner decision (Vikram, team chat 2026-10-21): "For Claude, no need to support Telegram"; non-native channels are rethought later and kept as a future idea (#485). FR-020..FR-026 below are kept only as the record of that idea; none of them is planned work in this spec.

- **FR-020** *(planned)* **Research first.** Before any code, check on a real account (T030..T034) whether `claude -p --output-format stream-json --channels plugin:telegram@claude-plugins-official` delivers channel messages into a stream-json session, and whether Remote Control (`claude remote-control`, `/remote-control`) works for a session Durbar drives. Both are documented for interactive sessions only. If neither works in print mode, Phase 2 stops and the issue records why.
- **FR-021** *(planned)* **Prerequisites, each confirmed by the user**: Bun found on PATH (else the official install page opens; Durbar does not pipe an install script into a shell, spec 051 D1); the official plugin installed with Claude's own plugin command, shown before it runs.
- **FR-022** *(planned)* **BotFather guide**: step by step (open @BotFather, `/newbot`, name, username, copy the token), with screenshots.
- **FR-023** *(planned)* **The bot token** goes from a password field **straight to the plugin's own configure step** (`/telegram:configure <token>` or its non-interactive equivalent, to be found). Durbar never stores, logs or echoes it; it is not kept in memory after the call (constitution III).
- **FR-024** *(planned)* **Pairing and the allowlist only in Durbar's UI**: a pairing request is approved with a button in Durbar, never because a message in the channel asked for it. **No access change ever comes from a channel message.**
- **FR-025** *(planned)* **A channel-connected session** keeps the folder's permission mode (Read-only by default); the desk shows "connected to Telegram"; a warning says that anyone in an allowed chat can drive the session.
- **FR-026** *(planned)* Open questions: does `--channels` need an interactive TTY? Does the "Channels are not currently available" server flag show in stream-json output, so Durbar can say so? Can the plugin's configure and access commands run without a session (so the token never enters a model's context)? Does one bot serve several sessions?

### Phase 3: Codex in the ChatGPT mobile app (host integration research; implementation deferred)

- **FR-030** Research (T040; `read:` [Remote connections](https://learn.chatgpt.com/docs/remote-connections), [app-server-daemon README](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/app-server-daemon/README.md)): OpenAI documents ChatGPT mobile access to Codex chats on a connected desktop host, and remote projects on SSH hosts through the desktop app's SSH connection. The host is paired from the desktop app using a QR code; the docs require Codex access in the same ChatGPT account/workspace but do not specify plan tiers. Mobile can send follow-up messages, approve actions, and review outputs. The app-server daemon has host-level remote-control lifecycle commands; no documented per-thread `setRemote` call or documented way to attach an arbitrary running app-server process. `real:` One read-only Durbar adapter session returned its expected response, but the owner could not see that conversation in the already-paired mobile app. The managed daemon was running; the desktop UI was closed and remote-control state was not changed or verified. This negative result is specific to that setup and does not prove the documented connected-host workflow fails generally.
- **FR-031** No same-capability `setRemote` is planned for the current adapter. The documented path is host-level: ChatGPT connects to a desktop or SSH host, which uses a managed app-server with remote control enabled. Durbar instead starts one app-server child per session over stdio (`src/adapters/codex.ts`, `src/adapters/codexRpc.ts`), so adopting mobile access would require a separate design to share or hand off sessions to that managed host service. `[KNOWN GAP]` The live test did not establish whether a Durbar thread can be attached when the documented desktop-host workflow is active.

## Success criteria

- **SC-001** From a live Copilot chat, the user turns remote control on in two clicks after reading what it does, and gets a GitHub link they can open or copy.
- **SC-002** Nothing is exported to GitHub unless the user chose **Turn on** for that session; a new or resumed session is always local.
- **SC-003** `npm test` covers the adapter mapping (enable, disable, visibility, feature detection, errors, URL filtering), the URL allowlist, and the capability contract.

## Evidence (2026-10-20)

- `[IMPLEMENTED]`:
  - `src/shared/remote.ts` (`RemoteState`, `allowedRemoteUrl`, `cleanRemoteError`);
  - `src/adapters/capabilities.ts` and `types.ts` (`remote`, `setRemote`);
  - `src/adapters/copilot.ts` (`setRemote`, `COPILOT_CAPABILITIES.remote`);
  - `src/main/remoteops.ts` (input checks, stored link, `forget` on `stopped`) wired in `src/main/main.ts` (`agents:setRemote`, `agents:openRemote`), preload and `DurbarApi`;
  - `src/renderer/app.js` (More menu, palette, dialogs, desk and header markers), `src/renderer/modelswitch.js` (`shows(caps,'remote')`);
  - `src/renderer/sim.ts` (canned remote for Copilot sim agents).
- `test:` `test:remote` (`scripts/test-remote.ts`): the allowlist (scheme, host, subdomain, look-alike hosts, user info, port, length, non-strings); the Copilot adapter on a fake session: enable sends `{ mode: 'on' }` and maps the URL, steerable and visibility; a missing `visibility` group or a failing `visibility.get` still succeeds; `shareUrl` fallback; a non-GitHub URL is dropped; disable calls `disable()`; no `rpc.remote` → `ok: false` with nothing called; a rejected call → `ok: false` with a one-line error; an unknown session; create and resume never set `remoteSession`. The main-side logic (`remoteops.ts`): invalid ids and non-boolean `on` refused, a kind without `remote`, a session not running, only a stored and allowed link opens, a misbehaving adapter's foreign URL or extra fields never pass, off / `forget` / errors drop the stored link. The contract test (C2) checks `setRemote() <=> capabilities.remote`.
- `sim:` `scripts/shots-054-remote.js` is written (open a Copilot sim chat, More, Control from GitHub, Turn on, link and Remote chip, Stop remote control; screenshots `docs/screenshots/054-remote-*.png` at 1440x900 and 1280x800) but **not run in this change** (`[KNOWN GAP]` until the lead runs it).
- `real:` none at the time (see 2026-10-20 below). `[KNOWN GAP]`: turning remote control on exports the session's messages to GitHub, so a real check needs the owner's go-ahead (T020).

- **FR-011** **Consent and limits in the main process** (security review, 2026-10-20) `[IMPLEMENTED]` `test:` `scripts/test-remote.ts`:
  - turning remote control on needs a **native confirmation** in main (`dialog.showMessageBox`, Cancel is the default) on top of the page's dialog, so a compromised page cannot publish a session;
  - it is **refused in Allow all**, and switching an agent to Allow all is refused while remote control is on: anyone who can steer the session on GitHub could otherwise make it run commands without asking;
  - before **End session**, **Remove from office** and **quit** (at most 3 s), main turns remote control **off on GitHub too** (`setRemote(id,false)`, best effort), not only in Durbar's state;
  - remote on and off are written to the **activity log** (`remote-on`, `remote-off`);
  - `agents:setRemote`, `agents:openRemote`, `agents:setMode`, `schedules:save` and `schedules:remove` answer only the app's own page (`fromApp`).
- **2026-10-20 (security review, FR-011):** a reviewer found the consent lived only in the page, remote and Allow all could be on together, and remote was not turned off on GitHub when a session ended. Fixed as FR-011. The OS notification body (spec 052 FR-059) now names only the kind of request ("Asks for your OK"), never the command, which could hold a token. `[KNOWN GAP]` Not checked on a real account.

### 2026-10-20: first real check (T020, partly)

- `real:` 2026-10-20, Copilot runtime 1.0.98, free plan, `auto`, Read-only, the real `CopilotAdapter.setRemote` on a live session after one tiny prompt (`scripts/remote-copilot-real.ts`). **2 prompts, 0.16 + 0.07 = 0.24 AI credits.** The runtime was started without `enableRemoteSessions`, as Durbar does.
  - **Plain empty folder:** `remote.enable({ mode: 'on' })` resolved with `{ remoteSteerable: false, started: false }`: no error, no `url`. `visibility.get` gave `{ synced: false }` (no `status`, no `shareUrl`). No `remote`/`steerable` event arrived. `disable()` resolved.
  - **`git init` folder with no remote:** the same answer.
  - Nothing was published: there was no URL and no GitHub repository.
- **Q1** (partly): `enable` does not fail without `enableRemoteSessions`, but it did not start either; whether it starts in a GitHub repository folder without that option is still open.
- **Q2** (partly): a plain folder and a local-only git folder are not enough; Copilot gives no reason, it just answers `started: false`. A folder whose remote is a GitHub repository was not tried: that needs a throw-away GitHub repository, which is the owner's call.
- Q3 (`url` vs `shareUrl`), Q4 (plan), FR-003 (does the GitHub task outlive the session) and steering from github.com stay open.
- **FR-002 delta** `[IMPLEMENTED]` Before this, the adapter mapped that answer to `{ ok: true, on: true, steerable: false }`, so Durbar would show remote control as on with no link. Now `started: false` turns remote control off again (`disable()`, best effort) and returns `ok: false` with "Copilot did not start remote control for this session and gave no reason. It may need a folder that is a GitHub repository." (`REMOTE_NOT_STARTED`). `test:` `test:remote` (`started: false` is not on, `disable` is called, no visibility read; `started: true` is on).

### 2026-10-20: Phase 2: Claude Code Remote Control (owner, #298 Q2) and the Copilot finding (Q1)

Owner answers on #298: Q1 test Copilot remote in a private repository; **Q2 "this idea is not about Telegram, it is Claude Remote Control"** (code.claude.com/docs/en/remote-control); Q3 Codex: explain only.

- `real:` 2026-10-20, Copilot runtime 1.0.98, Copilot **Free**, a private GitHub repository clone (`vikramgorla/durbar-remote-test`, to be deleted by the owner), 1 prompt, 0.16 AI credits: `remote.enable` answered `{started: false, remoteSteerable: false}`, the same as in a plain folder and a `git init` folder. So it is **not tied to the repository**; most likely remote needs a paid plan (unverified). Durbar's message blamed the folder: corrected in FR-063.
- `real:` 2026-10-20, Claude Code 2.1.304 over `stream-json` (Durbar's transport): the control request `{subtype: "remote_control", enabled: true}` answered `{session_url: "https://claude.ai/code/session_…", connect_url, bridge_session_id, environment_id}` and a `system/bridge_state` event followed; `enabled: false` answered success. The docs list only interactive, server, Desktop and VS Code modes, but the stream protocol supports it. Remote Control needs a claude.ai sign-in on Pro, Max, Team or Enterprise (API keys are not supported, per the docs).

- **FR-060** `AdapterCapabilities.remoteService?: { name, host, mobile }` names the service a session is controlled from: Copilot `{GitHub, github.com, GitHub Mobile}`, Claude `{Claude, claude.ai, the Claude app}`. `allowedRemoteUrl(url, host)` accepts only https links on that service's host (no user, password or port); main checks the adapter's host, and the window's texts use the name (no agent-app name in the renderer, constitution II).
- **FR-061** `ClaudeAdapter.setRemote(id, on)` sends `remote_control` over the running CLI (`capabilities.remote: true`); the answer's `session_url` is the link when it is on claude.ai. Off sends `enabled: false`. The existing rules hold: only while the session runs, never in Allow all, and only after main's own confirmation (FR-011).
- **FR-062** A Claude relaunch (a new mode, model or MCP set, which restarts the CLI process) turns Remote Control **back on** right after the new process starts, so a switch does not silently drop it. If that fails, the adapter emits the new normalized event `{type: "remote", on: false, reason}`; main forgets the state and tells the window, and the window shows the reason as a note (the same path as spec 012 FR-158).
- **FR-063** Copilot's "not started" message no longer blames the folder: "Copilot did not start remote control and gave no reason. On a Copilot Free account it never started in our checks, in any folder; it may need a paid plan."
- **FR-064** Codex (Q3): the README says Codex's own mobile access works through ChatGPT on a connected desktop or SSH host, and that Durbar's own per-session app-server did not show up there in one test (2026-10-24, see the dated result below), so Durbar offers none.


### 2026-10-20: Copilot remote control on Copilot Pro

- `real:` 2026-10-20, Copilot **Pro**, `scripts/remote-copilot-real.ts`, 2 tiny `auto` prompts, **0.13 AIU**. Remote control **started** both in a plain folder and in a `git init` folder with no remote:
  - `remote.enable` answered `started: true`, `remoteSteerable: true`, with a github.com link;
  - `setRemote(true)` gave `{ ok, on, steerable, url, visibility: 'unshared' }`, with one `session.remote_steerable_changed` event;
  - `setRemote(false)` turned it off.

  Together with the Copilot Free runs (never started, also in a private GitHub repository), this settles it: Copilot remote control **needs a paid plan**. FR-063's message now says so. What GitHub's web page and GitHub Mobile show for such a session was not opened (`[KNOWN GAP]`).

### 2026-10-21: owner's real Copilot remote session; channels wizard moved out (#298, #485)

- `real:` 2026-10-21, owner (Vikram): "I did a real remote Copilot session today, it works perfectly" (Copilot Pro; on Copilot Free remote does not start, as recorded 2026-10-20). The owner did not say whether github.com or GitHub Mobile was used, or what happened to the GitHub task after End session. This closes T020 by the owner's use; the Pro run of 2026-10-20 already answered Q1-Q4. `[KNOWN GAP]` kept: FR-003 (whether the GitHub task stays after End session) and the `remote_steerable_changed` event while steering from github.com were not recorded separately.
- Claude Code channels (Telegram, Discord, iMessage) and the wizard (FR-020..FR-026, T030-T035) are **out of scope**: owner decision 2026-10-21, "For Claude, no need to support Telegram — rethink non-native channels later; keep it as a future idea". Moved to idea issue #485. Claude Remote Control (Phase 2, FR-060..FR-064) stays built.
- Codex in the ChatGPT mobile app (T040/T041) is documented for connected desktop/SSH hosts, but Durbar's per-session app-server is not integrated; the research disposition and live-test gap are recorded below.

### 2026-10-24: Codex mobile host integration research (#490)

- `read:` OpenAI's [Remote connections documentation](https://learn.chatgpt.com/docs/remote-connections) says ChatGPT mobile can continue Codex chats on a connected Mac/Windows desktop; SSH-host projects are started and managed through the desktop app's remote-host connection. The mobile device is paired from that app with a QR code; the account/workspace needs Codex access. Mobile can send follow-ups, approve actions and review outputs. The docs do not list supported plan tiers.
- `read:` OpenAI Codex [`app-server-daemon` README](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/app-server-daemon/README.md) describes `codex app-server daemon bootstrap --remote-control`, `enable-remote-control`, and `codex remote-control start` for a managed daemon. These configure host/daemon remote access, not a `setRemote(threadId)` method for a separately launched stdio child.
- `read:` OpenAI Codex issue [#31991](https://github.com/openai/codex/issues/31991) reports a working same-daemon desktop/mobile SSH-proxy topology, but also describes reliance on an undocumented desktop environment variable; treat it as an individual report, not a supported Durbar integration.
- `read:` Durbar's Codex adapter launches an app-server child per session over stdio (`src/adapters/codex.ts:346`). **Recommendation:** do not add Codex to the existing per-session `remote` capability based on these daemon-level controls. A future integration needs a separate design for the managed host/app-server lifecycle, session ownership and permission boundary.
- `real:` 2026-10-24, Codex CLI 0.164.0: one read-only prompt was sent through `CodexAdapter`'s per-session stdio app-server in an empty temporary folder; it returned `DURBAR-MOBILE-CHECK`. The owner confirmed ChatGPT mobile was already paired but could not see the conversation. The local managed daemon was running at 0.164.0, while the ChatGPT/Codex desktop UI was not running; remote-control settings were not changed or verified. One prompt used; usage was not measured. No second prompt was sent. Approval of this paid prompt: issue #490 (opened 2026-10-21) says T040 "needs the owner's go-ahead for a real run"; the issue is assigned to the owner (vikramgorla), who took part in the check (he confirmed the mobile app state). No written OK for this prompt is recorded in the issue, the PR or the repo. This shows the tested Durbar session was not surfaced in that setup, but it does not test an active desktop-UI host connection. T040's research and this bounded check are complete; T041's disposition remains to defer integration pending a separately scoped design/owner decision.
