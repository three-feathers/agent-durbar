# Feature Specification: Brain view

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Brain view (owner request, Vikram 2026-11-05/06): a transparent point-cloud brain and a ring of seven tool glyphs per agent, docked in the chat's right rail above Your door, In front on request, in the office beside people who need you; loop warning with Look and Stop, turn map, habits, stale-read alert, screen share, masking and accessibility contract
status: building
note: spec, plan, tasks, 8 mockup stills; Q1..Q4 decided 2026-11-06 (constitution 1.2.0); P1 G1 built (state reducer, loop rule, surface formatters; no UI yet)
-->

**Feature Branch**: `106-brain-view` (spec, plan and tasks only). The build is one small PR per task group, phases P1 to P4.
**Created**: 2026-11-06
**Status**: Building (2026-11-06: the owner answered Q1..Q4; P1 G1 landed the pure state and surface modules, no UI yet). No dependency is added.
**Input**: Owner requests and decisions (Vikram, Telegram, quoted with their dates), settled through 14 rounds of mockups with him:

- **2026-11-05 19:40**: "can we have a mode where we can see everything what's happening with a visual workflow of how did the session run, which tool got called... a visual floating window which shows what the brain is doing... futuristic... adaptable to different worlds".
- **2026-11-05 19:48**: show it automatically in the chat when idle; in the office, brains near the people; "we should not heavily impact performance".
- **2026-11-05 20:02**: idle moods over time: relieved, wants attention until read, bored, sleep, hibernation.
- **2026-11-06**: transparent, no shadow; the arcade as inspiration, not a copy; one branch at a time, with details.
- **2026-11-06 06:31 and 07:12**: in the chat, the brain in front of the chat was preferred; **08:34 "2"**: docked beside the chat by default, with *In front* as an option. **08:35 to 08:36**: rails on both sides: the Agents rail on the left, Your door on the right (spec 005).
- **2026-11-06 07:12**: "Looks good in terms of visualization". **07:44**: aim close to 10/10, checked with rotating personas. **10:06**: focus on readability and accessibility.
- **2026-11-06 12:02 "1"**: insights are **habits (b)** as the picture, with **the day view (a)'s table and turn strip as its text equivalent**; **compare (c)** becomes a Your door **"stale read"** alert. Start the spec.
- **2026-11-06 12:17 UTC "2"** (Q1): "yes, and change the constitution to allow canvas where CSS can't do the job". **12:46 UTC "1"** (Q2): Brain view on by default, docked beside the chat. **12:49 UTC "2"** (Q3): while screen share is on, the message box works and shows the typed text normally; it is the person's own text. **12:50 UTC "1"** (Q4): with Brain view on, the right rail (Brain on top, Your door below) opens with every chat, and the person can still collapse it.

**Persona panel (simulated, not real users).** Each mockup round was scored by a panel of simulated personas (an agent playing them, not people), plus rotating guests. The fixed core panel's averages for wow / space-age / original / useful went from **6.6 / 5.75 / 5.75 / 6.75 in round 6 to 8.9 / 7.8 / 8.3 / 8.9 in round 14**. These numbers are a design aid only; they prove nothing about real users (`[KNOWN GAP]`, FR-133).

## Mockups (not product screenshots)

The pictures in [`mockups/`](mockups/) are **stills of the round 14 HTML mockups**, made outside the app with invented agents, folders, files, costs and text. They are not screenshots of Agent Durbar, the layout numbers in them are targets, and the magenta caption bar at the foot of each is a mockup note, not UI.

| Still | Shows |
|---|---|
| [01-docked-chat](mockups/01-docked-chat.webp) | The default: the brain docked at the top of the right rail, Your door under it, the Agents rail on the left (US1, FR-030) |
| [02-legend](mockups/02-legend.webp) | The legend open inside the dock: "A picture of tools, not a real brain" (FR-014) |
| [03-office-brains](mockups/03-office-brains.webp) | Real office: brains only beside people who need you or are hovered, a "looping?" chip on a desk card (FR-034, FR-043) |
| [04-loop-stop-review](mockups/04-loop-stop-review.webp) | A loop in Your door with *Look* and *Stop…*, and the Stop confirmation with *Review changes* (FR-044..FR-046) |
| [05-turn-map](mockups/05-turn-map.webp) | The turn map: numbered badges on the ring, the text list beside it, *Export* (FR-050..FR-052) |
| [06-habits](mockups/06-habits.webp) | Habits (b): lobes by use, the table beside it (FR-070..FR-072). Its sentence "ask it to read first" breaks FR-073 and is not product text |
| [07-stale-read-compare](mockups/07-stale-read-compare.webp) | Compare (c), the source of the stale-read alert (FR-075) |
| [08-retro-arcade](mockups/08-retro-arcade.webp) | The Retro arcade skin: a voxel brain and the world's own font (FR-110) |

## Summary

A person running many agents sees statuses and tool rows, but not the shape of a turn: what the agent is doing now, why, what it did before, and whether it is going round in circles. **Brain view** draws each agent's activity as a transparent point-cloud brain inside a ring of seven tool glyphs: a tool call lights its glyph and the lobe it belongs to, and a trail grows from lobe to lobe through the turn. Beside it, a card says the action, why, and a short preview, masked; one sentence says it in words. It is docked in the chat's right rail by default, can come *In front* of the chat, and appears in the office only beside people who need you. It reads the events the app already has: **it sends nothing to an agent and spends no AI credits.** The brain is a picture of tool use, **not a real brain**, and says so.

## Context: what exists today (spec 021 FR-031, reuse first)

- **Events**: the adapters' normalized `AgentEvent`s reach the window on the existing `agent:event` push (`onEvent` in the preload): `toolCall` (`start`, `update`, `complete`, `failed`, with `tool`, `args`, `output`, `mcpServer`, `edit: EditInfo`), `thinking`, `output`, `permission`, `status`, `usage`, `subagent`, `limit`. No new channel is needed to read them.
- **Live activity** (`src/renderer/liveact.js`, spec 001 FR-028..FR-031): one masked readout per agent built from these events, repainted at most 4 times a second. **Brain view extends this path; it does not build a second one.**
- **Masking** (`src/shared/redact.ts`, specs 012 and 041): `redact`, `maskSecretCommand`, `maskSecretArgs`, `maskSecretUrl`, `maskHomePaths`, `maskTokenShapes`, `cut`.
- **Counts** (`toolstats.js`, spec 019): tool counts per agent, `toolKey` (MCP grouped by server). **Moods** (`mood.js`, spec 034): `DIZZY_STREAK`, `IMPATIENT_MS`, `DAY_MS`. **Asleep** is spec 097 FR-041's lamp-off rule (stopped, or finished over 10 minutes ago; `RECENT_MS` in `shutters.js`).
- **Rails** (spec 005 FR-190..FR-202): the Agents rail on the left (220 px); Your door on the right, 360 px, pushing the chat (spec 052 FR-216); both collapse and keep their state (005 FR-196).
- **Stop** is the composer's existing Stop (005 FR-200) through the adapter's optional `interrupt`. **Edits of a turn** are `EditInfo` (005 FR-018..FR-025, `editview.js`), shown in the existing diff rows; spec 065 owns undo (`checkpoints.js`).
- **Motion**: the OS reduced-motion setting; *Still highlights (no motion)* (001 FR-192); Serious mode (spec 034, 052 FR-069). **Keys**: Settings > Keyboard records and checks shortcuts (074 FR-013, FR-014, FR-017). **Live region**: `#srAnnounce` (polite) and `#toasts`. **Settings**: `setting()` in main (`settings.ts`), as Serious mode and Still highlights. **Save**: main's own save dialog, never a path from the window (spec 083 FR-048, `notesexport.ts`).

## User scenarios

- **US1 (P1) See what the open chat's agent is doing.** *Given* a chat open on Ada while she runs tests, *Then* the right rail shows Ada's brain at its top: the Shell glyph and its lobe lit, a card "Shell · running · 1.4 s / `npm run test -- --run` / Why: prove the move broke nothing", and the sentence "Ada is running tests". Your door's items stay under it with their count visible. *When* the turn ends, *Then* the lobes it used swell once and settle.
- **US2 (P1) Read it without the picture.** *Given* a screen reader, *Then* the dock is a named region with the lobe as text ("Shell, cerebellum"), the latest steps as a list, and the sentence announced politely only after the chat's own announcement. *Given* keyboard only, *Then* Ctrl+Shift+B (⌘⇧B) moves focus to the dock and Tab reaches every control with a visible ring.
- **US3 (P1) Calm or still.** *Given* Settings > Brain motion *Calm*, *Then* no bloom, glow or sparks, thin bursts. *Given* *Still*, or the OS reduced motion, or *Still highlights*, *Then* nothing moves: lit glyphs and lobes change in one step.
- **US4 (P2) See who needs me in the office.** *Given* the Real office with 15 agents, Jonas waiting and Mira looping, *Then* Jonas and Mira have a brain beside their own person, nobody else does, until I hover or focus another person. With a fourth person in need, *Then* that person gets a small named orb, not a brain.
- **US5 (P2) Catch a loop.** *Given* Sven alternates Edit and Shell and the tests keep failing, *Then* his brain, desk card, rail row and Your door say "looping? Edit ↔ Shell · 3 times · ≈ $0.08". *When* I press *Look*, *Then* the chat opens at the loop's first step, with focus on it. *When* I press *Stop…*, *Then* a confirmation lists the files changed this turn with +/− counts, *Review changes* opens the existing diff, focus starts on *Cancel*, and *Stop turn* interrupts the turn and keeps the files.
- **US6 (P3) Look closer, then share.** *When* I press *In front*, *Then* the brain wipes in over the chat in 200 ms with no ghost frame, a mini-brain stays in the dock, and Esc returns. *When* I open the turn map and tap badge 3, *Then* step 3's glyph, lobe and row light. *When* I export, *Then* I get a PNG and a text file with paths shortened and secrets masked. *When* I turn on *Screen share*, *Then* text is replaced by placeholders, never blurred, and approvals say "Stop sharing to answer".
- **US7 (P4) Habits.** *Given* Sven's session, *When* I open Habits, *Then* lobes are dense and bright by share of steps, a never-used lobe is a faint outline, and the day view's table says the same in text, describing counts and never diagnosing.
- **US8 (P4) Stale read.** *Given* Mira read `registry.ts` and ran her tests, and Ada changed `registry.ts` after Mira's read, before Mira's test run ended, *Then* Your door shows "Mira's tests ran before Ada changed registry.ts" with *Show both* and *Draft a re-read note*, and sending stays mine.

## Edge cases

No events yet (a new session: the brain rests, the card says "Waiting for the first step"); a tool name no glyph knows (MCP if `mcpServer` is set, else the Shell glyph worded "Other tool", FR-012); a burst of 50 tool calls in a second (coalesced, FR-004); a sub-agent's calls (shown under the parent, marked "helper", FR-007); a turn of 400 steps (trail capped, FR-040); a tool that never completes (the card ages to "running 3 min"); events arriving after the turn ended (late events join the ended turn's trail, never start a new one); a token in an argument, an Authorization header, a `user:pass@` URL, a home path, a cookie (FR-085); a window 1280x800 with Your door full; Your door collapsed (FR-031); the left rail narrow; a world without a skin (Flat's skin); the window hidden or unfocused (FR-104); forced colours; 200 % zoom; a right-to-left name; an adapter without `interrupt` (FR-046); the simulator (`DURBAR_SIM=15`).

## Requirements

### A. One state source

- **FR-001** **One event-driven source.** A pure reducer, `brainState(prev, event, now, mask)` (`mask`: `redact.ts`'s functions, passed in), takes the normalized events of one agent (tool start, update, complete, failed; thinking; reply; permission; status; usage; errors) and returns that agent's brain state: current step, lit glyph and lobe, the turn's trail, the card, the sentence, the loop flag, the mood, the counts. It lives in `src/shared`, has no DOM, no timers (time is passed in) and no vendor names (constitution II).
- **FR-002** **Everything reads the same state.** The brain, the card, the sentence, the office tag and orb, the desk card chip, the rail row, the Your door item and the chat transcript's highlight are views of FR-001's state. None keeps its own copy, so they can never disagree.
- **FR-003** **Strict order: burst, then card, then sentence.** For each new step the glyph's burst starts first, the card changes on the next frame at the earliest, and the sentence after the card. Under *Still* the three change in one frame, in that DOM order.
- **FR-004** **Coalescing.** At most 4 visible changes a second per agent, as `liveact.js` repaints (spec 001 FR-028..FR-031). Steps that start and end between two repaints still join the trail and the counts; only the newest is drawn as the burst.
- **FR-005** **Turns.** A turn starts with the user's message (`user` event) or a scheduled prompt, and ends at the agent's final reply, an error, a stop, or a permission refusal that ends it. Late events of an ended turn join it (Edge cases).
- **FR-006** **Bounded memory.** Per agent: the current turn's steps (at most 400, then the oldest are folded into a count, "12 earlier"), the counts of the session, and the last 20 turns' summaries (for FR-071). Nothing is written to disk by Brain view, except the export the user asks for (FR-052).
- **FR-007** **Helpers.** A sub-agent's calls show in the parent's brain as dimmer steps marked "helper" on the card; a helper never gets its own brain in the office.
- **FR-008** **No sending, no credits.** Brain view only reads events. No control here sends a message, approves, or calls a tool by itself. *Stop turn* (FR-046) is the existing Stop, behind a confirmation. Spec 001's live activity and the chat keep working when Brain view is off.

### B. The picture

- **FR-010** **A point-cloud brain**, side view, drawn from precomputed point sets of about 2,500 (office), 6,000 (dock) and 10,000 (In front and turn map) points, transparent, **no shadow, no panel behind it in the office** (owner 2026-11-06). Lobes have soft edges: points thin out over a band at each lobe's border, never a hard line (a mockup fix).
- **FR-011** **The orbital ring of seven glyphs**, placed by the lobe they light:

  | Glyph | Word | Lobe | Place on the ring |
  |---|---|---|---|
  | ◇ | Think | front (frontal) | front |
  | ▤ | Read | back (occipital) | back |
  | ✎ | Edit | top (parietal) | top, floats above |
  | ›_ | Shell | cerebellum | back, low |
  | ◎ | Web | low side (temporal) | low side |
  | ⏚ | MCP | stem | bottom |
  | ● | You | front port | front, low |

  *Reply* is not a glyph: the reply is a calm glow from the front. The glyphs are drawn shapes, not emoji (constitution V), and each has its word beside it.
- **FR-012** **Tool to glyph** is one pure table in FR-001's module: a call with `mcpServer` is MCP; known built-in names (read, view, grep, glob, list; edit, write, create, patch; bash, shell, powershell, run; fetch, web search) map by name; thinking is Think; a permission request or a question to the user is You; anything else takes the Shell glyph and lobe, worded "Other tool: <name>", so the ring stays seven glyphs. Adapter names stay in adapters: the table reads normalized `tool` strings only, and a test lists every tool name the simulator and the adapters' fixtures produce.
- **FR-013** **One branch at a time, with details** (owner 2026-11-06): only the current step's glyph is lit and only its lobe bright; the trail shows earlier steps as thin lines from lobe to lobe. The current step's card is attached to its glyph.
- **FR-014** **Legend.** A *Legend* button opens, inside the dock's brain area, the title **"A picture of tools, not a real brain"**, each glyph with its word and lobe, and one line each for *looping?* and *bloom*. The dock's header and cost line stay; Your door does not move.
- **FR-015** **Cost line.** The dock header shows "≈ $0.04 this turn · $1.23 today" with a small sparkline of recent turns, from the app's existing usage estimate (spec 011, `usagetotals.js`) in the unit and with the "≈" the top bar uses: **one "≈ $X" = credits × `AIU_USD` + Claude's `costUsd`** (Copilot's `nanoAiu` at 1 credit = $0.01, `costtable.js`), under a cent "<$0.01"; its tooltip and accessible text name the parts as the header does ("≈ $0.07 = 4.20 AIU + $0.03 Claude (est.)"). Codex reports no cost: with nothing else known the cost says "cost unknown", never $0. A helper's usage is counted once, in its parent's turn.
- **FR-016** **Colours are not the message.** Each lobe has its own colour, and every state also has a shape and a word (constitution V): a lit glyph is filled and ringed; a failed step has a ✗ and the word "failed"; a loop has the chip "looping?". The colour-blind check (FR-096) proves it.

### C. Card and sentence

- **FR-020** **The card: action · why · preview.** Line 1: glyph, tool word, state ("running", "done", "failed") and duration. Line 2: the preview: the command, the file name, the query or the MCP tool, cut to fit. Line 3: "Why:" and the agent's own most recent stated reason (the last thinking or reply sentence before the call), cut to one line; with none, the line is absent, never invented.
- **FR-021** **Masked by the existing redaction.** Every text in the card, the sentence, the tag, the turn map and the export passes through `redact.ts`: commands through `maskSecretCommand`, arguments through `maskSecretArgs`, URLs through `maskSecretUrl`, paths through `maskHomePaths`, everything through `maskTokenShapes`. No new masking code; a gap found in a test is fixed in `redact.ts` for everyone. Masking happens in the state (FR-001), so no view ever holds unmasked text.
- **FR-022** **The sentence** is one plain line in the agent's name: "Ada is running tests", "Ada is reading registry.ts", "Ada is writing to you", "Ada needs your OK", "Ada may be looping between Edit and Shell". It is built from fixed phrases by the state, never from model text, so it is safe to announce (FR-091).
- **FR-023** **No leftover text during swaps** (a mockup fix): when the card changes, the old text is removed in the same frame the new text appears; no frame shows parts of both. The driver's audit (FR-098) samples frames during swaps, not only at rest.
- **FR-024** **Wrap-safe headers** (a mockup fix): the card's first line wraps to a second line rather than overlapping the glyph or the duration; the duration never cuts. Long file names cut in the middle with an ellipsis and keep the extension.
- **FR-025** **Latest steps.** Under the brain, "▸ 3 steps this turn · 12 earlier" opens the turn's steps as a list (glyph, word, preview, state), the text equivalent of the trail.

### D. Placements

- **FR-030** **Docked, the default** (owner 2026-11-06 08:34 "2"). While a chat is open, the brain of that chat's agent sits **at the top of the right rail, above Your door**, in the rail's 360 px width (052 FR-216), so the chat keeps the width the rails give it (860 px at 1440, 700 px at 1280, beside the Agents rail). The Agents rail stays on the left (owner 08:35 to 08:36, spec 005 FR-190).
- **FR-031** **The dock gives way to Your door.** While Your door has items, the dock is compact (about 230 px tall at 1440x900, the mockup's size); with Your door empty, it grows to fill the rail (to about 60 % of its height). **Your door's header and count stay visible in every state**, the legend's included. Collapsing the right rail (005 FR-196) hides the dock with it, and a small brain button in the chat header brings it back. **Amends 052 FR-216 for this one case** (Q4, owner 2026-11-06 12:50 UTC; 052's *Changes* 2026-11-06): with Brain view on, the right rail (the brain on top, Your door below) opens with every chat; with Brain view off, Your door opens on request as today. **005 FR-196's saved collapse state wins:** if the person collapsed the right rail, it stays collapsed when a chat opens, across chats and restarts (when `rememberOn()`), until they open it again.
- **FR-032** **In front, optional.** *In front* lays the brain over the chat's log area (never over the composer, the rails or a dialog) with a 200 ms wipe, and **no ghost frames**: no frame shows both the old and the new layout half drawn. A mini-brain stays in the dock as the way back. Esc, the *Back* button, or the shortcut again returns, and focus goes back where it was. Under *Still* the wipe is a cut. The choice of Docked or In front is a display preference of the window, saved like the navigator shortcut (074 FR-013).
- **FR-033** **Auto when idle** (owner 2026-11-05 19:48). The dock is the chat's resting picture: it is there whenever the chat is open and Brain view is on, also when the agent is idle, then showing its mood (FR-062). Nothing pops up over the user's work by itself: *In front* opens only on request.
- **FR-034** **Office brains, only where they help.** In the office, a brain appears **only beside the person of an agent that needs you** (waiting, error, limit, looping?) **or that is hovered or keyboard-focused**, beside its own person, never over another's face, name or desk card. **At most 3 at once**: needs-you first, oldest wait first (`attention.js`), then the hovered or focused one. Any other agent that needs you, or one whose slot would overlap something, gets a **compact named orb** (a small brain dot with the name) at its person. The placement uses the office's own layout boxes (Real office's person and plate rectangles; Flat's desk rectangles) and is one pure function with tests.
- **FR-035** **Office tag and popover.** A brain has an 11.5 px tag ("Ada thought it through · Think · done") and, on hover or focus, the existing hover card gains one line and *Show in chat*. **Both the tag and that line come from the office formatter** (FR-085's office row): glyph word, program name and state, for example "Shell · npm · running"; never the card's preview, its "Why:" text, a path or a URL. FR-086 checks the tag, the popover line and the orb's name as office cells.
- **FR-036** **Presenter layout.** For demos and talks, *In front* has a presenter form: the brain at the size of the chat area, text at least 16 px, the card and the sentence under it, and nothing else; it uses the same state and masking, and Screen share (FR-080) is on while it is open.
- **FR-037** **Fit.** 15 agents still fit 1440x900 and 1280x800 with Brain view on, with the chat closed and open, with no overlap, no clipped text and no office scroll (constitution V); a brain or orb never changes the office's layout.

### E. Turn trail and the loop rule

- **FR-040** **The trail** connects the lobes of the turn's steps in order, the newest brightest, at most the last 24 steps drawn (all counted, FR-006).
- **FR-041** **The loop rule.** A *step* is a completed or failed tool call whose glyph is Read, Edit, Shell, Web or MCP (an "Other tool" counts as Shell); Think and replies are not steps and do not break a run. **"looping?"** is set when either: (a) the last 4 steps alternate between the same two glyphs (A, B, A, B, with A ≠ B) **and the last of them failed**; or (b) the last steps alternate between the same two glyphs **6 times** (12 steps), whatever the results. It clears when a step of a third glyph completes, the turn ends, or the turn is stopped. It is a question, never a verdict: the word is "looping?" or "may be looping".
- **FR-042** **The wording**: "looping? A ↔ B · N times · ≈ $X", where N is the number of A-then-B pairs in the trailing run and $X is the run's cost from the usage events between its first step's start and now (FR-015's estimate, the same "≈ $X"; "cost unknown" when unknown).
- **FR-043** **Where the loop shows**: the brain (the two glyphs and a closed loop on the trail), the dock's sentence, the office desk card (a "looping?" chip, in every world and density), the Agents rail row (status word "Looping?"), and **one Your door item** (FR-044). It is not a permission request: it does not open Your door by itself, and it counts in Your door's number as an item.
- **FR-044** **The Your door item**: "Sven may be looping: Edit ↔ Shell, 3 times · ≈ $0.08", with **Look** and **Stop…**, and the line "Stop interrupts this turn and keeps the files." It leaves when the loop clears.
- **FR-045** **Look** opens the agent's chat if it is not open, scrolls to the **first step of the loop** in the transcript, and moves focus to that tool row (005 FR-202's row, a real focusable button). It sends nothing.
- **FR-046** **Stop…** opens a confirmation (the app's `askDialog`, `role="alertdialog"`): "Stop Sven's turn? Stop interrupts this turn and keeps the files: nothing is undone. Sven waits for your next message." Under it, **"Changes so far · kept on disk"** lists the files the turn changed, from the turn's `EditInfo`, each with +/− counts, and **Review changes** opens the existing diff view of those edit rows (005 FR-020..FR-025). **Focus starts on Cancel**; Enter on *Stop turn* confirms; Esc cancels. *Stop turn* is the existing Stop (`interrupt`). An adapter without `interrupt` shows *Stop turn* disabled with "This agent app cannot stop a turn" (constitution II). Undo stays spec 065's own action, not here.

### F. Turn map, bloom and export

- **FR-050** **Turn map.** From the dock or In front, *Turn map* shows the ended (or current) turn: numbered badges on the ring's glyphs in step order, the trail between lobes, and a text list beside it ("1 Read · registry.ts · 214 lines"). Badges are buttons: tapping one lights its glyph, its lobe and its row; the list is the text equivalent and its rows do the same.
- **FR-051** **Honest bloom at turn end.** When a turn ends, **only the lobes it used** swell once, each in its own colour, brightness capped so text over it keeps FR-097's contrast, **one swell, fewer than 3 luminance changes a second** (WCAG 2.3.1 general flash: no flashing). None under *Calm* or *Still*.
- **FR-052** **Export turn map.** *Export* writes a PNG of the map and a text file of its list. Text is masked again in main before writing (FR-021's functions), paths shortened to the folder (`maskHomePaths` and relative paths). **The PNG is drawn only from the masked state** (FR-021): main cannot re-mask pixels, so the window never draws unmasked text into it. This is Brain view's **one new IPC channel**, `brain:exportTurnMap(agentId, png, text)`, window-only, never in `durbar-mcp`, refused under `DURBAR_SIM` by `simguard` (the simulator answers with a fake write). Main checks, in order, and refuses with a reason that names no path:
  - **Sender**: registered with `ipcHandle`, so `fromAppFrame` refuses a call not from the app's own window.
  - **`agentId`**: a string of at most 128 characters naming a live agent of this window (`agents.get`), else refused; the folder name used below comes from main's own record of that agent, never from the window.
  - **`png`**: an `ArrayBuffer` of at most 8 MB that starts with the PNG signature (`89 50 4E 47 0D 0A 1A 0A`) and an `IHDR` of at most 4096 x 4096 pixels.
  - **`text`**: a string of at most 256 KB, masked again by FR-021's functions before writing.
  - **File name built by main**, never taken from the window: `turn-map-<folder>-<YYYYMMDD-HHmm>` through `notesexport.ts`'s `exportFileName` rules (safe characters, length cap), `.png` and `.txt`.
  - **Save dialog**: main's own (`exportDialogOptions`'s pattern, parented to the window); the user picks the PNG's place; the text file goes beside it with the same base name.
  - **Write**: through `writeNotesExport` (spec 083: a temp file opened `O_CREAT | O_EXCL`, `O_NOFOLLOW` where defined, `fsync`, rename, the Windows retry), **extended to take bytes, not copied**; a link at the chosen path is refused; if the `.txt` beside it exists, both writes are refused with "A file with that name exists".

### G. Motion, moods and Serious mode

- **FR-060** **Settings > Display > Brain motion: Full / Calm / Still.** *Full*: bursts, glow sprites, sparks, bloom. *Calm*: no bloom, no glow, no sparks, thin bursts. *Still*: no motion at all; lights change in one step. **Still is forced** by the OS reduced motion, by *Still highlights* (001 FR-192), and by the renderer's battery signal (FR-104). Saved by `setting()` in main, like Serious mode. A separate switch, *Brain view* on/off, is **on by default, docked beside the chat** (Q2, owner 2026-11-06 12:46 UTC); turning it off is saved the same way, and an unset setting means on.
- **FR-061** **Motion that is not the point stops** (097 FR-181): an idle brain is still, apart from its mood's one slow change (at most 1 change a second); a waiting brain does not pulse more than the office's own waiting cue.
- **FR-062** **Moods by silhouette, with words** (owner 2026-11-05 20:02), tied to existing timers: **relieved** at a turn's end, while the bloom runs (at most 3 s); **wants attention** while the reply is unread (`isUnread`); **bored** once read and idle, until 10 minutes after the turn ended; **asleep** by 097 FR-041's lamp-off rule (stopped, or finished over 10 minutes ago, `RECENT_MS`); **hibernating** after a day asleep (`DAY_MS` in `mood.js`). Each mood is a silhouette change of the point cloud (posture, density) and a word in the tag and the sentence, never colour alone. An unread reply past 10 minutes is asleep with the unread mark kept, as the lamp rule says.
- **FR-063** **Serious mode hides moods** (spec 034, 052 FR-069): the brain shows only tool activity; the mood words go, and no mood silhouette is drawn.

### H. Insights

- **FR-070** **Habits (b) is the picture** (owner 2026-11-06 12:02): for one agent's session, each lobe's density and brightness follow its **share of steps**; a lobe never used is a faint outline, worded "never", not "broken". Lobe labels give the share ("Shell 41 %").
- **FR-071** **The day view (a)'s table and turn strip are its text equivalent**: a table per tool (glyph, word, a bar, "17 of 41 steps") and, per turn of the day, a turn strip (the turn's glyphs in order, with words), its time, steps, result and cost. Screen-reader users get the table, not a description of the picture.
- **FR-072** **One unit.** Habits uses share of steps everywhere: the lobe label, the bar and the number. Time per tool is not mixed in (a mockup fix).
- **FR-073** **Describe, don't diagnose.** The habits text states counts and absences only ("Sven used Shell in 41 % of steps and has not used Web or MCP this session"). It never judges, advises or guesses a cause ("a test-fix loop", "ask it to read first" are not allowed). A unit test lists the fixed phrases; no model text is used.
- **FR-074** **Counts only, no content**: habits and the day view keep tool counts and step times, never arguments or outputs, and only in memory for the run (as `toolstats.js`).
- **FR-075** **Compare (c) becomes a Your door "stale read" alert** (owner 2026-11-06 12:02). For two agents with the same folder root: agent B **read or edited file F** at time *r* (a normalized read path or `EditInfo`), agent A **completed an edit of F** at time *e* > *r*, and B has a Shell or test step that **started before *e*** and completed in the same turn, and B has not read F again since *e*. Then Your door shows: "Mira's tests ran before Ada changed registry.ts · Ada edited it at 10:42 (+22 −9); Mira read it at 10:41." with **Show both** (opens the two chats side by side as compare (c), or Mira's chat with Ada's edit row linked where two do not fit) and **Draft a re-read note** (puts "registry.ts changed after your read; please re-read it before relying on the test result." in Mira's message box as a draft; **it never sends**. **It never overwrites an unsent draft** (074 FR-022): if the box already has text, the note is added on a new line after it, the existing text and attachments are kept as they were, and the cursor goes to the end; pressing it twice does not add the note twice). The alert clears when B reads F again, B's next Shell step starts after *e*, or it is dismissed. Paths compare as the platform compares them (case-insensitive on Windows and macOS, constitution VI).
- **FR-076** **Stale read data** `[KNOWN GAP]`: which adapters report a read's path in a normalized form is unchecked (spec 105 FR-013 found the same). Where reads are missing, only edits count for *r*, and the alert's text says "edited" instead of "read". The alert never fires on a guess from command text.

### I. Screen share and masking

- **FR-080** **Screen share mode.** A *Screen share* toggle in the chat header (and a palette command) turns it on for the window. While on: **text is replaced by placeholders, never blurred** ("[hidden while sharing]", "[hidden]"); names, statuses, glyphs and step counts stay; cost reads "cost hidden while sharing". **It covers every surface that can show agent or user text, a path or a cost**, not only Brain view's:

  | Surface | While sharing |
  |---|---|
  | Chat (messages, tool rows, thinking, the diff view and its rows, Previous sessions, the header's path and task line) | placeholders; the diff view shows file count and +/− only, no names |
  | Composer (the open chat's message box) | **shown and working as normal, by the owner's choice** (Q3): the person's own text; only this box's value, not its suggestions (slash and mention lists show names only) and not other chats' drafts |
  | Agents rail and List rows | names and status words; second lines hidden |
  | Your door and the Needs you inbox (052) | who and what kind ("needs your OK"); request text hidden |
  | Brain view (dock, In front, turn map, tags, popovers, orbs) | tool word and state (FR-085's share row) |
  | Office: desk cards, live screens (097), slips, hover cards | names and statuses; screen text and task lines hidden |
  | `#toasts` and the notice cards (052 FR-218) | the card's kind ("Folder settings", "Agent finished"); body hidden |
  | OS notifications (`Notification` in `app.js`) | title "Agent Durbar", body "An agent needs you"; no name, path or text |
  | Dialogs (`askDialog`, `DurbarDialog`, the Stop… confirmation) | their own fixed words; any agent text, file list or path inside hidden ("2 files" stays) |
  | Command palette and the navigator (052 FR-042, 074) | agent, folder and floor names; session titles and task text hidden |
  | Window title (`attention.js`) | "Agent Durbar" and the waiting count only |
  | Tooltips (`title`), `aria-label`s and live-region text of the above | the same placeholders as the visible text |
  | Browser pane (016), Notes (083), Files drawer (105), Settings fields that hold values | hidden behind a "Hidden while sharing" panel |

  A surface added later is covered by the same rule; a driver (FR-087) fails on any surface it finds showing a canary string.
- **FR-081** **No answer of any kind while sharing**: Allow, Deny, *Allow for the session*, a question's answers, plan approval, *Raise limit* and every Your door, inbox and Brain view action (*Stop…* included) are disabled with "Stop sharing to answer"; **the chat answer keys** (Alt+A/S/D/N, ⌥⌘A/S/D/N on a Mac, 052 FR-060), **the Needs you inbox keys** (A, S, D, O, Enter, 052 FR-208) and palette actions that answer do nothing but announce "Stop sharing to answer". The gate sits in the one renderer call that sends an answer to main, so every path above passes through it; a test lists the paths. The toggle's own state is announced and shown as "Screen share on" in the header.
- **FR-082** **Not remembered**: Screen share is off at every start, and the presenter layout (FR-036) turns it on.
- **FR-085** **The masking table** (every surface, from the round 11 to 14 mockups). Secrets become `[redacted]` everywhere (`redact.ts`'s own mark; the mockups' `••••` was a drawing); office surfaces show the program name only; screen share shows the tool and its state only.

  | Surface | Shows | Never shows |
  |---|---|---|
  | Office tag, office popover, orb | glyph word, program name (`npm`, `curl`, `psql`, `git`, MCP server name), state | arguments, paths with `/` or `\`, URLs |
  | Docked card, In front card | the masked command or file name (base name, no folder) | token values, `Bearer` values, URL passwords, cookie values, query values, home paths |
  | Chat transcript | the full masked command and path, home as `~` or the folder-relative path | the same secrets |
  | Turn map and export | the card's text, paths relative to the folder | the same secrets, absolute paths |
  | Screen share | tool word and state only | any argument, path, message or cost |

- **FR-086** **Masking tests are acceptance** (unit, on FR-001's state and each surface's formatter), at least these inputs, each checked on every surface of FR-085: `npm run deploy -- --token=ghp_…`; `curl -H "Authorization: Bearer sk-live-…" https://api.example.com/v1/users?key=XYZ`; `psql postgres://admin:hunter2@db.internal/prod`; a home path `/home/<user>/work/x/registry.ts` and `C:\Users\<user>\work\x\registry.ts`; `git push https://ana:ghp_…@github.com/acme/app.git`; `teams-mcp list_channels --cookie=SESS_…`. **Pass**: no cell holds a token-like value (`ghp_`, `sk-`, a `Bearer` value, `:password@`, `--token=`, `--cookie=`, `?key=` values); office cells hold no `/` or `\`; screen-share cells match `^Tool · state$`. Planted mutations (masking skipped on one surface) must fail them.
- **FR-087** **Screen share acceptance** (driver, simulator, both sizes): with FR-086's inputs as canary strings in messages, tool calls, requests, notes and a notification, and sharing on, (a) the DOM's text, `title`, `aria-label` and live-region contents, the window title and every `Notification` raised hold none of them and no home path, **except the open chat's message box value**, which the driver types a canary into and expects to see unchanged (Q3); (b) clicking every answer button, pressing every answer key and inbox key, and running every answering palette action sends **0 answers** to main; (c) turning sharing off restores the text and the controls. Planted mutations (one surface left unmasked, one answer path not gated) must fail it.

### J. Accessibility contract (owner 2026-11-06 10:06: readability and accessibility first)

- **FR-090** **Semantics.** The dock is a `region` named "Brain view, Ada". The brain canvas is decorative (`aria-hidden`); its meaning is in text: the lobe as text ("Shell, cerebellum"), the card as text, the *Latest steps* as a list (FR-025), the legend as a list, the turn map as a list.
- **FR-091** **One polite live region at a time.** The sentence goes to the existing `#srAnnounce`, only when it changes in meaning (a new tool kind, a wait, a loop, the end), at most once every 5 s per agent, and **it waits while the chat's own region is speaking** (a reply or tool row announced by spec 005) so the two never interrupt each other. Nothing is assertive.
- **FR-092** **Focus order**: the dock header (Legend, In front, Turn map), the card, *Latest steps*, then Your door. In the office, a brain's tag is reached from its person's desk in the office's own order. Every control is a real button with its name.
- **FR-093** **Visible focus ring** at least 3:1 against the pixels around it, also over the brain's glow.
- **FR-094** **Shortcut** Ctrl+Shift+B (⌘⇧B on a Mac) focuses the dock, and opens it if the right rail is collapsed; a second press toggles *In front*. **Rebindable in Settings > Keyboard** with 074 FR-013's *Change…* and *Reset*, refused on a clash (074 FR-014), matched by position and letter (074 FR-017), listed in the `?` sheet and the palette (074 FR-015). Not active while a modal dialog is open (074 FR-025).
- **FR-095** **Optional Your door count announcement** (a switch in Settings > Display, off by default): "Your door: 3 items" when the count changes, at most once every 10 s, **never while the user is typing** (focus in an editable field with input in the last 2 s).
- **FR-096** **Forced colours and colour blindness.** Under forced colours, the brain is drawn in `CanvasText` points on `Canvas`, the lit glyph in `Highlight`, and the card in system colours; no glow, no gradient. Every state has a shape and a word (FR-016); a check renders the dock under protanopia, deuteranopia and tritanopia simulation and asserts the state words are present (not that colours differ).
- **FR-097** **Text sizes and contrast.** At least **12 px** in the dock, the legend, cards, the ring's words and the turn map; **11.5 px** for office tags (above the project's 10.5 px floor). Card text contrast **at least 7:1 where possible and at least 4.5:1 always**, **measured against the real background pixels** (the brain and glow behind the text), not the token colour. Your door's count badge is checked the same way (a mockup fix).
- **FR-098** **Automated acceptance in a driver** (simulator, both sizes, Flat and Real office and Retro arcade, Docked and In front, at rest **and during card swaps and the bloom**): 0 overlaps between brains, tags, orbs, cards, faces, names, desk cards and Your door; every text at or above FR-097's floor; every text's contrast against the pixels behind it at or above 4.5:1 (7:1 reported); no frame with leftover text (FR-023); focus ring contrast (FR-093).

### K. Performance

- **FR-100** **Not a heavy impact** (owner 2026-11-05 19:48). **Canvas 2D**, with the point sets precomputed once per size (FR-010), glow sprites built once into small offscreen canvases and stamped, **no per-frame `filter`, `shadowBlur`, `backdrop-filter` or `mix-blend-mode`**, one canvas per placement, drawn only on a state change or while an animation runs.
- **FR-101** **Frame budgets** (recorded, not asserted, as 097 FR-187), on an integrated GPU at 1440x900: **office ≤ 2 ms a frame for 3 brains and 15 orbs; dock ≤ 3 ms; In front ≤ 6 ms; low power or *Still* ≤ 0.5 ms**. `check:perf --record` gains these rows; the weekly job reports a row over budget (097 FR-187).
- **FR-102** **Asserted op counts** in the pull-request suite (097 FR-186; no timing asserts, AGENTS.md *Timing*): points drawn per frame per placement at most the FR-010 sizes; canvases at most 1 per placement; 0 calls to `filter`, `shadowBlur` or blend modes; 0 frames drawn while the window is hidden; 0 frames drawn per second with every brain at rest under *Still*; office layout ops unchanged with Brain view on (097 FR-178's rows).
- **FR-103** **Idle is free.** With no event and no animation running, Brain view draws nothing and holds no `requestAnimationFrame` loop.
- **FR-104** **Pause when hidden or unfocused.** Hidden window: nothing draws. Unfocused window: no animation, state changes drawn as *Still*. Low power: *Still* while the window's Battery Status API (`navigator.getBattery()`, in the renderer, no IPC) reports not charging with a level under 20 %. Where the API is missing or refuses, nothing is assumed and the user's setting applies. `[KNOWN GAP]` the OS's own low-power mode (only `powerMonitor` in main knows it) is not used: that would need a push channel, and FR-052 stays the only new one.
- **FR-105** **Lazy.** Brain view's code and point sets load on first use, not at start-up, as `realoffice/art/people.js` does; off means not loaded.

### L. Worlds

- **FR-110** **Skins per world**, with the world's own fonts (owner 2026-11-05: "adaptable to different worlds"; 2026-11-06: arcade as inspiration, not copy): **Real office** (the point cloud as in the mockups), **Retro arcade** (spec 102: a voxel brain, square points, the world's pixel font and panel frames), **Flat / Open office** (the point cloud on the app's tokens). A skin changes colours, point shape and fonts only, never sizes, placements or masking (070 D2). **The Prehistoric cave** world (`realoffice/worlds/cave/`) is offered and has no skin in this spec: its gap is [issue #1219](https://github.com/three-feathers/agent-durbar/issues/1219) and task T027 (spec 021 FR-078).
- **FR-111** **Every offered world has Brain view** or an issue for the gap (the feature inventory, FR-078 of spec 021, `docs/feature-inventory.md` row).
- **FR-112** **No code from a pack**: skins are app code and tokens, never a world pack's content (spec 102 D1, FR-121).

### M. Safety and platforms

- **FR-120** **No AI credits.** Brain view reads events. It never sends to an agent, and *Look*, *Show both*, and *Draft a re-read note* send nothing; the simulator drives every test.
- **FR-121** **No secrets kept**: the state holds masked text only (FR-021); nothing is logged; the export is masked twice (FR-052).
- **FR-122** **Windows, macOS, Linux**: the same; the shortcut uses ⌘ on a Mac; paths in FR-075 compare by platform rules; home masking covers `C:\Users\…` and `/Users/…`.
- **FR-123** **Adapters stay plug-ins**: FR-012's table reads normalized names; an adapter that does not report thinking, reads or `interrupt` gives a smaller picture and says so, never a wrong one.

### N. Known gaps

- **FR-130** `[KNOWN GAP]` No real screen-reader run (NVDA on Windows, VoiceOver on macOS); FR-091's ordering is checked only by a driver reading the live regions.
- **FR-131** `[KNOWN GAP]` Frame times on an integrated GPU are budgets from the mockups' own measurements in headless Chromium, not measured in Electron on a real integrated GPU.
- **FR-132** `[KNOWN GAP]` Stale-read data per adapter (FR-076), and whether a failing test run reaches the window as `phase: 'failed'` for Copilot, Claude Code and Codex (FR-041(a) depends on it).
- **FR-133** `[KNOWN GAP]` Nothing is checked on a real session yet; the persona scores are simulated (Input).

## Success criteria

- **SC-001** Every view of an agent (brain, card, sentence, tag, chip, rail row, Your door item, transcript highlight) shows the same step at the same time in a driver that emits 200 simulator events (FR-002).
- **SC-002** No masking test input of FR-086 shows a secret on any surface; every planted mutation fails a test.
- **SC-003** 15 agents at 1440x900 and 1280x800, Flat, Real office and Retro arcade, chat open and closed, Docked and In front: 0 overlaps, no text under its floor, contrast at least 4.5:1 against real pixels, including during swaps and bloom (FR-098).
- **SC-004** Under *Still*, reduced motion or *Still highlights*, 0 animation frames; hidden window, 0 frames; idle, no `requestAnimationFrame` loop (FR-102..FR-104).
- **SC-005** The loop rule's unit tests cover (a), (b), a third tool clearing it, Think not breaking a run, and the wording; the Your door item's *Look* lands focus on the first loop step and *Stop…* starts on Cancel.
- **SC-006** No action of Brain view sends a message or spends credits (a driver counts adapter sends: 0).
- **SC-007** Your door's count is visible in every dock state at both sizes.
- **SC-008** While sharing, no canary string reaches any surface, the window title or an OS notification, and every answer path sends 0 answers (FR-087).

## Assumptions

Cost uses the app's existing estimate and is shown with "≈". The 230 px dock height, the 60 % growth and the office tag size come from the round 14 mockups at 1440x900 and are measured again by the first PR of each phase. The tool-name table (FR-012) is from the simulator and adapter fixtures on `main` today. The mockup names, folders, files and costs are invented.

## Owner questions (all four answered 2026-11-06)

- **Q1, decided** (Vikram, Telegram, 2026-11-06 12:17 UTC, option "2"): "yes, and change the constitution to allow canvas where CSS can't do the job". Constitution V is amended (version 1.2.0, Amendment 3): a canvas is allowed where CSS cannot do the job, with a still frame under reduced motion, a frame budget, a pause when hidden and no per-frame filters; FR-100..FR-104 meet each condition. Spec 102 FR-261 has a dated delta pointing to it (worlds keep frames, not code).
- **Q2, decided** (Vikram, Telegram, 2026-11-06 12:46 UTC, option "1"): Brain view is **on by default, docked beside the chat** (FR-030, FR-060); the switch in Settings > Display turns it off.
- **Q3, decided** (Vikram, Telegram, 2026-11-06 12:49 UTC, option "2"): while screen share is on, the message box works and shows the typed text normally, since it is the person's own text (FR-080's table). Everything else in FR-080's table stays masked.
- **Q4, decided** (Vikram, Telegram, 2026-11-06 12:50 UTC, option "1"): with Brain view on, the right rail (Brain on top, Your door below) opens with every chat, and the person can still collapse it; a saved collapse (005 FR-196) is respected (FR-031). This amends 052 FR-216's "opened on request", with a dated delta in spec 052.

## Changes

### 2026-11-06: P1 G1 built, and what building it settled (T003, T004, T013)

`[IMPLEMENTED]` FR-001..FR-008 (state), FR-012, FR-020..FR-022, FR-040..FR-042, FR-085, FR-086 in `src/shared/brainstate.ts` and `brainsurface.ts`; `test:` `test:brainstate`, `test:brainloop`, `test:brainsurface`. Not built: moods and Serious mode (T010), placement (T011), every renderer view. Questions the code had to answer, now written here:

- **Turn end (FR-005)**: the agent's `status` of `idle` (the final reply), `error` or `stopped` ends the turn; a `user` event starts the next, and so does a `working` status after an ended turn (a scheduled prompt has no `user` event). A `user` event over a running turn closes it as stopped. A permission refusal that ends the turn arrives as one of those statuses.
- **Mask word (FR-085)**: secrets read `[redacted]`, `redact.ts`'s own mark, not `••••`: one masking, no second set of words. Every formatter masks its result again (idempotent), so a surface stays safe when handed an unmasked step; the state holds masked text only.
- **Tool table (FR-012)**: exact normalized names only (no guessing from part of a name: `read_agent` is no file read, `task` and `spawn_agent` are "Other tool"); the table is checked against the simulator, the fake adapter and every tool name in `scripts/fixtures/` (a new fixture name forces a decision in `test:brainstate`).
- **Cost (FR-015, FR-042)**: the state sums `usage` events the way the app's header does: `nanoAiu` (a usable figure per `usagetotals.js`'s `validNano`, else the event is "not reported") at `AIU_USD` (`costtable.js`), plus `costUsd`; the page passes both as `mask.units`, and without them a credit figure counts as not reported. The state keeps the parts (`turnAiu`, `turnUsd`) so `costDetail` words them like the header tooltip. With nothing reported the loop line and the cost say "cost unknown", never $0; "<$0.01" has no "≈". Helper usage arrives through the parent and counts once.
- **Loop rule (FR-041)**: a helper's steps do not count; once set it stays while the run alternates between the same two glyphs and clears on a third glyph, a turn end, a stop or a new turn; N is the number of A-then-B pairs of the trailing run (a run of 5 steps is 2); late events of an ended turn never set it.
- **Screen share (FR-080, FR-085)**: every formatter returns `Tool · state` and nothing else (no step number, no name); the loop line says "cost hidden while sharing".
- **Turn map text (FR-050)**: "1 Read · registry.ts · done" (path relative to the folder, else the file name; the "214 lines" of the example needs tool output, which Brain view never keeps, FR-074, so it is not shown).
- **Pieces and tails (FR-021, review of PR 1226)**: text that streams in pieces keeps a masked tail only. Token characters glued to a mask are the tail of a secret whose head masked in an earlier piece, and go into the mask (`maskGluedTail` in `redact.ts`; a `.` or `:` only when more token characters follow, so a full stop stays). A header or secret name that still expects its value (`Authorization: Bearer`, `Basic`, `Proxy-Authorization`, `X-Api-Key:`, `Cookie:`; found by asking `redact` whether a shaped probe after the text would be masked, so no second list) keeps its words raw and the value that follows is masked with it, wherever the pieces split; prose such as "Bearer tokens are explained here" is left alone (only token-shaped runs are masked, `redact`'s own rule). Inside an unclosed private key block (`openKeyBlockStart`) every piece is dropped until its `-----END … PRIVATE KEY-----` marker. A query target and an "Other tool" target also pass `maskSecretCommand`. Bidi override and isolate characters (U+202A-202E, U+2066-2069) are removed from every text. A mask that returns a non-string yields no text.
- **Loop count (FR-041, FR-042)**: once set, N counts the loop's steps since it was set, halved; a repeated glyph pauses the count and a restart of the same pair keeps its first-occurrence order (nothing is capped by `RUNS_MAX`; before it is set the 40-run window bounds the check). "1 time" is singular.
- **Late events (FR-005)**: a late step or usage event also updates the ended turn's history entry (step count, glyphs, cost). A call without a `callId` never shares a step with another call of the same tool; a later event of that tool closes the newest running one.
- **Known limit**: a command's absolute paths outside the home folder and outside the agent's folder stay in the turn map and the export (only home paths and the folder prefix are folded); `[KNOWN GAP]`, to settle with T018.
- **Known gap (F5, #1227)** `[KNOWN GAP]`: `redact.ts` itself misses `mysql -phunter2`, an AWS secret after a space (`aws configure set aws_secret_access_key <value>`), Google `AIzaSy…` keys and a zero-width space inside a token; these reach every surface that uses it, Brain view included. Tracked in #1227, fixed there (spec 012 FR-170, 2026-11-07; `AIzaSy` was already hidden; the zero-width case waits for the shared hidden-character set of #1236), not in this PR.
- **Key blocks and streams (FR-021, re-review of PR 1226)**: an END marker split across pieces is found (a pure-marker suffix is carried to the next piece); nested BEGIN lines are counted, so an inner END does not close the outer block; a turn start or end clears an open block; thinking and replies keep one masked tail each (the card's "Why:" comes from the newer); a failing `openKeyBlockStart` keeps the block open and no text (fail closed).
- **Accepted, fail closed (H6, H7)**: prose that merely mentions a `-----BEGIN … PRIVATE KEY-----` line hides the rest of that stream for the turn; a mask followed by glued token characters hides them (`[redacted]` + `@host` of a URL keeps its host). Hiding too much is the safe direction.
- **Known gap (H5)** `[KNOWN GAP]`: a token tail after a character outside the token class (`ghp_…` then `!rest`) stays visible; rare in model text, and the head is masked. A class wide enough to hide it would eat ordinary prose.
- **Held headers and units (round 3 of PR 1226)**: a raw header head is held only when every word is a name (`Authorization:`, `sid=`), a scheme word or at most 7 characters; otherwise the whole text is masked. Only a word that can start a header (`:` or `=`, or a scheme word) is probed, so ordinary text costs at most two `redact` calls per piece (tested by counting). `costUsd` is capped like credits (via `validNano`), a non-finite rate or total means "cost unknown", and the unit words (credits, Claude estimate) come from `mask.units`, none are written in `src/shared`; with no credits seen the detail has no "0.00 AIU" part.
