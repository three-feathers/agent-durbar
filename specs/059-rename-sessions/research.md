# Research: Rename sessions (spec 059, issue #372)

Read-only research, 2026-10-20. Nothing was renamed, no session was started, no AI credits were spent, and no file of another tool was
read or edited (no `~/.copilot`, `~/.claude`, `~/.codex`). Sources: the installed SDK type files and runtime strings in
`node_modules`, `claude --help` (local CLI 2.1.304), the vendors' public docs, and the public Codex source on GitHub.

## R1. GitHub Copilot (SDK `@github/copilot-sdk` 1.0.22, runtime `@github/copilot-sdk-linux-x64` 1.0.22)

**Decision (changed 2026-10-20, Q2 B):** rename a live session with `session.rpc.name.set({ name })`; a session that is not live through a
prompt-free `resumeSession` + `name.set` + `disconnect()` (R1b); capability `'any'`.

Evidence (`read:` only):

- `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:33231-33246`: `rpc.name` (@experimental) has `get(): Promise<NameGetResult>`,
  `set(params: NameSetRequest): Promise<void>` and `setAuto(...)`. `NameSetRequest` (`rpc.d.ts:18411`): "New session name (1–100
  characters, trimmed of leading/trailing whitespace)". `NameGetResult` (`rpc.d.ts:18372`): "The session name (user-set or
  auto-generated), or null". `NameSetAutoResult` (`rpc.d.ts:18398-18403`): an auto summary is **not** applied when "the session already
  has a user-set name", so a name set through `set` is not overwritten by the runtime's auto naming.
- `dist/generated/rpc.js:2319-2333`: `set` sends JSON-RPC `session.name.set` with `{ ...params, sessionId }` on the connection.
  The SDK exposes it only on a `CopilotSession` object (from `createSession` / `resumeSession`), so Durbar can call it only on a session
  it has open. Whether the runtime would accept `session.name.set` for a session id that is not loaded is **unverified** (Q2 option C).
- `dist/types.d.ts:2655-2668` (`SessionConfig.name`): "Names the session at creation, as `session.name.set` would, and is validated the
  same way: non-empty, no leading or trailing whitespace, at most 100 UTF-16 units, no control characters, and no double quotes. A name
  also makes the session persist from the start". So Copilot refuses `"` (spec Q8).
- The listing fields `name?: string` "Optional human-friendly name set via /rename" (`rpc.d.ts:13928`, local metadata; `rpc.d.ts:22148`,
  remote metadata). The session pruning request has `includeNamed?: boolean` "When true, named sessions (set via /rename) are also
  eligible for pruning" (`rpc.d.ts:25963`): a named session is **kept** by the default cleanup. Side effect worth a line in the README.
- The runtime binary (`prebuilds/linux-x64/runtime.node`) contains `src/runtime/src/slash_command_handlers/rename.rs` and the messages
  "Provide a name with /rename <name>" and "Unable to generate a session name …" (`strings`, read only). So the Copilot CLI's `/rename`
  writes the same name field, and `/rename` **without** a name asks a model to generate one (that would spend credits; Durbar never
  sends `/rename`).
- Event `session.title_changed` (`dist/generated/session-events.d.ts:2025-2053`, ephemeral). Whether `name.set` emits it is
  **unverified**; Durbar updates its own display at once either way.
- Durbar today: `src/adapters/copilot.ts:620-636` reads `rpc.name.get` once as a title fallback; `:473` marks a session titled on
  `session.title_changed`; `src/adapters/history.ts:99` lists a session by `name` before `summary`, so a Copilot-side rename shows in
  Previous sessions without more work.

**Shows in the CLI:** yes by construction (the same field `/rename` writes and the listing reads), `read:` only. **Shows in VS Code:**
**unverified** (whether VS Code's Copilot CLI session list reads this field was not checked).

Alternatives rejected: sending `/rename <name>` as a prompt (it is a slash command of the CLI's interactive UI, not an SDK call; a
missing argument spends credits); editing session files (constitution III).

### R1b. Copilot: a session that is not live (added 2026-10-20)

Vikram's agent asked for it on #372; the owner changed Q2. `read:` only, nothing was run.

- `node_modules/@github/copilot-sdk/dist/client.d.ts:249`: `resumeSession(sessionId, config): Promise<CopilotSession>` opens a stored session
  and sends **no prompt**: a prompt is a separate `session.send`. `ResumeSessionConfig` needs `onPermissionRequest`; the rename path denies
  every request (nothing runs, so none arrives). `session.d.ts:288`: `disconnect()` releases the session and keeps it on disk.
- Durbar already resumes this way when it opens a Previous session (`src/adapters/copilot.ts:455-464`) and disconnects (`:595`).
- So the call is: `resumeSession(id, { onPermissionRequest: deny })` -> `session.rpc.name.set({ name })` -> `disconnect()`. Cost: 0 credits
  expected (no model call). Side effects to say in the README: the session's last-used time and "last client" may change.
- `[KNOWN GAP]` until T050: that a real stored session resumes without a model call, that `name.set` is accepted on it, and that a session
  open in another Copilot client (the CLI, VS Code) is not disturbed. Any error falls back to a Durbar name with the note (FR-010).

**`real:` (Vikram's agent, 2026-10-20, CLI 1.0.98):** `rpc.name.set` works on a live session and after a prompt-free `resumeSession(id)`; `copilot --resume`
lists "the name"; 0 AI credits. The `[KNOWN GAP]` list in R1b narrows to: another client holding the session open, and VS Code.

## R2. OpenAI Codex (app-server, minimum 0.163.0)

**Decision:** `thread/name/set { threadId, name }`; capability `'any'` (open or stored threads).

Evidence (`read:` upstream source, `openai/codex` on GitHub, `main` on 2026-10-20 and tag `rust-v0.163.0`):

- `codex-rs/app-server-protocol/src/protocol/common.rs:617` (main; `:604` at `rust-v0.163.0`): `ThreadSetName => "thread/name/set"`,
  params `v2::ThreadSetNameParams`, response `v2::ThreadSetNameResponse`. Notification `ThreadNameUpdated => "thread/name/updated"`
  (`common.rs:1974`).
- `schema/typescript/v2/ThreadSetNameParams.ts`: `{ threadId: string, name: string }`; `ThreadSetNameResponse.ts`:
  `Record<string, never>`; `ThreadNameUpdatedNotification.ts`: `{ threadId: string, threadName?: string }`.
- `codex-rs/app-server/src/request_processors/thread_processor.rs:1901-1931`: parses the thread id, `normalize_thread_name` (trim;
  **empty is refused**, "thread name must not be empty"; **no length limit**, `codex-rs/core/src/util.rs:90-97`), then
  `thread_manager.update_thread_metadata(thread_id, { name }, include_archived = false)`: it updates the **stored** thread metadata, so the
  thread need not be loaded; an **archived** thread is refused. On success the server sends `thread/name/updated`.
- `thread_processor.rs:5110-5127` (`attach_thread_name`): thread reads attach the stored name; Durbar's listing already prefers it
  (`src/adapters/codexHistory.ts:41`, `cleanSessionTitle(t.name, 120) ?? cleanTitle(t.preview)`).
- The Codex TUI has `/rename` "rename the current thread" (`codex-rs/tui/src/slash_command.rs:102`), the same store.
- Durbar's short-lived app-server helper `probe` (`src/adapters/codex.ts:312`) is how `thread/list` runs today (`codex.ts:355`); the
  same helper fits a rename of a thread that is not open.

**`real:` (Vikram's agent, Codex 0.163.0):** `thread/name/set` works before or after a turn; `codex resume` lists the name, only for a thread that has had a turn.
**Shows in the CLI:** yes (`real:`, with that limit). **Shows in VS Code (Codex extension):** **unverified**. Codex is not installed on
this machine, so nothing was run (`[KNOWN GAP]` until Q9).

## R3. Claude Code (CLI 2.1.304, stream-json transport)

**Decision (changed 2026-10-20, Q10):** `--name <name>` on the session's next CLI start; capability `'next-turn'`. Durbar never writes the
session file.

Evidence:

- `real:` Vikram's agent, Vikram's account, 2026-10-20, Claude Code 2.1.304, haiku, 2 tiny prompts (USD 0.0037), issue #372:
  `claude -p … --name 'A'` writes `{"type":"custom-title","customTitle":"A","sessionId":<same id>}` into the session file;
  `claude -p … --resume <id> --name 'B'` **keeps the same session id** and appends a `custom-title` "B" (the last one wins). The earlier
  reading of the Agent SDK docs ("the resumed session's persisted title takes precedence", for the SDK's own `title` option) does not hold
  for the CLI flag.
- `claude --help` (local, read only): `-n, --name <name>  Set a display name for this session (shown in the prompt box, /resume picker, and
  terminal title)`. The CLI binary has a `saveCustomTitle` that appends a `custom-title` line and a reader that takes the **last** such
  line (`strings`, read only), consistent with the real result.
- Durbar's launch (`claudeArgs`, `src/adapters/claude.ts:194`) is `-p … --resume <id>` (or `--session-id <id>` for a new session); the
  running CLI is relaunched before the next message when `needsRelaunch` is set (`claude.ts:567`), without an extra prompt. So the name is
  applied at the next message, and a plain `--name` argument (no shell) is all that changes.
- Durbar reads `custom-title` lines in its own listing (`src/adapters/claudeHistory.ts:67`), so the stored name shows in Previous sessions.
- Docs, *Manage sessions* (https://code.claude.com/docs/en/sessions): sessions created with `claude -p` are left out of the CLI's picker, and
  "the desktop app, claude.ai/code, and the VS Code extension each keep their own session list". So where the title shows is
  `[KNOWN GAP]`: the `/resume` picker for `-p` sessions and the VS Code Claude extension's list (check on the owner's Mac, T050).
- Rejected: the Agent SDK's `renameSession()` (not a dependency, spec 012 Q3) and writing the `.jsonl` ourselves (constitution III).
- `real:` (Vikram's agent, 4 prompts, USD 0.007, `CLAUDE*` unset): `claude --resume <id>` shows the latest name in the prompt box; the `/resume` picker lists no `-p` session (named or not): "No conversations found in this project". `[KNOWN GAP]` then; **update 2026-10-20 (Vikram's agent, about $0.03):** with spec 012 FR-159 (PR #386) the picker lists Durbar's Claude sessions by their `--name` (the CLI marks sessions from `sdk-cli` as SDK runs and hides them; `CLAUDE_CODE_ENTRYPOINT=agent-durbar` avoids that; undocumented by Anthropic, recheck after updates). The picker's Ctrl+R rename changes the runtime title: spec 059 FR-011 drops a Durbar-written name then. `[KNOWN GAP]`: the VS Code extension's list.
- Not known without a run: whether the title is written at launch or only with the first turn. The adapter treats the name as applied after
  the first turn that follows the launch (`result` message) and says so in the dialog ("at your next message").

## R4. Durbar today (where the name is shown and kept)

- Window: `addLiveAgent` sets `name: info.title || name` (`src/renderer/app.js:1975`); `applyTitle` replaces `a.name` with a runtime title
  (`app.js:2604-2609`); `a.name` is then used by the desk card (`app.js:547`, `:574`), the chat header (`app.js:1187`), the inbox
  (`app.js:1508`), notifications and the strip. The card and header tooltips show "title · folder" (`app.js:547`, `:1187`).
- Schedules: the option `This session (title)` (`app.js:3560`); a new schedule stores `target.name` = the first 80 characters of the title
  (`app.js:3582`); the list shows that stored name (`app.js:3502`). Spec 044 delta #371 (branch `044-sched-sendto`, not merged) caps the
  option at 40 characters and says "Once sessions can be renamed, the short name will come from the rename".
- Previous sessions rows (`prevListsHtml`, `app.js:3723-3744`) show the listed title; spec 006 delta #368 (merged in PR #373; the
  row menu itself is spec 006 T036, not built yet) adds a per-row ⋯ menu (FR-027) and names "Rename…" as a later item via #372.
- Main: `AgentInfo.name` is the folder base name, `title` the runtime title (`src/shared/api.ts:25-28`); the title handler is at
  `src/main/main.ts:147-151`. The activity log writes `agent: a.label || a.name` (`main.ts:165-167`), that is the **folder label**, so the
  activity log never shows a session title today.
- Store: `SavedFolder` (`src/main/folders.ts:16-41`); folder labels use `parseLabel` (1-40, no controls, `folders.ts:66-75`); floors use the
  stricter `cleanName` with the hidden-character list (`src/shared/floors.ts:26-31`, `:68-74`). The name rule should reuse the floor list.
- Dialog: `askDialog` has an input and a checkbox (`src/renderer/dialog.js:3`); Enter in the field does not submit (`dialog.js:40-53`
  handles only Escape and Tab).

## Unverified (carried to the spec as `[KNOWN GAP]`)

1. Copilot: `session.name.set` on a real session; whether it emits `session.title_changed`; whether it works for a session id that is
   not loaded; whether VS Code shows the name.
2. Codex: `thread/name/set` on a real app-server (Codex not installed here); whether the Codex VS Code extension shows the name.
3. Claude: whether the VS Code Claude extension and the `/resume` picker list a `-p` session's `--name` title; whether the title is written
   before the first turn.
4. Copilot: prompt-free `resumeSession` of a stored session, then `name.set` (R1b).
