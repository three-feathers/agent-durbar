# Feature Specification: Cheeky crew (a built-in scene kit and theme with 12 per-agent characters)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Cheeky crew (issue #558): a built-in theme and scene kit with 12 hand-drawn characters, one SVG source file each, picked at random per session and kept across restarts; status cues and spec 034 moods unchanged
status: Draft 2026-10-23: spec, plan and tasks only; owner questions Q1-Q8 open; experimental, no priority
-->

**Feature Branch**: `077-cheeky-crew`
**Created**: 2026-10-23
**Status**: Draft (spec, plan and tasks only; nothing built). Owner questions Q1-Q8 open; experimental, no priority.
**Input**: Issue #558 (owner idea, Paco, 2026-10-22, "nice to have, low priority"): "A funnier, cheekier office: each agent gets a character with personality (skater with cap and shades, mohawk punk with a skull mug, mad scientist with goggles and flasks, gamer with cat-ear headphones, surfer, hooded hacker, ...), instead of today's one calm office figure in different colours." Read against `origin/main` 7a756cb8 (PRs #496 and #500, which the issue waited for, are merged).

## Summary

Today every agent is the same calm office figure in different colours: skin, hair colour and style, shirt and glasses come from a hash of the agent's id (`lookFor`, `src/renderer/app.js:2656`), drawn by the office kit (`scene()`, `app.js:585-655`; `avatar()`, `app.js:658-663`) or one of five other scene kits (`src/renderer/scenekits.js`, kit list at line 10). No kit has personas or props, and a theme's art slots hold one string per theme (spec 040 FR-023), so every agent wears the same costume.

This feature adds a built-in theme **Cheeky Crew** with its own scene kit **`crew`**. In it, each session gets one of **12 characters** (young, fun, a bit cheeky, office-safe), picked at random the first time the session is drawn and kept for that session, also after a restart. Every status cue, every spec 034 mood and Serious mode stay exactly as they are; the character only adds clothes, hair, headwear, eyewear, a mug and one desk prop around them.

## Owner decisions (binding; Paco, issue #558, 2026-10-22)

- **OD1** Delivery: a built-in **"Cheeky crew" scene kit and theme** with per-agent characters. Persona slots for user or AI themes may follow later (not in this spec). No separate external skill.
- **OD2** **12 characters**, for variety.
- **OD3** Style: young, fun and a bit cheeky, but office-safe (for example sunglasses, nerd glasses, a punk). **No words, gestures or brands** in the art.
- **OD4** The characters do not need to express every mood: **today's spec 034 moods and Serious mode are kept** as they are.
- **OD5** Proportions: left to whoever draws them, within today's desk card layout.
- **OD6** Art: **we draw it ourselves** (no paid illustrator). Preference: **one separate image per character, if technically feasible**. The owner's AI-generated reference sheet is inspiration only; it is not copied or committed.
- **OD7** Assignment: **random**, with no special logic choosing the character for a session; kept for the session (proposal in the issue: random when first shown, then kept across redraws and restarts).
- **OD8** Experimental, no priority. Vikram (owner of specs 035-040 and 070) has been told.

## Design analysis: what "one image per character" can mean (open design point of the issue)

The status cues are SVG parts of the figure, drawn by code per status and mood: open or closed eyes (`app.js:604-612`), typing hands (`.hand-l`/`.hand-r`), the waving arm (`app.js:641-644`, SMIL wave in full density, CSS `.wave` in cards), the thought bubble (`app.js:652`), the status-coloured monitor and its content (`app.js:621-632`), the halo and glow (`app.js:594-597`), the idle or coffee-break cup and steam (`app.js:635`), and the mood signs: heavy body and sweat, monster skin, horns and frown, faint tilt, dizzy stars, impatient tap, ambulance (spec 034 FR-002). The other kits reuse the same code for all of them (`scenekits.js:17-96`, composer `draw()` at line 100). A single flat picture per character would freeze all of that.

Constraints every option is weighed against (all `read:` from the code at 7a756cb8 unless marked):

- **CSP** (`src/renderer/index.html:6`): `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Bundled images may load through `<img>` or SVG `<image>`; there is no `connect-src`, so `fetch()` of a bundled file falls back to `default-src 'none'` and is refused (inference from the CSP rules, not tried: unverified). The page is loaded with `loadFile` (`src/main/main.ts:812`), so its origin is `file:`.
- **Sanitizing**: theme art passes `sanitizeSlot` (`src/renderer/theme.js:225`): tags `g path rect circle ellipse line polyline polygon text`, an attribute allow-list without `id`, `href`, `style`, gradients or `<image>`, and no text between tags (so no words). Built-in art does not have to pass it, but holding our own art to it is a cheap guard for OD3.
- **Colour literal ratchet** (spec 070 FR-040, `scripts/test-theme-tokens.ts:84`): `scenekits.js` and `app.js` may not gain colour literals; built-in packs in `theme.js` hold token defaults and are exempt. Spec 070 FR-041 already allows "scene kits' fixed costume colours ... as named kit tokens".
- **Scale**: 15 agents on 1440x900 and 1280x800 (constitution V); the scene is redrawn only when its `data-sig` changes (`app.js:591`, agent note 2026-10-21); 15 inline scenes must stay cheap (agent notes: style recalculation, not layout, is the cost; no blur filters in compact scenes).
- **10.5px rule**: the art has no text; the chat number badge (spec 074 FR-012) sits on the top-left corner of the scene in every card density (`styles.css:1429`, `left:2px; top:2px`) and in a lounge resident's box (`styles.css:1703`).
- **Themes**: D3 of spec 070 (skin tones always the app's), the theme's tokens colour the furniture and cues, and theme art (spec 040 FR-023) is drawn over every kit.
- **Reduced motion and Serious mode**: motion is CSS-only (plus the existing SMIL wave and cursor, both off under reduced motion), and stops under `prefers-reduced-motion`; Serious mode drops the moods and the SMIL wave (`stillSig`, `app.js:657`).
- **Drawing 12**: someone (an agent or a person) has to draw 12 characters by hand, preview them, and fix them later.

| | (a) Per-character SVG parts in code (as the kits today) | (b) One bundled SVG file per character, layers toggled at run time | (c) PNG body plus SVG overlays for the cues | **(b') Recommended: one SVG source file per character, compiled at build into kit parts** |
|---|---|---|---|---|
| Owner's "one image per character" | No: template strings in a JS file | Yes | Yes | **Yes**: one `.svg` per character that opens on its own in a browser or Inkscape |
| Keeps every status cue and mood | Yes (shared code) | Only if the file is put inline in the page. `<img>` shows a sealed picture (no layer toggling, no page CSS, no theme tokens); inlining needs `fetch` (refused by the CSP, unverified) or an external `<use href="file.svg#part">` from a `file:` page (Chromium behaviour unverified) | Partly: the cues stay SVG, but heavy and monster bodies (wider torso, monster skin) and the faint head tilt need the body and head to be separate pictures, and skin must be drawn by SVG under a transparent hole | **Yes**: the compiled parts go through the same composer as every kit |
| CSP | Nothing new | Needs a new `connect-src` or an unverified `<use>` path | `img-src 'self'` allows it | **Nothing new**: no image, no fetch at run time |
| Sanitizing | Code review only | Run-time parse of our own files | PNG decode; no SVG check possible | **Build and test time**: every part must pass `sanitizeSlot` unchanged (no text, no `image`, no `href`) |
| File size | Small (~2-4 KB per character) | Small | Large: about 10-30 KB per character for a sharp 2x picture (estimate, unverified), plus one per density or blur | **Small**: target at most 8 KB per source file, at most 64 KB compiled for 12 |
| 15 agents, both screens | Proven by the kits | Same as (a) once inline | 15 `<image>` decodes per frame-free redraw; blurry when scaled across full, card, mini and micro; breaks the flat-fill pixel checks (`check:office-fill`) | Same as (a) |
| Themes (tokens, D3 skin, theme art) | Yes | Only inline | No: colours baked in; skin tones fixed by the picture (breaks D3) | **Yes**: colours map to `--crew-*` tokens and the agent's skin (and, per character, its shirt and hair colour) |
| Reduced motion, Serious mode | Yes | Yes once inline | Yes (the picture is still) | Yes |
| Ease of drawing 12 | Hard: paths typed into JS strings, no preview | Easy | Easy to paint, hard to line up with code-drawn eyes, hands and head | **Easy**: draw in any SVG editor on a guide of the 200x124 stage; the compiler checks the rules |

**Recommendation: (b')**, one hand-drawn SVG source file per character (`src/renderer/crew/<id>.svg`), split into named parts with `data-part` attributes, compiled by `npm run build` into a plain-JS module that the `crew` kit draws through the existing composer. It is the only option that gives the owner one image per character without a CSP change and without losing a single status cue. (a) is the fallback if the compile step is refused (Q1). (c) is not recommended: it fixes skin tones (against spec 070 D3), cannot follow themes, and blurs across densities. (b) at run time depends on two unverified Chromium paths and a CSP change.

## Clarifications (proposals; each is also a question below)

- **C1 Art format**: (b') as above (Q1).
- **C2 Assignment**: random **among the characters least used by the sessions currently in the office**, so twins only appear once 12 are taken (Q2). Plain random would give twins often: with 4 agents and 12 characters the chance of at least one pair is about 43% (birthday arithmetic: 1 - 12·11·10·9/12^4).
- **C3 Where it is kept**: in the window's `localStorage` under `durbar.crew`, a map from session id to character id, exactly like the chat numbers of spec 074 FR-011 (`CHATNO_KEY`, `app.js:27-35`). It is not a secret (a session id and a word), stays on this computer, has at most 500 entries, and loses the entries of sessions that are gone once the office has loaded (as `pruneNumbers`). A restart restores a folder's open sessions under their own ids (`sessionsToRestore`, `src/main/folders.ts:165`; `infoFor(... ls?.id ...)`, `src/main/main.ts:407`), so each one finds its character again (Q3).
- **C4 Simulator and demo**: nothing is stored (`rememberOn()`, `app.js:2529`); the pick is seeded by the agent's id so screenshots are stable, and with 15 simulated agents all 12 characters appear.

## Questions for the owner

Each has a recommended option; nothing is built until the owner answers or accepts the recommendations.

1. **Q1 Art format.** (a) inline SVG parts in code, like the kits; (b) bundled SVG files whose layers the code toggles at run time; (c) PNG body plus SVG overlays; **(b') recommended**: one SVG source file per character, compiled into the kit at build.
2. **Q2 How random.** (a) plain random (twins likely, see C2); **(b) recommended**: random among the characters the sessions in the office use least (still random, no character "belongs" to a kind of session); (c) a fixed order.
3. **Q3 Where the choice is kept.** **(a) recommended**: this window's `localStorage`, by session id, like the chat numbers (no main-process change, no new IPC); (b) the folder store in main (`openSessions` entries), so it also follows a copied profile, at the cost of a new field and IPC; (c) not kept at all: a hash of the session id (stable across restarts with no storage, but twins as in Q2a).
4. **Q4 Helpers (sub-agents).** **(a) recommended**: each helper tile gets its own random character by the same rule, not stored (helpers do not come back after a restart); (b) the helper wears its parent's character; (c) helpers keep today's plain figure.
5. **Q5 User and AI themes on the `crew` kit.** **(a) recommended**: a user theme may name `scene: "crew"` like any other kit (spec 040 FR-009); its art is drawn over the characters (spec 040 FR-023), and a theme `char-headwear` hides the character's own headwear part so two hats never stack; (b) the kit is for the built-in theme only until persona slots (OD1, later).
6. **Q6 Serious mode.** **(a) recommended**: the characters stay (Serious mode only removes the moods, spec 034 FR-004); (b) Serious mode shows the plain office figure on the crew furniture.
7. **Q7 Sunglasses and goggles.** **(a) recommended**: lenses are see-through enough that open and closed eyes still show (eyes are a status cue for Idle and a fainted agent); (b) worn pushed up on the head or cap; (c) opaque (loses the closed-eye cue; not recommended).
8. **Q8 The 12 and the first 4.** **Recommended Phase 1 (shown to the owner first)**: the **punk** (mohawk, skull mug), the **mad scientist** (goggles, lab coat, flask), the **gamer** (cat-ear headphones, gamepad) and the **hooded hacker** (hood, rubber duck). They cover the hard cases: a tall hairdo near the chat badge and the horns, eyewear over the eyes, side props near the waving arm, a hood instead of hair, and a character mug in place of the idle cup. **Phase 2, the other 8**: the **skater** (backwards cap and shades, mini skateboard), the **surfer** (sun-bleached long hair, shell necklace, tiny surfboard), the **cool kid** (sunglasses, quiff, jacket), the **nerd** (big round glasses, bow tie, book stack), the **artist** (beret, paint-splashed smock, brush jar), the **rocker** (bandana, studded jacket, small amp), the **space fan** (headband with two star boppers, toy rocket), the **cozy knitter** (pom-pom beanie, chunky scarf, yarn ball). The owner may swap any of them.

## User Scenarios & Testing

### Story 1 - A cheeky office (P1)

Paco picks **Cheeky Crew** in Settings > Theme. His 9 sessions now sit at desks as different characters: a punk with a skull mug, a mad scientist in goggles, a gamer in cat-ear headphones. Each one still types while working, waves while it waits for him, has a thought bubble while thinking, and its monitor shows the status colour and sign.

**Independent test**: simulator with 15 agents, pick Cheeky Crew; every desk shows a crew character; with all 12 drawn, all 12 characters appear; every status shows its usual cues.

1. **Given** Cheeky Crew is active, **When** an agent is Working, Thinking, Waiting, Idle, Error or Done, **Then** its desk shows the same cues as in Clean Office (monitor colour and sign, hands, wave, bubble, cup, closed eyes) and the character never covers them.
2. **Given** an agent's context passes 70% or 90%, or it fails three tool calls, faints or calls the ambulance, **Then** the spec 034 signs show on the character (wider body and sweat, monster skin and horns, tilt, stars, tap, ambulance).
3. **Given** Serious mode is on, **Then** no mood sign is drawn and the characters stay (Q6).

### Story 2 - The same character after a restart (P1)

Paco's punk session is still the punk after he redraws, switches themes and back, closes and reopens the app.

**Independent test**: unit tests of the pick and the stored map; a driver that reloads the window with a stored map and finds the same character on the same session.

1. **Given** a session was first drawn as the gamer, **When** the office redraws, a theme switch comes back to Cheeky Crew, or the app restarts and restores the session, **Then** it is the gamer again.
2. **Given** a session ends and the office has loaded, **Then** its entry is dropped, and its character is free for the next new session.

### Story 3 - Characters everywhere the agent appears (P2)

The walking figure in the lobby, the resting figure in the lounge, the chat header, the chat strip chips and the inbox rows show the same character's head and shoulders as the desk.

### Edge cases

- More than 12 sessions: twins appear, picked among the least used (Q2).
- Storage full, refused or corrupt: the pick falls back to the seeded pick for that id (stable for the window's life); a corrupt map is ignored, as the chat numbers do (`loadNumbers`).
- A user theme on the `crew` kit with `char-headwear`: the character's own headwear part is not drawn (Q5).
- Monster mood: skin is `--monster-skin` (as today) and the horns are drawn over the character's hair and hood.
- Heavy and monster bodies are wider (`torso()`, `scenekits.js:93`): a character's clothes fit both widths.

## Requirements

### Kit and theme

- **FR-001** A new scene kit **`crew`** joins the fixed kit list (spec 035 FR-013) in `scenekits.js` (`KITS`), `theme.js` (`SCENE_KITS`) and `src/shared/themes.ts` (`SCENE_KITS`); `test:scenekits` already asserts the lists match (`scripts/test-scenekits.ts:19`). The AI theme maker prompt lists it (Q5).
- **FR-002** A new built-in theme **Cheeky Crew** (id `cheeky-crew`, `scene: 'crew'`, an existing UI style, `extends: 'clean-office'`) is registered in `theme.js` like the other built-in packs and named in every list of built-in ids (`src/main/ipc/themes.ts:23` and the test and driver lists, see plan). It lays out exactly like Clean Office (spec 035 FR-010): only colours and the kit change.
- **FR-003** The `crew` kit draws through the existing composer (`draw()` and `avatar()` in `scenekits.js`), so the halo, screen content, face (eyes and mouth), arms and hands, cup steam, thought bubble and mood signs are the shared code, in the same places and with the same animation hooks (`.pp`, `.head`, `.hand-l`, `.hand-r`, `.wave`, `.tap`, `.bar`, `.cursor`, `.steam`, `.bubble-g`, `.dizzy`, `.sweat`, `.amb`, `.halo`, `.glow`). Its furniture (chair, desk, monitor frame, keyboard) is its own, in a playful style, coloured by tokens.

### Characters

- **FR-010** 12 characters (Q8), each young, fun and a bit cheeky but office-safe; **no words, letters, numbers, hand gestures, logos or brand shapes** in the art. No character is tied to a gender, age band or ethnicity; skin tones always come from the app's varied set (spec 070 D3), never from the character.
- **FR-011** Each character is **one SVG source file** `src/renderer/crew/<id>.svg` on the 200x124 stage (head centre 74,44, radius 12.5, as every kit), split into parts by `data-part`: `back` (behind the body: hood back, long hair), `body` (clothes details over the kit's torso), `body-wide` (optional, for heavy and monster), `hair` (hair, hood front, cap; under the horns and the face), `top` (eyewear and headphones; over the face), `cup` (the character's mug, shown only when the kit would show the cup: Idle or a coffee break, spec 068), `desk` (one desk prop) and `guide` (the reference furniture for drawing; never drawn). Optional per-character settings sit on the root: whether the shirt and hair use the agent's colours or the character's own.
- **FR-012** Colours in a source file are plain hex so the file previews anywhere. Four **reserved colours** stand for the agent's skin, skin shade, shirt and hair; every other colour must be the default of one `--crew-*` token in the Cheeky Crew pack. The compiler maps them; any other colour fails the build. So the compiled kit has no colour literals (spec 070 FR-040) and a user theme on the `crew` kit can recolour the costumes.
- **FR-013** Every part, after mapping, passes `sanitizeSlot` (spec 040 FR-005) unchanged: no text, no `image`, no `href`, no `style`, no script, no comments in the output. Size: at most 8 KB per source file (without `guide`), at most 64 KB for the compiled module, at most 40 elements per drawn character.
- **FR-014** Protected zones, in stage coordinates, that no character part may cover (checked on the drawn scene, FR-040):
  - the monitor, its stand and the halo: x 101-187, y 22-88;
  - the thought bubble and the chat number badge corner: x 16-61, y 3-34;
  - the eyes and mouth: x 66-83, y 42-55, unless the part is see-through enough that open and closed eyes stay visible (Q7);
  - the laptop zone x 55-99, y 79-88 and the cup zone x 96-114, y 66-87, except the `cup` part in its own zone;
  - outside the mini and compact view boxes (x below 24 or above 186; y below 5): nothing;
  - the walking figure's view box (x 50-98, y 20-68) holds the whole of `back`, `body`, `hair` and `top`, so a mohawk is not cut off.
  The `desk` prop sits on the desktop left of the chair (x 24-50, y 60-86), clear of the ambulance (x 18-54, y 89-114). The waving arm and the hands are drawn after the character, so nothing covers them.
- **FR-015** Character art is static: no new animation in this feature. The existing animated hooks keep working, so reduced motion and Serious mode behave as today.
- **FR-016** Eyes and glasses: in the `crew` kit the agent's own `glasses` flag and hair style are not used (the character decides); open and closed eyes and the mouth are the shared face.

### Assignment and storage

- **FR-020** A pure module `src/renderer/crew.js` (UMD, no DOM) picks a character for a session id: random among the characters least used by the sessions now in the office (Q2), with an injected random source. Under the simulator and the demo the random source is seeded by the session id, so a run is repeatable.
- **FR-021** The choice is kept in `localStorage` under `durbar.crew` (map session id to character id), only when `rememberOn()`: at most 500 entries, ids up to 200 characters, unknown character ids and bad entries ignored on load; once the office has loaded, entries of sessions that are gone are dropped. It holds no secret, no path and no content (constitution III). A session keeps its character across redraws, theme switches and restarts (C3).
- **FR-022** The choice is made the first time a session is drawn in the `crew` kit and kept whatever the theme; switching to another theme and back shows the same character.
- **FR-023** Helpers (sub-agents) get a character by the same rule, not stored (Q4).
- **FR-024** The character id is part of the scene signature (`data-sig`), of `sceneCacheKey` (`app.js:836`) and of each walker's key, so a scene is redrawn when it changes and never reuses another character's drawing (agent note 2026-10-21, spec 040 FR-023).

### Composition with theme art and the chat badge

- **FR-030** Theme art (spec 040 FR-023) is drawn over the character exactly as over every kit: body art over `body`, headwear art inside the head group after `hair` and `top`. When the active theme has `char-headwear`, the character's `hair` keeps its hair but its headwear (cap, hood front, headphones) is not drawn, so two hats never stack (Q5). Cheeky Crew itself has no art slots, so nothing is drawn over its characters.
- **FR-031** The chat number badge (spec 074 FR-012) keeps its place on the scene's top-left corner in every card density and in the lounge; FR-014 keeps that corner free of art, so the badge never hides a character part and a character part never shows through or around it.

### Accessibility

- **FR-035** Characters are decoration: every scene and figure stays `aria-hidden="true" focusable="false"` (as today); the art has no `<title>`, `<desc>` or text. The desk's accessible name, tooltip and the List view words do not change: the agent's name, status and mood phrases (spec 034 FR-003, FR-014) carry the meaning, never the character. State is never shown by the character alone.

### Checks

- **FR-040** Tests with no credits: `test:scenekits` gains the `crew` kit in its every-kit loops (overlays drawn, headwear in the head group, key in the signature, walker wears the art); a new unit test covers `crew.js` (least-used pick, seeded repeatability, load caps, prune) and the compiler (reserved and token colours, unknown colour fails, every part passes `sanitizeSlot`, sizes, `guide` dropped); `test:theme-tokens` scans the compiled module at 0 literals. A simulator driver draws every character in every status, mood and density and asserts FR-014 with `getBBox()` on each `data-part`, plus the 10.5px and overlap rules (`check:office`) with Cheeky Crew active at 1440x900 and 1280x800.
- **FR-041** Screenshots at 1440x900 and 1280x800 (simulator, 15 agents) in `docs/screenshots/`, and one sheet of all characters in all statuses for the owner's review.

## Success Criteria

- **SC-001** With Cheeky Crew and 15 simulated agents, `check:office` passes at 1440x900 and 1280x800 in every density, chat closed and open.
- **SC-002** For every character, status and mood, the protected zones of FR-014 are free (driver, `getBBox()`).
- **SC-003** A session shows the same character after a reload of the window with the same stored map (driver) and after `pruneCrew` keeps its id (unit test).
- **SC-004** No new colour literal in the renderer's scanned files; the compiled module scans at 0.
- **SC-005** Clean Office and every other built-in theme draw byte-identically to before (`test:scenekits`, `check:geometry`).

## Known limits

- `[KNOWN GAP]` Not tried on macOS or Windows by a person; CI covers the unit tests and drivers there (constitution VI).
- `[KNOWN GAP]` `localStorage` belongs to one window profile: the character does not follow a profile copied to another computer (Q3b would).
- `read:` only, not verified: that `fetch()` and an external `<use>` of a bundled file are refused or unreliable in this page (the reason (b) at run time is not recommended).
- Persona slots for user and AI themes (one costume per agent from a theme) are out of scope (OD1, later).

## Changes

(none yet)

## Owner answers (Paco, 2026-10-23)

All eight questions were answered with the recommended option:
- **Q1** Art format: **(b′) one SVG source file per character, compiled at build** into scene-kit parts.
- **Q2** Assignment: **random among the characters least used in the office**.
- **Q3** Storage: **this window's `localStorage`, like the chat numbers** (`durbar.crew`, at most 500 entries).
- **Q4** Helpers: **their own random character, not stored**.
- **Q5** User and AI themes: **may use the `crew` kit; a theme's headwear hides the character's own headwear**.
- **Q6** Serious mode: **characters stay** (still, as Serious mode already removes motion and mood extras).
- **Q7** Sunglasses and goggles: **see-through lenses, eyes visible**.
- **Q8** Phase 1: **punk, mad scientist, gamer, hooded hacker**; the other 8 in Phase 2.

A hand-drawn sketch of six characters in this style (punk, mad scientist, gamer, hooded hacker, sunglasses, nerd glasses) was shown to the owner on 2026-10-23; it is a sketch, not the final art.

