# Real office world: Retro arcade (provenance, spec 097 FR-062..FR-069, spec 102 FR-250..FR-259, T206)

A hall of arcade cabinets, drawn **in code** (`scripts/build-arcade-pack.py`, from the owner-approved mockup's drawing, redrawn with level glass), no image-generation run. One file pixel is one grid pixel, lossless WebP; two runs give the same bytes. Only the `.webp` files and `world.json` ship; this file stays in the repository. Nothing draws this world yet (`WORLD_FLAGS.retro` is closed, spec 102 RA3 draws it).

- **Licence:** MIT, like the code.
- **Fictional:** no real brand, logo, franchise or character is drawn; the cabinets and fixtures are invented shapes.

### room-day

- files: wall.webp floor.webp
- source: `drawBackdrop` of the mockup (`layouts/mock/arcade.js`), day palette: brick wall with a stepped rim and three floppy disks, a diamond lattice floor tile (24 x 24, repeats), a soft dithered shadow under the wall (6 rows, partly transparent)
- tool: `scripts/build-arcade-pack.py` (Pillow)
- date: 2026-11-01
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-11-01 (the mockup's look; the rebuilt pictures have not been looked at by him)
- reference: the mockup
- prompt: none, drawn in code
- cut: the wall is 720 x 118 grid pixels, its four neon signs in the middle so a crop at another scale keeps them
- licence: MIT

### room-night

- files: wall-night.webp floor-night.webp
- source: as room-day, the night palette: dark navy brick, neon tubes with a dithered halo
- tool: `scripts/build-arcade-pack.py` (Pillow)
- date: 2026-11-01
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-11-01 (the mockup's look)
- reference: the mockup
- prompt: none, drawn in code
- cut: as room-day; not listed in `lightSets` yet because its `welcome-night` part is not drawn (spec 102 FR-252: all three or none)
- licence: MIT

### cabinets

- files: monitor.webp monitor-half.webp monitor-narrow.webp
- source: the mockup's cabinet, **redrawn level** (spec 102 FR-258): level front, level glass and marquee (both holes the app fills), a side panel and a stepped top; four colours per strip, screen on the left (the app mirrors it with a static transform)
- tool: `scripts/build-arcade-pack.py` (Pillow)
- date: 2026-11-01
- made by: Vikram's agent (Claude Code)
- approved by: pending (the owner has not yet looked at the level cabinet, T200)
- reference: the mockup and `layouts/mock/arcade-level-compare.png` (art cache)
- prompt: none, drawn in code
- cut: `monitor.webp` is the big cabinet for 1 to 4 people (glass 75 x 50), `monitor-half.webp` the small one (56 x 32) and `monitor-narrow.webp` a narrower one (44 x 32) for a floor too narrow for the small one with the chat open
- licence: MIT

### fixtures

- files: fx-library.webp fx-software.webp fx-terminal.webp fx-web.webp fx-boss.webp fx-coffee.webp fx-bank.webp fx-postbox.webp fx-other.webp
- source: the mockup's nine arcade things: prize counter, cartridge wall, service panel, pinball table, attract-mode cabinet, change machine, coin vault, ticket dispenser, repair bench; drawn at the mockup's size (34 to 48 grid pixels tall, a person is 72: spec 102 Q6 asks whether to redraw them taller)
- tool: `scripts/build-arcade-pack.py` (Pillow)
- date: 2026-11-01
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-11-01 (the mockup's look)
- reference: the mockup
- prompt: none, drawn in code
- cut: every fixture on one canvas as tall as the tallest (48), standing on the bottom row
- licence: MIT

### glow

- files: glow.webp
- source: the mockup's dithered pool of light, one cell (56 x 15) per state in the app's day status colours
- tool: `scripts/build-arcade-pack.py` (Pillow)
- date: 2026-11-01
- made by: Vikram's agent (Claude Code)
- approved by: pending
- reference: the mockup
- prompt: none, drawn in code
- cut: seven cells: working, thinking, waiting, error, limit, done, idle
- licence: MIT

### console

- files: desk.webp
- source: a low console and stool for a person who is asleep (spec 102 FR-259): a **placeholder**, nobody has looked at it
- tool: `scripts/build-arcade-pack.py` (Pillow)
- date: 2026-11-01
- made by: Vikram's agent (Claude Code)
- approved by: pending
- reference: none
- prompt: none, drawn in code
- cut: 40 x 22 grid pixels
- licence: MIT

## Removed

None.
