# Implementation Plan: Contacts (a contacts book, and send the message box to a person)

**Branch**: `084-contacts` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

Main gets a small global contacts store (one JSON file and a send log in `<userData>/contacts/`, 0600, atomic writes, masked notes) and a window-only IPC module that takes ids only. A pure link builder makes Teams, email, Slack and Telegram links from stored contacts (allow-listed prefixes, a 2,000-character cap), and main opens them with `shell.openExternal` after the user confirms an `askDialog` preview that blocks text that looks like a secret. The window adds Settings > Contacts, a Contacts drawer in the chat (sharing spec 083's drawer frame), an `@` picker reusing the `/` list, and a recipient chip that turns Send into *Preview*. Later phases add option A (a send recipe, a single-use broker ticket, and a message-tool hold in every mode), the Teams import through the same ticket path, and drafting with `generateText`.

## Technical Context

- **Language**: TypeScript (main, shared, adapters), plain JS renderer. **No new dependency.**
- **Storage**: `<userData>/contacts/contacts.json` and `sendlog.json` (folder 0700, files 0600).
- **Testing**: `scripts/test-contacts.ts` (model, store), `scripts/test-contactlinks.ts` (links, hostile inputs, SC-003), `scripts/test-contacts-broker.ts` (tickets and modes, SC-004), `scripts/test-teamsimport.ts`; additions to `test-redact`, `test-ipcchannels`, `test-slashcommands`; driver `scripts/check-contacts.js` (in `ui-suite.js`); `check:office`.
- **Platforms**: `shell.openExternal` on all three; the cap is the same everywhere (D7); mode bits only on POSIX; no shell, no `xdg-open` call of our own.
- **Performance**: contacts load once per window and on `contacts:changed`; the picker filters in memory (≤ 300; SC-005).

## Reused capabilities (AGENTS.md: look for an existing capability first)

- **Picker**: `#slashList` element, `placeSlash`, `slashKey` keyboard rules, `slashsuggest.js` (`filter`, `optionHtml`, `tip`; `tokenAt` gets a trigger-character parameter) (`src/renderer/app.js:2036-2116`).
- **Dialogs**: `askDialog` (`input.multiline`, `input.check`, `picks`, `need`, `size: 'l'`, `warn` focus rule) for the preview, recipes, import and deletes; the *Send to several sessions* pattern (`app.js:2855`).
- **Menus**: `#modeMenu` / `.mode-menu`, `placeMenu` (`app.js:2191`) for the chip's *Change channel*.
- **Drawer**: spec 083 FR-020's frame (`chatDrawer(kind)`); built here if 083 has not landed (T021).
- **Masking**: `redact`, `redactMarkdown`, `DurbarSafeText`; known values `secretValuesFor` (`src/main/mcpipc.ts:82`) and `extraSecretValues` (`src/main/mcp/readtools.ts:47`); 083's `maskNoteText` core when present.
- **Store patterns**: `FolderSetupStore` (atomic, 0600, tolerant read, `src/main/foldersetupstore.ts`), `randomPlaceId` (uniform ids, `src/main/settings.ts:24`).
- **IPC**: the module pattern of `src/main/ipc/*.ts` with `ipcguard` `fromApp`; `app:openExternal` is not touched.
- **MCP**: `mcp` status events (spec 058), `agents:mcpTools` (spec 069 FR-032), `mcpToolBlockList` key shapes (`src/adapters/permissions.ts:242`), `outward()` masked `toolCall` events (`src/main/main.ts:191`).
- **One prompt**: `oneShotFor` / `generateText` (`src/main/main.ts:678`, spec 040 FR-015).
- **Settings**: `screens.js` sections; Ctrl+K entries; `DurbarNav.rank`.
- **Simulator**: `sim.ts` canned bridge; `FakeAdapter` MCP fakes (spec 069).

## Constitution Check

| Principle | How this plan complies |
| --- | --- |
| I Spec Kit | This spec, plan and tasks first; deltas in 005 (chat panel, composer), 003/018 (broker message tools, tickets), 073 (`@` trigger), 083 (shared drawer frame), 080 (a note that FR-024 is unchanged) (T001). |
| II Adapters are plug-ins | Contacts code knows no vendor: links are by channel kind; option A uses normalized `permission`, `toolCall` and `mcp` events and a capability flag `mcpCallArgs`; adapters only pass `args` on `PermissionLike`. |
| III Safe, no secrets | FX1..FX5: a preview made in main with *Cancel* focused before every send; a single-use `previewId` and a trusted `input-event` within 1 s for every send, and a 5 per minute / 30 per hour limit (D18, FR-083, FR-084); only the app window reaches `contacts:*` (not remote control, schedules, the MCP server or the session browser); the secret check in window and main, no override; tickets are single-use, in memory, exact, and **never made in Read-only**, so Read-only still denies every MCP call (D9: option A and the import are not offered there; option C opens a link and calls no tool); message tools never auto-approved, Allow all included; no Durbar MCP client (no tokens); main builds URLs that must start with an entry of `CONTACT_LINK_ALLOWLIST`; no shell; 0600 store; Durbar's logs hold no message text or message-tool arguments (FX5 as narrowed, FR-082). |
| IV No credits | C, store and UI need none; A, import and drafting are user-pressed, one reply each, said on the button; every test uses the simulator, `FakeAdapter` and stubbed openers (FR-086, SC-007). |
| V Calm UI | Drawer inside the panel; nothing on the office floor; 10.5px; icon plus words (no emoji, D13); keyboard and names; chip fits 480px; 15 agents at both sizes (FR-087). |
| VI Parity | One URL cap on every OS (D7); `shell.openExternal` everywhere; Linux handler gaps written as `[KNOWN GAP]`. |
| VII Gates | `typecheck`, `build`, `npm test`; a new store and broker logic each get tests (VII.3); screenshots. |
| VIII Honest limits | *Opened* vs *Sent*; spec *Honest limits*; no OS check claimed. |

No violation; no Complexity Tracking entry. If the owner answers yes to Q4 (option A in Read-only), that is an exception to principle III: it needs a constitution amendment task before any code, and a Complexity Tracking entry here.

## Data model

### `contacts/contacts.json`

```text
{ "version": 1,
  "contacts": [ {
      "id": "p-[a-z0-9]{12}", "name": "1..80", "aliases": ["≤5 × 1..32"], "initials": "1..2",
      "favourite": false, "favOrder": 0, "notes": "≤ 1,000, masked",
      "channels": [ { "id": "ch-[a-z0-9]{8}", "kind": "teams|slack|email|telegram", "label": "≤ 40",
                      "upn": "…" | "team": "T…", "user": "U…", "handle": "…" | "address": "…" | "username": "…",
                      "recipe": "r-…", "to": "≤ 200" } ],
      "preferred": "ch-…", "source": "typed|teams-import",
      "createdAt": "ISO UTC", "updatedAt": "ISO UTC", "rev": 1 } ],
  "recipes": [ { "id": "r-[a-z0-9]{8}", "kind": "send|import", "label": "≤ 40",
                 "channelKind": "teams|slack|email|other", "server": "≤ 128", "tool": "≤ 128",
                 "args": "JSON object text ≤ 2,000; send: {{to}}, {{text}} once each; import: no placeholders" } ],
  "settings": { "teamsApp": false } }
```

### `contacts/sendlog.json`

```text
{ "version": 1, "entries": [ { "at": "ISO UTC", "contactId": "p-…", "name": "≤ 80", "kind": "teams|…",
  "via": "link|link-copy|mcp", "outcome": "opened|open-failed|sent|failed|not-sent|blocked-secret", "chars": 0 } ] }
```

No text, digest, address or session id (FR-081).

### Ticket (memory only)

`{ sessionId, server, tool, argsHash: sha256(canonicalJson(args)), expires, purpose: 'send'|'import', logRef }`, at most one per session. Never made while the session is in Read-only; `setMode('read-only')` drops it.

### Preview (memory only)

`{ previewId (random, 128 bits), agentId, contactId, channelId, recipient, text, way: 'link'|'link-copy'|'mcp'|'import', url? | {server, tool, canonicalArgs, argsHash}?, expires: now + 60 s, used: false }`. Used up by the first accepted call (FR-083).

## Modules

- `src/shared/contacts.ts`: `CONTACTS_LIMITS`, `parseContactsDoc`, `cleanContact` (FR-002..FR-004 checks), `applyChange` (rev), `favOrder` moves, `guessInitials`, `fillTemplate`, `canonicalJson`. Pure.
- `src/shared/contactlinks.ts`: `buildContactLink(channel, text, opts) → {url, encodedLength, copyText?, prefill} | {error}`; `CONTACT_LINK_ALLOWLIST` (the one list of allowed prefixes, FR-040); `emailParts(text)`. Pure, tested from any OS.
- `src/shared/redact.ts`: `maskOutgoing(text, values)` (shares the core of 083's `maskNoteText`).
- `src/shared/teamsimport.ts`: `parsePeople(text) → {people, dropped}`. Pure.
- `src/main/contactsstore.ts`: the store (load, save, queue, merge on outside change, bad-file rename, log append and cap).
- `src/main/ipc/contacts.ts`: FR-085 channels; previews, the trusted-input clock (from the app window's `input-event`, FR-083) and the rate limit (FR-084); injected `opener`, `clipboard`, `now`, `lastTrustedInput`; sim stubs; tickets via the session's broker.
- `src/main/activitystore.ts` and the debug sink: message-tool arguments replaced by *(message arguments not logged)* (FR-082).
- `src/adapters/permissions.ts`: `PermissionLike.args`, `BrokerOptions.messageTools`, the check in `request` (FR-054).
- `src/adapters/claude.ts` (`permissionLikeOf` adds `args`), `capabilities.ts` (`mcpCallArgs`), `fake.ts` (`sim-teams`).
- Renderer: `src/renderer/contacts.js` (Settings section, drawer content, chip, preview), small hooks in `app.js` (`@` trigger next to `slashUpdate`, the chip in the composer and `keepDraft`, the Send label), `screens.js` (section), `sim.ts` (canned bridge), `styles.css` (theme tokens only).

## IPC

As FR-085. Each handler: `fromApp(e)` (the app window's main frame only); sending handlers also need a live `previewId` and a trusted input within 1 s (FR-083) and pass the rate limit (FR-084); ids checked against the store; `agentId` looked up in main's `agents` map (live, main chat, not a helper); text a string ≤ 4,000; FR-033 check in main; results `{ok, error?, outcome?}` with fixed error words (never echoing text).

## Phases

1. **MVP** (US1, US2, US3): T010..T017 foundation (T017: proven click, rate limit, reachability), T020..T026 UI and option C.
2. **Option A** (US4): T030..T035.
3. **Teams import** (US5): T040..T042.
4. **Drafting** (US6): T050..T051.
5. **Docs and converge**: T060..T062.

Phases 2..4 depend only on the MVP, except that T040 uses T030..T033's ticket path.

## Risks

- **The agent does not follow the instruction** (A): falls back to a card (FR-054); the test checks the card, not the agent.
- **083 not landed**: T021 builds the drawer frame; whichever spec lands second reuses it (both tasks say so).
- **Template mistakes** (A): a wrong argument name makes the server fail; the line shows the masked reason (FR-055).
- **Clipboard** (Slack, over cap): readable by other programs; said in the preview and the honest limits.
