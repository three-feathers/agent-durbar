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
