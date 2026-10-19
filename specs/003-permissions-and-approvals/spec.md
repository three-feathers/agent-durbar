# Feature Specification: Permission modes, approvals and session grants

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
- **FR-011** `[KNOWN GAP]` **Reads are never gated**: `read` requests are approved in every mode, for any path (the broker does not check the path is inside the folder). Whether the Copilot runtime itself limits reads to the workspace is **not verified**. (Task T021.)
- **FR-012** `[KNOWN GAP]` **Persisted Allow-all**: the saved folder list stores `permMode: 'allow'` and restores it on next launch without asking again (`restoreFolders`). The opt-in is not re-confirmed after a restart. (Task T022.)
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
- `[KNOWN GAP]` (task T028; test: permissions shows it) Known limit, unchanged: grant keys are compared exactly, so on Windows `C:\Repo` and `c:\repo` are different keys. The effect is conservative (the user is asked again, nothing extra is approved). Case-folding grant keys is not part of this change.
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
- `[KNOWN GAP]` (spec 012 T043, T045, T068): nothing calls these mappers yet. There is no Claude or Codex adapter on `main`, so none of this has run against a real Claude Agent SDK or `codex app-server`; the option and protocol names are from the vendors' documentation. Only Copilot runs today.

### 2026-10-19: Windows grant keys and request ids (sweep; tasks T026, T028)

- **FR-088** `[IMPLEMENTED]` (closes the FR-032 known gap, T028) With the Windows path flavor, a grant's folder key ignores case and treats `/` and `\` alike (`C:/Repo/src` and `c:\repo\src` are one folder, key `write:c:\repo\src`); the label keeps the spelling. POSIX keys stay case-sensitive. FR-032's example keys are now lower case. `test:` `test:permissions` (a grant for `C:\repo\src` covers `c:\REPO\SRC\d.ts`).
- **FR-089** `[IMPLEMENTED]` (T026) A request without a `toolCallId` gets the id `<kind>-<time>-<n>` with a counter per broker, so two requests in the same millisecond never share an id (before, the second replaced the first in the pending list). `test:` `test:permissions`.

