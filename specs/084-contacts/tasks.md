---
description: "Tasks for spec 084: contacts, and sending the message box to a person"
---

# Tasks: Contacts (a contacts book, and send the message box to a person)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Prerequisites**: Ruben's owner decisions OD1..OD3 and fixed rules FX1..FX5 (binding) and the coordinator's D1..D18 are recorded in spec.md (revised after Paco's review of PR #707). No task waits for an answer: Q1..Q5 have written defaults (Q4 = no: option A is not offered in Read-only); a different answer changes a default, not the structure.

**Rules for every task**:

- simulator, `FakeAdapter` and `npm test` only; zero AI credits; no real session, no `npm run smoke`, no `scripts/capture-raw.ts`;
- **zero real sends**: no test or manual check opens Teams, Slack, a mail app or Telegram, or calls a real MCP server; openers and the clipboard are injected and stubbed;
- no shell; the window never passes a URL, a path, or a server or tool name for a send (ids only);
- never log message text, addresses, contact notes, tool arguments or secret values; fake tokens in tests are built at run time;
- `npm run typecheck && npm run build && npm test` green;
- UI tasks: `npm run check:office`, screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15`, and `npm run shots:docs -- --only <drivers>` for linked pictures that show the change;
- renderer comments write "issue 701", never `#701` (theme-token ratchet).

## Format: `[ID] [P?] [Story] Description [FRs]` then the acceptance criteria

---

## Phase 0: Spec deltas

- [ ] T001 [P] Dated `## Changes` entries in the owning specs, each pointing to 084. [FR-020..FR-025, FR-040, FR-054]
  - AC1: spec 005: the Contacts drawer over `#chat` (shared frame with 083), *Contacts…* in the More menu, the recipient chip and the *Preview for…* Send label.
  - AC2: spec 003/018: message tools held in every mode (Allow all included) unless a live ticket matches; tickets approve once in Ask and Allow all and are never made in Read-only; no session grant for message tools; `PermissionLike.args`.
  - AC3: spec 073: the picker's `@` trigger and contact source (a separate list on the same element).
  - AC4: spec 083: the drawer frame is shared; Notes and Contacts close each other.
  - AC5: spec 080: a line under FR-024 saying contacts links are a separate main-built path and FR-024 is unchanged.
  - AC6: `npm run specs:check` passes.

## Phase 1: Foundation for the MVP (blocks US1..US3)

- [ ] T010 [P] Pure contact model in `src/shared/contacts.ts`. [FR-002..FR-006, FR-005]
  - AC1: `parseContactsDoc` keeps valid contacts, drops a bad one and keeps the rest; returns an error for an unknown version, non-JSON or a document over the derived byte cap.
  - AC2: `cleanContact` refuses each FR-004 hostile address (CR, LF, `?cc=`, `&message=`, `%0A`, `,`, `;`, quotes, `javascript:`, a full-width or other look-alike `@`, any non-ASCII character such as a Cyrillic `а` or Greek `ο` in the local part or domain, a full-width dot, a zero-width space) with the field's reason, and accepts plain ASCII `local@domain` up to 254 characters; Slack and Telegram ids follow their FR-003 patterns.
  - AC3: `applyChange` refuses a stale `rev` with `stale`; refuses the 301st contact, the 9th channel and the 6th alias with their reasons.
  - AC4: star, unstar, move up and move down keep `favOrder` a dense order; the sorted list is favourites by `favOrder`, then by name (locale compare).
  - AC5: `CONTACTS_LIMITS` is the only place with caps (a static test finds no other cap number in the contacts modules); byte caps are derived; a store at every cap writes and reads back, one character more is refused before any write.
  - AC6: ids `p-`/`ch-`/`r-` come from an injected uniform random function (no modulo bias).
  - AC7: `scripts/test-contacts.ts` (new `test:contacts`, added to `npm test`) covers AC1..AC6.
- [ ] T011 [P] Link builder `src/shared/contactlinks.ts`. [FR-040..FR-045, SC-003]
  - AC1: Teams gives exactly `https://teams.microsoft.com/l/chat/0/0?users=<enc upn>&message=<enc text>`; with `teamsApp` the `msteams:/l/chat/0/0?…` form.
  - AC2: email gives `mailto:<address>?subject=<enc first line ≤ 78, cut at a word>&body=<enc rest>` with line breaks `%0D%0A`; one line: empty subject, body = text.
  - AC3: Slack gives `slack://user?team=<T…>&id=<U…>` and `copyText` = the text, `prefill: false`.
  - AC4: Telegram gives `https://t.me/<username>?text=<enc text>`.
  - AC5: a URL over 2,000 characters gives `{error: 'too-long', encodedLength}`, and the `copyOnly` form drops `message`/`body`/`text`.
  - AC6: `CONTACT_LINK_ALLOWLIST` is the one constant with the five prefixes of FR-040 (a static test finds no other copy of them in `src/`); every result starts with one of its entries; 10,000 generated channels and texts (Unicode, emoji, RTL, `&`, `#`, `%`, CR/LF, NUL) and FR-004's hostile addresses (non-ASCII look-alikes included) never give another prefix or an extra query parameter (parse the result with `URL` and compare its parameter names; the test imports the constant) (SC-003).
  - AC7: `scripts/test-contactlinks.ts` (new `test:contactlinks`) covers AC1..AC6; it runs on all three CI OSes.
- [ ] T012 [P] `maskOutgoing(text, values)` in `src/shared/redact.ts`. [FR-033, SC-002]
  - AC1: masks known values (≥ 4 characters, longest first), then `redact`, then `redactMarkdown` token runs; returns the masked text and `changed`.
  - AC2: every token shape of `test-redact`'s corpus planted in a message, inside Markdown and split by `**` or a backtick, gives `changed: true`.
  - AC3: plain text with `release_notes`, emails and issue numbers gives `changed: false`.
  - AC4: if 083's `maskNoteText` exists, both share one core (a test calls both on the corpus and compares); `redact.ts` still has no imports.
- [ ] T013 Store `src/main/contactsstore.ts`. [FR-001, FR-007, FR-008, FR-081]
  - AC1: creates `contacts/` 0700 and files 0600 on POSIX (checked with `stat` in a temp `userData`); atomic `wx` temp + rename.
  - AC2: two stores on one file: an outside change is re-read and merged by `id` before a write; a stale `rev` is refused (1,000 random operations, no lost or resurrected contact).
  - AC3: an unreadable file (bad JSON, unknown version, over cap, a FIFO or link) is never overwritten; *Start over* renames it to `.bad-<UTC>` 0600.
  - AC4: the send log keeps at most 500 entries, oldest dropped, and has exactly FR-081's fields (a test fails if any other key, the text, or an `@` address appears).
  - AC5: notes are stored masked (a planted token never reaches the file).
- [ ] T014 IPC `src/main/ipc/contacts.ts`, preload and `src/shared/api.ts` types (MVP channels). [FR-085, FR-040, FR-033, FR-046]
  - AC1: `contacts:list/save/delete/star/move/preview/open/log/clearLog/export/deleteAll` registered with `fromApp`; `test-ipcchannels` lists them.
  - AC2: `contacts:preview` takes ids and text only, looks up the agent (a main chat, not a helper), runs `maskOutgoing` with that chat's known values and refuses `blocked: secret` when changed, builds the link with T011 and returns a `previewId` bound to contact, channel, recipient, text and URL; `contacts:open(previewId)` opens exactly that URL, and the injected opener is called only with a result that starts with a `CONTACT_LINK_ALLOWLIST` entry.
  - AC3: Slack and `copyOnly` write the masked final text to the injected clipboard before opening.
  - AC4: an opener rejection gives `outcome: 'open-failed'` and a log entry; the error text returned is a fixed sentence.
  - AC5: under `DURBAR_SIM` the opener and clipboard are recording stubs; a test proves `shell.openExternal` and `clipboard.writeText` are not called (spy on the injected real ones).
  - AC6: `app:openExternal` is unchanged (a test still refuses `mailto:`, `slack:` and `msteams:` there).
- [ ] T017 Proven click, rate limit and reachability in `src/main/ipc/contacts.ts`. [FR-083, FR-084, FR-085, SC-008]
  - AC1: main records the time of the last trusted `input-event` (mouse-up, key-up of Enter or Space) of the app window (injected source in tests); `contacts:open`, `sendMcp`, `importRun` and `draft` are refused without one in the last 1 s, with an expired (60 s), used or unknown `previewId`, or with a `previewId` of another agent; each refusal opens, copies and sends nothing (spy on opener, clipboard and adapter `send`).
  - AC2: a `previewId` is used up by its first accepted call; a second call with it is refused; an edited text needs a new preview.
  - AC3: the 6th accepted send within a minute and the 31st within an hour are refused with FR-084's text and logged `rate-limited` (fake clock); the numbers come from `CONTACTS_LIMITS`.
  - AC4: a static test: every `contacts:*` handler uses `fromApp`; only `src/main/ipc/contacts.ts` imports the contacts send functions (none of `remoteops.ts`, `ipc/remote.ts`, `schedules.ts`, `mcp/*`, `browser/*` do); the MCP tool registry (`src/main/mcp/tools.ts`) lists no contacts tool.
  - AC5: a session-browser view's `webContents` and a sub-frame are refused by `fromApp` for `contacts:*` (unit test with fake senders).
- [ ] T015 [P] Simulator bridge in `src/renderer/sim.ts`. [FR-086]
  - AC1: `simcontacts=none|some|many|hostile` load 0, 5 (2 favourites, every kind), 300, and hostile addresses (refused on save, shown as such).
  - AC2: `contacts:open` records the URL and toasts *Demo: would open Teams for Paco*; nothing is written to disk.
- [ ] T016 [P] Picker helper: `slashsuggest.js` `tokenAt` takes a trigger character; `@` only at a word start. [FR-021]
  - AC1: `@pa` at the start, after a space or `(` gives a token; `ruben@example.com`, `x@pa` and a lone `@` do not.
  - AC2: the `/` behaviour is unchanged (`test-slashcommands` passes untouched plus new `@` cases).

## Phase 2: MVP UI and option C (US1, US2, US3)

- [ ] T020 [US1] Settings > Contacts section in `screens.js` + `src/renderer/contacts.js`. [FR-010..FR-014]
  - AC1: list (favourites first in order, then by name), search, *Add contact…*, *Edit…*, *Star*, *Move up/down*, *Delete…* (*Cancel* focused); empty text as FR-010.
  - AC2: the form shows only the fields of each channel kind; a refused field shows its reason (`role="alert"`) and the form does not save.
  - AC3: *Open Teams links in* choice saved (`settings.teamsApp`), its *not checked* note shown.
  - AC4: the *What Durbar does not do* list has FR-014's line.
  - AC5: reachable from Ctrl+K *Contacts*; keyboard only, every control named (driver).
- [ ] T021 [US2] The chat drawer frame and the Contacts drawer. [FR-020, FR-024, FR-025]
  - AC1: if 083's drawer frame exists, Contacts uses it; else T021 builds `chatDrawer(kind)` covering `#chat` only, and 083's tasks are told in a comment on the PR.
  - AC2: opened by *Contacts…* in More and Ctrl+K; Esc closes the drawer first, then the chat; Notes and Contacts close each other.
  - AC3: Favourites row: first 6 in order with *Send the box* (disabled with *Type a message first* on an empty box), *All favourites…*; then search and the rest with *Send the box* and *Set as recipient*; *Manage contacts…*.
  - AC4: helper and read-only VS Code chats: buttons disabled with the reason.
- [ ] T022 [US1] `@` picker and recipient chip. [FR-021..FR-023, SC-001, SC-005]
  - AC1: `@pa` lists matching contacts, favourites first in order, at most 8 rows, on the `#slashList` element; `/` and `@` lists never both show.
  - AC2: picking removes `@pa` and sets the chip *→ Paco (Teams)* with *Change channel* (shared menu) and ×; another pick replaces it.
  - AC3: with a chip, Send reads *Preview for Paco…* (label, name and tooltip), Enter opens the preview, and no `sendMessage` / `sendLive` call happens (driver spies on the bridge's send).
  - AC4: × or Backspace in an empty box removes the chip; the chip survives a chat switch (`keepDraft`) and not a restart.
  - AC5: with `simcontacts=many` the filter stays under 50 ms renderer CPU time (SC-005).
- [ ] T023 [US1] The preview and the C send. [FR-030..FR-034, FR-040..FR-046]
  - AC1: `askDialog` `size: 'l'` with title, channel line, how line per kind, editable text (≤ 4,000), the confirming button per kind drawn `primary warn` so *Cancel* has the focus; Esc cancels.
  - AC2: the live secret check disables the confirming button with FR-033's sentence and offers *Use the masked text*; a test where the window skips the check gets `blocked: secret` from main.
  - AC3: the encoded-length counter; over 2,000 the button becomes *Copy the text and open the chat*.
  - AC4: email shows *Subject:* and *Body:* as built; Slack says the text is copied.
  - AC5: after a confirmed open the box is emptied, the chip removed, focus in the box; on *Cancel* both stay.
- [ ] T024 [US1] The sent line and Recent sends. [FR-080, FR-081, FR-082]
  - AC1: an SVG send icon (theme tokens, ≥ 12px) and the words *Opened Teams for Paco, 10:42* (or the Slack, failure variants); never an emoji; never sent to the agent (driver checks the bridge's send was not called).
  - AC2: Settings > Contacts > *Recent sends* lists the log (name, kind, way, outcome, time) and *Clear* empties it.
  - AC3: a grep test finds no contact text, address or argument in debug or activity log calls of the contacts modules.
  - AC4: message-tool arguments are left out of the activity log and the debug log (*(message arguments not logged)*): a test plants a known text in a message tool's arguments, runs the call through the broker and the `toolCall` events with the real activity store and debug sink on a temp folder, and finds the text in neither file (FR-082).
- [ ] T025 [US1..US3] Driver `scripts/check-contacts.js` (in `ui-suite.js`). [SC-001, SC-006, FR-087]
  - AC1: US1 end to end on the simulator in ≤ 4 actions, with the recorded Teams URL equal to the expected string.
  - AC2: US2 favourites order across Settings, drawer and picker.
  - AC3: US3 email, Slack (clipboard stub got the text) and the over-cap path.
  - AC4: `check:office` passes at 1440x900 and 1280x800 with the drawer open and a chip set; the chip fits a 480px panel; text ≥ 10.5px.
- [ ] T026 [US1] Screenshots at 1440x900 and 1280x800 (`DURBAR_SIM=15`, `simcontacts=some`): Settings > Contacts, the drawer, the `@` picker with a chip, the preview; new drivers in `DOC_SHOTS` for any picture the README links.

## Phase 3: Option A, send through the user's MCP server (US4)

- [ ] T030 Broker message tools and tickets in `src/adapters/permissions.ts`. [FR-054, SC-004]
  - AC1: `PermissionLike.args?: unknown`; `BrokerOptions.messageTools` with `keys` (the `mcpToolBlockList` shapes) and `take(req)`.
  - AC2: the check runs right after `blockedMcp` and before the read and Allow all branches.
  - AC3: a live ticket with the same server, tool and canonical-arguments hash approves once in Ask and Allow all, emits `resolved` with `via: 'contacts'`, and is used up (a second identical call is not approved by it).
  - AC4: in Read-only no ticket can be given (refused), `setMode('read-only')` drops live tickets, and every message-tool request is denied.
  - AC4b: no ticket, an expired one, a used one, or different arguments: pending card in Ask and Allow all (never `auto`), denied in Read-only; the pending info carries masked, cut arguments and no session-grant scope; a test fails if *Approve for this session* is possible.
  - AC5: `scripts/test-contacts-broker.ts` (new) runs modes × ticket states; a mutation that moves the check after the Allow all branch fails it.
- [ ] T031 [P] Adapters pass arguments; capability `mcpCallArgs`. [FR-051, FR-054]
  - AC1: Claude's `permissionLikeOf` adds `args: input` for `mcp` (unit test); Copilot's raw request keeps `args` (unit test with a canned request).
  - AC2: `capabilities.ts` gets `mcpCallArgs`: Copilot and Claude `true`, Codex `false` with a comment pointing to research R6.
  - AC3: no vendor type leaks into `src/shared` or the renderer (existing lint/test).
- [ ] T032 Recipes: model, Settings UI and IPC. [FR-050, FR-085]
  - AC1: `contacts:recipes/saveRecipe/deleteRecipe`; a template must be a JSON object ≤ 2,000 with `{{text}}` once and `{{to}}` at most once, only in string values; otherwise refused with the reason.
  - AC2: *Add recipe…* lists the servers and tools of a running session (`agents:mcpTools`) or takes typed names; shows the *cannot read this tool's arguments* note and FR-056's read-only note.
  - AC3: `fillTemplate` escapes the text as a JSON string only; `canonicalJson` sorts keys; a text with quotes, backslashes and `}}` fills correctly (round trip with `JSON.parse`).
- [ ] T033 `contacts:sendMcp`: ticket, instruction, result. [FR-051..FR-055]
  - AC1: refused with its reason when the session does not run the server, the capability is false, the chat is in Read-only, a turn runs, or the agent is at a limit.
  - AC1b: `contacts:preview` with way `mcp` fills the call and returns the server, the tool and the canonical arguments exactly as hashed (the same string the ticket hashes; a test compares them) for FR-030a's lines; `contacts:sendMcp(previewId)` follows T017.
  - AC2: makes one ticket (120 s) only when `sendMcp` is accepted, sends the FR-053 instruction with the canonical arguments, and shows *Asked <agent> to send it through <server>* as a Durbar line, not a user bubble.
  - AC3: success, failure (masked, cut to 120), no result and expiry give FR-055's lines and log outcomes.
  - AC4: a second *Send now* while a ticket is live waits or is refused with *A send is already waiting*.
- [ ] T034 [P] `FakeAdapter` `sim-teams` server. [FR-086]
  - AC1: tools `send-chat-message` and `list-people`; calls recorded in memory; canned success, error and slow results.
  - AC2: emits `mcp` permission requests with `args`, so T030's real broker path runs in the driver.
  - AC3: a fake "agent" mode that changes one argument, to show FR-054's card.
- [ ] T035 [US4] Preview A button and driver cases in `check-contacts.js`. [FR-030, FR-051, SC-004]
  - AC1: *Send now through sim-teams* shows only under FR-051's conditions (not in Read-only, with its reason), with *Uses one reply of <agent> (AI credits).*, the server, the tool, the canonical arguments block and *The text and the recipient go to <agent>'s model provider…* (FR-030a).
  - AC2: driver: Allow all + changed argument shows the card; Ask + ticket sends; Read-only offers only *Open in Teams*; the sent line says *Sent to Paco on Teams*.

## Phase 4: Import from Teams (US5)

- [ ] T040 [P] `src/shared/teamsimport.ts` `parsePeople`. [FR-072]
  - AC1: accepts arrays at the top or under `value`, `people`, `users`, `contacts`, `results`; JSON inside a fenced block; picks name and email from FR-072's fields.
  - AC2: at most 500 people; every email checked with FR-004; duplicates by email merged; a 1 MB hostile input parses in linear time (CPU-time rule).
  - AC3: `scripts/test-teamsimport.ts` (new).
- [ ] T041 `contacts:importRun` / `contacts:importAdd`. [FR-070, FR-071, FR-073]
  - AC1: needs an import recipe and a live main chat in Ask or Allow all running its server (not offered in Read-only); `contacts:preview` with way `import`, then `importRun(previewId)` under T017, then the T033 ticket path with `purpose: 'import'`.
  - AC2: reads the tool's result from the masked `toolCall` event (≤ 1 MB), never the agent's reply.
  - AC3: `importAdd` takes a one-time token and the picked indexes only; stores name, email channel and Teams channel, `source: 'teams-import'`; the parsed list is dropped when the dialog closes (a test checks the token cannot be reused).
- [ ] T042 [US5] Import dialogs and driver case. [FR-070, FR-072]
  - AC1: the first dialog has FR-070's text (server, tool, what is read, work-account warning, credits), *Cancel* focused.
  - AC2: the pick list has nothing ticked, known emails greyed *Already a contact*, *Add N contacts* needs one pick.
  - AC3: driver on `sim-teams` `list-people`: tick 3, exactly 3 added.

## Phase 5: Ask the agent to write it (US6)

- [ ] T050 `contacts:draft`. [FR-060..FR-062]
  - AC1: only when the chat's agent app has `generateText`; one call through `oneShotFor`; the prompt holds fixed text, the masked brief, the first name, the masked notes and the channel kind, and nothing else of the contact (a test inspects the prompt).
  - AC2: the result is masked for display and cut to 4,000; errors are masked.
  - AC3: unit test with a fake `generateText`; zero credits.
- [ ] T051 [US6] The preview's draft button. [FR-060, FR-061]
  - AC1: *Ask <app> to write it (1 prompt)*; *Writing…* while it runs, confirming button disabled; *Undo* back to the brief.
  - AC2: a draft with a secret shape is blocked by FR-033 like typed text (driver with a fake draft).

## Phase 6: Docs and converge

- [ ] T060 Docs. 
  - AC1: README feature list and *Safety model* (sends need a preview; message tools always ask, Allow all included; option C opens apps; option A uses one agent reply); known limits from spec *Honest limits*.
  - AC2: `changelog.d/084-contacts.md`; `npm run changelog:check`.
  - AC3: `docs/agent-notes.md` entry: the deep-link facts (Teams `message`, Slack has no pre-fill, Telegram `text`, `mailto` `%0D%0A`, Electron's 2,081 Windows cap) with `read:` sources.
  - AC4: `npm run shots:docs -- --only <drivers>` for linked pictures that show the chat panel or Settings.
- [ ] T061 Spec status: tick tasks, `[IMPLEMENTED]` tags, the `specs-index` block; note on #559 that its export needs a *Contacts* choice (FR-009).
- [ ] T062 `/speckit.converge`: spec, plan and tasks match what was built; open `[KNOWN GAP]`s listed in the PR.
- [ ] T063 *(only if the owner answers yes to Q4)* Constitution III amendment allowing a ticketed, user-clicked MCP call in Read-only (`/speckit.constitution`, version bump, Sync Impact Report), a Complexity Tracking entry in plan.md, and FR-051/FR-054/FR-071 changed; before any code that offers A in Read-only.

## Dependencies

- T010..T017 before Phase 2; T017 after T014. T011, T012 before T014. T016 before T022. T020 before T021's *Manage contacts…*.
- T030, T031 before T033; T032 before T033; T034 before T035.
- T017 before T023, T033, T041 and T050. T033 before T041; T040 before T041.
- T014 before T050.
- Phases 3, 4 and 5 can run in parallel after Phase 2, except T041 after T033.
