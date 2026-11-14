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
| Moods and trouble signs (heavy, monster, siren); Serious mode hides them and only them (not motion, spec 052 FR-069) | works | works pose, dots and lights only; heavy, monster and siren missing (#1171) | mock+planned (desk-lights) | 034 097 | test:mood read:src/renderer/realoffice.js |
| Helpers (sub-agents): card, tree, own chat, needs you | works | works, in the Photo office clay-toy kids on the desk top at 1 to 4 agents (up to 6, then `+K`; 097 FR-368..FR-373) and kid faces in the head row at 5 to 15; small adult head figures with a status dot under each desk plate in the cave and Retro arcade at 1440x900; where the room is too small for a strip (15 agents in 5 folders at 1280x800, the arcade at 1280x800, 20 or more agents) the plate keeps `+N` and dots by design (spec 097 FR-308, FR-338) | planned | 001 015 097 | test:helpercard test:realoffice-layout driver:check-097-helpers driver:check-097-kids |
| Live activity on the desk | works | works, monitors show the newest output (PR 979) | mock+planned (live-screen) | 001 097 | test:liveact driver:shots-001-live-activity |
| Model, tokens, cost, context, last tool on the desk | works | works in the hover zoom (PR 1272, 097 FR-312..FR-315), and a line round the monitor frame that fills clockwise as the context fills, soft white up to 90 % and red above (097 FR-322..FR-326, owner Q8) | none | 019 097 | test:ctxbreakdown driver:shots-097-screens driver:check-097-ctx-frame |
| Unread "New", draft, question marks | works | works, a New reply tag and a green screen (097 FR-236, FR-238), a Draft tag and "unsent draft" in the plate's name (097 FR-316); a question shows as the "?" bubble, the plate's text and "needs you" (FR-038, FR-016) | none | 001 005 097 | test:unread driver:shots-097-realoffice driver:check-097-desk-marks |
| Hover card | works | works, the zoom opens over the person, desk, table, monitor or plate, also for asleep agents, with the Changed line (097 FR-327..FR-330); helpers stay with the desk's own tiles, as in Open office (Q25 decided, 2026-11-08) | none | 001 097 | test:tooltip driver:check-097-hover-card |
| Drag to rearrange rooms, desks, places | works | works by dragging a name plate or a folder sign, by keys and the folder menu, a lobby place by a visitor's chip or the +N menu, the same saved order; the arcade drags desks, its rooms keep their cells (PRs 1315 and 1394, 097 Q30..Q33) | none | 033 097 | test:roomorder driver:shots-033-order driver:check-097-order driver:check-097-drag |
| Rename a session (F2, pencil) | works | works, the pencil beside a plate's name and F2 on a plate (059 FR-170); an arcade cabinet's at its plate's right end, edited over the marquee (097 FR-357) | none | 059 | test:sessionname driver:check-097-plate-pencil |
| Lobby places, visitors, away at a place | works | works | mock+planned (lobby) | 024 | test:places driver:shots-024 |
| Boss queue, Bank, Postbox | works | works | mock+planned (boss-bank-post-coffee) | 001 024 | driver:shots-001-lobby read:src/renderer/realoffice.js |
| Coffee break at a usage limit | works | works | planned (coffee-bar) | 068 | test:coffeebreak driver:shots-068-coffee |
| Finished agents rest in the lounge | works | works, a lounge row under the desks: done and read agents seated beside a small monitor, asleep after 10 minutes (097 FR-246..FR-249, owner decision 2026-11-06) | built (lounge) | 001 097 | test:realoffice-layout driver:check-097-lounge |
| Floors, lift, All floors, Focus mode | works | works | mock+planned (lift-panel) | 033 092 | test:floors test:floornav driver:shots-092-lift |
| Status pills as filters | works | works | none | 001 | driver:shots-001-welcome read:src/renderer/app.js |
| Room doors (cabin signs) | missing, removed by owner decision (#954) | missing, removed | none | 017 | driver:check-no-doors |
| Waiting desk halo (a still glow behind the screen) | missing, the screen's tint replaces it (owner decision, 2026-11-05) | missing, the screen's tint replaces it (owner decision, 2026-11-05) | none | 001 | driver:check-001-lights |
| Status screen tint: the monitor screen amber when an agent needs you, orange at its limit, red on an error, green with an unread reply | works | works | none | 001 097 | driver:check-001-lights driver:shots-097-realoffice |
| Motion (default on): Settings > Motion stops walking, typing and lights; reduced motion does too, Serious mode does not (spec 052 FR-069) | works | works, the whole room stands still | none | 052 | driver:check-serious-motion driver:check-097-motion |
| Settings section list on the left: jumps within the page, follows the scroll, built from the rendered headings (FR-226) | works | works | none | 052 | test:settingsnav driver:check-settings-nav |
| Team templates: Settings > Team templates, list, Duplicate, Delete, starters, member editor (simulator only, not yet available in the app until *Use…* and the create preview, 111 T010) | works, in the simulator only | works, the same Settings page | none | 111 | test:teams-ui test:teams-editor driver:shots-111-templates driver:shots-111-editor |
| Still highlights (no motion): Settings > Highlights | works | works, the whole room stands still | none | 001 | test:stillhighlights driver:check-unread |
| Simple / Expert switch and the "Do you write code?" question | missing, removed by owner decision (#1060) | missing, removed | none | 052 | driver:shots-052-ux |
| Old app-level MCP servers in the folder extras dialog | missing, removed (#1058) | missing, removed | none | 020 | driver:shots-m10 |
| Room menu: New session, Schedules, Rename, Cost, Move | works | works, the app's own room menu on the folder sign | none | 001 006 | driver:shots-005-cardmenu read:src/renderer/realoffice.js |
| Full-screen chat, other agents in the rail (List, folders collapse) | works | works, the world's own frame is merged (PR 1001); the rail beside a full-screen chat (List, folders collapse) was run in the Photo office at 1440x900 and 1280x800 on macOS, 2026-11-09, simulator, with a throwaway driver wrapper; dark theme and DPR 2 were not run (#1424) | mock+planned (chat-open) | 005 | test:innerscroll test:railorder driver:check-rail driver:check-rail-resize test:composersize driver:shots-005-cardmenu |
| Reopening a long chat is fast: older messages are skipped until near the view; the end is followed while a turn streams | works, simulator only | works, chat only (window chrome, no office drawing); run in the Photo office at 1440x900 and 1280x800 on macOS, 2026-11-09 (4003 of 4004 messages skipped on reopen at 1440, simulator); the end followed while a turn streams is asserted by the driver, with no picture; dark theme and DPR 2 were not run (#1424) | none | 005 | driver:check-chat-visibility |
| A long chat stays light: its newest 300 messages are kept | works, simulator only | works, simulator | none | 005 | test:chattrim driver:check-chat-memory |
| A finished helper is not kept forever: each agent keeps its newest 50 done and 20 failed, a line says how many are gone | works, simulator only | works, simulator (Linux) | none | 005 | test:subretire driver:check-helper-retention |
| Chat reads well in every world: a resumed session's chat has the same look; sub-agent chat text is readable | works | works, every chat follows the Office layout setting, a resumed session included (PR 1164; spec 097, driver check-097-chat-look), and chat text is measured against the pixels behind it (PR 1197; driver check-097-chat-contrast) | none | 005 097 | driver:check-097-chat-look driver:check-097-chat-contrast read:src/renderer/app.js |
| Thinking, tool calls, Markdown | works | works | mock+planned (chat-shell) | 015 016 | test:markdown test:events |
| File edits as they happen, Undo these changes | works | works | none | 065 | test:edits test:checkpoints |
| Attachments (pick, drop, paste) | works | works | none | 004 | test:attachments |
| Browser tab in a chat | works | works | none | 080 | test:browsertabs test:browserpane |
| Expand the chat's browser to fill the window, and back (Esc) | works | works, Photo office and Retro arcade checked | none | 080 | test:browserpane driver:check-080-browser-expand |
| Questions and permission cards | works | works | mock+planned (permission-card) | 003 012 | test:elicit test:permissions test:lookalike driver:shots-012-elicit driver:check-permission-lookalike |
| Auto-follow work (Settings, off by default): back to the office after a send, the agent's chat when it finishes or needs you; a full-screen notice with a 3 s countdown and Stay before each automatic move; Previous and Next over the attention queue | works | works, the same notice in the Photo office, the cave and the arcade | none | 052 | driver:check-auto-follow driver:check-052-follow-notice |
| Needs-you inbox | works | works | planned (inbox) | 052 | test:attention read:src/renderer/app.js |
| Modes Read-only, Ask first, Allow all; switch any time | works | works | none | 003 018 | test:permissions driver:shots-018 |
| Plan first | works | works | none | 066 | test:planmode |
| Slash suggestions | works | works | none | 073 | test:slashcommands |
| Send to several sessions | works | works | none | 064 | driver:shots-064-send-several test:sessionname |
| Add folder or workspace, create or clone a folder | works | works | none | 006 093 | test:newfolder driver:shots-093 |
| Resume after restart, Since you were away, crash card | works | works | none | 006 | test:crashmarker driver:shots-006-crash |
| Previous sessions, search | works | works | none | 006 | test:sessionsearch driver:shots-006-prevmarks |
| Search conversations (top-bar box, results in the List view, open at the message) | works | works | none | 095 | test:convsearchui driver:shots-095 |
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
| MCP problems strip at launch (reason, fix, Show, Dismiss) | works | works, the same strip above the office (driver); the closed strip was seen above the drawn Photo office at 1440x900 and 1280x800 on macOS, 2026-11-09; the list-open and Settings pictures are the flat office, so they are no evidence here, and dark theme and DPR 2 were not run (#1424) | none | 058 | driver:shots-058-mcp-launch test:mcpwords |
| MCP sign-ins refreshed before a message after a quiet hour, checked in the background before every message, and renewed after a failed call (waiting line, Reconnecting line, sign-in line, Settings switches, Renewed note) | works | works, chat and Settings only (window chrome, no office drawing); run in the Photo office at 1440x900 and 1280x800 on macOS, 2026-11-09 (simulator, a throwaway driver wrapper); dark theme and DPR 2 were not run (#1424) | none | 058 | test:mcpsigninrefresh driver:shots-058-mcp-signin-refresh |
| Tools and Cost tabs | works | works | none | 019 020 | test:toolstats test:usagetotals |
| Credit caps and usage display | works | works | planned (limit-card) | 011 | test:credits test:usagestore driver:shots-012-cost-cap |
| OS sandbox floor | works | works | none | 087 | test:runtime-sandbox |
| Themes and user themes | works | missing (owner decision, 2026-11-08): superseded by worlds | none | 035 036 037 038 039 040 | test:theme test:userthemes |
| One face per agent: rail row, chat header, inbox faces are the same picture | works | works (one picker, `roFace`) | none | 097 | driver:check-097-one-face |
| Characters (crews): the Characters choice drawn in the office | works | missing, Minimalist and My characters have no Real office people (Minimalist shows the world's people and Settings says why; #1331, spec 096); Cheeky, Prehistoric, Pirate, Monster, Royal and Rebels are drawn in their own people in Real office (#1154) | none | 077 096 | test:characters test:crew driver:check-097-crews |
| Harness setup, agent-app updates | works | works | none | 051 081 | test:harnesssetup test:updatecheck |
| Remote control | works | works | none | 054 | test:remote driver:shots-054-remote |
| Auto-follow work (Settings, off by default): the window returns to the office with the agent's desk marked, then opens its chat when it finishes, asks, errors or reaches its limit; Previous/Next strip | works | works, the desk mark is the dashed `.ro-plate.is-followed` on the plate (read from the code) | none | 052 | test:autofollow driver:check-auto-follow read:src/renderer/styles.css |
| Failing, Retrying, Compacting status word on the desk | works | works, `realModel` passes `stWord(a)` and the call light takes `lightState('failing', 'retrying', 'compacting')` (read from the code) | none | 034 052 | test:retry test:compaction test:mood read:src/renderer/app.js |
| Logo choice: Settings > Logo, four top-bar icons | works | works, window chrome, the same in every world; the top bar takes the world's palette (read from the code) | none | 101 | test:logo-assets driver:check-logo-family read:src/renderer/logo-marks.js |
| End of day: quit asks while agents work; End all sessions | works | works, window chrome, the same in every world (read from the code) | none | 052 | read:src/renderer/app.js |
| Tools > Activity: local log of permission answers, automatic approvals, mode and limit changes, MCP restarts, CSV or JSON export | works | works, window chrome, the same in every world (read from the code) | none | 052 | test:activity driver:check-activity-table read:src/renderer/app.js |
| Terminal tab in a chat | planned | planned | none | 094 | read:specs/094-terminal-tab/spec.md |
| Next built-in world: aisle layout | missing | works, built behind the closed `retro` flag (PR 1006 was closed; code is on main) | planned | 102 | read:specs/102-worlds-on-demand/spec.md |

Exempt: 002 008 010 013 025 045 050 062 (not user features: adapters, packaging, simulator, live checks, docs rule, security sweep, website, real-account CI checks). Any other spec with `status: built` must be in a row.
