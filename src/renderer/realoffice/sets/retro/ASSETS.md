# Real office set: Retro pixel people (provenance, spec 097 FR-062..FR-069, spec 102 FR-205, FR-391..FR-410, T472, T502)

Fifteen invented pixel-art people. Since the flip (spec 102 T472, 2026-11-24) every picture of the set is in `hd/`, described person by person in the HD set below; `set.json` carries only the `hd` block (frames, busts, tiles, and since T502 the standing numbers in `hd.stand`).

- **Licence:** MIT, like the code and the crew art.
- **Fictional people (FR-067, spec 102 FR-209):** each person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.

## Removed

- p01..p15 `-typeA`, `-typeB`, `-waveA`, `-waveB`, `-think`, `-rest`, `-type`, `-book`, `-knock`, `-letter`, `-counter`, `-runA`, `-runB`, `-face-book`, `-face-coffee`, `-face-knock`, `-face-letter`, `-face-runA`, `-face-runB`, `-sit` `.webp` (the first Retro pixel set, 300 pictures, 0.33 MB, drawn 2026-10-31 to 2026-11-13 from Codex image sheets, shrunk to the grid by the people part of `scripts/build-arcade-pack.py`, removed with it), with their `set.json` keys `seat`, `stand` and `faceBox`: removed 2026-11-24 (spec 102 T502), reported by Vikram (owner, 2026-11-23 20:11 UTC: "the old arcade pictures are removed"), replaced by `hd/p01-type@4.webp` and the rest of the HD set below. Their provenance is in this file's history (git log) before this change.

## HD set (spec 102 FR-391..FR-410, issue #2055): drawn everywhere since the flip (T472)

Owner decisions (Vikram, Telegram, 2026-11-23): style B at 13:07 UTC; bigger heads and crisp pixels at 14:27 UTC; "FINE" at 14:59 UTC. Seated busts ship as avatar tiles only (FR-405, coordinator 2026-11-23). Files in `hd/`: `<pid>-<pose>@<s>.webp` (the 14 standing and stool frames, `s` 4, 3, 2, 1: 288, 216, 144 px, and 72 px for the lobby) and `<pid>-<pose>-t<size>.webp` (avatar tiles of `typeA`, `think`, `waveA`, `rest` at 22, 24, 26, 32, 44, 48, 52, 64 px; `-t<size>l.webp`: the light-surface variant without the lit edge, for the people who carry it), and `<pid>-<pose>@4.webp` for the six seated busts (`typeA`, `typeB`, `think`, `waveA`, `waveB`, `rest`, 320 px tall, one canvas a person: the rows worlds and Flat's heads). Drawn everywhere since the flip (spec 102 T472). One pipeline for every picture: `build5.py` (art cache, SHA-256 `f37ceef24eaf6dc8bf26659e6c73fb853a36369d2fe5078fc13de6e345cabb87`): chroma key, connected parts, the head enlarged on the source to about 0.29 of the figure (FR-402; `k` at least 1), one 48-colour palette for every person, every size snapped natively (FR-391), orphan cleanup, one outline colour, a 1-px cyan rim, alpha 0 or 255; every picture is then checked against the repo's secret mask (`maskcheck.js`) and re-encoded losslessly until it passes (#2062). Sheets by `gen2.py`, `gen3.py` and `gen5.py` (art cache, SHA-256 `8b7ae6cb5e71b4abe7eb9b749121b7d07267158db5b66f05e118c7f8d623ae06` for the last), one `codex exec` at a time.

#### hd-p08

- files: the 14 standing and stool frames of p08 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: five Codex sheets: `V1b-p08`, `p08-B2`, `p08-F2` (standing and the stool), `p08-S1`, `p08-S2` (seated: the avatar tiles)
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b); the pilot look approved 2026-11-23 14:59 UTC ("FINE")
- reference: the owner's approved style-B sample figure at 3x (clothes); the person's own `V1b` sheet (style and big head)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a young man: grey knit beanie, short brown hair, light-tan skin, small thin round glasses, a short neat stubble beard, olive-green canvas jacket, dark t-shirt, dark brown trousers, black boots; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p12

- files: the 14 standing and stool frames of p12 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: five Codex sheets: `V1b-p12`, `p12-B2`, `p12-F2` (standing and the stool), `p12-S1`, `p12-S2` (seated: the avatar tiles)
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b); the pilot look approved 2026-11-23 14:59 UTC ("FINE")
- reference: the owner's approved style-B sample figure at 3x (clothes); the person's own `V1b` sheet (style and big head)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a jolly bald man: big round ginger-red beard, forest-green apron with two front pockets over a cream shirt with rolled sleeves, brown trousers, brown boots; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p04

- files: the 14 standing and stool frames of p04 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: five Codex sheets: `V1b-p04`, `p04-B2`, `p04-F2` (standing and the stool), `p04-S1`, `p04-S2` (seated: the avatar tiles)
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b); the pilot look approved 2026-11-23 14:59 UTC ("FINE")
- reference: the owner's approved style-B sample figure at 3x (clothes); the person's own `V1b` sheet (style and big head)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a young woman: red bob with a fringe, clear blue eyes, white blouse, royal-blue knee-length pleated skirt, dark tights, red shoes; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p01

- files: the 14 standing and stool frames of p01 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p01-B2` (seven from behind), `p01-F2` (six front poses and the stool), `p01-S1` and `p01-S2` (seated: the avatar tiles); a first `p01-B` and `p01-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a friendly coder: messy brown hair, round glasses, orange hoodie, blue jeans, brown sneakers, light skin, a small smug grin; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p02

- files: the 14 standing and stool frames of p02 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p02-B2` (seven from behind), `p02-F2` (six front poses and the stool), `p02-S1` and `p02-S2` (seated: the avatar tiles); a first `p02-B` and `p02-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a cheerful gardener: a soft cream bucket hat with a small green leaf pin, freckles, a mustard-yellow shirt with sleeves rolled up, teal dungarees with a tiny green sprout badge on the chest, brown boots, tan skin, a wide grin; NOT a straw hat and no red band (ignore the hat in the placeholder drawings); about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p03

- files: the 14 standing and stool frames of p03 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p03-B2` (seven from behind), `p03-F2` (six front poses and the stool), `p03-S1` and `p03-S2` (seated: the avatar tiles); a first `p03-B` and `p03-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a cool music fan: a big round black afro, purple sweater, gold headphones resting around the neck, dark grey trousers, dark shoes, dark brown skin, a relaxed smile; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p05

- files: the 14 standing and stool frames of p05 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p05-B2` (seven from behind), `p05-F2` (six front poses and the stool), `p05-S1` and `p05-S2` (seated: the avatar tiles); a first `p05-B` and `p05-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a skater-cool intern: a tall spiky blue quiff, small sunglasses pushed up on the forehead, red jacket over a white tee, dark trousers, white sneakers, brown skin, a cheeky smirk; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p06

- files: the 14 standing and stool frames of p06 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p06-B2` (seven from behind), `p06-F2` (six front poses and the stool), `p06-S1` and `p06-S2` (seated: the avatar tiles); a first `p06-B` and `p06-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a calm planner: black hair in a bun held by two little pins, mint cardigan, plum trousers, brown shoes, light skin, round cheeks, a gentle smile; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p07

- files: the 14 standing and stool frames of p07 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p07-B2` (seven from behind), `p07-F2` (six front poses and the stool), `p07-S1` and `p07-S2` (seated: the avatar tiles); a first `p07-B` and `p07-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a sunny accountant: long wavy blonde hair with a small flower hairclip, pink shirt, blue jeans, brown shoes, light skin, a bright smile; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p09

- files: the 14 standing and stool frames of p09 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p09-B2` (seven from behind), `p09-F2` (six front poses and the stool), `p09-S1` and `p09-S2` (seated: the avatar tiles); a first `p09-B` and `p09-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a night-shift engineer in a big rounded yellow rain jacket with the hood up (from behind the hood is one big smooth rounded shape), navy trousers, black boots with yellow soles, warm medium-brown skin, light freckles, a gentle grin; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p10

- files: the 14 standing and stool frames of p10 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p10-B2` (seven from behind), `p10-F2` (six front poses and the stool), `p10-S1` and `p10-S2` (seated: the avatar tiles); a first `p10-B` and `p10-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a playful tester: two tall high pigtails tied with round red hair ties, an oversized teal cardigan hanging below the hips over a cream shirt, grey shorts over striped tights, plain white sneakers, light skin with rosy cheeks, a bright gap-toothed smile; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p11

- files: the 14 standing and stool frames of p11 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p11-B2` (seven from behind), `p11-F2` (six front poses and the stool), `p11-S1` and `p11-S2` (seated: the avatar tiles); a first `p11-B` and `p11-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a calm lead architect: very long thick black hair in ONE long braid hanging down the back over one shoulder, a long mustard scarf, a long loose camel coat down to the knees, plum trousers, tan boots, olive skin, a quiet smile; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p13

- files: the 14 standing and stool frames of p13 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p13-B2` (seven from behind), `p13-F2` (six front poses and the stool), `p13-S1` and `p13-S2` (seated: the avatar tiles); a first `p13-B` and `p13-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a sleek analyst: a tall rounded top-knot of silver-grey hair, thin rectangular glasses, a long loose teal tunic over white trousers, white sneakers, deep brown skin, a calm knowing smile; a tall, slim body shape; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p14

- files: the 14 standing and stool frames of p14 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles with their 32 light-surface variants (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p14-B2` (seven from behind), `p14-F2` (six front poses and the stool), `p14-S1` and `p14-S2` (seated: the avatar tiles); a first `p14-B` and `p14-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a cheerful courier: an orange cap worn backwards with a ponytail pulled through the back, a big slouchy messenger bag on a strap across the chest, a light blue shirt with rolled sleeves, khaki cargo shorts, tall striped socks, green sneakers, medium-tan skin, a wide grin; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)

#### hd-p15

- files: the 14 standing and stool frames of p15 at scales 4, 3, 2 and 1, the six seated busts at 320 px, and 32 avatar tiles (named in `set.json` `hd.people.{pid}`, `hd.busts.{pid}` and `hd.tiles`)
- source: four Codex sheets: `p15-B2` (seven from behind), `p15-F2` (six front poses and the stool), `p15-S1` and `p15-S2` (seated: the avatar tiles); a first `p15-B` and `p15-F` came out in the old chibi proportions and are not used
- tool: Codex image generation (`codex exec`, codex-cli 0.163.0, on the owner's ChatGPT plan), then `build5.py`
- date: 2026-11-23
- made by: Vikram's agent (Claude Code)
- approved by: pending (Vikram): the finished set, spec 102 FR-400 (b)
- reference: the final pilot's p04 frames at 2x (style and proportions only, a different person) and the person's own old frames (`face-book`, `book`, `typeA`) at 6x on chroma green (who the person is)
- prompt: prompt class "crisp HD sprite sheet, big head" (each sheet's full text is `prompt.txt` beside it in the art cache): the poses of the sheet, then the character line: a quiet poet: a short messy silver-lilac pixie haircut, dark round glasses, a huge round cream knit poncho with a wide cowl neck that hides the arms and hangs like a bell, plain grey trousers, brown ankle boots, light skin with freckles, a dreamy smile; about 3 heads tall; crisp pixel art, 2 or 3 shade steps per material, a dark 1-px outline, about 48 colours, no anti-aliasing, gradients, dithering or glow, on flat #00FF00; fictional, no real or famous person, no brand or franchise character, no text or logos
- cut: connected parts of the keyed sheet; every shown size and every tile snapped on its own; no picture is scaled by the browser
- licence: MIT
- fictional: This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.
- likeness-check: pending (Vikram)
