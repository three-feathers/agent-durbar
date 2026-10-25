# Feature Specification: Permission modes, approvals and session grants

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Permission modes, approvals, session grants
status: implemented; delta 2026-10-19: Windows grant keys, request ids (FR-088, FR-089); delta 2026-10-21: each session comes back in its own last mode, visibly (FR-090..FR-093); delta 2026-10-23: a Read-only refusal opens the mode menu (FR-094..FR-098); delta 2026-10-25: a "why was this allowed?" tag on tool cards, with undo of Durbar's own rule (FR-099..FR-107)
-->

**Feature Branch**: `003-permissions-and-approvals` (reverse-engineered; milestones 1, 3, 5)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/adapters/permissions.ts`, `copilot.ts`, `main.ts`, `app.js`, README)
**Input**: "Agents run on my machine as me. I choose what they may do, per agent, and I can approve or deny each request. Safe by default."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Safe by default (read-only) (Priority: P1)

A new folder starts in **Read-only**: the agent may read, but any write, shell command, URL fetch, MCP or custom tool is denied, the agent is told why,
and I see a note in the timeline.

**Independent Test**: `npm run test:permissions` (policy) and the simulator; on a real session in milestone 3 (`real:`).

**Acceptance Scenarios**:

1. **Given** a folder added with the default mode, **When** the agent requests a write, **Then** the request is rejected with the feedback "Agent Durbar is in read-only mode: this action was denied. Do not retry it.", a `needs-permission` status with "Denied (read-only mode): ..." and a timeline note appear. *(test: + real:)*
2. **Given** a read request, **When** received in any mode, **Then** it is approved without a card. *(test:)*

---

### User Story 2 - Ask first (Priority: P1)

In **Ask** mode every non-read request waits for me: the card turns to "Waiting for you", the chat shows the request inline with **Approve**, **Approve for this session**, **Deny**.

**Acceptance Scenarios**:

1. **Given** Ask mode, **When** a write is requested, **Then** a pending request appears with three buttons and the agent shows `waiting`. *(test: broker; real: milestone 3)*
2. **Given** I press Approve, **When** resolved, **Then** the edit is applied once and the next request asks again. *(test: + real:)*
3. **Given** I press Deny, **When** resolved, **Then** the tool fails with "Denied by user in Agent Durbar." and nothing is remembered. *(test: + real:)*

---

### User Story 3 - Approve for this session (Priority: P2)

I can allow a narrow scope until I stop the session; it shows as a revocable chip and later matching requests are approved automatically and labelled as such.

**Acceptance Scenarios**:

1. **Given** "Approve for this session" on a write in `src/`, **When** another write in `src/` arrives, **Then** it is auto-approved ("approved (allowed for this session)") and the chip `Allowed: write in src/` shows. *(test: broker; real: one Approve covered two edits, README m5)*
2. **Given** a chip, **When** I click its x, **Then** the grant is removed and the next matching request asks. *(test: broker)*
3. **Given** a write in a *different* folder, **When** requested, **Then** it asks. *(test:)*

---

### User Story 4 - Stop and End are clean (Priority: P2)

**Stop** (interrupt) denies any pending request and returns the agent to Ready, keeping grants. **End session** denies pending requests and clears all grants.

**Acceptance Scenarios**:

1. **Given** a pending request, **When** I press Stop, **Then** the note reads "denied (session stopped)", Approve/Deny disappear, grants stay, and the next message works. *(test: broker; sim: screenshot m5-perm-stopped)*
2. **Given** an ended session, **When** a late request arrives, **Then** it is rejected. *(test:)*

---

### User Story 5 - Allow all, knowingly (Priority: P3)

For folders I trust I can pick the mode that approves everything without prompts.

**Acceptance Scenarios**:

1. **Given** the top-bar mode "Allow all (no prompts)" (internally `allow`; called "Allow edits" before FR-028), **When** a folder is added, **Then** every request is approved with no card. *(test:)*
2. **Given** the Allow all confirmation is open (chat-header mode menu, add folder or new session), **When** I use only the keyboard, **Then** focus is inside the dialog, Tab stays inside it, Escape cancels (mode unchanged) and focus returns to the control I came from. Only an explicit activation of *Allow all* confirms. *(test: dialog; sim: check:dialog-focus; FR-033)*

---

### Edge Cases

- A command with pipes, `&&`, redirects, substitutions or newlines is only remembered for that **exact** command text. `[IMPLEMENTED]` test:
- A deny with "remember" never remembers. `[IMPLEMENTED]` test:
- Resolving an unknown request id is a no-op. `[IMPLEMENTED]` test:
- Stop arrives while several requests are pending: all are denied, each with `via: stopped`. `[IMPLEMENTED]` test:
- The runtime starts a tool call *before* asking permission, so the timeline shows the tool chip, then the permission note. `[IMPLEMENTED]` real: (README m5)
- A request without `toolCallId` gets id `<kind>-<ms>`; two such requests in the same millisecond would collide. `[KNOWN GAP]` read:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` test: Three modes per agent: `read-only` (default), `ask`, `allow`. Invalid/missing values fall back to `read-only` in the main process (`validMode`).
- **FR-002** `[IMPLEMENTED]` test: Requests of kind `read` are always approved; `allow` approves everything; otherwise `read-only` denies and `ask` waits.
- **FR-003** `[IMPLEMENTED]` test: Grant scope: write -> the file's folder; shell -> the command name for simple commands, the exact text for compound ones; url -> host; mcp/custom-tool -> tool name; other -> the kind.
- **FR-004** `[IMPLEMENTED]` test: Grants are per session, shown as chips with a revoke control, cleared on End session, kept on Stop.
- **FR-005** `[IMPLEMENTED]` test: `interrupt` denies pending requests (`via: stopped`) and keeps grants; `stop` denies pending, clears grants and rejects later requests.
- **FR-006** `[IMPLEMENTED]` sim: The permission note renders inline in the tool timeline in the order things happened; states: pending (buttons), approved, denied, "(denied: read-only mode; add the folder in Ask mode to allow edits)", "(allowed for this session)", "(session stopped)", "(and remembered for this session)".
- **FR-007** `[IMPLEMENTED]` real: The agent card goes to `waiting` ("Waiting for you") while a request is pending and returns to `working` after the answer.
- **FR-008** `[IMPLEMENTED]` read: Permission answers cross IPC as `(agentId, requestId, approve, remember)`; the main process ignores unknown agent ids and only honors `remember` when approving.
- **FR-009** `[IMPLEMENTED]` test: Summaries shown to the user: `write <file>`, `run <command>`, `read <path>`, `fetch <url>`, `mcp|custom-tool <name>`.
- **FR-010** `[IMPLEMENTED]` (third delta, FR-028..FR-030) ~~**Naming**: the top-bar and new-session dialog call the `allow` mode **"Allow edits"** while it approves *everything* (shell, URLs, MCP, custom tools). README calls it "Allow all". Constitution III requires it be named honestly.~~ Now "Allow all". (Task T020.)
- **FR-011** ~~`[KNOWN GAP]`~~ superseded by FR-023 (reads outside the session roots are gated): **Reads are never gated**: `read` requests are approved in every mode, for any path (the broker does not check the path is inside the folder). Whether the Copilot runtime itself limits reads to the workspace is **not verified**. (Task T021.)
- **FR-012** ~~`[KNOWN GAP]`~~ superseded by FR-025/FR-026 (restored Allow all is visible, with an "Ask me first" banner): **Persisted Allow-all**: the saved folder list stores `permMode: 'allow'` and restores it on next launch without asking again (`restoreFolders`). The opt-in is not re-confirmed after a restart. (Task T022.)
- **FR-013** `[KNOWN GAP]` "Approve for this session" for a simple shell command approves **any arguments** of that command name (e.g. `git` covers `git push`); for writes it covers every file in that folder. This is documented as conservative but not configurable (README m5 "Remaining"). (Task T023.)
- **FR-014** `[IMPLEMENTED]` (spec 018, T024) ~~A folder's mode cannot be changed after it is added (a new session in the same folder may pick another mode; that choice is not saved, only adding the folder again updates the saved mode). There is no per-agent mode switch in the chat. `read:` (Task T024.)
- **FR-015** `[KNOWN GAP]` The broker runs against the SDK's permission *callback* only; behavior for permission kinds added by newer SDKs falls to the default branch (kind used as scope; denied in read-only, asked in ask). Not tested with real new kinds. `read:`
- **FR-016** `[IMPLEMENTED]` (2026-10-17 delta, FR-031/FR-032; test: permissions) ~~Windows path scope: `grantScope` uses the host platform's `path.dirname`; only POSIX paths are unit-tested.~~ Now takes an injectable path flavor; Windows paths are unit-tested. (Task T025.)

### Key Entities

- **PermissionInfo**: `requestId`, `kind`, `summary`, `state` (`pending|approved|denied`), `scopeKey`, `scopeLabel`, `via` (`user|session|stopped`), `remembered`.
- **SessionGrant**: `key`, `kind`, `label`.
- **PermMode**: `read-only | ask | allow`.

## Success Criteria *(mandatory)*

- **SC-001**: In read-only mode no write/shell/url/mcp/custom request is approved (test:).
- **SC-002**: Every pending request is resolved (never left hanging) when the turn is stopped or the session ends (test:).
- **SC-003**: Recorded real-session cost of the verifying runs: 4 prompts = 0.416 AIU (m3), 1 prompt = 0.189 AIU (m5), as reported by the API.

## Assumptions

- The SDK calls `onPermissionRequest` for every action that needs a decision, and honors `approve-once` / `reject` with feedback.
- The user reads a command before approving it (the summary shows the full command text).

## Changes

### 2026-10-16: permission gaps from the Spec Kit audit (closes FR-011, FR-012, FR-013; T021, T022, T023)

**Decisions (the maintainer's brief; conservative defaults, documented).**

- **FR-021 (was FR-012) ~~Allow edits is never restored silently.~~ SUPERSEDED 2026-10-16 (second delta below, FR-025).** Kept for history: it restored a saved `allow` as Ask first.
- **FR-022 (was FR-013) Shell grants are exact by default.** "Approve for this session" on a shell request remembers **that exact command text** (label `run <command>`). When the command is a simple one (no pipes, `;`, `&&`, redirects, substitutions, newlines) and its name is a plain word that is not a shell, interpreter or privilege tool (`sh bash zsh fish dash pwsh powershell cmd node deno bun python python3 ruby perl php sudo su doas env xargs eval exec find`), the card also offers **Approve for session: any arguments of `<name>`**; only that explicit choice creates the broad grant `shell:<name>`. A broad grant never matches a command that contains shell metacharacters. Write grants are unchanged (folder of the file).
- **FR-023 (was FR-011) Reads outside the session's roots are not free.** The SDK `read` request exposes `path` (verified in `PermissionRequestRead`, SDK 1.0.22). Roots = the session cwd plus every folder of the `.code-workspace`, plus files the user attached in this session. A read is **inside** when its resolved real path is within a root (symlinks resolved, `..` collapsed, case-insensitive on Windows). Policy: **Allow edits**: approve (the user opted into everything); **Ask first**: ask, with a session-grant scope per parent folder; **Read-only**: deny with feedback "this path is outside the session's folders". A `read` request without a path counts as outside. `[UNVERIFIED]` on a real session: whether the runtime already limits reads itself and whether it sends `read` requests for its own files (skills, `~/.copilot`); if it does, those would be asked/denied in the two stricter modes. Feature 013 records the real check.
- **FR-024** Tests: `scripts/test-permissions.ts` covers all three (exact shell grant, explicit any-arguments grant, no match for pipes, interpreter denylist, inside/outside/symlink/`..`/missing path reads in each mode, attachments), `scripts/test-folders.ts` the restore mapping.

### 2026-10-16 (second delta): restore the chosen mode exactly (reverses FR-021; Vikram's decision)

- **FR-025** `[IMPLEMENTED]` (test: folders) **The saved mode is restored exactly, per folder/workspace.** `read-only`, `ask` and `allow` are all written to the saved list (on add, on new session in the folder, on a mode switch from the chat header) and restored as saved after a restart. There is **no silent downgrade** of Allow edits to Ask first. A folder saved as `allow` by an older file is restored as `allow`.
- **FR-026** `[IMPLEMENTED]` (test: folders; sim) **Visible, not silent.** An agent restored in Allow edits carries `AgentInfo.permRestored = true`. The mode chip in the chat header shows a small **restored** note next to "Allow edits" (tooltip: "Restored from your last run. Click to change."); the card's mode icon tooltip says the same. The note goes away as soon as the user switches the mode (the choice is then fresh). One toast at startup says how many folders came back in Allow edits. `permRestored` is never set for `read-only`/`ask` and is never saved.
- **FR-027** `[IMPLEMENTED]` (test: permissions, unchanged) **"Approve for session" grants stay session-only.** Grants (exact shell, any-arguments, write folder, read folder, URL, MCP) live in the broker's memory for the session and are never written to disk; a restart starts with none, whatever the restored mode.
- Unchanged: switching *to* Allow edits from the chat header, the top-bar "add folder" or the new-session dialog still asks for confirmation (FR-021's confirmation part stays). Only the restore path no longer asks or downgrades.
- Tests: `scripts/test-folders.ts` (`restoreMode('allow')` keeps `allow` and flags `restored`; `upsert`/`setPermMode` persist `allow`; round trip through a new `FolderStore`; old file with `allow`).

### 2026-10-16 (third delta): name the `allow` mode honestly (closes FR-010; T020, issue #5)

**What was wrong.** The UI called the `allow` mode **"Allow edits"** while it approves *everything* (writes, shell commands, URLs, MCP and custom tools, reads outside the folder). The README already said "Allow all". Constitution III requires the mode to be named honestly. The add-folder / new-session confirmation also still said "Allow edits is not remembered: after a restart this folder starts in Ask first", which FR-025 made false.

- **FR-028** `[IMPLEMENTED]` (sim) **The `allow` mode is called "Allow all" everywhere in the UI.** The permission selectors (top bar for new agents, new-session dialog) read **"Allow all (no prompts)"**. The chat-header mode chip, its menu, the card mode icon tooltip, confirmation dialogs and their button, toasts and the startup "restored" toast say **"Allow all"**. The agent role text says `no prompts` instead of `can edit`. The help text says that edits, shell commands, web requests and tools all run without asking.
- **FR-029** `[IMPLEMENTED]` (sim) **The chat hint names the mode** with the same display name (`(Allow all)`, `(Ask first)`, `(Read-only)`) instead of the internal value (`(allow)`), and keeps it in sync after a mode switch.
- **FR-030** `[IMPLEMENTED]` (sim) **The confirmation is truthful.** Switching to Allow all (add folder, new session, chat header) says the choice is saved for the folder and comes back after a restart, marked *restored* (FR-025/FR-026).
- The top-bar permission selector is allowed up to 180px wide (`#liveBar #permMode` in `styles.css`) so the longer label is not cut off.
- Unchanged: the internal value stays `allow` (saved folder files, IPC, `DURBAR_PERM=allow`, the broker). No behavior change beyond text. README aligned to "Allow all".
- Acceptance: on the simulator (`DURBAR_SIM=15`), no visible "Allow edits" remains in the top bar, new-session dialog, mode chip/menu, confirmation, toasts or chat hint; the top bar still fits at 1280x800 and 1440x900.

### 2026-10-17: Windows paths in "Approve for this session" scopes (closes FR-016; T025, issue #6)

**What was wrong.** `grantScope` took the folder of a write/read path with the host's `path.dirname` and was only unit-tested with POSIX paths, so its Windows behavior (drive letters, backslashes, UNC shares) was unverified. `isInsideRoots` already had an injectable path flavor; `grantScope` did not.

- **FR-031** `[IMPLEMENTED]` (test: permissions) **`grantScope` takes an optional path flavor** (`Pick<typeof path, 'dirname'>`, default the host `path`). The broker passes the flavor of its path check (`BrokerOptions.pathCheck.flavor`) so scopes and read checks use the same rules. Behavior on the host platform is unchanged.
- **FR-032** `[IMPLEMENTED]` (test: permissions) **Windows paths give the folder, with the platform's separators**: `C:\repo\src\x.ts` → key `write:C:\repo\src`, label `write in repo/src/`; a read of `D:\data\in.csv` → `read:D:\data`; a file at a drive root `C:\x.ts` → `write:C:\`; a UNC path `\\server\share\dir\f.txt` → `write:\\server\share\dir`. Two writes in the same Windows folder share one key; a write in a subfolder does not match the parent's grant.
- ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): (task T028; test: permissions shows it) Known limit, unchanged: grant keys are compared exactly, so on Windows `C:\Repo` and `c:\repo` are different keys. The effect is conservative (the user is asked again, nothing extra is approved). Case-folding grant keys is not part of this change.
- Not verified: a real Copilot session on Windows (what path spelling the runtime sends). CI runs `npm test` on Windows, so the host default is exercised there.

### 2026-10-17 (fifth delta): keyboard focus in the Allow all confirmation (T029, issue #25)

**What was wrong.** In `changeMode` (via the mode menu's click handler) the code called `anchor.focus()` right after the confirmation dialog opened, so keyboard focus went back to the mode chip *behind* the dialog. Escape was only handled on the dialog element, so it did nothing from there; Tab walked out into the page behind the modal. Reproduced on the simulator with real key events before the fix (focus after opening was `modeChip`, not the dialog).

- **FR-033** `[IMPLEMENTED]` (test: dialog; sim: `npm run check:dialog-focus`) **The confirmation dialog is keyboard-correct.** While it is open, focus is inside it and cannot leave it (Tab and Shift+Tab wrap between its controls; a stray `focus()` on a control behind it is pulled back). **Escape closes it as a cancel**: no mode change, nothing confirmed. When it closes (Cancel, Escape, backdrop click or confirm) focus returns to the control that opened it (the mode chip, or the card for the right-click menu); after a confirmed change the chip is re-rendered and focus goes to the new chip. It applies to every use of the shared dialog (mode switch, "keep or clear grants", add folder in Allow all).
- **Not weakened:** *Allow all* still needs an explicit activation of its button. Escape, Cancel, a backdrop click and the focus handling never confirm; opening the dialog does not change the mode. The primary (focused) button is still *Allow all*, as before (unchanged; see Not verified).
- Not verified: a real screen reader (the dialog keeps `role="alertdialog"`, `aria-modal`, label and description); macOS and Windows keyboards (checked on Linux/Electron under xvfb with real key events, and in jsdom).

### 2026-10-18: the three modes per agent kind (cross-reference to spec 012; T028, issue #47)

The mode names stay **Read-only / Ask first / Allow all** (internal `read-only` / `ask` / `allow`) for every agent kind; the UI never shows a vendor's own mode name. Spec 012 maps them to each vendor's controls in pure modules. Copilot is unchanged (this spec's broker, FR-023 roots check, FR-025 restore).

- **Claude Code** (spec 012 FR-069 to FR-071, `read:` `src/adapters/claudeModes.ts`; test: `scripts/test-claude-modes.ts`): Read-only → `permissionMode: 'dontAsk'`, only the read tools in `allowedTools`, and a `PreToolUse` hook that denies any read outside the session roots and everything that is not a read (MCP tools included); Ask first → `permissionMode: 'default'` with every tool going through `canUseTool` (reads outside the roots ask); Allow all → `permissionMode: 'bypassPermissions'`. No Claude settings files are loaded (`settingSources: []`, `strictMcpConfig: true`; spec 012 FR-025/T027), so no user or project allow rule can approve a tool before Durbar does.
- **Codex CLI** (spec 012 FR-072 to FR-074, `read:` `src/adapters/codexModes.ts`; test: `scripts/test-codex-modes.ts`): Read-only → approval policy `never` with the `durbar_ro` permission profile; Ask first → `on-request` with `durbar_ro` (spec 012 T084, FR-086; before that, the `read-only` sandbox); Allow all → `never` with `danger-full-access`. In Read-only every approval request is answered `decline`. **Codex Read-only differs in kind** (spec 012 C6, T084): an OS-enforced permission profile in which shell commands that only read may run; reads are limited to the session folders plus Codex's `:minimal` system files (FR-023 kept at the sandbox level, not per request), a read outside them is denied even in Ask first (stricter than FR-023), and Read-only and Ask first are refused where the profile cannot be enforced (spec 012 FR-087). `[KNOWN GAP]` (spec 012 plan.md): that Ask first in a read-only sandbox asks before file edits is unverified.
- **Unknown or missing mode = Read-only** in both mappers (tested), as for Copilot.
- ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): (spec 012 T043, T045, T068): nothing calls these mappers yet. There is no Claude or Codex adapter on `main`, so none of this has run against a real Claude Agent SDK or `codex app-server`; the option and protocol names are from the vendors' documentation. Only Copilot runs today.

### 2026-10-19: Windows grant keys and request ids (sweep; tasks T026, T028)

- **FR-088** `[IMPLEMENTED]` (closes the FR-032 known gap, T028) With the Windows path flavor, a grant's folder key ignores case and treats `/` and `\` alike (`C:/Repo/src` and `c:\repo\src` are one folder, key `write:c:\repo\src`); the label keeps the spelling. POSIX keys stay case-sensitive. FR-032's example keys are now lower case. `test:` `test:permissions` (a grant for `C:\repo\src` covers `c:\REPO\SRC\d.ts`).
- **FR-089** `[IMPLEMENTED]` (T026) A request without a `toolCallId` gets the id `<kind>-<time>-<n>` with a counter per broker, so two requests in the same millisecond never share an id (before, the second replaced the first in the pending list). `test:` `test:permissions`.


### 2026-10-20: MCP tools in Read-only on a real Copilot session (cross-reference to spec 044)

- `real:` 2026-10-20 (details and cost in spec 044 `## Changes`): in Read-only, a Copilot MCP tool whose server marks it `readOnlyHint: true` runs **without any permission request reaching the broker**; the same tool without the hint arrives as kind `mcp` and the broker denies it. So "Read-only denies MCP" holds only for tools the server does not mark read-only.
- `[KNOWN GAP]` The runtime trusts the server's own hint: a server that marks a writing tool read-only runs it in Read-only, and Durbar never sees the call as a permission request (it still shows in the chat as a tool call). Not checked on Claude Code or Codex.

### 2026-10-21: known gaps revalidated

- **FR-011, FR-012** were superseded by FR-023 and FR-025/FR-026; the tags are struck.
- **Windows grant keys (T028)** closed. `grantScope` folds case on Windows (`write:c:\repo\src`), and `test:` `scripts/test-permissions.ts` asserts that `C:\Repo` and `c:\repo` give one key ("T028: case does not make another key on Windows").
- **Mappers not called (spec 012 T043/T045/T068)** closed. `real:` 2026-10-21, Linux, through Durbar's own adapters:
  - Codex **Read-only** read a file inside the session folder, could not read one in another folder (answered BLOCKED) and could not write;
  - Codex **Ask first** raised a pending `shell` permission with the exact command and a scope label, and the user's Deny was honoured (no file written);
  - Claude Code (haiku) **Read-only**: inside read, outside blocked, write blocked.

  Cost: Claude about $0.008; Codex on the owner's ChatGPT plan, about 60k input tokens.
- **FR-013** narrowed, still open. Code and privilege commands are never offered an "any arguments" grant (FR-022). For other commands the broad scope still covers every argument (for example `git` covers `git push`), and only the user can pick it, never by default.
- **FR-015** still open: no newer SDK permission kind has been seen for real.

### 2026-10-21 (second): each session comes back in its own mode, and says so (owner's report; T030)

**What was wrong (a bug, not a safety rule).** The owner (Vikram, 2026-10-21): "When I went back to a session which I had set to Allow all before, it went back to Read-only without me knowing." FR-025 restores the saved mode exactly and nothing in this spec or spec 006 narrows Allow all on purpose; the reset came from *where* the mode was kept. `read:` `src/main/folders.ts` kept **one** `permMode` per folder; `agents:setMode` (`setModeOp`) overwrote it from whichever session changed mode last. Since spec 006 FR-021 and spec 052 FR-088 several sessions of one folder come back after a restart, and `restoreFolders` gave all of them the folder's mode; `sessions:resume` started a session from *Previous sessions* in the mode of the session the list was opened from (`a.permMode`). So session A set to Allow all came back in Read-only when another session of the folder was switched to Read-only later, or when A was resumed from a Read-only session. `permRestored` was set only for Allow all, so a session that came back *narrower* showed nothing. `read:` the simulator copied the same rule (its `resumeSession` gave the resumed session the opener's `info`), so Ada (Read-only) resuming an earlier session got Read-only with no note.

- **FR-090** `[IMPLEMENTED]` (test: folders, agentops) **The mode is remembered per session.** The folder file keeps `sessionModes: [{ id, mode }]` (the newest 50 per folder; ids and modes only; malformed entries dropped; an older file without it reads back unchanged). It is written when a mode is switched (`setModeOp`, under the session's resume id: Codex's thread id) and when a session gets a message (`noteLastSession`, its current mode). The folder's own `permMode` is still written on every switch and stays the default for new sessions and for sessions with nothing remembered.
- **FR-091** `[IMPLEMENTED]` (test: folders, agentops; sim) **A session comes back in its own last mode.** After a restart each restored session uses its remembered mode, else the folder's (`modeForSession`); a session resumed from Previous sessions uses its remembered mode, else the mode of the session the list was opened from (`resumeModeOp`). Allow all comes back as Allow all with the *restored* chip (FR-026), now also on resume; the confirmation is only asked when the user switches *to* Allow all, as before (FR-025).
- **FR-092** `[IMPLEMENTED]` (sim) **Never silent.** A session that came back carries `AgentInfo.permFrom` (`session` / `folder` / `opener`; never saved, cleared by a mode switch) and its chat shows one note: "Permissions: **<mode>**, the mode you last chose for this session." / "…, this folder's saved mode (no mode was remembered for this session)." / "…, the same as the session you opened it from (no mode was remembered for this session)."; on resume, when the opener's mode differs, "The session you opened it from is in <mode>." The restored chip's tooltip says "Restored: the mode you last chose for this session."
- **FR-093** `[IMPLEMENTED]` (test: agentops) **Logged.** A resumed session whose mode differs from its opener's writes one activity-log row (`mode-change`): "Resumed in <mode>, the mode last chosen for this session (opened from a session in <mode>)". A restart keeps its existing startup toast for Allow all and adds no rows.
- Not changed: grants stay session-only (FR-027); switching to Allow all still asks for confirmation; Allow all and remote control still never run together (spec 054 FR-011; a resumed session starts without remote control).
- Checks: `scripts/test-folders.ts` (parse, cap 50, the owner's case A=Allow all / B=Read-only after a restart, older file), `scripts/test-agentops.ts` (`setModeOp` writes the session mode under the resume id; `resumeModeOp` cases and log line), `scripts/shots-003-mode-back.js` in `check:ui` (simulator, 1440x900 and 1280x800: resume of an Allow all session from a Read-only one, a session with nothing remembered, the restart note). Screenshots `docs/screenshots/003-mode-back-*.png`.
- `[KNOWN GAP]` Not run on a real Copilot, Claude Code or Codex session (no credits spent); the restore path only passes the mode to the adapter's start options, which spec 012 already checked per vendor. Sessions from before this change have no remembered mode and come back as before (folder or opener mode), now with the note saying so.

### 2026-10-23: a Read-only refusal opens the mode menu (owner request; T031, issue #618)

**Why.** The owner (Vikram, 2026-10-23): "When an action is stopped because of read only mode, when we suggest to move to ask first - make that message clickable and show mode change options". `read:` before this change a Read-only denial in the chat said "(denied: this agent is in Read-only. Switch it to Ask first to be asked instead)" as plain text, and spec 052 FR-074 added one button **Switch this agent to Ask first** (once per agent until its mode changed) that switched straight to Ask first, without showing the other modes. This spec owns it because the refusal is the outcome of the permission check (FR-001, FR-006); the menu itself is spec 018's and stays unchanged apart from a "modes only" option. This delta supersedes the button wording and the once-per-agent rule of spec 052 FR-074.

**Where a Read-only refusal is shown (reviewed for this delta).**

| Place | Suggests Ask first? | After this delta |
|---|---|---|
| Chat: the denied request's note (`showPerm`, a real adapter's `needs-permission` status with a denied permission) and a request settled as denied by the mode (`settlePerm`, the simulator's `permission` event) | yes, in text | the button below (FR-094) |
| Needs you: the agent's row while the denial is its pending card | the copied button | opens the same menu (FR-097) |
| Codex refusing Read-only / Ask first at send (spec 012 FR-087, `modeRefusalAction`) | no (on purpose) | unchanged: its **Change mode…** button already opens the same menu |
| Desk bubble / list row (`taskText`: Simple "Read-only stopped it: wanted to …", Expert "Denied (read-only mode): …") | no | unchanged (the desk opens the chat, where the button is) |
| Activity log (Tools > Activity, decision *Denied*) | no | unchanged (a record) |
| Remote control / Telegram (spec 054, spec 041) | no | unchanged, text only; the agent itself is told "Agent Durbar is in read-only mode: this action was denied. Do not retry it." (`permissions.ts`) |

- **FR-094** `[IMPLEMENTED]` (sim: `check-ro-ask`) **The suggestion is a button.** When the agent can switch modes (`setPermMode`, the `modes` feature), a Read-only denial reads "(denied: this agent is in Read-only)" and offers one button **Switch to Ask first…** (`data-act="ro-ask"`, `aria-haspopup="menu"`, `aria-expanded`, the theme's `.btn`, 10.5px floor) under it. There is one such button per agent, on its newest denial: a newer denial moves it there (no pile of buttons when an agent tries five writes). An agent that cannot switch modes keeps the plain-text suggestion.
- **FR-095** `[IMPLEMENTED]` (sim: `check-ro-ask`) **It opens the usual mode menu.** The button opens `openModeMenu` (the composer mode chip's menu, also opened by spec 012's **Change mode…**) anchored to the button, with the modes only: Read-only, Ask first and Allow all (as the agent kind offers them), each with its help line, the current one ticked (`aria-checked`), focus on it. Choosing a mode goes through `changeMode`, so Allow all keeps its confirmation (FR-014) and the grants question stays. The switch is for that agent only (`setPermMode(a.id)`); the menu's `aria-label` names it ("Permission mode for <name>"). Enter or Space opens it; arrows move; Escape or Tab closes it and focus returns to the button. A click on the button while the menu is open closes it.
- **FR-096** `[IMPLEMENTED]` (sim: `check-ro-ask`) **After a switch: say what to do, never resend.** The usual toast ("<name>: **Ask first** from the next request.") appears; the button is replaced by one line: "Now in Ask first. Ask <name> to try again: it will wait for your OK." (Allow all: "…: it will run without asking."), and focus moves to the message box; the line also goes to the polite live region (`announce`), so a screen reader hears it. No **Retry**: a denied tool call has no safe retry path (the agent was told not to retry it, and resending the prompt could repeat what already ran), so nothing is resent automatically. A mode changed another way (the chip) removes the button without that line. Choosing Read-only again, or cancelling the Allow all confirmation, changes nothing and keeps the button.
- **FR-097** `[IMPLEMENTED]` (sim: `check-ro-ask` step 6, a synthetic `needs-permission` denial) **Needs you.** When the denial is the agent's pending card (a real adapter's `needs-permission` status puts it in *waiting*), its row offers **Switch to Ask first…** too (`aria-haspopup="menu"`); it closes the inbox, opens the chat and opens the same menu on the chat's button, so focus returns there.
- **FR-098** (hook only) **A managed policy can lock the mode** (spec 076, not built). `roAskHint` carries a comment where such a lock would show the plain text instead of the button; nothing else is done now.
- Not changed: what Read-only denies (FR-001), the denial text the agent receives, the Codex send refusal (spec 012 FR-087), Allow all's confirmation, remote and Telegram text.
- `[KNOWN GAP]` Not run on a real Copilot, Claude Code or Codex session (no credits spent): the real adapters' denial reaches the same `showPerm` path the driver checks with a synthetic `needs-permission` event; the simulator's own denial goes through `settlePerm`. FR-097 (Needs you) is checked in the simulator with a synthetic `needs-permission` event (`sim:`), not with a real waiting agent.

### 2026-10-25: "Why was this allowed?" on tool cards, with undo of Durbar's own rule (owner go 2026-10-23; T032..T036, issue #605)

**Why.** Some tool calls run without a question (a session grant, Allow all, a read inside the folders, or the agent app's own rule) and the chat gives no hint why. The owner (Vikram, 2026-10-23): on each tool card that ran without asking, show why, with a link to undo the rule where Durbar owns it. `read:` today the broker (`PermissionBroker.request`) already knows the reason (`via: 'session'` and the matching grant, `via: 'policy'` for Allow all, a read it approves silently) but only the settled note says "allowed for this session", and the tool chip says nothing. The sources the issue lists for the agent apps (Claude Code `claude_code.tool_decision` and the auto-mode verdict, Codex `codex.tool_decision`, Copilot approval scopes) are **not read by any Durbar adapter today**, so Durbar cannot honestly name them (`[KNOWN GAP]` below).

- **FR-099** `[IMPLEMENTED]` (test: permissions; sim) **A normalized reason, only from what Durbar knows.** `PermissionInfo.allowedBy` is one of `{ kind: 'session-grant', key, label, keys? }` (a request approved by "Approve for this session" rules: `keys` lists **every** rule that allowed it, since a write in several folders needs one rule per folder; `key` is the first; `label` is the request's scope label), `{ kind: 'allow-all' }` (the mode approved it without asking), `{ kind: 'in-folder' }` (a read that the broker checked to be inside the session's own folders), `{ kind: 'attachment' }` (a read of a file the user attached), or `{ kind: 'app', source }` (reserved for an adapter that really reports the agent app's own decision: `config`, `hook`, `classifier`; **no adapter sets it yet**). The broker sets them where it decides; a request the user answered has no `allowedBy`, because Durbar asked. A read approved without an event gets one quiet event, `via: 'quiet'`: no card, no activity-log row (`decisionOf` returns nothing for it). A read the broker did not check against any folder (no session roots, as with Codex started in Allow all and switched) gets **no** event and no tag: it never says "folder" for a path nobody compared with the folders.
- **FR-100** `[IMPLEMENTED]` (test: permissions; sim) **The tag on the tool card.** A tool chip whose call has a reason (the permission event's `requestId` equals the tool call's `callId`, in either order of arrival) shows a small tag, 11px, after its result: **Allowed: session rule** (**session rules** when several), **Allowed: Allow all**, **Allowed: folder read**, **Allowed: attached file** (`app`: **Allowed: agent app config / hook / classifier**). The open chip adds one sentence ("Allowed because you chose Approve for this session for: <label>.", "Allowed because this agent is in Allow all: it runs without asking. Change the mode with the mode chip under the message box.", "Allowed: this file is inside this agent's folders, and reads there never ask, in every mode.", "Allowed: you attached this file to a message, so the agent may read it.") and, for session rules only, **Undo this rule**. A call that ran without any event from Durbar's broker shows **no tag** (see FR-107). The tag never appears on a call the user approved. The simulator sends the broker's quiet note for its read cards, and the driver checks that a read card is tagged and adds no permission note.
- **FR-101** `[IMPLEMENTED]` (test: permissions; sim) **Undo reuses the existing revoke.** **Undo this rule** calls the same `revokeGrant(agentId, key)` the grant chips use (IPC `agents:revokeGrant` to the adapter's `PermissionBroker.revoke`), once for **each** rule in `allowedBy.keys` that is still live; no parallel channel. It removes rules only: the next matching request asks again, and a second rule of another folder keeps working. The tag then reads **Rule removed** with the sentence "This was allowed by a session rule that you have since removed: Durbar asks again." (no button). "Removed" is said only when none of the rule's keys is live in this window **and** this window saw one live or removed it from the card; a window that reloaded with sessions running knows no rules and shows the plain session-rule tag (with Undo), never "removed" for a rule that may still be approving. A rule revoked elsewhere (the chip's x, Revoke all, End session) updates every tag that named it the same way, from the `grants` event. Allow all, a folder read and an attachment have no rule to remove: no button.
- **FR-102** `[IMPLEMENTED]` (test: permissions, hostile ids, `revokeGrantFor`) **Main validates, the page cannot invent a rule.** `agents:revokeGrant` goes through `revokeGrantFor`: a known agent id (a string) and a string key of 1..512 characters (`cleanGrantKey`); anything else (a number, an object, `__proto__`, an overlong or empty string) is ignored and never reaches the adapter. The broker deletes only a key it holds (`Map.delete`), and a revoke only ever removes a rule: it cannot create one, widen one, or change the mode. The `allowedBy` a page or an event carries is display text: nothing reads it back to grant or approve anything, and a malformed one shows no tag: at run time the window (`whyallowed.js`) fails closed on an unknown kind, a non-string key, label or keys, an empty or over-limit `keys` or a bad `more`; `eventguard` (a test-time check on what adapters and the simulator emit, as for every other event, not wired into the running app) refuses the same shapes in `test:permissions`. **One limit end to end:** `ALLOWED_BY_KEYS_MAX` (50, `src/adapters/types.ts`) is used by the broker, `eventguard` and the window (`KEYS_MAX`, equality tested). A write across more folders lists the first 50 rules and counts the rest in `allowedBy.more`; the card says so, Undo removes the listed rules and **Revoke all** the rest (the full list is not sent; `[KNOWN GAP]` no one-click Undo for more than 50 folders).
- **FR-103** `[IMPLEMENTED]` (test; sim) **Untrusted text.** The grant label comes from the tool's own path, command, host or tool name: it is escaped, cut (`DurbarCutText`, 240 characters, as the grant chips do), and set as text, never HTML; the reason's words come from a fixed table in `whyallowed.js` (a pure module, unit-tested), not from the event.
- **FR-104** `[IMPLEMENTED]` (sim) **Layout.** The tag uses the chip's own row (no new line until the chip is open), text 11px (floor 10.5px), cut with an ellipsis; chips live in the chat, not the office, so the 15-agent office is unchanged; it works in Simple and Expert and with every theme's tokens. The driver checks 1440x900 and 1280x800 in Expert; Simple and the other themes use the same classes and tokens and were not driven.
- **FR-105** `[IMPLEMENTED]` (test: activity) **Nothing else changes.** The activity log (spec 052 FR-071), the settled permission note, the grant chips and the Read-only button (FR-094) are as before; `via: 'quiet'` is not logged.
- **FR-106** `[KNOWN GAP]` **The agent apps' own reasons are not shown.** Claude Code's `tool_decision` (config, hook, user permanent/temporary) and auto-mode classifier verdict, Codex's `tool_decision` and Copilot's approval scopes (once, this location, always) are not read by `src/adapters/*` today; a call the app allowed without asking Durbar (for example a Claude Code `allow` rule in its settings) has no tag instead of a guessed reason. `read:` `claude.ts` receives `can_use_tool` only for requests the CLI could not decide itself. The `app` kind is in the type, the table and the unit test so a later adapter change only has to set it; it is not exercised by a real session.
- **FR-107** `[IMPLEMENTED]` (owner decision, Vikram 2026-10-25 17:00 UTC, on #605) **No "reason unknown" tag, and no "when the rule was given".** #605 asks for "'reason unknown' otherwise". A tag on every call without a broker event would also land on calls the user approved whenever a request id differs from the tool call id (not observed live for Copilot and Codex) or the permission arrives after the card, and would then say something false. Instead a call with nothing to claim shows no tag, and the README says so. "Yesterday" is out of scope: session rules are per session (FR-004) and carry no time. Both can be added when an adapter reports the app's own decision (FR-106).
- Not changed: what each mode allows (FR-001, FR-002), grants stay per session (FR-004, FR-027), the Approve/Deny note, Allow all's confirmation.
- `[KNOWN GAP]` Not run on a real Copilot, Claude Code or Codex session (no credits spent). That a real adapter's permission `requestId` equals its tool call's `callId` is `read:` for Claude Code (`toolUseId`) and the fake adapter; for Copilot (the SDK's `toolCallId`) and Codex (`itemId`) it is read in the adapter code and not observed live: if they differ the tag simply does not appear.

