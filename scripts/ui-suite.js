/*
 * The simulator UI checks on any OS (spec 008 FR-091): runs every assertion-bearing driver one after another, with no shell.
 *
 *   npm run check:ui                      (builds first)
 *   node scripts/ui-suite.js --list       the drivers
 *   node scripts/ui-suite.js --only shots-017,shots-033
 *   node scripts/ui-suite.js --shard 2/3                  shard 2 of 3, balanced by recorded duration (UI_SUITE_SHARD=2/3 too; spec 008 FR-182, FR-183)
 *   UI_SUITE_OUT=<folder>                 where every screenshot goes (default: a new temp folder, printed at the end)
 *   UI_SUITE_XVFB=1                       Linux: run under xvfb-run even when a display is set
 *   UI_SUITE_DPR=<1..4, or 1.25, 1.5>     force the device scale factor (2 = a Retina screen, 1.25 and 1.5 = a Windows laptop at 125 % and 150 %) for every driver
 *   UI_SUITE_XVFB_SCREEN=WxHxD            Linux/xvfb: replace the screen (default 1920x1100 times the density, depth 24; a malformed value is ignored; spec 008 FR-213)
 *   UI_SUITE_JOBS=<n>                     drivers at once (default 2; each has its own profile and, on Linux, its own xvfb display);
 *                                         an entry with `focus: true` (waits on the OS window focus) runs alone, after the others, when windows share a desktop (FR-210)
 *   UI_SUITE_RETRY=1                      run each failed driver once more, alone, at the end; a pass then is reported as FLAKY
 *                                         (listed in the summary and the GitHub job summary), never as a clean pass
 *
 * Each driver gets a fresh DURBAR_USER_DATA, its own settings and the same output folder for all screenshot variables. A driver fails on
 * a non-zero exit (a failing driver exits 1, FR-090), a "DRIVER FAILED" line or its time limit. Before any Electron starts, every
 * selected driver and the shared helpers get a `node --check` syntax pass (spec 008 FR-112): a syntax error used to hang Electron with no
 * DRIVER FAILED line until the time limit. Then Electron is installed once (scripts/ensure-electron.js, FR-114), so parallel drivers never
 * race to fetch it. Linux without a display runs under xvfb-run.
 * Simulator only: no real agent session, no account, no AI credits (constitution IV). Prints one line per driver; exits 1 if any failed.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { ensureElectron } = require('./ensure-electron');

const ROOT = path.join(__dirname, '..');
const SIM = { DURBAR_SIM: '15', DURBAR_SIM_FREEZE: '1' };

/** Every driver that asserts (not only screenshots), with the settings its header documents. */
const DRIVERS = [
  { name: 'shots-001-welcome', sim: false }, // the first-run screen: no simulator
  { name: 'check-office-fill' }, // spec 001 FR-041..FR-046: grown desks with few agents (its own sim, simrooms and simhelpers per layout)
  { name: 'shots-017' },
  { name: 'check-no-doors' }, // spec 017 FR-029..FR-034: no doors anywhere (15 agents, both sizes), and the prompts held behind a door before the update: one notice, Send / Discard / Decide later, never sent or dropped on their own
  { name: 'shots-018' },
  { name: 'shots-033', env: { DURBAR_SIM_FLOORS: '1' } },
  { name: 'shots-092', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 092 phase 1: floor screens (one floor at a time), PageUp/PageDown, the scroll rule, floors going off and on, an empty floor
  { name: 'shots-092-lift', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 092 phase 2: the lift panel, its badges and the All floors view (FR-006..FR-008, FR-013..FR-017, FR-028, FR-031..FR-037)
  { name: 'shots-033-order' }, // spec 033 delta 2026-11-01 (#677): drag and Alt+arrows to rearrange rooms, desks and places; saved, survives a reload, corrupt order tolerated
  { name: 'shots-033-move', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 033 FR-024 (#590): Move to floor in the folder menu, with Undo
  { name: 'shots-034-list' },
  { name: 'shots-015-compact' }, // spec 015 FR-014: Compacting on the desk, list, header, strip and ring (simcompact=1 in its own query)
  { name: 'check-015-bg-helper' }, // spec 015 FR-018 (issue #1141): a background helper stays Running after its call returns, until its own end or its session stops (simbghelper=1)
  { name: 'shots-034-retry' }, // spec 034 FR-021: Retrying and Gave up (simretry=1 in its own query)
  { name: 'check-serious-motion' }, // spec 052 FR-069 (issue #1182): Serious mode hides only the moods; Motion is its own switch; reduced motion still stops it; Flat and Real office, both sizes
  { name: 'check-settings-worlds' }, // spec 102 FR-301 (T266): Settings > World: picture cards in one radio group, a closed flag unlisted, keys, focus against choice, the zoom, reduced motion, forced colours
  { name: 'check-settings-nav' }, // spec 052 FR-226 (T219): the Settings section list: built from the headings, jump, aria-current follows the scroll, keys, every world, reduced motion, narrow row
  { name: 'check-069-toggle-scroll' }, // spec 069 FR-069 (issue #1624): a Settings switch that repaints the page keeps the scroll, the focus and the open Advanced block
  { name: 'check-settings-save' }, // spec 011 FR-012 (issue #1023): a Settings row whose save fails returns to the value in force and says so
  { name: 'check-rail' }, // spec 005 FR-190, FR-194, FR-216 and 052 FR-215: the agent rail's List view: fit, order, two heights, folders that collapse, Your door, Mac drag areas
  { name: 'check-rail-resize' }, // spec 005 FR-236 (issue #1223): the agent rail's width: drag, keys, double-click reset, remembered, clamped when the window shrinks, both sizes
  { name: 'check-unread' }, // spec 001 FR-170..FR-177, spec 005 FR-176/FR-177 (issue #691): a finished agent's reply stays marked New until its chat is shown
  { name: 'check-001-lights' }, // spec 001 FR-230, FR-231: Open office's screens tinted by status as Real office's, no card glow or waiting halo, every kit, both sizes
  { name: 'check-auto-follow' }, // spec 052 FR-182..FR-190 (issue #686): opt-in Auto-follow and the attention queue: off by default, send, arrivals, guards, Previous/Next, pause, empty queue, fit
  { name: 'check-052-follow-notice' }, // spec 052 FR-238..FR-241 (owner, 2026-11-09): the Auto-follow notice: both notices, countdown, Stay and Escape, background pause, announcement priority, reduced motion, four looks at two sizes
  { name: 'check-helper-bar' }, // spec 015 FR-020 (issue #1142): the Sub-agent activity / Back to parent chat bar stays at the top of a helper's chat while it scrolls, opaque, both sizes
  { name: 'check-helper-more' }, // spec 005 FR-234 (issue #1145): a helper's chat has no empty More menu (the button is hidden), a main agent's chat keeps it, both sizes
  { name: 'check-browser-follow' }, // spec 005 FR-235 (issue #1168): a chat that followed the end still follows after Chat, Browser, Chat (a turn writing meanwhile); one scrolled up keeps its place; both sizes
  { name: 'check-status-filter' }, // spec 001 FR-180 (issue #790): a status pill says what it hides, and Show all
  { name: 'check-status-filter', label: 'check-status-filter retro', env: { DRIVER_WORLD: 'retro' } }, // spec 102 delta 2026-11-11 (issue 1559): the notice's contrast in the arcade, both sizes
  { name: 'check-status-tooltip' }, // spec 001 FR-187 (issue #875): the instant tooltip on the status counts: hover, keyboard focus, Escape, wording with the filter on and off, inside the window, clear of the pill, every theme, Serious mode
  { name: 'check-list-columns' }, // spec 001 FR-182..FR-184 (issues #812, #813): List columns follow their content and every cut cell keeps its text; the room's whole bottom wall; the header pencil without a tile
  { name: 'shots-001-live-activity', freeze: false }, // spec 001 FR-028 live activity, and spec 059 (issue #1135): after a live paint no pencil stays on the line under its name
  { name: 'check-rename-inline' }, // spec 059 FR-027 (issue #636): rename in place on every surface, both sizes
  { name: 'check-edit-popups' }, // spec 052 FR-237: every text popup stays open through a drag that ends outside, Ctrl/Cmd+A and live events, both sizes
  { name: 'check-session-summary' }, // spec 085 FR-003/FR-007: the card shown in the chat when a session ends (simsummary=1), both sizes
  { name: 'shots-044-everywhere' },
  { name: 'shots-044-templates' },
  // spec 060 FR-002: the per-OS assertion needs a known manager set, the one the driver expects for the host OS (a real Windows host
  // has PowerShell; winget,brew,npm there hid the PowerShell route and failed the check)
  { name: 'shots-051-setup', env: { DURBAR_SIM_MANAGERS: process.platform === 'win32' ? 'powershell,winget,npm' : 'winget,brew,npm' } },
  { name: 'shots-081-updates' }, // spec 081: agent-app update check and update, canned results, no network
  { name: 'shots-011-quota' }, // spec 011 FR-086..FR-092 (issue #690): account limits per app: fixtures, stale, failed, hostile, suggestion, the one timer
  { name: 'shots-051-account' }, // spec 051 FR-013: the signed-in account line, the picker tooltips and About agent apps (a fake identity)
  { name: 'shots-051-setup', label: 'shots-051-setup win32', env: { DURBAR_SIM_MANAGERS: 'powershell,winget,npm', DURBAR_SIM_PLATFORM: 'win32' } }, // spec 060 FR-011/FR-012: Windows' routes (PowerShell installer, winget, npm) and Run beside each command, on every OS
  { name: 'shots-052-ux', env: { DURBAR_SIM_KINDS: 'mixed' } },
  { name: 'shots-052-addleft' }, // FR-164: + Folder / + Workspace leftmost, one row in every theme, the File menu and Ctrl+O
  { name: 'shots-093' }, // spec 093: + Folder's choice, Clone (URL, progress, Cancel, Allow all host), New repository and Empty folder (simulated), Ctrl+O / File menu / palette entry points
  { name: 'shots-054-remote' },
  { name: 'shots-006-prevmarks' },
  { name: 'shots-003-mode-back' },
  { name: 'check-sandbox-floor' }, // spec 087: the OS sandbox chip, tooltips, note (Continue / Always / Change mode…), Codex card line, Settings line
  { name: 'shots-012-signin-chat' },
  { name: 'shots-058-mcp-restart' }, // spec 058: per-server Restart and Restart session with these servers
  { name: 'shots-058-mcp-signin' }, // spec 058 T102/T104: Sign in for a Copilot server that needs it (simmcpauth), the two-step open, the steps
  { name: 'shots-058-mcp-words' }, // spec 058 T113-T115: state words, hints, Details and live refresh in the MCP dialog
  { name: 'shots-058-mcp-settings' }, // spec 058 FR-080..FR-086 (#596): live MCP state over the running chats in Settings
  { name: 'shots-058-mcp-launch' }, // spec 058 FR-195..FR-203: MCP health strip at launch; Sign in, Sign in again and Restart where it failed in Settings
  { name: 'shots-058-mcp-launch', label: 'shots-058-mcp-launch retro', env: { DRIVER_WORLD: 'retro' } }, // spec 102 (issue #1566): the strip over the arcade at 15 agents, 1280x800 and 1440x900: no office scroll while shown and after Dismiss
  { name: 'shots-058-mcp-launch', label: 'shots-058-mcp-launch retro 16', env: { DRIVER_WORLD: 'retro', DRIVER_CASE: '16', DRIVER_AGENTS: '16' } }, // spec 102 T308: 16 agents under the strip: the lent layout still scrolls, so it is refused (ro-tight off)
  { name: 'shots-058-mcp-launch', label: 'shots-058-mcp-launch retro filter', env: { DRIVER_WORLD: 'retro', DRIVER_CASE: 'filter', DRIVER_AGENTS: '24' } }, // spec 102 T308: a status filter under the strip: ro-tight never set while the floor scrolls, the note keeps its top padding
  { name: 'shots-058-mcp-launch', label: 'shots-058-mcp-launch photo 18', env: { DRIVER_CASE: 'photo', DRIVER_AGENTS: '18', DRIVER_H: '760' } }, // spec 102 T308: a world that is not aisles is never lent the padding
  { name: 'check-102-arcade-filter-note', env: { DRIVER_WORLD: 'retro' } }, // spec 102 (issue #1588, T310): the arcade at 14, 13 and 11 agents with a status filter set (15 cannot be driven: the simulator's basic agent never works), 1280x800 and 1440x900: no office scroll, the note stays clear
  { name: 'shots-058-mcp-signin-refresh' }, // spec 058 FR-208..FR-216: the sign-in refresh lines, Stop during the wait, the Settings switch
  { name: 'shots-076-orgpolicy' }, // spec 076 FR-202..FR-205 (#602): what the agent app's own organization policy blocks, greyed with the reason
  { name: 'shots-058-mcp-health' }, // spec 058 FR-090..FR-096 (#603): failure reason, when, Copy diagnostics (masked), the MCP chip dot
  { name: 'shots-058-mcp-refresh' }, // spec 058 FR-187..FR-192 (#779): the last call's outcome on a Running row, Refresh and the re-read on open
  { name: 'shots-100-mcp-context' }, // spec 100 T017, T024: MCP tool definitions in the window: chip, dialog, line, compaction hint, Settings; fixtures only
  { name: 'shots-841-entra-explain' }, // spec 058 FR-193, FR-194 (#841): the fixed line and Sign in again... under a failed policy call
  { name: 'shots-model', label: 'shots-model 1440', env: { MODEL_W: '1440', MODEL_H: '900' } },
  { name: 'shots-model', label: 'shots-model 1280', env: { MODEL_W: '1280', MODEL_H: '800' } },
  { name: 'check-model-choice' }, // spec 030 FR-060..FR-066: model, effort and context chosen one after another stay together, each app, each order
  { name: 'shots-007-autotier' }, // spec 007 FR-013..FR-018 (#607): the Auto routing tier in the model menu, confirm, Undo, the organization lock
  { name: 'shots-111-templates' }, // spec 111 T008 (FR-020, FR-021, FR-131): Settings > Team templates: starter and own rows, keyboard only, Delete asks, Export disabled, blocked/changed/failed seeds
  { name: 'shots-043-editor' }, // spec 043 FR-014: the profile file editor (modes, split widths, save round trip, unsaved guard)
  { name: 'shots-043-ai' }, // spec 043 FR-026..FR-039: Create with AI (canned generation, Extra tools, Stop waiting, Cancel and reopen)
  { name: 'shots-043-manage' }, // spec 043 FR-040..FR-042: nothing written before Save, the Profile menu refreshes at once, Delete from the menu and Settings
  { name: 'check-dialog-focus' },
  { name: 'check-052-primary-btn' }, // spec 052 FR-053 (#1614): the themed primary button reads at 4.5:1 at rest, hovered and pressed in every themed look
  { name: 'check-052-focus-ring' }, // spec 052 FR-052 (#1615): the keyboard ring of the top bar controls and of the ⋯ menu items reads at 3:1 beside the bar, in the retro looks
  { name: 'check-052-danger-btn' }, // spec 052 FR-053, FR-076 (#1565): the red confirm button of a destructive dialog reads in the arcade and under the pixel theme
  { name: 'check-052-danger-dialogs' }, // spec 052 FR-053, FR-076 (#1647): every destructive dialog's red confirm button reads at rest, focus and hover, retro-ui user themes included
  { name: 'check-grant-chips' },
  { name: 'check-sched-sendto' },
  { name: 'check-sched-edit' },
  { name: 'check-sched-top' }, // spec 044 FR-027..FR-035: the top-bar Schedules button
  { name: 'check-sched-history' }, // spec 044 FR-040..FR-044: a schedule's run history and Schedules here (N)
  { name: 'check-question-options' },
  { name: 'check-inbox-text' }, // spec 052 FR-214: the text of a Needs you card never runs words together
  { name: 'check-inbox-avatar' }, // spec 052 (#1174): no avatar in the Needs you dialog outgrows its box; the first Allow button is in view
  { name: 'check-097-one-face' }, // spec 097 (#1193): the rail row, the chat header and the inbox show one picture per agent, in Real office and in the flat office with two crews
  { name: 'check-097-one-face', label: 'check-097-one-face retro', env: { DRIVER_WORLD: 'retro' } }, // spec 102 T283 (issue #1399): the same driver in the arcade
  { name: 'check-question-visible' },
  { name: 'check-chat-no-scroll' },
  { name: 'check-chat-visibility', label: 'check-chat-visibility 1440', env: { CVONLY: '1440' }, timeoutMs: 900_000 }, // spec 005 T227 (issue 1610): 900 s is a stated margin, not a fix: Linux frame cost is about 3.4x a Mac's; one entry per size so each has its own time limit (#1127, FR-063)
  { name: 'check-chat-visibility', label: 'check-chat-visibility 1280', env: { CVONLY: '1280' }, timeoutMs: 900_000 }, // spec 005 T227: the same margin; FR-210: a long chat is laid out only near the view; scroll, find, copy, focus and the pinned end are as before
  { name: 'check-chat-title' }, // spec 052 FR-180 (#789): the chat header's title uses the free room up to the buttons
  { name: 'check-no-demo-badge' }, // spec 052 FR-181: no Demo / Live badge in the top bar; the demo cues remain
  { name: 'check-logo-family' }, // spec 101 FR-072: Settings > Logo, the top-bar icon on every theme, world and forced colours, tile and name unchanged
  { name: 'check-sim-guard' }, // spec 010 FR-026: the real preload API is refused by main under DURBAR_SIM
  { name: 'shots-069-mcp-global' }, // spec 069: add to the agent apps' own lists, review, remove, source chips
  { name: 'shots-069-harmonize' }, // spec 069 part 2: copy servers between the agent apps' lists
  { name: 'shots-069-mcp-tools' }, // spec 069 part 3: tools on expand, Remove in the agent dialog (058's state words and Details stay)
  { name: 'shots-059-long-url' }, // spec 059 FR-019: a long unbroken name stays in its card, the inbox and the Schedules rows
  { name: 'check-mcp-row-width' }, // spec 058 delta 2026-11-12 (#1622): a failed server's row keeps a readable text column; the buttons wrap below it
  { name: 'check-activity-table' }, // spec 052 FR-071 delta 2026-10-21 (#474): Tools > Activity renders its rows
  { name: 'check-codex-file-card' }, // spec 052 FR-172: a Codex write card names the files and shows the change
  { name: 'check-theme-art' }, // spec 040 FR-023: a picked theme's characters and gadgets on desks, walkers, places and chips
  { name: 'check-crew' }, // spec 077: Cheeky portraits (Characters = Cheeky on Clean Office): box vs protected zones, pose, sharpness, the fallback with a picture removed
  { name: 'check-crew', label: 'check-crew dark fixture', env: { CREW_THEME: 'check-dark' } }, // spec 077 FR-070: the same with Characters = Cheeky on the dark fixture user theme (spec 102 T226: it took Retro Pixel's place)
  { name: 'check-floor-repaint', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 033 FR-088 (#787): the office repaints after a floor switch although a side panel throws
  { name: 'check-floor-add', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 033 FR-089..FR-092 (#1709): after an add the floor is named, switched on, Show; a repeat says already added
  { name: 'check-office-ops' }, // spec 097 FR-185, FR-186 (T142, T148): operation counts of the flat office, never times: elements recalculated by one text change at 15 and 40 agents
  { name: 'check-characters' }, // spec 077 FR-064..FR-069: Settings > Characters on Retro Pixel (Cheeky, Minimalist, the theme's own)
  { name: 'check-removed-themes' }, // spec 035 FR-017, FR-018: a stored id of a removed theme shows Clean Office, in both sizes; Retro stays
  { name: 'shots-040-picker' }, // spec 040 FR-031, FR-032: no AI maker or Import; Remove a saved theme asks first, Clean Office after
  { name: 'check-permission-scope' }, // spec 003 FR-108: the approval card says how far "for this session" reaches
  { name: 'check-permission-lookalike' }, // spec 003 FR-117..FR-119 (#1300): lookalike letters marked on the approval card, its line, the session button from the key, chips, why-allowed; all buttons stay
  { name: 'check-answer-safety' }, // spec 052 FR-209..FR-212: the answer bar, a held Enter, a limit in flight, a plan while typing
  { name: 'check-inbox-safety' }, // spec 052 FR-206..FR-208: Needs you: a stale button, a held key and a limit row answer nothing they should not
  { name: 'check-needs-panel' }, // spec 052 FR-191..FR-195 (T196, T197): Your door, the Needs you panel behind its flag: non-modal, no focus change on opening, app start with Later, no shift, Esc and the amber toggle, All clear, Real office slips
  { name: 'check-ro-ask' }, // spec 003 FR-094..FR-097: a Read-only denial's "Switch to Ask first…" opens the mode menu
  { name: 'check-why-allowed' }, // spec 003 FR-099..FR-105 (#605): the why-allowed tag on tool cards and Undo this rule
  { name: 'shots-009-openwith' }, // spec 009 FR-019..FR-025 (#685): the header's Open with menu (items, note, 10.5px, arrows, Esc, toast)
  { name: 'check-composer-toolbar' }, // spec 005 FR-037..FR-043: chat settings under the message box, one Send / Stop slot
  { name: 'check-slash-suggest' }, // spec 073: the "/" list in the message box (keyboard, ARIA, geometry)
  { name: 'check-notes' }, // spec 083: save a message, the Notes drawer, Insert and notes in the "/" list (US1 scenarios 1..6, SC-001, SC-002)
  { name: 'check-chat-memory' }, // spec 005 FR-238, FR-239 (issue 1380): a chat's transcript is bounded: 20,000 events after a fill and a warm-up, nodes, listeners and heap flat; caps and budget, waiting and live cards, helpers, note places, the line, a scrolled-up chat keeps its place, the cheap path
  { name: 'check-chat-memory', label: 'check-chat-memory real', env: { CCM_WORLD: 'real' } }, // the same with the Real office on (FR-078 parity)
  { name: 'check-chat-memory', label: 'check-chat-memory retro', env: { CCM_WORLD: 'retro' } }, // and with the Retro arcade
  { name: 'check-helper-retention', timeoutMs: 900_000 }, // spec 005 FR-240, FR-241 (issue 1418): a parent keeps its newest 50 done and 20 failed helpers; 300 more helpers of 500 events after 300 grow nodes, listeners and heap under the measured plateau; running, open and focused helpers kept; a late event ignored; stubs, the line, the office's count at 1440x900 and 1280x800
  { name: 'check-helper-retention', label: 'check-helper-retention real', env: { CHR_WORLD: 'real' }, timeoutMs: 900_000 }, // the same with the Real office on (097 FR-306, FR-338 parity)
  { name: 'check-helper-retention', label: 'check-helper-retention retro', env: { CHR_WORLD: 'retro' }, timeoutMs: 900_000 }, // and with the Retro arcade
  { name: 'check-notes-count' }, // spec 083 T030..T032: the header count, the marker on a saved message, the drawer's search (SC-005)
  { name: 'check-notes-screen' }, // spec 083 T034a: the per-folder Notes screen, its three ways in, Done (FR-044, FR-045)
  { name: 'check-notes-switch' }, // spec 083 T042: the project-file switch, its dialogs and states (FR-050, FR-055)
  { name: 'check-notes-source' }, // spec 083 T050: Open source on a note (FR-046)
  { name: 'check-notes-export' }, // spec 083 T034b: Export…, Delete all… and Remove folder's Also delete its notes (FR-048)
  { name: 'check-edits' }, // spec 005 FR-020..FR-026: file edits in the chat
  { name: 'shots-068-coffee' }, // spec 068: coffee break (simbreak=8 in its own query)
  { name: 'shots-097-screens', focus: true }, // spec 097 P2: live screens and the hover zoom
  { name: 'shots-097-screens', label: 'shots-097-screens retro', focus: true, env: { SCREENS_WORLD: 'retro' } }, // spec 102 FR-310 (issue #1428): the arcade's screens, helper heads and big screens
  { name: 'check-097-motion' }, // spec 097 P2: the people's motion and what stops it
  { name: 'check-097-motion', label: 'check-097-motion retro', env: { MOTION_WORLD: 'retro' } }, // spec 102 FR-309, FR-310 (issue #1428): the arcade's loops start after the calm, on the grid, stepped; its pause, still and scrolled-away rules
  { name: 'check-001-halo' }, // spec 001 FR-210: the waiting halo is a still glow, nothing animates it
  { name: 'check-office-ops-real' }, // spec 097 FR-186: operation counts of Real office, never times (renders, layout reads, nodes, attribute writes, elements recalculated, animations, picture area)
  { name: 'shots-097-realoffice' }, // spec 097 P1: Real office mode (the switch, the scene, the lights, flat loads none of it)
  { name: 'check-097-crews' }, // spec 097 FR-335, FR-336 (issue #1154): Real office with each Characters value draws its set or the Office people, no crew picture, the true note
  { name: 'shots-readme-real' }, // spec 008 delta 2026-11-08 (issue #1256): the README's lead pictures, Real office and its Needs you inbox
  { name: 'shots-070-flat-look' }, // spec 070 A14: Flat's modern look behind html[data-flat-look] (24 px controls on, today's off; Retro and Real office equal with it on)
  { name: 'check-102-welcome' }, // spec 102 FR-352 (T206): the arcade's first-run card stands in the drawn hall: the picture loads, shows beside the card, the card is opaque and its text is 4.5:1, both sizes; four mutants (WELCOME_MUTANT)
  { name: 'shots-102-previews' }, // spec 102 T265a (FR-302): one preview per built-in world in simscene=preview, 640 px WebP under 48 KB, with its zoom origin
  { name: 'shots-102-arcade' }, // spec 102 RA3: the Retro arcade behind its flag: only its files, cabinets, marquee, no overlap at 3, 4, 8 and 15 at both sizes
  { name: 'shots-102-arcade', label: 'shots-102-arcade wide font', env: { ARCADE_FONT: 'wide', ARCADE_CASES: 'narrow' } }, // spec 102 FR-312 (round 5 of #1599, issue #1574): the narrow plate's cases alone (ARCADE_CASES=narrow) in a font wider than macOS's (Verdana, else DejaVu Sans; the run fails if neither is installed), so the geometry is not tuned to one font
  { name: 'shots-097-moments' }, // spec 097 FR-118..FR-129: the nine world moments (first run, empty office, asleep at the desk, walk, inbox, limit, elicitation, coffee, jumps) in the Photo office and the cave
  { name: 'shots-097-moments', label: 'shots-097-moments cave', env: { MOMENTS_WORLDS: 'cave' } }, // the same nine moments in the Prehistoric cave (its flag is the simulator's page address)
  { name: 'shots-097-moments', label: 'shots-097-moments retro', env: { MOMENTS_WORLDS: 'retro' } }, // spec 102 FR-264: the same nine moments in the Retro arcade (its flag is the simulator's page address)
  { name: 'shots-097-chat' }, // spec 097 FR-106 (T120): the chat in the world: desk-side column, portrait, lamp words, surface and contrast, card tails
  { name: 'shots-097-chat', label: 'shots-097-chat retro', env: { MOMENTS_WORLDS: 'retro' } }, // spec 102 T221: the arcade's chat at three sizes: marquee name, the cards dark (4.5:1, deep), tab order as flat's
  { name: 'check-097-chat-look' }, // spec 097 (#1140, T195): every chat, main or helper, has the same world look and follows the Office layout setting while open
  { name: 'check-097-chat-look', label: 'check-097-chat-look retro', env: { DRIVER_WORLD: 'retro' } }, // spec 102 T283 (issue #1399): the same driver in the arcade
  { name: 'check-097-chat-contrast' }, // spec 097 (#1146, T197): chat text, links, code chips and header text against the real pixels behind them, both sizes; header text inside the window
  { name: 'check-097-chat-contrast', label: 'check-097-chat-contrast retro', env: { DRIVER_WORLD: 'retro' } }, // spec 102 T283 (issue #1399): the same driver in the arcade
  { name: 'check-097-letter' }, // spec 097 FR-377 (#1587): the schedule letter flies from the Postbox plate to the target's plate in the Photo office, both sizes, reduced motion, off-screen plate, 3:1 on the picture
  { name: 'check-097-letter', label: 'check-097-letter retro', env: { DRIVER_WORLD: 'retro' } }, // the same in the Retro arcade
  { name: 'check-097-letter', label: 'check-097-letter cave', env: { DRIVER_WORLD: 'cave' } }, // the same in the Prehistoric cave (spec 097 FR-377: one of the three Real office worlds)
  { name: 'check-097-order' }, // spec 097 FR-345..FR-348 (#1152): rooms, desks and places rearranged in Real office by key and folder menu on spec 033's one order; the flat order shows, both sizes
  { name: 'check-097-drag' }, // spec 097 FR-352..FR-355 (#1152, Q30..Q33): drag a plate or folder sign in Real office (Photo, cave, arcade), the lobby by chip button and the +N menu, on the one saved order; both sizes
  { name: 'check-097-slip-plates' }, // spec 097 (bug 1434): no request slip covers a plate, sign, chair label, chip, cue or face; 15 agents, both sizes, three worlds
  { name: 'check-097-plate-pencil' }, // spec 059 FR-170 (#1155): the rename pencil beside a Real office plate's name, F2 on a plate, both sizes
  { name: 'check-097-pencil-ease' }, // spec 097 FR-365 (bug 1513): no rename pencil painted over its plate's name or status while plates ease to the lounge (capturePage frames), Photo office and arcade, both sizes; PENCIL_EASE_MUTANT=nohide
  { name: 'check-097-ctx-frame' }, // spec 097 FR-322..FR-326 (Q8, owner 2026-11-07): the context line round each monitor frame in the Photo office, the cave and the arcade; bands, share, outside the glass, none for unknown, no node per update; CTX_MUTANT=colour|glass|node|unknown
  { name: 'check-097-desk-marks' }, // spec 097 FR-316 (#1149): the Draft tag above a Real office plate for an unsent draft, its words in the plate's name, shown by class, both sizes
  { name: 'check-097-desk-marks', label: 'check-097-desk-marks retro', env: { DRIVER_WORLD: 'retro' } }, // spec 102 T283 (issue #1399): the same driver in the arcade
  { name: 'check-097-helpers' }, // spec 097 FR-306..FR-311 (#1139): a desk's helpers as head figures with a status dot under its plate, Photo office, cave and the arcade at 1440x900, both sizes; where no strip fits (the arcade at 1280x800, the default scene at 1280x800) the plate keeps +N
  { name: 'check-097-kids' }, // spec 097 FR-368..FR-376 (#1642): the helpers as clay-toy kids on the desk top in the Photo office at 1 to 4 agents (picture, pose, one scale, +K, Tab, click, no zoom, no node per status), kid faces in the head row at 15, both sizes; KIDS_MUTANT=nokids|status|name|overlap|adulthead
  { name: 'check-097-helper-row' }, // spec 097 FR-338 (issue #1384), FR-356 (issue #1392: every folder sign whole, its + and menu inside it): a helper strip never wraps a head onto a second line; the last place is +K (6 and 7 helpers, the default scene and the lounge scene, Photo office, cave and arcade, both sizes)
  { name: 'check-097-hover-card', focus: true }, // spec 097 FR-327..FR-330 (#1151): the zoom opens over the person, desk and plate, for asleep agents, with the Changed line
  { name: 'check-097-hover-card', label: 'check-097-hover-card retro', env: { DRIVER_WORLD: 'retro' } }, // spec 102 T283 (issue #1399): the same driver in the arcade
  { name: 'check-097-lounge' }, // spec 097 FR-246..FR-249 (#1220): finished, read agents sit in the lounge row in the Photo office and the arcade, unread keeps the desk, the ease back, reduced motion, both sizes
  { name: 'check-097-world-look' }, // spec 097 FR-350, FR-351 (#1153): a world keeps its own colours whatever theme is picked, and the arcade's drop overlay reads
  { name: 'shots-097-cave' }, // spec 097 phase 4: the Prehistoric cave behind its flag (World row, its set, any set in any world, no blend)
  { name: 'shots-001-lobby' }, // spec 001 FR-034..FR-040: Boss queue, Bank, Postbox and its letter, who is at a place (simsched in its own query)
  { name: 'check-done-desk-mask' }, // spec 041 FR-065: no token of a done reply on the office floor
  // spec 052 FR-171: wrapping, sizes, box widths, field weight, dark contrast. Two drivers that run at once (issue #738: one took ~650 s
  // against the 600 s limit); the light part also has the built-in themes' contrast, the dark part the tones and the stylesheet check
  { name: 'check-ui-text', label: 'check-ui-text light', env: { UITEXT_PART: 'light' } },
  { name: 'check-ui-text', label: 'check-ui-text dark', env: { UITEXT_PART: 'dark' } },
  { name: 'shots-006-crash' }, // spec 006 FR-038..FR-046 (#606): the crash card (Resume all, Pick…, Dismiss), per-row resume, the lost-turn note
  { name: 'shots-074-navigator', env: { DURBAR_SIM_FLOORS: '1' } }, // spec 074: Go to (keyboard navigator), chat numbers, the shortcut in Settings
  { name: 'shots-095' }, // spec 095 phase 3: search conversations: the box, the results in the List view, open and jump, keyboard, live region, end-state notes, the shortcut in Settings
  { name: 'check-browser-scenarios' }, // spec 080 T018 AC2/AC4: US1 scenarios 1-5 and US2 scenarios 1-3 incl. SC-002 and SC-004; confirm, prompt, sensitive fields, sliding element, redirect, basic-auth pages
  { name: 'check-browser-cap' }, // spec 080 T013 AC3: six pages, four stay loaded, the two least recent reload with the note
  { name: 'check-browser-cap', label: 'check-browser-cap typing', env: { BROWSER_CAP_MODE: 'typing' } }, // AC4: typing in a page protects it; the sixth says too many are open
  { name: 'check-browser-links' }, // spec 080 T017/T018: links the agent prints open in that session's Browser tab, Ctrl/Cmd+click and the menu go to the system path, mail and other schemes, Settings > Open chat links in
  { name: 'check-browser-links', label: 'check-browser-links note', env: { DURBAR_SIM_BROWSER_CONSENT: 'ask' } }, // the same click with the one-time note: Not now sends the link to the system browser that time
  { name: 'check-browser-dialogs', env: { DURBAR_SIM_BROWSER_CONSENT: 'ask' } }, // spec 080 T015 AC6: the once-per-app consent, Leave this page?, a hidden session's page dialog (toast, chat forward once, marker)
  { name: 'check-browser-dialogs', label: 'check-browser-dialogs 1280', env: { DURBAR_SIM_BROWSER_CONSENT: 'ask', BROWSER_DIALOGS_SIZE: '1280x800' } }, // the same at 1280x800: the note, Leave this page?, the hidden dialog's toast
  { name: 'check-browser-tabs' }, // spec 080 Phase 1b (US6, FR-120..FR-133): page tabs, the toggle, pages opening tabs, 10 tabs, close while loading, keys, the cap, session end
  { name: 'check-browser-tabs', label: 'check-browser-tabs 1280', env: { BROWSER_TABS_SIZE: '1280x800' } }, // the same at 1280x800 (SC-011)
  { name: 'check-080-browser-expand' }, // spec 080 FR-134..FR-139 (issue #1691): Expand browser fills the chat panel, Back to small browser and Escape restore, focus, the page keeps its Escape, not remembered; Flat, both sizes
  { name: 'check-080-browser-expand', label: 'check-080-browser-expand photo', env: { EXPAND_WORLD: 'real' } }, // the same in the Photo office (Real office)
  { name: 'check-080-browser-expand', label: 'check-080-browser-expand retro', env: { EXPAND_WORLD: 'real', DRIVER_WORLD: 'retro' } }, // the same in the Retro arcade
  { name: 'check-browser-tab' }, // spec 080 T014/T015/T018: Chat | Browser tabs, the bar, the native view's attach and detach, the simulator's test pages, two sessions' own views
  // issue #748 (spec 021 FR-057): drivers that asserted but nothing ran, each passing alone on the simulator (seconds on a 4-core Linux box)
  { name: 'check-checkpoints' }, // spec 065 FR-003/FR-004/FR-007: the note after a turn that changed files, preview, restore, Undo the undo, the refusal (~21 s)
  { name: 'check-mode-refusal' }, // spec 012 FR-087: Codex refusing Read-only / Ask first (simsendfail=sandbox) (~14 s)
  { name: 'check-autopilot', label: 'check-autopilot default' }, // spec 099: the default build: nothing offers Autopilot
  { name: 'check-autopilot', env: { DURBAR_AUTOPILOT_TEST: '1' } }, // spec 099 T037: the test-only gate: menu, form, chip, every end reason, hostile text, both sizes
  { name: 'check-plan-mode' }, // spec 066: Plan first (next message), the chip, the plan card with Approve / Revise / Reject (~18 s)
  { name: 'shots-006-continue' }, // spec 006 FR-021: a folder continues its last session after a restart (~12 s)
  { name: 'shots-006-remove' }, // spec 006 FR-022: removing a folder is easy to find, Cancel keeps it (~26 s)
  { name: 'shots-012-elicit' }, // spec 012 FR-151..FR-155: an MCP elicitation as a form in the question card, and the URL mode (~28 s)
  { name: 'shots-021' }, // spec 011 FR-026..FR-029: usage totals kept across restarts, the reset, "credits not reported" (~29 s)
  { name: 'shots-030-handover' }, // spec 030 FR-042..FR-045: continue a conversation in another agent app (mixed agent apps) (~20 s)
  { name: 'shots-043-default' }, // spec 043 FR-009: the folder's default agent in the New session dialog (~28 s)
  { name: 'shots-061-foldersetup' }, // spec 061: the folder-setup dialog (simfoldersetup=1) (~18 s)
  { name: 'shots-i7' }, // spec 020 FR-020..FR-031: the per-folder Import from VS Code action (~31 s)
  { name: 'shots-m9' }, // spec 011: the credit cap (~29 s)
  { name: 'shots-m10' }, // spec 020: Tools This session / All time, MCP extras per folder, the agent MCP dialog (~37 s)
];

/**
 * Drivers that assert, pass by hand on the simulator and are on purpose NOT in DRIVERS, each with the reason (issue #748, spec 021 FR-057).
 * scripts/test-ui-suite.ts fails on an asserting scripts/check-*.js or shots-*.js that is in neither DRIVERS, shots-docs' DOC_SHOTS nor here,
 * so a driver can no longer be written, cited as `sim:` evidence and never run. Moving one into DRIVERS is the way out of this list.
 */
const NOT_IN_SUITE = {
  'check-console-mask': 'not a window driver: a source check, run by npm test as test:consolemask (spec 012 T137)',
  'world-matrix': 'spec 098 FR-051/FR-054: the world matrix has its own workflow (world-matrix.yml, weekly and a path-filtered pull request subset) and writes only to out/world-matrix; it is not part of the every-PR suite. Its checks are proven by `node scripts/world-matrix.js --selftest`',
  'shots-034': 'passes alone but takes about 124 s (fixed settles at both sizes, Serious mode, reduced motion, mini); CI is near its limit (#738). Needs its sleeps turned into until() waits before it joins the suite. Since spec 068 FR-005 it checks that the credit limit is a break, not a faint',
  'shots-024-custom': 'passes alone with DURBAR_SIM_PLACES=3 but takes about 89 s (custom places: seeding, Add / Edit dialog, Settings, rename, delete at both sizes); too long for the suite today. Run it by hand: DURBAR_SIM_PLACES=3 as its header says',
  'check-rename': 'npm run check:rename, about 140 s (spec 059, issue #372: rename a session, every kind and level, both sizes); check-rename-inline in DRIVERS covers the in-place rename on every surface',
  'check-perf': 'npm run check:perf measures frame times and DOM growth under load; its limits depend on the machine, so it is a local check, not a gate on shared runners',
};

/** The screenshot variables the drivers read; all point at one folder. */
const OUT_VARS = ['OUT', 'SHOTS_012', 'SHOTS_021', 'SHOTS_024', 'SHOTS_033', 'SHOTS_034', 'SHOTS_OUT', 'MODEL_OUT', 'CARDMENU_OUT', 'MODE_OUT', 'ABOUT_OUT', 'HERO_OUT', 'SHOTS_DIR', 'I7_OUT', 'M9_OUT', 'M10_OUT'];
const TIMEOUT_MS = Number(process.env.UI_SUITE_TIMEOUT_MS || 600_000);

function args(a = process.argv.slice(2)) {
  const i = a.indexOf('--only'), j = a.indexOf('--shard');
  return { list: a.includes('--list'), only: i >= 0 ? new Set(String(a[i + 1] || '').split(',').filter(Boolean)) : undefined, shard: j >= 0 ? a[j + 1] : undefined, shardGiven: j >= 0 };
}

/** Recorded seconds per driver (scripts/ui-suite-timings.json), only to balance shards; a driver with no entry counts as the median. */
function timings() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'ui-suite-timings.json'), 'utf8')); } catch { return {}; }
}
/** Seconds the office layout and the Mac title bar (run in shard 1 only, ui-platforms.yml) are assumed to cost, so shard 1 gets fewer drivers. */
const SHARD1_HEAD_START_SECS = 240;

/** Spec 008 FR-182 (issue #839), FR-183: shard `i/n` (1-based) is a greedy split by recorded duration: drivers from the slowest down, each to the
 *  shard with the least time so far (ties: the lower shard, then the suite's order), shard 1 starting with SHARD1_HEAD_START_SECS. Each shard
 *  runs its drivers in the suite's order. n shards are disjoint and together hold every driver of `list`; the result depends only on `list`
 *  and the committed timing file. No spec: the whole list. */
function shard(list, spec, times = timings()) {
  if (spec === undefined || spec === '') return list;
  const m = String(spec).match(/^(\d+)\/(\d+)$/);
  const i = m ? Number(m[1]) : 0, n = m ? Number(m[2]) : 0;
  if (!m || n < 1 || i < 1 || i > n) throw new Error(`ui-suite: --shard wants i/n with 1 <= i <= n, got "${spec}"`);
  const known = Object.entries(times).filter(([k, v]) => !k.startsWith('_') && Number.isFinite(v)).map(([, v]) => v).sort((x, y) => x - y);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const w = (d) => { const v = times[d.name]; return Number.isFinite(v) ? v : median; };
  const load = Array.from({ length: n }, (_, k) => (k === 0 && n > 1 ? SHARD1_HEAD_START_SECS : 0));
  const mine = new Set();
  list.map((d, k) => ({ d, k })).sort((x, y) => w(y.d) - w(x.d) || x.k - y.k).forEach(({ d }) => {
    let best = 0;
    for (let b = 1; b < n; b++) if (load[b] < load[best]) best = b;
    load[best] += w(d);
    if (best === i - 1) mine.add(d);
  });
  return list.filter((d) => mine.has(d));
}

/** Spec 008 FR-210: do the drivers' windows share one desktop, and so one OS window focus? True on macOS, Windows and Linux with a display;
 *  false on Linux under xvfb (a display, and a focus, per driver: `runOne` uses xvfb-run exactly then). */
function sharedDesktop(platform = process.platform, env = process.env) {
  return platform !== 'linux' || (!!env.DISPLAY && env.UI_SUITE_XVFB !== '1');
}

/** Spec 008 FR-112: syntax errors in the given files, from `node --check` (no shell, nothing run). [] when all parse. */
function syntaxErrors(files) {
  const out = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', shell: false, windowsHide: true });
    if (r.status !== 0) out.push({ file: path.relative(ROOT, f), error: String(r.stderr || r.error || `exit ${r.status}`).trim() });
  }
  return out;
}

/**
 * Spec 008 FR-175 (review on #1083): end a child and everything it started. On POSIX the child must lead its own process group
 * (`detached: true`), which the whole group gets SIGKILL; on Windows `taskkill /T /F` (no shell) ends the tree. Falls back to `child.kill()`.
 */
function killTree(child, { platform = process.platform, run = require('child_process').execFile, sync = false } = {}) {
  if (!child || !child.pid) return;
  try {
    if (platform === 'win32' && sync) require('child_process').execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore', timeout: 10000 });
    else if (platform === 'win32') run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false }, () => {});
    else process.kill(-child.pid, 'SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

/**
 * Spec 008 FR-175 (review on #1083): a detached tree does not get the terminal's Ctrl-C, so while it runs, SIGINT, SIGTERM and the
 * parent's exit end it with `killTree`; a signal is then raised again with its default action (exit 130 / 143, as without the
 * handler). `cleanup` (sync, optional) also runs then, for what the run leaves on disk. Returns `release()`, called when the run ends, which removes the handlers. `proc` and `kill` are for tests.
 */
function guardTree(child, { proc = process, kill = killTree, cleanup = () => {} } = {}) {
  let done = false;
  const onSignal = (sig) => { kill(child, { sync: true }); try { cleanup(); } catch { /* best effort */ } release(); proc.kill(proc.pid, sig); };
  const onExit = () => { kill(child, { sync: true }); try { cleanup(); } catch { /* best effort */ } };
  const release = () => {
    if (done) return;
    done = true;
    proc.removeListener('SIGINT', onSignal);
    proc.removeListener('SIGTERM', onSignal);
    proc.removeListener('exit', onExit);
  };
  proc.on('SIGINT', onSignal);
  proc.on('SIGTERM', onSignal);
  proc.on('exit', onExit);
  return release;
}

/** The device scale factors a run may force: whole 1..4, and Windows' 125 % and 150 % (spec 102 T204, #1403). Anything else is ignored. */
const dprOk = (v) => /^([1-4]|1\.25|1\.5)$/.test(String(v));

/**
 * Spec 008 FR-213 (issue #1591): the `xvfb-run` options that give Xvfb a screen as big as the biggest window at the requested density. Xvfb's default screen
 * is 1280x1024 device pixels, so at UI_SUITE_DPR=2 a 1440x900 window (2880x1800 device pixels) was mostly off screen: nothing real was painted below
 * device y 1024 and painted-pixel checks could not see the lower rooms. The screen is 1920x1100 logical (the 1920x1080 view of the widest driver and a margin)
 * times the density, colour depth 24: DPR 1 is 1920x1100, DPR 2 is 3840x2200. A bad or unset density counts as 1.
 * `UI_SUITE_XVFB_SCREEN=WxHxD` replaces it (checked; a malformed value is ignored). Returned as separate argv entries (`-s` and one value), never a shell string.
 */
function xvfbScreenArgs(dpr, env = process.env) {
  const want = String(env.UI_SUITE_XVFB_SCREEN || '');
  if (/^[1-9]\d{2,4}x[1-9]\d{2,4}x(8|16|24|30|32)$/.test(want)) return ['-s', `-screen 0 ${want}`];
  const f = dprOk(dpr) ? Number(dpr) : 1;
  return ['-s', `-screen 0 ${Math.ceil(1920 * f)}x${Math.ceil(1100 * f)}x24`];
}

/** The command that starts Electron for a driver: the binary itself, or under `xvfb-run -a` (a display of its own) with the screen of `xvfbScreenArgs`. Separate argv entries, no shell. */
function launchCommand(useXvfb, electron, argv, dpr, env = process.env) {
  return useXvfb ? ['xvfb-run', ['-a', ...xvfbScreenArgs(dpr, env), electron, ...argv]] : [electron, argv];
}

/**
 * Run one driver. Opt-in for unattended callers (spec 008 FR-175, FR-176; scripts/release-video.js): `d.baseEnv` replaces
 * `process.env` as the base of the child's environment (an allow-list, so no token reaches Electron), `d.timeoutMs` replaces the
 * suite's limit. Every driver (spec 008 FR-199, issue #1417) runs as its own process tree: it ends with the whole tree at the limit and when
 * this process gets SIGINT, SIGTERM or exits (`xvfb-run`'s own cleanup does not run when only its shell is killed). There is no `d.killTree` flag.
 * `launch` is for tests: `[file, args]` replaces the Electron/xvfb-run command.
 */
function runOne(d, outDir, { launch } = {}) {
  const electron = require('electron'); // the binary's path
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ui-user-'));
  const env = { ...(d.baseEnv || process.env), ...(d.sim === false ? {} : SIM), ...(d.env || {}), DURBAR_USER_DATA: user, DURBAR_DRIVER: path.join(__dirname, d.name + '.js') };
  if (d.sim === false) { delete env.DURBAR_SIM; delete env.DURBAR_SIM_FREEZE; }
  if (d.freeze === false) delete env.DURBAR_SIM_FREEZE; // a driver that needs the live simulator (spec 001 FR-082: shots-docs.js)
  for (const v of OUT_VARS) env[v] = outDir;
  const dpr = String(d.dpr || process.env.UI_SUITE_DPR || ''); // d.dpr: a driver that always records at that density (release-video: sharp zooms)
  const argv = [ROOT, '--no-sandbox', ...(dprOk(dpr) ? ['--force-device-scale-factor=' + dpr] : [])]; // UI_SUITE_DPR=2: a high-density screen (a Retina Mac) on any OS
  const useXvfb = !sharedDesktop(); // UI_SUITE_XVFB=1: keep windows off a desktop
  const [file, list] = launch ? launch : launchCommand(useXvfb, electron, argv, dpr);
  return new Promise((resolve) => {
    const started = Date.now();
    let log = '';
    const child = spawn(file, list, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, ...(process.platform !== 'win32' ? { detached: true } : {}) });
    const keep = (b) => { log += b.toString(); if (log.length > 400_000) log = log.slice(-200_000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const releaseGuard = guardTree(child, { cleanup: () => fs.rmSync(user, { recursive: true, force: true }) });
    const timer = setTimeout(() => { log += '\n[ui-suite] time limit reached'; killTree(child); }, d.timeoutMs || TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      releaseGuard();
      fs.rmSync(user, { recursive: true, force: true });
      const failedLine = log.split(/\r?\n/).find((l) => l.includes('DRIVER FAILED') || l.includes('[ui-suite] time limit'));
      resolve({ ok: code === 0 && !failedLine, code, secs: Math.round((Date.now() - started) / 1000), why: failedLine || (code !== 0 ? `exit ${code}` : ''), log });
    });
  });
}

/** `ensure`, `run` and `argv` are for tests (scripts/test-ui-suite.ts); the defaults install Electron and start the real drivers. */
async function main({ ensure = ensureElectron, run = runOne, argv, shared = sharedDesktop() } = {}) {
  const a = args(argv);
  // a bare `--shard` (no value) is refused, never "every driver"; only an empty UI_SUITE_SHARD env value means the whole list (FR-182, review on #1257)
  if (a.shardGiven && !a.shard) throw new Error('ui-suite: --shard wants a value i/n (1 <= i <= n), got none');
  const sh = a.shardGiven ? a.shard : process.env.UI_SUITE_SHARD;
  const todo = shard(DRIVERS.filter((d) => !a.only || a.only.has(d.name) || a.only.has(d.label || '')), sh);
  if (a.list) { for (const d of DRIVERS) console.log(d.label || d.name); return; }
  // a shard that selects no driver (more shards than drivers, or --only narrowing) must not pass green with "0/0"
  if (sh && todo.length === 0) throw new Error(`ui-suite: shard ${sh} selects no driver${a.only ? ' (with --only)' : ''}; refusing to pass with nothing run`);
  for (const d of todo) if (!fs.existsSync(path.join(__dirname, d.name + '.js'))) throw new Error(`no such driver: ${d.name}`);
  // FR-112: fail at once on a syntax error instead of a silent Electron hang until the time limit
  const bad = syntaxErrors([...new Set(todo.map((d) => path.join(__dirname, d.name + '.js')).concat(path.join(__dirname, 'driver-helpers.js')))]);
  if (bad.length) {
    for (const b of bad) console.error(`ui-suite: syntax error in ${b.file}\n${b.error.split(/\r?\n/).map((l) => '      | ' + l).join('\n')}`);
    throw new Error(`${bad.length} file(s) do not parse: ${bad.map((b) => b.file).join(', ')}; no driver was started`);
  }
  // FR-114: install Electron once before the drivers start in parallel (two first runs racing on the same binary fail, PR #546)
  if (!ensure()) throw new Error('the Electron binary is not installed and could not be fetched (see above); no driver was started');
  const outDir = process.env.UI_SUITE_OUT ? path.resolve(process.env.UI_SUITE_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ui-shots-'));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`ui-suite: ${todo.length} drivers on ${process.platform}${sh ? ` (shard ${sh})` : ''}, screenshots in ${outDir}`);
  // fast checks (owner rule): in parallel, never fewer checks; each driver has its own profile and window (own xvfb display on Linux)
  const jobs = Math.max(1, Math.min(6, Number(process.env.UI_SUITE_JOBS || 2) || 2));
  const failed = [];
  const started = Date.now();
  // spec 008 FR-210 (issue #1498): an entry with `focus: true` waits on the real OS window focus, which a neighbour's window takes away on a shared
  // desktop: the others run `jobs` at a time first, then those entries one at a time with no other window open
  let queue = shared ? todo.filter((d) => !d.focus) : todo;
  const alone = shared ? todo.filter((d) => d.focus) : [];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const d = queue[next++];
      const r = await run(d, outDir);
      console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${(d.label || d.name).padEnd(26)} ${String(r.secs).padStart(4)} s${r.ok ? '' : '  ' + r.why.trim().slice(0, 300)}`);
      /* spec 008 FR-190: a wait that timed out (`[waits] ...` from driver-helpers) shows even when the driver passed: a wait that is always spent costs its whole limit every run */
      if (r.ok) for (const l of [...new Set(String(r.log || '').split(/\r?\n/).filter((x) => x.startsWith('[waits]')).map((x) => x.slice(0, 200)))].slice(0, 4)) console.log('      ' + l);
      if (!r.ok) {
        failed.push(d.label || d.name);
        console.log(r.log.split(/\r?\n/).filter((l) => l.trim()).slice(-25).map((l) => '      | ' + l.slice(0, 240)).join('\n'));
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  queue = alone; next = 0;
  await worker();
  // a slow runner (macOS in CI) can lose a race against a fixed delay: one more run alone, reported as FLAKY so it stays visible
  const flaky = [];
  if (process.env.UI_SUITE_RETRY === '1' && failed.length) {
    for (const label of [...failed]) {
      const d = todo.find((x) => (x.label || x.name) === label);
      const r = await run(d, outDir);
      console.log(`  ${r.ok ? 'FLAKY (passed on retry)' : 'FAIL again'} ${label}${r.ok ? '' : '  ' + r.why.trim().slice(0, 300)}`);
      if (r.ok) { failed.splice(failed.indexOf(label), 1); flaky.push(label); }
    }
  }
  console.log(`ui-suite: ${jobs} at a time, ${Math.round((Date.now() - started) / 1000)} s in all`);
  console.log(`\nui-suite: ${todo.length - failed.length}/${todo.length} passed on ${process.platform}${flaky.length ? '; FLAKY (passed only on retry): ' + flaky.join(', ') : ''}${failed.length ? '; failed: ' + failed.join(', ') : ''}`);
  if (flaky.length && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**Flaky drivers on ${process.platform}** (failed once, passed on retry): ${flaky.join(', ')}\n`);
  if (failed.length) process.exitCode = 1;
}

module.exports = { dprOk, xvfbScreenArgs, launchCommand, sharedDesktop, syntaxErrors, main, runOne, killTree, guardTree, shard, DRIVERS, NOT_IN_SUITE }; // runOne: also spec 001 FR-082 (scripts/shots-docs.js)
if (require.main === module) main().catch((e) => { console.error('ui-suite:', e.message); process.exitCode = 1; });
