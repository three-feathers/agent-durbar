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
  - **Last activity:** each agent keeps the time its last event arrived (`a.lastEventAt`, set in `onLiveEvent`; a helper's event counts for its main agent). Desk cards add "Last activity 2 min ago" to their tooltip, the list has a **Last activity** column ("just now", "2m", "3h", "2d") and the chat header shows "active 2m ago" next to the status. Before the first event nothing is shown. The labels repaint through the normal render: a 30 s tick schedules one render only when a label changed; no faster timer. Labels: `DurbarActivity.agoLong` / `agoShort` (`src/renderer/activity.js`).
- **FR-063** **Readable tool calls and edit requests** [IMPLEMENTED] `test: test-activity` (diff builder, diff lines, the broker passes the diff), `test: test-claude-adapter` (Edit, MultiEdit, Write); read: the code.
  - An open tool-call chip shows the **whole** command or argument (as written, line breaks kept, up to 20000 characters) in monospace, wrapped, with **Copy**; the closed chip keeps its one-line summary. A click inside the open part (Copy, Show all, selecting text) does not fold it.
  - Output: up to **20000 characters** (was 2000) in a scrollable block (max 320px tall), and **Show all (N characters)** for the rest (kept in memory up to 1,000,000 characters). The chip says "Done · took 1.2 s" or "Failed · took …", the time between the call's start and end events. No normalized event carries an exit code, so none is shown. A tool `update` event with output now keeps the chip running instead of marking it done.
  - **Diffs:** `PermissionInfo` gets an optional `diff?: string` (unified-diff text, at most 20000 characters, display only; `src/adapters/types.ts`), passed by the permission broker on the **pending** request only. A pending permission card with a diff shows a collapsed **Show the change (+n −m)** block: `+` lines green, `-` lines red, hunk and file lines muted, monospace, max 320px tall, at most 400 lines and then "… N more lines not shown"; the Needs you inbox row shows the same block, collapsed. Text only (`textContent`), never applied or run. The diff is not part of the request's summary text, so it never reaches a notification, an announcement or the "long request" rule.
  - **Who fills it:** the **Claude Code** adapter, from the tool input of `Edit` (`old_string` → `new_string`), `MultiEdit` (each edit) and `Write` (every line added; Durbar does not read the file to compare), through `editDiffOf` and `simpleDiff` (`src/shared/diff.ts`: common lines at the start and end kept as up to 3 lines of context, the rest shown as removed then added; not a full diff algorithm). The **simulator** fills it for Jonas's edit request. **Copilot and Codex do not fill it** [KNOWN GAP]: their permission requests carry no edit text in Durbar's normalized events today (Codex's `fileChange` approval could, not done).
- **FR-064** **A denser, sortable list** [IMPLEMENTED] `test: test-activity` (sort); read: the code; `sim:` `scripts/shots-052-ux.js` (rows, columns, sort, J/K; not run in this change).
  - Rows are **34px** (were 44px), the header too. Columns: Agent (with the Allow all badge, FR-065), **Agent app** (Copilot / Claude Code / Codex, empty in the demo), Role, Folder, Current task (mood words first, spec 034), **Last activity**, **Cost** (the card's money words: ≈ $ from AIU, Claude's `$… est.`, or tokens for an agent app with no price), Status (the pill, Failing included).
  - Clicking a column header sorts by it: ascending, then descending; the header carries `aria-sort` and an arrow, and keeps focus after the repaint. The sort lives in memory only (not saved). Missing values sort last both ways; a helper stays under its main agent. Unsorted, the list keeps its old order (waiting and errors first).
  - **J / K** (and ↓ / ↑) move between rows when a row or a header has focus; **Enter** opens the chat (the row is a button). No clash: the inbox's J/K is handled inside its dialog. The keyboard shortcut sheet has a section "In the list view".
  - In Simple, the Folder column is hidden with `visibility` so the other cells stay under their headers (before, `display:none` moved them). The list scrolls inside `#list`; 15 agents fit at 1440x900 (34px rows). No narrow-width reflow existed for the list; none added.
- **FR-065** **Allow all on every card** [IMPLEMENTED] read: the code; `sim:` `scripts/shots-052-ux.js` (badge count and bounds; not run in this change).
  - A main agent in Allow all shows a small red **Allow all** text badge (10.5px, the error pill's background and red ink, 15px tall like the icon) in the mode icon's slot on its card, list row and full desk; Read-only and Ask first keep their icons. In the mini and micro densities the name's maximum width leaves room for the badge and a short status (the name still shows at least 3 characters, FR-025). The card's size does not change. The chat header's mode chip says Allow all in the same red (was amber, which is the waiting colour). The restore strip is unchanged.
  - [KNOWN GAP] The office check (`check-office-overlap.js`, text overflow at 1280x800) was not run in this change.
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
