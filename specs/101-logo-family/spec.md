# Feature Specification: Logo family (the human is the sovereign)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: New logo family: the human user is the sovereign, agents are the court. Four base icons (vector, hand-tuned at 16, 20 and 32 px), a Settings picker, a top bar that follows the world's flat palette, build icons fixed at icon 1
note: spec, plan, tasks only; vector drawings and art stay outside the repo until the tasks that bring them in; nothing built
status: draft
-->

**Feature Branch**: `101-logo-family` (spec); code branches `101-pN-slug`, one per phase

**Created**: 2026-10-31

**Status**: Draft (2026-10-31). Spec, plan and tasks only; no art, no code.

**Input**: Owner decisions (Vikram, Telegram and terminal, 2026-10-31), listed below; concepts and vector drawings by Vikram's agent, outside the repo (*Evidence*).

## Decisions (binding)

Source: Vikram, 2026-10-31 (UTC). Recorded as decided; only the approval is word for word.

1. **What the name means** (12:30): the human user is the sovereign who decides, orders and judges; the agents are the court. No arches, nothing religious or culture-specific.
2. **The family** (12:58): base icons 1, 2, 3 and 5 of concept round 3. Each has photo, cave and loft versions. Users choose one in Settings.
3. **The installed icon** (13:01): the installer, Finder and shortcut icon is fixed at build time and is icon 1.
4. **By world** (terminal message): the top-bar icon changes by world. The running Dock or window icon does not change.
5. **Approval** (13:23): the painted photo versions are approved ("All Looks good", on the world sheet). The cave and loft versions wait for Paco's approval; **nothing of those may be committed until he approves**.

| Id | Name | What it shows |
|---|---|---|
| 1 | Prompt sovereign | A large `>_` wearing a plain crown, three bot heads in a row below. The default and the build icon. |
| 2 | Terminal chair | A tall high-backed chair whose back is a terminal screen showing `>_`, a crown above it, one small bot each side. |
| 3 | Figure with badge | A faceless figure with a crown and `>_` on the chest, three bot heads below. |
| 5 | Underscore floor | A large `>` with a crown, three bot heads standing on one long bar: the underscore is their floor. |

Ids stay 1, 2, 3, 5, the numbers the owner chose; there is no icon 4.

## Why a new spec

Grep for `icon.svg`, `build/icon` and `brand-mark` (2026-10-31): spec 008 has FR-025 (the Linux window icon) and a release-table row for the old icon; spec 050 uses the favicon; spec 040 and 070 own `--brand-mark`/`--brand-bg` as theme tokens. None owns branding, and this feature adds a setting, a world-driven top bar, a build script and an asset test, too much for a delta of any of them. So a new spec. **Number 101**: `origin/main` has specs up to 098, open branches and PRs take 099 and 100 (checked 2026-10-31 at `25250017`).

**One rule in, one rule out** (spec 021 FR-063): the checkable rule "no cave or loft logo in the repo without Paco's approval" gets a test (FR-071); no `AGENTS.md` line.

**Existing capabilities reused** (spec 021 FR-031): the Characters picker pattern in `screens.js` (`.thlist`, `.thpick`, `aria-pressed`); `durbar.*` `localStorage` read in a `try`; `assetRows` and `webpInfo` from `scripts/test-crew-assets.ts`; the `--brand-mark`/`--brand-bg` contrast pair in `theme.js`; `.brand-mark` tile and its per-theme shapes in `themes.css`; `DOC_SHOTS`; the world seam of spec 097 (FR-084, FR-100).

## Context: what exists today

- **Build icon**: `build/icon.svg` (a lead and a working team, spec-less, PR #246), `build/icon.png` (1024), `build/icon.ico` (16, 24, 32, 48, 64, 128, 256), `build/icon.icns` (`icp4`, `icp5`, `ic07`..`ic14`). They were built by hand with `rsvg-convert`, Pillow and `icnsutil`, none of which the repo has.
- **`build/icon-16.svg`**: no code or config reads it. Its own comment says it was the source of the 16 px ICO and ICNS entries, packed by hand.
- **Top bar**: an inline 20 px stroked SVG (`src/renderer/index.html`) in a 32 px `.brand-mark` tile with `--brand-bg`. Corporate, retro and the courts shape the tile in `themes.css` (radius, ring, shadow).
- **Other users of the icon**: `README.md` (96 px, with alt text about a lead and a team); `scripts/build-site.js` (favicon and header brand, copied from `build/icon.svg`; `pages.yml` path filter); `scripts/copy-assets.js` and `main.ts` (Linux window icon, 008 FR-025).
- **About**: Settings > About is text only, and `aboutPanelOptions` sets no icon, so neither needs a code change. The OS panels show the app's own icon.
- **Worlds** (spec 097 FR-100, FR-114): `photo`, `cave`, `loft`, with a chrome token set per world; P1 is on an open PR, the cave and loft worlds are not shippable yet.
- **Art approval**: spec 098 FR-080 waits for an art-pipeline spec on Paco's side, not yet written; until then spec 077 FR-054 and 097 FR-063, FR-067, FR-068 apply.

## Evidence (outside the repo, not committed)

In Vikram's agent's cache folder, `logo/`: `ASSETS-logo.md` (every prompt and the review status), `round3/` and `worlds2/` (concepts and sheets), `vector/` (the SVGs, `palettes.json`, `vector-sheet.png` at 1024, 64, 32, 20 and 16 px on light and dark next to each concept, and 1x pixels enlarged 5x). Rendered with headless Chromium at real device pixel ratios 1 and 2. Linked here by description only: cave and loft may not enter the repo.

What that work established, and what this spec therefore requires:

- A downscaled painting is mush at 20 px; a tuned drawing is not (FR-010, FR-030).
- A 16 px drawing scaled to 20 px blurs on a 1x screen, so the top-bar size has its own 20 px grid, in addition to the 16 and 32 first planned (FR-011).
- Pale bots on a white top bar vanish without their dark backing, so a glyph always sits on its plate or tile (FR-031).
- One colour pair per theme is enough: all four icons stay readable with every light part in `--brand-mark` and every dark part in `--brand-bg` (FR-034), and so with forced colours (FR-036), once the small drawings keep a 1 px gap between crown and figure and between bots and floor.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app says who is in charge (Priority: P1)

Someone installs Agent Durbar and sees the new icon in the installer, Finder or shortcut, the Dock and the top bar.

**Independent Test**: build icons checked by `test:logo-assets`; the top bar screenshotted at both sizes.

**Acceptance Scenarios**:

1. **Given** a build for any OS, **When** I read `icon.icns`, `icon.ico` and `icon.png`, **Then** every entry is icon 1 at the listed size.
2. **Given** a fresh profile, **When** the app opens, **Then** the top bar shows icon 1 with no flash of another icon.

### User Story 2 - I choose my icon (Priority: P2)

**Independent Test**: simulator, Settings > Logo; pick, reload, check.

**Acceptance Scenarios**:

1. **Given** Settings, **When** I pick icon 3, **Then** the top bar changes at once and stays icon 3 after a restart.
2. **Given** icon 3 chosen, **When** I look at the Dock, window or Finder, **Then** they still show icon 1.
3. **Given** a stored value that is not 1, 2, 3 or 5, or `localStorage` blocked, **Then** the top bar shows icon 1 and nothing fails.
4. **Given** a keyboard or screen reader, **Then** the picker works as the Characters picker does and each choice has its name.

### User Story 3 - The icon lives in my world (Priority: P3)

**Independent Test**: driver, top bar in each shippable world at both sizes.

**Acceptance Scenarios**:

1. **Given** Real office in the photo world, **Then** the top bar shows my icon in the photo palette: the same tuned drawing, recoloured, not a painting.
2. **Given** a world with no approved palette, **Then** the top bar uses the base palette.
3. **Given** the flat office on Clean, **Then** the base palette; **given** the flat office on another theme, **Then** that theme's brand colours in that theme's tile shape.
4. **Given** forced colours, **Then** the icon uses system colours and stays readable.

### Edge Cases

- The top bar's tight mode hides the `h1`: the tile stays, and the name is still read.
- A user theme whose brand pair fails contrast: the existing theme check already reports it (`theme.js`).
- A painted preview that does not load: the picker shows the vector drawing in that palette.
- Switching world while Settings is open: the previews and the top bar follow on the next paint, with no animation.

## Requirements *(mandatory)*

### The drawings

- **FR-010** **Vector, hand-drawn, simple.** Each base icon is a plain SVG at viewBox 1024: geometric shapes, a plain three-point crown with no ball tips, bots with rounded square heads, two dot eyes and an antenna. No raster, gradient, filter, stroke, text, script, external reference or `style` element.
- **FR-011** **Tuned sizes.** Each icon also has its own drawing at 32, 20 and 16 px, on the pixel grid where edges are straight, simplified as far as the size needs. For example, icon 1 at 16 and 20 px is `>_`, a crown and three small bot blocks with no eyes or antenna. Icon 5 at 20 px keeps eyes because a 5 px head can hold them.
- **FR-012** **Slots.** Every shape has `data-slot` (`plate`, `gold`, `bot`, `eye`, `cream`, `screen`, `badge`) and a literal `fill`, so a file renders correctly anywhere (a browser, the README, the icon build) and a palette swap is one colour per slot. No `var()` in the files.
- **FR-013** **Where they live.** `build/logo/icon-N.svg`, `icon-N-32.svg`, `icon-N-20.svg`, `icon-N-16.svg`. Provenance and approval in `build/logo/ASSETS.md`.
- **FR-014** **Base palette.** Gold `#FFC21A`, bot `#C2DEFF`, eye `#0E1420`, cream `#FBF6EE`, screen `#060C1A`; plate per icon as in the concepts: 1 `#10141E`, 2 `#03183A`, 3 `#061C4A`, 5 `#07111F`; `badge` is the plate. Differences from the concepts, by design: plain crown tips (concepts 2 and 3 have ball tips), one gold across the family, no lighter top on icon 2's seat.

- **FR-101** Photo flat palette, proposed: plate `#5C3312`, gold `#FFD45E`, bot `#BFE0FF`, eye `#1B2433`, cream `#FBF3E4`, screen `#17110C`. Contrast: gold 7.7, bot 7.9, cream 9.8 on plate; eye on bot 11.4; cream on screen 17.0. Base palette: gold at least 10.2, bot at least 11.9, cream at least 15.3 on any plate; eye on bot 13.3; cream on screen 18.2.
- **FR-102** Cave and loft flat palettes are drawn and pass FR-035 outside the repo, and come in only after Paco's approval (FR-062).

### The picker

- **FR-020** **Settings > Logo.** A new section right after *Characters*, with the same list pattern (`.thlist`, `.thpick`, `aria-pressed`): four choices with name and one line, *Prompt sovereign* selected by default. A note says: "The icon in the top bar; it takes the colours of your world. The app's own icon in the Dock, taskbar or Finder stays the same." It applies at once.
- **FR-021** **Stored locally.** `localStorage` `durbar.logo`, values `1`, `2`, `3`, `5`, read in a `try`; anything else means `1`. No IPC, no file, no main-process change. Applied as `data-logo` on `html`.
- **FR-022** **No flash.** `index.html` keeps icon 1 inline, so the default needs no script and a script failure still shows it. The stored choice is applied before first paint, in the same early step as the theme.
- **FR-023** **Previews.** Each choice shows a preview at 64 CSS px: the painted version for the current world when that picture is shipped and approved, else the 1024 vector in the current palette. Which of the two shows depends only on the shipped files, never on the user.
- **FR-024** **Painted previews are for large displays only.** They appear only in this picker, loaded when Settings opens, as WebP 192x192, alpha outside the plate, no metadata, at most 24 KB each (spec 077 FR-050's way). `img-src 'self' data:` is unchanged.

### The top bar

- **FR-030** **SVG only.** The top bar never shows a picture: it is inline SVG, the 20 px drawing of the chosen icon, with no decoded painting, no extra request and no layout change. It sits in today's 32 px `.brand-mark` tile, `aria-hidden`, next to the `h1`.
- **FR-031** **Tile as plate.** The tile's background is the plate colour and the drawing's `plate` slot is hidden, so per-theme tile shapes (`themes.css`) keep working. A glyph is never drawn without its tile.
- **FR-032** **Tokens.** Six tokens paint the slots: `--logo-plate`, `--logo-gold`, `--logo-bot`, `--logo-eye`, `--logo-cream`, `--logo-screen` (`badge` uses the plate). CSS sets `fill` per `[data-slot]` inside the top bar only. No tool-surface literal is added outside the token block (spec 070 FR-040's ratchet stays down).
- **FR-033** **World palette.** When Real office draws a world (spec 097 FR-100's resolved world), the six tokens come from that world's chrome token set (097 FR-113). Painted art is never used here. A world with no approved palette falls back to the base palette (FR-014). The palette follows the **resolved** world, including *Match my characters*.
- **FR-034** **Flat office.** On the Clean UI style: base palette, plate per `data-logo`. On any other UI style, built-in or generated: `--logo-plate`, `--logo-eye` and `--logo-screen` take `--brand-bg`; `--logo-gold`, `--logo-bot` and `--logo-cream` take `--brand-mark`. A generated theme keeps working with no new token. The world wins over the theme while Real office is on.
- **FR-035** **Contrast.** For every palette: gold, bot and cream on plate; eye on bot; cream on screen; all at least 3:1 (WCAG non-text), checked by test. The theme pair is held by the existing `--brand-mark` on `--brand-bg` check.
- **FR-036** **Forced colours.** In `@media (forced-colors:active)` the tile is `Canvas` with a `CanvasText` line; gold, bot and cream are `CanvasText`; eye, screen and badge are `Canvas`. Added to the existing block in `styles.css`.
- **FR-037** **The running icon stays.** No `app.dock.setIcon`, `win.setIcon` or `setOverlayIcon` follows the choice or the world. 008 FR-025 keeps icon 1 on the Linux window.

### The build icons

- **FR-040** **Icon 1 for all three OSes, fixed at build time.** `build/icon.svg`, `icon.png`, `icon.icns`, `icon.ico` are all icon 1 from `build/logo/`. `package.json` paths are unchanged.
- **FR-041** **Entries.** The same sizes as today, each from the listed drawing:

  | Output | Sizes | Drawing |
  |---|---|---|
  | `icon.ico` | 16 | `icon-1-16.svg` |
  | `icon.ico` | 24, 32, 48, 64 | `icon-1-32.svg` |
  | `icon.ico` | 128, 256 | `icon-1.svg` |
  | `icon.icns` | `icp4` (16) | `icon-1-16.svg` |
  | `icon.icns` | `icp5` (32), `ic11` (16@2x), `ic12` (32@2x) | `icon-1-32.svg` |
  | `icon.icns` | `ic07`, `ic13`, `ic08`, `ic14`, `ic09`, `ic10` (128..1024) | `icon-1.svg`, the plate 824/1024 of the canvas, centred (D3) |
  | `icon.png` | 1024 | `icon-1.svg` |

- **FR-042** **Reproducible, no new dependency.** `npm run icons:build` (`scripts/build-icons.js`) renders each entry in an offscreen Electron window at device scale 1, and writes the ICO and ICNS containers itself (PNG entries in plain Node, like the palette PNG writer of spec 050 FR-012). No `rsvg-convert`, Pillow, `icnsutil` or new package. It runs by hand, never in `npm start`, `npm test` or a release. It works on all three OSes (`path.join`, no shell). Output may differ by a byte across OSes, so the check is on sizes and sources, not bytes.
- **FR-043** **Sources recorded.** The script writes `build/logo/icons.json`: the SHA-256 of each source SVG and of each output. The asset test fails when a source changed without a rebuild.
- **FR-044** **`build/icon-16.svg` is removed.** `build/logo/icon-1-16.svg` replaces it, and is what the build reads.

### Everything else that shows the icon

- **FR-050** **README.** `build/icon.svg` at 96 px stays the path; the alt text becomes "Agent Durbar icon: a command prompt wearing a crown, with three bots below".
- **FR-051** **Site.** The favicon and header brand (28 px) use `icon-1-32.svg`, because a browser scales one SVG favicon for a 16 px tab; `build-site.js` copies it as `favicon.svg`, and `pages.yml`'s path filter gains it. About 2 KB; the 8 MB budget (spec 050 FR-012) holds.
- **FR-052** **Screenshots.** The top bar is in nearly every linked picture, so every UI picture is retaken with `npm run shots:docs` at both sizes and looked at, once, in the phase that changes the default top bar; `test:site` must stay under 8 MB. The new driver's pictures are not in `DOC_SHOTS` unless a page links them. If the retake does not fit in that PR: say so and open an `area:docs` issue.
- **FR-053** **About.** Nothing to change (see *Context*). The driver looks at Settings > About once, to confirm that.
- **FR-054** **Docs.** README features and Settings text, `docs/` pages that describe the top bar, a `changelog.d` fragment per phase.

### Provenance, licence, approval

- **FR-060** **Provenance.** `build/logo/ASSETS.md`, one row per file: file, icon, form (`vector`, `palette`, `painted`), tool, date, prompt or "hand-drawn", made by, licence, approved by. Concepts: Codex image generation (`codex exec`) on Vikram's ChatGPT plan, by Vikram's agent, with full prompts copied from `ASSETS-logo.md`. Final SVGs: drawn by the agent, no generator, nothing traced or embedded.
- **FR-061** **Licence.** MIT, like the code and the crew art, decided 2026-10-31 (Q3).
- **FR-062** **Approval field.** `approved by` holds a name and a date. `painted` and `palette` rows for `cave` or `loft` need `Paco`; `photo` and base rows need `Vikram`. Cave and loft palette values, drawings and pictures do not appear anywhere in the repo before that, including this spec, screenshots and test fixtures. When the art-pipeline spec arrives (098 FR-080), this field moves to its check.
- **FR-063** **Same art, same terms.** Painted previews are the existing approved pictures, masked and resized; no new generation is needed, except the plain-crown regeneration (Q4). Not checked: only a quick web search was done (Q5), no registry or reverse-image search.

### Performance and tests

- **FR-070** **Performance.** Nothing decoded in the top bar; picking an icon replaces one SVG; all drawings together are at most 24 KB of renderer JS; painted previews load only with Settings open. Zero added cost to the office's render loop.
- **FR-071** **`test:logo-assets`** (in `npm test`, plain Node): the four icons at the four sizes; viewBox matches the name; FR-010's forbidden list (no `<image>`, `href`, `data:`, gradient, filter, `stroke`, `style`, `script`, `text`); every shape has a known `data-slot`; `src/renderer` drawings match `build/logo`; palette contrast (FR-035); ICO and ICNS entries decode at FR-041's sizes; `icons.json` hashes current; provenance row for each file; the approval rule of FR-062 with fixtures proving it goes red (a cave row with no `Paco`, a file with no row); `build/icon-16.svg` gone; WebP caps (FR-024).
- **FR-072** **`scripts/check-logo-family.js`** (a `ui-suite.js` driver, simulator, 0 credits, `until()` waits): the picker in Settings (keyboard, screen-reader names, persistence over reload, a bad stored value); the top bar for each icon in flat Clean, a generated theme, each built-in theme, forced colours, and each shippable world, at 1440x900 and 1280x800; asserts no `<img>` in `.brand-mark`, unchanged tile size and `h1` position, no change to the window icon call, text at least 10.5 px; writes pictures to `out/`.

### Experience

Tool surface (spec 098): the picker is a Settings section and the top-bar icon takes the world through tokens only (FR-032, 097 FR-113). No world-moment row. Painted previews are small pictures in a list, never behind text.

## Success Criteria *(mandatory)*

- **SC-001** All four icons are recognisable, one from another, at 20 px on 1x and 2x, light and dark top bars: an owner looks at the driver's pictures and says yes.
- **SC-002** A fresh install shows icon 1 everywhere; `test:logo-assets` is green on all three OSes in CI.
- **SC-003** Choosing an icon survives a restart and never touches the Dock, taskbar or window icon.
- **SC-004** The repo holds no cave or loft logo material while `approved by` lacks Paco; the test goes red on a fixture that breaks this.
- **SC-005** No added network or IPC call; the site stays under 8 MB; 15 agents still fit at both sizes.

## Assumptions and honest limits

- **Read at real size, on Linux only.** The drawings were checked in headless Chromium. Not on a real macOS or Windows desktop, Dock, Finder or Explorer, a 1.25x or 1.5x Windows scale, or an installer: `[KNOWN GAP]` until a phase's real check. The D3 Mac padding is unverified until then.
- **The flat palettes are new.** Vikram approved the painted photo set; the photo flat palette (FR-101) and the vectors were approved by him 2026-10-31 (Q2).
- The photo flat plate is darker walnut than the painted honey oak: 3:1 for the gold is not possible on honey oak. That is a deliberate difference.
- Worlds depend on spec 097 P1 and its worlds delta; flat works without them.
- Trademark: a quick web search only, no registry search, not legal advice (Q5).

## Decisions made here (D)

- **D1 Four bases, not twelve choices.** The picker offers four icons, and the world form follows the world (Q1).
- **D2 Clean keeps the base palette**, not its pale sage `--brand-*` pair: the owner wants the new mark seen. Other styles keep their brand pair, because their top bars are built around it.
- **D3 Mac padding.** macOS icons get the 824/1024 plate from 128 px up, and full-bleed at tuned sizes, where padding would undo the tuning. ICO and PNG stay full-bleed, as today.
- **D4 A 20 px grid** (FR-011), in addition to the planned 16 and 32.

## Decided (owner, 2026-10-31 13:41 UTC, answer "Ok" to the recommendations)

- **Q1 choice**: four icons in Settings, the world form follows the world (D1).
- **Q2 drawings**: the vector drawings and the walnut flat palette for the photo world are approved.
- **Q3 licence**: MIT (FR-061 is no longer pending).
- **Q4 crowns**: regenerate painted icons 2 and 3 with a plain three-point crown. Done 2026-10-31 for photo, cave and loft (6 images, `*-v1.png` kept); the new photo 2 and 3 are `Vikram: pending` (his earlier approval was for the old pictures), cave and loft `Paco: pending`.
- **Q5 trademark**: a quick web search, not legal advice. Done 2026-10-31 (3 queries): no similar crowned ">_" mark, "Agent Durbar" or Durbar software mark found; not a full search; notes in the art folder, not committed.
- **Q7 Clean palette**: the default Clean top bar uses the new base palette (D2).

## Open questions

- **Q6 (Paco) The cave and loft versions:** approve the painted pictures (regenerated with plain crowns) and the flat palettes, or change them? Until then those worlds show the base palette in the top bar and vector previews.

## Constitution check

- **I Spec Kit**: this PR is spec, plan, tasks; no `src/`.
- **II Adapter boundary**: not touched.
- **III Safe by default, no secrets**: no secrets, permissions or spawned process; the build script takes no user input.
- **IV No AI credits**: tests and drivers use the simulator; Q4's regeneration ran only after the owner said so (2026-10-31).
- **V Calm UI**: tile size and layout unchanged, 10.5 px checked, no motion added.
- **VI Windows, macOS, Linux**: the build script is cross-platform; real desktop checks are a named gap.
- **VIII Honest limits**: above.

## Changes

No deltas yet.
