# Plan: Cheeky crew (spec 077)

Written against `origin/main` 7a756cb8. Assumes the recommended answers to Q1-Q8 in `spec.md`; if the owner picks another option, the affected steps are named under *If the owner decides otherwise*.

## Approach

1. **Source art** (Q1 b'): `src/renderer/crew/<id>.svg`, one file per character, viewBox `0 0 200 124`. A shared drawing guide (`src/renderer/crew/_guide.svg`, the crew furniture, the protected zones of FR-014 as outlines, the reserved colours as swatches) is copied into a file's `data-part="guide"` group while drawing; the compiler drops it. A header comment per file says who drew it and that it is MIT, drawn for this repo (provenance; no AI raster, the owner's reference sheet is not copied).
2. **Compiler** `scripts/crew-compile.js` (plain Node, no dependency): reads the files, takes each top-level `<g data-part="...">`, maps the reserved colours to placeholders for the agent's skin, skin shade, shirt and hair and every other hex to its `--crew-*` token (by exact default value in the Cheeky Crew pack in `theme.js`; unknown hex = error), runs every part through `THEME._sanitizeSlot` and requires the output to equal the input, checks the sizes of FR-013, and writes `dist/renderer/crew-art.js` (UMD: `{ ids, parts: { id: { back, body, bodyWide, hair, headwear, top, cup, desk, ownShirt, ownHair } } }` with token placeholders). It is called from `scripts/copy-assets.js` (so `npm run build` and packaging get it) and exported as a function for the unit test. The generated file is not committed (no drift). Order of names in `ids` is fixed by a list in the compiler, so a new file never reorders the old ones.
3. **Kit** `KIT.crew` in `scenekits.js`: chair, desk, monitor, keyboard and cup in a playful style from tokens only; `hairBack`, `body`, `hair`, `headTop`, `cup` and `props` read the agent's character parts from `window.DurbarCrewArt` (in Node: `require` of the compiled module, or parts injected by the test) and fill the placeholders with `T()` and the agent's look. The character id comes in `base.crew` (from app.js). The kit's `draw()` signature appends the character id after the kit id (`...|crew|<id>`), so the positions `done|` and the mood at the end keep their meaning for the existing parsers.
   - The face stays `face(o)` with `glasses` forced off; `horns()` is drawn after `hair`, `top` after the face (the existing composer order: `K.head + K.hair + horns + face + K.headTop + art.head`, `scenekits.js:120`).
   - `headwear` is a sub-part of `hair` (cap, hood front, headphones band) so FR-030 can drop it when the theme has `char-headwear` (`THEME.slot('char-headwear') !== null`, passed in `base.art`).
   - `body-wide` is used when `wide(o)`; else `body`.
4. **Tokens and theme** in `theme.js`: about 16-24 `--crew-*` colour tokens added to `CLEAN_TOKENS` (named kit tokens, spec 070 FR-041; `theme.js` is outside the literal ratchet) and the **Cheeky Crew** built-in pack (`registerBuiltIn`, light playful colours on the `clean` UI style, `scene: 'crew'`, no art slots, motion preset `default`). Check before adding: whether the AI theme maker prompt lists every `CLEAN_TOKENS` key (`src/shared/themegen.ts`); if so, leave the `--crew-*` keys out of the prompt's list or name them as one group, to keep the prompt short (unverified which today).
5. **Kit list**: add `'crew'` to `KITS` (`scenekits.js:10`), `SCENE_KITS` (`theme.js:347`) and `src/shared/themes.ts:62`; add `cheeky-crew` to `BUILT_IN_THEME_IDS` (`src/main/ipc/themes.ts:23`) and the lists in `scripts/check-parallel.js:47`, `scripts/check-ui-text.js:338`, `scripts/shots-052-addleft.js:20`, `scripts/check-theme-geometry.js`, `scripts/test-theme.ts`, `scripts/test-userthemes.ts`, `scripts/test-ui-suite.ts`, `scripts/test-scenekits.ts` (all found by `grep -rln durbar-japanese scripts src`). Spec 035 FR-013 gets a dated one-line delta for the kit list; spec 040 FR-009 refers to it and needs no edit.
6. **Assignment** `src/renderer/crew.js` (UMD, pure, like `navigator.js`): `pickCharacter(id, ids, inUse, rand)`, `assignCrew(map, sessionIds, ids, rand)`, `pruneCrew(map, liveIds)`, `loadCrew(json, ids)` (at most 500 entries, id length at most 200, unknown character ids dropped), `seeded(id)` (the `hashN` of `app.js:2655` as a small PRNG seed). In `app.js`, next to `syncChatNos` (`app.js:29`): `CREW_KEY='durbar.crew'`, `crewOf(a)` that loads once, assigns lazily, saves only when `rememberOn()` and prunes only after `agentsListed` (the same guard the chat numbers use, so restored sessions keep theirs while the office loads). Helpers use `crewOf` with no save (Q4a).
7. **Wiring in `app.js`**: `scene()` and `avatar()` pass `crew: crewOf(a)` in the kit's `base` only when `THEME.sceneKit()==='crew'` (no cost for other themes); `sceneCacheKey` (`app.js:836`) and the walker key (`w.tk`, `app.js:424` and `:445`) add the character id. Load `crew-art.js` and `crew.js` before `scenekits.js` in `index.html`; add both to `copy-assets.js` (the compiled one is written, the pure one copied).
8. **Checks**: `scripts/test-crew.ts` (`test:crew`, in `npm test`): pick, seed, caps, prune, compiler rules on fixture SVGs (good file, unknown colour, `<text>`, `href`, oversize), and that every real source file compiles. `test:scenekits` adds `crew` to its every-kit loops with injected parts. `test:theme-tokens` adds the compiled module to `FILES` with ratchet 0 (it must run after the build, or the test compiles in memory: decide in T005, prefer in memory so the test needs no build). Driver `scripts/check-crew.js` (in `check:ui` via `scripts/ui-suite.js`): Cheeky Crew picked in Settings (real path, agent note 2026-10-21), every character forced in turn through a `?simcrew=<id>` dev query (or the seeded pick over 15 agents plus a status sweep), every status and mood (`simwaitold=1` and the spec 034 sim agents), full and card densities, `getBBox()` of each `[data-part]` against FR-014, and a sheet screenshot. `check:office` and `check:geometry` include the theme (geometry: in the every-theme list for `main` and nightly; pull requests keep Retro only, spec 008 FR-111).

## Reuse (existing capability first)

- The scene kit composer and its shared cue code (`scenekits.js` `draw`, `avatar`, `halo`, `screenContent`, `face`, `arms`, `afterPerson`), not a parallel renderer.
- `sanitizeSlot` (`theme.js:225`) as the art rule, not a new SVG checker.
- The chat-number storage pattern (`syncChatNos`, `NAV.loadNumbers`/`pruneNumbers`, `rememberOn`) for the per-session map, not a new IPC channel or store.
- `registerBuiltIn` and the token defaults for the theme; the theme art overlays (`kitArt()`, `app.js:576`) unchanged.
- `check:office`, `check:geometry`, `check:theme-art`, `check:office-fill` as they are, with the theme added to their lists.

## Constitution check

- I (Spec Kit): this spec, plan and tasks first; the spec 035 FR-013 delta in the first code PR.
- II (adapters): renderer only; no adapter or vendor type involved.
- III (safe, no secrets): `localStorage` holds session ids and character ids only; no new IPC; built-in art passes the user-art sanitizer; no network, no image.
- IV (no credits): simulator and unit tests only.
- V (calm, legible): no new text; layout identical to Clean Office (`check:geometry`); `check:office` at both sizes; no new motion; no blur filter; protected zones keep every status cue readable; state never by the character alone.
- VI (parity): pure JS and SVG; paths in the compiler with `path.join`; drivers run in CI on three OSes.
- VII (gates): `npm run typecheck && npm run build && npm test`, screenshots at 1440x900 and 1280x800.
- VIII (honest limits): `[KNOWN GAP]`s in the spec; the unverified CSP inferences are marked `read:`.

## Risks

- **Drawing quality at small sizes**: in micro density a head is a few pixels; props must read as silhouettes. Mitigation: the Phase 1 sheet at every density goes to the owner before the other 8 are drawn.
- **Cost of 15 richer scenes**: more SVG elements per desk raise style recalculation (agent note 2026-10-21). Mitigation: at most 40 elements per character (FR-013), measured by the driver; no filters; no new animation.
- **Compositor blur** (agent note 2026-10-23): parts drawn over the animated hands or bars can blur. Mitigation: character parts sit under the arms and away from the monitor; no `opacity`/`transform` animation on them.
- **Ratchet and token growth**: the token count grows by about 20 (today about 118 colour keys in `CLEAN_TOKENS`, `theme.js:24-140`; read, approximate). Check any manifest token cap in `validateManifest` before adding.
- **A generated file in `dist/` only**: unit tests that `require` the renderer module from `src/` need the compiler in memory (step 8).

## If the owner decides otherwise

- Q1 (a): drop the compiler; parts are written as strings in `src/renderer/crewparts.js`, which then joins the literal ratchet at 0 (colours as `T('--crew-*')`). Steps 1-2 and part of 8 go away.
- Q1 (c) or (b): needs a CSP change and new checks; replan with the owner.
- Q2 (a): `pickCharacter` ignores `inUse`. Q2 (c): a fixed order by first appearance.
- Q3 (b): a `crew` field on `openSessions` entries (`folders.ts:44`), set through a new validated IPC call; main checks the id against the list. Q3 (c): no storage; `seeded(id)` only.
- Q4 (b): helpers take `crewOf(parent)`. Q4 (c): the kit draws the office figure for helpers.
- Q5 (b): a separate `BUILTIN_ONLY_KITS` list that user manifests may not name (main and renderer validators).
- Q6 (b): `crewOf` returns null under Serious mode and the kit draws the plain figure.
