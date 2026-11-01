# Real office world: Prehistoric cave (provenance, spec 097 FR-062..FR-069, spec 102 FR-205)

Every picture in this folder, where it comes from, who made and approved it, the exact prompt, and how it was cut and re-encoded.
Checked by `npm run test:realoffice-assets`. Only the `.webp` files, `world.json` (as `realoffice/worlds/cave/world.js`) and `world.css` ship; this file stays in the repository.

- **Licence:** MIT, like the code.
- **Tool:** Codex image generation (`codex exec`), codex-cli 0.163.0, on Vikram's ChatGPT plan with his OK, one run at a time, 2026-10-31. Reference for the style only: Paco's Prehistoric crew portrait of Big Beard (`src/renderer/crew/art/`).
- **Made by:** Vikram's agent (Claude Code), 2026-10-31. **Approved by:** Paco, 2026-10-31 (all 11 images, relayed by his agent in the team chat, 11:41 UTC: "Está bien"); `[KNOWN GAP]` the owner's own approval of the cave world is the gate in the spec's *Changes* (2026-11-01) and is not yet given.
- **Cut and re-encoded** by `scripts/build-cave-pack.py` (Pillow): the nine fixtures are the lobby sheet cropped with feathered edges, scaled by one factor (the door is the band's height) and set on a common floor line of 300; the desk is stretched to the engine's one desk shape; the floor tile and wall are resized; the monitor (`monitor.webp`) is the slate frame. WebP with alpha, no metadata.
- **Not generated:** flames, glows, name plates, lamps, screen text and all words are CSS or the app's own.


### lobby

- files: fx-bank.webp fx-boss.webp fx-coffee.webp fx-library.webp fx-other.webp fx-postbox.webp fx-software.webp fx-terminal.webp fx-web.webp
- source: gen/lobby/lobby.png (not shipped)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Paco, 2026-10-31 (relayed by his agent)
- reference: Paco's Big Beard portrait, style only
- prompt: A very wide panoramic image, about 3 to 1 (wide and short), the back wall of a prehistoric cave seen straight on from the front, eye level, almost no perspective. Along the rock wall, from left to right, NINE separate fixtures standing on the cave floor, each one clearly separated from its neighbours by a stretch of plain empty rock wall: 1 a cave-painting wall section with a stack of carved stone tablets; 2 a stone shelf holding carved stone boxes; 3 a big flat upright stone slab with softly glowing carved symbols (abstract glyphs only, not letters); 4 a hanging round globe woven from rope like a spider web net; 5 a big wooden door framed by two curved mammoth tusks; 6 a small campfire with a clay pot on stones; 7 a stone-tablet counter with piles of shell money on it; 8 a hollow upright log with a small pigeon sitting on it; 9 a wooden rack of stone axes and bone tools. A narrow strip of earthy stone floor along the bottom, empty. No people, no animals except the pigeon. Flickering torches on the wall between some fixtures give warm orange light. Use the attached image ONLY as the reference for the illustration style: the same hand-drawn cartoon look, bold dark brown outlines, warm cel-shaded painting with soft gradients, rich earthy colours, like a modern animated prehistoric comedy. Warm torchlight. Any people are fictional and resemble no real person. No text, no letters, no numbers, no logos, no watermark.
- cut: each fixture cropped with feathered edges, scaled to one factor, bottoms on one floor line (the hanging globe from the top)
- licence: MIT


### wall

- files: wall.webp
- source: gen/wall/wall.png (not shipped)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Paco, 2026-10-31 (relayed by his agent)
- reference: Paco's Big Beard portrait, style only
- prompt: A very wide panoramic image, about 3 to 1 (wide and short), of the plain back wall of a prehistoric cave seen straight on from the front, eye level, no perspective. Only warm brown rock wall with gentle cracks and a few small stalactites along the very top edge, and a few flickering wall torches spaced far apart. Nothing else: no furniture, no paintings, no objects, no people, no animals. The rock texture is even across the whole width so it can be repeated side by side. A thin strip of earthy floor along the bottom edge. Use the attached image ONLY as the reference for the illustration style: the same hand-drawn cartoon look, bold dark brown outlines, warm cel-shaded painting with soft gradients, rich earthy colours, like a modern animated prehistoric comedy. Warm torchlight. Any people are fictional and resemble no real person. No text, no letters, no numbers, no logos, no watermark.
- cut: top 660 px, resized, WebP
- licence: MIT


### desk

- files: desk.webp
- source: gen/desk/desk.png (not shipped)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Paco, 2026-10-31 (relayed by his agent)
- reference: Paco's Big Beard portrait, style only
- prompt: One prehistoric stone desk seen straight from the front, centred, on a fully TRANSPARENT background (PNG with alpha channel, no floor, no shadow plane, no backdrop). A long flat grey-brown stone slab desktop resting on two chunky rough rock legs, with a front panel of stacked flat stones. The desktop is completely empty except one small UNLIT clay oil lamp (a little round clay bowl with a spout, no flame) at the far right end. No screen, no tablet, no person, no chair. The desk is wide, about four times wider than it is tall. Use the attached image ONLY as the reference for the illustration style: the same hand-drawn cartoon look, bold dark brown outlines, warm cel-shaded painting with soft gradients, rich earthy colours, like a modern animated prehistoric comedy. Warm torchlight. Any people are fictional and resemble no real person. No text, no letters, no numbers, no logos, no watermark.
- cut: cropped to its alpha box, resized to the engine's desk shape
- licence: MIT


### slate

- files: monitor.webp
- source: gen/slate/slate.png (not shipped)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Paco, 2026-10-31 (relayed by his agent)
- reference: Paco's Big Beard portrait, style only
- prompt: One upright flat slate tablet used as a prehistoric computer monitor, seen straight from the front, centred, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no shadow plane). A wide rectangular dark grey slate slab, about 4 wide by 3 tall, with a smooth, very dark, completely EMPTY flat face (nothing drawn or carved on it) and a thick rough stone rim all around the edge, standing on a small rough stone base. The rim is even in thickness on all four sides. Use the attached image ONLY as the reference for the illustration style: the same hand-drawn cartoon look, bold dark brown outlines, warm cel-shaded painting with soft gradients, rich earthy colours, like a modern animated prehistoric comedy. Warm torchlight. Any people are fictional and resemble no real person. No text, no letters, no numbers, no logos, no watermark.
- cut: the frame, resized; CSS draws the screen text on the dark face
- licence: MIT


### floor

- files: floor.webp
- source: gen/floor/floor.png (not shipped)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Paco, 2026-10-31 (relayed by his agent)
- reference: Paco's Big Beard portrait, style only
- prompt: A seamless tileable texture of an earthy prehistoric cave floor seen from above at a slight angle: packed warm brown earth with flat irregular stone flags, a few small pebbles, evenly lit, low contrast, calm, no strong shadows, no objects, no footprints, no people. Fill the whole image edge to edge. Use the attached image ONLY as the reference for the illustration style: the same hand-drawn cartoon look, bold dark brown outlines, warm cel-shaded painting with soft gradients, rich earthy colours, like a modern animated prehistoric comedy. Warm torchlight. Any people are fictional and resemble no real person. No text, no letters, no numbers, no logos, no watermark.
- cut: resized to a 320 px tile, desaturated and darkened for calm (the cave art step), WebP
- licence: MIT


## References (not shipped)

- Paco's crew portraits, used for style only.

## Removed

None.
