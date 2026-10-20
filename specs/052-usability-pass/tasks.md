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

## Round 6: motion with meaning (2026-10-20)

- [x] T070 Desk scene cross-fade on a signature change, done tick draws in, done pill pulses once, waiting badge pings 3 times [FR-067]
- [x] T071 Inbox answer fades in place and the rows below slide up (FLIP), Needs you count rolls in a fixed box, All clear pops in [FR-068]
- [x] T072 Ambulance light and siren breathe slowly for about 10 s instead of strobing; Serious mode stops every looping animation [FR-069]
- [x] T073 Theme change cross-fades through a view transition; empty office shows an empty desk; "+ Folder" rings once on first run [FR-070]
