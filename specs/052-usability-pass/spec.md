# Feature Specification: Usability pass from persona reviews

**Feature Branch**: `052-usability-pass`
**Created**: 2026-10-19
**Status**: Round 1 built (FR-001..FR-014); rounds 2 and 3 of the review follow (owner: "run at least 3 rounds selecting different personas")
**Input**: The owner, 2026-10-19: "have some sub agents (with different personas) perform some usability review sessions and get feedback from them and implement feedback - we want the app to be legible, does not feel messy or confusing, the app must feel that it is an app developed in 2026 and has some nostalgic feels with themes, clean design principles."

## The review sessions (2026-10-19)

Four reviewers worked from 17 simulator screenshots: the office at 1440x900 and 1280x800, a waiting and a working agent's chat, the mode menu, the list view, Tools, Settings, the Folders menu, the AI theme dialog, the welcome screen and four themes. They also read the renderer source. Each was an AI sub-agent with a persona, not a person:

- **Maria**, an operations manager who has never used a terminal;
- **Dev**, a staff engineer who runs 10-15 agents all day;
- **Lena**, a product designer, judging against the owner's brief;
- **Sam**, an accessibility specialist (WCAG 2.2 AA), low vision with deuteranopia, keyboard-only part of the day.

**What they agreed on** (the number of reviewers in brackets):
1. A waiting agent's chat does not show how to answer. "Previous sessions" is open and takes half the panel, and the Approve / Deny buttons are below the fold [Maria, Dev, Lena].
2. The chat header has 9 buttons of equal weight; Stop, End session and Remove session sit side by side [all four].
3. The "restored in Allow all" message disappears after 9 s, cannot be dismissed, covers the composer, and is worded for engineers [all four].
4. The top bar's *Read-only* and *Model: Auto* are defaults for new sessions but look like the state of every agent [Maria, Dev, Lena].
5. The room-header counts (● 1 ● 4 ● 1) are colour only and hidden from screen readers [Sam, Dev].
6. The heading of a newly opened chat or screen gets a thick focus box that looks like an edit field or an error [Lena, Sam, Maria].
7. The list view's header row is drawn slanted [Lena, Sam].
8. Muted text and the focus ring are below contrast on the room walls; copy buttons appear only on hover [Sam].
9. Engineer words in plain view: "fainted", "dizzy", "credits not reported", spec numbers in Settings [Maria, Dev, Lena].
10. Themed place names ("Yantra Kaksh", "Cartridge Bay") hide what the place is [Dev, Maria].
11. No keyboard way to reach the next agent that needs you [Dev].

**What they asked to keep:** the fixed status language across themes and views; the desk metaphor at card density; the waiting-first agent strip; the List view's calm; the welcome card; and the rule that themes never change sizes.

## Requirements (Phase 1)

- **FR-001** **Answer bar.** While an agent waits on a permission request or a question, a bar is pinned just above the composer: "*Name* asks: *the request*". It has the same choices as the card in the chat (Approve / Approve for this session / Deny, or the question's options and *Reply…*), and they act on the same request. It is hidden when nothing is pending, and *Show in chat* scrolls to the card.
- **FR-002** **Previous sessions stay closed when there is a conversation.** The list opens by itself only when the agent's chat is empty (a new session in a folder with history), as before. The toggle shows the count, and the user's choice is kept.
- **FR-003** **Chat header: two actions and More.**
  - Visible: *Stop* (while a turn runs, as before), *Open in VS Code*, and **More**.
  - More opens a menu with Tools, MCP servers, Schedules, + New session and Copy resume command. Then, after a divider, *End session* and **Remove session…**, in danger colour and last.
  - The menu is a real menu: Esc closes it, the arrow keys move, and focus returns to More.
  - The buttons keep their ids, so every driver and shortcut still works.
- **FR-004** **The restore message is a calm banner the user closes.**
  - Wording: "**2 folders can still act without asking you**, as you left them (Allow all). Change it in each folder's mode menu."
  - It has a *Got it* button and no timeout, it sits where it covers nothing the user needs, and it pauses on hover or focus.
  - Other toasts keep their timers, but any toast pauses while hovered or focused.
- **FR-005** **Top bar: the defaults say they are defaults.** The mode select reads **New: Read-only / New: Ask first / New: Allow all**. That is narrower than the old widest option, "Allow all (no prompts)", so the 1280 fit only gains room. The harness, mode and model selects get accessible names and tooltips that start with "Default … for new sessions" and say each agent shows its own value in its chat. *Decision while building:* a visible "New sessions" caption was tried on paper, but it would widen the top bar at 1280x800. The three-cluster bar is #308.
- **FR-006** **Room-header counts in words and shapes.**
  - Each count has a shape as well as a colour: waiting ◆, error ▲, working ●, ready/idle ○, done ✓.
  - The group has a text alternative ("1 waiting, 4 working, 1 done") for screen readers and as a title.
- **FR-007** **No focus box on a heading that gets focus by itself.** Opening a chat or a screen still moves focus to its heading (screen readers announce it), but the heading shows no ring. Keyboard focus on real controls keeps the 3px ring.
- **FR-008** **The list view's header row is straight.** Fix the cause; the row is a normal grid row.
- **FR-009** **Contrast** (Clean Office tokens; built-in themes that copy them follow):
  - `--muted` reaches 4.5:1 on the room walls;
  - the focus ring reaches 3:1 on every wall;
  - "No cap" and similar information chips use body ink, not the disabled grey.
- **FR-010** **Copy and more buttons are visible at rest** (dimmed), not only on hover.
- **FR-011** **The desk's accessible name includes its permission mode** ("…, Allow all"), and the mode glyph has a text alternative.
- **FR-012** **Plain words:**
  - list view: "fainted: credit limit reached" → "Out of credit: limit reached", and "dizzy: 3 failed tool calls in a row" → "Stuck: 3 tool calls failed in a row";
  - room header: "credits not reported" → "cost not reported";
  - Settings: no spec numbers in user-facing text, and the credit-cap help is one sentence with the details behind *More*.
- **FR-013** **A themed place keeps its plain name.** The place's tooltip and accessible name say what it is: "Cartridge Bay (Software library)". The card line "At Cartridge Bay" also has the plain name in its tooltip.
- **FR-014** **Next agent that needs you:** the key **N** (outside text fields) opens the chat of the next agent that is waiting, in error or at its limit, in office order. It wraps around, and it is listed in the keyboard help.

## Follow-ups (issues, not this phase)

- "Needs you" inbox (#305): one queue, answer each request without opening its chat.
- Simple / Expert mode (#306): hide tokens, MCP, context and model for non-developers.
- Cost in money (#307): one unit, with today's spend in the user's currency, and AIU as detail.
- Top bar: three clusters (#308) (Create, Defaults, View), with the rest in an overflow menu.
- Settings: theme grid (#309) with previews, help behind *Details*, MCP under *Advanced*.
- Per-theme polish (#310): Corporate's 90s office, softer Retro floors, Indian Court carpet only on empty floor, a real tatami grid.
- One control-size scale (#311) (32 / 26 / 22 px) as tokens; 24px targets in the room header.

## Success criteria

- **SC-001** In the simulator, a waiting agent's chat shows its pending request and the buttons to answer it without scrolling, at 1440x900 and 1280x800.
- **SC-002** The chat header shows at most 3 action buttons.
- **SC-003** `check:office`, `check:geometry` and `npm test` pass; screenshots at both sizes are replaced.
- **SC-004** The four reviewers' screens are captured again after the change; the before-and-after shots go in the PR.

## Evidence (round 1)

- `[IMPLEMENTED]` FR-001..FR-014 in `src/renderer/` (`app.js`, `styles.css`, `index.html`, `theme.js`, `mood.js`, `usagetotals.js`, `screens.js`).
- **Causes found while building:**
  - FR-008: the list header row had the class `head`. The avatars' heads nod (`.head{animation:nod}`), so the whole header row nodded with them. It is now `lhead`.
  - FR-002: "untouched" counted only messages sent in this app, so a restored or simulated chat with a conversation still opened Previous sessions over it.
- `sim:` `scripts/shots-052-ux.js` passes at 1440x900 and 1280x800:
  - the banner stays after 10 s, Got it closes it, and it sits bottom left;
  - the room counts have words;
  - Jonas's request is answerable without scrolling (the card in view, or the bar);
  - with the chat scrolled away, the bar's Approve settles the card;
  - 3 header actions (Open in VS Code, Stop, More); the More menu opens on Down and closes on Esc, with focus back on More, and End and Remove are last;
  - Previous sessions is closed; the list header is straight (column tops within 1px);
  - N goes Kenji → Tomas (Jonas had just been approved).
  - Screenshots: `docs/screenshots/052-*.png`.
- `test:` `test:mood`, `test:usagetotals` and `test-usage-012` cover the new wording; `npm test` (45 suites) passes.
- `check:office` (2 shards, default theme) and `check:geometry` (60/60) pass. Two checks were adapted to the intended behaviour: a themed place's label may continue "Name (plain name): …", and the previous-sessions check opens the closed list as a user would.
- Found while checking: copy buttons in Thinking blocks and sub-agent prompts were placed in the panel's corner. They were invisible until FR-010 showed them; they now sit on their own block.
- Contrast (FR-009), computed from the tokens: `--muted` #535a55 is at least 4.88:1 on every room wall; `--focus` #2f5f8a is at least 3.7:1 on every surface and card line.
- `[KNOWN GAP]`: the reviews were AI personas working from screenshots and the source, not people; nobody ran a screen reader or 150% zoom.

## Changes

### 2026-10-19: round 2, new personas on the round-1 build

**The panel:**
- **Aiko**, a junior developer in her first week who uses Codex only;
- **Rafael**, a team lead on a 13-inch laptop (1280x800) who triages between meetings;
- **Noor**, an application-security engineer deciding on a company rollout;
- **Kaito**, an art director at a retro games studio.

All four were AI personas with 21 new screenshots and the source.

**Verdicts on round 1:**
- the answer bar, Previous sessions, "New: Read-only", the status shapes and the plain words work;
- the More menu works only partly (Stop vs End vs Remove is unclear);
- the restore banner works only partly: it names nothing, covers the composer, counts sessions but says "folders", and gives no route to the fix;
- N works but nobody can discover it.

**New findings, by risk:**
1. The answer bar could cut a long command at 160 characters right next to Approve [Noor].
2. Switching to Allow all ticks "also approve the N waiting requests" by default [Noor].
3. Allow all is a small pencil on the desk, which reads as "editable", not as unguarded [Noor, Rafael, Aiko].
4. *Approve for this session* hides its scope in a tooltip, and says "until you stop" although Stop does not end the grant [Noor].
5. "Stuck" and "memory nearly full" show only in the List view [Rafael, Aiko].
6. Theme craft [Kaito]:
   - Retro's pastel tints and orange drawers break the arcade night;
   - Corporate's rooms all look the same;
   - the Japanese and European courts use place words from the wrong culture;
   - the European court's small caps render tiny;
   - Clean Office reads as 2021: outlines everywhere and five corner radii.

**Requirements (round 2):**
- **FR-015** **The restore notice is a strip under the top bar, not an overlay.**
  - It names the folders: "Allow all, restored from your last run: *swisscontract-ai*, *command-center*".
  - It offers **Switch to Ask first** (all of them, one click; lowering a mode needs no confirmation) and **Keep**, which dismisses it.
  - It counts folders, not sessions.
  - It covers nothing; the office lays out below it.
- **FR-016** **The answer bar never shortens what you approve.**
  - The request text is shown in full and wraps, up to 6 lines, then the bar shows only *Show in chat*.
  - Several pending requests show "1 of 3", oldest first.
  - The wide grant ("any arguments") stays in the card only.
  - *Show in chat* moves focus to the request card, not to Approve.
- **FR-017** **Switching to Allow all asks separately** about requests waiting now: the box is not ticked, and the dialog lists them.
- **FR-018** **Allow all looks different on the desk:** an open padlock in the warning ink, with the tooltip "Allow all: runs edits, commands and tools without asking" (plus "(restored)").
- **FR-019** **Wording:**
  - *Approve for this session* names its scope in the button: "Allow *scope* this session", cut to 32 characters with the full text in the tooltip;
  - grants last "until you end this session";
  - the denied note says "Ask first";
  - Read-only's help says read-only MCP tools still run;
  - "1 Error", not "1 Errors".
- **FR-020** **The More menu explains each item:**
  - Stop: "interrupts this reply; the chat stays";
  - End session: "frees it; your next message resumes it";
  - Remove session: "takes the card out; history stays on disk".
- **FR-021** **Office cards show a warning glyph** (⚠ in the status pill) when an agent is stuck (3 failed tool calls) or its memory is nearly full; the reason is in the tooltip and the accessible name.
- **FR-022** **Settings say which harness a section applies to:**
  - *Spending limit* is "Copilot sessions (AI credits). Claude Code sessions have a dollar cap in their chat header";
  - *MCP servers* says Claude Code and Codex use their own MCP settings.
- **FR-023** **Theme craft, within the theme rules** (colours, borders, words only; no size changes):
  - **Retro:** PICO-8 tints `--tint-sage` #a8e4a0, `--tint-blue` #9fc3e8, `--tint-sand` #f2d48a, `--tint-clay` #f0b8a8; `--desk-drawer` the same as `--desk-front`.
  - **Corporate:** tints carry the wall colour (#eef6f3, #edf3fa, #f8f3e6, #f9efed).
  - **Indian court:** room border `--line-2` #b8892f.
  - **Japanese court** place words Bunko, Kōbō, Kikan-shitsu, Tsūshinjo, Zatsumu.
  - **European court:** places The Forge, The Messenger Hall, The Household; room names in uppercase with letter spacing, not small caps.
- **FR-024** **Clean Office toward 2026** (sizes unchanged):
  - cards lose their outline for a soft two-layer shadow;
  - one radius scale: rooms 16, units 12, cards 10, buttons and selects 8, pills 999;
  - numbers use tabular figures;
  - `--bg` #f7f6f3 and `--line` #e7e3dc (warm neutral rather than cream).

- **FR-025** **Top bar in clusters (#308).**
  - *Create:* + Folder, + Workspace.
  - *Defaults for new sessions:* harness, mode, model and effort in one quiet group, labelled for screen readers.
  - *View:* Folders, the folder filter, Tools, Settings, Office/List.
  - **⋯** holds the rarely used controls with a line each: Close all and Open all room doors, and the Demo switch.
  - The ids are kept; at 1280x800 the bar is one row.
- **FR-026** **Security finding fixed (alert 35, from #312):** `js/bad-code-sanitization` in `scripts/shots-052-ux.js`, a name spliced into page code with `JSON.stringify`. Every driver now splices values with `jsLiteral` (exported by `check-office-overlap.js`); 13 scripts were swept, including spots CodeQL had not flagged. The merge script now blocks on any `github-advanced-security[bot]` comment as well as on open alerts on the merge ref.
- **Layout fixes found by `check:office` while building round 2:**
  - the strip is 31px, so 14 one-agent rooms still fit at 1280x800;
  - a room header's floor tag shrinks with an ellipsis (its title has the full name), so the controls never reach the plant in the micro layout.

**Kept as they are, deliberately:**
- Themed place names stay in card text: the nostalgia is the point, and the plain name is in the tooltip (FR-013).
- Today's cost (#307) and splitting *Limit* from *Waiting* stay follow-ups.


**Evidence (round 2):**
- `sim:` `scripts/shots-052-ux.js` passes at both sizes:
  - the strip names the folders and the office starts below it;
  - *Switch to Ask first* clears it (1440x900), and *Keep* dismisses it (1280x800);
  - the bar's session approval reads "Approve “…” for this session".
- **A bug caught by that check:** a marker line placed after an `if(…)` without braces flagged the session button as the wide grant, so the bar dropped it. The marker now sits inside the `if` block.
- `test:` `test:theme` follows the new `--bg`; `npm test` passes.

### 2026-10-19: the follow-ups, built for alpha.8

*Owner:* "implement things which you created as issues from usability feedback for tomorrow's pre-release and not just park them there", and "this a brand new app only seen by 3 people - dont worry too much about compatibility - if you find good feedback from personas go ahead and do changes even if they are drastic".

- **FR-027** **Needs you inbox (#305).**
  - A **Needs you** button next to the status counts shows how many agents need you. Agents count when they are waiting on a permission or a question, are at their limit, or are in error.
  - It opens one queue, oldest first. Each row shows:
    - the agent and its folder;
    - the request in full;
    - the same choices as its card in the chat (the wide grant stays in the chat);
    - *Open chat*.
  - Answering a row settles the agent's card, as the answer bar does.
  - **I** opens the inbox; Esc closes it; when nobody needs you it says so.
- **FR-028** **Cost in one unit (#307).**
  - The header and room totals show money, "≈ $0.35": Copilot credits at USD 0.01 each, plus Claude's dollar estimates.
  - The tooltip splits it out ("33.16 AIU (Copilot credits, USD 0.01 each) + $0.02 Claude estimate"), says it is an estimate and when counting began, and says which harnesses report no cost.
  - Cards show "≈ $" with "<$0.01" for small amounts, and AIU in the tooltip. Codex stays "cost not reported".
- **FR-029** **One control-size scale (#311):** `--h-ctl` 32px for buttons and selects, `--h-chip` 26px for chips, `--h-pill` 22px for status pills; the room header's +, ⋯ and MCP buttons at 24px (WCAG 2.5.8). `check:office` must pass at 1280x800.
- **FR-030** **Settings that read easily (#309):**
  - themes as a grid of preview cards, each with a mini room in its own colours and its name, plus "yours" for your own themes;
  - every section leads with one sentence, details behind *More*;
  - MCP sits under an **Advanced** heading;
  - paragraphs at most 72ch wide.
- **FR-031** **Simple and Expert (#306).** Settings > *Detail level*: **Expert** (today's app, the default) or **Simple**.
  - Simple hides token counts, the model, agent, context and Compact chips, the room paths, MCP buttons, Open in VS Code and Copy resume command, and shows cost in money only.
  - Card activity reads in plain verbs, "Running a command" or "Searching the web", not "At Terminal: bash".
  - The welcome card offers Simple, and the choice is kept.
  - Permissions, status and answering are identical in both.
- **FR-032** **Theme polish, the rest of #310:**
  - Corporate buttons get a 1997-style bevel;
  - the Indian court's pillars sit behind the cards in a lighter gold;
  - the Japanese court's furniture is warm lacquer (`--desk` #4a3b2c);
  - Retro's floor art is drawn opaque in two colours instead of smeared.

**Evidence (follow-ups):**
- **Built:** #305, #307 and #306 by the lead. #309, #310 and #311 by three implementation sub-agents in their own worktrees (typecheck and unit tests only), merged and checked by the lead.
- `sim:` `scripts/shots-052-ux.js` passes at both sizes:
  - **I** opens the inbox, which lists every agent that needs you; approving from a row removes it; Esc closes the inbox;
  - Simple hides paths, chips and VS Code, keeps the mode and the answers, and shows plain verbs and money; switching back to Expert works;
  - the top-bar group and ⋯.
- **Layout:** `check:office` (2 shards) and `check:geometry` (60/60) pass.
  - The 24px room-header targets (#311) pushed MCP into the plant at 1280. Decision: the plant is drawn only in the full layout, and denser rooms give its space to the controls (the designer's round-1 advice).
- **Bugs found while building:**
  - the answer bar now decides "in view" by geometry, on scroll and on changes;
  - a redraw of the inbox keeps focus inside it, so Esc still closes it.
- **Money wording:** "≈ $0.33"; small amounts read "<$0.01" without "≈".
- `[KNOWN GAP]`:
  - Simple is a display preference of this window (`localStorage`), not a synced setting;
  - money for Copilot credits uses GitHub's USD 0.01 price per credit, so it is an estimate where a plan includes credits.

### 2026-10-20: round 3, five new personas on the build with the follow-ups

**The panel:**
- **Elena**, a retired teacher who uses Simple at 125% zoom;
- **Marco**, a design lead benchmarking against the best desktop tools of 2026;
- **Hiroshi**, a Tokyo developer and calligraphy teacher, on the Japanese court theme;
- **Jordan**, a blind developer using NVDA and VoiceOver, keyboard only (a code review of semantics);
- **Sofia**, a Windows freelancer, keyboard-first and cost-conscious.

All five were AI personas, working from 29 screenshots and the source.

**Most serious finding [Jordan]:** after answering a request in the inbox, focus jumps to the *next* agent's Approve button and its request is not read. Pressing Enter twice approves something unheard. New requests are not announced at all, and NVDA's browse mode swallows the single-letter keys N and I.

**Requirements (round 3):**
- **FR-033** **Inbox focus and keys.**
  - The inbox opens on the first request's heading, never on a button.
  - Every action button is described by its row: the agent's name and the request.
  - After an answer, focus moves to the next row's heading and a live region says "Approved Jonas. 3 left."
  - Tab stays inside the inbox.
  - **Keys inside the inbox:** J/K or ↑/↓ move between rows; A approves; D denies; S approves for the session (scoped); O or Enter on a heading opens the chat. The key hints are shown in a footer line.
- **FR-034** **Announcements.**
  - A polite live region announces each new request ("Kenji needs your OK: …") and each answer.
  - A chat opened on an agent that waits announces its request.
  - After an answer from the answer bar, focus goes to the message box and the outcome is announced.
- **FR-035** **Shortcuts with a modifier:** Ctrl+Shift+I opens the inbox and Ctrl+Shift+N opens the next agent; both work everywhere, also in text fields and in NVDA browse mode. `aria-keyshortcuts` is set. The single keys stay as well.
- **FR-036** **Confirmations focus Cancel** when the confirming button is destructive (`danger` or `warn`).
- **FR-037** **Simple goes further [Elena]:**
  - the chat's tool lines collapse into one line ("Worked with 3 tools ▸");
  - Thinking stays collapsed;
  - approvals use plain words: "Allow this once", "Allow “…” until you end this session", "Don't allow";
  - places and verbs say "Searching files" and "Using the computer";
  - the top bar hides + Workspace, Folders and List.
- **FR-038** **Restore strip wording [Elena]:**
  - **Ask me first (safer)** as the main button, and **Keep as it is**;
  - the text says what the risk is: they can change or delete files in these folders without asking.
- **FR-039** **Which harness [Hiroshi, Sofia]:** when more than one harness is in use, each card's role line ends with the harness name ("Reviewer · Codex").
- **FR-040** **Visual pass [Marco]**, colours, borders and shadows only, Clean Office:
  - a solid primary button;
  - the status counts as one segmented surface;
  - room-header controls borderless until the room is hovered or focused;
  - softer room walls without the tile grid;
  - waiting and error cards with a 3px left edge in their status colour;
  - quiet lobby slots, neutral chat-header chips, row-style menu focus, layered popover shadows;
  - a calmer restore icon;
  - Settings: the theme grid fits one row, and the chosen theme shows a check badge.
- **FR-041** **Japanese court [Hiroshi]:**
  - places Tanmatsu-shitsu (terminal room) and Dōgu-beya (tool room);
  - lobby "The Ō-hiroma";
  - fusuma door words;
  - lacquer monitors and laptop, a persimmon clay tint, a vermilion pot, a bonsai plant;
  - plain short hair instead of a topknot;
  - dark heri on the tatami.

**Evidence (round 3):**
- **Built:** FR-033..FR-039 by the lead; FR-040 (visual pass) and FR-041 (Japanese court) by two implementation sub-agents in their own worktrees, merged and checked by the lead.
- **Shortcut decision:** **Ctrl+Shift+A**, not Ctrl+Shift+I, because Electron's default menu opens DevTools on Ctrl+Shift+I.
- `sim:` `scripts/shots-052-ux.js` passes at both sizes:
  - the inbox opens on a heading; **A** approves the focused row, focus moves to the next heading, and "Approved … N left." is announced;
  - Ctrl+Shift+A opens the inbox from a text field;
  - the strip's new wording and buttons;
  - every earlier check.
- `test:` `test:dialog` covers FR-036: a destructive confirmation starts on Cancel, and a plain primary keeps the focus.
- `check:office` (2 shards) and `check:geometry` (60/60) pass.
- `[KNOWN GAP]`: nothing was tried with NVDA or VoiceOver; the announcements and focus order are checked in the DOM only.

**Not now:**
- a per-folder cost view with periods and CSV export, a per-folder budget, and a Codex price table [Sofia] (#315);
- ~~a command palette (Ctrl+K) [Sofia] (#316)~~: built 2026-10-20, FR-042;
- a bundled variable font [Marco], which needs a licence and size review.

### 2026-10-20: command palette and shortcut sheet (#316)

Moves the command palette out of *Not now*. Built and checked with `npm test`; the simulator driver (`scripts/shots-052-ux.js`) has a section for it, to be run by the lead.

- **FR-042** **Command palette (Ctrl+K / Cmd+K) [Sofia]:**
  - opens from anywhere, also from text fields; a modal (`role="dialog"`, `aria-modal`) near the top of the window, about 560px wide;
  - one input (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) over a `role="listbox"` of options, grouped as Agents, Folders and Actions;
  - **Agents:** every main agent, with its folder, status and harness as secondary text; Enter opens its chat;
  - **Folders:** every shown folder (and *All folders* while one is filtered); Enter filters the office to it, the same path as the folder filter;
  - **Actions:** Needs you, Next agent that needs you, Office view, List view, Tools, Settings, Add folder, Simple view, Expert view, Close all room doors, Open all room doors, Keyboard shortcuts; an action that is unavailable now (a disabled or hidden button) is left out; shortcuts are shown as key caps on the right;
  - typing filters case-insensitively over the label and keywords; label prefix matches first, then word prefixes, then substrings, then keywords;
  - ↑/↓ move the active option, Enter runs it, a click runs it too; Esc closes and returns focus to where it was; Tab stays in the input;
  - the result count is announced politely ("5 results"); every value is escaped.
- **FR-043** **Keyboard shortcut sheet:**
  - `?` outside text fields and dialogs opens a small modal; it also opens from the palette and from *Keyboard shortcuts* in the top bar's ⋯ menu (`#kbdHelpBtn`);
  - it lists Ctrl+K (palette), I or Ctrl+Shift+A (inbox), N or Ctrl+Shift+N (next agent), the arrow keys (move between desks), Esc (back or close), `?`, and inside the inbox J/K, A, D, S and O; a note says Cmd works for Ctrl on a Mac;
  - Esc or Close shuts it and focus goes back; the harness "?" button (`#kindHelp`) is unchanged.
- a per-folder budget and a Codex price table [Sofia] (#315; the cost view and CSV are built, see FR-044 below);
- a command palette (Ctrl+K) [Sofia] (#316);
- a bundled variable font [Marco], which needs a licence and size review.

### 2026-10-20: cost per folder (#315)

[Sofia] wanted to see what each folder (each client or project she bills) costs, and to paste it into a spreadsheet. Renderer only; no main-process or stored-data change.

- **FR-044** **Cost per folder in Tools** [IMPLEMENTED] `test: test-costtable` (unit), not yet run in the simulator or on a real session.
  - **Tools > Cost**, a third tab next to *Tool usage* and *Models & context*. One row per folder with: folder name, **≈ money** (Copilot AI credits × USD 0.01 + Claude Code's dollar estimate), **Copilot AIU**, **Claude $ est.**, **tokens** (in + out), **calls**, and a note **"Codex: tokens only"** when a Codex agent works in that folder.
  - Sorted by money, high to low. Folders with no usage are listed last, in grey. A **Total** row closes the table. When the saved office total holds calls of folders that are no longer in the list, one row **"Folders no longer shown"** carries the difference, so the total stays the office total.
  - **Two periods, exactly the data the app keeps:** **This run** (since the app opened, or the last reset) and **Since <date>** (the saved totals since the last reset in Settings, plus this run). The second shows only when saved totals exist. No per-day data is shown, because the ledger does not keep it.
  - Claude's estimate and the tokens come from the sessions open now, so those two columns say **"this run"** in both periods. AIU and calls come from the ledger and follow the period.
  - A folder whose calls all lacked credits and has no Claude estimate says **"not reported"**, never $0.00.
  - **Copy as CSV** copies the table to the clipboard (`navigator.clipboard.writeText`; no file is written). Columns: `folder, money_usd_estimate, copilot_aiu, claude_usd_estimate, tokens, calls, period`, one line per row, then the total. Every field is quoted with `"` doubled (RFC 4180), lines end in CRLF, and a value starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'` so a spreadsheet does not run it as a formula. A toast says "Copied N folders as CSV".
  - **The room header's cost** is now a borderless button of the same size (padding 0, border 0, transparent, same font). Its tooltip ends with "Click for the cost by folder." and a click opens Tools on the Cost tab.
  - Pure helper `src/renderer/costtable.js` (`window.DurbarCost`: rows, sort, total, CSV); every value in the table is escaped.
- [KNOWN GAP] **A budget per folder** is not built: it needs a stored setting (per folder, kept across restarts) and a decision on what happens when it is reached.
- [KNOWN GAP] **A Codex price table** is not built: Codex reports tokens but no cost, and turning tokens into dollars needs a decision about which prices to use and how to keep them current.
- [KNOWN GAP] Not checked in the simulator or with screenshots in this change (no Electron run); the lead takes the screenshots.

### 2026-10-20: round 4, interaction polish

An interaction-design review asked for clearer feedback when something is pressed, busy, done or failed. Renderer only (`app.js`, `screens.js`, `styles.css`, `screens.css`); no main-process or stored-data change. [IMPLEMENTED] `npm test` passes; not yet run in the simulator or with screenshots (the lead runs them).

- **FR-047** **Pressed, disabled and busy states:**
  - `.btn`, `.stat`, `.chip` and `.more-it` move down 1px with a small inset shadow while pressed (`transform` .06s; background and border .12s). Theme rules in `themes.css` that already style `:active` (Corporate, Retro) are more specific and keep their look.
  - A disabled button (`:disabled` or `aria-disabled="true"`) is at half opacity with a *not-allowed* cursor.
  - `busy(btn,label)` in `app.js`: sets `disabled` and `aria-busy="true"`, keeps the button's width (`min-width` = its width), swaps the label for the given text and, after 150ms, a 12px CSS spinner (no spinner under reduced motion; the label alone). It returns `done()`, which restores the button. Used by **Stop** ("Stopping…"), **End session** ("Ending…") and **Open in VS Code** ("Opening…") in the chat header, *Continue in VS Code*, the inbox row buttons ("Sending…") and **Resume** in Previous sessions (which had its own hand-made version). A failed Stop or End now shows a toast instead of failing silently.
- **FR-048** **Visible answers in the inbox, and focus return:**
  - after Approve, Deny or Allow for the session, the row's other buttons are disabled; then, in place of its buttons, the row shows **"✓ Approved"** (green ink) or **"Denied"** (red ink) for 600ms, folds away (opacity and height to 0 over 200ms; no fold under reduced motion), and the list repaints as before. Focus stays on the row's heading while it settles. The screen-reader announcement is unchanged.
  - the empty inbox reads **"All clear. Nobody needs you right now."** with a small CSS-drawn check badge, and the line about what appears there below it.
  - closing the inbox gives focus back to the element that had it when the inbox opened, if it is still in the page and shown; otherwise to the inbox button.
- **FR-049** **Dialogs, install plans and copy buttons:**
  - every `.dlg` eases in (opacity, 6px rise and a slight scale over 160ms, `cubic-bezier(.2,.8,.2,1)`); the overlay fades in over 120ms. The global reduced-motion rule turns both off.
  - in the install dialog, each plan is a card with its radio beside the command (`.dlg label` stacked them); the chosen card has the focus colour as its border and a light blue fill.
  - copy buttons (`.cp-btn`, `.md .copy`) rest at 70% opacity (was 55%) and say **"Copied ✓"** for 1200ms after a copy.
  - the Thinking box (`.think-body.md`) has 26px at the bottom and its copy button sits inside it, so the button is no longer cut off.
- **FR-050** **Typed toasts and an empty Cost view:**
  - `.toast.ok` (green left edge) for success and `.toast.err` (red left edge) for failure, used for: stopped, session ended, opening VS Code (or not), folder or session removed (or not), switched to Ask first (or not), copied (resume command, CSV) and copy failures, could not resume, could not stop or end.
  - **Tools > Cost** with no usage at all says "No costs yet. Numbers appear after an agent's first reply." instead of a table of dashes, and *Copy as CSV* is disabled.
- [KNOWN GAP] Not checked in the simulator or on screenshots in this change; the lead runs them. The fold of an inbox row is checked only by reading the code.
### 2026-10-20: round 4, first run and demo

Reviewers found the first run still assumed a developer (hints that say "run … in a terminal", no word on which plan each harness needs) and that the demo showed things a safety-minded viewer would not trust. Built and checked with `npm test`; not run in Electron or the simulator in this change (the lead takes the screenshots).

- **FR-045** **First run in plain words** [IMPLEMENTED] `test: test-detect` (hint constants), not yet run in the simulator.
  - **Settings > Harnesses:** each card has a line under its title saying which subscription it uses: Codex "Uses your ChatGPT plan (Plus, Pro or Team)", Claude Code "Uses your Claude plan (Pro or Max) or an Anthropic API key", Copilot "Uses your GitHub account; a free plan works".
  - **Welcome card:** one line, "Which one? Have ChatGPT: Codex. Have Claude: Claude Code. Neither: GitHub Copilot (free)."
  - **Hints point to the app, not a terminal:** the Claude and Codex sign-in hints and the install hints (`src/adapters/detect.ts`, `claude.ts`; Codex reuses the detect hint) say "Open Settings > Harnesses and choose Sign in…" (or "Install…"), with the command in brackets for developers, e.g. "(or run `codex login`)".
  - **Install, then sign in:** after an install or update that worked, the app checks that harness again (`listAdapters(true)`, and for Copilot its sign-in state) and opens the sign-in dialog straight away when it is not signed in. The toast after an install says "… is installed." (no longer "is ready").
  - **Sign-in dialog:** names the account (Codex "your ChatGPT account", Claude "your Claude account", Copilot "your GitHub account"), adds step 3 "Come back here. This window closes by itself when you are signed in.", and drops the elapsed seconds (installs keep them).
  - **Install dialog:** each choice leads with a label from its package manager, "Using Homebrew (recommended)" for the first of several, "Using npm", "Using winget (Windows Package Manager)", with the exact command still shown below it.
  - Codex sign-in state: `detectCodex` already returns `not-signed-in` when `codex login status` says "Not logged in" (spec 012 FR-137, `test-detect`); no change.
- **FR-046** **Demo and correctness** [IMPLEMENTED] `test: npm test` (typecheck of the simulator), not yet run in the simulator.
  - **Restore strip in every theme:** the strip's main button (*Ask me first (safer)*) keeps its amber background and white text in every theme. Before, the themes' rule giving every `.btn` a surface background (`themes.css`) outranked the strip's rule and left white text on a light button (seen in Japanese court).
  - **Each waiting agent asks for its own thing:** Jonas (reviewer) "Edit src/tools/companies.ts (rename find_company to search_companies)", Kenji (evaluator) "Run python evals/baseline.py --compare" (a shell request), Lena (accessibility) "Edit src/styles/focus.css (focus ring colour)". Before, every waiting agent showed the rename.
  - **No permission card in Allow all:** a simulated agent that waits for a permission starts in **Ask first**, the only mode where a card appears. Jonas changes from Allow all (restored) to Ask first, Lena from Read-only to Ask first. The restore strip still names a restored Allow-all folder: Tomas's (swisscontract-ai). The driver `scripts/shots-018.js` now opens Maya (Copilot, Allow all) for its new-session check instead of Jonas.
  - The simulator stays deterministic (no new random draws).
### 2026-10-20: round 4, one word per concept

A UX writer found several words for the same thing (harness, agent kind; Approve, Allow this once; Workspace, room; cap, limit, money). The product lead approved one term per concept. Text only: no identifier, IPC channel, CSS class, id or layout size changes.

- **FR-051** **Terminology** [IMPLEMENTED] `test: test-mood` (mood phrases), `npm test`; the Electron drivers were updated by reading the code and not run in this change.

  | Concept | Term in the UI |
  |---|---|
  | Copilot, Claude Code, Codex | **agent app** (was harness, agent kind): Settings > **Agent apps**, "Set up an agent app once", "Set up agent apps…", the **Agent app** picker, "About agent apps", the toast "<Name> isn't ready yet. Set it up in Settings > Agent apps." |
  | Copilot custom agents | **profile**: the chip "Profile: Default", the **Profile** select |
  | Answering a permission | **Allow once**, **Allow “<scope>” for this session**, **Deny**, the same in Simple and Expert; card label "Needs your OK:"; inbox "✓ Allowed" / "Denied"; keys line "J/K or ↑/↓ to move · A allow once · S allow for this session · D deny · O open chat · Esc close" (keys unchanged) |
  | A folder in the office | **folder**: list column, aria-label "Folder X"; "room" stays for the picture |
  | Money | **spending limit** (No limit, Remove limit, Raise limit, "Spending limit reached:", "Spending limit (AI credits). Leave empty for none.", "Default limit (AI credits)"); **cost** (Cost tab "Est. cost", note "Estimated cost: Copilot AI credits at $0.01 each, plus Claude Code's own estimate. Not a bill."); **AI credits** (AIU stays as a short unit in Expert numbers) |
  | Stop / End / Remove | Stop ("Stops this reply"); "End session" / "Send a message to pick up where you left off"; "Remove from office…" / "Ends the session; its history stays in Previous sessions" |
  | Demo | the badge "Demo" (simulator) or "Demo: sample data"; composer hint "Enter to send, Shift+Enter for a new line. Drop or paste images to attach. Demo, no AI credits used · Allow all" |
  | Restore strip | "Still on Allow all from last time: X. Agents there can edit or delete files and run commands without asking." with **Switch to Ask first** / **Keep Allow all** |
  | Mood | "Context almost full (95%)", "Error: needs a look", "Spending limit reached", "Waiting 3 min for you", "3 tool calls failed in a row" |
  | Detail level | "Simple / Expert" (the welcome text and palette drop "view") |
  | Sign-in | "You sign in on <App>'s own page. Durbar never sees or stores your password."; a simulated card says "Simulated version." |

  - The AI theme dialog blurb is two sentences (one request, no tools, nothing kept, small cost on your own plan; safe values and readable text, try before saving).
  - Main-process and adapter messages follow (router, `detect.ts` hints, `main.ts`/`agentops.ts` errors, the "Allowed" status intent).
  - **"+ Workspace" stays** (title "Add a VS Code workspace (.code-workspace file)"): with **folder** used everywhere else, "workspace" now names only the VS Code `.code-workspace` file, which is what this button adds. (A first pass renamed it "+ VS Code"; the product lead kept "+ Workspace" as clearer.)
  - `docs/feature-history.md` keeps the old words: it is a record, unchanged by design. The README keeps "harness" where it explains the concept; its section heading "Harnesses" stays because the website (`scripts/build-site.js`) reads it by name.
  - [KNOWN GAP] No simulator run or screenshots in this change; the screenshots in `docs/screenshots/` still show the old words until the lead retakes them.
### 2026-10-20: round 5, visual and accessibility

A senior visual designer and a low-vision developer reviewed every theme. Colours, borders, art, words and radii only: no desk card, room, room header, top bar, lobby or place changes size, and themes still change no size, padding or font metric (check:geometry, the 15-agent office check). Status colours are unchanged. Built and checked with `npm run typecheck`, `npm run build` and `npm test`; not run in Electron or the simulator in this change (the lead takes the screenshots and runs the checks).

- **FR-052** **Accessibility in every theme** [IMPLEMENTED] `test: test-themegen` (muted ratio), CSS read only; not yet run in the simulator, Windows High Contrast or with `prefers-contrast: more`.
  - **Windows High Contrast** (`forced-colors: active`): pills, counters, chips, buttons and the room `+` get a `CanvasText` border; pressed and current items and the selected theme card a `Highlight` outline; the inbox shows `Highlight` while focused; status dots keep their colours and shapes (`forced-color-adjust: none`); disabled buttons use `GrayText`.
  - **Two-tone focus ring:** `:focus-visible` is a 3px `--focus` outline (offset 1px) plus a 5px `--focus-halo` shadow (transparent by default). Retro Pixel uses a dark ring `#111122` with a yellow halo `#ffec27`, so it shows on cream and on navy. A component's own `box-shadow` rule still wins.
  - **Dialogs fit the window:** `.dlg` has `max-height: calc(100vh - 32px)` and scrolls; the wide, import and palette dialogs keep their own rules.
  - **Control borders at 3:1:** a new token `--line-ctl` (Clean `#8a8272`, about 3.6:1 on its surfaces; each built-in theme its own, Retro `#111122`) on inputs, selects, text areas and the room `+` / schedule buttons (Clean: when shown on hover or focus).
  - **Selected is not colour only:** the selected list row has a 3px inset `--focus` bar; the selected theme card a 2px `--focus` outline next to its check mark.
  - **Disabled and "off" stay readable:** disabled buttons, disabled mode-menu items, an off schedule and a disabled switch are no longer faded (`opacity` 1); they use `--muted` text and a dashed border. A disabled primary button drops its fill.
  - **More contrast on request** (`prefers-contrast: more`): `--line` becomes `--line-ctl`, `--line-2` darker, `--muted` equals `--ink-2`; light themes only (`theme.js` marks a theme with a dark `--surface` with `data-dark`).
  - **Status dots:** waiting has a 1px `--amber-ink` edge, idle a 1px `--pc-idle` edge (box-shadow; size unchanged).
  - **Clamped card text:** the desk card's task line (full layout) and intent line (denser layouts) carry a `title` with the full, escaped text.
  - **Generated themes:** `--muted` on `--surface` must reach 4.5:1 (was 3:1), in the check and in the prompt.
- **FR-053** **A calmer toolbar and surfaces** [IMPLEMENTED] CSS read only; not yet run in the simulator.
  - **Primary buttons are solid in every theme:** the base `.btn.primary` is `--sage-ink` with white text. Themed styles use their own accent: `--brand-bg` with `--brand-mark` text (Corporate 6.4:1, Retro 15:1, Indian 5.7:1, European 8:1, Japanese 5.2:1). Before, the themes' surface background left primary buttons pale.
  - **Tools and Settings** are ghost buttons (transparent group, hover tint); same size.
  - **Waiting desk cards** (Clean) drop the amber edge; the inset bar and the tint stay, and the border keeps its width at the normal `--line` colour.
  - **Settings text:** paragraphs and notes at 68ch with line height 1.5; section headings 15px, weight 650.
  - **Restore strip:** a calmer band (`--pb-waiting` mixed 55% into `--surface`) with a 1px bottom border; height unchanged, its amber main button unchanged.
  - **Theme picker:** the name sits on one line with an ellipsis; "Durbar · X" shows "Durbar" as an 11px muted overline and "X" as the name (full name in a tooltip).
  - **Radius tokens** `--r-sm 6px`, `--r-md 10px`, `--r-lg 14px`, `--r-xl 18px` on buttons, dialog controls, the inbox, Settings sections and dialogs (16px → 18px). Rooms and desks keep their radii.
  - **Clean Office polish after switching back:** Clean Office now leaves `data-ui` unset, as at startup, so its `html:not([data-ui])` polish returns after another theme was tried (before, it was lost until a restart).
- **FR-054** **Tasteful nostalgia in the themes** [IMPLEMENTED] CSS read only; not yet seen in the simulator, so the 2-4% strength is by value, not by eye.
  - A period texture on each themed room, gradients and inline SVG only: Corporate a very faint 24px grid, Retro a 2px dither, Indian a faint block-print flower, European laid-paper lines, Japanese washi fibres. It replaces the faint tile pattern of denser rooms in those themes; text keeps its own surface.
  - Room-name accents: European a double gilt rule under the name plate (box-shadow, no border width change; denser layouts, where the plate exists); Retro a 1px black drop shadow.
- **FR-055** **Two bug fixes** [IMPLEMENTED] CSS and code read only; not yet run in Electron.
  - **Settings > Agent apps from the welcome card** (and Settings > MCP): the heading is scrolled into view inside `.scr-body` only. `scrollIntoView` also scrolled the outer page (body `overflow: hidden` still scrolls), which hid the top bar and left a blank strip at the bottom.
  - **Sign-in dialog:** the output box (`.hs-log`) is hidden while empty. [KNOWN GAP] Some screen readers may not announce the first line, as the live region appears with it.
- [KNOWN GAP] Nothing was skipped for size reasons. The waiting card change and the primary buttons are Clean-first; a generated theme with a themed style is still only checked at 3:1 for `--brand-mark` on `--brand-bg` (raising it would flag Clean Office's own pair, 3.8:1, in every generated theme). `--line-ctl` falls back to Clean's `#8a8272` in generated themes (about 4.6:1 on a dark surface).

### 2026-10-20: round 5, plain words for newcomers

A 61-year-old shop owner with ChatGPT Plus, not technical, tried the first run and a session. He did not know what an "agent app" set-up meant for his ChatGPT account, read the install commands as something he had to type, and did not understand "30 AIU", "429", "write in src/tools/" or "Allow all". The round-4 terms stay (agent app, Allow once / Allow “…” for this session / Deny, spending limit, cost, folder, Demo). Text only: no office size changes, no IPC change.

- **FR-056** **First run names the AI account** [IMPLEMENTED] `npm test`; drivers updated by reading the code, not run.
  - The welcome card says "**Connect your AI account once**: ChatGPT (through Codex), Claude (through Claude Code) or GitHub Copilot (a free plan works)." and its button is "Connect an AI account…"; the "Which one?" line stays. No user-visible "harness" is left in `src/renderer` (code identifiers and CSS classes keep it).
  - Each agent app card has a small muted subtitle next to its title: "· for ChatGPT" (Codex), "· for Claude" (Claude Code), "· for GitHub" (Copilot). Same card height; the Update button stays "Update…".
  - The install dialog shows one sentence per way, "Durbar installs <App> for you with Homebrew (recommended)", with the radio choice. The exact commands sit in "Show the exact command" (`<details>`), closed in Simple and open in Expert (`harnesses.js` reads `body.simple`). The main process still shows the exact program and arguments in its native confirmation before anything runs (spec 051 FR-004b), so hiding them in the page hides nothing that would run unseen.
- **FR-057** **Simple-mode wording** [IMPLEMENTED] `npm test`; regexes checked by hand in node; drivers updated by reading the code, not run.
  - In Simple, an agent stopped at its limit reads "Paused: reached the spending limit you set (about $0.30)" (AIU × `AIU_USD`; a dollar limit shows its own amount), and an error whose text has "429" or "rate limit" reads "The AI service is busy. Try again in a minute." On cards, helpers, the list, the chat header, the agent strip and the inbox (`taskText`). Expert keeps the exact text.
  - In Simple, a folder grant ("write in tools/") reads "Let <Name> change files in “tools” until the session ends" (last path segment). Other scopes keep "Allow “…” for this session". The answer bar and the inbox copy the card's button; switching the detail level relabels open cards.
  - In Simple, the inbox's "Keys: J/K…" line is `hidden` (still the dialog's description and in the `?` sheet).
  - The chat's More menu: Copy resume command, MCP servers and Tools and usage (models and context window) were already hidden in Simple by CSS; the arrow keys now skip hidden items too, so focus never lands on one.
  - The restore strip, in Simple and Expert: "One folder (<name>) lets agents change files without asking." / "<n> folders (<names>) let agents change files without asking.", with **Make it ask me first** (primary) / **Keep as it is**. "Ask first" stays the mode name in menus. Replaces the round-4 row "Still on Allow all from last time" in the FR-051 table.
- **FR-058** **The spending limit is not a bill** [IMPLEMENTED] read: the dialog. The spending-limit dialog adds one small muted line: "Copilot, Claude and ChatGPT plans have a fixed monthly price; this limit only stops the agent. Durbar never charges you."
- [KNOWN GAP] No simulator run or screenshots in this change; `scripts/shots-052-ux.js` and `scripts/shots-051-setup.js` were updated by reading the code.

### 2026-10-20: round 5, signals for heavy use

People who run many agents all day leave Durbar in the background and lose minutes before they see that an agent waits. This round brings "needs you" outside the window, answers from the keyboard in the chat, and an inbox in arrival order. Built and checked with `npm run typecheck`, `npm run build` and `npm test`; not run in Electron or the simulator in this change (the lead takes the screenshots).

- **FR-059** **"Needs you" outside the window** [IMPLEMENTED] `test: test-attention` (title text, 80-character body, coalescing, throttle, startup, badge count check, the setting), `test: test-wincmd` (allow list); not run in Electron.
  - **Window title:** "(3) Agent Durbar" while anything needs you, "Agent Durbar" otherwise (`document.title`, set where the inbox count is computed).
  - **OS notification:** when a new item joins the Needs you list (a permission request, a question, a spending limit or an error) and the window is not focused, one notification through the web `Notification` API. Title "<Name> needs you", or "<n> agents need you" when several arrive within 2 seconds; body the request's summary line (permission summary or question text) cut to 80 characters, or "Hit an error and needs a look." / "Reached its spending limit." (never an error message, file contents or a diff). At most one every 10 seconds; items that came during the pause are merged into the next one. A new request from an agent that already waited counts as new. A click brings the window to the front (`window.focus()` and `app:focusWindow`: restore, `show()`, `focus()` in main) and opens the inbox on that agent's row. Nothing for what already needed you in the first 3 seconds after the agent list loads, nothing while the window has focus, and nothing in the demo (sample data).
  - **Setting:** Settings > **Notifications**, "Notify me when an agent needs me (when Durbar is in the background)". On by default for real sessions; stored in `durbar-settings.json` only when off (`notifyNeedsMe: false`, validated in main: only a boolean changes it). The simulator starts with it off; turning it on there works for that run.
  - **Badge:** `app:setBadge(count)` (an integer from 0 to 999, refused otherwise): `app.setBadgeCount(n)` on macOS and Linux (where the desktop supports it; failures ignored), and on Windows `win.flashFrame(true)` when the count grows while the window is not focused, stopped on focus or when the count is 0. The demo sends 0. In the bridge (`setBadge`, `focusWindow`, `setNotifyNeedsMe` in `DurbarApi`); the simulator's are no-ops.
  - **Deliberate security change:** `notifications` joins `clipboard-sanitized-write` in `ALLOWED_PERMISSIONS` (`src/main/hardening.ts`, amends spec 045 FR-005). Notifications show only the agent's name and a short summary.
  - [KNOWN GAP] The badge, the taskbar flash, the notification and its click were not seen on any OS; the Linux badge depends on the desktop (Unity launcher API).
- **FR-060** **Answering from the keyboard in the chat** [IMPLEMENTED] read: the code; not run in Electron.
  - In an open chat with a waiting permission request, and when focus is not in a text field that has text: **Alt+A** allow once, **Alt+S** allow for this session, **Alt+D** deny, the oldest waiting request (the one the answer bar shows). They press the card's own buttons through the bar's click path, also when the bar is hidden because the card is in view. **Alt+N** opens the next agent that needs you. Keys by position (`e.code`), so Option+letter works on a Mac.
  - A question or a spending limit is answered in its card, and a request longer than 480 characters is read in the chat first: there the keys scroll to the card and say so. The wide grant ("any arguments") has no key.
  - The bar's buttons carry the key in their `title` and `aria-keyshortcuts`; the keyboard shortcuts sheet has a section "In a chat that waits for you".
  - No clash: the app sets no menu of its own and Electron's default menu uses Alt+F, E, V, W and H; the other shortcuts use Ctrl/Cmd or plain letters. [KNOWN GAP] Alt+letter on Windows (menu bar) and Option+N on macOS (a dead key) not tried.
- **FR-061** **Inbox in arrival order, with wait times** [IMPLEMENTED] `test: test-attention` (sort, labels); not run in Electron.
  - The inbox lists the oldest first, by when each agent started needing you: a pending permission's arrival time from the mood tracker (`waitingMs`), otherwise when the page first saw it need you. A tie keeps office order. **N**, Ctrl+Shift+N and Alt+N follow the same order. The answer bar's "1 of N" already counts one chat's cards in arrival order (unchanged).
  - Each row shows "· waiting 4 min" after the folder name (muted, 11.5px; "under 1 min", "1 h 15 min"). The labels update every 30 seconds while the inbox is open (text only: focus and rows stay); no faster timer.
  - J/K/A/S/D/O keys unchanged. `scripts/shots-052-ux.js` finds rows by name (`.ib-h b`), not by position, so it stays valid without changes.

### 2026-10-20: round 6, truth and density

Two reviewers looked at the round-5 build: a skeptical principal engineer who lives in tmux ("a status that says Working while every command fails is lying; show me the whole command and the diff before I allow it") and an engineering manager ("I want to scan 15 agents as rows, sorted by cost or by who went quiet, and I want to know what this tool does *not* protect me from"). This round makes the status honest, the tool calls and edit requests readable, the list dense and sortable, Allow all visible on every card, and the limits written down. Built and checked with `npm run typecheck`, `npm run build` and `npm test`; not run in Electron or the simulator in this change (the lead runs the drivers and takes the screenshots). No size change to desk cards, rooms, room headers, the top bar or the lobby; status colours unchanged.

- **FR-062** **Status that tells the truth** [IMPLEMENTED] `test: test-activity` (labels); read: the code; `sim:` `scripts/shots-052-ux.js` (Sven, not run in this change).
  - A main agent that is Working or Thinking while its last 3 or more tool calls failed in a row (the mood tracker's streak, `MOODS.DIZZY_STREAK`; the same streak that draws the dizzy stars) shows **Failing** instead of Working on its card's pill and short status word, in the list and in the chat header. The pill uses the waiting colours (`.st-failing` reuses `--pb-waiting`, `--amber-ink`, `--c-waiting`): no new status colour. The card keeps its `is-working` look, its place in the status filters and its size ("Failing" is shorter than "Working"). The pill's tooltip says "3 tool calls failed in a row"; its ⚠ is kept for the other warning (context almost full). It shows in every mood setting, Serious included: it is information.
  - **Last activity:** each agent keeps the time its last event arrived (`a.lastEventAt`, set in `onLiveEvent`; a helper's event counts for its main agent). Desk cards add "Last activity 2 min ago" to their tooltip, the list has an **Active** column ("just now", "2m", "3h", "2d") and the chat header shows "active 2m ago" next to the status. Before the first event nothing is shown. The labels repaint through the normal render: a 30 s tick schedules one render only when a label changed; no faster timer. Labels: `DurbarActivity.agoLong` / `agoShort` (`src/renderer/activity.js`).
- **FR-063** **Readable tool calls and edit requests** [IMPLEMENTED] `test: test-activity` (diff builder, diff lines, the broker passes the diff), `test: test-claude-adapter` (Edit, MultiEdit, Write); read: the code.
  - An open tool-call chip shows the **whole** command or argument (as written, line breaks kept, up to 20000 characters) in monospace, wrapped, with **Copy**; the closed chip keeps its one-line summary. A click inside the open part (Copy, Show all, selecting text) does not fold it.
  - Output: up to **20000 characters** (was 2000) in a scrollable block (max 320px tall), and **Show all (N characters)** for the rest (kept in memory up to 1,000,000 characters). The chip says "Done · took 1.2 s" or "Failed · took …", the time between the call's start and end events. No normalized event carries an exit code, so none is shown. A tool `update` event with output now keeps the chip running instead of marking it done.
  - **Diffs:** `PermissionInfo` gets an optional `diff?: string` (unified-diff text, at most 20000 characters, display only; `src/adapters/types.ts`), passed by the permission broker on the **pending** request only. A pending permission card with a diff shows a collapsed **Show the change (+n −m)** block: `+` lines green, `-` lines red, hunk and file lines muted, monospace, max 320px tall, at most 400 lines and then "… N more lines not shown"; the Needs you inbox row shows the same block, collapsed. Text only (`textContent`), never applied or run. The diff is not part of the request's summary text, so it never reaches a notification, an announcement or the "long request" rule.
  - **Who fills it:** the **Claude Code** adapter, from the tool input of `Edit` (`old_string` → `new_string`), `MultiEdit` (each edit) and `Write` (every line added; Durbar does not read the file to compare), through `editDiffOf` and `simpleDiff` (`src/shared/diff.ts`: common lines at the start and end kept as up to 3 lines of context, the rest shown as removed then added; not a full diff algorithm). The **simulator** fills it for Jonas's edit request. **Copilot and Codex do not fill it** [KNOWN GAP]: their permission requests carry no edit text in Durbar's normalized events today (Codex's `fileChange` approval could, not done).
- **FR-064** **A denser, sortable list** [IMPLEMENTED] `test: test-activity` (sort); read: the code; `sim:` `scripts/shots-052-ux.js` (rows, columns, sort, J/K; not run in this change).
  - Rows are **34px** (were 44px), the header too. Columns: Agent (with the Allow all badge, FR-065), **Agent app** (Copilot / Claude Code / Codex, empty in the demo), Role, Folder, Current task (mood words first, spec 034), **Active** (last activity), **Cost** (the card's money words: ≈ $ from AIU, Claude's `$… est.`, or tokens for an agent app with no price), Status (the pill, Failing included).
  - Clicking a column header sorts by it: ascending, then descending; the header carries `aria-sort` and an arrow, and keeps focus after the repaint. The sort lives in memory only (not saved). Missing values sort last both ways; a helper stays under its main agent. Unsorted, the list keeps its old order (waiting and errors first).
  - **J / K** (and ↓ / ↑) move between rows when a row or a header has focus; **Enter** opens the chat (the row is a button). No clash: the inbox's J/K is handled inside its dialog. The keyboard shortcut sheet has a section "In the list view".
  - In Simple, the Folder column is hidden with `visibility` so the other cells stay under their headers (before, `display:none` moved them). The list scrolls inside `#list`; 15 agents fit at 1440x900 (34px rows). No narrow-width reflow existed for the list; none added.
- **FR-065** **Allow all on every card** [IMPLEMENTED] read: the code; `sim:` `scripts/shots-052-ux.js` (badge count and bounds; not run in this change).
  - A main agent in Allow all shows a small red **Allow all** text badge (10.5px, the error pill's background and red ink, 15px tall) in its **list row**; Read-only and Ask first keep their icons. **Desk cards keep the red Allow all icon**: the office check showed the text badge hid names at 1280x800 and in the court themes ("Tomas" down to 15px of the 37px FR-025 needs), so on cards the word stays in the icon's tooltip, the room header and the chat header. The card's size does not change. The chat header's mode chip says Allow all in the same red (was amber, which is the waiting colour). The restore strip is unchanged.
  - `sim:` office and geometry checks pass with the icon on cards (they failed with the text badge on cards).
- **FR-066** **What Durbar does not do** [IMPLEMENTED] read: the code and the README.
  - Settings, after Detail level, has a section **What Durbar does not do**, and the README the same list under *Safety model*:
    - "It does not sandbox Claude Code or Copilot; only Codex has OS-level enforcement (in Read-only and Ask first)." (the README: Codex's OS profile is for Read-only and Ask first only, so the claim says so);
    - "It does not stop a reply halfway: spending limits are checked between replies." (README *Costs and caps*: soft limits);
    - "It does not see your bill; costs are estimates.";
    - "It sends nothing to any server of its own." (README: no accounts, no servers, no telemetry);
    - "Floors that are off and hidden folders keep running and spending." (the README and spec 033 say "floors that are off", not "hidden floors"; hidden folders do the same, spec 006).
### 2026-10-20: round 6, motion with meaning

Motion only where it tells you something changed: a status, an answer, a theme. Every animation moves only `transform` and `opacity` (one small checkmark uses `stroke-dashoffset`), nothing changes size, the global `prefers-reduced-motion` rule stops all of it (the Web Animations in `app.js` check `reducedMotion()` themselves), and Serious mode stops every looping animation. Built and checked with `npm run typecheck`, `npm run build` and `npm test`; not run in Electron.

- **FR-067** **State changes you can see** [IMPLEMENTED] read: the code; not run in Electron.
  - A desk scene that changes (new `data-sig`) cross-fades: `morphNode` puts the old SVG in an absolutely positioned layer of the same size on top (`.scene-out`, the parent's last child, which `morphChildren` leaves alone), fades it out in 180ms ease-out and removes it. The desk keeps its size. None on a first render (`innerHTML`) or under reduced motion.
  - Working → Done: the monitor's done tick (`.done-tick`, office kit in `app.js` and every other kit in `scenekits.js`) draws in over 320ms (`stroke-dasharray`/`stroke-dashoffset`, `cubic-bezier(.2,.8,.2,1)`), only when the scene has just turned done. The green status pill (desk and chat header) gives one pulse, `scale(1→1.06→1)` over 400ms.
  - The waiting badge pings 3 times, then rests; it pings again when the agent next starts waiting (the badge's class changes).
- **FR-068** **Answering feels like it landed** [IMPLEMENTED] read: the code; not run in Electron.
  - Inbox: after the 600ms "✓ Allowed" settle, the answered row fades and shrinks in place (`opacity` 1→0, `scale(.98)`, 180ms), then the list repaints and the rows that moved slide up (FLIP: measured by agent before and after, `translateY` to 0 in 200ms). No height or padding animation any more. Focus is unchanged (the next request's heading).
  - The "Needs you" count rolls: the old number moves out and the new one in (`translateY` ±100% and opacity, 220ms ease-out; up when it grows, down when it shrinks) inside a box with `overflow:hidden`, `tabular-nums` and `min-width:1ch`, so its width does not change between digits.
  - All clear: the `.ib-ok` badge pops in (`scale .6→1`, 260ms, `cubic-bezier(.3,1.4,.5,1)`) and its tick follows 160ms later (opacity and scale: the tick is a CSS border, not a path).
- **FR-069** **Calmer alarms** [IMPLEMENTED] read: the code; not run in Electron.
  - The ambulance light and the room siren no longer strobe red and blue every second: the red light breathes (`opacity` 1↔.45, 1.6s ease-in-out) 6 times, about 10 s, then stays on. The keyframe names `ambblink` and `sirenblink` stay, so `scripts/shots-034.js` is unchanged.
  - Serious mode sets `data-serious` on `<html>` and stops every looping animation: idle steam, the working nod and typing hands, screen bars, halos and glows, the waving hand (CSS, and the SMIL wave is not drawn: full scenes get a `still|` mark in their signature so they redraw), the thinking bubble and dots, carets, the walking bob and the mood signs. One-shot signals stay. [KNOWN GAP] The busy spinner keeps turning: it is a progress sign, not decoration.
- **FR-070** **Theme switch and first run** [IMPLEMENTED] read: the code; not run in Electron.
  - Choosing or previewing a theme cross-fades the window with `document.startViewTransition` (root cross-fade, 240ms). Not at boot, not under reduced motion, not without the API. Chromium runs the update callback on the next frame, not inside the call, so `applyTheme` awaits `updateCallbackDone` before it saves; drivers that call `THEME.setTheme()` themselves are not affected.
  - An empty office (`.empty`) shows a small empty desk drawing in `currentColor` above its sentence. On first run (the welcome card; the "No agents yet" sentence sits behind it and is not reached in practice) "+ Folder" in the top bar rings once: a pseudo-element with opacity and scale, 600ms after the card shows and only if it is still there.
- [KNOWN GAP] No simulator run, screenshots or office checks in this change; `scripts/shots-052-ux.js` (inbox row count) and `scripts/shots-034.js` (animation names under reduced motion) were read and still match.
### 2026-10-20: round 6, activity log and Windows first run

A team lead asked who allowed what, and when; Windows reviewers found that a CLI installed with winget was not found, that the Copilot CLI's sign-in looked like a repeat of VS Code's, and that the first download and install on Windows were not explained. This round adds a local activity log and fixes the Windows first run. Built and checked with `npm run typecheck`, `npm run build` and `npm test` (new `test: test-activity`; `test-detect`, `test-permissions` and `test-harnesssetup` extended). Not run in Electron, and not on Windows.

- **FR-071** **Activity log, a local audit trail** [IMPLEMENTED] `test: test-activity` (5000-row cap, newest kept; redaction and the 160-character action; CSV escaping and the formula guard; only the listed fields stored; decisions from permission answers; mode and limit rows from `setModeOp`/`setCapOp`; the table escapes every value), `test: test-permissions` (the Allow all event); `sim:` canned rows and rows for answers in the simulator.
  - **Store:** `src/main/activitystore.ts` writes `activity.json` in userData (atomic tmp + rename, debounced, flushed on quit; a corrupt or oversized file is an empty log) and keeps at most 5000 rows, newest kept. Row: `{ t, agent, folder, app, mode, action, decision }` with `agent` the room's display name, `folder` the base name only (never a path), `app` the adapter's display name, `mode` the permission mode, `action` the request's summary through `redact()` and cut to 160 characters, `decision` one of `allowed-once`, `allowed-session`, `denied`, `auto-allow-all`, `auto-session-grant`, `mode-change`, `limit-change`. Unknown keys are dropped (`src/shared/activity.ts`); prompts, replies, file contents and tool output are never stored.
  - **Recorded in main**, never by the window: the final `permission` event (`via: 'user'` → allowed once, allowed for the session or denied; `via: 'session'` → automatic, session permission; `via: 'policy'` → automatic, Allow all); applied mode changes (`setModeOp`: "Read-only to Ask first", plus "session permissions cleared" / "waiting requests approved") and limit changes (`setCapOp`: "Spending limit set to 120 AI credits", "$5.00" or "removed"). Not logged: pending requests, plain reads, requests closed because the session stopped, and Read-only denials (no one decided).
  - **Allow all event:** the permission broker now emits `auto` for a non-read request it approves in Allow all, and each adapter forwards it as a `permission` event with `via: 'policy'` (new value of `PermissionInfo.via`, adapter interface amended). The window shows no card for it (it returns early in `onLiveEvent`).
  - **IPC:** `activity:list({ limit })` (newest first), `activity:export('csv' | 'json')` through `dialog.showSaveDialog` (CSV: quotes doubled, a value starting with `= + - @`, tab or CR gets a leading `'`), `activity:clear()`; all answer the app's own page only (`fromApp`). In the preload, `DurbarApi` (`activityList`, `activityExport`, `activityClear`) and the simulator bridge.
  - **Window:** Tools gets an **Activity** tab: a table Time, Agent, Folder, App, Mode, Action, Decision, with decisions in plain words ("Allowed once by you", "Allowed for the session", "Denied", "Automatic (Allow all)", "Automatic (session permission)", "Mode changed", "Limit changed"); buttons **Export CSV**, **Export JSON**, **Clear…** (a confirmation first); the note "Kept on this computer. Actions and decisions only; never prompts, replies or file contents."; empty state "Nothing yet. Answers to permission requests appear here." The newest 500 rows are shown; an export holds the whole log.
  - [KNOWN GAP] Claude Code and Codex in Allow all approve inside their own process (`bypassPermissions`, `approvalPolicy: never`), so their automatic approvals are not logged; Copilot's are. Export through the real save dialog not run.
- **FR-072** **Windows: winget-installed CLIs are found** [IMPLEMENTED] `test: test-detect`.
  - Detection also searches `%LOCALAPPDATA%\Microsoft\WinGet\Links` (winget's command shims), built with `path.win32` from an absolute `LOCALAPPDATA` (spec 051 delta of the same date).
  - Re-reading PATH from the registry after an install was not built (the simple, safe choice). Instead, when the re-check after an install that worked still says Not installed, a dialog says "Installed? If Durbar still says Not installed, close and reopen Durbar, then choose Check again."
  - [KNOWN GAP] PATH is not re-read after an install; a CLI that lands in a new PATH folder outside the searched ones needs a restart of Durbar. Not run on Windows.
- **FR-073** **Sign-in and Windows hints** [IMPLEMENTED] `test: test-harnesssetup` (`pwshMissing`); read: the dialog.
  - The Copilot sign-in dialog says "Signed in to Copilot in VS Code? That sign-in is separate: this signs in the Copilot CLI once, with the same GitHub account."
  - On Windows, the Copilot card shows "Copilot runs shell commands with PowerShell 7. Install it with winget: winget install --id Microsoft.PowerShell -e" when `pwsh.exe` is on neither PATH, the usual folders (the same `find` as the setup runner) nor `%ProgramFiles%\PowerShell\7`. Hint text only, nothing is installed. Sent as `pwshMissing` with `harness:copilotAuth`; simulator page address `simnopwsh=1`.
  - read: (a reviewer's memory of GitHub's docs, not checked) the Copilot CLI on Windows needs PowerShell 7 for shell commands.
- **FR-074** **Read-only explains itself** [IMPLEMENTED] read: the code; `sim:` (Read-only agents deny in the simulator).
  - Under a request denied because the agent is in Read-only (a denied permission with no `via`, from a real adapter's `needs-permission` status or the simulator's `permission` event), the chat shows one inline button **Switch this agent to Ask first**. It goes through `changeMode` (the usual mode-change path and its dialogs), and is shown once per agent until its mode changes. Only when the agent can switch modes (`setPermMode`, the `modes` feature).
- **FR-075** **Plan reassurance and Windows install notes** [IMPLEMENTED] `test: test-costtable` (unchanged API plus the two strings); read: the README.
  - One string constant, `DurbarCost.COPILOT_PLAN_NOTE`: "Copilot plans, the free one too, have a fixed price; Durbar shows usage, it does not charge you." Shown in Tools > Cost when a Copilot agent is in the office, and in the spending-limit dialog of a Copilot agent under the round-5 line (now `DurbarCost.PLAN_NOTE`).
  - The spending-limit stop says **Raise limit** for Copilot too (it was "Add credits"): it raises Durbar's limit and buys nothing. No link to GitHub's billing page exists in the app, so none changed.
  - README *Install*, Windows: which file (Setup.exe installs to the Start menu, the portable .exe runs without installing; names from `package.json` `build.nsis`/`build.portable`), Edge's "Keep > Show more > Keep anyway", `Get-FileHash .\<file>.exe -Algorithm SHA256` against `SHA256SUMS.txt`, the PowerShell 7 note, and a "Trying it on Windows?" box that links to the issues page.
  - [KNOWN GAP] Screenshots with the old "Add credits" wording (`docs/screenshots/m9-limit-reached-*`) and the spending-limit dialog without the Copilot line were not retaken (no Electron run in this round).
### 2026-10-20: round 7, consistency and readability

A design-systems lead audited the whole window and found the same thing drawn several ways (four control heights, three Copy buttons, red and amber used for the same kind of action, "…" on confirmations, three words for one status); a reviewer with dyslexia found long italic text, two-line menu items and option labels that start with the same words. This round applies one set of house rules, written down in `docs/design-rules.md`. Built and checked with `npm run typecheck`, `npm run build` and `npm test`; not run in Electron or the simulator in this change (the lead runs the drivers, the office and geometry checks and the screenshots). No size change to desk cards, rooms, room headers, the top bar or the lobby; themes change only colours, borders, art and words.

- **FR-076** **House rules** [IMPLEMENTED] `test: test-mcp-agentstate`, `test: test-mcp-tools` (status words); read: the code; `sim:` drivers updated, not run in this change.
  - **Control heights:** controls are `--h-ctl` (32px) or `.btn.sm` (28px). Question options 30 → 28, the answer bar 30 → 32, the sub-agent Open button 26 → 28, the tool chip's Show all 24 → 28, the sign-in Copy button 32 → 28. The restore strip's buttons are 28 (were 24): the strip's padding goes from 3px to 1px, so it stays 31px tall on one line. The copy buttons on top of content stay 22px, and the code block's Copy (24px) now matches them: one Copy size. Controls inside desk cards and room headers are unchanged.
  - **Chips:** a chip you click or that shows a state is a pill; a code or path chip (the chat header's folder, tool calls, MCP secrets) uses `--r-sm`.
  - **Red ends, amber grants:** confirmations that delete or end use `.btn.primary.danger` (solid red, new): End session, Remove from office, Delete floor, Delete a place, Remove an MCP server, Reset counts, Clear the activity log. The chat's End session item and the card menu's End session are red like Remove. `.primary.warn` (amber) stays only for Allow all, Turn on remote control and Trust and enable. The themes' solid primary rule skips `.danger` as it skips `.warn`. Settings dialogs now also start on Cancel for a red or amber confirmation, as `dialog.js` already did (FR-036).
  - **Dialogs:** every button row already ended with the primary button after Cancel (checked). Text fields: `height: var(--h-ctl)`, `--r-md`, `--raised`; textareas are proportional (the AI theme "Look" field had the browser's monospace), monospace stays for the summary editor and MCP commands. The install dialog's "Open the official page" is a `.linkbtn` (now the `--blue-ink` token), not a browser-blue link.
  - **"…":** only when the next step asks for input. "Rename…" for floors (it asks a name, as the folder menu did); "Schedules" (opens a screen), "Remove from office", "Remove folder", "Control from GitHub (web and mobile)" and the MCP dialog's "Settings" lose theirs (a confirmation or a screen); the activity log's "Clear…" is **Clear activity**, red. The message placeholder ends with "…" (was ASCII "...").
  - **One word per status:** Working, Thinking, Waiting, Idle, Error, Done, Failing, Limit reached, on cards, list, chat header, counters and the palette. `LABELS.waiting` is "Waiting" (was "Waiting for you"; the short form is gone); an idle agent's pill says "Idle" (the "Ready" sub-label is gone, the label is cleared instead), a question no longer sets "Waiting for your answer", the demo's Stop no longer says "Stopped". "Waiting for you" stays in sentences (the schedule template note says "shows as Waiting"). Lifecycle words that are not statuses stay: Paused, Not started, Starting, Ended. The Durbar MCP server mirrors the office (spec 041 FR-011), so `src/main/mcp/agentstate.ts` reports "Waiting" and no "Ready" sub-label too. [KNOWN GAP] The closed door plate's summaries ("Waiting for you - 2", "Busy - 3 working") are phrases, not status pills, and were left as they are.
  - **Spacing:** Settings sections are 16px apart (were 22); the tools groups, the advanced section and the palette use `--r-xl`; agent app cards and inbox rows use `--r-lg`.
  - **No wrapping:** agent app status badges (`.hs-st`) do not wrap. Inbox rows put Allow, Allow for this session and Deny in that order in a group that never wraps, with Open chat after it, the only thing that moves to the next line.
  - **Expand arrows:** "Show the change", "Show the exact command", Settings' "More" and the advanced section draw the shared chevron (the Thinking / Previous sessions path, as a CSS mask in `currentColor`, `CanvasText` in forced colours) that turns 90° when open; the browser's marker is hidden.
  - **States:** hover rules use `--surface-2` (the Thinking toggle, the mode chip and menu, the model chip, the sub-agent Open button, code Copy; the theme picker uses `--raised`); a disabled model chip is muted and dashed, not faded; the local focus outlines on Settings' More, the theme picker and the list's sort headers are gone (the global `:focus-visible` draws them). The place icon picker keeps a ring on its label, because its radio is invisible, now with the global ring's tokens.
  - [KNOWN GAP] About 110 raw-px radii and the older hex hover tints (buttons, chips, the quick replies) remain; rule 2 and 3 apply to new and touched rules, not swept in this change.
- **FR-077** **Reading load** [IMPLEMENTED] read: the code; `sim:` not run in this change.
  - The Thinking block is not italic: a 2px left rule, the muted colour, 13px, `max-width: 70ch`. The empty-thinking line and "no thinking" note are not italic either.
  - The mode menu says one short line per mode ("Can't change files", "Asks before each change", "Never asks"; `MODE_SHORT`) in `--ink-2` with line height 1.45; the full explanation is the item's tooltip.
  - The install dialog leads with "Durbar installs Claude Code for you. Choose how:" and each option leads with its manager: "Homebrew (recommended)", "npm (last resort)" (the last of several plans when it is npm). The "runs as you, asks once more" sentence moved under the options.
  - The AI theme dialog's intro is one line plus three bullets ("One request, small cost", "No tools, nothing kept", "Preview before saving"; the full text in the list's tooltip); `.dlg .dsub` has line height 1.5.
  - Chat header chips are labelled: "Model: Auto" (the button and the read-only chip), and the limit chip says "Limit: none" instead of an italic "No limit".
  - List headers and the palette's group names are in sentence case (no uppercase, no letter spacing).
  - Inbox: each answer button names its key in its tooltip ("(key A)") and `aria-keyshortcuts` (A, S, D, O), and the hint reads "Keys: J/K move · A allow · S session · D deny · O open".
- **FR-078** **House rules written down** [IMPLEMENTED] read: `docs/design-rules.md`.
  - `docs/design-rules.md` lists the ten rules, notes on each, and how to check (geometry and office checks, 10.5px minimum, screenshots); `CONTRIBUTING.md` links it under *Guidelines*. `AGENTS.md` is maintainer-owned and not changed.
- **FR-079** **"and", not "&"** [IMPLEMENTED] read: the code.
  - Tools' tab "Models & context" is "Models and context"; no other "&" in a label was found (grep of `src/renderer`).
- Drivers updated for the new words (not run): `shots-006-remove.js`, `shots-006-continue.js`, `shots-044-everywhere.js`, `shots-044-templates.js`, `shots-054-remote.js`, `shots-m10.js`; unit tests `test-mcp-agentstate.ts` (words and renderer fragments) and `test-mcp-tools.ts`.
### 2026-10-20: round 7, plain words for people who don't code
A teacher who drafts lesson documents with Claude Pro found that the app still assumed she was a programmer: a request read "write src/tools/companies.ts" or "run python evals/baseline.py --compare", the chat header and cards showed token counts, the tool rows were hidden behind one line, and nothing on the first run asked whether she writes code. Terms kept: agent app, Allow once / Deny, spending limit, folder, Demo. Simple mode only unless noted; Expert is unchanged. The event data is unchanged; every new text is set with `textContent` or `esc()`. No office size changes, no IPC change. Built and checked with `npm run typecheck`, `npm run build` and `npm test`; the helpers were checked by hand in node. Not run in Electron.
- **FR-080** **Approval cards in plain words** [IMPLEMENTED] read: the code; node: `plainAsk` on the real adapters' summaries ("write <path>", "write <path> (+N more)", "run <command>") and the simulator's ("Edit <path> (…)", "Run …"); drivers updated by reading the code, not run.
  - From the request's `kind` and `summary` (`plainAsk` in `app.js`): a write reads "<Name> wants to change <file name>" (the base name, e.g. "companies.ts"; "and N more files" when the summary says so) with the parent folder in small text ("in tools", `.pfold`); a shell request reads "<Name> wants to run a command", with the command in a collapsed **Show the command** (`details.pcmd`, shown only in Simple); a read outside the folders "wants to read <file name>"; a web request "wants to open a web page"; an MCP or custom tool "wants to use one of its tools". Any other kind keeps its summary.
  - The card holds both texts (`data-lbl-simple` / `data-lbl-expert`), so switching the detail level relabels open cards (`relabelScopes`). **Show the change** reads **See what changes** in Simple. The round-5 scope button ("Let <Name> change files in “tools” until the session ends") is kept.
  - The inbox and the answer bar read the card's text (`requestText`), so they say the same; the inbox also copies the collapsed **Show the command**. `requestText` always drops the command block, so the OS notification (which uses it) never carries the command in Simple; in Expert the notification still shows the summary (unchanged). The screen-reader announcement uses the plain sentence in Simple.
  - In Simple, a card's status line "Waiting for permission: run …" or "Denied (read-only mode): write …" reads "Waiting for your OK to run a command" / "Read-only stopped it: wanted to change companies.ts" (`taskText`), never the command.
- **FR-081** **Developer details hidden in Simple** [IMPLEMENTED] read: the code; drivers updated by reading the code, not run.
  - Office and list: the room's MCP pill and paths were already hidden; cards showed money only already; the list's Cost column now shows nothing instead of "14k tok" for an agent app that reports tokens only (Codex). Lobby place words: "At Terminal: bash" reads **Running a command** (was "Using the computer").
  - Chat header: the path chip stays hidden; the usage line shows "Cost so far: ≈ $0.04" (money only, nothing for tokens only) instead of being hidden. The context chip and the compact button are shown in Simple with plain text: "Memory 74% full" (or "Memory: not known yet") and **Tidy up memory**; same ids and clicks (the chip opens Tools, which in Simple has no Models and context tab, so it lands on Activity summary).
  - Chat transcript: the round-5 single line "Worked with its tools (Expert shows each step)" is replaced by the tool rows in plain words ("Read companies.ts", "Searched files", "Ran a command", "Changed companies.ts", "Looked at a web page", "Used a tool"; "Reading …"/"Running a command" while running); the tool name, its argument and a successful result are hidden; a failure keeps its text. Opening a row still shows the details.
  - More menu: MCP servers, Copy resume command and Tools and usage were already hidden; **Control from GitHub…** is now hidden too unless remote control is on (then the item says Stop remote control and the Remote chip shows).
  - Tools: the "Tool usage" tab reads **Activity summary**, the **Models and context** tab is not offered, and Cost has no Tokens column.
- **FR-082** **First run asks "Do you write code?"** [IMPLEMENTED] read: the code; `scripts/shots-001-welcome.js` updated by reading the code, not run.
  - The welcome card's Simple checkbox is replaced by a group: "**Do you write code?** You can change this any time in Settings (Detail level)." with **Yes, show me the details** (Expert) and **No, keep it simple** (Simple). Each calls `setDetail`, which remembers the choice like Settings (`durbar.detail`); the chosen button is `aria-pressed="true"` and keeps focus after the re-render. Nothing chosen: Expert, neither pressed. (The old checkbox lost its tick on each re-render of the card.)
- [KNOWN GAP] No simulator run or screenshots in this change; `docs/screenshots/001-welcome-1440x900.png` (and 1280x800) are outdated and need a retake, as do `052-simple-*`. `scripts/shots-052-ux.js` and `scripts/shots-001-welcome.js` were updated by reading the code.
### 2026-10-20: round 8, daily use
Reviewer: a freelance developer on day 3, with 4 folders and 6 agents. Every start felt like day 1: the window came back at 1440x900 in the middle of the screen, the office forgot the List view, the folder filter and the open chat, only one session per folder came back, nothing said what the scheduler missed overnight, and quitting with an agent mid-reply ended it without a word. Built and checked with `npm run typecheck`, `npm run build` and `npm test` (new `test:daily`, extended `test:folders` and `test:schedules`). Not run in Electron; no screenshots in this change. Text is set with `esc()`; no office size changes. FR-083..FR-086 belong to the macOS round (another change).
- **FR-087** **Remember where I was** [IMPLEMENTED] test: `scripts/test-daily.ts` (placement, store); read: the renderer.
  - Main keeps the window's normal place and size and whether it was maximized in `durbar-app-state.json` in userData (`AppStateStore`, `src/main/daily.ts`; not a setting, so not in `durbar-settings.json`), saved when the window closes and on quit. On start, `placeWindow` takes the work area of `screen.getDisplayMatching(saved)`: a window with at least 120x80 px still on it is shrunk to fit and pushed inside; an unknown or off-screen one (a monitor that is gone) opens at 1440x900 (content size, as before). Minimum window 640x480. Dev screenshot and driver runs (`DURBAR_SHOT`, `DURBAR_DRIVER`) neither restore nor save it.
  - The window remembers in `localStorage` (`durbar.ui`, every access in try/catch) the view (Office or List), the folder filter (by the folder's path, as room ids are made per run) and the open chat (the main agent's id). After the agent list loads they come back in that order; the filter only when that folder is still shown, the chat only when that agent still exists. Not in the simulator or the demo.
- **FR-088** **Restore every open session** [IMPLEMENTED] test: `scripts/test-folders.ts`; read: `restoreFolders` in `src/main/main.ts`.
  - A saved folder keeps `openSessions`: the ids (and harness) of the sessions open in it that got a message or were resumed from Previous sessions, oldest first, at most 6 (past 6 the oldest one other than the last session is dropped). Written only when it changes. Remove from office, and a session replaced by a resumed one, take it out (the Codex thread id too); Folders > Remove forgets the folder. End session keeps it: the card stays in the office and comes back.
  - On start every one of them comes back lazily, exactly as the last session did (spec 006 FR-021): a "not started" card under its own id, resumed when its chat is opened or it gets a message; the last session first. A file with only `lastSession` restores that one, as before; no saved session: one fresh agent.
- **FR-089** **"Since you were away"** [IMPLEMENTED] test: `scripts/test-daily.ts` (`buildSinceAway`), `scripts/test-schedules.ts` (`runNow`); read: the renderer.
  - Main saves the quit time on `before-quit` and clears it on start, so a crash leaves no time (and no card). When the app was closed for more than 30 minutes, a calm strip under the top bar (`#awayStrip`, the restore strip's layout in neutral colours, `role="status"`) says **Since you were away** (how long: "3 h 10 min") and lists the scheduled prompts the scheduler marked `missed` at this start (folder name, the prompt's first 80 characters, "runs again as planned" for a repeating one), or "nothing was scheduled while the app was closed". **Dismiss** hides it for this run.
  - **Run missed now** per prompt calls the new `schedules:runNow(id)` (sender-checked like `schedules:save`). `Scheduler.runNow` sends once through the same `send` as a scheduled run and records the outcome; the next planned run and a one-time schedule's done flag are unchanged. It is refused with a reason, nothing sent, when Pause all is on, the schedule is paused, its session ended, its limit is reached, the agent is busy or a run is going out.
  - [KNOWN GAP] Only what the stores know: missed schedule runs and the break's length. The simulator has no away card.
- **FR-090** **A calmer end of day** [IMPLEMENTED] read: `src/main/main.ts`, the renderer; test: `quitMessage` in `scripts/test-daily.ts`.
  - Quitting (menu, Cmd+Q, or closing the window, which ends the sessions too) while any main agent is mid-turn (working, thinking, or waiting for an answer inside the turn; from the agent state tracker and the last status) shows a native dialog: "N agents are still working. Quit anyway?" with **Quit** / **Cancel** (Cancel is the default and the Escape answer). One `before-quit` handler does it in order: the prompt, then saving the window and the quit time, then the remote-control release (spec 054, at most 3 s); the window's close handler shares the answer, so there is never a second prompt.
  - **End all sessions** in the top bar's ⋯ menu and the Ctrl+K palette (only when a session runs): a red confirmation (`.btn.primary.danger`, focus on Cancel) that says how many sessions end and how many are still working, then each running main session ends through the same `end` path as the card menu (`cardMenuActions`' rule: started, not ended). The chats stay; a message resumes one.
- **FR-091** **Back to the last chat** [IMPLEMENTED] read: the renderer; `scripts/shots-052-ux.js` updated by reading the code, not run.
  - With an empty search, the Ctrl+K palette starts with **Recent**: the 5 most recently opened chats (main agents; a helper's chat counts for its agent), not repeated under Agents. Typing searches everything as before.
  - **Ctrl+`** opens the previous chat; pressed again, it goes back. Control also on a Mac (Cmd+` switches windows there). The shortcut sheet and the palette ("Back to the previous chat") name it. The recent list is kept with the other UI state.
### 2026-10-20: round 8, macOS conventions
A Mac reviewer found that the app behaved like a Linux window on macOS: Electron's default menu (with Reload and Toggle Developer Tools, no Settings), Ctrl shown and taken where a Mac uses ⌘, a footnote asking Mac users to translate, Option+letter shortcuts that type accents, closing the window quit the agents, and a plain title bar above the top bar. OS-specific choices are small pure functions (`src/main/appmenu.ts`, `src/renderer/keys.js`, `shouldBounce` in `badge.ts`) unit-tested on any OS (`npm run test:macos`, constitution VI).
- **FR-083** **Application menu** [IMPLEMENTED] test: `test-macos` (template per platform, no reload/devtools roles, actions); read: the wiring. [KNOWN GAP] not opened on a real Mac. (Amended 2026-10-21 by FR-164: a File menu with Add Folder… ⌘O, Add VS Code Workspace… ⇧⌘O and Close Window.)
  - macOS: `Menu.setApplicationMenu` from roles: the app menu (About, **Settings…** with `CommandOrControl+,`, Services, Hide, Hide Others, Show All, Quit), `editMenu`, a View menu with only the zoom roles and `togglefullscreen` (no Reload, no DevTools), `windowMenu`, and `help` with **Agent Durbar on GitHub** (`shell.openExternal(REPO_URL)`). Settings… shows the window and sends `menu:settings`; the preload's `onMenuSettings` calls `DurbarScreens.openSettings()`. The simulator bridge has a no-op; the real preload's listener is used also under the simulator.
  - Windows and Linux: `Menu.setApplicationMenu(null)`: no menu bar, so Reload and DevTools are gone for users. Copy, cut and paste in text fields are Chromium's own keys. There is no developer flag for DevTools in `devhooks.ts`, so none was added.
- **FR-084** **⌘ on a Mac** [IMPLEMENTED] test: `test-macos` (modifier check, chat key check, labels, aria values); read: `app.js`. [KNOWN GAP] not pressed on a real Mac.
  - `IS_MAC` from `navigator.platform`. The shortcut modifier is `metaKey && !ctrlKey` on a Mac and `ctrlKey && !metaKey` elsewhere (`DurbarKeys.modDown`): ⌘K palette, ⇧⌘A inbox, ⇧⌘N next agent; Ctrl+K on a Mac stays the text field's own key (kill line).
  - Labels per platform (`keyLabels`, `keyText`, `ariaKeys`): the shortcut sheet, the palette (Needs you and Next hints, ⌘, for Settings), the inbox button's title and label, the More menu's "Keyboard shortcuts" hint and every `aria-keyshortcuts` (`Meta+Shift+A` on a Mac, `Control+Shift+A` elsewhere); the attributes and titles hardcoded in `index.html` (`data-keys-text`) are rewritten at start on a Mac. The "On a Mac, Cmd works where Ctrl is shown" footnote is gone. The sheet lists ⌘, (Settings) on a Mac.
  - Chat answer keys (FR-060): Alt+A/S/D/N elsewhere, ⌥⌘A/S/D/N on a Mac (`chatKeyDown`), because Option+letter types accents or dead keys there; `e.key==='Dead'` never counts. The answer bar's titles and `aria-keyshortcuts` and the sheet show the platform's keys.
  - [KNOWN GAP] macOS uses ⌥⌘D system-wide to show or hide the Dock (when that shortcut is on), so Deny by keys may never reach the app; the README says to click it. Not checked on a Mac.
  - Drivers (Linux) keep their Ctrl expectations; no change needed.
- **FR-085** **Window behaviour on a Mac** [IMPLEMENTED] test: `test-macos` (`hideOnClose`, `disposeOnQuit`, `windowChrome`, `shouldBounce`, darwin-only CSS); read: `main.ts`. [KNOWN GAP] not run on a real Mac; whether the 78px left room fits the traffic lights, and whether the wider top bar wraps at 1280x800 on a Mac, are not measured.
  - Closing the window on macOS hides it (leaving full screen first) and the agents keep running; `before-quit` sets `quitting`, and the Dock icon (`activate`) shows the window again or creates one. Because `window-all-closed` does not fire on ⌘Q, macOS ends the agents in `before-quit` (at most 3 s), after the remote-control release (spec 054 FR-011, at most 3 s); both run once (`remoteReleased`, `disposedOnQuit`). Windows and Linux are unchanged: closing the window ends the agents and quits (`window-all-closed`).
  - Title bar: `titleBarStyle:'hiddenInset'` on macOS only. The preload passes `platform`; the page sets `html[data-platform="darwin"]` only for darwin. CSS under that selector only: the top bar is the drag area with 78px left room for the traffic lights (none in full screen, from `window:fullScreen` events), and its buttons, fields, menus and groups are `no-drag`. Nothing applies on Windows or Linux, so the office geometry check is unaffected.
  - `color-scheme: light` on `:root`, `dark` for a dark theme (`data-dark` from `theme.js`), so native controls and scrollbars match on every OS.
  - Dock: when the "needs you" count grows and the window is not focused, one `app.dock.bounce('informational')` (the taskbar flash stays Windows-only).
- **FR-086** **README "On a Mac"** [IMPLEMENTED] read: README *Install*: ⌘ shortcuts, Settings… (⌘,), closing keeps agents running (⌘Q quits), no menu bar on Windows and Linux; marked as not tried on a real Mac.
- [KNOWN GAP] No Electron run and no screenshots in this change (the Mac look needs a Mac; Linux screens are unchanged except the shortcut sheet without its footnote).
### 2026-10-20: macOS window cannot be moved from an open chat (FR-085 fix)
The owner ran the build on a real Mac. On start the top bar moves the window and leaves room for the traffic lights, but after opening a session the window could not be moved and the traffic lights covered the **Office** button. The same happened in Settings (a screen hides `.workspace`, which holds the strip; with a chat open the top bar is hidden too, so only the screen's header is left at the top). An open chat hides the top bar (`body.panel-open .topbar{display:none}`), and the agent strip that takes its place had none of the FR-085 rules. Checked in the running app over the DevTools protocol: the top bar measured 0x0 and the points under the traffic lights were `#backBtn` with no drag region.
- **FR-085** (amended) The agent strip (`.strip`) takes the same darwin-only rules as the top bar: it is the drag area, it has 78px left room outside full screen, and its buttons (Office, each agent) stay `no-drag`. When a screen (Settings, Tools, a folder) is open over a chat (`body.panel-open.screen-open`), its header (`.scr-head`) takes the same rules. [IMPLEMENTED] test: `test-macos` (the three rules name `.strip` and the screen header). [KNOWN GAP] the Settings case was found on the Mac and fixed by reading the code (the cause was not measured in the running app); a notice strip shown while the top bar is hidden would sit above the header and is not draggable. [KNOWN GAP] not yet re-checked on the real Mac after the fix; with many agents the strip is mostly buttons, so the window drags from the gaps, the traffic-light room and the space after the last agent; dragging the strip's own horizontal scrollbar on a Mac is not checked.

### 2026-10-20: round 9, pre-release fixes
A QA engineer and a returning non-technical user checked the build before the release. They found layout defects from round 7 (a cut-off Deny, a narrow scroll box for Thinking), screens that did not use the same words, and a few lines that were too short or too technical.
- **FR-092** **Defects** [IMPLEMENTED] read: `styles.css`, `screens.css`, `app.js`, `screens.js`, `harnesses.js`; `npm test`. [KNOWN GAP] no Electron run and no screenshots in this change; the inbox at 1280x800 was checked by reading the CSS, not by measuring.
  - Inbox: Allow once, the session button and Deny keep their order and do not wrap apart, but the session button may shrink (`min-width:0`, ellipsis, one line; the full scope stays in its `title`), so Deny never leaves the row and the list has no horizontal scrollbar.
  - Thinking: the block is full width again, with no inner scroll box (no `max-height`). The 70ch measure is on its paragraphs, list items and headings. No italics, and the left rule stays. Copy stays at the block's bottom edge, outside any scroll area.
  - "Failing" everywhere: the palette rows (hint and search words), the chat strip (word, title, aria label, dot) and the list's dot use `stWord`/`pillSt`. `.dot.failing` uses the waiting colour. Room dot counts stay by state.
  - Simple request: the small folder note ("in tools") belongs to the plain words only. It is `hidden` outside Simple, switched with the detail level, and is never read after a raw summary that has the path.
  - Tools: Cost uses the same pair as Tool usage, **This session** / **All time**, placed before the tabs as in Tool usage. When All time is picked, the start date shows as a small subtitle ("since 2026-10-20"). The summary line, column notes and CSV period say the same.
  - Settings > Agent apps: "for ChatGPT / for Claude / for GitHub" sits on its own small line under the app name, never split.
  - List: the Agent app column is `minmax(100px,1.05fr)` instead of a fixed 92px, so "Basic agent (simulated)" fits at 1280 and 1440.
- **FR-093** **Words** [IMPLEMENTED] read: `app.js`, `screens.js`, README *Safety model*.
  - Mode menu, one accurate line each (the full help stays in `title`). Read-only: "Can't change files; read-only tools still run". Ask first: "Asks before each change or command". Allow all: "Never asks: edits, commands, web". The menu is 360px wide (at most the window width minus 16px), so each line fits on one line.
  - Settings > What Durbar does not do (and the README): "Durbar asks Claude Code and Copilot to stay in their folders but cannot force them; only Codex is held there by the system (in Read-only and Ask first)." and "Rooms you hide or switch off still run and cost money." The other bullets are unchanged and still match the README.
  - AI theme dialog: the cost line names only the app picked in **Made by**, with that app's own cost words, and changes with the selection.
  - Simple chat chips: with no limit, the limit chip reads "No spending limit" (Expert keeps "Limit: none"). The memory chip shows in Simple only from 70% full ("Memory 74% full"); below that, or when the figure is not known yet, it is hidden in Simple.
  - "Remove from office" still asks first (a red confirmation with focus on Cancel, `removeSessionUi`), so its label correctly has no "…" (house rule 6).
- **FR-094** **Drivers** [IMPLEMENTED] read: grep of every changed string in `scripts/`. `shots-052-ux.js` checks the Simple memory chip rule (driver changed by reading the code, not run). No driver checked "This run", "Since <date>", the mode lines, the "not do" bullets or the AI theme cost line. The lead's tour (`10-new-session-dialog`, `09-settings-mcp`) is the lead's driver and is out of scope here.

### 2026-10-20: round 10, chrome density and type
Three senior designers (ex-Apple Pro Apps, ex-Google Material, ex-Ubiquiti UniFi) found the window chrome bulky: a chat header of about 150px, inbox rows of about 165px, Settings sections that read like cards in a brochure, and a dozen stray font sizes. This round tightens the chrome only. The top bar, rooms, room headers, desk cards and the lobby keep their sizes (the geometry and office checks). Another round 10 change (FR-100..FR-104) covers the desk cards, the stats strip, the list view and the Tools tables; this one does not touch them.
- **FR-095** **Chat header and chat** [IMPLEMENTED] read: `styles.css`, `app.js`. [KNOWN GAP] no Electron run and no screenshots in this change; the heights are from the CSS, not measured.
  - `.ph` padding `8px 16px`. The header is one row: avatar (32px), name (T1), role (T5) on the same line, status, "active …", the chips; Previous, Open in VS Code, Stop and More are pinned right (`.ph-top{flex-wrap:nowrap}`, `.actions{flex:none}`). Chips that do not fit wrap to a second row inside their own group, under the first chips; the actions never move down.
  - One control height in the header: chips (`--h-chip` is 28px inside `.ph`) and buttons (`.btn.sm`) are both 28px.
  - The task line and the usage line share one line under the header row (the task ellipsizes; its full text is in its `title`).
  - The "Previous sessions" bar is gone. **Previous (N)** (`#prevBtn`, `.btn.sm`, class `prev-toggle`, `data-pv="toggle"`, `aria-expanded`, `aria-controls="prev"`) sits first in the header's actions; it opens the same panel (`#prev`, now a labelled region) with the same search and lists, and opens by itself for an empty chat as before (FR-002). Its title says how many sessions of each kind there are. It is hidden in the read-only VS Code view, like the panel.
  - The agent strip is 48px (items 40px, avatars 30px, Office button 32px).
  - Composer padding `8px 16px`; hint "Shift+Enter: new line · Drop or paste images · Demo, no credits used · Ask first" (live: "Live Copilot · Ask first"; demo data: "Demo: sample data"). The mode part follows a mode change (the old regex never matched).
  - Bubbles T3 (13px) with `8px 12px` padding; the chat gap is 12px.
- **FR-096** **Compact inbox rows** [IMPLEMENTED] read: `styles.css`, `app.js`. [KNOWN GAP] the row height (about 90 to 100px with a one-line request) is estimated from the CSS.
  - Rows `grid-template-columns:32px 1fr; gap:8px; padding:8px 12px` (`--row-pad`), avatar 32px, 8px between rows, the dialog's padding `14px 16px`.
  - In-row buttons are `.btn.sm`. Allow once, the session button and Deny keep their fixed order and do not wrap apart; the session button still shrinks (FR-092).
  - **Open** (was "Open chat") is a small link-style button at the end of the heading line (`.ib-top`), so it never wraps alone. A question keeps **Answer in chat** with the actions. Key O and `data-k="open"` are unchanged.
- **FR-097** **Settings and Tools screens** [IMPLEMENTED] read: `screens.css`, `screens.js`, `harnesses.js`.
  - The screen header (title and Close) lines up with the centred content column; `.scr-head` padding `8px 24px` (plus the column's offset), title T1 (16px). `.scr-body` max-width 880px.
  - `.scr-sec` padding `12px 16px`, 12px apart; section titles T2 (14/650).
  - Agent app cards: a fluid grid, `repeat(auto-fill,minmax(240px,1fr))`, 12px gap. "Simulated version." is the status badge's `title`, not a line. **Check again** is `.btn.sm`.
  - Shorter blurbs: Agent apps "Install, update or sign in. You see every command first; Durbar never sees your password." Detail level "Expert adds tokens, models, context and paths. Permissions work the same in both."
- **FR-098** **Type and spacing scales** [IMPLEMENTED] read: `styles.css`, `screens.css`, `docs/design-rules.md`.
  - Custom properties `--t1-*` .. `--t5-*` (size, weight, line height): T1 16/650/1.25 (screen, dialog and chat titles), T2 14/650/1.3 (section titles, inbox headings), T3 13/400/1.5 (body, bubbles, composer, notes, buttons), T4 12/500/1.4 (chips, segments, selects, metadata), T5 11/500/1.35 (hints, pills, counts). Spacing `--s-1`..`--s-5` = 4/8/12/16/24.
  - Stray sizes in chrome rules folded: 11.5 to 11, 12.5 to 12 (13 for notes), 13.5 to 13, 14.5 and 15 to 14, 17 and above to 16. Desk cards, rooms, room headers, the lobby, the top bar, the list and the Tools tables are not touched.
  - The body default is T3 (13px). The top bar, the office (`#stage-host`) and the list set `font-size:14px`, the value they always inherited, so nothing in them changes size.
  - Dialogs: padding `16px 24px` (`--dlg-pad`), gap 12px (`--dlg-gap`).
  - Raw radii and colours swapped for tokens where sizes stay: `.select-wrap select`, `.seg` (`--r-md`, the same 10px), `.close`, `.more-menu`, `.more-it`, `.chips-more`, `.chip`, `.mchip`, `.sec` (`--surface-2`, `--line`). `.stat` and `.list-wrap` belong to the other round 10 change and were left alone.
- **FR-099** **Compact spacing (optional)** [IMPLEMENTED] read: `styles.css`, `screens.js`, `app.js`. [KNOWN GAP] not seen in a running window.
  - Settings > Detail level > **Spacing: Comfortable / Compact**. It sets `html[data-density="compact"]` and is saved in `localStorage` (`durbar.density`), like the detail level.
  - Compact overrides tokens: `--h-ctl:28px`, `--h-chip:22px`, `--h-pill:20px` only inside the chat panel, Settings and Tools, dialogs and menus (the top bar's ⋯ menu keeps its sizes); section padding `10px 14px`, section gap 10px, dialog padding `14px 16px`, inbox row padding 8px. The body is 13px in both. The top bar, desk cards, rooms and the lobby are outside every override.
- **Copy, alongside** [IMPLEMENTED] read: `index.html`, `app.js`. Top bar ⋯: "Collapse all folders" / "Expand all folders" (palette too); the demo item reads "Turn on demo" / "Turn off demo"; the inbox's "Open chat" is "Open". The answer bar had no "Open chat" button, so nothing changed there.
- **Drivers** read: grep of `scripts/` for every changed id and label. `check-office-overlap.js` and `shots-009-vschat.js` click `#prevBtn`; `shots-052-ux.js` does not count `#prevBtn` among the at most 3 header actions. Drivers that close Previous through `.prev-toggle[aria-expanded="true"]` still work (the button keeps the class). Not run (no Electron in this change).
### 2026-10-20: round 10, office and tables
A designer who worked on network-operator dashboards found the office bulky: "40 framed boxes compete with 15 agents". Cards, pills and counters each drew their own frame and fill, and the Tools tables sat in cards of their own. This round takes frames and fills away and leaves them only where you must act. Only colours, backgrounds, shadows, border colours, font weights and which text shows change: no desk card, room, room header, lobby or top-bar box changes size, so `check:geometry` and `check:office` hold. Status words and colours are unchanged. Themes keep their own card and counter rules (they override colours, corners and shadows).
- **FR-100** **Flat cards** [IMPLEMENTED] read: `styles.css`, `themes.css`, `app.js`; `npm test`. [KNOWN GAP] not run in Electron; no screenshots in this change.
  - `.desk.card` and `.helper.hc`: `background:var(--surface)`, the same 1px border in `--line-hair` (the page's `--line`, taken on the root because the office reuses `--line` for connectors), no shadow. Clean Office's two-layer card shadow is gone (the radius stays).
  - Waiting, Error and Failing cards keep a light tint; the main signal is a 3px edge inside the card (`box-shadow:inset 3px 0 0 var(--c-waiting | --c-error)`), with no coloured border on top. Round 6 had this edge in Clean only, on top of the shadow; it is now the base rule, so it is not drawn twice. A card that reads Failing gets the class `is-failing` (a lighter waiting tint and the waiting edge).
  - Selection: `0 0 0 1.5px var(--sel-border)` as a shadow (was a 3px pale ring), combined with the 3px edge on waiting and error cards.
- **FR-101** **A dot and a word** [IMPLEMENTED] read: `styles.css`; driver `shots-052-ux.js` (changed by reading the code, not run).
  - On desk cards and list rows, Working, Thinking, Idle and Done are the coloured dot and the word in the status colour, with a transparent background. Waiting, Error, Failing and Limit reached (a waiting state) keep the filled pill, because they need you. The pill keeps its height and padding.
- **FR-102** **Quieter card text** [IMPLEMENTED] read: `styles.css`, `app.js`.
  - The role was already hidden next to the name in the mini and micro densities (spec 001); the card's tooltip now starts with the name and the role (with its profile, app and Remote tags), so it can still be read there. The card and roomy densities, the illustrated desks and the list keep it. Removing text can only give names more room.
  - The usage line already showed only the cost in Simple (FR-081) and, in Expert, both figures right-aligned in tabular numerals; unchanged.
- **FR-103** **One counter strip** [IMPLEMENTED] read: `styles.css`, `themes.css`.
  - The counters in the top bar are one group: a 1px frame (`inset` shadow on `.stats`, radius `--r-md`) with a hairline between counters. Each counter keeps its 1px border (now transparent), its 32px height, its padding and the 5px gap (the divider is drawn in the gap), so the top bar lays out exactly as before. The brief asked for `gap:0` and a real border on the group; both would have changed the strip's width and height, so they were not done.
  - The selected counter: `--surface-2`, a 2px bottom edge and a bold label. Numbers are tabular at weight 600. A counter for Waiting or Error with agents keeps its amber fill; **Needs you** stays a separate filled button.
  - Themes: the group takes the style's surface, corners and frame colour (Corporate 5px, Retro square with its offset shadow, the courts' gold, Japanese 3px), so the counters read as one light strip on a dark top bar too.
- **FR-104** **Operator tables** [IMPLEMENTED] read: `styles.css`, `screens.css`, `screens.js`, `app.js`.
  - List: row hairlines in `--line-soft` (`--line` at 60%); the header is 11px, weight 600, `--muted`, `letter-spacing:.02em`, sentence case, transparent, with one 1px rule; hover `--surface-2`; Active and Cost right-aligned with tabular numerals (header too); rows stay 34px.
  - Tools: a group is a heading over its table (no card frame); cells `7px 8px` with `--line-soft` rules and a 1px header rule; who used a tool is plain text ("Ada 3 · Clara 2 · +9"; a name is still a button that opens the chat); bars are 4px; numbers right-aligned with tabular numerals.

### 2026-10-20: round 11, one-row top bar and thinner walls
Three senior designers proposed these in round 10; they were deferred because they change sizes the geometry and office checks guard. The top bar was two rows (about 92px); it is now one row of 48px, and the 44px or so it frees goes to the office. Room walls, lobby places and helper connectors are 1px. Desk cards and room headers keep their sizes.
- **FR-105** **One-row top bar** [IMPLEMENTED] read: `index.html`, `styles.css`, `themes.css`, `app.js`; measured in headless Chromium on the simulator page (`?sim=15&simfreeze=1`, with floors and several agent apps) at 1280, 1366, 1440, 1600 and 1800px wide, in Noto Sans and in DejaVu Sans (CI's font): one row of 48px, no overlap, nothing outside the window, smallest text 11px. [KNOWN GAP] not run in Electron; `check:office`, `check:geometry` and the drivers not run here; macOS (78px of traffic-light room at 1280 wide) not measured; no new screenshots in this change.
  - (Amended 2026-10-21 by FR-164: **+ New** is replaced by two buttons, **+ Folder** and **+ Workspace**, and the fit widths changed; see FR-164.) Left to right: the brand mark and name with the small Demo badge; **+ New**, a menu (`aria-haspopup="menu"`, the arrows, Home/End and Esc of the other menus) with **Add folder…** and **Add VS Code workspace…** (the old `#addFolder` and `#addWs` ids, so the palette, the welcome card and drivers still find them); the **Defaults** chip (`#defaultsBtn`) that shows the defaults for new sessions, for example "Copilot · Read-only · Auto" (the agent app only when there is a choice, the model not in Simple), and opens a small popover (`#defaultsPop`, `role="dialog"`, labelled selects; Esc returns to the chip, Tab out or a click elsewhere closes it) with the existing selects and their ids (`kindSel`, `kindHelp`, `permMode`, `modelSel`, `effortSel`); **Floors** when there are two or more; the folder filter (`#wsFilter`) joined with a **Manage folders** icon button (`#foldersBtn`, the old Folders panel); Tools and Settings (ghost); Office / List; ⋯. **Needs you** and the counter strip are on the right.
  - The row fits by width, measured with the widest font: below 1800px the counters show the dot and the number (the words stay in each counter's title and label); below 1600px Needs you shows its icon and number; below 1440px the Defaults chip is capped at 160px (full text in its title and label), the segmented buttons and the folder filter are a little narrower and the gaps 2px smaller. The bar still wraps rather than overflow if a very long model name or a future control does not fit.
  - The popover sits outside the header, so the dark top bars of Corporate, Retro and the courts keep their colours and the selects stay dark text on a light surface; themes only recolour (the old `#liveBar select` rules now style `.defaults-grp select`). The restore and away strips stay below the bar. "+ New" rings once on the first-run card (it was "+ Folder"); the empty-office and Folders texts name + New and Manage folders. Ctrl+K gains **Add VS Code workspace** and **Defaults for new sessions**.
- **FR-106** **1px walls** [IMPLEMENTED] read: `styles.css`, `themes.css`, `app.js`.
  - `.room` and `.place` borders 1.5px → 1px; the helper strip connectors (`.helpers.hstrip` lines) and the SVG links 1.5px → 1px; Retro's ring shadow round a room follows (1px). Rooms and places lose 0.5px a side and their content gains it; no check stores expected pixel numbers (`check:geometry` compares every theme with Clean Office at run time; `check:office` measures overlap and fit), so nothing to update there.
- **FR-107** **Drivers** [IMPLEMENTED] read: every `scripts/*.js` and `scripts/*.ts` grepped for the top-bar ids and classes. sim: (2026-10-20, Linux, xvfb) `check:geometry` 66/66 and `check:office` both shards pass (2/2) at 1280x800 and 1440x900; drivers 001-welcome, 012-signin-chat, 017, 018, 033, 034-list, 044-everywhere, 051-setup, 052-ux (mixed agent apps), 054-remote pass; the screenshot tour checked by eye in Clean Office and every theme. Fixed on the way: the Manage folders popover opens under its button (it was pinned to the right edge), and `shots-017` reads the Copilot history from the "Previous (N)" button (round 10 moved it there; the driver had failed on `main` since).
  - `shots-017.js` opens the Defaults popover before it checks that the selects are visible, reads the visible label (`label[for="kindSel"]`), and checks the popover's smallest text and that the chip names the agent app. `check-office-overlap.js` fails when the top bar is taller than 52px (floors cases) and, for mixed agent apps, when it is not one row with the agent app in the chip. `shots-018.js`, `shots-052-ux.js`, `shots-006-home.js`, `shots-043-default.js`, `shots-044-templates.js` and `shots-033.js` need no change (they click `#addFolder`, `#foldersBtn` and `#floorsBtn` by id, set selects by id, or check `.defaults-grp #permMode`).


### 2026-10-20: question options are never cut off (FR-140)
Owner report (Paco, real Mac, issue #365): the options of an agent's question card are cut off ("…") and cannot be read; he asked for the full text on hover. Cause (read): `.note.question .q-opt` buttons are `.btn`, which is `white-space:nowrap` with a fixed 28px height, so a long label cannot wrap; and their `title` held only the option's description, never its label.
- **FR-140** **Question options in full** [IMPLEMENTED] read: `styles.css`, `app.js`, `sim.ts`; sim: `npm run check:question-options` passes at 1440x900 and 1280x800 in Expert and Simple, and fails when `white-space:nowrap` and the fixed height are put back (mutation run). Screenshots: `docs/screenshots/052-question-options-1440x900.png`, `-1280x800.png`, `052-question-options-inbox-1440x900.png`, `-1280x800.png`. Not seen on a real Mac or a real agent question.
  - `real:` (simulator on a real Mac, macOS 26.7.1, Apple M1 Pro, Paco's Mac session, 2026-10-20, on 9ceebd9, `simquestion=long`, measured over CDP): at 1280x800 and 1440x900, Simple and Expert, the 283-character question is not clipped; the 226-, 105- and unbroken 185-character labels wrap to 3, 2 and 3 lines with no overflow; every option fits in the card and every `title` starts with its label; the Needs-you row shows the full question. The owner's "ends mid-sentence" was not reproduced there either (his screenshot was cropped).
  - An option button wraps (`white-space:normal`, `height:auto`, `min-height:28px` (the `.btn.sm` height of FR-076), `text-align:left`, `max-width:100%`, `overflow-wrap:anywhere`), so the full label is always on screen (also for touch and keyboard). Padding, focus ring and the chosen look are unchanged. Simple and Expert are the same.
  - The `title` is the label, then ` — ` and the description when there is one (text only, as before).
  - The question text itself is never clipped: it is a plain `<p class="q-text">` inside the card, the card sits in the chat's scroll box (`#chat`, `overflow-y:auto`), and the text is the agent's full string; no clamp or fixed height applies to it. In the simulator (long question, Expert and Simple, 1440x900 and 1280x800) it is shown in full; if the owner's card still ended mid-sentence on his Mac, the cut was not in the card or the chat's scroll box [KNOWN GAP: not reproduced; to try on the owner's Mac with a real question].
  - The inbox row shows the question text in full (`.ib-t`, `overflow-wrap:anywhere`) and "Answer in chat"; it does not copy the option buttons, so they cannot be cut off there. [KNOWN GAP] With several questions in one card the row shows the first question's text only (`requestText`); the rest is in the chat.
  - Simulator: `simquestion=long` asks a question with a long text and long options (with and without a description).

### 2026-10-20: New session visible in the chat header (FR-139)
Issue #363. Owner (Paco, 2026-10-20): "when I'm in a session I don't see how to create a new one; I see the previous sessions but there is no new session", then "shouldn't New session be more visible?". **+ New session** was only under **More** (FR-003), next to rarer items such as Remove from office. The other routes (a room's "+", the agent context menu, the Folders popover, the memory-full note) are not in the chat.
- **FR-139** **New in the chat header** [IMPLEMENTED] read: `app.js`, `styles.css`, `check-office-overlap.js`. Owner-approved design:
  - `real:` (simulator on a real Mac, macOS 26.7.1, Apple M1 Pro, Paco's Mac session, 2026-10-20, on 50f7778, measured over CDP): at 1280x800, 1440x900 and 1920x1050, Simple and Expert, `+ New` (59px, title and aria-label "New session in <folder>") stays on the one action row with no overflow (Expert: Previous, + New, Open in VS Code, Stop, More; Simple: Previous, + New, Stop, More); header height unchanged across widths; the click opens the same New session dialog and Esc closes it; Tab order puts it right after Previous; no `+ New` in a helper's chat. Demo mode not checked there (covered by `check:office`).
  1. A **+ New** button next to **Previous** in the chat header (`#newSessHdrBtn`, title and aria-label "New session in <folder>") opens the same flow as `#newSessBtn` (`newSession(a)`). It shows under the same conditions as the More item (`bridge.newSession && anyKindReady()`, main agents only, never for sub-agents) and not in the demo (`!demoOn`).
  2. It must fit the one-row header at 1280x800 with the narrowest panel; if the label does not fit, it becomes an icon-only "+" with the same accessible name. The choice is made by measuring (see Evidence below), at 1280x800 and 1440x900, in Simple and Expert.
  3. **+ New session** stays in **More** and in every other path; no route is lost.
  4. Optional: a first row "+ New session" at the top of the Previous list. Not done (decision below).
  5. This is a **third visible header action by owner decision**, an exception to round 10's "two actions in view" (FR-003, FR-095): Previous (N), **+ New** and Open in VS Code, then More. Everything else stays in More.
  - Tests: `check-office-overlap.js` asserts the button, its accessible name, that it is absent for a sub-agent, that it opens the dialog, and that the header stays on one row without overlap.
  - Evidence: sim: (2026-10-20, Linux, xvfb, DejaVu/Noto as installed) `check:office` 288/288 including the new chat checks; label kept as **+ New** (66px wide): the smallest gap between the chips and the actions over the 15 simulator agents was 17px in Expert and 52px in Simple at both 1280x800 and 1440x900 (the chip group may wrap to a second row as before; the actions stay on the first). Mutation: hiding the button made `check:office` print 32 FAILs. Point 4 (a first row in the Previous list) was not done: the header button and More already give two routes in the chat. [KNOWN GAP] not tried on a real Mac or Windows; the 17px gap is on Linux fonts.

### 2026-10-20: macOS title bar on every screen (FR-138)
Issue #345, owner request: every screen follows the macOS title-bar conventions (hidden title bar, traffic lights top left, a part of the top band moves the window, nothing clickable under the traffic lights or in a drag region). A simulator audit with `html[data-platform="darwin"]` forced, at 1440x900 and 1280x800, found four gaps after the FR-085 fix (#342): a notice strip shown with a chat open is the first row and has no drag region; the overlays and popovers lie over a drag region and Electron ignores z-order for `app-region`; with many agents the chat strip is draggable only in 8px gaps and its scroller sits inside the drag region; and the flat `padding-left:78px` on `.scr-head` overrode the centred padding of FR-097. No window title is needed (owner decision, Q5).
- **FR-138** **Title bar on every screen** [IMPLEMENTED] test: `test-macos` (darwin-only rules, the exact selectors), `check:mac-titlebar` (simulator geometry, `html[data-platform="darwin"]` forced). All rules are under `html[data-platform="darwin"]`; Windows and Linux are unchanged (`check:office` geometry identical).
  - `real:` on b0a1397 (Paco's real Mac, macOS 26.7.1, M1 Pro, simulator, light theme, 2026-10-20): the 32px grip handle reads as a handle and the list ends 40px before the strip edge at 1280 and 1440; dragging the window from the handle works and two-finger trackpad scroll over the agent cards works (by hand, Paco); the scroll fade follows the position (right only at the start, left only at the end, both in the middle). Not seen there: the no-overflow case (the simulator always overflows; covered by `test-macos`) and the dark theme.
  - **Notice strips (Q2).** With a chat open (`body.panel-open`), a visible `#restoreStrip` or `#awayStrip` is the first row: it is the drag area with 78px left room (none in full screen), its buttons stay `no-drag`. The chat strip (or a screen header) below it then drops the 78px (`.notice-strip:not([hidden]) ~ ...`). Without a chat the top bar is the first row and the strips stay as they are.
  - **Overlays and popovers (Q1, Q4).** `.dlg-ov` (every dialog, the palette, the shortcut sheet), `#foldersPop`, `#floorsPop`, `#defaultsPop` (round 11), `.mode-menu` and `.more-menu` (the + New menu too) are `no-drag`, so their backdrop and controls can be clicked. While a dialog is open the window cannot be moved by dragging (it is modal; accepted).
  - **Chat strip (Q3).** `.strip-list` is `no-drag` (its scroller works, scrolling and dragging its scrollbar are not taken by the window). A fixed grab area stays draggable at the right end of the strip: a 32px handle (`.strip::after`, with grip dots in `--muted` at 55%) plus the 8px gap before it, 32x24px of continuous drag at least, checked. It was 56px (empty space); the owner found that too big (hand check on a real Mac, e2698d2) and the last agent card cut off with no cue to scroll, so the agent strip also fades at the edge that is cut off while it can scroll (a scroll-driven `mask-image`, all platforms, no geometry change; with reduced motion too, it is not motion).
  - **Screen header.** `.scr-head` over a chat keeps the FR-097 alignment: `padding-left:max(78px,calc((100% - 880px)/2 + 24px))` instead of a flat 78px.
  - **Check.** `scripts/check-mac-titlebar.js` (`npm run check:mac-titlebar`) opens each state (office, list, chat, chat with Settings, chat with Tools, Settings, Tools, chat with the restore strip, chat with the away strip, palette, shortcut sheet, inbox, a tall dialog, the folders and Defaults popovers, the + New menu, office and chat in full screen) at 1440x900 and 1280x800 and fails on: no draggable part in the top 40px band (in a chat, less than 32px of continuous grab width); a clickable element in the traffic-light box (x<78, y<40) outside full screen; a clickable element over an effective drag region (drag rectangles minus no-drag rectangles, z-order ignored like Electron). It exits non-zero on a failure and on a driver exception. Not added to CI here (`.github/` is the maintainer's); proposed as a follow-up.
  - **Evidence before the fix** real: real Mac, simulator data, main 7324979, 2026-10-20, Paco's Mac session. The top bar is 92px (two rows) with the macOS fonts at 1280 and 1440, one row (56px) only at 1920, so the Folders popover (`#schedPauseAll`, `label.fp-pause`, y=85) did lie over the drag region at those sizes. Nothing clickable was under the 78x40 box in any state (the 78px room works). A notice strip over a chat was the first row with no drag (11-12% of the band draggable); with Settings over a chat the notice strip again took the first row (20% instead of 94%), so the notice rule covers `body.panel-open` with or without `.screen-open`. Every `.dlg-ov` backdrop lay on the drag region (no control inside a dialog did at these sizes). The chat strip with 15 agents was about 18-20% draggable. `win.getWindowButtonPosition()` returns null unless `setWindowButtonPosition` is used, so the 78x40 box stays an estimate.
  - **Evidence before the fix, part 2** real: same Mac session. `.scr-head` misalignment confirmed (title at x=78 against the content column at 224 at 1280 and 544 at 1920). The first run was audited (welcome, palette, shortcuts, Folders, More, Settings, Agent apps, `#hsDlg`): the only conflicts were the `.dlg-ov` backdrops. Constitution V holds with the two-row bar (1280: 22 cards, 1440: 27, no scrolling or overlap, text at least 10.5px). The 78px padding sat on the whole `.topbar`, so a wrapped second row also started at x=78 ("+ Folder").
  - **Review fixes** (same PR). The top bar reserves the room with a `::before` on its first row only (the second row starts at the normal padding; the one-row case at 1920 is unchanged). A notice strip that is the first row is at least 40px tall, so the Office button below it never reaches into the 78x40 box (it did, at y 39-40, with a 31px strip). The agents in the chat strip are reset to no region (`.strip-list *`): they inherit `no-drag`, overflow the scroller unclipped, and would otherwise cover the grab area; whether the real Electron clips them is not known, so the check assumes it does not. The check tests the traffic-light box by rectangle overlap, requires a 40x24px grab block in every chat state, and checks the screen title against the FR-097 column (+-1px) and the top bar rows.
  - **Evidence after the fix** real: macOS 26.7.1, Apple M1 Pro, Paco's Mac session, script-measured over CDP with the simulator, 2026-10-20, on 96bb286 (**before** the rebase on round 11's 48px one-row top bar, so none of it covers that bar). Notice strip with a chat open: 88/89/92% of the band draggable at 1280/1440/1920 (was 11-12%). Notice strip with Settings over a chat in real full screen: 92% (was 20%). Palette, shortcuts and Needs you: 0% drag band, no backdrop or control on a drag region (all sizes, Simple and Expert). The Folders popover (`#schedPauseAll`, `label.fp-pause`) is off the drag region at 1280/1440. Floors popover, More menu and context menu are clean. The chat strip grab area is 56px on the right (`elementFromPoint` = `.strip`) and the list still scrolls (`scrollWidth>clientWidth`). The chat-only drag share is 11-12% (1280/1440) and 8% (1920), lower than before because the gaps between agent buttons are no longer draggable: the 56px grab area is the main handle (whether it is easy enough to find is for the owner to judge). The Settings-over-chat title x equals the column x (224/304/544). The second top-bar row starts at x=14/20, the brand stays at 78, one row at 1920. Nothing clickable under 78x40 in any state. Real full screen in and out works (room removed and restored). [KNOWN GAP] still unverified on a real Mac: trackpad drag on the grab area, trackpad horizontal scroll over the strip, double-click zoom, the traffic-light position by eye, and everything after the rebase on the 48px bar (including `#defaultsPop` and the + New menu).
  - **Evidence on the one-row bar** real: macOS 26.7.1, Apple M1 Pro, Paco's Mac session, script-measured, 2026-10-20, on e2698d2 (before the grab area was resized to 32px and the scroll fade was added). The top bar is one 48px row at 1280/1440/1920; the office band is 40/44/45% draggable; the brand is at x=78; nothing is clickable under the 78x40 box in any state. `#defaultsPop`, `#newMenu`, `#foldersPop` and `#topMoreMenu` are no-drag with no control on a drag region. Overlays: 0% drag band. Notice strip with a chat: 88/89/92%; notice strip with Settings over a chat in full screen: 92%. The chat strip grab area works and the list scrolls; chat-only drag 12/11/8%. Settings over a chat: title aligned at 224/304/544. Tools over a chat: 65-77%. Full screen in and out is fine. Hand checks by Paco on the real Mac: dragging from the grab area moves the window, two-finger trackpad scroll over the cards scrolls the strip, double-click zoom works, the traffic lights look fine. Feedback that led to the 32px handle and the scroll fade: the 56px grab area read as empty space, and the last agent card was cut off with no scroll cue. [KNOWN GAP] the resized handle and the fade are checked in the simulator only (before/after screenshots), not yet on the Mac.
  - After the fix: [IMPLEMENTED] sim: `check:mac-titlebar` 40/40 states (20 at each size). Not re-measured on the real Mac.
  - [KNOWN GAP] Not run on a real Mac: the real traffic-light position by eye (the 78x40 box is the default `hiddenInset` estimate; the API returns null), a re-measure of the fix on the real Mac, first run, double-click on the bar to zoom, trackpad scrolling in and next to drag regions, real full screen (the simulator sets `data-fullscreen` by hand), and whether `~` sibling selectors and app-region hit-testing follow a strip being shown or hidden at run time. The check models Electron's rule (drag minus no-drag, z-order ignored) from computed styles; it does not call the OS.

### 2026-10-20: grant chips grouped; header chips flow (issue #367)
Issue #367. Owner (Paco, 2026-10-20, real Mac, a real Copilot session using several MCP tools): "all those green bubbles take a lot of space; what are they?" They are the **Allowed for this session** grants (`.gchip`), one chip per tool the user allowed. With 8 grants they took 4 rows of the chat header; each label repeated the server name (made-up example `server-x › server-x-GetItem`). In the same screenshot the header chips (Model, Profile, Context, Limit, the folder path) were stacked one per row in a narrow column instead of flowing.
- **FR-141** **Allowed (N), short labels, flowing header chips** [IMPLEMENTED] test: `test-grant-label` (`npm run test:grantlabel`) (label shortener); sim: `npm run check:grant-chips`.
  - 2026-10-20 (real Mac on 6270883): cancelling Revoke all with the Cancel button now keeps the list open, the same as Esc (a click inside the dialog is not an outside click). `check:grant-chips` asserts it.
  - 2026-10-20 follow-up (review of PR #380): the `#grantsPop` list has `role="group"` with its `aria-label`, so screen readers announce "Allowed for this session" when focus enters it. `check:grant-chips` asserts the role. No screen reader was run.
  1. With more than 2 grants the header shows one chip **Allowed (N) ▾** (`#grantsBtn`, a button with `aria-expanded` and `aria-controls`). It opens a small popover (`#grantsPop`, a `ul` with `role="list"`, one row per grant with a revoke button named "Revoke permission: <label>", plus **Revoke all**). Escape closes it and returns focus to the chip; clicking outside closes it; after a revoke the focus goes to the next revoke button (or the chip, or nowhere when none is left and the popover closes). **Revoke all** asks for a confirmation only when it would revoke more than one grant. Every revoke uses the same path as before (`bridge.revokeGrant`). With 1 or 2 grants the single chips stay.
  2. Labels are shortened for display: when the tool name after the server name starts with the server name (`server-x › server-x-GetItem`), that prefix is dropped (`server-x › GetItem`). The full label stays in the title and in the accessible name. Helper `shortGrantLabel` in `src/renderer/grantlabel.js`; labels without a `›` or without a repeated prefix are unchanged.
  3. The header chips (`.ph-meta`) flow on one or two rows at 1280x800 and 1440x900 in Simple and Expert, keep the 28px control height and the 10.5px minimum text, and the darwin title-bar rules and the **+ New** button are untouched. The cause and fix are in the plan note.
  - Simulator: `simgrants=many` gives the first agent eight grants with long names.
  - Cause of the stacked chips (measured, simulator, Linux/xvfb, before the fix): `.ph-top` was `nowrap`, so `.ph-meta` only got the width left beside the name (up to 40%) and the actions. At 1440x900 and 1280x800 that was 564px in Expert (5 chip rows for the worst agent, 161px header) and 276px / 192px at 1000 / 900px wide (8 rows, one chip per row, 253-283px header). Fix: `.ph-top` wraps and `.ph-meta` has a 760px basis, so with less than 760px left the chips take a full row under the name and the actions (which stay on the first row; the name and + New stay on one row); with more room they stay beside the name, as in round 10. After: worst header chips 1 row at 1440/1280 Expert, 2 rows at 1000/900.
  - Evidence: [IMPLEMENTED] test: `test:grantlabel`; sim: `check:grant-chips` passes at 1440x900 and 1280x800, Expert and Simple (one "Allowed (8)" chip, eight rows with named revoke buttons, short labels, Escape returns focus, focus stays in the list after a revoke, outside click closes, Revoke all asks first, 2 grants = 2 chips, header chips at most 2 rows, no overlap, text 10.5px or more, controls 28px). Mutation runs: all chips rendered again, and the old `nowrap`/`flex:auto` header CSS put back: both make the check fail. `check:office` 356/356. Screenshots: `docs/screenshots/052-grant-chips-*.png`.
  - [KNOWN GAP] Not seen on a real Mac or with real MCP grants (the simulator's label names are made up); the narrow-window fix was measured on Linux fonts. Screen reader output was not listened to (roles and names are asserted only).
  - **Follow-up (2026-10-20, real-Mac finding on #380).** After Revoke all was confirmed, and after the last single chip was revoked, `document.activeElement` was `<body>` (the chip it pointed at was gone). Now, when the count reaches 0 while the focus was in the grants row, the focus goes to the chat composer (`#msgInput`, the same neighbour as after answering a card) and "All permissions revoked." is announced in `#srAnnounce`. `check:grant-chips` asserts both for Revoke all and for the last single chip; dropping the fix makes it fail.
  - `real:` (simulator on a real Mac, macOS 26, Apple M1 Pro, Paco's Mac session, 2026-10-20, on b0d21fb): header 133px / 3 rows at 1280, 1440 and 1920 in both modes; at 900x800 165px / 4 rows in Expert and 133px in Simple; no overflow, nothing under the traffic lights. The Allowed chip is 98px, the popover 420px inside the window with no inner scroll. Labels are shortened with the full names in the title and aria-label. Enter/Space opens the list and focuses the first x, Tab moves, Escape returns focus to the chip, focus after a revoke is kept, 2 grants become single chips with the focus kept, an outside click closes. Revoke all shows the dialog with Cancel focused and Esc returns focus. The focus loss above was found here. [KNOWN GAP] dark not tested (no built-in dark theme); VoiceOver not driven.
  - **Review fix (Vikram, #381).** The "Revoke all under way" state is the agent id, not a boolean: `DurbarGrantLabel.grantsBusyFor` drops it as soon as another agent is drawn, a leftover focus target is dropped on an agent switch, and it ends 1s after every revoke has settled (a failed revoke included), so it never moves focus later. Test: `test:grantlabel` (pure rule; the mutation that keeps the other agent's id fails it); `check:grant-chips` with `simgrants=stuck` (revokes that remove nothing) checks that a failed Revoke all leaves the grants and does not announce or take the focus on another agent. [KNOWN GAP] the end-to-end "stale state steals the focus" case is not reproduced in the simulator (opening a panel moves focus and the announcement itself); the pure rule is what is tested.


### 2026-10-21: smooth and snappy, measured (FR-142..FR-145)

Measured with a new simulator check, `scripts/check-perf.js` (`npm run check:perf`). It reports frame times, long tasks, elements the office replaces per second, chat open and agent-switch times, 1000 chat messages and a theme switch. It fails only on a frozen frame (≥ 1 s), DOM leaks or a chat that opens in more than 1.5 s. The simulator gained `simspeed=N` (background activity N times faster) for it.

- **FR-142** `[IMPLEMENTED]` **A long chat stays fast.** Following the chat to the bottom read `scrollHeight`, which lays out the whole chat, on every event and every streamed delta. So each message cost more than the last: about 27 ms per message after 1000 messages, a turn that "drags". Now there is one read and one write per frame (`stickyScroll`, `requestAnimationFrame`), and the open thinking box follows its text in the same frame. The duplicate `scrollChat` helper is gone; every caller uses `stickyScroll`. `sim:` 1000 messages took 22.4 s, 28.2 s and 41.4 s on `main`, and 0.95 s, 1.37 s and 1.48 s after (three A/B pairs on a loaded machine). The profile shows `stickyScroll` gone from the top (it was 86% of the time).
- **FR-143** `[IMPLEMENTED]` **The office patches only what changed.** A render used to build, parse and diff the HTML of the whole stage, although a tick usually changes one desk. Now each part (each open room, the lobby, the door plates) keeps its last HTML, and only a changed part is parsed and morphed. Parts added, removed or reordered fall back to the full morph, so the DOM is the same. `sim:` under 10× simulated activity, the office's busy time fell from 9.0 s to 6.2 s in 15 s, and `morphHTML`/`syncAttrs`/`keyOf` left the top of the profile.
- **FR-144** `[IMPLEMENTED]` **The context chip is replaced only when it changes.** It was re-created on every state change, which cost time and dropped keyboard focus on the chip. It now keeps focus.
- **FR-145** Frame times, chat open (40–80 ms), agent switch (median 27–77 ms) and a theme switch (~80 ms) were already fine and stay so. The office keeps 16.7 ms median frames under 10× activity. On a quiet machine p95 is 16.8 ms. On a loaded one (load ~11, other checks running) both builds showed occasional long tasks, so `[KNOWN GAP]`: frame jank under heavy machine load was not separated from the load itself.

### 2026-10-21: overnight usability pass (10 persona rounds over every screen)

Method: every simulator driver was run fresh (140 screenshots, 1440x900 and 1280x800, `DURBAR_SIM=15`). Each round looked at **all** of them through 2×2 contact sheets, then at full resolution where a screen looked wrong. 200 committed screenshots no driver recaptures were audited once for staleness (the old top bar; reported, not reviewed as the current UI).

Round 1 (first-time solo developer) — fixed:
- **FR-146** `[IMPLEMENTED]` The keyboard shortcut sheet opens at its top: Close is focused without scrolling, and from 900px wide the sheet has two columns (general and list view | inbox and chat), so it fits 1280x800 without scrolling. Before, the title and Ctrl K were scrolled out of view. `sim:` shots-052-ux.
- **FR-147** `[IMPLEMENTED]` Previous sessions: the panel ends with a clear edge (a soft shadow), and its list fades out at the bottom while more rows are below. A half-cut last row no longer reads as text over the chat. `sim:` shots-006-prevmarks.
- **FR-148** `[IMPLEMENTED]` While a theme is tried (the AI theme bar), toasts sit above the bar instead of on top of it (overlap at 1280x800). `sim:` shots-040-aitheme.
- **FR-149** `[IMPLEMENTED]` The AI theme preview says what each word renames by its Clean Office word (Library, Software library, Terminal, Web, Other tools, Lobby), never the internal key (`place-library`, `lobby-label`). It names the look and scene by their theme names ("Built on the Corporate look, with Corporate people and furniture") instead of raw ids.
- **FR-150** `[IMPLEMENTED]` Defaults for new sessions: the selects no longer repeat their labels ("Permission mode: Read-only", not "New: Read-only"; "Model: Auto", not "Model: Model: Auto"). The top-bar chip starts with the permission mode ("Read-only · Copilot · Auto"), so a narrow chip cuts the model, never the mode (it was "Copilot · Read-onl…" at 1280x800).
- **FR-151** `[IMPLEMENTED]` The "still in the office" refusal no longer repeats its title in its body ("End it and remove it from the office first, then delete it here."). "Hide hidden again" is now "Hide the hidden ones". The Read-only line in the mode menu says "Reads only: can't change files or run commands" (no "read-only tools" jargon).
- **FR-152** `[IMPLEMENTED]` Desk cards (real finding, a 15-session office at 1280x800, and reproduced in the simulator at the card density): the usage line lets the token count give way first and keeps the cost whole; a narrow card drops " est." / " AIU" (the tooltip and the status pill say it). The line is fitted by **measuring**, not by a width threshold, so it holds with any font (CI's fonts cut the cost where the first, threshold-based version passed locally): `fitUsage()` runs after every office layout and when fonts load. It takes one step at a time until the cost fits: drop the token count, then the unit, then the short form, then the cost (still in the tooltip). `test:` `check:office` with DejaVu Sans forced (`OFFICE_FONT_FILE`, CI's default font): 360/360. Room headers are fitted the same way: a name cut even by a pixel while its path shows hides the path (themes with wider display fonts cut "swisscontract-ai" on CI). `check:geometry` refits inside its forced font (`window.DurbarFit`) so all themes compare alike. Before, the cost was cut (and ran past the card's right edge on one card), and a capped "33.00/30 AIU" was cut in the places and floor layouts. `check:office` now fails when an icon or the cost inside a desk card leaves the card or is cut by a clipping ancestor, in every layout it loads plus the card and full densities with dollar estimates.
- Not changed, with reason: the top-bar counters stay icon + number below 1800px (FR-105's fit decision, the words are in each title); a long remote-control link wraps where it must; "Idle · Session failed" is the mood driver's scenario text.

Rounds 2-10 — fixed:
- **FR-153** `[IMPLEMENTED]` (team lead) A room's name is never cut while its path still shows: the path always gives way first (`check:office` rule). The Floors panel's "Only" is "Show only". The list's money column is "Usage" (a cost where the app reports one, tokens otherwise, as for Codex).
- **FR-154** `[IMPLEMENTED]` (accessibility; measured on office, list, chat, Settings and inbox at both sizes) Every text passes WCAG AA contrast. The chat's Copy buttons are full opacity and 24px tall (they were 2.4:1 at rest); the list sort arrows are 80% (1.9:1 before). The room cost total, list sort headers and the inbox "Open" links get a 24px hit area (WCAG 2.2 target size) without a layout change.
- **FR-155** `[IMPLEMENTED]` (non-native English speaker; 675 UI strings read) No idioms: "Error: please check it", "Has an error. Please check it.", "<name> has an error", "waiting less than a minute". Simple chat rows say "Searched files" only for file searches and "Ran a search" otherwise. "Rooms fold into name plates". "Serious mode (no mood drawings)".
- **FR-156** `[IMPLEMENTED]` (security-minded admin) The top-bar defaults chip is tinted red when new sessions default to Allow all. Unchanged and checked: Allow all is confirmed where it takes effect.
- **FR-157** `[IMPLEMENTED]` (designer) Paragraphs, notes and list items avoid a lone last word (`text-wrap: pretty`); headings are balanced.
- **FR-158** `[IMPLEMENTED]` (Windows user) Room headers and the chat's folder chip show the home folder as `~` (`C:\Users\name`, `/Users/name`, `/home/name`), so an ellipsis keeps where the folder is; the tooltip has the full path.
- **FR-159** `[IMPLEMENTED]` (all personas, 49 more screens from 8 drivers outside the first set: model switching, caps, MCP extras, import, About) The spending-limit dialog no longer says the plan note twice; the Copilot line stays in Tools > Cost. Several model switches in a row show one Undo toast per agent, not a pile; a newer switch replaces the older toast, since only the last switch can be undone. `sim:` shots-model, shots-m9.
- Rounds 8 (macOS), 9 (Copilot Free budget) and 10 (returning user): checked, no other fix. A "What's new" note after an update is a feature, opened as an issue.
- `[KNOWN GAP]` Simulator on Linux only; not checked on a real Mac or Windows machine, or with a screen reader. Three drivers fail on `main` before this pass (shots-021, shots-024, shots-024-custom; their committed screenshots were reviewed instead).

### 2026-10-21: the question card shows all its text; Enter sends a custom answer (FR-160, FR-161)
Owner request (Vikram, 2026-10-21): "Some text is truncated, show always all text" and "When a custom answer is entered, no need to click on answer if I enter inside that text box". Cause of the cut (read): the adapters cut an agent's question to 300 characters, an option label to 80 and its description to 200 (`src/adapters/questions.ts`, ending in "…"); an MCP elicitation's message to 500 (`src/shared/elicit.ts` and again in the renderer), a field title to 120 and its help to 300. The option's description was only in the tooltip, and the custom answer was a one-line input (a long answer scrolled out of sight).
- **FR-160** **All the text of the question card** `[IMPLEMENTED]`
  - The question text, every option label and every option description are shown in full in the card: they wrap (no ellipsis, `line-clamp`, `nowrap` or hidden overflow on them), at 11px and up (the 10.5px floor), and the card has no height cap; the chat scrolls.
  - An option's description is shown under its label inside the option button (smaller, muted). The tooltip keeps "label — description".
  - The adapters still bound the text (the renderer and the event log never get unbounded strings), but far above what agents send: question 2,000 characters, label 300, description 1,000 (Claude Code, Codex and Copilot share `parseQuestions`); MCP elicitation message 2,000, field title 300, field help 1,000. The header tag stays 40 (Claude's own limit is 12).
  - The custom ("Other") answer is a text box that grows with its text (up to 500 characters, as before), on its own line, so a long answer stays readable.
  - Previews elsewhere stay one block of text with the full text reachable: the Needs-you row shows the question in full (FR-140); the answer bar scrolls (`max-height` with `overflow:auto`), and for a request over 480 characters it says "read it in the chat", now with the full text as its tooltip.
- **FR-161** **Enter sends a custom answer** `[IMPLEMENTED]`
  - Typing in a question's custom box chooses it: for a single-choice question the option buttons are unchosen (as before) and the box gets the chosen ring; for a multiple-choice question the typed answer is added to the chosen options.
  - Enter in the box sends the card, exactly as the Answer button does (with several questions, an unanswered one gets the focus and the same toast). Shift+Enter adds a line (the agent still gets one line: answers are joined into one line, as before). Enter while an input method is composing does nothing.
  - Enter in an empty box sends nothing; it says "Type an answer first, or choose an option and press Answer" to screen readers and does not insert a line.
  - Screen readers: the box keeps its label ("Other answer: <question>") and is described by a hidden hint "Enter sends this answer. Shift+Enter adds a line."; `aria-keyshortcuts="Enter"`.
  - `sim:` `npm run check:question-options` (1440x900 and 1280x800, Expert and Simple): a 1,117-character question, a 284-character label and a 501-character description are in full (and the check fails when the Enter handler is removed or the description gets a two-line clamp: mutation runs) with no overflow, the description is visible in its button, Enter in an empty box sends nothing, typing chooses the box, and Enter sends the typed answer (the card settles as answered with that text). Screenshots refreshed: `docs/screenshots/052-question-options-*.png`, new `052-question-custom-1440x900.png` and `-1280x800.png` (a typed custom answer, chosen). `test:` `test-claude-adapter` checks the new bounds.
  - `[KNOWN GAP]` Simulator on Linux only; not tried with a real agent question, on a real Mac or Windows machine, or with a screen reader.

### 2026-10-21: a waiting question is always in sight; compactions fold into one line (FR-162, FR-163)
Owner report (Vikram, 2026-10-21): "I had a question waiting for me but I did not see it just above the chat window. I saw the agent was waiting but only saw the question after I scrolled up many pages; there were many 'compacting the context…' messages below it." Cause (`sim:` `simquestion=compact` on `main` before this change, `read:` `onCompaction`): every compaction left its own lines in the chat, and when the chat was not open (its element not in the page) the `isConnected` check failed, so each compaction left a "Compacting the context…" line *and* a "Context compacted" line; six compactions pushed the card about 1,400 px up. The answer bar (FR-001) did show "Ada asks: …" in the simulator, but for a question it only offered **Answer in chat**, so the answer still meant scrolling away from the composer. Existing capabilities reused: the answer bar (`wireAnswerBar`, FR-001/FR-016/FR-060) and the question card's own controls (`showQuestion`, FR-160/FR-161); no new component. There is no separate "jump to the bottom" control in the chat; the bar's **Show question** is that jump for a question.
- **FR-162** **A waiting question stays visible without scrolling** `[IMPLEMENTED]`
  - While a question waits and its card is not in view (less than 60% of it inside the chat, as for every request in FR-001), the answer bar above the composer shows it: "<agent> asks:", the header tag, the question text.
  - A short question (one question, one choice, at most four options, each label at most 40 characters, not an MCP form or page, text at most 480 characters) is answered in the bar: one button per option, an "Other answer" box (Enter sends, same rules as FR-161: empty Enter sends nothing and says so) and Skip. They press the card's own controls (option, Other box, Answer, Skip), so sending, validation and settling stay in one code path. Anything else gets **Answer in chat**, as before. Every question gets **Show question** (scrolls to the card and focuses its first option); permissions keep **Show in chat**.
  - The bar is not rebuilt while the same request, count and words are shown, so what you type in its box and its focus survive other changes in the chat. If it is rebuilt with focus inside, the focus moves to the bar's first control.
  - A card with no height (inside something folded or hidden) counts as out of view, so the bar shows it; the bar also rechecks when the window is resized.
  - Keyboard: every control of the bar is a normal button or text box in the tab order; option buttons keep the card option's title (label and description). Alt+A/S/D and Esc are unchanged (Esc still closes the chat, as from the card's box).
- **FR-163** **Repeated status lines fold into one** `[IMPLEMENTED]`
  - Compactions in a row (nothing else added to the chat in between) are one line that updates in place: one compaction reads as before ("Context compacted (automatic): 253k → 54k tokens."); more read "Context compacted 6 times · last 10:21: 253k → 68k tokens.", "… · compacting again…" while the next runs, "… · the next one failed: …" on a failure. Its tooltip lists each compaction with its time (last 40).
  - The line is found by its place in the chat, not with `isConnected`, so a chat that is not open no longer keeps a "Compacting the context…" line behind; a compaction that started on a line ends on that line even if something was added below it.
  - Any other status line (`addInfoNote`, such as a model change) that repeats right after itself becomes one line with "(×N)".
  - `test:` `test-modelswitch` (`compactionFoldText`). `sim:` `npm run check:question-visible` (1440x900 and 1280x800, `simquestion=compact`: one question, then six compactions while it waits): the six compactions are one line with the count and a six-entry tooltip, no "Compacting…" line is left; at the bottom and scrolled to the top the question is visible (card in view or bar); scrolled up the bar has Sage, Blue, a labelled Other box, Skip and Show question, all inside the window; Show question focuses an option in the card; text typed in the bar survives a change in the chat; Enter in the bar's box and (after a reload) a bar option answer the card and the bar goes away. Mutation runs: without the fold, and without the short-question controls, the check fails. Screenshots: `docs/screenshots/052-question-bar-1440x900.png`, `-1280x800.png`.
  - `[KNOWN GAP]` Simulator on Linux only; not tried with a real agent's question during real compactions, on a real Mac or Windows machine, or with a screen reader. The owner's exact sequence (which agent app, whether the bar showed) is not known; the fix covers the cause found in the simulator and makes the bar answerable.



### 2026-10-21: + Folder and + Workspace at the left, and a File menu (FR-164)

Owner request (Vikram, 2026-10-21): "I was struggling to find +folder and +workspace button right now as it is in the center of the bar, apps generally have it in the left and also in file menu". Round 11 (FR-105) had put both add actions behind one **+ New** menu; on a wide window the whole control cluster sits towards the middle of the bar, and the two words were not visible until the menu opened. Existing capability reused: the two buttons keep their ids (`addFolder`, `addWs`) and their one handler (`addVia(bridge.addFolder)`, `addVia(bridge.addWorkspaceFile)`, IPC `agents:addFolder` / `agents:addWorkspaceFile`); the menu reuses the FR-083 pattern of Settings… (`toRenderer('menu:settings')` → `onMenuSettings`).

- **FR-164** `[IMPLEMENTED]` **+ Folder and + Workspace, first in the top bar and in a File menu.**
  - The top bar starts, right after the brand, with two labelled buttons **+ Folder** and **+ Workspace** (Simple shows + Folder only, as before). They are the first controls of the bar in tab order and keep the control height and 12.5px text. The **+ New** menu of FR-105 is gone; the palette's Add folder / Add VS Code workspace show their keys.
  - **macOS:** a **File** menu between the app menu and Edit: **Add Folder…** (⌘O), **Add VS Code Workspace…** (⇧⌘O), a separator, **Close Window** (⌘W, the `close` role; with FR-085 it hides the window and the agents keep running). Quit stays in the app menu, where a Mac app has it. Each item sends `menu:add` with `folder` or `workspace`; the preload passes only those two words, and the page presses the same top-bar button (one code path, also from an open chat and in Simple).
  - **Windows and Linux:** still no menu bar (FR-083: no Reload or DevTools for users; the window's own close button and Alt+F4 close it). **Ctrl+O** and **Ctrl+Shift+O** are handled in the page and press the same buttons (not under a modal dialog). On a Mac the page leaves ⌘O to the menu. The keys were free: the app uses Ctrl+K, Ctrl+`, Ctrl+Shift+A, Ctrl+Shift+N and ⌘, (FR-035, FR-042, FR-083, FR-091). The shortcut sheet lists both.
  - **Fit (amends FR-105):** the two buttons are about 115px wider than + New. Measured in Electron on the simulator with floors and several agent apps, in DejaVu Sans (CI's font), Expert and Simple, at 1280, 1366, 1440, 1512, 1600, 1680, 1728, 1800, 1920 and 2040px: the counters keep their words from 1920px (was 1800) and are 2px narrower each below that; the defaults chip is capped at 170px below 1800, and shows only the mode word below 1600 ("Read-only", at most 130px; the rest is in its title, label and popover); the folder filter is 104px below 1600. Where the row still wraps (a wide theme font, the Mac traffic lights), the brand name moves to screen readers only by measurement (`fitTopbar`, class `tb-tight`; the mark and the Live/Demo pill stay). On a Mac (forced `data-platform="darwin"`), the counters keep their words from 2040px and the chip is 140px from 1600 to 1799px.
  - test: `test-macos` (the File menu, its keys and order, its clicks, no duplicate accelerators, Quit not in File; the wiring in main, preload, the simulator bridge and app.js). sim: `scripts/shots-052-addleft.js` (in `npm run check:ui`): at 1440x900 and 1280x800, Expert and Simple, all six built-in themes, with floors and mixed agent apps: the add buttons are leftmost after the brand and first in tab order, labelled, at least 10.5px, the bar is one row with no overlap or overflow; then the real template as the application menu: File > Add Folder… adds a room, File > Add VS Code Workspace… presses + Workspace, Ctrl+O adds a room and Ctrl+Shift+O presses + Workspace; on Linux `Menu.getApplicationMenu()` is null. Run in Noto Sans and in DejaVu Sans. `check:office`, `check:geometry`, `check:mac-titlebar`. Screenshots `docs/screenshots/052-add-left-*.png`.
  - `[KNOWN GAP]` Not run on a real Mac or Windows PC: the File menu, ⌘O and Close Window are checked from the template and in the Linux simulator only. With the Mac room forced at 1280x800, Expert, in DejaVu Sans the bar still wraps to two rows (it did before this change too; in Noto Sans it fits with about 44px to spare; SF on a real Mac is narrower than both). File > Add VS Code Workspace… in Simple opens the picker although Simple hides the button (the menu is the same on every level).

### 2026-10-21: help and UI text pass: wrapping, box widths, tooltips (FR-165..FR-171)

Owner request (Ruben, 2026-10-21, issue #464): text that breaks badly (cut, overflowing, split words), boxes far bigger than their text, and a result that is "not quite pretty yet", in the shortcut sheet, About agent apps, tooltips, notices and the explanations inside dialogs and panels. Decided by the coordinator under Ruben's delegation. The audit (`sim:`, 63 surfaces × 2 sizes × 3 themes plus a long-names pass, measured in the page and read by eye) found no word split mid-word in the shipped wording at either size, but it found what makes it look broken: a dialog that scrolls sideways and cuts its rows (Send to several), a Tools table that does the same with long names, text under 10.5px (Previous sessions), help paragraphs at 11px with a narrower measure than the text above them, bold values in dialog fields, menu hints that wrap to one orphan word, eight hard-coded white surfaces that are unreadable in a dark theme, ten dialog and menu widths with no rule, and static tooltips of up to 274 characters. `overflow-wrap:anywhere` is on prose in 16 rules (`styles.css` and `screens.css`); it splits words as soon as a flex or grid parent squeezes a box (its min-content becomes one letter), so it is the cause waiting to happen. Existing capabilities reused: the type and spacing tokens (FR-098, `docs/design-rules.md`), `askDialog` (`dialog.js`) and `screens.js` `dialog()`, the driver helpers (spec 008 FR-096/097), `check:ui`.

- **Status (2026-10-21, first half, T143-T149, T152):** built and checked by `check:ui-text` in the simulator: FR-165 except the menu hints, FR-166, FR-167 except the menu width and the popover padding, FR-169. Still planned: menu hints and `--menu-w` (T150), tooltips (T151, FR-168), the wording and long-name rules of FR-170 (T153-T155). `[KNOWN GAP]` the install and update dialogs, the import list and the hand-off review are not opened by the check. The contrast of the FR-169 controls is also checked in every built-in theme (Clean Office, Corporate, Retro Pixel, the three courts; 1280x800). A literal light background (hex, named colour, rgb()/hsl(), gradient) in any stylesheet of `src/renderer` fails the check unless it is in `scripts/fixtures/ui-text-light-allow.json` (45 older rules that are not in T152 and may read badly in a dark theme: `[KNOWN GAP]`, to be moved to tokens). In the dark fixture the text of every visible element of every surface is checked at 4.5:1, so a bright box from a rule or an inline `style=` is found too; 19 older cases (primary buttons, `.scr-warn`, `.mtag.warn`, the MCP lists, the chat's inline `code` and sub-agent blocks, the previous-sessions search box) are listed under `text` in the same file (`[KNOWN GAP]`); older cases matched by a cause (`.md code`, `.subblk`) are listed under `textSel`. `[KNOWN GAP]` The biggest of the 19 `text` entries is `.btn.primary` (white on `--sage-ink`: 2.18:1 in the dark fixture, `.btn.primary.danger` 3.40:1); they are fixed in PR 2. The folder-setup dialog (spec 061, `simfoldersetup=1`) is a surface of the check; its allow and deny tags are tested in all six built-in themes and the dark fixture. The `overflow-wrap:anywhere` mutation is a constructed case (`width:min-content` on `.dlg .dsub`): no shipped surface has a prose box in a narrow flex parent. The toast and the dialog list with a long path are built by the check in the way the app builds them (`toast()` is private to `app.js`).
- **FR-165** **Help text wraps between words** (planned; becomes `[IMPLEMENTED]` with its tasks)
  - Prose (dialog bodies, Settings notes and "More" text, menu hints, notices, toasts, inbox and answer-bar text, the shortcut sheet) wraps with `overflow-wrap: break-word` and `word-break: normal`, never `overflow-wrap: anywhere`, `word-break: break-all` or `hyphens: auto`. A word moves to the next line whole; only a word longer than its whole line may break.
  - `anywhere` / `break-all` stay only on machine text: `code`, `pre`, `kbd`, paths, URLs, commands and diffs (`.srv-cmd`, `.trustcmd`, `.hs-log`, `.hs-where code`, `.pdiff .dl`, `.q-url`, `.q-host`, `.signin-details pre`).
  - A compound with a hyphen inside quotes (for example "a night-shift newsroom") is kept on one line (`white-space: nowrap` on the quoted example, or a non-breaking hyphen).
  - Help text uses one measure: `max-width: var(--measure)` (`560px`, about 72ch of 13px), whatever its own font size, so the "More" text and the line above it end at the same place.
  - Menu hints (`.more-it .mt small`, `.mode-menu small`) fit on one line at both sizes, or wrap into two balanced lines (`text-wrap: pretty`); a last line of one word is a failure.
- **FR-166** **Size of help text** (planned; becomes `[IMPLEMENTED]` with its tasks)
  - Help paragraphs of more than one line are T4 (12px) at least; T5 (11px) only for a one-line hint, a count or a tag. Nothing under 10.5px anywhere, including the browser's own `small` (`font-size: smaller`), which must always get an explicit size.
  - Fixes: `.prev-h small` (10px today), `.scr-note.small` paragraphs (11px), `.dlg .dsub.small` paragraphs, the field notes under inputs in dialogs.
- **FR-167** **Dialog, popover and menu widths** (planned; becomes `[IMPLEMENTED]` with its tasks)
  - Dialogs have one of three widths, as tokens: **S** `--dlg-w-s: 420px` (a confirmation: title, at most 5 lines of body, buttons), **M** `--dlg-w-m: 560px` (a form, a list of choices, or a body over 5 lines at S), **L** `--dlg-w-l: 760px` (two columns or a table: the shortcut sheet, Needs you, the import list, the hand-off review). Each is `min(W, 100vw - 32px)`, `max-height: calc(100vh - 48px)`.
  - A dialog's body scrolls vertically only. Nothing in a dialog, popover or menu is wider than its box (`scrollWidth <= clientWidth`); a row truncates its label with an ellipsis and a `title`, and a note goes under the label or shrinks.
  - All dialogs use `--dlg-pad` and `--dlg-gap` (the inbox's own `14px 16px` goes); a field's label and its control are 4px apart; groups of fields are `--dlg-gap` apart (the schedule dialog's "Prompt" label touches the select above it today).
  - Popovers (Defaults, Folders, Floors, Allowed grants) size to their content up to `min(660px, 100vw - 28px)`, padding `12px 14px`; their help line sits on its own line under the title.
  - Menus share one width token `--menu-w: 320px` (the top ⋯ menu is 220px today, chat More 334, mode/folder/session menus 360, model menus 340) and one padding (6px).
  - Values typed or chosen in dialog fields are regular weight (400): inputs, selects, number fields and textareas inside a bold `label` do not inherit its weight; placeholders too.
- **FR-168** **Tooltips** (planned; becomes `[IMPLEMENTED]` with its tasks)
  - A static tooltip that explains a control is at most 120 characters (one or two short sentences). Longer help goes on screen (a hint line or the section's "More") and the tooltip is cut down to what the control does.
  - A data tooltip (the full text of a cut name, path, task or status, or a breakdown of totals) may be longer, but at most 300 characters or 8 short lines.
  - Every ellipsis in chrome has the full text in a `title` or right next to it (today: the agent app card name in Settings, the Send to several rows).
  - No help lives only in a tooltip on something that is not focusable (the theme maker's bullet list has a 247-character `title`).
- **FR-169** **Dark themes: no literal light surfaces** (planned; becomes `[IMPLEMENTED]` with its tasks)
  - Controls and surfaces that carry text use theme tokens, never a literal light colour: the pressed Tools/Settings segment, the selected tab of the Tools screen, the selected theme card, the Settings spending-limit field, the Places selects, the place-icon options, the chat header's context and limit chips, the agent strip's error card; the switch knob stays white (no text). With a dark user theme (spec 040 FR-017) their text is readable (4.5:1).
- **FR-170** **Wording that fits** (planned; becomes `[IMPLEMENTED]` with its tasks)
  - A field label is one short line; anything more is a hint under the field (New session and hand-off: "Spending limit ($, Claude's estimate). Leave empty for none." becomes the label "Spending limit" and the hint "Claude's estimate, in dollars. Empty means no limit."). Compact: "Focus (optional)" with the hint "What the summary should keep".
  - A dialog body over 8 lines at its width is split: the first paragraph says what happens, the rest goes into a list or a "More" (Spending limit for <agent>: 7 lines today).
  - The shortcut sheet aligns its description column across its tables (one key-column width per column of the sheet).
  - Long names (60 characters, the maximum of spec 059) never widen a table, a heading or a list past its box: Tools > Models and context, Needs you, the list view, the palette, Send to several.
  - In the chat, the streaming caret follows the text, the Copy button never covers text, and a toast never covers the composer.
- **FR-171** **A check that keeps it fixed** (planned; becomes `[IMPLEMENTED]` with its tasks)
  - `scripts/check-ui-text.js` (in `npm run check:ui`, `npm run check:ui-text`): opens every surface listed in FR-165..FR-170 in the simulator at 1440x900 and 1280x800, in Clean Office and in a dark fixture theme (`scripts/fixtures/themes/dark-audit.json`), and asserts on each:
    - no visible text under 10.5px (computed);
    - no word of four letters or more split across two lines in prose (a `Range` per word; code and paths excluded; a break after `-`, `/` or `·` allowed);
    - no clipped text (`overflow` hidden or clip with `scrollWidth > clientWidth` or `scrollHeight > clientHeight`), except an ellipsis that has a `title`;
    - no horizontal scroll inside a dialog, popover or menu, and every box inside the window;
    - every dialog's width is one of the three tokens (or the window minus 32px) and uses the padding tokens;
    - field values in dialogs have `font-weight` 400 or 500;
    - no menu hint whose last line is one word;
    - static tooltips at most 120 characters (data tooltips, matched by class, at most 300);
    - in the dark fixture, contrast of at least 4.5:1 for the text of the controls in FR-169.
  - Mutation runs (each must fail the check): put `overflow-wrap:anywhere` back on `.dlg .dsub` with a narrow flex parent, remove the explicit size of `.prev-h small`, remove `.dlg .dpicks{min-width:0}` with the dialog back at S width (the real cause of the Send to several scroll was the fieldset's default `min-width: min-content`), set one dialog to 500px, restore one `background:#fff`.
  - `[KNOWN GAP]` Native tooltips are drawn by the OS: their length is checked, their look is not. macOS and Windows fonts (SF, Segoe) wrap differently from the Linux fonts the check runs in (DejaVu Sans, Noto Sans); not run there.
