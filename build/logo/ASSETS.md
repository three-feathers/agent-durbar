# Logo family: provenance (spec 101)

The four logo drawings of Agent Durbar (icons 1, 2, 3 and 5 are the owner's numbers; there is no icon 4), their flat colour palettes and the app icon files built from icon 1. One row per file; `npm run test:logo-assets` checks that every file here has a row and that the `approved by` rule holds.

## How these were made

- **Concepts (not in the repo):** Vikram, Telegram, 2026-10-31, asked for the family. The concept pictures were made by Vikram's agent with Codex image generation (`codex exec`) on Vikram's ChatGPT plan, approved by him for this use, one run per picture, 2026-10-31. They were only looked at to measure proportions; nothing is traced, embedded or copied from them.
- **Drawings (in the repo):** drawn by Vikram's agent in plain SVG, every shape written out as numbers, with no image generator, no raster, no gradient and no stroke. Each shape carries `data-slot` and a literal `fill`. Files: `icon-N.svg` (1024), `icon-N-32.svg`, `icon-N-20.svg`, `icon-N-16.svg`; the small ones are tuned on the pixel grid, not scaled.
- **Palettes:** the base palette and the photo palette (a walnut plate) were chosen by hand; the cave and loft palettes too. The painted world pictures (concept art in photo, cave and loft style) are not in the repo.
- **Licence:** MIT, like the code and the crew art (spec 101 FR-061, decided 2026-10-31).
- **Approval:** the `approved by` cell holds a name and a date. Base and photo rows need `Vikram`; cave and loft rows need `Paco` (spec 101 FR-062). Paco approved the cave and loft columns on 2026-11-01; Vikram relayed this in his build instruction.
- **Trademark:** a quick web search was done on 2026-10-31 (three queries): no similar crowned `>_` mark and no software mark named "Agent Durbar" or "Durbar" turned up. This is **not a clearance**, not legal advice and not a registry or reverse-image search; before any public launch a human should search the registries (classes 9 and 42). Nothing here claims the mark is free to use.
- **Not checked:** the drawings were looked at in headless Chromium on Linux only, not in a real Dock, Finder, Explorer or installer.

## Prompts of the four base concepts (copied word for word)

Every prompt below was followed by this brief:

> Style brief: a square app icon, 1024x1024, flat modern vector look on a soft macOS-style rounded square that fills nearly the whole canvas. Simple bold shapes with at most three colours besides the background and no fine detail, so it still reads at 16 and 32 pixels. Centred with generous margin. No text and no letters other than the prompt symbol described. Every small robot is the same original design: one wide rounded-square head, two plain round dot eyes, one short straight antenna with a small ball on top, centred on the head, no mouth, no ears, no goggles, no visor. No arches, no domes, no curved-top doorways, no buildings, no religious, national or ethnic symbols, no crescent, no star, no cross. Any human figure is genderless: only a circle and a plain body. No real brands, no existing logos, no real people, no chess pieces, no resemblance to any famous robot mascot. No mockup, no drop shadow onto a background, no device frame, just the icon itself.

**Icon 1, Prompt sovereign** (`round3/concepts/1b-prompt-sovereign.png`, concept only):

> A large command line prompt symbol in the upper part of the icon: a very thick right-pointing chevron followed by a thick short underscore bar, both in warm gold, with a small plain geometric crown in the same gold floating just above the chevron. The crown is only a flat band with three plain sharp triangular points, with NO balls, beads or dots on the tips and no jewels. Along the bottom of the icon, a straight row of three much smaller identical robot heads in soft pale blue with dark dot eyes, evenly spaced with wide gaps, all attending the prompt above them. On a very dark near-black navy rounded square, and the four corners outside the rounded square are pure white. Thick, chunky shapes, no window frame, no other characters. Nothing else.

**Icon 2, Terminal chair** (`round3/concepts/2-chair-terminal.png`, concept only):

> A modern tall high-backed chair seen straight from the front, in solid warm gold, pure straight geometry: a tall rectangular back with a flat square top, one thick plain seat of the same width as the back, two short straight legs, no armrests. The back of the chair IS a terminal screen: a large dark near-black rectangular panel set inside the gold back, showing a thick off-white right-pointing chevron followed by a thick short underscore bar. A small simple flat three-pointed gold crown floats just above the flat top of the chair. On each side of the chair, low down near the floor, stands one small robot in soft pale blue with dark dot eyes, a head on a small plain rounded body, much shorter than the chair, with clear gaps. The chair is empty and waiting. On a very dark deep navy rounded square. No ornament, no carving. Nothing else.

**Icon 3, Figure with badge** (`round3/concepts/3-figure-badge.png`, concept only):

> One simple human figure in the upper centre, a round head and a plain rounded-shoulder body, in warm off-white, with a small simple flat three-pointed crown in bright gold floating just above its head, not touching. The body carries a command line prompt symbol in dark navy: a thick right-pointing chevron followed by a thick short underscore bar, filling the chest like a badge. Below the figure, a straight row of three much smaller identical robot heads in soft pale blue with dark dot eyes, side by side with wide gaps. On a very dark deep navy rounded square. No face on the human, no clothing detail. Nothing else.

**Icon 5, Underscore floor** (`round3/concepts/5b-underscore-floor.png`, concept only):

> A command line prompt symbol used as a scene. In the upper left, a very large and very thick warm gold right-pointing chevron, with a small plain geometric gold crown floating just above it; the crown is only a flat band with three plain sharp triangular points, with NO balls, beads or dots on the tips. Across the bottom of the icon, a very long, very thick, solid gold horizontal bar, the underscore of the prompt, running almost the full width like a floor. Three identical robot HEADS ONLY, with no bodies, no arms and no legs, in soft pale blue with large dark dot eyes, sit in a row directly on top of the bar, touching it, side by side with clear gaps, each head large enough to read at small size. On a very dark near-black navy rounded square. Thick, chunky shapes, no window frame, no other characters. Nothing else.

## Files

| file | icon | form | world | tool | date | prompt | made by | licence | approved by |
|---|---|---|---|---|---|---|---|---|---|
| `icon-1.svg` | 1 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (1024) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-1-32.svg` | 1 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (32) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-1-20.svg` | 1 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (20) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-1-16.svg` | 1 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (16) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-2.svg` | 2 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (1024) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-2-32.svg` | 2 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (32) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-2-20.svg` | 2 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (20) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-2-16.svg` | 2 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (16) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-3.svg` | 3 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (1024) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-3-32.svg` | 3 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (32) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-3-20.svg` | 3 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (20) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-3-16.svg` | 3 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (16) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-5.svg` | 5 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (1024) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-5-32.svg` | 5 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (32) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-5-20.svg` | 5 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (20) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `icon-5-16.svg` | 5 | vector | base | hand-drawn SVG, no generator | 2026-10-31 | hand-drawn (16) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `palette:base` | all | palette | base | hand-chosen colours (FR-014) | 2026-10-31 | hand-chosen | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `palette:photo` | all | palette | photo | hand-chosen colours (FR-101), walnut plate | 2026-10-31 | hand-chosen | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `palette:cave` | all | palette | cave | hand-chosen colours (FR-102) | 2026-10-31 | hand-chosen | Vikram's agent | MIT | Paco, 2026-11-01 (relayed in Vikram's build instruction) |
| `palette:loft` | all | palette | loft | hand-chosen colours (FR-102) | 2026-10-31 | hand-chosen | Vikram's agent | MIT | Paco, 2026-11-01 (relayed in Vikram's build instruction) |
| `../icon.svg` | 1 | built | base | `scripts/build-icons.js` (offscreen Electron) | 2026-11-01 | a copy of icon-1.svg | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `../icon.png` | 1 | built | base | `scripts/build-icons.js` (offscreen Electron) | 2026-11-01 | 1024 px render of icon-1.svg | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `../icon.ico` | 1 | built | base | `scripts/build-icons.js` (offscreen Electron) | 2026-11-01 | 7 PNG entries from icon-1 drawings (FR-041) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
| `../icon.icns` | 1 | built | base | `scripts/build-icons.js` (offscreen Electron) | 2026-11-01 | 10 PNG entries from icon-1 drawings, plate at 824/1024 from 128 px (D3) | Vikram's agent | MIT | Vikram, 2026-10-31 (spec 101 Q2) |
