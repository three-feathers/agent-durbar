# Research: Contacts (spec 084)

**Date**: 2026-10-24 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Every fact is tagged: `read:` (documentation or code read, not run), `real:` (run and seen). Nothing here was run against a real Teams, Slack, mail app, Telegram, MCP server or agent session; no AI credits were spent.

## R1 Teams chat link (D5, FR-041)

- **Format** (`read:` Microsoft Learn, *Deep link to a Teams chat*, page dated 2026-03-26, https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-link-teams): `https://teams.microsoft.com/l/chat/0/0?tenantId=<tenantId>&users=<user1>,<user2>,...&topicName=<chat name>&message=<precanned text>`.
  - `users`: comma-separated; "supports the Microsoft Entra `UserPrincipalName`, such as an email address only". The user who opens it is always a participant.
  - `message`: "text that you want to insert into the current app user's compose box while the chat is in the draft state".
  - "The deep link provided only loads the message into the chat text box ... and doesn't send the message automatically. To send the message, you must either select the Send button or select Enter." (said for the bot form; the same `message` parameter).
  - `topicName` only for three or more users (groups, FR-090).
  - `tenantId` is optional in the format; Durbar leaves it out (a person's tenant is not known; Teams picks the signed-in one).
- **No length limit is documented.** The cap comes from the opener (R5).
- **`msteams:`**: not on that page. Links of the form `msteams:/l/chat/0/0?users=…` are widely used to skip the browser, but the format is undocumented there; Durbar offers it only as an opt-in marked *not checked* (D5, Q3).
- **Linux**: Microsoft's current desktop Teams is for Windows and macOS; on Linux Teams is used in the browser. The `https` link opens the browser on every OS, which is why it is the default. Not seen on any OS.
- Encoding: `encodeURIComponent` on each value (the example encodes spaces as `%20` and `,` as `%2C` inside `message`). A `,` in `users` would add a second person, so FR-004 refuses `,` in addresses.

## R2 Slack (D6, FR-043)

- `read:` Slack, *Deep linking into Slack* (https://docs.slack.dev/interactivity/deep-linking/, reached from api.slack.com/reference/deep-linking): `slack://user?team={TEAM_ID}&id={USER_ID}` opens a direct message; `slack://channel?team={TEAM_ID}&id={CHANNEL_ID}`. These "do not support workspace subdomains, channel names, or user names". Unknown paths fall back to `slack://open`.
- **No parameter pre-fills message text** (none documented). Hence the clipboard and *Paste it in Slack* (D6).
- `slack://` "works on Macintosh and Windows desktop clients" and mobile; Linux is not mentioned. The Linux desktop client may register the scheme; not checked (`[KNOWN GAP]`).
- The user copies the team id (`T…`) and member id (`U…`/`W…`) from Slack's profile *Copy member ID*; the Settings form explains where.

## R3 Email (FR-042)

- `read:` RFC 6068 (*The 'mailto' URI Scheme*): `mailto:addr?subject=…&body=…`; header field values percent-encoded; line breaks in `body` encoded as `%0D%0A`; `?`, `&`, `#`, `%` in addresses must be encoded, so FR-004 simply refuses them in a saved address.
- Mail apps differ in what they accept; long bodies are the main risk (R5).

## R4 Telegram (FR-044)

- `read:` Telegram, *Deep links* (https://core.telegram.org/api/links): `t.me/<username>?text=<draft_text>` and `tg://resolve?domain=<username>&text=…`. `text` is "UTF-8 text to pre-enter into the text input bar, if the user can write in the chat"; it is not sent; the client prepends a space when the text starts with `@` and trims to its maximum length.
- Durbar uses the `https://t.me/` form (opens the browser, which hands over to the app when installed), the same reasoning as R1.

## R5 Openers and length (D7, FR-045, FR-046)

- `read:` Electron `shell.openExternal(url[, options])`: "Open the given external protocol URL in the desktop's default manner"; **`url`: "Max 2081 characters on Windows."**; returns `Promise<void>` (https://www.electronjs.org/docs/latest/api/shell).
- No limit is documented for macOS or Linux, but mail apps and protocol handlers have their own. One cap of 2,000 encoded characters on every OS gives the same behaviour on all three (constitution VI) and stays under Windows' limit.
- Encoded length grows fast: non-ASCII text costs up to 9 characters per character (`%XX` × 3 bytes) and line breaks 6 (`%0D%0A`), so the preview counts after encoding.
- When no app handles a scheme, `openExternal` rejects on Windows and macOS; on Linux it runs `xdg-open`, whose failure may not reach Electron. Not checked; `[KNOWN GAP]`.
- Existing paths: `app:openExternal` takes only `http(s)` (`src/main/ipc/app.ts:22-26`); spec 080 FR-024 lets a session-browser page leave only by `mailto:` after a click. Contacts get their own channel that takes ids and builds the URL in main (FR-040), so neither rule is loosened, and a window bug cannot open an arbitrary scheme.

## R6 Option A: who makes the MCP call (D8, D9, FR-050..FR-056)

**What Durbar has.** Durbar runs an MCP *server* (spec 041: `src/main/mcp/protocol.ts`, `tools.ts`, `connection.ts`), not a client. The agent apps start the user's MCP servers and hold their sign-ins (spec 058; Copilot stores MCP OAuth tokens in the OS credential store or `~/.copilot/mcp-oauth-config/`, `docs/agent-notes.md`). The adapters can list a server's tools (`listMcpTools`, names and descriptions only, `src/adapters/types.ts:318`) but have no "call this tool" method (`src/adapters/types.ts:572-694`, `read:`).

**Options.**

1. *A Durbar MCP client* that starts the user's server itself. Rejected: Durbar would read the server's env and headers (secrets), and for remote servers it would need the OAuth token the runtime holds. Constitution III: "Agent Durbar never reads, stores, logs or transmits tokens or credentials. Sign-in belongs to the vendor runtime."
2. *A host-side direct call through the runtime.* Copilot SDK 1.0.22 has `session.rpc.mcp.apps.callTool({serverName, toolName, arguments, originServerName})`, `@experimental`, for MCP App views (SEP-1865): it requires the `mcp-apps` session capability and rejects a call when `originServerName` differs from `serverName` (`read:` `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts`, `McpAppsCallToolRequest`). No model turn, no credits, but Copilot only, experimental, and whether it passes the permission handler is unknown. Recorded as FR-097 for a probe.
3. **Chosen: the chat's own agent makes the call, gated by a ticket.** Durbar fills a user-made recipe, sends the agent a fixed instruction with the exact arguments, and the broker approves only the call that matches.

**Can the broker see the arguments?**

- Copilot: `PermissionRequestMcp` has `args?: JsonValue`, `readOnly`, `serverName`, `toolName`, `toolTitle` (`read:` SDK 1.0.22 `dist/generated/session-events.d.ts`). The adapter passes the raw request to the broker (`src/adapters/copilot.ts:685`), so `args` is there when the runtime sends it.
- Claude Code: `permissionLikeOf(toolName, input)` (`src/adapters/claude.ts:140`) has the tool input; it maps server and tool today and would add `args: input`.
- Codex: MCP approvals arrive through its app-server requests (`src/adapters/codex.ts:1140-1155`) with server and tool; whether arguments come along is not checked. Capability `mcpCallArgs: false` until it is (FR-051).

**Why a template, not a schema.** `listMcpTools` gives no input schema (Copilot's `McpTools` has `name` and `description`; `read:` `rpc.d.ts`), so Durbar cannot know a tool's argument names. The user writes the template once per server (FR-050); the ticket compares canonical JSON, so any change by the agent falls back to a card (FR-054).

**Allow all.** Today Allow all approves every non-read request (`permissions.ts:361-364`). The turned-off tools check (`blockedMcp`) already runs before it in every mode (spec 069 FR-063); the message-tool check goes in the same place (FR-054), so Allow all never sends a message by itself (FX1).

**Read-only** (changed after Paco's review of PR #707). Read-only denies MCP calls (constitution III). A ticket there would be an exception, as spec 080 needed T006 (an amendment) for reads alone, so option A and the import are **not offered in Read-only** (D9); option C opens a link and calls no tool, so it stays. The attached-files precedent (`allowReadPaths`, `permissions.ts:287`) is a read, not a call with side effects, so it does not carry over. Owner question Q4.

**A proven click** (Paco's review of PR #707). Without it, anything that can run script in the app page could call the IPC and mint a ticket. Electron's `webContents` `input-event` reports input sent to the page (mouse, keys), not DOM events made by page script (`read:` Electron `webContents` docs; Durbar already listens to it for the session browser, `src/main/browser/viewcap.ts:16`). Main requires such an event (mouse-up, or Enter or Space) within 1 s before each send, plus a single-use `previewId` bound to everything the user saw (FR-083), and a rate limit (FR-084). Not checked on a real app: whether a key repeat or an accessibility tool's click arrives as `input-event` on each OS `[KNOWN GAP]`.

**Logs** (Paco's review). The message tool's `toolCall` event carries the arguments (the text) into the chat chip and can carry them into the activity and debug logs (Paco's review; not traced in code here); FR-082 leaves them out of both logs, with a test. The agent app's own history is outside Durbar (Honest limits).

**Gap.** Copilot runs a tool marked `readOnlyHint: true` without asking the host (`docs/agent-notes.md`, spec 044, `real:`), so a wrongly marked send tool is not held (FR-056).

## R7 Masking outgoing text (D10, FR-033)

- Reuse 083 FR-005's order: known values (`secretValuesFor`, `src/main/mcpipc.ts:82`; `extraSecretValues`, `src/main/mcp/readtools.ts:47`), then `redact` (`src/shared/redact.ts:149`), then `redactMarkdown` token runs (`:171`). One function `maskOutgoing` beside `maskNoteText` (if 083 lands first, one shared core).
- Block instead of mask-and-send: a message with `[redacted]` in it is confusing for the person who gets it, and a secret the user wants to share should not go through Durbar at all. *Use the masked text* keeps the choice explicit.
- Mask in the window for the live check (`DurbarSafeText`) and again in main before the send; main is the one that decides.

## R8 Teams import (D12, FR-070..FR-073)

- Through the user's Microsoft 365 MCP server, whatever its tool is called (a people search or users list). Durbar does not name or recommend a server: they differ in tools and change fast. The import recipe holds the server, tool and constant arguments.
- The result is read from the tool call's own output event (main's masked copy, `outward()` in `src/main/main.ts:191`), not from the agent's reply, so the agent cannot add or change people.
- Field names follow Microsoft Graph's people and user objects (`displayName`, `mail`, `userPrincipalName`, `scoredEmailAddresses`), tolerant of other shapes (`read:` general Graph knowledge; not checked against a real server).
- Work tenants: reading the directory can be against company policy or blocked by admin consent on the server's app registration. The dialog says so (FX4); Durbar never asks for consent itself (no option B).

## R9 Where it lives in the UI (D1..D3, D16)

- Drawer like spec 083's (D2 there): sending needs the message box, which belongs to the Chat view; a third tab next to Chat and Browser would hide the box. Notes and Contacts share one drawer frame; one shows at a time.
- A composer button was considered: the toolbar under the box is full and overflows into More (spec 005 FR-040); `@` plus the More item is enough.
- `@` vs a group in `/`: `/` inserts text (083 D1, #581); a contact is a destination, so a chip, not text. `@` only at a word start and only on a match, so file references and email addresses typed for the agent still work.
- No shortcut: every free combination competes with `TAKEN`; `@` is a better keyboard path.

## R10 The sent line and emoji (D13)

- Constitution V: "No emoji, no blur filters in compact scenes." The chat log is not a compact scene, but Durbar draws every chat mark with SVG icons from theme tokens, and colour emoji depend on the OS font (a Linux without one shows a box). Same reasoning as 083 D4: an SVG send icon with words.
- "Sent" only when Durbar knows (A, tool success); C says "Opened" (constitution VIII).

## R11 Groups and agent suggestions (D17)

- Groups: Teams supports several `users` and `topicName` (R1); Slack, email and Telegram differ. One person per confirmation keeps FX1 simple. `[LATER]`.
- Agent suggestions need a way for the agent to propose a send. A Durbar MCP tool that only opens a prefilled preview is the safe shape (spec 041 change tools are off: `CHANGE_TOOLS_ENABLED = false`, `src/main/mcp/tools.ts`). `[LATER]`.

## R12 Simulator (FR-086)

- Renderer: canned bridge in `src/renderer/sim.ts` (spec 010), page parameter `simcontacts`.
- Main: an injected opener and clipboard in `src/main/ipc/contacts.ts`; under `DURBAR_SIM` (read through `devEnv`, as `simmain.ts` does) they record instead of acting.
- Option A and import: `FakeAdapter` (`src/adapters/fake.ts`) already fakes MCP status and tools (spec 069); it gets a `sim-teams` server whose tools record calls and answer canned results, and emits the permission requests with `args` so the broker path is the real one.
