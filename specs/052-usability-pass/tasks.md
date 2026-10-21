# Tasks: Usability pass from persona reviews (spec 052)

- [x] T001 Answer bar above the composer for a pending permission request or question [FR-001]
- [x] T002 Previous sessions open by themselves only for an empty chat [FR-002]
- [x] T003 Chat header: Stop, Open in VS Code, More menu (keyboard, ids kept, destructive last) [FR-003]
- [x] T004 Restore banner with Got it and no timer; toasts pause on hover and focus [FR-004]
- [x] T005 Top bar defaults: "New:" mode options, accessible names and tooltips [FR-005]
- [x] T006 Room-header counts with shapes and a text alternative [FR-006]
- [x] T007 No ring on programmatically focused headings [FR-007]
- [x] T008 List view header row straight [FR-008]
- [x] T009 Contrast: `--muted`, `--focus`, information chips [FR-009]
- [x] T010 Copy buttons visible at rest [FR-010]
- [x] T011 Desk accessible name with the permission mode [FR-011]
- [x] T012 Plain words in the list, room header and Settings [FR-012]
- [x] T013 Plain names for themed places [FR-013]
- [x] T014 N: next agent that needs you [FR-014]
- [x] T015 Driver `scripts/shots-052-ux.js`, screenshots, `check:office`, `check:geometry`, docs; follow-up issues [SC-001..SC-004]

## Round 2 (2026-10-19)

- [x] T016 Restore strip under the top bar: names, Switch to Ask first, Keep; count folders [FR-015]
- [x] T017 Answer bar: full text (wrap, 6 lines), "1 of N" oldest first, no wide grant, Show in chat focuses the card [FR-016]
- [x] T018 Allow all switch: waiting requests not approved by default, listed [FR-017]
- [x] T019 Allow all glyph and tooltip on the desk [FR-018]
- [x] T020 Wording: scoped session approval, "end this session", "Ask first", Read-only MCP note, "1 Error" [FR-019]
- [x] T021 More menu descriptions [FR-020]
- [x] T022 Warning glyph in the pill for stuck and memory nearly full [FR-021]
- [x] T023 Settings: harness per section [FR-022]
- [x] T024 Theme craft: Retro, Corporate, Indian, Japanese, European [FR-023]
- [x] T025 Clean Office: shadows, radius scale, tabular figures, warm neutral [FR-024]
- [x] T026 Driver, checks, screenshots for round 2 [SC-001..SC-003]
- [x] T027 Top bar clusters and ⋯ (#308) [FR-025]
- [x] T028 jsLiteral in every driver; merge script blocks on bot comments [FR-026]
- [ ] T029 Round 3 with new personas on the build with the follow-ups (#305, #306, #307, #309, #310, #311)

## Follow-ups for alpha.8

- [x] T030 Needs you inbox and the I key (#305) [FR-027]
- [x] T031 Cost in one unit (#307) [FR-028]
- [x] T032 Control-size scale and 24px targets (#311) [FR-029]
- [x] T033 Settings: theme grid, lead sentences, Advanced (#309) [FR-030]
- [x] T034 Simple and Expert (#306) [FR-031]
- [x] T035 Theme polish, the rest (#310) [FR-032]

## Round 3 (2026-10-20)

- [x] T036 Inbox focus, descriptions, keys, focus trap [FR-033]
- [x] T037 Live announcements; focus after the answer bar [FR-034]
- [x] T038 Ctrl+Shift+I / Ctrl+Shift+N, aria-keyshortcuts [FR-035]
- [x] T039 Confirmations focus Cancel for destructive choices [FR-036]
- [x] T040 Simple: tool lines collapsed, plain approval words, plain verbs, fewer top-bar controls [FR-037]
- [x] T041 Restore strip wording [FR-038]
- [x] T042 Harness name on cards when several are in use [FR-039]
- [x] T043 Visual pass (Clean Office) [FR-040]
- [x] T044 Japanese court corrections [FR-041]
- [ ] T036 Inbox focus, descriptions, keys, focus trap [FR-033]
- [ ] T037 Live announcements; focus after the answer bar [FR-034]
- [ ] T038 Ctrl+Shift+I / Ctrl+Shift+N, aria-keyshortcuts [FR-035]
- [ ] T039 Confirmations focus Cancel for destructive choices [FR-036]
- [ ] T040 Simple: tool lines collapsed, plain approval words, plain verbs, fewer top-bar controls [FR-037]
- [ ] T041 Restore strip wording [FR-038]
- [ ] T042 Harness name on cards when several are in use [FR-039]
- [ ] T043 Visual pass (Clean Office) [FR-040]
- [ ] T044 Japanese court corrections [FR-041]

## Command palette (2026-10-20)

- [x] T045 Command palette (Ctrl+K) and keyboard shortcut sheet (?), ⋯ menu entry, driver section in `scripts/shots-052-ux.js` (#316) [FR-042, FR-043]
## Cost per folder (2026-10-20)

- [x] T046 Tools > Cost: one row per folder, This run / Since <date>, Copy as CSV, room cost opens it (#315) [FR-044]

## Round 4, interaction polish (2026-10-20)

- [x] T047 Pressed, disabled and busy states; `busy()` for Stop, End session, Open in VS Code, inbox rows and Resume [FR-047]
- [x] T048 Inbox: answered row shows the answer, folds away; "All clear" empty state; focus returns to where it was [FR-048]
- [x] T049 Dialog entrance, install plan cards, copy buttons ("Copied ✓", 70% opacity, Thinking box padding) [FR-049]
- [x] T050 Typed toasts (`ok`, `err`); empty Cost view [FR-050]

## Round 4: first run and demo (2026-10-20)

- [x] T051 Harness cards name their plan, welcome "Which one?" line, hints point to Settings > Harnesses, sign-in after install, plainer sign-in and install dialogs [FR-045]
- [x] T052 Restore strip button readable in every theme; one request per waiting agent; no pending card in Allow all in the simulator [FR-046]

## Round 4: security review of harness setup (2026-10-20)

- [x] T053 Spec 051 FR-004b/FR-004c: native main-side confirmation with the real path, sender check, world-writable refusal, winget source, masked output, throttled progress (see spec 051 *Changes*)

## Round 4: one word per concept (2026-10-20)

- [x] T054 One term per concept in every user-visible text (agent app, profile, Allow / Deny, folder, spending limit / cost / AI credits, End session, Remove from office, Demo, mood phrases), drivers and tests follow [FR-051]

## Round 5: visual and accessibility (2026-10-20)

- [x] T055 High Contrast, two-tone focus ring (retro halo), dialogs fit the window, `--line-ctl` control borders, selected not colour only, readable disabled states, `prefers-contrast: more`, dot edges, card text titles, generated `--muted` at 4.5:1 [FR-052]
- [x] T056 Solid primary buttons in every theme, ghost Tools and Settings, calmer waiting card, Settings measure and headings, restore strip band, theme picker overline, radius tokens, Clean polish after switching back [FR-053]
- [x] T057 Period textures on themed rooms, European and Retro room-name accents [FR-054]
- [x] T058 Settings heading scroll stays inside `.scr-body`; empty sign-in output hidden [FR-055]

## Round 5: plain words for newcomers (2026-10-20)

- [x] T059 Welcome card "Connect your AI account once", agent app cards name the account, install dialog in plain sentences with the exact command under a disclosure [FR-056]
- [x] T060 Simple: spending-limit pause and rate-limit errors in plain words, folder grant label, inbox keys line hidden, More menu skips hidden items; restore strip text and buttons for everyone [FR-057]
- [x] T061 Spending limit dialog: plans have a fixed price, Durbar never charges [FR-058]

## Round 5: signals for heavy use (2026-10-20)

- [x] T062 "Needs you" outside the window: title count, one coalesced and throttled OS notification with a setting, app badge or taskbar flash, `notifications` allowed [FR-059]
- [x] T063 Alt+A / Alt+S / Alt+D / Alt+N in a waiting chat, keys in the bar's buttons and the shortcuts sheet [FR-060]
- [x] T064 Inbox oldest first with "waiting N min" on each row, refreshed every 30 s while open [FR-061]

## Round 6: truth and density (2026-10-20)

- [x] T065 "Failing" pill (waiting colours) for a working agent with 3+ failed tool calls in a row on cards, list and chat header; last activity in card tooltips, a list column and the chat header, repainted by a 30 s tick [FR-062]
- [x] T066 Tool chips: the whole command with Copy, 20000 characters of output with Show all, duration; optional `PermissionInfo.diff` filled by the Claude Code adapter (Edit, MultiEdit, Write) and the simulator (Jonas), "Show the change" on the permission card and inbox row [FR-063]
- [x] T067 List: 34px rows, Agent app / Last activity / Cost columns, sort by header with `aria-sort` (memory only), J/K and Enter, Simple keeps the columns aligned; drivers `shots-052-ux.js`, `shots-034-list.js` [FR-064]
- [x] T068 Red "Allow all" badge in the mode icon's slot on cards and list rows, the chat header's chip in the same red [FR-065]
- [x] T069 "What Durbar does not do" in Settings and the README, each claim checked against the README [FR-066]
## Round 6: motion with meaning (2026-10-20)

- [x] T070 Desk scene cross-fade on a signature change, done tick draws in, done pill pulses once, waiting badge pings 3 times [FR-067]
- [x] T071 Inbox answer fades in place and the rows below slide up (FLIP), Needs you count rolls in a fixed box, All clear pops in [FR-068]
- [x] T072 Ambulance light and siren breathe slowly for about 10 s instead of strobing; Serious mode stops every looping animation [FR-069]
- [x] T073 Theme change cross-fades through a view transition; empty office shows an empty desk; "+ Folder" rings once on first run [FR-070]
## Round 6: activity log and Windows first run (2026-10-20)

- [x] T074 Activity log: `activitystore.ts` (5000 rows, redacted 160-character action, base folder names), recorded in main from permission events (broker `auto` event for Allow all) and `setModeOp`/`setCapOp`; `activity:list/export/clear`; Tools > Activity tab; simulator rows; `test-activity` [FR-071]
- [x] T075 Windows: search `%LOCALAPPDATA%\Microsoft\WinGet\Links`; "close and reopen Durbar" dialog when an install still is not found; PATH re-read left as a known gap; `test-detect` [FR-072]
- [x] T076 Copilot sign-in line about VS Code; PowerShell 7 hint on the Windows Copilot card (`pwshMissing`); `test-harnesssetup` [FR-073]
- [x] T077 "Switch this agent to Ask first" under a Read-only denial, once per agent until the mode changes [FR-074]
- [x] T078 Copilot plan note in Tools > Cost and the spending-limit dialog (one constant), "Raise limit" for Copilot, README Windows install notes [FR-075]

## Round 7: consistency and readability (2026-10-20)

- [x] T079 House rules: control heights, one Copy size, chip radii, `.btn.primary.danger` for deleting and ending, dialog fields and links, the "…" rule, one word per status (renderer and MCP agent state), spacing, inbox answer order, shared chevron, hover/disabled/focus states; drivers `shots-006-remove.js`, `shots-006-continue.js`, `shots-044-everywhere.js`, `shots-044-templates.js`, `shots-054-remote.js`, `shots-m10.js` [FR-076]
- [x] T080 Reading load: Thinking block, one-line mode menu, install options lead with the manager, AI theme intro bullets, labelled header chips, sentence-case list headers, inbox key hints [FR-077]
- [x] T081 `docs/design-rules.md` with the ten house rules and how to check; linked from `CONTRIBUTING.md` [FR-078]
- [x] T082 "and", not "&" in labels ("Models and context") [FR-079]

## Round 7: plain words for people who don't code (2026-10-20)

- [x] T083 Simple approval cards, answer bar, inbox and notification in plain words ("<Name> wants to change companies.ts", "in tools", "wants to run a command" with a collapsed "Show the command", "See what changes"); waiting status lines without the command [FR-080]
- [x] T084 Simple hides developer details: memory chip and "Tidy up memory", money-only usage line and list cost, tool rows in plain words, "Running a command" place word, Control from GitHub hidden, Tools "Activity summary" without Models and context or Tokens [FR-081]
- [x] T085 Welcome card asks "Do you write code?" with two buttons that set and remember the detail level; welcome driver checks it [FR-082]

## Round 8: daily use (2026-10-20)

- [x] T090 Window place, size and maximized state saved in `durbar-app-state.json` and restored on a visible display (else 1440x900); the view, folder filter and open chat restored from `localStorage` [FR-087]
- [x] T091 Every open session per folder (at most 6) saved and restored lazily; files with only `lastSession` still work; folder store tests [FR-088]
- [x] T092 Quit time saved; "Since you were away" strip with missed schedule runs and **Run missed now** (`schedules:runNow`); tests for the summary and `runNow` [FR-089]
- [x] T093 Quit prompt while agents work (one chained `before-quit`, the window's close shares it); **End all sessions** in ⋯ and the palette [FR-090]
- [x] T094 Palette "Recent" group (5 chats) and Ctrl+` back to the previous chat; shortcut sheet; driver `shots-052-ux.js` [FR-091]
## Round 8: macOS conventions (2026-10-20)
- [x] T086 Mac app menu from roles (Settings… ⌘, sends `menu:settings`; View with zoom and full screen only; Help links the repo); no menu on Windows and Linux; preload `onMenuSettings`, simulator no-op; `appmenu.ts` + `test-macos` [FR-083]
- [x] T087 ⌘ on a Mac: `keys.js` (`modDown`, `chatKeyDown`, labels, aria); shortcut sheet, palette, titles and `aria-keyshortcuts` per platform; footnote removed; ⌥⌘A/S/D/N in a chat, dead keys ignored [FR-084]
- [x] T088 Mac window: close hides (agents keep running), `quitting` in `before-quit`, agents ended on ⌘Q after the remote release, `activate` shows; `hiddenInset` title bar with darwin-only drag CSS and full-screen events; `color-scheme` per theme; Dock bounce [FR-085]
- [x] T089 README "On a Mac" note (not verified on a real Mac), CHANGELOG line [FR-086]
## Round 9: pre-release fixes (2026-10-20)
- [x] T095 Inbox session button shrinks with an ellipsis (Deny always visible); Thinking full width with no inner scroll; Failing in the palette, strip and list dot; folder note only next to plain words; Cost "This session / All time" before the tabs with a "since" subtitle; Agent apps "for …" line; wider Agent app column [FR-092]
- [x] T096 Mode menu lines, "What Durbar does not do" (Settings and README), AI theme cost line per selected app, Simple limit and memory chips; Remove from office confirmation checked [FR-093]
- [x] T097 Drivers grepped for every changed string; `shots-052-ux.js` memory chip check; README Tools line; CHANGELOG [FR-094]
## FR-085 fix: Mac window from an open chat (2026-10-20)
- [x] T120 Mac: the chat's agent strip is the drag area with the traffic-light room when the top bar is hidden, and so is a screen's header (Settings, Tools, folder) opened over a chat; `test-macos` checks both [FR-085 fix, 2026-10-20]
## Round 10: chrome density and type (2026-10-20)
- [x] T098 Chat header on one row (32px avatar, T1 name, chips and `.btn.sm` at 28px, actions pinned right), task and usage on one line, **Previous (N)** in the actions instead of the bar, 48px strip, shorter composer hint, 13px bubbles [FR-095]
- [x] T099 Compact inbox rows (32px avatar, 8px gaps, `.btn.sm`, **Open** on the heading line) [FR-096]
- [x] T100 Settings and Tools: header on the 880px column, tighter sections, fluid agent app grid, "Simulated version." in the badge title, shorter blurbs [FR-097]
- [x] T101 Type scale (`--t1..t5`), spacing scale, folded chrome sizes, body 13px with the office, list and top bar pinned at 14px, dialog padding, tokens for radii and colours; `docs/design-rules.md` [FR-098]
- [x] T102 Settings > Detail level > Spacing (Comfortable / Compact, `html[data-density]`, `localStorage`), chrome-only overrides; copy (folders, demo, Open); drivers; README and CHANGELOG [FR-099]

## Round 10: office and tables (2026-10-20)

- [x] T103 Flat desk and helper cards (surface, 1px `--line-hair`, no shadow; Clean shadow removed); 3px inside edge for Waiting, Error and Failing (`is-failing`); 1.5px selection ring [FR-100]
- [x] T104 Calm statuses as a dot and a word on cards and list rows (transparent pill, same size); Waiting, Error, Failing and Limit reached keep the fill; driver check in `shots-052-ux.js` [FR-101]
- [x] T105 Card tooltip names the role (hidden next to the name in mini and micro); usage line checked (cost only in Simple, tabular and right-aligned in Expert) [FR-102]
- [x] T106 Top-bar counters as one segmented strip (inset frame, dividers in the gap, transparent 1px borders, same widths and height); selected state; theme frames in `themes.css` [FR-103]
- [x] T107 List hairlines, header and right-aligned numbers; Tools groups without frames, `7px 8px` cells, plain-text "Used by", 4px bars; CHANGELOG [FR-104]

## Round 11: one-row top bar and thinner walls (2026-10-20)

- [x] T108 Top bar on one 48px row: + New menu (Add folder…, Add VS Code workspace…, ids kept), Defaults chip with a popover holding the selects (ids kept), folder filter joined with Manage folders, counters as dot and number below 1800px, Needs you icon and number below 1600px; themes recolour only; texts and palette; `docs/design-rules.md`, README, CHANGELOG [FR-105]
- [x] T109 Room, place and helper connector lines 1px in Clean Office and every theme (Retro's ring follows) [FR-106]
- [x] T110 Drivers: `shots-017.js` opens the Defaults popover; `check-office-overlap.js` checks the one-row top bar; the others grepped [FR-107]
- [x] T111 Full simulator run before merge: geometry, office, every driver that touches the top bar, screenshot tour by eye; Manage folders popover anchored to its button; `shots-017` history check follows round 10's Previous button [FR-107]

- [x] T128 Question options wrap and their title holds the label (+ description); `simquestion=long`; `scripts/check-question-options.js` (`npm run check:question-options`) at 1440x900 and 1280x800, Expert and Simple, card and inbox; mutation run; screenshots [FR-140, issue #365]

## New session in the chat header (2026-10-20, issue #363)
- [x] T127 `+ New` button next to Previous in the chat header (title and aria-label "New session in <folder>", same flow and conditions as the More item plus `!demoOn`, main agents only); icon-only if it does not fit; More item kept; `check-office-overlap.js` asserts it and the one-row header at both sizes; mutation; screenshots; README, CHANGELOG [FR-139]
## FR-138: macOS title bar on every screen (2026-10-20, #345)
- [x] T121 Spec delta FR-138 (this entry), tasks and plan note [FR-138]
- [x] T122 Darwin-only CSS: notice strip is the drag row with a chat open and the strip below drops the 78px; overlays, popovers and menus `no-drag`; chat strip grab area and no-drag `.strip-list`; `.scr-head` `max(78px, ...)` [FR-138]
- [x] T123 `test-macos` static checks for the new rules and selectors [FR-138]
- [x] T124 `scripts/check-mac-titlebar.js` and `npm run check:mac-titlebar` (geometry of every state at both sizes, non-zero on failure and on a driver exception) [FR-138]
- [x] T125 Mutation: remove the `.dlg-ov` no-drag rule and see the check fail; screenshots in the scratchpad [FR-138]
- [x] T126 Docs: CHANGELOG, README "On a Mac" limits, `specs/README.md` row, spec status tags; CI step proposed as a follow-up [FR-138]
- [x] T129 Grant chips grouped into "Allowed (N)" with a popover, shorter labels, header chips flow; `simgrants=many`; `test-grant-label`; `scripts/check-grant-chips.js` (`npm run check:grant-chips`); mutation run; screenshots [FR-141, issue #367]
- [x] T130 Raise the question and elicitation text bounds (adapters, shared, renderer); test in `test-claude-adapter` [FR-160]
- [x] T131 Option descriptions visible in the button; custom answer box grows with its text; answer bar tooltip for a long request [FR-160]
- [x] T132 Enter in the custom box sends the card (Answer's handler), Shift+Enter a line, empty Enter sends nothing; typing chooses the box; screen reader hint [FR-161]
- [x] T133 `check-question-options.js` + `simquestion=long`: long texts in full, Enter / empty Enter; run at 1440x900 and 1280x800; screenshots; CHANGELOG, `specs/README.md` [FR-160, FR-161]

## Question in sight, compactions folded (2026-10-21, owner report)
- [x] T134 Spec delta FR-162/FR-163, plan note [FR-162, FR-163]
- [x] T135 Answer bar: short question answered in the bar (options, Other box, Skip press the card's controls), Show question, no rebuild while unchanged, zero-height card counts as out of view, recheck on resize [FR-162]
- [x] T136 `onCompaction`: one line per run of compactions (`compactionFoldText` in `modelswitch.js`, test in `test-modelswitch`), no `isConnected` leftover; `addInfoNote` folds an identical repeat with "(×N)" [FR-163]
- [x] T137 `simquestion=compact` + `scripts/check-question-visible.js` (`npm run check:question-visible`) at 1440x900 and 1280x800; mutation runs; screenshots; README, CHANGELOG, `specs/README.md` [FR-162, FR-163]

## FR-164: + Folder and + Workspace at the left, and a File menu (2026-10-21, owner request)
- [x] T138 Spec delta FR-164 (amends FR-105 and FR-083) [FR-164]
- [x] T139 Top bar: + Folder and + Workspace first after the brand (ids kept, + New menu removed), fit rules, `fitTopbar`, the defaults chip in two spans; Ctrl+O / Ctrl+Shift+O in the page on Windows and Linux; shortcut sheet and palette keys; empty-office and welcome texts [FR-164]
- [x] T140 macOS File menu (Add Folder… ⌘O, Add VS Code Workspace… ⇧⌘O, Close Window) through `menu:add` → `onMenuAdd` → the same buttons; `test-macos` [FR-164]
- [x] T141 `scripts/shots-052-addleft.js` in `check:ui`; `check-mac-titlebar.js` without the + New state; `check:office`, `check:geometry`, `check:mac-titlebar`; screenshots at 1440x900 and 1280x800 [FR-164]
- [x] T142 Docs: README, CHANGELOG, `specs/README.md` row [FR-164]

## FR-165: a Codex write request names the file and shows the change (2026-10-21, real Codex finding)
- [x] T143 Spec delta FR-165, plan note [FR-165]
- [x] T144 Codex adapter: keep `fileChange` items by id (started, patchUpdated; forget on completed; at most 32), fill the write card from the item (files, kind, diff with secrets masked), "Codex did not say which file" when none is known; `PermissionLike.cardSummary` [FR-165]
- [x] T145 Renderer: multi-file diff counts (`diffLines` ends a hunk by its counts), Simple words for a request with no file [FR-165]
- [x] T146 Tests: `test-codex-modes`, `test-codex-adapter` with the fixture `codex/file-change-approval.json` (generated types), `test-truth`; mutation runs (no item store, no masking) [FR-165]
- [x] T147 `simcodexfile` + `scripts/check-codex-file-card.js` (`check:codex-file-card`, in `check:ui`) at 1440x900 and 1280x800, Expert and Simple; screenshots; README, CHANGELOG, `specs/README.md`, agent notes [FR-165]
- [ ] T148 Real check on a Codex session (one small edit in Ask first): the card names the file and shows the diff [FR-165, needs the owner's budget]
