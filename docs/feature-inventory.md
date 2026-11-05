# Feature inventory

One row per thing a user can do or see. [features.md](features.md) stays the user-facing text; this table says where each feature works. Spec 025 FR-021, owner request 2026-11-01. `npm run test:featureinventory` checks it.

- **Flat**, **Real office**: `works`, `in PR` (branch named in the proof), `planned` (in a spec, not built), `missing` (nobody wrote it down, or decided out). A short note may follow the word.
- **Worlds**: arrangement worlds (spec 098/102), any of `mock`, `planned`, `built`, or `none`; a registry moment in `( )` must exist in [world-moments.json](experience/world-moments.json). `built` needs the registry's `code: present`.
- **Parity** (spec 021 FR-078, owner decision 2026-11-04): every world has what Flat has, characters included. A row where Flat is `works` needs, in **Real office** (shipped before the rule), a cell that is plain `works` or names its issue (`#NNN`); in every other offered world (the choices of Settings > Office layout > World, read from `src/renderer/crew.js`) the Worlds cell must be `built`. **Plain `works`**: the note after `works` has none of the words *only, partly, partial, partially, no, not, missing, without, except* (such a note admits a gap or an unchecked part, so the cell names its issue). **Owner decision**: a cell may carry exactly `(owner decision, YYYY-MM-DD)` (a real date) or `(owner decision, #NNN)` instead; it waives only the cell it is written in, so a Real office decision does not waive the Worlds cell, nor the reverse (a world's exception goes in the Worlds cell, after its state). Any other `(owner decision …)` form fails. The check is offline: it does not confirm that an issue exists or is open. `npm run test:featureinventory` fails otherwise.
- **Proof** (each row needs one, all must resolve): `test:NAME` = the `test:NAME` script of package.json; `driver:NAME` = `scripts/NAME.js`; `read:PATH` = source read, not run. Real office and worlds cells come from the 2026-11-01 parity audit (`read:`), the simulator run excepted.
- **Upkeep**: a PR that adds, changes or removes a user-visible feature updates its row.

| Feature | Flat | Real office | Worlds | Specs | Proof |
|---|---|---|---|---|---|
| Desk: name, role, status word, task | works | works | mock+planned (desk-card) | 001 034 097 | test:mood driver:shots-097-realoffice |
| Moods and trouble signs (heavy, monster, siren); Serious mode hides them and only them (not motion, issue #1182) | works | works pose, dots and lights only; heavy, monster and siren missing (#1171) | mock+planned (desk-lights) | 034 097 | test:mood read:src/renderer/realoffice.js |
| Helpers (sub-agents): card, tree, own chat, needs you | works | missing, only `+N` and 3 dots; planned as small figures beside the desk (#1139) | planned | 001 015 097 | test:helpercard read:src/renderer/realoffice.js |
| Live activity on the desk | works | works, monitors show the newest output (PR 979) | mock+planned (live-screen) | 001 097 | test:liveact driver:shots-001-live-activity |
| Model, tokens, cost, context, last tool on the desk | works | missing (#1148) | none | 019 097 | test:ctxbreakdown read:src/renderer/realoffice.js |
| Unread "New", draft, question marks | works | planned New reply tag and green light bar (097 FR-237, FR-238; #1150); draft and question marks missing (#1149) | none | 001 005 | test:unread read:src/renderer/realoffice.js |
| Hover card | works | missing, tooltip only (#1151) | none | 001 097 | test:tooltip read:src/renderer/realoffice.js |
| Drag to rearrange rooms, desks, places | works | missing (#1152) | none | 033 | test:roomorder driver:shots-033-order |
| Rename a session (F2, pencil) | works | works, the pencil beside a plate's name and F2 on a plate (059 FR-170) | none | 059 | test:sessionname driver:check-097-plate-pencil |
| Lobby places, visitors, away at a place | works | works | mock+planned (lobby) | 024 | test:places driver:shots-024 |
| Boss queue, Bank, Postbox | works | works | mock+planned (boss-bank-post-coffee) | 001 024 | driver:shots-001-lobby read:src/renderer/realoffice.js |
| Coffee break at a usage limit | works | works | planned (coffee-bar) | 068 | test:coffeebreak driver:shots-068-coffee |
| Finished agents rest in the lounge | works | missing, rest at the desk (owner decision, 2026-10-31) | planned (lounge) | 001 097 | read:docs/experience/world-moments.json |
| Floors, lift, All floors, Focus mode | works | works | mock+planned (lift-panel) | 033 092 | test:floors test:floornav driver:shots-092-lift |
| Status pills as filters | works | works | none | 001 | driver:shots-001-welcome read:src/renderer/app.js |
| Room doors (cabin signs) | missing, removed by owner decision (#954) | missing, removed | none | 017 | driver:check-no-doors |
| Waiting desk halo (a still glow behind the screen) | works, still since #1057 | missing, the call light replaces it (owner decision, 2026-11-04) | none | 001 | driver:check-001-halo |
| Motion (default on): Settings > Motion stops walking, typing and lights; reduced motion does too, Serious mode does not (issue #1182) | works | works, the whole room stands still | none | 052 | driver:check-serious-motion driver:check-097-motion |
| Still highlights (no motion): Settings > Highlights | works | works, the whole room stands still | none | 001 | test:stillhighlights driver:check-unread |
| Simple / Expert switch and the "Do you write code?" question | missing, removed by owner decision (#1060) | missing, removed | none | 052 | driver:shots-052-ux |
| Old app-level MCP servers in the folder extras dialog | missing, removed (#1058) | missing, removed | none | 020 | driver:shots-m10 |
| Room menu: New session, Schedules, Rename, Cost, Move | works | works, the app's own room menu on the folder sign | none | 001 006 | driver:shots-005-cardmenu read:src/renderer/realoffice.js |
| Full-screen chat, other agents in the rail (List, folders collapse) | works | works, in PR 097-chat-in-world for the world's own frame (rail not checked there, #1172) | mock+planned (chat-open) | 005 | test:innerscroll test:railorder driver:check-rail driver:shots-005-cardmenu |
| Reopening a long chat is fast: older messages are skipped until near the view; the end is followed while a turn streams | works, simulator only | works, chat only (window chrome, no office drawing); not checked with a world on (#1172) | none | 005 | driver:check-chat-visibility |
| Chat reads well in every world: a resumed session's chat has the same look; sub-agent chat text is readable | works | missing, a resumed session lacks the look (#1140); sub-agent text unreadable over the photo (#1146) | none | 005 097 | read:src/renderer/app.js |
| Thinking, tool calls, Markdown | works | works | mock+planned (chat-shell) | 015 016 | test:markdown test:events |
| File edits as they happen, Undo these changes | works | works | none | 065 | test:edits test:checkpoints |
| Attachments (pick, drop, paste) | works | works | none | 004 | test:attachments |
| Browser tab in a chat | works | works | none | 080 | test:browsertabs test:browserpane |
| Questions and permission cards | works | works | mock+planned (permission-card) | 003 012 | test:elicit test:permissions driver:shots-012-elicit |
| Needs-you inbox | works | works | planned (inbox) | 052 | test:attention read:src/renderer/app.js |
| Modes Read-only, Ask first, Allow all; switch any time | works | works | none | 003 018 | test:permissions driver:shots-018 |
| Plan first | works | works | none | 066 | test:planmode |
| Slash suggestions | works | works | none | 073 | test:slashcommands |
| Send to several sessions | works | works | none | 064 | driver:shots-064-send-several test:sessionname |
| Add folder or workspace, create or clone a folder | works | works | none | 006 093 | test:newfolder driver:shots-093 |
| Resume after restart, Since you were away, crash card | works | works | none | 006 | test:crashmarker driver:shots-006-crash |
| Previous sessions, search | works | works | none | 006 | test:sessionsearch driver:shots-006-prevmarks |
| Notes per folder | works | works | none | 083 | test:notes |
| Scheduled prompts, loops | works | works | none | 044 072 | test:schedules test:loops |
| Custom agents and profile files | works | works | none | 043 | test:agentprofiles test:profileeditor |
| Folder status (branch, changes), session summary | works | works | none | 063 085 | test:gitstatus test:sessionsummary |
| Continue in another app, VS Code chat history | works | works | none | 009 030 | test:handoff test:vscodechat |
| Open with menu (installed VS Code editions, Show in folder) and Open in editor | works | works, same chat header | none | 009 | test:openwith driver:shots-009-openwith |
| Keyboard navigator, Ctrl+K palette | works | works | none | 074 | test:navigator driver:shots-074-navigator |
| Model, effort and Auto routing | works | works | none | 007 030 | test:modelchoice test:modelswitch |
| Context ring and Compact | works | works | none | 019 034 | test:compaction test:ctxbreakdown |
| MCP servers: state, sign-in, restart, global | works | works | none | 019 058 061 069 | test:mcphealth test:mcpsignin test:mcpglobal driver:shots-058-mcp-launch |
| MCP problems strip at launch (reason, fix, Show, Dismiss) | works | works, the same strip above the office (driver); not checked with a world on (#1172) | none | 058 | driver:shots-058-mcp-launch test:mcpwords |
| MCP sign-ins refreshed before a message after a quiet hour (waiting line, sign-in line, Settings switch) | works | works, chat and Settings only (window chrome, no office drawing); not checked with a world on (#1172) | none | 058 | test:mcpsigninrefresh driver:shots-058-mcp-signin-refresh |
| Tools and Cost tabs | works | works | none | 019 020 | test:toolstats test:usagetotals |
| Credit caps and usage display | works | works | planned (limit-card) | 011 | test:credits test:usagestore driver:shots-012-cost-cap |
| OS sandbox floor | works | works | none | 087 | test:runtime-sandbox |
| Themes and user themes | works | missing (#1153) | none | 035 036 037 038 039 040 | test:theme test:userthemes |
| One face per agent: rail row, chat header, inbox faces are the same picture | works | works (one picker, `roFace`) | none | 097 | driver:check-097-one-face |
| Characters (crews): the Characters choice drawn in the office | works | missing, only the Office people are drawn; every other crew shows them (#1154) | none | 077 096 | test:characters test:crew |
| Harness setup, agent-app updates | works | works | none | 051 081 | test:harnesssetup test:updatecheck |
| Remote control | works | works | none | 054 | test:remote driver:shots-054-remote |
| Terminal tab in a chat | planned | planned | none | 094 | read:specs/094-terminal-tab/spec.md |
| Next built-in world: aisle layout | missing | works, built behind the closed `retro` flag (PR 1006 was closed; code is on main) | planned | 102 | read:specs/102-worlds-on-demand/spec.md |

Exempt: 002 008 010 013 025 045 050 062 (not user features: adapters, packaging, simulator, live checks, docs rule, security sweep, website, real-account CI checks). Any other spec with `status: built` must be in a row.
