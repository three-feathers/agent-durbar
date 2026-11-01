# Real office world: Photo office: provenance (spec 097 FR-062..FR-069, spec 102 FR-205)

Every picture in this folder, where it comes from, who made and approved it, the exact prompt, and how it was cut and re-encoded.
Checked by `npm run test:realoffice-assets` (every file listed once, every section complete, the fictional-people clause and a
`likeness-check` on every person sheet). Only the `.webp` files and `world.json` ship (as `realoffice/worlds/photo/world.js`); this file stays
in the repository.

- **Licence:** MIT, like the code and the crew art (spec 097 FR-064, Q4: Vikram, 2026-10-31).
- **Tool:** Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol), run on Vikram's ChatGPT plan with his OK, 2026-10-31. Command: `codex exec --skip-git-repo-check --ephemeral -s workspace-write -C <dir> [-i <reference>] -- "Use your image generation tool to create ONE image and save it in the current folder as <name>.png. Image: <prompt> Do nothing else."` The prompt below is the exact text after "Image:".
- **Made by:** Vikram's agent (Claude Code), 2026-10-31. **Approved by:** Vikram (owner), 2026-10-31, when he chose the B2 mockup.
- **Cut and re-encoded** by the build PR (spec 097 P1), 2026-10-31: each sheet was sliced into one picture per pose (the mockup's slicer),
  then Pillow 10.2 re-encoded every picture as WebP with alpha, quality 0.80, method 6, no EXIF, XMP or ICC chunk, persons resized to at
  most 640 px tall (spec 097 FR-062). `people.json` keeps each picture's metadata in the source sheet's pixels (`w`, `h`, `headTop`,
  `bodyH`, `hand` for a seated pose; `figH` and per-pose `[w, h]` for standing ones; the four extra poses of a `stand2` sheet are
  converted to its `stand` sheet's scale), so a resize does not change it. For every standing picture it also keeps `feet` and
  `top` (owner 2026-10-31 10:19): the lowest and highest rows with at least 3 pixels over alpha 128, as a share of the shipped
  picture's height, measured with Pillow from the alpha channel; the lobby stands people on their feet, not on the picture's box.
- **Fictional people (FR-067):** the generation prompts of 2026-10-31 describe invented people (age, look, clothes) and name no real
  person, but they did not carry the fictional-people clause, which spec 097 added later the same day. The clause is recorded beside
  each person sheet below (`fictional:`); every new prompt for this pack must carry it in the prompt itself.
- **Resemblance check (FR-068):** Vikram (owner) looked at a contact sheet of all 15 people (p01–p15) and confirmed, by
  Telegram DM on 2026-10-31 at 10:46 UTC, that he approves them and that none resembles a real or famous person; the
  `seat`, `stand` and `stand2` sheets' `likeness-check` records it; the 15 `run-pNN` sheets were checked the same way on 2026-10-31 at 12:44 UTC (Telegram DM, "likeness ok"). A new person sheet starts as `pending (<approver>)`, and a release must not ship with
  a pending entry. If a resemblance is reported, the picture is removed and replaced,
  and the removal is recorded under *Removed* (picture, date, who reported, replacement) and in the changelog.
- **Provenance is only here (FR-069, [KNOWN GAP]):** the re-encode strips any C2PA or content-credential manifest the generator
  embedded, so the shipped files carry no machine-readable provenance.
- **No treadmill (2026-10-31, Vikram 11:22 UTC):** the standing sheets' third pose (a person on a treadmill desk) is not shipped (15 pictures removed, `people.json` without `tread`); the prompts below are kept exactly as run. The running pose that replaces it is the `run-pNN` sheets below.
- **Running sheets (2026-10-31):** p01 and p04 used the first prompt; every other sheet used the second, which adds "mirror strides" because the first gave p02 and p03 the same leg twice. Each section's prompt is the one that sheet was made with. Two sheets still lift the same leg in both frames after their one retry: p03 (attempt 2, the retry) and p15 (attempt 1, of its two the closer to the person); P1 draws only stride A, so this first shows in P2's stepped motion.
- **Not generated:** the monitors are drawn in CSS; lights are CSS overlays (D4).


### desk3

- files: desk.webp
- source: `room-art/v2/desk3/desk3.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-desk2/b-desk-front-2.png` (an earlier generated desk; its prompt is under *References* below)
- prompt: One office desk seen from the front, centred, on a fully TRANSPARENT background (PNG with alpha channel, no floor, no shadow plane). Light oak desktop, black steel legs, a light oak front modesty panel. The desktop is completely empty except a white mug at the far right end. No monitor, no chair, no person, no keyboard. Same look as the attached desk. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata
- licence: MIT

### b-backwall

- files: fx-library.webp fx-software.webp fx-terminal.webp fx-web.webp fx-boss.webp fx-coffee.webp fx-bank.webp fx-postbox.webp fx-other.webp floor.webp
- source: `room-art/b-backwall/b-backwall.png` (not shipped), one 1672x941 render of the whole back wall
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: none
- prompt: A wide 16:9 panoramic view of the back wall of the office, seen straight on from the front. From left to right along the wall: a library bookshelf, a software shelf, a wall-mounted terminal screen, a globe kiosk, double doors (the Boss office), a coffee bar, a bank counter with a glass panel, a blue postbox, and a red tool cart. High windows above the wall with daylight. The floor in the foreground is light oak and completely empty. No people. Photoreal 3D render, front-facing eye-level-from-slightly-above camera (about 20° down), mild perspective, modern open-plan software office, warm daylight, light oak, white walls, black steel, plants; clean, calm, realistic, no text, no logos.
- cut: the build PR re-cropped every fixture from the wall at one top (y 192) and one floor line (y 468), so each is whole and all share a scale (FR-023); sides feathered over 14 px; the Terminal keeps the wall screen only (rows above y 331), the Web the globe only (rows from y 332); `floor.webp` is the floor band (y 470..600) at quality 0.70; WebP, no metadata
- re-cut (#921 review, owner 2026-11-01): the Web globe's wall and floor patch showed in front of the wall (a feathered rectangle with the photo's floor at the bottom); the picture was cut out again with Pillow (background flood-filled from the edges, floor rows and a stray strip removed, the largest piece kept, edge softened 0.7 px), re-encoded as WebP quality 80, method 6, no metadata; same size and floor line. Other fixtures are photo bays and were looked at at both sizes (no change).
- licence: MIT

## References (generated the same day, not shipped)

- `room-art/b-person/b-person-sheet.png` (render-style reference for every seated sheet; an invented woman): A sheet with THREE poses side by side in one row, on a fully TRANSPARENT background (PNG with alpha channel), equal spacing with clear empty gaps between them. The SAME person in all three: a woman in her 30s with curly dark hair and a mustard cardigan over a white top, seen from the front, sitting on a black office chair, only her chair back and her upper body from the lap up are shown (draw NO desk, no table, no monitor). Pose 1 working: typing, looking down. Pose 2 waiting: right arm raised high. Pose 3 resting: leaning back with hands behind her head. Photoreal 3D render look, realistic, soft warm daylight, same camera about 20 degrees down, no text.
- `room-art/b-desk2/b-desk-front-2.png` (reference for the desk): One office desk seen from the front, centred, on a fully TRANSPARENT background (PNG with alpha channel, no floor, no shadow plane). Light oak desktop, black steel legs. A single monitor seen from behind (we see the back of the monitor) placed at the FAR LEFT end of the desk, occupying only the left third of the desk width. A mug at the far right end. The right two thirds of the desktop behind the monitor are completely empty, open space above them where a person would sit; no chair, no person, no keyboard. Photoreal 3D render, front-facing eye-level-from-slightly-above camera (about 20° down), mild perspective, modern open-plan software office, warm daylight, light oak, white walls, black steel, plants; clean, calm, realistic, no text, no logos.

## Removed

None.
