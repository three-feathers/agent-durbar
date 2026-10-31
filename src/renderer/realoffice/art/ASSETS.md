# Real office art: provenance (spec 097 FR-062..FR-069)

Every picture in this folder, where it comes from, who made and approved it, the exact prompt, and how it was cut and re-encoded.
Checked by `npm run test:realoffice-assets` (every file listed once, every section complete, the fictional-people clause and a
`likeness-check` on every person sheet). Only the `.webp` files and `people.json` ship (as `realoffice/art/people.js`); this file stays
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


### seat-p01

- files: p01-typeA.webp p01-typeB.webp p01-waveA.webp p01-waveB.webp p01-think.webp p01-rest.webp
- source: `room-art/v2/seat-p01/seat-p01.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a man in his mid 50s, light skin, short grey hair and a neat grey beard, rectangular glasses, navy crew-neck sweater over a light blue collared shirt. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

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

### seat-p02

- files: p02-typeA.webp p02-typeB.webp p02-waveA.webp p02-waveB.webp p02-think.webp p02-rest.webp
- source: `room-art/v2/seat-p02/seat-p02.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her early 30s, East Asian, straight black chin-length bob with a fringe, rust-red blouse. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p03

- files: p03-typeA.webp p03-typeB.webp p03-waveA.webp p03-waveB.webp p03-think.webp p03-rest.webp
- source: `room-art/v2/seat-p03/seat-p03.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her 30s, Mediterranean, curly dark shoulder-length hair, mustard cardigan over a white top. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p04

- files: p04-typeA.webp p04-typeB.webp p04-waveA.webp p04-waveB.webp p04-think.webp p04-rest.webp
- source: `room-art/v2/seat-p04/seat-p04.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a man in his 60s, Japanese, short swept-back grey hair, thin round glasses, beige cardigan over a white shirt. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p05

- files: p05-typeA.webp p05-typeB.webp p05-waveA.webp p05-waveB.webp p05-think.webp p05-rest.webp
- source: `room-art/v2/seat-p05/seat-p05.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her mid 20s, Turkish, long straight dark-brown hair in a high ponytail, plum-purple knit sweater, small gold stud earrings. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p06

- files: p06-typeA.webp p06-typeB.webp p06-waveA.webp p06-waveB.webp p06-think.webp p06-rest.webp
- source: `room-art/v2/seat-p06/seat-p06.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a man in his 30s, light skin, long brown hair tied in a low ponytail, short stubble, plain black t-shirt under an open grey overshirt. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p07

- files: p07-typeA.webp p07-typeB.webp p07-waveA.webp p07-waveB.webp p07-think.webp p07-rest.webp
- source: `room-art/v2/seat-p07/seat-p07.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her 40s, South Asian, black hair in a low bun, teal tunic top with a thin grey scarf. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p08

- files: p08-typeA.webp p08-typeB.webp p08-waveA.webp p08-waveB.webp p08-think.webp p08-rest.webp
- source: `room-art/v2/seat-p08/seat-p08.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her 20s, Black, short natural curly hair, olive-green utility jacket over a cream t-shirt. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p09

- files: p09-typeA.webp p09-typeB.webp p09-waveA.webp p09-waveB.webp p09-think.webp p09-rest.webp
- source: `room-art/v2/seat-p09/seat-p09.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a man in his 30s, Middle Eastern, short dark hair and a full trimmed beard, charcoal grey hoodie. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p10

- files: p10-typeA.webp p10-typeB.webp p10-waveA.webp p10-waveB.webp p10-think.webp p10-rest.webp
- source: `room-art/v2/seat-p10/seat-p10.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a young man in his 20s, Nordic, blond buzz cut, light freckles, brown-and-cream checked flannel shirt. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p11

- files: p11-typeA.webp p11-typeB.webp p11-waveA.webp p11-waveB.webp p11-think.webp p11-rest.webp
- source: `room-art/v2/seat-p11/seat-p11.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her late 50s, light skin, straight silver shoulder-length hair, burgundy blazer over a black top. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p12

- files: p12-typeA.webp p12-typeB.webp p12-waveA.webp p12-waveB.webp p12-think.webp p12-rest.webp
- source: `room-art/v2/seat-p12/seat-p12.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a man in his 40s, Black, bald, black rectangular glasses, short beard, denim-blue button-up shirt. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p13

- files: p13-typeA.webp p13-typeB.webp p13-waveA.webp p13-waveB.webp p13-think.webp p13-rest.webp
- source: `room-art/v2/seat-p13/seat-p13.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her 30s, South-East Asian, wearing a soft sage-green hijab and a cream cardigan. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p14

- files: p14-typeA.webp p14-typeB.webp p14-waveA.webp p14-waveB.webp p14-think.webp p14-rest.webp
- source: `room-art/v2/seat-p14/seat-p14.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her late 20s, light skin with freckles, long copper-red hair, forest-green sweater. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### seat-p15

- files: p15-typeA.webp p15-typeB.webp p15-waveA.webp p15-waveB.webp p15-think.webp p15-rest.webp
- source: `room-art/v2/seat-p15/seat-p15.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/b-person/b-person-sheet.png` (an earlier generated sheet of an invented woman, used only for render style, light, framing and camera; its prompt is under *References* below)
- prompt: Create a character sheet: SIX poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear empty gaps between the poses; every pose drawn at exactly the same size and scale, the chair in the same place in each. The SAME person in all six: a woman in her 60s, Latina, short wavy grey hair, terracotta sweater, reading glasses. Seen from the front, sitting on a black mesh office chair; show only the chair back and the person from the lap up. Draw NO desk, no table, no monitor, no keyboard, no laptop, no props. Pose 1 typing: both forearms forward and low, hands at lap height as if typing on a keyboard, eyes looking down. Pose 2 typing a moment later: same as pose 1 but the left hand lifted a little and the right hand pressing down. Pose 3 waving: right arm raised high with an open palm, friendly smile at the viewer. Pose 4 waving a moment later: same as pose 3 but the raised hand tilted outward. Pose 5 thinking: one hand on the chin, eyes looking up to the side. Pose 6 resting: leaning back relaxed, hands behind the head. Use the attached image only as the reference for render style, lighting, framing and camera; draw a DIFFERENT person as described. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
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
- licence: MIT

## Facing poses (spec 097 FR-191..FR-194; added 2026-10-31)

Fifteen sheets, one per person, view a (three-quarter from behind, turned to the viewer's right), seven poses each: book, type, knock, counter, letter, run, runb. Every frame is **mirrored horizontally** when it is cut, so the shipped pictures face **left**: the lobby puts every visitor to the right of its fixture (spec 097 FR-025), so facing left faces the fixture. The frames show no text, logo or writing (looked at on a contact sheet of all 105 on 2026-10-31); nothing with readable text is mirrored. View b (directly from behind) was generated but is not shipped.

- **Tool:** Codex image generation (`codex exec`), codex-cli 0.163.0, on Vikram's ChatGPT plan with his OK (2026-10-31, 14:34 UTC); one `codex exec` per sheet from an empty folder, with the person's seated-stand reference `room-art/v2/stand-pNN/stand-pNN.png`. Command as in *Tool* above. No API credits.
- **Prompt** (view a; `pNN` differs only in the attached reference; exact text from `prompts2.py`, wrapper "Use your image generation tool to create ONE image and save it in the current folder as facing-pNN-a.png. Image: <prompt> Do nothing else."):

```
Create a character sheet: SEVEN standing poses side by side in one single row, wide landscape image, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps so no pose touches or overlaps another; every pose at exactly the same scale, full body from head to shoes, both feet fully visible, all feet on one common horizontal baseline. The SAME person as in the attached image (same hair, build and clothes, same shoes), a fictional person who resembles no real or famous person. Clothes keep the same relaxed, loose, office-appropriate fit as in the attached image: nothing tight or form-fitting anywhere, trousers and tops hang loosely, and no pose emphasises the body. VIEW: in EVERY pose the person is seen THREE-QUARTER FROM BEHIND, turned toward the RIGHT edge of the image. They face away from the camera and to the right, and whatever they do is on their far side toward the right edge. We see their back and their left shoulder blade, the back of the head, and only a sliver of the left cheek and ear in profile; we never see their chest, the eyes looking at us, or the front of the face. Pose 1: taking a book from a shelf: one arm reaching forward to the right at chest height, elbow bent, fingers taking hold of the spine of a single book as if on a shelf at chest height; the arm is not raised high. Pose 2: typing at a standing screen: both arms forward to the right, hands at chest height in the air, head tilted to the right as if reading a screen; no screen drawn. Pose 3: knocking on a door: one arm raised forward to the right, loose fist at head height. Pose 4: standing at a counter: one arm forward to the right at waist height with the hand open and flat in the air as if resting on a counter top; the other hand holds a white coffee cup at chest height. Pose 5: posting a letter: one arm forward to the right at waist height, the hand holding a plain blank white envelope flat, pushing it forward as if into a slot; the other arm relaxed at the side. Pose 6: running in place toward the right, stride A: the left knee lifted, the left foot off the floor, elbows bent, the supporting right foot on the baseline; no treadmill. Pose 7: running in place toward the right, stride B, the OPPOSITE of stride A: the right knee lifted, the right foot off the floor, elbows bent with opposite arm swing, the supporting left foot on the baseline; no treadmill. Nothing else is drawn: no bookshelf, no screen, no door, no counter, no furniture, no mailbox, only the person and the props named. Photoreal 3D render, camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
```

- **Cut and encoded** (2026-10-31, Pillow 10.2): the frames of the sheets were sliced one per pose, mirrored, resized so each person's head-to-sole height is 600 px (every frame at most 611 px tall), and saved as WebP with alpha, quality 80, method 6, no metadata, 18 to 35 KB each. `people.json` keeps each frame's size in the person's old standing units (so the people keep the heights the owner approved), `feet` and `top` (rows with at least 3 pixels over alpha 128, as a share of the picture) and `foot` (the horizontal centre of the planted feet as a share of the width, the mean of the opaque pixels of the lowest 3 % of the figure). `people.json` `facing` is `left`.
- **Pose to picture:** `book` and `runA`/`runB` keep their names; `run` is `runA` and `runb` is `runB`; `counter` replaces `coffee`; `type` is new; `letter` and `knock` keep their names. The old `box`, `touch`, `tool`, `wait` pictures (4 people) and the old frames of the same names are removed (records below, *Removed*).
- **Running frames:** every person has both strides. `[KNOWN GAP]` p03 and p15 lift the same leg in both strides (they differ only in the arm swing); P1 draws only `runA`, so it shows first in P2.
- **Redone frames:** `p14-a` run and runb and `p10-a` runb come from re-run sheets (2026-10-31, the same command and references); p13's run frame had a remnant of the envelope erased by hand (pixels at x<28, y 232-268 of the frame). The sheets and the first attempts are in the coordinator's art cache, not in the repository.
- **Weak spots still there:** a faint red or yellow edge fringe at some transparent edges (measured, not removed); p01's `letter` and `runb` come from a second two-pose sheet of the same person, whose scale was matched by head-to-sole height.
- **Likeness check (FR-068):** Vikram (owner) approved the likeness of the facing frames of all 15 people on 2026-10-31 at 15:29 UTC, including his request to fix the weak spots; the 13 redone frames were shown to him afterwards and he had no objection.

### facing-p01

- files: p01-book.webp p01-type.webp p01-knock.webp p01-counter.webp p01-letter.webp p01-runA.webp p01-runB.webp
- source: `facing/sheets/facing-p01-a.png` (not shipped) (`letter` and `runb` from the two-pose sheet `facing-p01-extra`, reference unchanged), frames `facing/frames-final/p01-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p01/stand-p01.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p02

- files: p02-book.webp p02-type.webp p02-knock.webp p02-counter.webp p02-letter.webp p02-runA.webp p02-runB.webp
- source: `facing/sheets/facing-p02-a.png` (not shipped), frames `facing/frames-final/p02-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p02/stand-p02.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p03

- files: p03-book.webp p03-type.webp p03-knock.webp p03-counter.webp p03-letter.webp p03-runA.webp p03-runB.webp
- source: `facing/sheets/facing-p03-a.png` (not shipped), frames `facing/frames-final/p03-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p03/stand-p03.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p04

- files: p04-book.webp p04-type.webp p04-knock.webp p04-counter.webp p04-letter.webp p04-runA.webp p04-runB.webp
- source: `facing/sheets/facing-p04-a.png` (not shipped), frames `facing/frames-final/p04-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p04/stand-p04.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p05

- files: p05-book.webp p05-type.webp p05-knock.webp p05-counter.webp p05-letter.webp p05-runA.webp p05-runB.webp
- source: `facing/sheets/facing-p05-a.png` (not shipped), frames `facing/frames-final/p05-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p05/stand-p05.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p06

- files: p06-book.webp p06-type.webp p06-knock.webp p06-counter.webp p06-letter.webp p06-runA.webp p06-runB.webp
- source: `facing/sheets/facing-p06-a.png` (not shipped), frames `facing/frames-final/p06-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p06/stand-p06.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p07

- files: p07-book.webp p07-type.webp p07-knock.webp p07-counter.webp p07-letter.webp p07-runA.webp p07-runB.webp
- source: `facing/sheets/facing-p07-a.png` (not shipped), frames `facing/frames-final/p07-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p07/stand-p07.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p08

- files: p08-book.webp p08-type.webp p08-knock.webp p08-counter.webp p08-letter.webp p08-runA.webp p08-runB.webp
- source: `facing/sheets/facing-p08-a.png` (not shipped), frames `facing/frames-final/p08-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p08/stand-p08.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p09

- files: p09-book.webp p09-type.webp p09-knock.webp p09-counter.webp p09-letter.webp p09-runA.webp p09-runB.webp
- source: `facing/sheets/facing-p09-a.png` (not shipped), frames `facing/frames-final/p09-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p09/stand-p09.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p10

- files: p10-book.webp p10-type.webp p10-knock.webp p10-counter.webp p10-letter.webp p10-runA.webp p10-runB.webp
- source: `facing/sheets/facing-p10-a.png` (not shipped), frames `facing/frames-final/p10-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p10/stand-p10.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference. `runb` from the re-run sheet.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p11

- files: p11-book.webp p11-type.webp p11-knock.webp p11-counter.webp p11-letter.webp p11-runA.webp p11-runB.webp
- source: `facing/sheets/facing-p11-a.png` (not shipped), frames `facing/frames-final/p11-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p11/stand-p11.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p12

- files: p12-book.webp p12-type.webp p12-knock.webp p12-counter.webp p12-letter.webp p12-runA.webp p12-runB.webp
- source: `facing/sheets/facing-p12-a.png` (not shipped), frames `facing/frames-final/p12-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p12/stand-p12.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p13

- files: p13-book.webp p13-type.webp p13-knock.webp p13-counter.webp p13-letter.webp p13-runA.webp p13-runB.webp
- source: `facing/sheets/facing-p13-a.png` (not shipped), frames `facing/frames-final/p13-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p13/stand-p13.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference. `run` with the envelope remnant erased by hand.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p14

- files: p14-book.webp p14-type.webp p14-knock.webp p14-counter.webp p14-letter.webp p14-runA.webp p14-runB.webp
- source: `facing/sheets/facing-p14-a.png` (not shipped), frames `facing/frames-final/p14-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p14/stand-p14.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference. `run` and `runb` from the re-run sheet.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

### facing-p15

- files: p15-book.webp p15-type.webp p15-knock.webp p15-counter.webp p15-letter.webp p15-runA.webp p15-runB.webp
- source: `facing/sheets/facing-p15-a.png` (not shipped), frames `facing/frames-final/p15-a-*.png`
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 15:29 UTC
- reference: `room-art/v2/stand-p15/stand-p15.png` (the person's standing sheet above)
- prompt: the view a prompt under *Facing poses* above, with this reference.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt asks for a fictional person who resembles no real or famous person)
- likeness-check: Vikram, 2026-10-31 15:29 UTC (facing frames of all 15 reviewed, weak spots fixed, the 13 redone frames shown without objection)
- cut: one picture per pose, mirrored to face left, head-to-sole 600 px, WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

## References (generated the same day, not shipped)

- `room-art/b-person/b-person-sheet.png` (render-style reference for every seated sheet; an invented woman): A sheet with THREE poses side by side in one row, on a fully TRANSPARENT background (PNG with alpha channel), equal spacing with clear empty gaps between them. The SAME person in all three: a woman in her 30s with curly dark hair and a mustard cardigan over a white top, seen from the front, sitting on a black office chair, only her chair back and her upper body from the lap up are shown (draw NO desk, no table, no monitor). Pose 1 working: typing, looking down. Pose 2 waiting: right arm raised high. Pose 3 resting: leaning back with hands behind her head. Photoreal 3D render look, realistic, soft warm daylight, same camera about 20 degrees down, no text.
- `room-art/b-desk2/b-desk-front-2.png` (reference for the desk): One office desk seen from the front, centred, on a fully TRANSPARENT background (PNG with alpha channel, no floor, no shadow plane). Light oak desktop, black steel legs. A single monitor seen from behind (we see the back of the monitor) placed at the FAR LEFT end of the desk, occupying only the left third of the desk width. A mug at the far right end. The right two thirds of the desktop behind the monitor are completely empty, open space above them where a person would sit; no chair, no person, no keyboard. Photoreal 3D render, front-facing eye-level-from-slightly-above camera (about 20° down), mild perspective, modern open-plan software office, warm daylight, light oak, white walls, black steel, plants; clean, calm, realistic, no text, no logos.

## Earlier versions, not in the pack

- `seat-p05`, `stand-p05`, `stand2-p05` (first version, 2026-10-31): replaced before the mockup because p05 looked too much like p03 (another invented person of this pack, not a real one); regenerated with "long straight dark-brown hair in a high ponytail". First description: a woman in her mid 20s, Turkish, long dark-brown wavy hair, plum-purple knit sweater, small gold stud earrings.

## Earlier standing and running sets, replaced 2026-10-31 (files removed, not in the pack)

The sections below are kept as the record of how those sheets were made, approved and likeness-checked; their pictures were replaced by the facing frames (see `facing-pNN` above) and removed from the folder. Headings are one level down so the pack check does not expect their files.

#### stand-p01

- files (removed 2026-10-31): p01-book.webp p01-coffee.webp p01-letter.webp p01-knock.webp
- source: `room-art/v2/stand-p01/stand-p01.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p01/seat-p01.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p09

- files (removed 2026-10-31): p09-book.webp p09-coffee.webp p09-letter.webp p09-knock.webp
- source: `room-art/v2/stand-p09/stand-p09.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p09/seat-p09.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p10

- files (removed 2026-10-31): p10-book.webp p10-coffee.webp p10-letter.webp p10-knock.webp
- source: `room-art/v2/stand-p10/stand-p10.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p10/seat-p10.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p11

- files (removed 2026-10-31): p11-book.webp p11-coffee.webp p11-letter.webp p11-knock.webp
- source: `room-art/v2/stand-p11/stand-p11.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p11/seat-p11.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p14

- files (removed 2026-10-31): p14-book.webp p14-coffee.webp p14-letter.webp p14-knock.webp
- source: `room-art/v2/stand-p14/stand-p14.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p14/seat-p14.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p15

- files (removed 2026-10-31): p15-book.webp p15-coffee.webp p15-letter.webp p15-knock.webp
- source: `room-art/v2/stand-p15/stand-p15.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p15/seat-p15.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p05

- files (removed 2026-10-31): p05-book.webp p05-coffee.webp p05-letter.webp p05-knock.webp
- source: `room-art/v2/stand-p05/stand-p05.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p05/seat-p05.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p02

- files (removed 2026-10-31): p02-book.webp p02-coffee.webp p02-letter.webp p02-knock.webp
- source: `room-art/v2/stand-p02/stand-p02.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p02/seat-p02.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p03

- files (removed 2026-10-31): p03-book.webp p03-coffee.webp p03-letter.webp p03-knock.webp
- source: `room-art/v2/stand-p03/stand-p03.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p03/seat-p03.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p04

- files (removed 2026-10-31): p04-book.webp p04-coffee.webp p04-letter.webp p04-knock.webp
- source: `room-art/v2/stand-p04/stand-p04.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p04/seat-p04.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p06

- files (removed 2026-10-31): p06-book.webp p06-coffee.webp p06-letter.webp p06-knock.webp
- source: `room-art/v2/stand-p06/stand-p06.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p06/seat-p06.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p07

- files (removed 2026-10-31): p07-book.webp p07-coffee.webp p07-letter.webp p07-knock.webp
- source: `room-art/v2/stand-p07/stand-p07.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p07/seat-p07.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p08

- files (removed 2026-10-31): p08-book.webp p08-coffee.webp p08-letter.webp p08-knock.webp
- source: `room-art/v2/stand-p08/stand-p08.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p08/seat-p08.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p12

- files (removed 2026-10-31): p12-book.webp p12-coffee.webp p12-letter.webp p12-knock.webp
- source: `room-art/v2/stand-p12/stand-p12.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p12/seat-p12.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand-p13

- files (removed 2026-10-31): p13-book.webp p13-coffee.webp p13-letter.webp p13-knock.webp
- source: `room-art/v2/stand-p13/stand-p13.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p13/seat-p13.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FIVE standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), now standing, body turned slightly toward the viewer. Pose 1: flipping through an open book held at chest height, looking at the pages. Pose 2: sipping from a white coffee cup. Pose 3: walking on a compact flat black treadmill walking pad, both hands forward at chest height typing on a small black keyboard on a slim stand. Pose 4: holding a white envelope forward in one hand, as if posting a letter or handing it over a counter. Pose 5: one hand raised in a loose fist at head height, knocking on a door, glancing at the viewer. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall; the treadmill pose (pose 3, `-tread`) is not shipped: removed 2026-10-31 on the owner\'s word (Vikram, 11:22 UTC, "may be don\'t use treadmill"), the Terminal visitor stands instead
- licence: MIT

#### stand2-p05

- files (removed 2026-10-31): p05-box.webp p05-touch.webp p05-tool.webp p05-wait.webp
- source: `room-art/v2/stand2-p05/stand2-p05.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p05/seat-p05.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FOUR standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), standing, body turned slightly toward the viewer. Pose 1: holding a small plain cardboard box in both hands, as if just taken from a shelf. Pose 2: reaching one hand forward to touch something round at chest height, curious. Pose 3: holding a wrench in one hand, looking at it. Pose 4: standing relaxed, hands together, waiting. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

#### stand2-p02

- files (removed 2026-10-31): p02-box.webp p02-touch.webp p02-tool.webp p02-wait.webp
- source: `room-art/v2/stand2-p02/stand2-p02.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p02/seat-p02.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FOUR standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), standing, body turned slightly toward the viewer. Pose 1: holding a small plain cardboard box in both hands, as if just taken from a shelf. Pose 2: reaching one hand forward to touch something round at chest height, curious. Pose 3: holding a wrench in one hand, looking at it. Pose 4: standing relaxed, hands together, waiting. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

#### stand2-p12

- files (removed 2026-10-31): p12-box.webp p12-touch.webp p12-tool.webp p12-wait.webp
- source: `room-art/v2/stand2-p12/stand2-p12.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p12/seat-p12.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FOUR standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), standing, body turned slightly toward the viewer. Pose 1: holding a small plain cardboard box in both hands, as if just taken from a shelf. Pose 2: reaching one hand forward to touch something round at chest height, curious. Pose 3: holding a wrench in one hand, looking at it. Pose 4: standing relaxed, hands together, waiting. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

#### stand2-p06

- files (removed 2026-10-31): p06-box.webp p06-touch.webp p06-tool.webp p06-wait.webp
- source: `room-art/v2/stand2-p06/stand2-p06.png` (not shipped), sliced by the mockup's slicer
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31
- reference: `room-art/v2/seat-p06/seat-p06.png` (the same person's seated sheet above)
- prompt: Create a character sheet: FOUR standing poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). Equal spacing with clear gaps; every pose at exactly the same scale, full body from head to shoes. The SAME person as in the attached image (same face, hair and clothes), standing, body turned slightly toward the viewer. Pose 1: holding a small plain cardboard box in both hands, as if just taken from a shelf. Pose 2: reaching one hand forward to touch something round at chest height, curious. Pose 3: holding a wrench in one hand, looking at it. Pose 4: standing relaxed, hands together, waiting. No other props. Photoreal 3D render, front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (recorded by the build PR, 2026-10-31; the prompt above did not carry it)
- likeness-check: Vikram, 2026-10-31 10:46 UTC (contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: one picture per pose, re-encoded WebP 0.80 with alpha, no metadata, at most 640 px tall
- licence: MIT

#### run-p01

- files (removed 2026-10-31): p01-runA.webp p01-runB.webp
- source: `room-art/run/run-p01.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p01-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. Pose 1, stride A: left knee lifted forward, right foot flat on the ground, right arm forward. Pose 2, stride B: the opposite moment, right knee lifted forward, left foot flat on the ground, left arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p02

- files (removed 2026-10-31): p02-runA.webp p02-runB.webp
- source: `room-art/run/run-p02.png` (not shipped; attempt 2)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p02-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p03

- files (removed 2026-10-31): p03-runA.webp p03-runB.webp
- source: `room-art/run/run-p03.png` (not shipped; attempt 2)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p03-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p04

- files (removed 2026-10-31): p04-runA.webp p04-runB.webp
- source: `room-art/run/run-p04.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p04-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. Pose 1, stride A: left knee lifted forward, right foot flat on the ground, right arm forward. Pose 2, stride B: the opposite moment, right knee lifted forward, left foot flat on the ground, left arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p05

- files (removed 2026-10-31): p05-runA.webp p05-runB.webp
- source: `room-art/run/run-p05.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p05-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p06

- files (removed 2026-10-31): p06-runA.webp p06-runB.webp
- source: `room-art/run/run-p06.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p06-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p07

- files (removed 2026-10-31): p07-runA.webp p07-runB.webp
- source: `room-art/run/run-p07.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p07-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p08

- files (removed 2026-10-31): p08-runA.webp p08-runB.webp
- source: `room-art/run/run-p08.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p08-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p09

- files (removed 2026-10-31): p09-runA.webp p09-runB.webp
- source: `room-art/run/run-p09.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p09-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p10

- files (removed 2026-10-31): p10-runA.webp p10-runB.webp
- source: `room-art/run/run-p10.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p10-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p11

- files (removed 2026-10-31): p11-runA.webp p11-runB.webp
- source: `room-art/run/run-p11.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p11-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p12

- files (removed 2026-10-31): p12-runA.webp p12-runB.webp
- source: `room-art/run/run-p12.png` (not shipped; attempt 2)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p12-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p13

- files (removed 2026-10-31): p13-runA.webp p13-runB.webp
- source: `room-art/run/run-p13.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p13-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p14

- files (removed 2026-10-31): p14-runA.webp p14-runB.webp
- source: `room-art/run/run-p14.png` (not shipped; attempt 2)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p14-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

#### run-p15

- files (removed 2026-10-31): p15-runA.webp p15-runB.webp
- source: `room-art/run/run-p15.png` (not shipped; attempt 1)
- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (its log names the model gpt-6.1-sol)
- date: 2026-10-31
- made by: Vikram's agent (Claude Code)
- approved by: Vikram, 2026-10-31 (asked for it in the terminal: "yes make a real running pose"; its likeness check is recorded below)
- reference: `p15-letter.webp` (the same person's shipped standing picture, as a PNG with a transparent margin), for the face, hair, clothes, camera, light and scale
- prompt: Create a character sheet: TWO running poses side by side in one single row, on a fully TRANSPARENT background (PNG with alpha channel, no backdrop, no floor, no shadow). A clear empty gap between the two poses; both drawn at exactly the same scale, full body from the top of the head to the shoes, both shoes fully visible and nothing cut off, the lowest shoe of each pose on the same baseline. The SAME person as in the attached image (same face, hair, clothes and shoes), now jogging in place, body turned slightly toward the viewer (front three-quarter view), elbows bent at about 90 degrees, arms swinging, relaxed and friendly. The two poses MUST be mirror strides, not the same pose twice. Pose 1 (left in the image), stride A: the leg on the VIEWER'S RIGHT side of the picture is lifted with the knee forward, the leg on the viewer's left stands flat on the ground; the opposite arm forward. Pose 2 (right in the image), stride B: the leg on the VIEWER'S LEFT side of the picture is lifted with the knee forward, the leg on the viewer's right stands flat on the ground; the opposite arm forward. No treadmill, no machine, no floor, no props. The person is fictional and resembles no real or famous person. Photoreal 3D render with the same camera, light and scale as the attached image: front-facing camera about 20 degrees down, mild perspective, soft warm daylight, clean, calm, realistic, office-safe, no text, no logos, transparent background.
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named. (the prompt itself carries the clause)
- likeness-check: Vikram, 2026-10-31 12:44 UTC (running-sheet contact sheet of p01–p15 reviewed; none resembles a real or famous person)
- cut: two frames split at the widest empty gap, each centred on its torso on one shared canvas with the feet aligned, resized to at most 640 px tall, re-encoded WebP quality 0.80 method 6 with alpha, no metadata; `people.json` sizes are in the stand sheet's units, a runner 0.97 of the person's upright `letter` height (bent knees, an estimate)
- licence: MIT

## Removed

- p01..p15 `-coffee.webp`, and the `-box`, `-touch`, `-tool`, `-wait` pictures of p02, p05, p06, p12: removed 2026-10-31, reported by Vikram (owner: the lobby people must face their fixture), replaced by `p01-counter.webp` and the facing frames of the same person.
- the old front-facing `-book`, `-knock`, `-letter`, `-runA`, `-runB` pictures of all 15 people: removed 2026-10-31, reported by Vikram (same reason), replaced by `p01-book.webp` and the facing frames of the same names.
