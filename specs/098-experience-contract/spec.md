# Feature Specification: Experience contract (world moments, tool surfaces, world matrix)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Experience contract (team decision 2026-10-31, all three sides): a small registry of world moments only, three surface kinds (world moment, tool surface, outside the world), a world matrix run weekly and as a small path-filtered PR subset, one rolling world-coverage issue, a block contract for world packs; enforced by tests, not rule text
note: spec, plan, tasks drafted; registry seeded (26 world moments, 9 missing per world); nothing built
status: draft
-->

**Feature Branch**: `098-experience-contract` (spec); code branches `098-pN-slug`, one per phase

**Created**: 2026-10-31

**Status**: Draft (2026-10-31). Spec, plan, tasks and the seeded registry only; no check, driver or workflow is built.

**Input**: Owner question (Vikram, Telegram, 2026-10-31 09:56 UTC): floors and the lift, moving between floors, the chat window, the question and answer experience, and "the full app adapts" in Real office (spec 097). Vikram's agent answered it with an experience inventory and mockups in three worlds (outside the repo, described under *Evidence*). How to keep that inventory honest as the app grows was then agreed in the team chat.

## Decision (binding)

**Source: the team chat, 2026-10-31 10:00 UTC, all three sides.** Vikram's agent proposed the design below; Vikram asked Paco's and Ruben's agents to validate it, and both did (Paco's agent, Ruben's agent, relayed in the team chat; owner: Vikram). Ruben's agent added one condition: pull requests must not get another 25-minute job. This spec writes the design down; anything it adds is marked as a decision of this spec (D1..D6) and may be changed by the owners.

1. **A registry of world moments only.** A small, closed set, rarely extended: the inventory's 27 world moments, trimmed to 26 (D1). Tool surfaces are not registered one by one.
2. **Three kinds.** *World moment*: designed per world from shared blocks. *Tool surface*: adapts only through spec 070 tokens, held by a token lint (extending the theme-token test) and one driver that screenshots Settings, one dialog and one list in each world. *Outside the world*: native surfaces (the browser pane's `WebContentsView`, OS dialogs); never a gap.
3. **A world matrix** of world moments × worlds: the full set at 2 sizes weekly; pull requests that touch a world pack or a registered world moment (path-filtered) get a small subset, moments × worlds at one size. Artifacts only, never committed, outside `DOC_SHOTS` and `shots:docs`; the site budget (spec 050) is untouched. Red means owned (spec 021 FR-063).
4. **Gaps**: one rolling "World coverage" issue that the weekly job updates; no per-gap issues.
5. **Zero `AGENTS.md` lines.** Enforcement is the test, one line in the spec template's *Experience* section, and one PR template checkbox.
6. **A block contract**: the shared blocks (person portrait and pose frames, light slots, speech bubble, slip, lift shaft and cabin, panel frame, desk with screen, fixture) have defined sizes, anchor points and light slots, so a new world means filling N blocks and cannot invent layout.
7. **The art pipeline is not in this spec.** It gets its own spec on Paco's side (the Codex recipe and style per world, `ASSETS` provenance, a tested owner-approval field). This spec only requires that a world's assets pass that check (FR-080).

## Why a new spec

The contract is used by spec 097 (Real office and its worlds) and by every later spec that adds a screen, and it adds a registry, a static check, a token-lint extension, two drivers and a workflow. As a delta of 097 it would tie a repo-wide check to one feature; as a delta of 070 it would bury the world matrix in a theming spec. So it is a new spec, number **098**. Checked 2026-10-31: `origin/main` has specs up to 097; remote branches go up to `097-real-office` (and the local build branch `097-real-office-p1`); no open PR uses 098 (the only open PR is #915, `080-browser-tabs-build`).

**One rule in, one rule out** (spec 021 FR-063): this spec adds a checkable rule ("a world-moment root carries a registered `data-surface`; tool surfaces use tokens only"), and it gets scripts (FR-020..FR-026, FR-040..FR-043). It adds no `AGENTS.md` line and replaces the inventory's proposal of one ("a new user-facing surface gets a `data-surface` and a `surfaces.json` row"), which is dropped.

## Context: what exists today

- **Theme tokens** (spec 070): typed tokens for colours, fonts, weight, radii and shadows; sizes, spacing and density are not themeable (070 D2); contrast per pair (070 D4). `test:theme-tokens` (070 FR-040) counts colour literals and `font-family` declarations per renderer file against a ratchet (`scripts/fixtures/theme-literals.json`) that only goes down. It reads `styles.css`, `screens.css`, `themes.css`, `app.js`, `screens.js`, `scenekits.js` and `index.html`; it does not read the Real office CSS of spec 097 P1, and it counts no size literals.
- **Real office** (spec 097): one photoreal world in P1 (the *Office people*, on branch `097-real-office-p1`, not merged); crews appear in their own art and world (097 Q6, answered 2026-10-31). The 097 worlds delta (branch `097-real-office-worlds`) adds worlds, the lift as the world's shaft, chat and questions in the world, and requires this spec's registry for shipping a world.
- **Screenshots**: `shots:docs` and `DOC_SHOTS` (`scripts/shots-docs.js`) keep the pictures linked from the README, the site and specs, committed under `docs/screenshots/`; the site has an 8 MB budget (spec 050 FR-012). Drivers run through `scripts/ui-suite.js` with the simulator.
- **Scheduled workflows**: `nightly-watch.yml` opens or updates an issue when a listed scheduled workflow fails; `weekly-retro.yml` with `scripts/weekly-retro.js` finds its one issue by title and author `github-actions[bot]` before creating one.
- **Spec Kit templates**: `.specify/templates/spec-template.md` is owned by `specify integration` (its hash is in `.specify/integrations/speckit.manifest.json`, so a hand edit is drift); Spec Kit reads `.specify/templates/overrides/<name>.md` first (`resolve_template` in `.specify/scripts/bash/common.sh`).
- **No surface markers**: no element in `src/renderer` carries `data-surface` today.

## Evidence: the inventory (outside the repo, not committed)

Made by Vikram's agent on 2026-10-31 in its cache folder, from every spec that owns a renderer surface and the renderer sources: `INVENTORY.md` (89 surfaces: 27 world moments, 62 tool surfaces; a per-world table; 16 candidate FRs for spec 097), `surfaces.json` (the draft registry, all 89 rows), `ASSETS-experience.md` (provenance of 9 Codex pictures: lift doors, shaft and building cut-away for three worlds, the photo chat backdrop; approval pending: Vikram for photo, Paco for cave and loft) and 47 screenshots of three worlds (*Photo office*, *Prehistoric cave*, *Cheeky loft*) at 1440x900 and some at 1280x800: one floor, the lift ride in three frames, All floors, the All-button building preview, the chat, the question and permission cards, the answer bar, and the floor question bubble and Boss-door slip. Electron under xvfb, Linux only, a still simulator. The seeded registry (FR-010) is built from `surfaces.json`.

## Clarifications

### Decisions taken by this spec (the owners may change any)

- **D1 26 world moments, not 27.** `mood-signs` (moods, "?"/"!" cues) is drawn the same in every world as overlays on the desk (097 FR-038), so it is part of `desk-card`, not a moment of its own. The other 26 stay; each is something a world must draw or deliberately leave flat.
- **D2 `data-surface` is for world moments only.** A tool surface carries no `data-surface`; the attribute names a registered moment and nothing else, so the static check can be exact (FR-021).
- **D3 Cell states.** A matrix cell (moment × world) is `built` (the world draws it, in code), `designed` (a design exists, not built: the world shows the flat rendering for now), `fallback-flat` (deliberately the flat rendering, tokens only) or `missing` (nobody has decided). A world ships only when every cell is `built` or `designed` (FR-024, owner decision 2026-10-31); `fallback-flat` is not allowed in a shipping world (it stays a state for a world still in progress), and `missing` blocks too. Not-yet-shipping worlds' `designed` cells are listed in the coverage issue.
- **D4 The spec template line goes into a Spec Kit override**, `.specify/templates/overrides/spec-template.md`, not into the managed template, so `specify integration status` stays clean (FR-070).
- **D5 The PR subset runs only on world-layer paths.** `app.js`, `styles.css` and other shared files are not in the path filter: they change in most pull requests and would make the subset a job on almost every PR, against Ruben's condition. The world treatment of a moment lives in the world layer (`src/renderer/realoffice/**`), which is filtered; a moment's flat root in a shared file is covered by the weekly run (FR-053).
- **D6 Tool-surface driver scenes**: Settings (the Office layout section, which holds the World row of 097), the *New session* dialog, and the List view.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new world cannot ship with holes (Priority: P1)

A maintainer adds a world (for example the cave). The registry lists each world moment with that world's state. The world cannot be marked shippable while any moment is `missing` or `fallback-flat`; every moment is built or designed (no deliberate flat fallback in a shipping world).

**Why this priority**: this is the point of the contract: "the full app adapts", with the gaps visible and owned.

**Independent Test**: `test:surfaces` on the seeded registry and on fixtures.

**Acceptance Scenarios**:
1. `test:` **Given** the seeded registry, **Then** the schema check passes, and with `cave` marked `shippable: true` it fails, naming the 9 missing moments; **Given** a shippable world with a `fallback-flat` cell, **Then** it fails too.
2. `test:` **Given** a renderer file with `data-surface="lobby"` and the registry without `lobby`, **Then** the check fails with the file and id; **Given** `lobby` registered as `code: "present"` and no marker in `src/renderer`, **Then** it fails; marked `planned`, it passes.
3. `test:` **Given** a marker whose value is not a string literal (a template string or a variable), **Then** the check fails ("data-surface needs a literal id").

### User Story 2 - Tool surfaces follow the world without drawing (Priority: P1)

Settings, dialogs, lists, the composer and every other tool surface take the world's tokens (colours, fonts, radii, shadows) and nothing else: no art behind text, no size changes.

**Independent Test**: the token lint (extended `test:theme-tokens`) and the tool-surface driver.

**Acceptance Scenarios**:
1. `test:` **Given** a world pack CSS file with a colour literal outside its token block, or any size declaration on a selector that is not inside a registered moment root, **Then** the lint fails and names the line.
2. `sim:` **Given** each world, **Then** the tool-surface driver screenshots Settings, the New session dialog and the List view at 1280x800, and finds no text under 10.5 px, no text pair under 4.5:1 and no page overflow.

### User Story 3 - The matrix shows every world moment in every world (Priority: P2)

Every week a job screenshots every world moment in every world at 1440x900 and 1280x800 and updates one "World coverage" issue. A pull request that touches a world pack gets the same moments at one size, in minutes.

**Independent Test**: the matrix driver locally with the simulator; the workflow on a branch (workflow_dispatch).

**Acceptance Scenarios**:
1. `sim:` **Given** the simulator, **When** the matrix driver runs with `--size 1280x800`, **Then** it writes one picture per present moment × world into `out/world-matrix/` and a `matrix.json` with each cell's state and check result, and nothing under `docs/`.
2. `test:` **Given** `scripts/shots-docs.js`, **Then** no matrix driver is in `DOC_SHOTS` or `NO_DRIVER`, and the matrix output folder is git-ignored.
3. `real:` **Given** the weekly run on `main`, **Then** the "World coverage" issue by `github-actions[bot]` is updated in place (one issue), and a failed scheduled run opens or updates the nightly-watch issue.

### User Story 4 - Writing a spec names the experience (Priority: P3)

A spec author fills the template's *Experience* line: "tool surface", or "world moment + which shared blocks". A PR author ticks one checkbox.

**Acceptance Scenarios**:
1. `test:` **Given** the Spec Kit override template, **Then** it has the *Experience* section with the one line, and the rest equals the managed template (no other drift).
2. `read:` **Given** the PR template, **Then** it has the one experience checkbox.

### Edge Cases

- **A moment that only exists in Real office** (the lift ride, the floor display): its root is in the world layer; `code: "planned"` until the world layer draws it.
- **A moment drawn in two places** (the inbox as a dialog in flat and as the Boss-door slip in a world): one id, both roots carry it; the check counts at least one.
- **A tool surface accidentally tagged** with `data-surface`: the check fails because the id is not registered (D2).
- **A world removed**: its key is removed from every moment's `worlds`; the schema check fails on a cell for an unknown world.
- **A world pack that changes only pictures**: the PR subset runs for that world only (FR-052).
- **Outside the world** (the browser pane, OS file pickers and notifications, native menus): never in the registry or the coverage issue; the tool-surface driver does not shoot them.
- **Forced colours**: the matrix also runs each world once with `forced-colors: active` at 1280x800 weekly; world art may be hidden there (097 FR-051), text must stay.
- **A fork PR**: the path-filtered job runs with `contents: read` only and no secrets; it uploads artifacts and never writes an issue.

## Requirements *(mandatory)*

### Functional Requirements

#### Kinds

- **FR-001** **Three kinds.** Every user-facing surface is exactly one of: a **world moment** (drawn per world from shared blocks, registered, FR-010), a **tool surface** (adapts through spec 070 tokens only, FR-040), or **outside the world** (native: the browser pane's `WebContentsView` of spec 080, OS dialogs, notifications and menus).
- **FR-002** **Outside the world is never a gap.** Native surfaces are not registered, not shot by the matrix and never listed in the coverage issue.
- **FR-003** **Tool surfaces are not registered one by one.** The inventory's 62 tool surfaces stay in the evidence; the token lint and the tool-surface driver hold all of them together.
- **FR-004** **Moving a surface between kinds** (a tool surface that becomes a world moment) is a registry change in the PR that builds it, through the owning spec, with a named block list (FR-012).

#### Registry

- **FR-010** **Location and seed.** The registry is `docs/experience/world-moments.json` (repo data, not code; read by scripts only). It is seeded in this spec's PR from the inventory's `surfaces.json`: 26 world moments (D1), worlds `photo`, `cave`, `loft`, every moment `code: "planned"` (no marker exists yet), cell states from the inventory's per-world table (`D` → `designed`, `M` → `missing`). Today 9 moments are `missing` in every world: `lounge`, `walk`, `empty-office`, `first-run`, `floor-jumps`, `inbox`, `limit-card`, `elicitation`, `coffee-bar`.
- **FR-011** **Schema** (`version: 1`):
  - `nonNegotiableKeys`: the letter keys of the inventory (T, A, S, K, M, F, P, C, R) with their text;
  - `blocks`: the block ids of FR-030 (`person`, `light-slots`, `speech-bubble`, `slip`, `lift`, `panel-frame`, `desk-screen`, `fixture`);
  - `worlds`: id (kebab-case) → `{ name, crews: [Characters values], shippable: boolean, pack: path }`;
  - `moments`: an array of `{ id, name, spec, where, code, blocks, worlds, nonNegotiables, files? }` with `id` kebab-case and unique; `code` `present` or `planned`; `blocks` a non-empty subset of `blocks`; `worlds` exactly one state per world (`built`, `designed`, `fallback-flat`, `missing`, D3); `nonNegotiables` a non-empty string of known keys; `files` (optional) the world-layer files that draw it (FR-053).
- **FR-012** **Each moment names its blocks.** The seed names them per moment (for example `desk-card`: `person`, `desk-screen`, `light-slots`; `lift-panel`: `lift`; `answer-bar`: `speech-bubble`, `person`).
- **FR-013** **Closed and small.** Adding a moment needs the owning spec to say why it is a world moment (FR-001) and which blocks it uses; the registry is not a list of every screen.
- **FR-014** **Markers.** A world moment's root element carries `data-surface="<id>"`, written as a literal in `index.html`, or in JS as `data-surface="<id>"` in markup, `el.dataset.surface = '<id>'` or `setAttribute('data-surface', '<id>')`. It is one attribute: no style or behaviour may hang on it (no `[data-surface` selector in CSS, no `dataset.surface` read in JS).

#### Registry check

- **FR-020** **`scripts/check-surfaces.js`** (plain Node, no Electron, no network, every OS; `npm run test:surfaces`, in `npm test`) checks FR-021..FR-026 and prints the matrix (moment × world) on success.
- **FR-021** **Every marker is registered.** Every `data-surface` id in `src/renderer/**/*.{html,js}` is a registered moment; a marker whose value is not a string literal fails (US1-3).
- **FR-022** **Every present moment exists.** Every moment with `code: "present"` has at least one marker in `src/renderer`; a `planned` moment may have none, and a `planned` moment that does have a marker fails ("mark it present").
- **FR-023** **Schema.** The registry parses and matches FR-011; unknown keys, worlds, blocks or states fail.
- **FR-024** **Shippable means every moment designed.** (Vikram, 2026-10-31: "design all 9, I don't want partly done ui".) Real office ships only when every registered world moment is `designed` (or `built`, which includes a design) in each world that ships. A world with `shippable: true` has no `missing` and no `fallback-flat` cell. A `built` cell needs `code: "present"`.
- **FR-025** **No styling on markers.** No CSS file in `src/renderer` contains `[data-surface`, and no JS reads `dataset.surface` or `getAttribute('data-surface')` (FR-014).
- **FR-026** **The PR filter covers the world layer.** Every path in a moment's `files` matches a path filter of the matrix workflow's pull-request trigger (FR-052).

#### Block contract

- **FR-030** **Blocks.** A world pack fills these blocks and nothing else; positions come from the layout engine of spec 097, never from the pack. Sizes are in source pixels or in `u` (097 FR-010: the seated body height); anchors are fractions (0..1) of the picture's box.
  - **`person`** (portrait and pose frames). Seated frames `typeA`, `typeB`, `waveA`, `waveB`, `think`, `rest`; standing frames `book`, `coffee`, `tread`, `letter`, `knock` (optional `box`, `touch`, `tool`, `wait`, falling back as 097 FR-024). WebP with alpha, at most 640 px tall, at most 80 KB (097 FR-062). Anchors per frame: `headTop`, `bodyH` (px, defines `u`), `hand` (hand line in `u` above the desk surface), `floorLine` (standing frames), `faceBox` (x, y, w, h: the portrait crop). Portrait: a square crop of `rest` by `faceBox`, at least 128 px source, shown at 64 px in the chat header and 24-32 px in chips.
  - **contact shadow**: every standing frame is drawn with a contact shadow under the feet (CSS, an ellipse 0.5-0.9 of the frame width at its `floorLine`); a world chooses its softness, not its position.
  - **`light-slots`**: five named slots, `lamp` (a radial light: centre anchor on the desk block, radius 0.6-1.2 `u`), `glow` (the screen face, from `desk-screen.screenRect`), `call` (a dot 10-14 px at `desk-screen.callAnchor`), `fixture` (one per fixture at `fixture.lightAnchor`) and `ambient` (the whole art layer). A world chooses each slot's shape from a fixed list (`lamp`: lamp, flame, neon-strip; `call`: dot, flame, neon) and never its colour or meaning (097 FR-049, 070 FR-050).
  - **`speech-bubble`**: a frame (9-slice, corners at most 24 px, at most 24 KB) around the answer-bar component; width 220-360 px; the tail points at `person.headTop` of the asking person (or the desk-side column, 097 FR-106).
  - **`slip`**: a frame like the bubble, width 320-420 px, hung at `fixture.doorRect` of the Boss fixture; slips stack oldest first.
  - **`lift`**: shaft tile (repeats vertically; 56-64 px wide shown, source at most 180 px wide and 60 KB), round button slots at least 40 px with a 10.5 px floor-name label under each, a cabin outline one button slot plus label high, the ride cover (doors, rock, gate: covers the desk area only, 097 FR-102), the floor display (CSS, three token slots), storey slab (for All floors, 8-16 px high) and, optional, a building cut-away for the preview (at most 200 KB).
  - **`panel-frame`**: the chat panel and card surface: a 9-slice frame (corners at most 32 px) and a surface at least 78 % opaque behind any text; optional backdrop picture at most 150 KB (blurred office or desk view).
  - **`desk-screen`**: the desk picture (at most 60 KB) with anchors `surfaceY` (desk top line), `screenRect` (the monitor face, where app text goes as `textContent`), `plateRect` (the front panel for the name plate), `lampAnchor`, `callAnchor`.
  - **`fixture`**: one picture per place (`library`, `software`, `terminal`, `web`, `boss`, `coffee`, `bank`, `post`, `tools`, and the generic custom-place kiosk), at most 120 KB each, sharing one top line and one floor line (097 FR-023), anchors `standX` (where visitors stand), `plateAnchor`, `lightAnchor`, and for `boss` also `doorRect`; plus `realHeight` (metres: the fixture's real-world height, for example a door about 2.1 m, a counter about 1.1 m) so standing people are scaled against it, and the fixture's `floorLine` on which their feet stand (097 FR-117). A person's standing frames also carry `realHeight` (default 1.70 m).
- **FR-031** **World manifest.** A pack's `world.json` lists each block's files and anchors, its token set (spec 070 types only) and its chosen light-slot shapes. A field that sets a position, a size outside its range, or a layout value is refused.
- **FR-032** **Block test.** `scripts/test-world-packs.ts` (`test:world-packs`, in `npm test`) checks every pack against FR-030 and FR-031: every block filled (optional parts may be absent), sizes and file caps in range, anchors in 0..1, every listed file present and every file listed, the token set valid for its types (070 FR-002) and passing 070 D4 contrast.
- **FR-033** **A new world fills N blocks.** A world is the eight blocks plus a token set; adding one needs no layout or renderer code beyond registering its id and crews (097 FR-100).

#### Tool surfaces

- **FR-040** **Token lint.** `test:theme-tokens` (070 FR-040) is extended:
  - its file list gains the Real office and world-layer files (`src/renderer/realoffice/**/*.{css,js}`) under the same ratchet;
  - a world pack's CSS (`src/renderer/realoffice/worlds/<id>/world.css`) has **zero** colour literals and `font-family` declarations outside its `:root`-scoped token block (no ratchet: zero from the first pack);
  - a world pack's CSS sets **no size or spacing property** (`width`, `height`, `font-size`, `line-height`, `padding`, `margin`, `gap`, `inset`, `top`, `left`, `right`, `bottom`, `border-width`) on any selector that is not inside a registered moment root (a selector starting with the world's scope class and naming a moment's own class), so a world cannot resize a tool surface (070 D2).
- **FR-041** **Tool-surface driver.** One driver, `scripts/check-world-tools.js`, opens each world (simulator, 15 agents) and screenshots Settings (Office layout section), the *New session* dialog and the List view (D6). It fails on text under 10.5 px, a text pair under 4.5:1 (3:1 for large text), page overflow, or a picture behind text. Weekly at both sizes and in the PR subset at 1280x800 (FR-050, FR-052).
- **FR-042** **No art behind text.** On a tool surface, no element with text sits over a world picture; the driver checks that each text node's nearest opaque background is a token colour, not an image.
- **FR-043** **Same words.** A tool surface's words, labels and order are the same in every world (spec 036 FR-003); the driver compares the accessible names of the three scenes across worlds.

#### World matrix

- **FR-050** **Weekly full set.** A scheduled workflow, `world-matrix.yml` (Monday, outside the retro's hour), runs the matrix driver over every `present` moment × every world at 1440x900 and 1280x800, plus one forced-colours pass per world at 1280x800, and the tool-surface driver at both sizes. 0 AI credits (simulator).
- **FR-051** **Matrix driver.** `scripts/world-matrix.js` opens each moment's scene in the simulator (URL scene options in the style of the mockups: floor, lift ride frames, All floors, chat, question, approval), waits with `until()` for the moment's root `[data-surface=<id>]`, screenshots it and runs the 10.5 px, overlap and contrast checks on that root. It writes pictures and a `matrix.json` (cell state from the registry, check result, picture name) to `out/world-matrix/` (git-ignored).
- **FR-052** **Pull-request subset.** On a pull request whose files match the path filter (`src/renderer/realoffice/**`, `docs/experience/**`, `scripts/world-matrix.js`, `scripts/check-world-tools.js`, `.github/workflows/world-matrix.yml`; D5), the same workflow runs every `present` moment × the touched worlds (all worlds when anything outside `worlds/<id>/` matches) at **1280x800 only**, plus the tool-surface driver at 1280x800. `timeout-minutes: 12`; it is not a required check. Its permissions are `contents: read` and it holds no secret, so a fork PR can run it safely.
- **FR-053** **Shared files.** Changes to shared renderer files (`app.js`, `styles.css`, `screens.js`, ...) do not start the PR subset (D5); the weekly run covers them.
- **FR-054** **Artifacts only.** Both runs upload `out/world-matrix/` as a workflow artifact (14 days); nothing is committed, the matrix is not in `DOC_SHOTS`, `NO_DRIVER` or `shots:docs`, and `docs/screenshots/` and the site budget (spec 050 FR-012) are untouched. `test:surfaces` asserts that no matrix or tool-surface driver is named in `scripts/shots-docs.js` and that `out/` is git-ignored.
- **FR-055** **Red means owned.** `world-matrix.yml` is added to the workflow list of `nightly-watch.yml`, so a failed scheduled run opens or updates its issue (spec 021 FR-063); the owner of that issue fixes or pauses within 24 h.
- **FR-056** **A cell's check fails the run only for `built` and `fallback-flat` cells**; `designed` and `missing` cells are shot and reported, not failed (they show the flat rendering by D3).

#### Coverage issue

- **FR-060** **One rolling issue.** The weekly run updates one issue titled "World coverage" (labels `task`, `area:ui`, `spec:098`), found by exact title **and** author `github-actions[bot]` (an issue by anyone else with that title is ignored: outside text, AGENTS.md *Untrusted content*); it is created when none exists and its body is replaced each week.
- **FR-061** **Body.** Generated from the registry and `matrix.json` only (`scripts/world-coverage.js`): the matrix table (moment × world with the cell state), the `missing` and `designed` cells per world, the cells whose checks failed, the date, the commit and the run link. No picture, no agent output, no path from a user's machine (the simulator's data only).
- **FR-062** **No per-gap issues.** The job never opens other issues; a person who takes a gap opens a task issue for it as usual.
- **FR-063** **Permissions.** Only the scheduled and manual runs have `issues: write`; the pull-request run never writes to GitHub.

#### Enforcement in templates

- **FR-070** **Spec template line.** `.specify/templates/overrides/spec-template.md` (D4) is the managed template plus an *Experience* section with one line: "Experience: tool surface, or world moment + which shared blocks (registry: `docs/experience/world-moments.json`)". A test checks the override still equals the managed template apart from that section, so a Spec Kit upgrade shows up as a failing test, not silent drift.
- **FR-071** **PR template checkbox.** `.github/pull_request_template.md` gets one box: "Experience: this PR adds or changes a world moment and updates its `data-surface` marker and registry row, or it touches only tool surfaces (tokens) or native surfaces."
- **FR-072** **No `AGENTS.md` line.** `AGENTS.md`, `CLAUDE.md` and the other rule files are not changed by this spec; `rules:check` budgets are untouched.

#### Art pipeline (future, Paco's side)

- **FR-080** **Assets pass the art-pipeline check.** A world is marked `shippable` only when its pack also passes the asset check of the art-pipeline spec (Codex recipe and style per world, `ASSETS` provenance, a tested owner-approval field; Paco's spec, not yet written). Until that spec exists, a world's pack follows spec 077 FR-054 and 097 FR-063, FR-067, FR-068, and crew-world art needs Paco's approval per picture (097 Q6). This spec does not create the art-pipeline spec.

### Key Entities

- **World moment**: `{ id, name, spec, where, code, blocks[], worlds{world: state}, nonNegotiables, files[]? }` in the registry.
- **World**: `{ id, name, crews[], shippable, pack }`; its pack is the eight blocks plus a token set (`world.json`).
- **Cell**: moment × world, state `built | designed | fallback-flat | missing`.
- **Matrix result** (`matrix.json`, an artifact): per cell the state, the picture name and the check result.
- **Coverage issue**: one GitHub issue, by `github-actions[bot]`, body generated weekly.

## Success Criteria *(mandatory)*

- **SC-001** `test:surfaces` passes on the seeded registry and fails on each mutation of US1 (unregistered marker, missing present moment, non-literal marker, `missing` or `fallback-flat` cell in a shippable world, styled marker).
- **SC-002** The token lint fails on a colour literal and on a size property in a world pack's CSS, and the ratchet covers the Real office files.
- **SC-003** The pull-request subset finishes within its 12-minute timeout and starts only for the paths of FR-052 (read on the first runs; no wall-clock assertion in a test).
- **SC-004** Nothing the matrix makes is committed: `docs/screenshots/`, `DOC_SHOTS` and the site size are unchanged by this spec's build.
- **SC-005** There is exactly one "World coverage" issue by `github-actions[bot]` after two weekly runs.
- **SC-006** `AGENTS.md` is unchanged by this spec.

## Assumptions and honest limits

- The registry seed comes from an inventory made on 2026-10-31 by reading specs and sources; it is not checked against the running app until the markers exist (T011). Cell states `designed` mean "designed in the mockups", not approved art: the photo pictures wait for Vikram's approval, the cave and loft pictures for Paco's (`ASSETS-experience.md`).
- The matrix cannot judge looks; it checks size, overlap, contrast and presence. A person still reviews the artifacts.
- The PR subset's run time is estimated (26 moments × 3 worlds at one size in one Electron per world), not measured.
- Nothing here runs on Windows or macOS except through the workflow's runner (Linux); the static checks are plain Node and run on every OS in `npm test`.

## Open questions

- **Q1 Release gate for the photo world (decided 2026-10-31, Vikram, Telegram DM)**: "design all 9, I don't want partly done ui". Real office ships only when every registered world moment is `designed` in each world that ships; `fallback-flat` is not allowed for a shipping world. The 9 moments that still need a design (lounge/asleep, desk-to-lobby walk, empty office, first run, floor jumps, inbox (Boss-door queue), limit card, MCP elicitation, coffee break) are tasks T032..T033; the photo world is not shippable until they are `designed`.
- **Q2 Art-pipeline spec number and owner.** Paco's side writes it (decision 7). **Recommendation**: Paco's agent takes the next free number when it starts; FR-080 names it in a delta then.

## Constitution check

- **I Spec Kit**: this PR is spec, plan, tasks and the seeded registry (data under `docs/`); no `src/` change.
- **II Adapters**: renderer and scripts only; no adapter or vendor type.
- **III Safe by default**: the coverage issue holds only registry and simulator data; the PR run has no secrets and no write permission; the issue lookup filters on the author.
- **IV No AI credits**: simulator only; no art is generated by this spec.
- **V Calm, legible UI**: the matrix and the tool driver check 10.5 px, overlap and contrast in every world.
- **VI Parity**: static checks in plain Node on every OS; the matrix runs on Linux runners (`[KNOWN GAP]` for Windows and macOS looks).
- **VII Quality gates**: three tests (`test:surfaces`, `test:world-packs`, the extended `test:theme-tokens`) and two drivers.
- **VIII Honest limits**: listed above.

## Changes

### 2026-10-31: the weekly performance record (spec 097 FR-187)

- **FR-057** **The weekly job records performance.** The scheduled run of `world-matrix.yml` also runs `scripts/check-perf.js --record` (spec 097 FR-187): flat and every shippable world, 15 and 40 agents; 0 AI credits. Its JSON is part of the artifact (FR-054), and `world-coverage.js` lists rows over budget in the "World coverage" issue (FR-060). **It records and never asserts a time** (AGENTS.md *Timing*, spec 021 FR-048b, FR-063): a CI machine's clock is no pass or fail, and comparisons are to flat in the same run and to last week's artifact. Not in the pull-request subset (FR-052), which stays at its 12-minute timeout; what pull requests get is the count-based `check-office-ops` (097 FR-186) in the ordinary suite. T044.

### 2026-10-31: strict release gate (owner decision, Q1)

Vikram (Telegram DM, 2026-10-31 10:27 UTC): "design all 9, I don't want partly done ui". Real office ships only when every registered world moment is `designed` in each world that ships; `fallback-flat` is not allowed for a shipping world. FR-024, D3, US1, SC-001, Q1 and tasks T010, T032, T033 updated. No code yet.
