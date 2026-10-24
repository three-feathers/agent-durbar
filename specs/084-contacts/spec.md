# Feature Specification: Contacts: a contacts book, and send the message box to a person from any chat

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Contacts (issue #701): a local contacts book (0600) with favourites; send the message box to a person from any chat via an `@` chip or a Contacts drawer, always through a preview with a secret block; opens Teams, email, Slack or Telegram with the text (C) or sends through the user's own MCP server with a single-use broker ticket, held in every mode (A); opt-in Teams import; agent drafting
status: Draft (2026-10-24, revised after Paco's review of PR #707): spec, plan, research and tasks; owner decisions OD1..OD3 and fixed rules FX1..FX5 (Ruben), coordinator decisions D1..D18; owner questions Q1..Q5 with defaults; nothing built
-->

**Feature Branch**: `084-contacts` (touches 005 chat panel and composer, 003/018 permission broker, 073 the picker list pattern, 058/069 MCP lists, 040 one-shot text, 080 (FR-024 is not loosened), 083 the chat drawer, 010 simulator)

**Created**: 2026-10-24

**Status**: Draft (spec, plan, research and tasks; nothing built)

**Input**: Owner request (Ruben, 2026-10-24, issue #701): "A contacts book in Durbar. For each person you set how to reach them: Teams, Slack, email, Telegram, and so on. Then, from any chat, you pick a contact and Durbar sends what's in the message box to them." Plus an optional import of Teams contacts. The issue's *Safety and privacy* rules are fixed rules (FX1..FX5 below).

## Owner decisions (binding)

Ruben (owner), 2026-10-24 (issue #701 and the brief to the coordinator):

- **OD1 Favourites are in v1.** Star a contact: favourites are pinned at the top of the contacts list and of the `@` picker, in an order the user chooses, and the chat's Contacts drawer has a one-click *send to a favourite* row.
- **OD2 Sending: option C and option A, always with a preview and an explicit Send in Durbar.**
  - **C**: open the person's channel with the text filled in (deep links: Teams, Slack, `mailto:`, Telegram); the user presses Send in that app.
  - **A**: send through an MCP server the user already has (Microsoft 365 / Teams, Slack, Gmail…).
- **OD3 Option B (Durbar's own OAuth connectors) is out of scope** (FR-095).

### Fixed rules from the issue (Ruben, 2026-10-24)

- **FX1** Never send without explicit confirmation of the final text, the person and the channel, in every permission mode, Allow all included.
- **FX2** Secrets are masked before anything is sent (spec 041 safetext); text that still looks like a secret blocks the send or warns.
- **FX3** Contacts are local only (Durbar data, mode 0600), never synced, never in a repository; in an export (#559) only by choice.
- **FX4** Work accounts: the Teams import is opt-in, says clearly what is read, and keeps nothing beyond the contacts the user picked.
- **FX5** Message bodies are never written in plain text to **Durbar's own** files and logs (store, send log, activity log, debug log); no token is stored outside the existing MCP and OS keychain paths. *(Narrowed after Paco's review of PR #707: the agent app's own history is outside Durbar's control, see Honest limits.)*

## Decisions taken by the coordinator (under Ruben's delegation, 2026-10-24)

Each one is *decided by the coordinator under Ruben's delegation*; reasons and rejected options are in [research.md](research.md).

- **D1 A Contacts drawer of the Chat view, like spec 083's Notes drawer (083 D2)** (R9). It covers the chat log (`#chat`) only; the composer stays usable under it; with spec 080's tabs, opening it selects *Chat* first. Notes and Contacts never show at once: opening one closes the other. Management (add, edit, delete, favourites order, import, MCP recipes, the send log) lives in **Settings > Contacts**, as the issue proposed.
- **D2 `@` at a word start opens a contacts picker** (R9). It reuses the `/` list's element and helpers (`#slashList`, `.mode-menu.slash-list`, `slashsuggest.js`), but it is its own list, not a group inside `/` (083 D1 keeps `/` for text that goes into the box; a contact is a recipient, not text). It opens only when at least one contact matches, so `@src/file.ts` (a file reference for the agent) and `ruben@example.com` (not at a word start) are left alone.
- **D3 A recipient chip turns the composer into a preview step** (R9). With the chip *→ Paco (Teams)* set, the Send button reads *Preview for Paco…* and Enter opens the preview; nothing goes to the agent while a chip is set; removing the chip (its ×, or Backspace at the start of an empty box) gives the normal Send back. One recipient per send in v1.
- **D4 The preview reuses `askDialog`** (spec 064: `size: 'l'`, `lines`, `input.multiline`, `input.check`), as *Send to several sessions* does (`sendToSeveral`, `src/renderer/app.js:2855`). The confirming button is drawn as `primary warn`, so focus starts on *Cancel* and Enter never confirms it unread (spec 052 FR-036).
- **D5 Teams links use the documented `https://teams.microsoft.com/l/chat/0/0?users=…&message=…` form** (R1). The `msteams:` scheme with the same path is undocumented on Microsoft's page; it is a Settings choice, off by default and marked *not checked*.
- **D6 Slack cannot pre-fill** (R2): `slack://user?team=…&id=…` opens the direct message, and Durbar puts the text on the clipboard first; the preview says *Paste it in Slack and press Send there.* Telegram uses `https://t.me/<username>?text=…` (R4), email `mailto:` with the first line as the subject (R3).
- **D7 One URL cap on every OS: 2,000 characters after encoding** (R5), under Electron's documented 2,081 on Windows, so the three systems behave the same. Over the cap the preview offers *Copy the text and open the chat* instead.
- **D8 Option A goes through the chat's own agent, with a single-use ticket in the permission broker** (R6). Durbar has no MCP client of its own (it has only its MCP server, spec 041), and building one would mean starting the user's servers and holding their sign-ins, which constitution III forbids ("Sign-in belongs to the vendor runtime"). Durbar builds the exact tool call from a **send recipe** (server, tool, arguments template) the user set up, asks the agent to make exactly that call, and the broker approves only the call whose server, tool and arguments match the ticket. Copilot SDK 1.0.22's experimental `session.rpc.mcp.apps.callTool` (no model turn) is recorded for a later delta (FR-097).
- **D9 Message tools always ask; option A is not offered in Read-only** (R6, FX1; changed after Paco's review of PR #707). Every tool named by a send recipe is a *message tool*: a request for one that does not match a ticket is held as a pending card in Ask **and in Allow all** (never auto-approved), denied in Read-only as today, and never gets *Approve for this session*. **In Read-only no ticket is made**: *Send now* and the Teams import are not offered there (option C still works), because constitution III denies MCP in Read-only and a ticket would be an exception to it. Allowing A in Read-only is owner question Q4 and needs a constitution amendment first.
- **D10 A secret blocks the send; there is no "send anyway"** (R7, FX2). The final text is checked with the shared masking and the known secret values; when anything would be masked, the confirming button stays disabled and the dialog offers *Use the masked text*. *(Default pending owner confirmation, Q1.)*
- **D11 "Ask the agent to write it" is one `generateText` prompt of the chat's agent app** (spec 040 FR-015: one prompt, no tools, no session kept), with the box text as the brief and the contact's *how to talk to them* notes. The draft lands in the preview's text field; it is never sent by itself. One prompt of credits, said on the button.
- **D12 The Teams import reuses D8's path with an import recipe** (R8): one ticketed read call of the user's Microsoft 365 MCP server through the chat's agent; Durbar parses the tool's result (not the agent's prose), shows a pick list (nothing ticked) and keeps only the name, email and Teams address of the people picked.
- **D13 The "sent" line is honest and uses an icon, not 📨** (R10; constitution V, as 083 D4). Option C says *Opened Teams for Paco, 10:42* (Durbar cannot know the user pressed Send); only option A, after the tool returned success, says *Sent to Paco on Teams, 10:42*.
- **D14 Contacts are global**, not per folder (unlike notes, 083 D6): a person is the same in every project.
- **D15 A separate store, not `SettingsStore`.** `settings.json` holds "numbers only; no tokens, no content" (`src/main/settings.ts:1-3`); contacts are personal data.
- **D16 No new keyboard shortcut.** `@` in the message box is the keyboard path; the drawer opens from *Contacts…* in the chat's More menu and from Ctrl+K. Nothing is added to `TAKEN` (`src/renderer/navigator.js:160`).
- **D17 Deferred, not in this spec:** group contacts (FR-090), agent suggestions such as "send this to Paco" (FR-091), *Send this note to…* from spec 083 (FR-093).
- **D18 A send needs a proven click** (Paco's review of PR #707). Main makes every send in two steps: `contacts:preview(...)` returns a single-use `previewId` (60 s) bound to the contact, channel, recipient, final text and, for A, the filled call; `contacts:open(previewId)` / `contacts:sendMcp(previewId)` are accepted only after a trusted `input-event` (mouse-up, or Enter or Space) on the app window within 1 s. Script in the page alone cannot send. Main also limits sends to 5 per minute and 30 per hour (FR-083, FR-084).

## What exists today (look for an existing capability first)

`read:` on `main` at cf1e0dfa, 2026-10-24.

| Need | Existing capability, reused | Gap |
| --- | --- | --- |
| A picker over the message box | Spec 073's `/` list: `slashsuggest.js` (`tokenAt`, `filter`, `optionHtml`, `view`, `tip`), `slashUpdate` / `slashPick` / `placeSlash` (`src/renderer/app.js:2054-2115`) | A second trigger character (`@`) and a contact source |
| A drawer in the chat panel | Spec 083 FR-020 (designed, not built yet) | The same drawer frame, with a second content |
| Preview and confirm | `askDialog` (`src/renderer/dialog.js:3`; multiline input, `check`, `picks`, `need`, Cancel focus for `warn`), used by `sendToSeveral` (`app.js:2855`) | none |
| Open another app | `shell.openExternal` in main; `app:openExternal` accepts `http(s)` only (`src/main/ipc/app.ts:22-26`) | A contacts channel that takes ids and builds the URL in main; `app:openExternal` stays as it is |
| Masking | `redact`, `redactMarkdown` (`src/shared/redact.ts:149`, `:171`), `DurbarSafeText` (`src/renderer/safetext.js`), known values: `secretValuesFor` (`src/main/mcpipc.ts:82`), `extraSecretValues` (`src/main/mcp/readtools.ts:47`) | One check for outgoing text |
| Small private store | `FolderSetupStore` (atomic temp + rename, 0600, `src/main/foldersetupstore.ts:16-41`), `randomPlaceId` (uniform ids, `src/main/settings.ts:24`) | A contacts store |
| MCP servers and tools of a session | `mcp` events (spec 058), `agents:mcpTools` / `listMcpTools` (spec 069 FR-032, `src/main/mcptoolsop.ts`) | none (names and descriptions only; no input schemas, R6) |
| Gate MCP calls | `PermissionBroker.request` (`src/adapters/permissions.ts:349`), `blockedTools` refuses turned-off tools in every mode (spec 069 FR-063) | Message tools and tickets (D8, D9) |
| One prompt without tools | `generateText` (spec 040 FR-015), `oneShotFor` (`src/main/main.ts:678`) | none |
| Settings sections | `screens.js` Settings (`src/renderer/screens.js:330-390`) | A Contacts section |
| Simulator | `src/renderer/sim.ts`, `FakeAdapter` (`src/adapters/fake.ts`), main-side sim (spec 041 `simmain.ts`) | contacts calls, a fake message server |
| #485 IM channels, #19 people, #128 briefing | Other direction or not messaging (issue #701, checked 2026-10-24) | none reused |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add Paco and send him the box through Teams (Priority: P1) MVP

In Settings > Contacts I add *Paco* (alias *paco*) with a Teams channel `fjcabello@example.com`. In a chat I type "#669 is ready for review", then `@pa` and pick Paco: a chip *→ Paco (Teams)* appears above the box and the Send button reads *Preview for Paco…*. I press Enter. The preview shows *To: Paco*, *Channel: Teams, fjcabello@example.com*, *How: opens Teams with the text filled in; you press Send in Teams*, and the text. I press *Open in Teams*. My browser opens Teams on a chat with Paco with the text in the box; I press Send there. In Durbar the chat shows a small line with a send icon: *Opened Teams for Paco, 10:42*.

**Why this priority**: the whole need in one loop, with no new sign-in and no AI credits.

**Independent Test**: simulator chat (`DURBAR_SIM=15`, `simcontacts=some`); the link launch is stubbed and recorded (FR-086); zero credits.

**Acceptance Scenarios**:

1. **Given** Settings > Contacts, **When** I add a contact with a name, an alias and a Teams channel, **Then** it is stored (0600) and listed (FR-001..FR-005, FR-010).
2. **Given** a chat, **When** I type `@pa` at a word start, **Then** the contacts picker lists Paco (favourites first); Enter or Tab sets the chip and removes `@pa` from the box (FR-021, FR-022).
3. **Given** the chip, **When** I press Enter, **Then** the preview opens with person, channel, how and text; *Cancel* has the focus (FR-030).
4. **Given** the preview, **When** I press *Open in Teams*, **Then** main builds `https://teams.microsoft.com/l/chat/0/0?users=fjcabello%40example.com&message=%23669%20is%20ready%20for%20review` from the stored contact and the text and opens it; the window never passes a URL (FR-040, FR-041).
5. **Given** the open went through, **Then** the chat shows *Opened Teams for Paco, 10:42* with an icon, the box is emptied, the chip removed, and the send log has an entry without the text (FR-080, FR-081).
6. **Given** the text holds a fake token, **When** the preview opens, **Then** *Open in Teams* is disabled with *This text looks like it holds a secret* and *Use the masked text* is offered (FR-033).

---

### User Story 2 - Favourites one click away (Priority: P1) MVP

I star Paco and Vikram and drag Vikram first. In any chat I open *Contacts…*: the drawer shows *Favourites* on top in my order, each with a *Send the box* button. One click on Vikram's opens the preview for Vikram's preferred channel.

**Independent Test**: simulator with `simcontacts=some` (two favourites).

**Acceptance Scenarios**:

1. **Given** two starred contacts, **When** I reorder them (Move up / Move down, or drag), **Then** the drawer, the Settings list and the `@` picker show them first in that order (FR-006, FR-011, FR-023).
2. **Given** the drawer, **When** I press a favourite's *Send the box*, **Then** the preview opens for that person's preferred channel with the box text; with an empty box the button is disabled with *Type a message first* (FR-024).
3. **Given** 9 favourites, **Then** the favourites row shows the first 6 and *All favourites…* (FR-024).

---

### User Story 3 - Email, Slack and Telegram (Priority: P2)

Vikram's preferred channel is email; Paco has Slack too. Email opens my mail app with subject and body filled; Slack opens the direct message and the preview has told me the text is on the clipboard; Telegram opens the chat with the text in the input bar.

**Acceptance Scenarios**:

1. **Given** an email channel, **When** I confirm, **Then** `mailto:` has the first line (at most 78 characters) as `subject` and the rest as `body`, line ends as `%0D%0A` (FR-042).
2. **Given** a Slack channel, **When** I confirm, **Then** the text is put on the clipboard first and `slack://user?team=T…&id=U…` is opened; the preview said so before (FR-043).
3. **Given** a text that makes the URL longer than 2,000 characters, **Then** the preview says so and offers *Copy the text and open the chat* (FR-045).
4. **Given** a channel with more than one way, **When** I open the chip's menu, **Then** I can pick another channel of that contact for this send (FR-022).

---

### User Story 4 - Send through my Teams MCP server (Priority: P2)

I already use a Microsoft 365 MCP server in my agent app. In Settings > Contacts > *Send through MCP* I add a recipe: server `m365`, tool `send-chat-message`, arguments `{"to":"{{to}}","content":"{{text}}"}`. Paco's Teams channel now offers *Send now through m365*. In the preview I press *Send now*: Durbar asks the chat's agent to make exactly that call; the broker lets that one call through (in Ask or Allow all) and holds any other call to that tool, even in Allow all. The tool succeeds and the chat shows *Sent to Paco on Teams, 10:43*.

**Independent Test**: `FakeAdapter` with a fake message server `sim-teams` (FR-086); broker unit tests; zero credits.

**Acceptance Scenarios**:

1. **Given** a recipe and a chat in Ask or Allow all whose session runs that server, **When** the preview opens, **Then** it shows the server, the tool and the canonical arguments exactly as hashed, and says the text and the recipient go to the agent's model provider; **When** I press *Send now*, **Then** a ticket is made and the agent is asked to call the tool with the filled arguments; the matching call is approved once and the ticket is used up (FR-050..FR-053).
2. **Given** the agent changes an argument, **Then** no ticket matches and the call is a pending card that shows the arguments (masked), in Ask and in Allow all (FR-054).
3. **Given** Allow all, **When** the agent calls a message tool on its own, **Then** the call waits for me; *Approve for this session* is not offered (FR-054).
4. **Given** the session does not run that server, the chat is in Read-only, or the agent app does not pass tool arguments to Durbar, **Then** *Send now* is not offered and the preview says why; *Open in Teams* still works (FR-051).
5. **Given** the tool returns an error, **Then** the line says *Could not send to Paco on Teams: <masked reason>* and the log records the failure (FR-055, FR-081).

---

### User Story 5 - Import people from Teams (Priority: P3)

In Settings > Contacts I choose *Import from Teams…*. A dialog says exactly what will be read, that a work account's rules may forbid it, and which server and tool will be called. I confirm; Durbar asks the chat's agent to make that one read call, shows the people it returned with nothing ticked, and I tick three. Only those three are added, with name, email and Teams address.

**Acceptance Scenarios**:

1. **Given** an import recipe, **When** I open *Import from Teams…*, **Then** the first dialog names the server, the tool, what is read and the work-account warning, and *Cancel* has the focus (FR-070).
2. **Given** the call returned 40 people, **Then** a pick list shows name and email, none ticked; *Add N contacts* needs at least one (FR-072).
3. **Given** I add 3, **Then** only those are stored (`source: 'teams-import'`), and nothing else from the result is kept in memory or on disk (FR-073).

---

### User Story 6 - Ask the agent to write it (Priority: P3)

Paco's notes say "short, in English, no greetings". I type "tell paco 669 is ready, he asked yesterday" and pick him. In the preview I press *Ask Claude Code to write it (1 prompt)*. The text field gets "#669 is ready for review." I change a word and press *Open in Teams*.

**Acceptance Scenarios**:

1. **Given** the preview, **When** I press *Ask <app> to write it*, **Then** one `generateText` prompt goes to the chat's agent app with the masked brief, the contact's notes and the channel kind; the result replaces the field (FR-060, FR-061).
2. **Given** the draft holds a secret shape, **Then** FR-033's block applies as to typed text.
3. **Given** the chat's agent app has no `generateText`, **Then** the button is not shown (FR-060).

### Edge Cases

- **`@` that is not a contact**: `@src/app.ts`, `@copilot`, `ruben@example.com`: no list unless a contact matches the word at a word start (D2).
- **A contact with no usable channel** (every channel's address invalid): it is listed, greyed, with *Add a way to reach them*.
- **The chip is set and the person is deleted** in Settings: the chip is removed and the box text stays.
- **A helper chat or a read-only VS Code chat** (no usable message box): no `@` picker, no chip; the drawer's buttons are disabled with the reason, as 083 FR-024.
- **Demo chats** (`?sim`) use the simulator's contacts; nothing is written or opened (FR-086).
- **No app handles the scheme** (no Slack installed): `shell.openExternal` rejects on Windows and macOS; on Linux `xdg-open` may fail silently `[KNOWN GAP]` (R5); the line then says *Could not open Slack* when the call rejects.
- **The agent is busy** (a turn is running) or at its spending limit: *Send now* (A) and the Teams import are disabled with the reason; C still works.
- **The agent never makes the call** within 120 s: the ticket expires, the line says *The agent did not send it; nothing was sent*, and the log says *not sent* (FR-053).
- **Two Durbar processes on one profile**: the store re-reads a file that changed under it before writing and refuses a stale `rev` (FR-007), as 083 FR-008.
- **A corrupt or oversized store** is never overwritten (FR-008).
- **Non-ASCII text, emoji and right-to-left text** in a message: encoded with `encodeURIComponent` (UTF-8 percent-encoding); counted after encoding for the cap (FR-045).
- **A CR, LF, `&` or any non-ASCII character in an address field** (a Cyrillic `а` in the domain) is refused when the contact is saved (FR-004), so it can never add a parameter to a link or pass for another address.
- **The mode changes to Read-only while a ticket is live**: the ticket is dropped at once and the call, if it comes, is denied (FR-054).
- **A send button pressed by script** (no trusted input within 1 s), or a seventh send in a minute: refused by main with a fixed reason; nothing is opened or sent (FR-083, FR-084).

## Requirements *(mandatory)*

### Storage and model (FX3, FX5, D14, D15)

- **FR-001** **One local store**, `<userData>/contacts/contacts.json`. The folder `contacts/` is created owner-only (0700) and each file 0600 (POSIX; on Windows the profile folder's ACL applies). Writes are atomic: a unique temp file in the same folder opened with `wx`, then rename (the `FolderSetupStore` pattern). Never synced, never written inside a project folder, never in `folders.json` or `settings.json`.
- **FR-002** **A contact** has `id` (`p-` and 12 random lowercase letters or digits, uniform, as `randomPlaceId`), `name` (1..80 characters, no control characters), `aliases` (at most 5, each 1..32, letters, digits, `.`, `_`, `-`), `initials` (1..2, guessed from the name, editable), `favourite` (boolean), `favOrder` (an integer; favourites are sorted by it), `notes` (*How to talk to them*, at most 1,000 characters, masked before stored as 083 FR-005 does), `channels` (0..8, FR-003), `preferred` (a channel id), `source` (`typed` or `teams-import`), `createdAt`, `updatedAt` (ISO 8601 UTC) and `rev` (+1 per change). No pictures in v1.
- **FR-003** **A channel** has `id` (`ch-` and 8 random characters), `kind` (`teams`, `slack`, `email`, `telegram`), an optional `label` (at most 40) and the fields of its kind: `teams`: `upn` (an email-shaped User Principal Name, as Microsoft's page requires); `slack`: `team` (`^T[A-Z0-9]{2,20}$`) and `user` (`^[UW][A-Z0-9]{2,20}$`) plus an optional display handle; `email`: `address`; `telegram`: `username` (`^[A-Za-z][A-Za-z0-9_]{4,31}$`). A channel may also name a send recipe (`recipe`, FR-050) and the recipe's `to` value (at most 200 characters, default: the channel's address).
- **FR-004** **Addresses are checked when saved**, never when the link is built only: an email or UPN must be **ASCII only** (any character outside U+0021..U+007E is refused, so look-alikes such as a Cyrillic `а` cannot pass; internationalised addresses and punycode display are `[LATER]`) and match one simple shape (`local@domain`, no spaces, no `?`, `&`, `#`, `%`, `,`, `;`, `<`, `>`, quotes, control characters; at most 254 characters). Anything else is refused with the field's reason. Tests feed a hostile list (CR/LF, `?cc=`, `&message=`, `%0A`, `,` second recipient, `javascript:`, Unicode look-alikes of `@`, a Cyrillic `а` or Greek `ο` in the local part and the domain, a full-width dot, a zero-width space), also part of SC-003's corpus.
- **FR-005** **Caps, from one object.** Every cap lives in one `CONTACTS_LIMITS` object in `src/shared/contacts.ts` (300 contacts, 8 channels, 5 aliases, 1,000 notes characters, 20 recipes, 500 log entries, the URL cap of FR-045, the text cap of FR-031); byte caps are derived from the character caps (083 FR-006's rule), and nothing larger than the read cap is ever written.
- **FR-006** **Favourites (OD1).** *Star* sets `favourite` and gives the contact the next `favOrder`; *Unstar* clears it. *Move up* / *Move down* (and drag in the Settings list) swap `favOrder`; the order is the same everywhere favourites show (FR-011, FR-023, FR-024).
- **FR-007** **Concurrency.** Main is the only writer in a process and queues writes; every change from the window carries `rev`; a different `rev` refuses with `stale` and the window reloads. Before a write main compares size, modification time and inode (Windows: file index) with its last read or write and re-reads when another process changed it (083 FR-008, by contact `id`).
- **FR-008** **A file Durbar cannot read is never overwritten.** Unknown `version`, invalid JSON, over the cap or not a regular file: contacts are read-only with *Durbar could not read the contacts file; it is left as it is.* and **Start over…** (`askDialog`, *Cancel* focused), which renames it to `contacts.json.bad-<UTC time>` (0600).
- **FR-009** **Export only by choice (FX3).** Settings > Contacts has *Export…* (a JSON file the user picks in the system save dialog; main shows the dialog, the window never sends a path; 0600) and *Delete all contacts…* (asks, *Cancel* focused). `[LATER]` #559's export and import include contacts only when the user ticks *Contacts* (a task for that spec; noted on #559). Any data-reset path must include `<userData>/contacts/` (as 083 FR-048).

### Settings > Contacts (US1, US2)

- **FR-010** **A Contacts section in Settings** (`screens.js`, like Schedules): the list (favourites first in their order, then by name), *Add contact…*, and per contact *Edit…*, *Star* / *Unstar*, *Move up* / *Move down* (favourites only), *Delete…* (asks, *Cancel* focused). Search by name and alias (`DurbarNav.rank`). Empty: *No contacts yet. Add the people you message most.*
- **FR-011** **Add and edit** use a form inside the section (not a new popup): name, aliases, initials, *How to talk to them*, and the channels (add, remove, mark preferred; each kind shows only its fields, with the reason of a refused field under it, `role="alert"`). Keyboard: every control has a name; the list is a list of buttons with roving `tabindex`.
- **FR-012** **Settings choices**: *Open Teams links in: Your browser (default) / The Teams app (msteams:, not checked)* (D5); the *Send through MCP* recipes (FR-050); *Import from Teams…* (FR-070); *Recent sends* (FR-081) with *Clear*.
- **FR-013** **Reachable** from Ctrl+K (*Contacts*), from the drawer's *Manage contacts…*, and from *Settings*. Nothing new on the office floor.
- **FR-014** The *What Durbar does not do* list (`screens.js:353`) gets *It sends a message only after you press Send in its preview; Durbar has no account of its own with Teams, Slack or email.* "It sends nothing to any server of its own" stays true.

### In the chat (US1, US2, D1..D3)

- **FR-020** **A Contacts drawer** in the chat panel, framed exactly as 083 FR-020 (covers `#chat` only; header, answer bar and composer usable; `role="region"`, name *Contacts*; Esc closes it first, a second Esc closes the chat). Opened by *Contacts…* in the More menu and Ctrl+K *Contacts* (D16). Opening it closes the Notes drawer and the reverse (D1). If spec 083's drawer is not built yet, this spec builds the shared frame once (`chatDrawer(kind)`), and 083 uses it.
- **FR-021** **`@` picker (D2).** In a main chat's message box, `@` followed by at least one character, at a word start (start of the box or after whitespace or `(`), opens a list when at least one contact's name or alias matches (`DurbarNav.rank`): favourites first in their order, then the rest, at most 8 rows. Each row: initials, name, the preferred channel (*Teams*). The list reuses `#slashList`'s element, placement (`placeSlash`) and keyboard (arrows, Tab and Enter pick, Esc closes); it is a `listbox` named *Contacts*; announcements say *3 contacts*. The `/` list and the `@` list never show at once.
- **FR-022** **The recipient chip (D3).** Picking replaces the typed `@word` with nothing and sets a chip above the box: initials, *→ Paco (Teams)*, a button *Change channel* (a menu of the contact's channels, shared menu element `#modeMenu`) and *Remove* (×). One chip at a time; picking another contact replaces it. The chip is part of the chat's draft (it survives switching chats, like the box text, `keepDraft`) and is not saved across a restart.
- **FR-023** **While a chip is set**, the Send button's label and name are *Preview for Paco…*, its tooltip *Opens a preview. Nothing is sent to the agent.*, and Enter opens the preview (FR-030); nothing is sent to the agent. Backspace in an empty box at the caret's start, or the chip's ×, removes the chip and gives the normal Send back.
- **FR-024** **The drawer (OD1).** Top: *Favourites* in their order, the first 6, each a row with initials, name, the preferred channel and **Send the box** (opens the preview for that person and channel with the box text; disabled with *Type a message first* when the box is empty), plus *All favourites…* when there are more. Below: a search field and every other contact (name, channels), each with **Send the box** and **Set as recipient** (sets the chip, FR-022). Footer: *Manage contacts…* (FR-013). Keyboard: arrows between rows, Enter is *Send the box*.
- **FR-025** **Where it is offered.** Main chats with a usable message box, live or demo. Not in a helper chat or the read-only VS Code chat (the drawer's buttons are disabled with the reason). Contacts never send anything to the agent: the chip, the picker and the drawer are Durbar-only.

### The preview and the send (FX1, FX2, D4, D10)

- **FR-030** **Every send opens the preview, made in main (D18).** The window calls `contacts:preview(agentId, contactId, channelId, text, way)`; main runs FR-033's check, builds the link (C) or fills the call (A), and returns a `previewId` with what the dialog shows. The dialog (`askDialog`, `size: 'l'`, role `alertdialog`): title *Send to Paco*; lines *Channel: Teams, fjcabello@example.com* and *How: Opens Teams in your browser with the text filled in. You press Send in Teams.* (each kind and way has its own sentence, FR-040..FR-055); the text in a multiline field (editable, the box text by default; an edit asks main for a new preview, which replaces the old `previewId`); buttons *Cancel*, *Ask <app> to write it (1 prompt)* (FR-060) and the confirming one (*Open in Teams*, *Copy and open Slack*, *Open in your mail app*, *Open in Telegram*, or *Send now through <server>* for A), drawn `primary warn` so *Cancel* has the focus. Esc and the backdrop cancel. Nothing leaves Durbar before the confirming button is pressed.
- **FR-030a** **What option A's preview shows** (Paco's review of PR #707). Lines *Server: m365*, *Tool: send-chat-message*, and the **canonical arguments exactly as hashed** for the ticket (FR-052), in a read-only, monospace block, masked for display (the recipe's `to` may differ from the channel address, so it shows the real one), plus *The text and the recipient go to <agent>'s model provider, and stay in <agent app>'s own history.*
- **FR-031** **Text cap**: 4,000 characters in the field (the cap of *Send to several sessions*); a counter shows the encoded URL length for C (FR-045).
- **FR-032** **Every place that shows contact data** (picker, chip, drawer, preview lines, toasts, the sent line, announcements) shows it with `textContent` or escaped, never as HTML; contact `notes` are masked again on display (`DurbarSafeText`).
- **FR-033** **The secret check (FX2, D10).** On every change of the field and once more in main right before the send, the text is masked with one shared function `maskOutgoing(text, values)` (in `src/shared/redact.ts`, the same order as 083 FR-005's `maskNoteText`: the known values for this chat's folder and session, then `redact`, then `redactMarkdown`'s token runs). When the masked text differs from the text, the confirming button is disabled (`input.check` returns *This text looks like it holds a secret. Durbar does not send secrets.*) and a button *Use the masked text* puts the masked text in the field. There is no override. Main refuses a send whose text masks differently, so a changed window cannot skip it (`blocked: secret`).
- **FR-034** **After a confirmed send** the box is emptied and the chip removed; on *Cancel* both stay. Focus returns to the message box.

### Option C: open the channel with the text (OD2, D5..D7)

- **FR-040** **Main builds every link, from ids.** `contacts:preview` looks the contact and channel up, runs FR-033's check and builds the URL with one pure function `buildContactLink(channel, text, opts)` in `src/shared/contactlinks.ts`; `contacts:open(previewId, {copyOnly?})` opens exactly the URL bound to that preview. The result must start with one entry of **one constant, `CONTACT_LINK_ALLOWLIST`** in `src/shared/contactlinks.ts`: `https://teams.microsoft.com/l/chat/0/0?`, `msteams:/l/chat/0/0?`, `mailto:`, `slack://user?`, `https://t.me/`; nothing else reaches `shell.openExternal`, and no other list of these prefixes exists. The window never sends a URL; `app:openExternal` stays `http(s)`-only and unchanged. Spec 080 FR-024 (only `mailto:` may leave the session browser, after a click) is not loosened: it governs pages; contacts links are built by Durbar from the user's own data after the user's click in Durbar.
- **FR-041** **Teams** (R1): `https://teams.microsoft.com/l/chat/0/0?users=<upn>&message=<text>`, each value with `encodeURIComponent`. With the Settings choice *The Teams app*, the same path with `msteams:` (`msteams:/l/chat/0/0?users=…&message=…`) `[KNOWN GAP]` undocumented, not checked on any OS. The preview says *Teams puts the text in the message box; you press Send there.*
- **FR-042** **Email** (R3, RFC 6068): `mailto:<address>?subject=<first line, cut at a word to 78>&body=<the rest>`, percent-encoded, line breaks as `%0D%0A`; when the text has one line, the subject is empty and the body is the text. The preview shows *Subject:* and *Body:* as the mail app will get them.
- **FR-043** **Slack** (R2): no pre-fill exists. Main writes the masked final text to the clipboard (`clipboard.writeText`), then opens `slack://user?team=<team>&id=<user>`. The preview says *Slack cannot take the text from a link. Durbar copies it; paste it in Slack and press Send there.* and the confirming button is *Copy and open Slack*. Honest limit: clipboard managers may keep the text.
- **FR-044** **Telegram** (R4): `https://t.me/<username>?text=<text>`; Telegram puts it in the input bar and trims it to its own maximum. The preview says so.
- **FR-045** **The URL cap (D7).** A built URL longer than `CONTACTS_LIMITS.urlChars` = 2,000 characters is never opened. The preview shows *N of 2,000 characters after encoding* while typing; over the cap the confirming button becomes *Copy the text and open the chat* (the text goes to the clipboard and the link is opened without `message` / `body` / `text`). The same cap on every OS.
- **FR-046** **When the open fails** (`shell.openExternal` rejects), the line says *Could not open <app>: no app on this computer opens these links.* and the log records it; the text stays in the box. On Linux a missing handler may not reject `[KNOWN GAP]` (R5).

### Option A: send through the user's MCP server (OD2, D8, D9)

- **FR-050** **Send recipes.** Settings > Contacts > *Send through MCP* lists recipes (at most 20): `id` (`r-` and 8), `label`, `channelKind` (`teams`, `slack`, `email`, `other`), `server` (an MCP server name as the agent apps list it), `tool` (a tool name), `args` (a JSON object template, at most 2,000 characters, whose string values may contain exactly the placeholders `{{to}}` and `{{text}}`, each at most once; no other placeholder; numbers, booleans and nested objects allowed as constants). *Add recipe…* lets the user pick the server and the tool from a running session's list (`agents:mcpTools`, spec 069 FR-032) or type them, and write the template; the dialog says *Durbar cannot read this tool's arguments. Check your server's documentation; Durbar fills in only {{to}} and {{text}}.* A recipe with `{{text}}` missing is refused.
- **FR-051** **When A is offered.** In the preview, *Send now through <server>* shows only when: the channel names a recipe; this chat is a live main chat; its session lists that server as running (the `mcp` event); its agent app passes MCP tool arguments to Durbar's broker (capability `mcpCallArgs`: Copilot `true` and Claude Code `true` by `read:` of their request shapes, Codex `false` until checked, R6); no turn is running; the agent is not at a limit; the chat's mode is Ask or Allow all, **not Read-only** (D9: *Option A is not available in Read-only. Use Open in Teams, or switch this chat to Ask first.*). Otherwise the button is absent and a line says why (*m365 is not running in this chat*, *Codex does not show Durbar a tool's arguments yet*, *The agent is busy*). The preview also says *Uses one reply of <agent> (AI credits).*
- **FR-052** **The ticket.** At preview time (FR-030), main fills the template (`{{to}}` with the channel's `to`, `{{text}}` with the checked text; JSON string escaping only), computes the canonical JSON (keys sorted, no spaces) and its SHA-256, and binds both to the `previewId`. Only when `contacts:sendMcp(previewId)` is accepted (FR-083, FR-084, and the mode is still not Read-only) does main give the session's broker a single-use ticket `{server, tool, argsHash, expires: now + 120 s}`. Tickets are kept in memory only, at most 1 per session at a time (a second *Send now* waits), never a grant, dropped at session end.
- **FR-053** **The instruction.** Main then sends the agent one message built only from fixed text and the filled call: *Agent Durbar: the user asked you to make exactly one MCP tool call and nothing else. Call the tool "<tool>" of the MCP server "<server>" once, with exactly these arguments, unchanged: ```json <canonical arguments>```. Do not call any other tool. Then reply with one short line saying whether it worked.* It shows in the chat as a Durbar line (*Asked <agent> to send it through <server>*), not as the user's bubble. When the ticket expires unused: *The agent did not send it; nothing was sent.*
- **FR-054** **The broker (D9).** `BrokerOptions` gets `messageTools?: () => { keys: ReadonlySet<string>; take(req): boolean }`; keys are built like `mcpToolBlockList` (`<server>/<tool>`, `mcp__<server>__<tool>`, `<server>-<tool>`) from every recipe. In `request`, right after the turned-off check (`permissions.ts:353`) and **before** the read and Allow all shortcuts, a `mcp` request for a message tool: (a) in Ask and Allow all, when `take(req)` finds a live ticket with the same server, tool and canonical-arguments hash (`PermissionLike` gets `args?: unknown`; Copilot's request already carries `args`, Claude Code's `permissionLikeOf` adds the tool input), it is approved once, the ticket is used up and a `resolved` event with `via: 'contacts'` is emitted (the user's press of *Send now* is the approval). In Read-only no ticket exists (D9): `setMode('read-only')` drops every live ticket, and a message-tool request is denied as today; (b) otherwise it is a pending card in Ask **and in Allow all**, with the line *This tool sends messages to people* and its arguments shown masked and cut (spec 052 FR-063's pending-only rule), without *Approve for this session*; in Read-only it is denied as today. A test runs every mode against matching, changed, expired, used and missing tickets, and a ticket made before a switch to Read-only.
- **FR-055** **The result.** Main watches the session's `toolCall` events for that call (server and tool, after the ticket was used): a success gives the line *Sent to Paco on Teams, 10:43* (D13); a failure *Could not send to Paco on Teams: <reason masked and cut to 120>*; no result within 120 s after approval: *Sent the call; the server did not say whether it worked.* The log records the outcome (FR-081).
- **FR-056** `[KNOWN GAP]` **Read-only hints.** Copilot runs an MCP tool its server marks `readOnlyHint: true` without asking Durbar (`docs/agent-notes.md`, spec 044, `real:`), so neither the ticket nor D9's hold sees it. A send tool wrongly marked read-only cannot be held. The recipe dialog says so; Durbar cannot detect the hint (`McpToolInfo` has name and description only, `src/adapters/types.ts:318`).

### Ask the agent to write it (US6, D11)

- **FR-060** **The button** *Ask <app> to write it (1 prompt)* shows in the preview when the chat's agent app has `generateText` (capability, `src/adapters/capabilities.ts:64`). The prompt is fixed text plus: the masked brief (the field's text, FR-033's masking), the contact's first name, the masked *How to talk to them* notes, the channel kind and its rough limit (*a short chat message*, *an email*). It asks for the message only, no preamble.
- **FR-061** **The result** replaces the field's text (masked for display, cut to 4,000), with *Undo* (back to the brief). It is never sent by itself; FR-033 applies. Errors show in the dialog (masked). One prompt per press; while it runs the button reads *Writing…* and the confirming button is disabled.
- **FR-062** The brief and the notes go to the agent app's model like a chat message; nothing else of the contact (addresses, other channels) is in the prompt.

### Import from Teams (US5, FX4, D12)

- **FR-070** **Opt-in.** *Import from Teams…* in Settings > Contacts needs an **import recipe** (FR-050's form with `kind: 'import'`, server and tool, and a constant arguments template, no placeholders) and a live main chat to run it in (picked in the dialog; its session must list the server). The first dialog (`askDialog`, *Cancel* focused) says: *Durbar will ask <agent> to call "<tool>" of "<server>" once. It reads the people that tool returns (names, email addresses and Teams ids). Only the people you tick are kept: name, email and Teams address. On a work account, your company's rules may not allow copying contacts; check before you continue.* and *Uses one reply of <agent> (AI credits).*
- **FR-071** **The call** uses FR-052..FR-054's preview, ticket and instruction (a read tool is gated the same way); like A it is not offered in Read-only (D9). Durbar reads the **tool's result** from the session's `toolCall` event (main's masked copy), never the agent's prose, at most 1 MB.
- **FR-072** **Parsing**, tolerant (`src/shared/teamsimport.ts`): JSON text or a JSON block inside the result; arrays of objects, also under `value`, `people`, `users`, `contacts` or `results`; a person needs a display name (`displayName`, `name`) and one email shape (`mail`, `email`, `userPrincipalName`, `scoredEmailAddresses[0].address`); at most 500 people; everything is checked with FR-004. The pick list (`askDialog` `picks`, `need: {picks: 1}`) shows name and email, nothing ticked, already-known emails greyed with *Already a contact*.
- **FR-073** **Kept**: for each ticked person, a contact with `name`, an `email` channel and a `teams` channel with the same UPN, `source: 'teams-import'`. The parsed list and the raw result are dropped from memory when the dialog closes; nothing of them is logged.

### The send log and the sent line (FX5, D13)

- **FR-080** **The sent line.** After a send attempt, the chat shows a Durbar line (not a bubble, not sent to the agent) with a small SVG send icon drawn with the theme's tokens and the words: C: *Opened Teams for Paco, 10:42* (or *Opened Slack for Paco; the text is on the clipboard*); A: *Sent to Paco on Teams, 10:43*; failures as FR-046 and FR-055. The icon has no meaning without the words (constitution V). Live only: a resumed session's history does not show it `[KNOWN GAP]`; Settings > Contacts > *Recent sends* does.
- **FR-081** **The send log**, `<userData>/contacts/sendlog.json` (0600, atomic), at most 500 entries (oldest dropped): `at`, `contactId`, the contact's name at that time, `kind`, `via` (`link`, `link-copy`, `mcp`), `outcome` (`opened`, `open-failed`, `sent`, `failed`, `not-sent`, `blocked-secret`), `chars` (the text's length). **Never the text, a digest of it, an address or a session id** (FX5). *Clear* empties it.
- **FR-082** **Durbar's own logs** (FX5, Paco's review of PR #707). Nothing about a send is written to the debug log or the activity log except the outcome word and the channel kind. The arguments of a **message tool** call (a recipe's tool, whoever called it) are left out of the activity log and the debug log: the entry keeps the server, the tool and the outcome, and the arguments become *(message arguments not logged)*. A test plants a known text in a message tool's arguments, runs the call through the broker, the `toolCall` events and both logs, and finds it in neither file. The chat's tool chip shows the arguments masked and cut, live only, as today.
- **FR-083** **A trusted click** (D18). Main keeps, per app window, the time of the last trusted `input-event` that is a mouse-up or a key-up of Enter or Space (`webContents.on('input-event')` reports real input sent to the page, not events made by page script; `read:` Electron `webContents` docs, the same event spec 080 uses in `src/main/browser/viewcap.ts`). `contacts:open`, `contacts:sendMcp`, `contacts:importRun` and `contacts:draft` are accepted only when such an event came within 1 s before the call, from the app window's main frame, and the `previewId` is live (60 s), unused and bound to the same contact, channel, recipient, text and call; a `previewId` is used up by its first accepted call. Refusals give a fixed reason and nothing is opened, copied or sent. **Reachability**: only the app window's main frame reaches `contacts:*` (`fromApp`); remote control (spec 054), schedules (`src/main/schedules.ts`), Durbar's MCP server (spec 041, `src/main/mcp/tools.ts`) and the session browser's views (spec 080) have no path to them. A static test checks that every `contacts:*` handler uses `fromApp`, that only `src/main/ipc/contacts.ts` imports the contacts send functions (not `remoteops.ts`, `schedules.ts`, `mcp/*`, `browser/*`), and that the MCP tool registry lists no contacts tool. `[KNOWN GAP]` (honest limit, Paco's review of PR #707): the check proves a real mouse-up or Enter/Space on the app window within 1 s, not that it landed on the preview's Send button, so script running in the app page could spend another click inside that second. The renderer is part of Durbar's trusted UI; this rule raises the bar against a compromised or confused page, it does not make the renderer untrusted-safe.
- **FR-084** **Rate limit** (D18). Main allows at most 5 sends per minute and 30 per hour (option C opens, option A calls and imports together, counted when accepted), from `CONTACTS_LIMITS`; over the limit: *Too many sends in a short time. Wait a minute.* and a log entry `outcome: 'rate-limited'` (no text). *(The numbers are a default pending owner confirmation, Q5.)*

### Simulator, IPC and UI rules

- **FR-085** **IPC (constitution III).** Window-only channels (`fromApp`), every argument validated in main: `contacts:list()`, `contacts:save(contact, rev)`, `contacts:delete(id, rev)`, `contacts:star(id, on)`, `contacts:move(id, dir)`, `contacts:preview(agentId, contactId, channelId, text, way)`, `contacts:open(previewId, {copyOnly?})`, `contacts:sendMcp(previewId)`, `contacts:draft(agentId, contactId, channelId, brief)`, `contacts:recipes()`, `contacts:saveRecipe(recipe)`, `contacts:deleteRecipe(id)`, `contacts:importRun(previewId)` (after `contacts:preview` with the import recipe), `contacts:importAdd(token, picks)`, `contacts:log()`, `contacts:clearLog()`, `contacts:export()`, `contacts:deleteAll()`. The window never passes a URL, a path, a server or tool name for a send (only ids); the sending channels follow FR-083 and FR-084; main sends `contacts:changed` after a change.
- **FR-086** **Simulator (constitution IV, spec 010).** The canned bridge keeps contacts in memory (`simcontacts=none|some|many|hostile`: 0; 5 with 2 favourites and every kind; 300; addresses with CR/LF and look-alikes); `contacts:open` records the URL it would open and shows *Demo: would open Teams for Paco*; under `DURBAR_SIM` main never calls `shell.openExternal` or the clipboard for contacts (an injected opener; a test checks the real one is not reachable in a sim build). `FakeAdapter` gets a fake message server `sim-teams` with `send-chat-message` and `list-people` tools that record calls in memory and answer canned results. **Zero real sends in any test**: no test reaches Teams, Slack, a mail app or Telegram.
- **FR-087** **UI rules (constitution V).** Text at least 10.5px; states with icon and word; motion CSS-only and off under reduced motion; every control named; with the drawer open and a chip set, 15 agents fit at 1440x900 and 1280x800 with the chat open (`check:office`); the chip fits a 480px panel (it cuts the name with an ellipsis and a tooltip). Screenshots at both sizes (`DURBAR_SIM=15`).
- **FR-088** **Credits.** Option C, the store and the UI use none. Option A, the import and drafting use one agent reply each, said on their buttons before the press.

### Out of scope

- **FR-090** `[LATER]` **Groups** (a group contact, or a Teams group chat with `users=a,b`, `topicName`). The link format allows it (R1); deferred to keep the confirmation about one person (D17).
- **FR-091** `[LATER]` **Agent suggestions** ("send this to Paco" proposed by the agent): needs a Durbar MCP change tool (spec 041; `CHANGE_TOOLS_ENABLED = false`, `src/main/mcp/tools.ts`) that only fills a draft preview; its own spec delta.
- **FR-092** `[LATER]` Slack, Google, vCard or CSV import.
- **FR-093** `[LATER]` *Send this note to…* in spec 083's note `⋯` menu; today a note is inserted, then `@`.
- **FR-094** `[LATER]` WhatsApp (`https://wa.me/<number>?text=`), SMS, phone calls.
- **FR-095** **Option B**, Durbar's own OAuth connectors (OD3). Never in this spec.
- **FR-096** Reading replies or presence of contacts; anything that reads messages.
- **FR-097** `[LATER]` A direct MCP call without a model turn (Copilot SDK 1.0.22 `session.rpc.mcp.apps.callTool`, `@experimental`, needs the `mcp-apps` capability and a matching `originServerName`, `read:` `dist/generated/rpc.d.ts`); needs a probe and its own delta.

### Key Entities

- **Contact**: FR-002. Global; 0..8 channels; may be a favourite with an order.
- **Channel**: FR-003. One way to reach a person; may name a send recipe.
- **Send recipe / import recipe**: FR-050, FR-070. Server, tool, arguments template.
- **Ticket**: FR-052. In memory, single use, 120 s.
- **Send log entry**: FR-081. No text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** From a typed message to the opened Teams chat takes at most 4 actions (`@pa`, Enter on the row, Enter, *Open in Teams*), checked by the driver.
- **SC-002** No token shape from `scripts/test-redact.ts`'s corpus, and no known folder or session secret value, planted in the box, the draft or the notes, reaches a built URL, the clipboard, a ticket's arguments, the instruction, the store or the log (unit and driver checks).
- **SC-003** No hostile address of FR-004's list (non-ASCII look-alikes included), and no text, can make `buildContactLink` produce a URL that does not start with an entry of `CONTACT_LINK_ALLOWLIST` or that has an extra parameter (unit test, 10,000 generated inputs; the test imports the constant, it does not copy it).
- **SC-004** A message tool call runs without a card only with a matching live ticket, in Ask or Allow all; Read-only has no ticket and denies it; Allow all never approves one by itself (unit test over modes × ticket states).
- **SC-005** With `simcontacts=many` the `@` picker filters in under 50 ms of the renderer's own time (CPU-time rules of `docs/agent-notes.md`).
- **SC-006** With the drawer open and a chip set, `check:office` passes at 1440x900 and 1280x800 with 15 agents.
- **SC-007** Zero real sends and zero AI credits in `npm test` and CI.
- **SC-008** No `contacts:open`, `contacts:sendMcp`, `contacts:importRun` or `contacts:draft` call is accepted without a live `previewId` and a trusted input event within 1 s, or past 5 per minute and 30 per hour (unit tests with a fake clock and fake input events).

## Assumptions

- The user has the target apps; Durbar only opens links or asks an agent the user already runs.
- Microsoft's documented Teams chat link keeps working; the `msteams:` variant is not relied on by default.
- MCP servers for Microsoft 365, Slack or Gmail exist and the user configures them in their agent app (spec 058/069); Durbar does not recommend or install one.
- One Durbar window per process; two processes are handled by FR-007.

## Honest limits

- Built and checked on the simulator and in unit tests only. No deep link has been opened on Windows or macOS; on-device checks are Linux only (constitution VI). Which apps register `slack:` on Linux, and whether Teams opens from the browser link on each OS, is `read:` documentation, not seen.
- Option C cannot know the message was sent: the line says *Opened*, not *Sent*.
- Option A depends on the agent following the instruction; when it changes the call, the user gets a card instead of a send. It costs one agent reply. Codex is not offered until its request arguments are checked. A tool marked read-only by its server bypasses the hold on Copilot (FR-056).
- The secret check misses what is neither a known value nor a known shape (as 083's limits).
- Slack and over-cap sends use the clipboard, which other programs and clipboard managers can read.
- The Teams import reads what the user's MCP server returns; Durbar cannot know a company's policy.
- **The agent app keeps its own history** (Paco's review of PR #707). Option A's instruction and the message tool call put the text and the recipient into the agent app's own session history, in plain text, and send them to its model provider; drafting sends the brief and the notes to the model. Durbar's FX5 covers only Durbar's own files and logs; the preview says so (FR-030a).
- **Sends Durbar does not start** (Paco's review of PR #707). FX1 covers sends that Durbar starts and the tools a recipe names. An agent that calls an MCP send tool that no recipe names follows the normal mode rules: Allow all approves it without asking, Ask shows the usual card, Read-only denies it.
- `read:` only for the code facts above; no real agent session, no real send, no real MCP server was used.

## Owner questions (few; defaults are written, nothing waits)

- **Q1** D10: a secret blocks the send with no override (default). Or allow *Send anyway* after a second confirmation? **Owner answer (Ruben, 2026-10-24, DM to his coordinator: "Ok" to the defaults): the default stands.**
- **Q2** FR-051: option A uses one agent reply per send (default). Acceptable, or should A wait for a direct call (FR-097)? **Owner answer (Ruben, 2026-10-24, DM to his coordinator: "Ok" to the defaults): the default stands.**
- **Q3** D5: Teams links open in the browser by default (documented); the `msteams:` app link is an opt-in marked *not checked*. Keep? **Owner answer (Ruben, 2026-10-24, DM to his coordinator: "Ok" to the defaults): the default stands.**
- **Q4** D9: allow option A (and the Teams import) in Read-only? Default: no. A yes needs a constitution III amendment first (a task like spec 080's T006, and a Complexity Tracking entry in the plan). **Owner answer (Ruben, 2026-10-24, DM to his coordinator: "Ok" to the defaults): the default stands.**
- **Q5** FR-084: the rate limit, 5 sends per minute and 30 per hour (default). Other numbers? **Owner answer (Ruben, 2026-10-24, DM to his coordinator: "Ok" to the defaults): the default stands.**

## Changes

### 2026-10-24: review fixes (Paco's review of PR #707, request changes; decided by the coordinator under Ruben's delegation)

*Found by:* Paco's agent's review of PR #707 at faf524af. *Corrected* (before anything was built):

1. **A proven click (D18, FR-030, FR-083, FR-084, FR-085, SC-008).** Two steps in main: `contacts:preview` returns a single-use `previewId` (60 s) bound to contact, channel, recipient, text and call; `contacts:open` / `sendMcp` / `importRun` / `draft` need a trusted `input-event` within 1 s. Remote control, schedules, the MCP server and the session browser cannot reach `contacts:*` (static test). Rate limit 5 per minute, 30 per hour.
2. **Read-only (D9, FR-051, FR-054, FR-071).** Option A and the import are not offered in Read-only; option C still works; switching to Read-only drops live tickets. Before: a ticket approved the call in every mode. Owner question Q4 added.
3. **What A sends (FR-030a, FR-052).** The call is filled at preview time; the preview shows server, tool and the canonical arguments exactly as hashed, and that the text and the recipient go to the agent's model provider.
4. **FX5 narrowed (FX5, FR-082, Honest limits).** FX5 covers Durbar's own files and logs; message-tool arguments are left out of the activity and debug logs (with a test); the agent app's history is an honest limit.
5. **Look-alike addresses (FR-004, SC-003).** Email and UPN addresses are ASCII only; non-ASCII look-alikes are in SC-003's corpus.
6. **Sends Durbar does not start (Honest limits).** An MCP send tool no recipe names follows the normal mode rules.
7. **One allow-list (FR-040, SC-003).** `CONTACT_LINK_ALLOWLIST` in `src/shared/contactlinks.ts`; SC-003's test imports it.
