# Feature inventory

One row per thing a user can do or see. [features.md](features.md) stays the user-facing text; this table says where each feature works. Spec 025 FR-021, owner request 2026-11-01. `npm run test:featureinventory` checks it.

- **Flat**, **Real office**: `works`, `in PR` (branch named in the proof), `planned` (in a spec, not built), `missing` (nobody wrote it down, or decided out). A short note may follow the word.
- **Worlds**: arrangement worlds (spec 098/102), any of `mock`, `planned`, `built`, or `none`; a registry moment in `( )` must exist in [world-moments.json](experience/world-moments.json). `built` needs the registry's `code: present`.
- **Proof** (each row needs one, all must resolve): `test:NAME` = the `test:NAME` script of package.json; `driver:NAME` = `scripts/NAME.js`; `read:PATH` = source read, not run. Real office and worlds cells come from the 2026-11-01 parity audit (`read:`), the simulator run excepted.
- **Upkeep**: a PR that adds, changes or removes a user-visible feature updates its row.

| Feature | Flat | Real office | Worlds | Specs | Proof |
|---|---|---|---|---|---|
| Desk: name, role, status word, task | works | works | mock+planned (desk-card) | 001 034 097 | test:mood driver:shots-097-realoffice |
| Moods and trouble signs (heavy, monster, siren) | works | works pose, dots and lights only | mock+planned (desk-lights) | 034 097 | test:mood read:src/renderer/realoffice.js |
| Helpers (sub-agents): card, tree, own chat, needs you | works | missing, only `+N` and 3 dots | none | 001 015 097 | test:helpercard read:src/renderer/realoffice.js |
| Live activity on the desk | works | in PR 097-p2-screens | mock+planned (live-screen) | 001 097 | test:liveact driver:shots-001-live-activity |
| Model, tokens, cost, context, last tool on the desk | works | missing | none | 019 097 | test:ctxbreakdown read:src/renderer/realoffice.js |
| Unread "New", draft, question marks | works | missing | none | 001 005 | test:unread read:src/renderer/realoffice.js |
| Hover card | works | missing, tooltip only | none | 001 097 | test:tooltip read:src/renderer/realoffice.js |
| Drag to rearrange rooms, desks, places | works | missing | none | 033 | test:roomorder driver:shots-033-order |
| Rename a session (F2, pencil) | works | works F2 and menu, no pencil | none | 059 | test:sessionname read:src/renderer/app.js |
| Lobby places, visitors, away at a place | works | works | mock+planned (lobby) | 024 | test:places driver:shots-024 |
| Boss queue, Bank, Postbox | works | works | mock+planned (boss-bank-post-coffee) | 001 024 | driver:shots-001-lobby read:src/renderer/realoffice.js |
| Coffee break at a usage limit | works | works | planned (coffee-bar) | 068 | test:coffeebreak driver:shots-068-coffee |
| Finished agents rest in the lounge | works | missing, rest at the desk (decided) | planned (lounge) | 001 097 | test:rooms read:docs/experience/world-moments.json |
| Floors, lift, All floors, Focus mode | works | works | mock+planned (lift-panel) | 033 092 | test:floors test:floornav driver:shots-092-lift |
| Status pills as filters | works | works | none | 001 | driver:shots-001-welcome read:src/renderer/app.js |
| Room doors (cabin signs) | works, removal in PR 017-remove-doors | works | none | 017 | test:doors |
| Room menu: New session, Schedules, Rename, Cost, Move | works | works on the folder sign | none | 001 006 | driver:shots-005-cardmenu read:src/renderer/realoffice.js |
| Full-screen chat, other agents in a strip | works | works, in PR 097-chat-in-world for the world's own frame | mock+planned (chat-open) | 005 | test:innerscroll driver:shots-005-cardmenu |
| Thinking, tool calls, Markdown | works | works | mock+planned (chat-shell) | 015 016 | test:markdown test:events |
| File edits as they happen, Undo these changes | works | works | none | 065 | test:edits test:checkpoints |
| Attachments (pick, drop, paste) | works | works | none | 004 | test:attachments |
| Browser tab in a chat | works | works | none | 080 | test:browsertabs test:browserpane |
| Questions and permission cards | works | works | mock+planned (permission-card) | 003 012 | test:elicit test:permissions driver:shots-012-elicit |
| Needs-you inbox | works, rework in PR 052-needs-you-panel | works | planned (inbox) | 052 | test:attention read:src/renderer/app.js |
| Modes Read-only, Ask first, Allow all; switch any time | works | works | none | 003 018 | test:permissions driver:shots-018 |
| Plan first | works | works | none | 066 | test:planmode |
| Slash suggestions | works | works | none | 073 | test:slashcommands |
| Send to several sessions | works | works | none | 064 | driver:shots-064-send-several test:sessionname |
| Add folder or workspace, create or clone a folder | works | works | none | 006 093 | test:newfolder driver:shots-093 |
| Resume after restart, Since you were away, crash card | works | works | none | 006 | test:crashmarker driver:shots-006-crash |
| Previous sessions, search | works, search in PR 001-room-search | works | none | 006 | test:sessionsearch driver:shots-006-prevmarks |
| Notes per folder | works | works | none | 083 | test:notes |
| Scheduled prompts, loops | works | works | none | 044 072 | test:schedules test:loops |
| Custom agents and profile files | works | works | none | 043 | test:agentprofiles test:profileeditor |
| Folder status (branch, changes), session summary | works | works | none | 063 085 | test:gitstatus test:sessionsummary |
| Continue in another app, VS Code open and history | works | works | none | 009 030 | test:handoff test:vscodechat |
| Keyboard navigator, Ctrl+K palette | works | works | none | 074 | test:navigator driver:shots-074-navigator |
| Model, effort and Auto routing | works | works | none | 007 030 | test:modelchoice test:modelswitch |
| Context ring and Compact | works | works | none | 019 034 | test:compaction test:ctxbreakdown |
| MCP servers: state, sign-in, restart, global | works | works | none | 019 058 061 069 | test:mcphealth test:mcpsignin test:mcpglobal |
| Tools and Cost tabs | works | works | none | 019 020 | test:toolstats test:usagetotals |
| Credit caps and usage display | works | works | planned (limit-card) | 011 | test:credits test:usagestore driver:shots-012-cost-cap |
| OS sandbox floor | works | works | none | 087 | test:runtime-sandbox |
| Themes and user themes | works, court and Corporate removal in PR 035-remove-court-corporate | missing | none | 035 036 037 038 039 040 | test:theme test:userthemes |
| Characters and crews | works | works | none | 077 096 | test:characters test:crew |
| Harness setup, agent-app updates | works | works | none | 051 081 | test:harnesssetup test:updatecheck |
| Remote control | works | works | none | 054 | test:remote driver:shots-054-remote |

Exempt: 002 008 010 013 025 045 050 (not user features: adapters, packaging, simulator, live checks, docs rule, security sweep, website). Any other spec with `status: built` must be in a row.
