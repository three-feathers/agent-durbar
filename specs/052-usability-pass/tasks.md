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
- [x] T120 Mac: the chat's agent strip is the drag area with the traffic-light room when the top bar is hidden; `test-macos` checks it [FR-085 fix, 2026-10-20]
