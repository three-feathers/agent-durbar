# Feature Specification: Real office mode

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Real office mode (owner request, Vikram 2026-10-30/31): a realistic front-facing open-plan office as a second office mode beside flat (default), live screens, animated people, status lights; folds in #692
note: P1 (scene, lights) built; P2 (screens, motion), P3 (My characters, manual lighting) not; crews' scene adaptation (Q6) pending
status: building
-->

**Feature Branch**: `097-real-office` (spec); code branches `097-pN-slug`, one per phase

**Created**: 2026-10-31

**Status**: In progress (2026-10-31). Phase P1 (the scene and the lights) is built (see *Changes*); P2 and P3 are not. Q1-Q5 are answered; Q6 is answered in part (crews appear in Real office in their own art; how the scene adapts to them waits for a proposal).

**Input**: Owner requests (Vikram, Telegram DMs, 2026-10-30 and 2026-10-31):
- "lets make it realistic … it looks like a dashboard and not real office"; "quality is the key as it is visual".
- He chose the **front-facing open-plan layout** (mockup variant B) over isometric rooms, because isometric wastes too much screen space.
- "dont unnecessarily waste screenspace … if there is no functionality … screen space is important to not show details too small".
- Lobby visitors stand in activity poses at their fixture: flipping books at the Library, sipping coffee, on a treadmill or at a standing terminal, knocking at the Boss door, and so on.
- Each agent's monitor shows its live screen (output text, scrolling); hover zooms in; with few agents, big screens and readable text.
- People animate (typing, waving, thinking, resting).
- "this realistic should be one of the modes, while we still support old modes for people who want flat". **Flat stays the default and is unchanged.**
- **Lights** (2026-10-31 08:28 UTC): "add lights … red light when error, dim while working, turn off while sleeping … use common sense"; "Lights for library, boss, bank as well"; "We already had an issue for lights, check that". The light scheme in FR-040..FR-052 is the one sent to the owner in reply.

## Why a new spec and not a delta

Spec 001 owns the office, its densities and the 15-agent fit rule; spec 017 owns the *Office layout* setting (cabins or open); spec 024 owns the lobby places; spec 077 owns raster characters; spec 096 (draft) makes characters with AI. Real office is **a second renderer of the same office model**: its own layout engine, its own art pack (about 190 pictures), live screens, and a lighting layer. As a delta it would bury a new renderer in 001's 190 requirements, so it is a new spec, number **097**. Checked 2026-10-31: `main` has specs up to 096; the only remote branches and PRs at 096 are `096-ai-character-maker` and `096-crew-motion`; nothing uses 097.

**Issue #692** (open, by vikramgorla, never built) asks for user-adjustable room and desk lighting: lit, dim or off per room, a desk override that inherits from the room, local persistence, keyboard and screen-reader operable, readability kept, the current look as the default. This spec **folds #692 in for Real office** (FR-053..FR-058, phase P3) and builds the automatic, status-driven lights first (P1). Whether the flat office also gets #692's manual lighting is Q3. The PR says `Refs #692`, not `Closes`.

## Context: what exists today

- **Office model and render path** (`src/renderer/app.js`): `ROOMS` and `agents` are filled from live sessions; `scheduleRender` calls `renderAll`, which runs `syncCrew`, `syncDesks`, `prepareWalkers`, then `renderOffice()` or `renderList()`, then `syncWalkers`. `officeModel()` gives rooms with `mains` and `rolled`, sorted by `prio` (waiting 0, error 1, the rest 2; spec 001 FR-007). `chooseLayout` with `probe.js` picks the density (spec 001 FR-002).
- **Statuses the renderer shows** (`app.js` labels): working, thinking, waiting, idle, error, done; paused shows as idle. *Limit reached* (`a.limit`, spec 017 FR-019) and *coffee* (`a.coffee`, spec 068) are flags. Finished agents rest on the couch (recent) or a nap bed (old) in the lounge (spec 001 FR-051..FR-057). There is no "asleep" status: this spec calls an agent in a nap bed, or a stopped session still shown, **asleep**.
- **Office layout setting** (spec 017 FR-027): Settings > Detail level > **Office layout**, buttons *Office with cabins* (default) and *Open office* (`screens.js` `signsRow()`), stored renderer-side in `localStorage` key `durbar.doorsigns` (`on`/`off`). No IPC, no shared type.
- **Lobby** (spec 024 FR-001; spec 001 FR-034..FR-040; spec 068): built-in places Library, Software library, Terminal, Web, Other tools; plus Boss, Bank (Durbar's spending limit), Postbox (next scheduled runs) and Coffee corner. A tool call running for more than 600 ms puts the agent "at" its place (024 FR-002, FR-003). Users may add **up to 3 custom places** (`c-xxxxxx`, a name of at most 24 code points, one of 12 icons; 024 FR-018..FR-027).
- **Raster characters** (spec 077): 352x352 WebP with alpha, no metadata, at most 40 KB each (FR-050), provenance in `src/renderer/crew/art/ASSETS.md` checked by `test:crew-assets` (FR-054), MIT like the code, CSP `img-src 'self' data:` (FR-057), fall back to the plain figure on a decode failure (FR-055). The **Characters** setting is `theme`, `minimalist`, `cheeky`, `prehistoric` (FR-064..FR-068); spec 096 adds `mine` (My characters, FR-040) and the style preset `realistic-office-v1` (FR-050: a **three-quarter isometric** view).
- **Themes** (specs 035, 040, 070): token groups `--room-*`, `--agent-*`, `--status-*`, `--ui-*`, `--scene-*`; a theme may name a scene kit (035 FR-013) that the Characters setting overrides (035 FR-016); sizes are not themeable (070 D2); status colour meanings are fixed (070 FR-050). Forced colours and `prefers-contrast` are handled in `styles.css` (spec 052 FR-052).
- **Serious mode** (spec 034 FR-004): removes the moods; spec 017 FR-022 also stops its animations in Serious mode.
- **Live readout and masking** (spec 001 FR-028..FR-031, FR-043): desk readouts go through `src/shared/redact.ts` (`redact`, `maskSecretCommand`, `maskSecretUrl`, `maskHomePaths`) and `DurbarSafeText` (mask before cut, spec 041 FR-065); main masks MCP output with session secret values (`maskMcpEvent`, `src/main/mcpmask.ts`). The chat body itself is Markdown-sanitised (spec 016) but **not** secret-masked, so the screen reuses the **desk readout** path, which is the stricter one (FR-030).
- **Package size**: no budget exists today (spec 008 has none, no size script). The crew art total cap is 2.5 MB (`test:crew-assets`).

## Evidence: the mockup (outside the repo, not committed)

Kept in the coordinator's scratchpad on 2026-10-31; described here because the pictures are not in the repo (they move in only with the build PR, FR-063).
- **`office-mockup/index-b2.html` + `b2.js`**: a standalone page with 15 fake agents in 4 folders. The layout engine is specified as FR-010..FR-022 (row packing by permutation and partition search, a `u` unit per person, desk and person placement from per-picture metadata, a lobby band, screens, hover zoom, big screens when n ≤ 4, 2-frame CSS animations).
- **Screenshots** (`room-art/shots-v2/`): `b2-15-1440x900`, `b2-15-1280x800`, `b2-3-*` (big screens), `b2-hover-zoom-1440x900`, `b2-lobby-closeup-*`, frame strips of a working and a waiting person. At 1280x800 with 15 agents: a lobby band about 145 px high with 9 fixtures and 5 visitors (Mira at the Library, Sven on the treadmill, Jonas knocking at the Boss door, Maya with a coffee, Omar at the Bank), then 3 rows of desks under folder signs; each desk shows a seated person, a front-facing monitor with coloured line bars and the newest line, and a name plate with name, role, status icon and task; away agents leave a narrower desk with "at Boss ↑".
- **Art** (`office-mockup/art-v2/`, 194 files, 9.7 MB): 15 people (`p01`..`p15`, varied in age, gender and origin) × 6 seated poses (`typeA`, `typeB`, `waveA`, `waveB`, `think`, `rest`), 15 × 5 standing poses (`book`, `coffee`, `tread`, `letter`, `knock`) plus 4 people with 4 more (`box`, `touch`, `tool`, `wait`); 9 fixtures (`fx-library`, `fx-software`, `fx-terminal`, `fx-web`, `fx-boss`, `fx-coffee`, `fx-bank`, `fx-post`, `fx-tools`) cropped from one back-wall render; one desk (900x344 WebP, 38 KB); a floor texture; `people.json` with per-picture metadata (`w`, `h`, `headTop`, `bodyH`, `hand`). Seated frames are about 457x618, 38-70 KB; fixtures are PNG, up to 105 KB.
- **Provenance** (`room-art/ASSETS.md`): Codex image generation (`codex exec … "Use your image generation tool to create ONE image …"`) on Vikram's ChatGPT plan, made by Vikram's agent, 2026-10-31, approved by Vikram; the exact prompt of every sheet is recorded (style block: "Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos"). One person (p05) was regenerated because she looked too much like p03.

**Known weaknesses of the mockup** (targets or gaps below): lobby faces are about 12 px with 15 agents (FR-024); desk faces are about 36 px at 1280x800, target 40 px (SC-002); tall fixtures (Library shelf, Boss door) are cut at the top (FR-023); the hover zoom covers neighbours (FR-034); people loop 2 frames and never walk between desk and lobby (FR-075, `[KNOWN GAP]`).

## Clarifications

### Owner requirements (binding, Vikram 2026-10-30/31)

Listed under *Input*. In short: realistic, front-facing open plan; no wasted space; activity poses in the lobby; live screens with hover zoom and big screens for few agents; animated people; lights by status and on the lobby fixtures; flat stays the default and unchanged.

### Decisions taken by this spec

- **D1 One model, two renderers.** Real office reads the same `officeModel()`, `agents`, visits and statuses as flat; it never has its own agent state. Switching modes changes the drawing only.
- **D2 Its own scene, the theme colours the chrome.** Real office is not a theme scene kit (035 FR-013): the art has its own colours and lighting. The theme still colours everything that is UI: top bar, folder signs, name plates, buttons, hover card, zoom frame, focus rings, status icons (`--ui-*`, `--status-*`, `--c-*`). A theme switch repaints the chrome and never reloads the art.
- **D3 The Characters setting applies in both modes** (reversed 2026-10-31, see *Changes*: Vikram 08:46 UTC, Paco 08:53 UTC, Vikram 09:03 UTC). A character set may supply Real office pictures (FR-084); the default set is the 15 realistic **Office people** of the art pack. The crews of spec 077 appear in Real office in their own art, never as realistic versions, each in its own world (Cheeky to the loft, Prehistoric to the cave; FR-100, FR-114, FR-115); the worlds are not built yet, so in P1 a crew shows the Office people and Settings says so (`[KNOWN GAP]`, below). My characters (096) join in P3 (FR-080..FR-083).
- **D4 Lights are overlays.** Every light is CSS (gradients, opacity, `mix-blend-mode`, box-shadow) over the raster art; no new pictures for lights.
- **D5 Custom places get a generic fixture.** A plain wall kiosk drawn in CSS with the place's own icon (024 FR-018) and name; no generated art per custom place.
- **D6 Ship the art in the app, load it lazily.** See FR-060..FR-066.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See my agents in a realistic office (Priority: P1)

I switch Settings > Office layout to **Real office**. The office becomes a front-facing open-plan room: a lobby band along the back wall with the places, then one zone per folder with a desk per agent, each with a realistic person, a monitor and a name plate. Agents that need me are first and stand out. Nothing is too small to read.

**Why this priority**: it is the feature; without it nothing else shows.

**Independent Test**: simulator with 15 agents at both sizes, Real office on, screenshots and the overlap check.

**Acceptance Scenarios**:
1. `sim:` **Given** flat is the default, **When** a new user starts the app, **Then** the office is the flat office, pixel-identical to before this feature (`check:office` unchanged).
2. `sim:` **Given** Real office is chosen, **When** the simulator shows 15 agents with helpers at 1440x900 and at 1280x800, chat closed and open, **Then** every desk, name plate, folder sign and lobby plate is visible with no overlap, no clipped text, no page overflow and no text under 10.5 px (`check:office` Real office variant).
3. `sim:` **Given** a waiting agent and an error agent in a folder, **Then** they sit first in their zone (spec 001 FR-007), the waiting one waves with an amber call light and "?" bubble, the error one has a red desk light and a "!" badge, and each name plate says the status in words and icon.
4. `sim:` **Given** an agent at the Library for longer than 600 ms (spec 024 FR-003), **Then** it stands at the Library fixture in its reading pose with a name chip, the Library lamp is on, and its desk is narrower with "at Library ↑".
5. `test:` **Given** the layout engine with 1..40 agents in 1..8 folders at both sizes, **Then** it returns rectangles that do not overlap, stay inside the floor, and give `u` (person height) at least the minimum of FR-012.
6. `sim:` **Given** the art pack has not loaded yet or fails, **Then** the office shows desks and plates without people (FR-065) and never an empty or broken page.

### User Story 2 - Lights that tell me the state at a glance (Priority: P1)

Every desk has a lamp and a screen glow that follow the agent's state; the room gets darker as fewer agents work; lobby fixtures light up when used.

**Why this priority**: the owner asked for it with the scene, and it is the calm, glanceable status cue of a real office.

**Independent Test**: simulator with one agent in each state, Real office, screenshots; a unit test of the status-to-light table.

**Acceptance Scenarios**:
1. `test:` **Given** each status and flag, **Then** `lightFor()` returns exactly the row of the FR-041 table.
2. `sim:` **Given** an error agent, **Then** a small steady red desk light and a faint red screen tint show, the room around it stays normal, and nothing flashes.
3. `sim:` **Given** 15 agents of which 3 work, **Then** the room ambient is dimmer than with 12 working, and every label keeps the same contrast in both (FR-050).
4. `sim:` **Given** `prefers-reduced-motion: reduce` or Serious mode, **Then** no light pulses or breathes; steady lights stay.
5. `sim:` **Given** forced colours (Windows High Contrast), **Then** lights are not drawn, status words and icons remain, and the office stays usable (FR-051).

### User Story 3 - Live screens (Priority: P2)

Each monitor shows the agent's latest output lines, scrolling as it works; hovering (or focusing) a screen zooms it so I can read it; with 4 agents or fewer the screens are big enough to read without zooming.

**Why this priority**: high value but builds on P1's layout.

**Independent Test**: simulator with streaming agents; a unit test that hostile output is masked, capped and inert.

**Acceptance Scenarios**:
1. `sim:` **Given** a working agent printing output, **Then** its screen gains the new line at a calm pace (at most one repaint per screen every 2 s) and the newest line is at the bottom.
2. `test:` **Given** output holding a token, a `~/` home path, an MCP secret value, `<img onerror>`, a Markdown link and 1 MB of text, **Then** the screen text has the token and secret masked, the home path shortened, the HTML shown as text, no link element, and at most the capped number of lines and characters (FR-030, FR-031).
3. `sim:` **Given** 3 agents at 1280x800, **Then** each screen shows at least 8 lines of real text at 11 px or more.
4. `sim:` **Given** 15 agents, **When** I hover a screen, **Then** a zoom panel shows the last lines readably, does not cover the hovered agent's name plate or any needs-you plate, and closes when the pointer leaves; **When** I Tab to the desk, the same zoom opens and Esc closes it.

### User Story 4 - People that move (Priority: P2)

People type while working, think with a hand on the chin, wave when they need me, lean back when resting; lobby visitors sip coffee, walk on the treadmill, knock at the Boss door.

**Independent Test**: simulator, frame captures of a working and a waiting person; reduced motion turns it off.

**Acceptance Scenarios**:
1. `sim:` **Given** a working agent, **Then** its two typing frames alternate at its own pace (1.15-1.5 s, varied per agent so the room does not move in step).
2. `sim:` **Given** reduced motion, Serious mode or a hidden window, **Then** every person shows one still frame and no animation runs.
3. `sim:` **Given** an agent that goes from its desk to the Terminal, **Then** it cross-fades out at the desk and in at the fixture within 300 ms (walking is FR-075 `[KNOWN GAP]`).

### User Story 5 - My characters and manual lighting (Priority: P3)

I can put my own characters (spec 096) in the Real office, and set a room or a desk lamp to lit, dim or off as in issue #692.

**Acceptance Scenarios**:
1. `sim:` **Given** a My character with Real office frames pinned to a folder (096 FR-033), **Then** that folder's agents use it at their desks and in the lobby; one without Real office frames is not offered for Real office and a built-in person is used.
2. `sim:` **Given** a room set to *Dim* and one desk in it set to *Lit*, **Then** the room is dim, that desk is lit, its neighbours inherit *Dim*, and *Reset* returns the desk to the room's setting.
3. `test:` **Given** a malformed or stale lighting preference, **Then** the default (automatic) lighting applies and the bad entry is dropped.
4. `sim:` **Given** a desk set to *Off* that errors, **Then** the red error light and the status word still show (manual lighting never hides a status cue).

### Edge Cases

- **1 agent**: one desk, centred, a big screen (n ≤ 4 rule, FR-020) with the person beside it; the lobby band keeps its minimum height; `u` is capped (FR-012) so the person is not a giant.
- **40 agents**: the engine keeps `u` at its minimum and lets the floor scroll inside itself (constitution V allows it only past the 15-agent scale); the lobby band stays fixed above the scrolling floor; screens become line bars plus the newest line (FR-032).
- **Many helpers**: helpers are not drawn as people; the name plate shows `+N` and up to 3 status dots (FR-016); the hover card lists them; a helper that needs the user lifts its parent's call light and puts the parent first.
- **Custom lobby places**: each gets the generic fixture (D5) with its icon and name; with 3 custom places plus the 9 built-ins the fixtures shrink to their minimum width, then the least-used empty fixtures collapse to a plate-only slot (FR-025).
- **Long names** (folder names, agent names, task text, place names up to 24 code points): one line with an ellipsis, the full text in the hover card and the accessible name; never wrapped into the desk art.
- **Every status**: working, thinking, waiting, error, limit reached, done, idle, asleep (nap bed or stopped), paused (as idle), compacting and retrying (as thinking, spec 017 FR-026): each has a pose, a light row and a word.
- **Serious mode**: people still shown, poses still follow the status, no animation, no pulsing, no "?"/"!" bounce; lights stay steady.
- **Reduced motion**: same as Serious mode for motion; screens update without the slide-in.
- **Forced colours / high contrast**: art stays, lights and ambient dimming are off, name plates and signs get system colours and borders (`styles.css` forced-colors rules reused), the status word is always shown.
- **Theme switch**: chrome repaints in place; art, lights and layout do not change; no flash, no reload of pictures.
- **Window resize**: the layout is recomputed once per animation frame at most; no layout jump when a status changes (constitution V), because plate height is the row maximum (FR-015).
- **Art fails to load** (missing file, decode error, CSP): the desk, screen and plate still draw; the person slot is empty with the agent's initials in a neutral disc (FR-065).
- **Doors you closed** (spec 017): Real office is an open office; switching to it asks the same "Switch to an open office?" question as *Open office* when doors are closed or prompts are held.
- **Window hidden or minimised**: animations and screen repaints pause (FR-074).

## Requirements *(mandatory)*

### Functional Requirements

#### Mode and setting

- **FR-001** **Choosing the mode.** Settings > Detail level > **Office layout** gets a third button, **Real office**, next to *Office with cabins* and *Open office* (spec 017 FR-027, `signsRow()`). Choosing it shows Real office; choosing either of the others shows flat as before. (Q1)
- **FR-002** **Flat is the default and unchanged.** Without the user's choice the office is flat. Real office's code, CSS and art are not loaded in flat mode; the flat office's DOM, layout and screenshots are byte-identical to before (`check:office`, `shots:docs` unchanged).
- **FR-003** **Storage.** The choice is a renderer preference in `localStorage` key `durbar.officeview` (`flat` default, `real`), read in a `try`; any other value or a storage error means flat. `durbar.doorsigns` is not changed, so leaving Real office restores the user's cabins or open choice.
- **FR-004** **Leaving cabins.** Switching from *Office with cabins* to Real office asks the existing "Switch to an open office?" question when a door is closed or prompts are held (`setSignsOn`), with the same wording and outcome.
- **FR-005** **Same model.** Real office reads `officeModel()`, `agents`, visits (`VISITS`, `places.js`) and status labels; it adds no agent state, no IPC channel and no main-process code, except the art pack files (FR-060).
- **FR-006** **Same actions.** A click (or Enter/Space) on a person, desk, screen or name plate opens the chat exactly as in flat; folder signs keep the room menu and **+** (new session); the needs-you count and filters in the top bar work unchanged. The List view is not affected.

#### Layout engine (from `b2.js`)

- **FR-010** **Unit.** All geometry is in a unit `u` = the seated person's body height in px (head top to seat), from `people.json` (`headTop`, `bodyH`, `hand` per picture). Constants: person width `PW` = 0.80 u, screen width beside the person `SR` = 0.66 u, folder sign strip 22 px, padding 8 px, gap between zones 8 px.
- **FR-011** **Row packing.** Folders are zones; a zone's desks stay in one row. The engine tries 1 to 4 rows, every order of the visible folders and every split of that order into contiguous rows; for each, a row's slot width is `Sw = (W − 2·PAD − ZGAP·(zones−1) − 8·zones) / n`, where `n` counts each away agent as 0.62 of a desk; `u` is the largest value (bisection, 30 steps, between the minimum and `min over rows of Sw / (PW + SR)`) whose rows fit the height left under the lobby band. The score is `u − 5·(largest − smallest row count) − 0.08·(unused height)`, and the best score wins. With more than 7 folders, the search over orders is replaced by the given order (sorted by needs-you first, then size) to keep it under 5 ms (FR-019).
- **FR-012** **Limits on `u`.** `u` is at most 260 px (420 px for big screens, FR-020) and at least the value that gives a desk face of 28 px; below that the floor scrolls (constitution V, past the 15-agent scale only). With 15 agents at 1280x800 and at 1440x900, `u` gives a desk face of **at least 40 px** (SC-002).
- **FR-013** **Desk and person.** The desk picture spans the slot width minus 6 px; its height is `0.382 × min(slot width, 2u)` (wider desks stretch sideways, not up). The person's hands land on the desk surface: head top = desk back − `hand × u` − 0.015 u. The person stands at the left part of the slot (`x + 0.05 Sw + 0.42 u`), the monitor to the right of the person, facing the viewer.
- **FR-014** **Row height.** A row's height is the folder strip, plus the head room (larger when a person in that row waves, so the raised hand stays inside the row), plus the desk, plus the name plate; rows share the spare height evenly (no big empty band at the bottom).
- **FR-015** **No layout jump.** A name plate is 36 px, 50 px when it needs the user (two lines); the row uses the largest plate height that any status could need for its agents, so a status change never moves a desk.
- **FR-016** **Name plate.** On the desk's front panel: line 1 the name, role and helpers (`+N` and up to 3 status icons); line 2 the status icon and word and the task (a needs-you or error plate shows the question or error instead). Theme tokens only; at least 10.5 px; one line each with an ellipsis.
- **FR-017** **Away desk.** An agent at a lobby place keeps a desk of 0.62 width with its screen and plate, no person, and "at <Place> ↑".
- **FR-018** **Folder sign.** Above each zone: name, path (masked by `maskHomePaths`), status counts, cost, **+** and the room menu. It sits at the left unless a waving hand rises into the strip there, then at the right or after the hands.
- **FR-019** **Pure and fast.** The layout engine is a pure function (`realLayout(model, viewport, meta)` returning rectangles) with no DOM access, under 5 ms for 40 agents in 8 folders on CI hardware (`test:`), so it is unit-tested from any OS.
- **FR-020** **Few agents, big screens.** With 4 visible agents or fewer, all desks share one row and each gets a big screen above its desk (as tall as the space under the lobby allows, at least 170 px of row), person beside it, text at 13 px when the screen is over 200 px tall, else 11 px.
- **FR-021** **Chat open.** With the chat panel open the engine lays out in the remaining width; the 15-agent rule holds with the chat closed and open (spec 001 FR-005).
- **FR-022** **Status order.** Inside a zone desks are sorted waiting and limit first, then error, then working and thinking, then done, then idle and asleep; ties keep the model's order (spec 001 FR-007).

#### Lobby band

- **FR-023** **Band and fixtures.** The lobby is a band across the top, between 116 and 150 px high (15 % of the office height) and at most 24 %; it shows the fixtures in the spec 001 FR-039 order. Each fixture is **scaled to fit the band height whole**, never cut at the top (the mockup's cut Library shelf and Boss door are fixed by re-cropping the art to a common baseline and scaling, FR-062).
- **FR-024** **Visitors.** A visiting agent stands in front of its fixture in that fixture's activity pose: Library `book`, Software library `box`, Terminal `tread` (treadmill desk), Web `touch`, Boss `knock`, Coffee `coffee`, Bank `letter` (holding the wallet card of spec 017 FR-019), Postbox `letter`, Other tools `tool`, a custom place `wait`; a missing pose falls back (`box`/`touch`/`tool`/`wait` → `letter`). A name chip with a hand icon when it needs the user sits at its feet. **Target: a lobby face of at least 18 px with 15 agents at 1280x800** (mockup: about 12 px); if it cannot be met without taking desk space, it stays a `[KNOWN GAP]` and the chip, plate count and hover card carry the identity.
- **FR-025** **Crowding** (owner 2026-10-31 09:03, replacing the first text). Exactly **one fixture per place**, never two; any number of visitors may crowd it. Each place's width grows with its visitors and an empty place shrinks to a compact fixture (`lobbyWidths`, pure). When the band is short, in order: empty fixtures are drawn smaller (to 0.55); visitors stand closer (step 0.8 to 0.45 of a person); busy fixtures are drawn smaller (to 0.6); the biggest crowds show fewer people and a `+N`; empty places become a plate-only slot, from the right; all fixtures get smaller still; plate-only slots narrow. An occupied place always keeps its fixture and at least one person. Name chips that would touch move up a level (three levels), then show initials.
- **FR-026** **Place plates.** Each fixture has its plate (its label; owner 2026-10-31 09:03: no bare visitor count when the visitors are visible, a `+N` only for the ones that do not fit); its title and accessible name list who is there (spec 001 FR-036 `placeTip`). The Postbox plate is a button that opens Settings > Schedules as in flat; a visitor's chip opens its chat (at the Boss, Bank and Coffee corner at its request, `data-pvopen`, as the flat lobby).
- **FR-027** **Custom places** use the generic fixture (D5): a CSS kiosk the size of the Web fixture with the place's icon and name.

#### Live screens

- **FR-030** **Masked text only.** A screen shows the agent's newest output lines from the same source and through the same masking as the desk live readout (spec 001 FR-028..FR-031: `redact`, `maskSecretCommand`, `maskSecretUrl`, `maskHomePaths` via `DurbarSafeText`, masking before cutting) after main's MCP masking (`maskMcpEvent`). It reuses that function; it adds no parallel masker (spec 021 FR-031).
- **FR-031** **Inert and capped.** Screen text is set with `textContent` (never `innerHTML`, never Markdown), with no links, no images and no ANSI codes (stripped); at most 24 lines kept per agent and 200 characters per line; thinking text is shown only where the desk readout shows it today.
- **FR-032** **Small screens.** A screen under 150x60 px shows line-shaped bars (colour by kind: command, ok, error, question, plain) and the newest line as text; larger screens show real lines at 11 px (13 px when taller than 200 px). Text on a screen is never under 10.5 px; bars are decorative (`aria-hidden`).
- **FR-033** **Calm updates.** A screen repaints at most once every 2 s, adding lines at the bottom with a short slide (none under reduced motion); a caret blinks only on working screens and not under reduced motion or Serious mode.
- **FR-034** **Zoom.** Hover or keyboard focus on a screen opens a zoom panel (380-480 px wide) with name, role, status and folder, and the last lines at 12.5 px. It is placed in the nearest free area that **does not cover the hovered agent's own name plate or any needs-you plate**: first above the screen, then below, then beside; it never leaves the window. It closes on pointer leave, blur or Esc, and is announced by name to screen readers (a described region, not a live region).
- **FR-035** **Status screens.** Error screens get a faint red tint (FR-041), needs-you screens an amber frame, asleep screens are off (dark glass, no text), done screens show their last line in green.

#### People

- **FR-036** **Seated poses.** working → `typeA`/`typeB`; thinking, compacting, retrying → `think`; waiting and limit → `waveA`/`waveB`; error → `think` (still); done, idle → `rest`; asleep → no person, chair empty and screen off.
- **FR-037** **Who is who.** A session keeps the same person (`p01`..`p15`) for its life: the least-used person in its folder, then overall, stored like the crew pick (`durbar.realpeople`, spec 077 `pickCharacter` pattern); with more than 15 agents persons repeat, never two of the same in one zone when avoidable.
- **FR-038** **Cues.** Needs-you: a "?" bubble at the head and an amber halo; error: a "!" badge on the screen corner; thinking: three dots. All are overlays, inside the slot, never over text.

#### Lights (the owner's scheme)

- **FR-040** **Light parts.** Each desk has a **lamp** (a warm radial light on the desk and person), a **screen glow** (light from the monitor on the face), and a small **call light** (a dot on the desk corner). Each lobby fixture has one light of its own. All are CSS overlays (D4).
- **FR-041** **Status to light** (`lightFor(status, flags)`, pure):

  | State | Lamp | Screen glow | Call light | Motion |
  |---|---|---|---|---|
  | working | warm, steady | on | none | none |
  | thinking (compacting, retrying) | on | slow breathe (5 s) | none | breathe |
  | waiting (needs you) | brighter | on | **amber, gentle pulse (2.2 s)**: the strongest cue | pulse |
  | error | on | faint red tint | **small steady red** | none, no flashing |
  | limit reached | on | on | **orange**, steady | none |
  | done | dims to low | dims | brief green tick (2 s, then gone) | one fade |
  | idle, paused | low | low | none | none |
  | asleep (nap bed, stopped) | off | off | none | none |

- **FR-042** **Red stays small.** An error never tints more than its own desk's lamp area and screen; the room, zone and neighbours are never red.
- **FR-043** **Room brightness.** The room ambient follows the share of active agents (working, thinking, waiting, limit, error) among visible ones: from 70 % (none active) to 100 % (all active), eased over 1.5 s (instant under reduced motion). It is an overlay on the art layer only.
- **FR-044** **Readable at every light.** Name plates, folder signs, lobby plates, chips, the zoom and all text sit **above** the light layer and are never dimmed; their contrast is the theme's (spec 070 D4) whatever the lights do.
- **FR-045** **Lobby lights.** Library: a reading lamp on when someone is there. Bank: a counter lamp on when someone is there. Boss: a busy light over the door on when a queue forms (2 or more visitors, or 1 that needs the user). Coffee: the machine glows while someone is there. Terminal, Web, Software, Other tools and custom places: a soft fixture light when occupied. Unoccupied fixtures are at room light.
- **FR-046** **Not colour alone.** Every light repeats a cue that is also in words or icons (plate, badge, bubble); no state is shown by light only (constitution V).
- **FR-047** **Motion rules.** Under reduced motion or Serious mode no light pulses, breathes or fades: pulsing lights are steady at their bright level, the done tick shows for 2 s without a fade.
- **FR-048** **Cheap.** Lights use opacity and transforms only (compositor), no blur filters, no per-frame JavaScript; at most one CSS animation per desk.
- **FR-049** **Theme.** Light colours are fixed (warm white, amber, red, orange, green) for meaning (spec 070 FR-050); dark themes do not change the art or lights, only the chrome.
- **FR-050** **Contrast check.** The overlap check's Real office variant also measures the contrast of every plate and sign against its own background at room brightness 70 % and 100 % and fails under the theme's ratio.
- **FR-051** **Forced colours.** Under `forced-colors: active` the light layer and ambient are not drawn (`display:none`), and status words and icons carry the meaning; under `prefers-contrast: more` lights are steady and the ambient stays at 100 %.
- **FR-052** **Done tick, once.** The green tick shows once per transition to done, not again on re-render or resize.

#### Manual lighting (issue #692, phase P3)

- **FR-053** **Levels.** A room can be *Auto* (default, FR-041..FR-045), *Lit*, *Dim* or *Off*; a desk can *Inherit* (default) or have its own level. Manual levels set the lamp and the room ambient only.
- **FR-054** **Status cues win.** Call lights, the red error light, screen tints, badges and words are drawn at every level, *Off* included; *Off* never hides a desk or makes an agent look gone (it shows "lamp off" in the hover card, not "asleep").
- **FR-055** **Controls.** The room menu (`⋯`) gets **Lighting: Auto / Lit / Dim / Off**; the desk's context menu gets **Lamp: Room setting / Lit / Dim / Off**; both are menu radio items with names, keyboard and screen-reader operable, the current level checked.
- **FR-056** **Scope and storage.** Room levels are per folder path, desk levels per session id, stored locally in `localStorage` (`durbar.lighting`, JSON `{v:1, rooms:{}, desks:{}}`, at most 200 entries, oldest dropped); never synced, never in `durbar-settings.json`, no prompt or session content. A desk entry is dropped when its session is gone.
- **FR-057** **Bad data.** A malformed, wrong-version or oversized value is ignored and replaced by the default on the next write.
- **FR-058** **No motion.** Changing a level applies at once; nothing animates continuously because of a manual level.

#### Art pack

- **FR-060** **Ships in the app.** The art pack ships inside the app (no download, no network, CSP `img-src 'self'` unchanged), in `src/renderer/realoffice/art/`, copied by `scripts/copy-assets.js`. (Q2)
- **FR-061** **Lazy.** The Real office script, CSS and pictures load only when Real office is chosen (a `<script>` added on first use, pictures by `<img loading="lazy">` or `decode()`); flat mode fetches none of them.
- **FR-062** **Format and caps.** Every picture is WebP with alpha, no metadata chunks (EXIF, XMP, ICCP, C2PA; see FR-069 for what this removes), re-encoded at quality 0.80: a person frame at most 80 KB and at most 640 px tall (2x the largest shown size, spec 077 FR-051); a fixture at most 120 KB; the desk at most 60 KB; the floor at most 40 KB; the **whole pack at most 10 MB**. Fixtures are re-cropped from the back-wall render to a common floor line and full height (FR-023).
- **FR-063** **Provenance.** `src/renderer/realoffice/art/ASSETS.md` lists each source sheet with tool and version (Codex image generation, codex-cli version), date, maker, approver (Vikram), the exact prompt, the reference image, how it was cut and re-encoded, and the licence; it is checked by an extended `test:crew-assets` (or a sibling `test:realoffice-assets`) like spec 077 FR-054. The art moves into the repo only in the build PR, with this file.
- **FR-067** **Fictional people.** Every person image's prompt in `ASSETS.md` says that the person is fictional and must not resemble any real or famous person, and names no real person, celebrity, brand, logo or franchise. The build PR copies this clause into every prompt used for the pack; spec 096's wrapper rules (no real people, celebrities, franchise characters) are the model.
- **FR-068** **Resemblance check.** `ASSETS.md` records per person image a field `likeness-check`: the approver's name and the date of the check that no resemblance to a real person was found. A person with no such field is not committed. If a resemblance is reported later, the image is removed from the pack, replaced by a new one (which gets its own prompt clause and check), and the removal is recorded in `ASSETS.md` (image, date, who reported, replacement) and in the changelog; a shipped release carrying it gets a patch release.
- **FR-069** `[KNOWN GAP]` **Provenance is only in `ASSETS.md`.** The WebP re-encode and metadata stripping (FR-062) remove any C2PA / content-credential manifest the generator embedded, so the shipped files carry no machine-readable provenance. `ASSETS.md` (FR-063, FR-067, FR-068) is the only record of the tool, prompt, date and approver. The strip is kept because it is the spec 077 rule (no metadata in shipped art, privacy and size); the manifest is not re-attached.
- **FR-064** **Licence.** The art is MIT like the code and the crew art (README "License and credits"). (Q4)
- **FR-065** **Fallback.** A picture that fails to decode marks that person or fixture unusable for the session; the desk shows the initials disc, the fixture its plate only (spec 077 FR-055 pattern). The page never shows a broken-image icon.
- **FR-066** **Metadata.** `people.json` (per picture `w`, `h`, `headTop`, `bodyH`, `hand`; per stand pose the size) ships with the pack and is validated by the asset test (every listed file exists, every file is listed, numbers in range).

#### Motion

- **FR-070** **Frames.** Two-frame poses (`typeA/B`, `waveA/B`) alternate with CSS `steps(1)` at a per-agent period (1.15-1.5 s); `think` and `rest` breathe (scale 1.0-1.01, 4-5.5 s); visitors: treadmill bob (0.55 s), sip (4 s), knock (2.6 s), others breathe.
- **FR-071** **Off switches.** No person animation under reduced motion, in Serious mode, or with the 096 `characterMotion` setting off when it exists; a still frame (`typeA`, `waveA`) is shown.
- **FR-072** **Pose change.** A pose change cross-fades in 250 ms (instant under reduced motion).
- **FR-073** **Desk to lobby.** Leaving for a place: the person fades out at the desk and in at the fixture (300 ms total); coming back, the reverse.
- **FR-074** **Paused when hidden.** When the window is hidden or minimised (`document.hidden`), animations are paused and screens stop repainting; they catch up once on return.
- **FR-075** `[KNOWN GAP]` **No walking.** People do not walk between desk and lobby; spec 024 FR-005's walk is not drawn in Real office. Walking needs side-view walk frames that the pack does not have.

#### My characters (phase P3, with spec 096)

- **FR-080** **What a My character needs here.** Real office needs front-facing seated frames (type ×2, wave ×2, think, rest) and standing frames (at least `letter`, `book`, `coffee`). 096's preset `realistic-office-v1` makes three-quarter isometric portraits, which do not fit; P3 adds a second preset **`real-office-front-v1`** to 096's `STYLE_PRESETS` (a new id, per 096 FR-051) with the seated-sheet and standing-sheet prompts of this pack's `ASSETS.md`, through 096's pipeline (validation, re-encode, store).
- **FR-081** **Opt-in.** A My character made with `real-office-front-v1` is offered in Real office; others are not. When the Characters setting is `mine` and a folder pin (096 FR-033) names such a character, that folder's agents use it; otherwise the Office people are used (D3, FR-084).
- **FR-082** **Same rules.** My characters' frames follow FR-062 caps and FR-065 fallback, load as `blob:` URLs as in 096 FR-043, and their `people.json`-style metadata is computed by 096's encoder (head top, body height, hand line), checked in range.
- **FR-083** **Until then.** While a chosen crew has no Real office pictures, Real office shows the Office people and Settings says so in one line under the Office layout row: "Real office shows its Office people for now: how this crew appears there is still being decided." (only when Real office is on and the Characters choice is a crew).
- **FR-084** **Character sets in Real office** (owners 2026-10-31, D3). `crew.js` `realOfficeSet(choice)` is the one seam: it returns the set and the scene Real office draws for a Characters value and whether Settings shows FR-083's note. `REAL_OFFICE_SETS` lists the sets with Real office pictures; today only `office` (the Office people). Adding a crew there (with its pictures and their provenance, approved per picture by the crew owner, spec 077 FR-054) is the whole change on the people side; the scene adaptation for crews is Q6's pending proposal.

#### Accessibility and checks

- **FR-090** **Names.** Each desk is one focusable button with the accessible name "<name>, <role>, <status word>, <task>[, needs you][, at <Place>]"; screens and people are not separate tab stops; lobby visitors are reachable through their place plate.
- **FR-091** **Fit check.** `check:office` gets a Real office variant (SIM 12 and 15, 1440x900 and 1280x800, chat closed and open): no overlap of plates, signs, chips, screens and people; no clipped text; no text under 10.5 px; no page overflow; the desk face size reported.
- **FR-092** **Screenshots.** `shots:docs` gets Real office pictures at both sizes (15 agents, 3 agents, the lights at each status, the hover zoom), each with its `DOC_SHOTS` driver.
- **FR-093** **Simulator.** The simulator drives every status, a limit, visits to every place (custom ones too), helpers, and streaming output with hostile strings, so Real office is fully testable with 0 AI credits.

### Key Entities

- **Office view preference**: `flat` | `real`, renderer `localStorage` (`durbar.officeview`).
- **Art pack**: WebP pictures + `people.json` + `ASSETS.md`, shipped, lazy-loaded.
- **Person assignment**: session id → person id (`p01`..`p15`, later a My character id), `localStorage`.
- **Light state**: derived per desk and fixture from status, flags, visits and the active share; not stored.
- **Lighting preference** (P3): `{v:1, rooms:{folderPath: level}, desks:{sessionId: level}}`, `localStorage`.
- **Layout result**: `{u, lobbyH, rows[{zones[{desks[rect, person, screen, plate]}]}], fixtures[]}`, pure.

## Success Criteria *(mandatory)*

- **SC-001** With 15 agents (helpers included) at 1440x900 and 1280x800, chat closed and open, Real office passes the overlap, clip, 10.5 px and overflow checks (FR-091).
- **SC-002** Desk faces are at least 40 px tall with 15 agents at 1280x800 (mockup: about 36 px), measured by the check.
- **SC-003** With 1-4 agents, each screen shows at least 8 readable lines at 11 px or more.
- **SC-004** Flat mode is unchanged: `check:office` and every existing screenshot driver pass without change, and flat mode loads no Real office file (checked by a request log in the driver).
- **SC-005** No screen ever shows an unmasked token, MCP secret value or home path from the hostile simulator fixture (test and driver).
- **SC-006** The art pack is at most 10 MB and every picture is within its cap (asset test).
- **SC-007** The layout engine runs under 5 ms for 40 agents in 8 folders and is unit-tested for 1..40 agents.
- **SC-008** The owner looks at the P1 screenshots and says the office looks real and nothing is too small (`real:` owner review, quoted in the spec).

## Assumptions and honest limits

- The art was made by Codex image generation on the owner's plan; re-making or adding people costs plan usage and needs his OK (AGENTS.md *No AI credits*). The build uses the existing 194 files.
- Lobby faces may stay under 18 px with 15 agents (FR-024): the band cannot grow without taking desk space, which the owner ruled out. Recorded as a target, else `[KNOWN GAP]`.
- No walking animation (FR-075).
- People repeat past 15 agents (FR-037).
- Verified so far only as a standalone mockup in Chromium on Linux; nothing in the app. Windows and macOS: CI only, as for every renderer feature (constitution VI).
- Installed app size grows by up to 10 MB; there is no package size budget today to check it against (spec 008 has none).

## Open questions

Each has a recommendation (Q6 is for Paco, the crew owner). The build waits for answers to Q1, Q2 and Q4; the P3 part that depends on Q6 and FR-081/FR-083 follow D3 until he answers.

- **Q1 Where to choose the mode.** *Answered 2026-10-31 (Vikram): the recommendation, see Changes.* (a) A third button **Real office** in the existing *Office layout* row; (b) a separate *Office style: Flat / Real* row. **Recommendation: (a)**: one place, and Real office is by nature an open office (it has no cabins), so the row's three choices are mutually exclusive.
- **Q2 Ship or download the art.** *Answered 2026-10-31 (Vikram): the recommendation, see Changes.* (a) Ship in the app (+up to 10 MB, works offline, no new network code or CSP change); (b) download on first use. **Recommendation: (a)**, lazy-loaded (FR-060, FR-061); a download adds a network path, integrity checks and an offline failure mode for 10 MB.
- **Q3 Does #692's manual lighting also come to the flat office?** *Answered 2026-10-31 (Vikram): the recommendation, see Changes.* **Recommendation: Real office only** (P3); flat has no lamps to dim, and #692 asks to keep the current look by default. #692 stays open, linked to this spec, and is closed by the P3 PR if the owner agrees.
- **Q4 Art licence.** *Answered 2026-10-31 (Vikram): the recommendation, see Changes.* **Recommendation: MIT**, like the code and the crew art (spec 077), recorded in `ASSETS.md`; the owner confirms, since he approved the generation on his plan.
- **Q5 Where finished and asleep agents go.** *Answered 2026-10-31 (Vikram): the recommendation, see Changes.* (a) They stay at their desk with lamp and screen off (asleep) or low (done); (b) a lounge strip with couches as in flat. **Recommendation: (a)**: no extra furniture without function ("dont unnecessarily waste screenspace"); asleep desks are narrow (0.62, like away desks).
- **Q6 (for Paco) Does Real office ignore the Characters setting?** *Answered in part 2026-10-31, see Changes: no, crews appear in Real office in their own art and in their own world (Cheeky to the loft, Prehistoric to the cave), approved by Vikram 09:05 UTC and agreed by Paco 09:04 UTC; see FR-100, FR-114, FR-115.* (a) Yes, it always draws its own realistic people, so a user on Cheeky or Prehistoric (spec 077) never sees those crews in Real office, and only My characters (096, P3) can replace the pack (D3); (b) Real office also offers the 077 crews, drawn flat in front of the photoreal room. **Recommendation: (a) = D3**: a cartoon crew in a photoreal room breaks the picture. D3, FR-081 and FR-083 (and tasks T017, T051) stay as written, as the default, until Paco answers; FR-083's Settings line stays in either case if (a). Crew owner of 077 and 096: Paco (fjcabello); raised in his review of this PR, 2026-10-31.

## Constitution check

- **I Spec Kit**: this PR is spec, plan and tasks only; code follows per phase.
- **II Adapters**: renderer-only; no adapter or vendor type touched.
- **III Safe by default**: screen text reuses the masking path (FR-030), inert text only (FR-031); lighting preferences hold no content (FR-056); CSP unchanged in P1-P2 (FR-060), `blob:` only via 096 in P3.
- **IV No AI credits**: simulator and unit tests only; the art already exists; new art needs the owner's OK.
- **V Calm, legible UI**: 15-agent rule, 10.5 px, no colour-only state, reduced motion and Serious mode stop motion, no flashing, no blur (FR-044..FR-051, FR-070..FR-074).
- **VI Parity**: renderer CSS/JS and WebP only; no OS paths.
- **VII Quality gates**: unit, overlap and screenshot tests per phase (FR-091..FR-093).
- **VIII Honest limits**: lobby face size, walking and people repetition are written as gaps.

## Changes

### 2026-10-31: owner answers (Q1-Q6, lobby places) and the phase P1 build

**Owner answers** (Telegram, relayed to the build agent by Vikram's coordinating agent; quoted as relayed):
- **Q1-Q5**, Vikram, 08:44 UTC, "ok" to the recommendations: Q1 (a) a third button **Real office** in Settings > Office layout; Q2 (a) ship the art pack in the app, loaded lazily; Q3 #692's manual lighting is Real office only, in P3; Q4 MIT; Q5 (a) finished and asleep agents stay at their desk: asleep with lamp and screen off on a narrower desk (0.62, like an away desk), done with lamp and screen low on its own desk.
- **Q6**, Vikram, 08:46 UTC: "they appear, support all characters together - characters to be in both modes". Paco (crew owner), 08:53 UTC, relayed by his agent in the team chat: "yes", crews appear in Real office. Vikram, 09:03 UTC: the crews are **not** remade as realistic people; they stay in their own art. Vikram proposed crew worlds at 09:03 UTC and approved them at 09:05 UTC ("ok"); Paco agreed at 09:04 UTC. Recorded answer: **crews appear in Real office in their OWN WORLD (Cheeky to the loft, Prehistoric to the cave), keeping their own art plus a few standing poses in their style; Paco approves every crew-world image before it is committed** (spec 077 FR-054). The requirements are FR-100 (worlds), FR-114 (the World setting) and FR-115 (per-world packs), in the worlds delta below. D3 is reversed (the Characters setting applies in both modes). `[KNOWN GAP]` P1 does not build the crew worlds: a crew still shows the Office people with FR-083's Settings note, until those worlds ship.
- **Lobby places**, Vikram, 09:03 UTC: "why do you say library 1, bank 1... those spaces are shared and I hope you will not have multiple of them - they can be crowded and it's ok, you can dynamically adjust horizontal space". One fixture per place, crowds allowed, widths that follow the crowd, no bare count, `+N` only past what fits: FR-025 and FR-026 rewritten.

- **Lobby realism**, Vikram, 10:19 UTC: "when people stand or are on treadmill - they are not properly positioned on floor, it must be real". So: every lobby visitor's feet (the lowest opaque row of its picture, measured from the alpha when the art is prepared and kept per picture in `people.json` `stand.<person>.feet` and `top`) stand on the band's floor line within 2 px, with a soft contact shadow; a treadmill user stands on the treadmill's deck (the deck is in the picture, so its base is the foot line); people are scaled against the Boss door: a door about 2.1 m, a person 1.7 m (one scale per person, from its upright pose). FR-024 changes with it (below).

**Phase P1, as built** (this delta's PR; tasks T010..T027):
- **Changed requirements**: D3, FR-025, FR-026, FR-081, FR-083 (above); **new FR-084** (character sets in Real office: the `crew.js` `realOfficeSet` seam; default the Office people; a crew without Real office pictures shows the Office people with FR-083's note). Numbers checked against `main` and open PRs: FR-084, T025, T026, T027 are new.
- **FR-011, FR-019** (search): the rows' geometry does not depend on the order of rows or of zones in a row, so the engine searches every split of the folders into at most 4 groups (187 splits for 6 folders, 715 for 7) instead of every order times every contiguous split, exhaustively up to 7 folders, then rows of about equal size; rows and zones keep the app's folder order, so a status change never moves a folder; 16 halvings of `u` (b2.js used 30). Past the 15-agent scale (scrolling) any number of rows. A folder too big for one row is split into parts over rows; the sign repeats as "<name> (continued)". `test:` 0.24 ms for 40 agents in 8 folders, 3.5 ms for 15 in 7 (dev machine, CPU time).
- **FR-012, SC-002**: a desk face is measured as crown to chin, `0.30 u` (read on 6 of the 15 people: 0.27 to 0.41); `u` is at least 94 px (a 28 px face). With the simulator's 15 agents: 43.4 px at 1440x900 and 38.3 px at 1280x800 (`check:office` Real office variant; 34.3 px at 1280x800 with the read-only notice strip shown). `[KNOWN GAP]` SC-002's 40 px is not met at 1280x800; the check keeps a 35 px ratchet.
- **FR-013, FR-014, FR-015**: the desk picture is cut at the row's bottom (its lower legs); the head room covers a raised hand of every seated person in the row whatever their status, and the plate room is the needs-you height, so no status change moves a desk (`test:`). FR-022's status order still reorders who sits where in a zone.
- **FR-016, FR-090**: the plate is the desk's one button (name, role, helpers; status dot, word and the masked task; an away or asleep desk's plate drops the role so the name fits); its accessible name is "<name>, <role>, <status word>, <task>[, needs you][, at <place>]. Open chat panel." and its title is the flat desk's tooltip (`deskTip`). A click on the person, desk or screen clicks the plate (FR-006).
- **FR-023**: the fixtures are re-cropped from the back-wall render to one top and one floor line, so each is whole and all share a scale (`people.json` `fixtures`, `fixtureTop`, `floorLine`).
- **FR-024**: visitors stand on their measured feet and at 1.7 m against the 2.1 m door (owner 10:19 above; `test:` the anchor and the scale, `sim:` the driver measures every visitor's feet against the floor line, offsets 0 to 0.1 px). Lobby faces are then about 16 px with 15 agents at 1280x800 (an estimate: 0.13 of the standing height): `[KNOWN GAP]` FR-024's 18 px target gives way to the owner's realism rule; a ratchet keeps 11 px.
- **FR-030..FR-035** (screens) are phase P2: in P1 a monitor shows decorative line bars (`aria-hidden`) and its status colours (error red, needs-you amber, asleep off), never text, so no agent output reaches the screen yet.
- **FR-036, FR-070** (motion) are phase P2: P1 shows each pose's first frame.
- **FR-037**: `assignPeople` gives a new session the least-used person in its folder, then overall, kept in `durbar.realpeople`; the simulator and the demo use the seeded pick of spec 077.
- **FR-041, FR-052**: the done row's green tick is a green call light for 2 s after the transition, fading (steady under reduced motion), once (`doneTick`).
- **FR-043**: the ambient is a dark overlay over the art at `(1 - ambient) x 0.75` opacity, eased over 1.5 s.
- **FR-045**: the Postbox has no visitors and no light.
- **FR-050**: the plates, signs, place plates and chips sit above the lights and the ambient on opaque theme backgrounds; the check measures each text against its own background with the ambient forced to 0.7 and to 1 and needs 4.5:1 (lowest seen 10.8:1 on Clean Office). Other themes: `[KNOWN GAP]` not run.
- **FR-060, FR-061, FR-066**: the page's CSP has no `connect-src`, so `people.json` ships as a script, `realoffice/art/people.js`, written by `copy-assets.js`; the first switch to Real office adds `realoffice.css`, `../shared/lights.js`, `../shared/realoffice-layout.js`, `people.js` and `realoffice.js`; flat mode requests none of them (`sim:` the driver and the check read the page's resource list). The compiled shared modules are plain page scripts, so their private names carry a prefix and a test loads them together with the other shared modules.
- **FR-062, SC-006**: the pack is 192 pictures, 5.68 MB: the largest person frame 54 KB at most 640 px tall, fixtures under 10 KB, the desk 28 KB, the floor 9 KB (`test:realoffice-assets`).
- **FR-065**: a picture that fails takes its person out for the session: the desk shows the initials disc (`sim:`).
- **FR-067, FR-068**: the generation prompts of 2026-10-31 describe invented people and name no real one, but they predate the fictional-people clause; `ASSETS.md` records the clause beside each person sheet (`fictional:`) and says so. Every person sheet's `likeness-check` reads `pending (Vikram)`: he approved the people when he saw the v2 mockup, but no likeness check is on record. `[KNOWN GAP]` until he confirms; a release must not ship with a pending entry.
- **FR-091**: `OFFICE_VIEW=real node scripts/check-office-overlap.js` (a `check-parallel.js` job): SIM 12 and 15, 15 in one folder (`simrooms=1`) and in 15 folders (`simrooms=solo`), both sizes. "Chat open": the chat takes the window and hides the office (spec 001), so the check asserts no page overflow while it is open and the same office after it closes.
- **FR-092**: `shots-097-realoffice.js` (in `ui-suite.js`; `DOC_SHOTS` for the two pictures the README links): 15 agents ([1440x900](../../docs/screenshots/097-real-15-1440x900.png), [1280x800](../../docs/screenshots/097-real-15-1280x800.png)), 3 agents ([1440x900](../../docs/screenshots/097-real-3-1440x900.png), [1280x800](../../docs/screenshots/097-real-3-1280x800.png)), [the lights with 8 agents](../../docs/screenshots/097-real-lights-1440x900.png), [the Settings row](../../docs/screenshots/097-office-layout-1440x900.png). The photo-heavy pictures cannot be palette-compressed within the quality guard (mean error 1.3 to 1.4), so they stay out of the website's 8 MB budget: the README links only the two that compress.
- **Not in P1**: live screens, the hover zoom and motion (P2); My characters and manual lighting (P3); SC-008, the owner's look at the P1 pictures (T022). Not run on Windows or macOS (CI only).

### 2026-10-31: worlds, the lift in the world, chat and answers in the world (experience inventory; branch `097-real-office-worlds`)

A separate section from the P1 build's delta (branch `097-real-office-p1`), so the two do not edit the same lines. Spec only; nothing here is built.

**Sources.**
- The owner's question (Vikram, Telegram, 2026-10-31 09:56 UTC): floors and the lift, moving between floors, the chat window, the question and answer experience, and "the full app adapts".
- Vikram's agent's experience inventory and mockups of three worlds (outside the repo: `INVENTORY.md`, 89 surfaces, 27 world moments, 16 candidate FRs; 47 screenshots; described in spec 098 *Evidence*).
- The team decision of 2026-10-31 10:00 UTC (all three sides; Paco's and Ruben's agents validated it at Vikram's request; owner Vikram), written down as **spec 098 (Experience contract)**: the registry holds **world moments only**, tool surfaces adapt through tokens, and the world matrix is **artifacts only, never in `DOC_SHOTS`**. The inventory's candidate FRs are adjusted to that: candidate 15 (a registry of every surface) is replaced by spec 098, and no `AGENTS.md` line is added.
- **Q6** (answered; supersedes the "pending a proposal" part of the P1 delta): crews appear in Real office in their own art **with their own world** (Vikram 08:46 UTC; Paco 08:53 and 09:04 UTC, relayed in the team chat). **Paco approves all crew-world art** (each picture, before it is committed).
- **Owner decisions, Vikram, 2026-10-31 10:19 UTC** (relayed by his coordinating agent): "floor numbering must be natural" (FR-116); "when people stand or are on treadmill - they are not properly positioned on floor, it must be real" (FR-117).
- **Critique taken in** (the mockups' lift ride): full-screen lift doors waste space and hide what does not change. The ride covers **only the desk area**; the lobby band, top bar and lift stay in view (FR-102). The lobby is the same on every floor (092 D1), so hiding it carries no information.

Numbers checked 2026-10-31 against `main`, the P1 branch and open PRs: 097 uses FR-001..FR-093 (P1 adds FR-084) and T001..T063 (P1 adds T025, T026). This delta takes **FR-100..FR-117** and **T100..T127**.

#### Worlds

- **FR-100** **Worlds, not one pack.** Real office draws a **world**: a scene pack filling spec 098's blocks (person, light slots, speech bubble, slip, lift, panel frame, desk with screen, fixture), a people set, a chrome token set (spec 070) and a motion set. Worlds: `photo` (*Photo office*, the Office people of P1, default), `cave` (*Prehistoric cave*, the Prehistoric crew of spec 077), `loft` (*Cheeky loft*, the Cheeky crew). **Crews pick the matching world**: the Characters value `prehistoric` gives `cave`, `cheeky` gives `loft`, `theme`, `minimalist` and `mine` give `photo`, unless the World setting (FR-114) names one. The people of a world are always that world's set, so a cartoon crew is never drawn in the photo office. P1's seam `realOfficeSet(choice)` (FR-084, P1 delta) returns the world; a crew whose world is not shippable keeps FR-083's note.
- **FR-112** **`missing` blocks shipping a world.** A world is offered only when spec 098's registry (`docs/experience/world-moments.json`) marks it shippable, and it may be marked so only with no world moment `missing` (098 FR-024). Today **9 world moments are missing in every world**: lounge, walk, empty office, first run, floor jumps, inbox, limit card, MCP elicitation, coffee break. Each is designed (and built) or deliberately `fallback-flat` before its world ships. For the photo world, Q5 (finished and asleep agents stay at the desk, lamp low or off) and FR-073 (cross-fade) already describe the lounge and the walk; recording them is part of T125. The app's list of offered worlds equals the registry's shippable worlds (`test:`).
- **FR-113** **Tool surfaces use tokens only.** Settings, dialogs, the palette, the navigator, the keyboard sheet, toasts, previous sessions, notes, schedules, MCP screens, the List view, the composer and every other tool surface take the world through spec 070 tokens only (colours, fonts, radii, shadows): no art behind text and no size change (070 D2). Each world ships a token set that passes 070 D4 contrast, in light and forced-colours modes. Held by 098's token lint (FR-040) and tool-surface driver (FR-041).
- **FR-114** **Settings: a World choice.** With Real office chosen, Settings > Detail level > Office layout shows a **World** row: *Match my characters* (default), then one radio per shippable world (*Photo office*, *Prehistoric cave*, *Cheeky loft*). Stored in `localStorage` `durbar.world` (`match` or a world id), read in a `try`; a bad or unshippable value means `match`. FR-083's line becomes "World: <name>" (with "chosen by your characters" when matching). A radio group: keyboard and screen-reader operable, tokens only.
- **FR-115** **Per-world 10 MB lazy pack.** FR-062's 10 MB cap is **per world pack**. Each pack lives in its own folder, `src/renderer/realoffice/worlds/<id>/` (P1's `realoffice/art/` becomes `worlds/photo/`, a move with no content change), and loads only when that world is shown: flat loads none, a world loads no other world's files, and switching worlds drops the old world's pictures. `test:realoffice-assets` checks each pack's cap; the driver checks the request log. README lists the size per world.

#### The lift and floors in the world

- **FR-101** **The lift is the world's shaft.** In Real office the 092 lift panel is drawn with the world's lift block: 56-64 px wide, the shaft picture behind, round buttons at least 40 px with the floor name under each at 10.5 px or more, and a cabin outline at the current floor. Semantics are 092's (FR-006, FR-007, FR-013..FR-016, FR-028, FR-032): toolbar role and name, one tab stop, `aria-current`, badges only for other floors, the All button, edge summaries. Its width counts in the layout and the fit check (FR-021, FR-091; 092 FR-008).
- **FR-116** **Natural floor numbering in the world** (owner decision, Vikram, 2026-10-31 10:19 UTC: "floor numbering must be natural"). In Real office the building is drawn as a real one: the **ground floor is at the bottom and higher floors go up**. The first floor of the Floors list is the ground floor, number 1, at the bottom of the shaft and of All floors; floor *n* is drawn above floor *n − 1*. The lift's buttons are drawn and ordered top to bottom from the highest floor down, with *All* above them; Up/Down arrows move to the button drawn above or below; **PageUp goes to the floor drawn above** (the next number up) and PageDown to the one below, in Real office. Names, numbers, badges and the announcement "Floor <name>, <n> of <m>" (092 FR-007, FR-012) are unchanged. **Relation to spec 092:** 092 Q-A / D3 (Paco, 2026-10-27) puts the first floor of the list at the **top** of the flat lift, with PageUp going up the list. The flat lift is **not** changed by this delta; whether it should follow natural numbering too is raised as an open question in spec 092 (*Changes*, 2026-10-31, Q-D), for the owners.
- **FR-102** **The ride.** A floor change in Real office plays the world's ride (photo: steel doors close, the cabin moves, the doors open; cave: the view drops through the rock shaft past the basket; loft: the scissor gate folds shut and open) in **560-640 ms**, `transform` and `opacity` only, on 092 FR-009's `motion()` path: a second request retargets, input is never blocked, a resize ends it at the right place. **The ride covers only the desk area**; the lobby band, top bar and lift stay in view (critique above). **Instant under reduced motion or Serious mode** (092 FR-010), with the floor display (FR-103) held for 1 s. The 092 FR-012 announcement is unchanged; while a chat covers the office no ride is drawn (092 FR-018). **Dependency:** 092 phase 3 (T022..T027, the slide) is built first, or the PR that builds this ride builds 092 phase 3 to 092's requirements and ticks its tasks.
- **FR-103** **Floor display.** During the ride and for 1 s after, a display shows the target floor's number, name and needs-you count ("▼ 2 · Client A", then "2 need you here"), drawn by the world (glass with amber digits, carved plank, neon sign) on an opaque face, text at least 10.5 px. It is `aria-hidden`; 092 FR-012's announcement is the accessible copy. Not colour alone.
- **FR-104** **All floors as storeys.** The All floors view (092 FR-031..FR-037, instant) draws world slabs between storeys (the lift block's storey slab), a storey tag per floor ("1 Main") at the right edge, and the cabin outline across the shaft; storeys follow FR-116 (floor 1 at the bottom). In Real office the storey tag replaces 033's floor tag in zone signs. The 15-agent rule holds over all floors with the shaft's width taken out (092 FR-033).
- **FR-105** **Building preview** (optional per world). Hovering or focusing **All** shows the world's cut-away building with each floor's agent count and needs-you count as text on opaque chips. It is not a tab stop; the counts are also in the All button's accessible name; it closes on pointer leave, blur or Esc; nothing animates under reduced motion. A world without the picture shows no preview, and that is not a gap.
- **FR-111** **Jumps ride the lift.** 092 phase 4 jumps (inbox, notification, navigator, status pill) ride the lift (FR-102) to the agent's floor in Real office and then open the chat; while the chat covers the office no ride is drawn (092 FR-018); instant under reduced motion or Serious mode.

#### Chat, questions and approvals in the world

- **FR-106** **Chat in the world.** The chat panel (spec 005) keeps its structure, controls, words and tab order, and in Real office gains:
  - a **desk-side column** with the person at their desk in the pose of their status, lamp and call light, a plate with name, status word and lamp state in words (FR-107) and helper chips; 300 px wide from 1440 px window width, 250 px from 1200 px. It is drawn **only when both hold**: the window is at least 1200 px wide, **and** the chat panel (log, header, tab bar, composer) still keeps spec 005's minimum width of **480 px** (FR-040, FR-058: the 480px rule, the one width spec 005 tests) after the column's width is taken out of it; the stricter of the two wins. Otherwise the column is dropped and the header portrait carries the identity;
  - the **world surface** (the panel-frame block) behind all text, **at least 78 % opaque**, every text pair checked for contrast (4.5:1, 3:1 for large text) against the composited surface by the driver;
  - a **header portrait** (64 px, the person block's portrait) with a lamp ring and dot.
  The question, permission and elicitation cards point a speech tail at the person in the column when it is shown. Opening keeps the existing 280 ms slide; nothing moves under reduced motion. The text is never on a picture.
- **FR-107** **Lamp state in words.** The FR-041 row is also given as a fixed phrase ("Lamp warm, steady", "Lamp bright, amber call light", "Lamp on, red error light", "Lamp low", "Lamp off"; `lampWords(lightFor(...))`, pure) in the hover card, the chat header and the desk-side plate, so lights are never the only cue (FR-046) in the chat either. The words are the same in every world (a flame or a neon strip is still "Lamp").
- **FR-108** **Questions as a speech bubble.** Hovering or focusing a waiting desk on the floor opens a **speech bubble** (098 speech-bubble block) at the person's head: "<Name> asks: …" with the answer bar's options (spec 052: at most 4 options of at most 40 characters), Other answer, Skip and Show in chat; a longer question shows only "Answer in chat" (052's 480-character rule). It **reuses the inbox and answer-bar component** (`wireAnswerBar`, 052 FR-016, FR-060, FR-162, FR-177), not a copy (spec 021 FR-031).
- **FR-109** **Approvals as a slip at the Boss door.** A pending approval shows as a **slip** (098 slip block) at the Boss fixture: "<Name> needs your OK: …" with the inbox's exact buttons (Allow once / Allow "<scope>" for this session / Deny / Show in chat), the same primary and danger styling and the **A/S/D keys**. **Keys act only with keyboard focus inside that slip (or bubble):** never on hover alone (a hover-opened slip takes no keys until it is focused), never while focus is in the composer or any other text field, and never from anywhere else on the page; A/S/D, Enter and the option keys all follow this. Several slips stack oldest first (the inbox order); past 3, a `+N` opens the inbox. Same reused component as FR-108.
- **FR-110** **Bubble and slip rules.** Exact wording, labels, order and A/S/D keys as the inbox and answer bar; screen-reader text unchanged ("<name> asks: …", "<name> needs your OK: …"). A bubble or slip **never covers** a name plate, chip, needs-you plate, lobby plate or the lift (placed with FR-034's `zoomRect` and that avoid list), and **closes on Esc** with focus back on its desk or fixture. **Test:** the heading words, button labels, their order and the keys are identical in flat and in every world (`test:`, comparing the component's output with each world's pack).

#### People on the floor

- **FR-117** **Standing people are grounded** (owner decision, Vikram, 2026-10-31 10:19 UTC: "when people stand or are on treadmill - they are not properly positioned on floor, it must be real"). Every standing figure in the lobby (visitors in every pose, the treadmill user included) stands **on the floor line of its fixture's band**, at the right scale against the fixture, with a **contact shadow** under the feet; nobody floats or stands on nothing.
  - **Foot line**: the layout places each standing figure so that its frame's `floorLine` (098 person block) lands on the band's floor line, **within 2 px**; for the treadmill (`tread`) the floor line is the treadmill deck's top, an anchor of the Terminal fixture.
  - **Scale**: each figure's drawn height = its `realHeight` (default 1.70 m) × the fixture's px-per-metre, from the fixture's known real height (098 fixture block `realHeight`: a door about 2.1 m, a counter about 1.1 m, a shelf about 2.0 m), within 5 %. Crowding (FR-025) may move people closer, never shrink one person against its own fixture.
  - **Contact shadow**: an ellipse under the feet at the foot line (098 contact shadow), drawn under the person and over the floor; it carries no meaning, so forced colours hide it with the art (FR-051).
  - **Test** (`test:realoffice-layout`): for every place and pose, 1, 5 and 12 visitors, both sizes, each standing figure's foot line equals the band's floor line ± 2 px and its height matches the fixture scale ± 5 %. **Driver check** (`check:office` Real office variant): for each visible visitor, the measured bottom of the figure's opaque pixels (alpha) is within 2 px of the band's floor line and a contact shadow element sits under it.

#### Open question

- **092 Q-D (for 092's owners)**: should the flat lift also follow natural numbering (ground floor at the bottom)? Raised in spec 092 *Changes* (2026-10-31); not decided here. **Recommendation** (written there): change the flat lift too, so the two modes never disagree about which way is up; it reverses 092 D3, so Paco (who chose Q-A) and Vikram decide.
