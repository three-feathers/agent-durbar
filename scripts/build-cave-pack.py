#!/usr/bin/env python3 -I
"""Builds the Prehistoric cave world pack and the Prehistoric set from the approved art (spec 097 phase 4, spec 102 FR-205).

  python3 -I scripts/build-cave-pack.py <cave-art-dir> <interop-dir> [<repo>]

  <cave-art-dir>  the approved cave room art (art/desk.webp, floor.jpg, wall.jpg, fx-*.png, slate.webp) with its ASSETS-cave.md beside art/
  <interop-dir>   the approved full-pose frames (webp/prehistoric/<char>-<pose>.webp, frames.json, prompts/, ASSETS-interop.md)

Writes src/renderer/realoffice/worlds/cave/ and src/renderer/realoffice/sets/prehistoric/ (pictures, world.json / set.json, ASSETS.md).
The sources stay out of the repo (art cache); the numbers in the JSON are measured from the shipped pictures. Needs Pillow."""
import json, os, re, sys
from PIL import Image

CAVE = sys.argv[1].rstrip('/'); INTEROP = sys.argv[2].rstrip('/'); REPO = sys.argv[3] if len(sys.argv) > 3 else os.getcwd()
CAVE_ROOT = os.path.dirname(CAVE)
W = os.path.join(REPO, 'src/renderer/realoffice/worlds/cave'); S = os.path.join(REPO, 'src/renderer/realoffice/sets/prehistoric')
os.makedirs(W, exist_ok=True); os.makedirs(S, exist_ok=True)
for d in (W, S):
    for f in os.listdir(d):
        if f.endswith('.webp'): os.remove(os.path.join(d, f))

def save(im, path, q=80):
    im.save(path, 'WEBP', quality=q, method=6, exact=False)
    return os.path.getsize(path)

FL = 300  # the world's floor line: every fixture picture is FL tall, standing on it (097 FR-023)
FX = {'library': 'library', 'software': 'software', 'terminal': 'terminal', 'web': 'web', 'boss': 'boss', 'coffee': 'coffee', 'bank': 'bank', 'postbox': 'post', 'other': 'tools'}
BOSS_H = Image.open(f'{CAVE}/fx-boss.png').size[1]  # the door is the tallest fixture: its height is the band's
fixtures, ftop = {}, {}
for fid, src in FX.items():
    im = Image.open(f'{CAVE}/fx-{src}.png').convert('RGBA'); k = FL / BOSS_H
    w, h = max(1, round(im.width * k)), max(1, round(im.height * k)); im = im.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (w, FL), (0, 0, 0, 0))
    top = 0 if fid == 'web' else FL - h  # the hanging globe hangs from the top, the rest stand on the floor line
    canvas.alpha_composite(im, (0, top))
    q = 78
    while save(canvas, f'{W}/fx-{fid}.webp', q) > 110 * 1024 and q > 40: q -= 8
    fixtures[fid] = [w, FL]; ftop[fid] = top

desk = Image.open(f'{CAVE}/desk.webp').convert('RGBA').resize((720, 275), Image.LANCZOS)  # the engine draws every desk at one shape
q = 80
while save(desk, f'{W}/desk.webp', q) > 56 * 1024 and q > 40: q -= 6
Image.open(f'{CAVE}/floor.jpg').convert('RGB').resize((320, 320), Image.LANCZOS).save(f'{W}/floor.webp', 'WEBP', quality=62, method=6)
wall = Image.open(f'{CAVE}/wall.jpg').convert('RGB').resize((1086, 330), Image.LANCZOS)
q = 70
while save(wall, f'{W}/wall.webp', q) > 110 * 1024 and q > 30: q -= 8
mon = Image.open(f'{CAVE}/slate.webp').convert('RGBA').resize((280, 163), Image.LANCZOS)  # spec 102 FR-220: monitor.webp, at most 300 px tall and 30 KB
q = 80
while save(mon, f'{W}/monitor.webp', q) > 28 * 1024 and q > 30: q -= 6

world = {'formatVersion': 1, 'id': 'cave', 'name': 'Prehistoric cave', 'defaultSet': 'prehistoric', 'css': 'world.css', 'wall': 'wall.webp', 'monitor': 'monitor.webp',
         'desk': [720, 275], 'fixtureTop': ftop, 'fixtures': fixtures, 'floorLine': FL}
json.dump(world, open(f'{W}/world.json', 'w'), indent=1)

# ---- the set: Prehistoric, 6 people x the 12 Real office poses (097 FR-066, 102 FR-204) ----
frames = {(r['char'], r['pose'], r['group']): r for r in json.load(open(f'{INTEROP}/frames.json'))['frames'] if r['set'] == 'prehistoric'}
CHARS = sorted({c for c, _, _ in frames}); SEAT = ['typeA', 'typeB', 'waveA', 'waveB', 'think', 'rest']; STAND = ['book', 'coffee', 'knock', 'letter', 'runA', 'runB']
seat, stand, origins = {}, {}, {}
for c in CHARS:
    ims = {p: Image.open(f'{INTEROP}/webp/prehistoric/{c}-{p}.webp').convert('RGBA') for p in SEAT}
    cw, ch = max(i.width for i in ims.values()), max(i.height for i in ims.values())  # the seated poses share one canvas, cut at the desk (bottom)
    for p, im in ims.items():
        cv = Image.new('RGBA', (cw, ch), (0, 0, 0, 0)); cv.alpha_composite(im, ((cw - im.width) // 2, ch - im.height)); save(cv, f'{S}/{c}-{p}.webp', 82)
    a = ims['typeA']; top_a = ch - a.height + (a.getchannel('A').point(lambda v: 255 if v > 60 else 0).getbbox()[1])
    seat[c] = {'bodyH': ch - top_a, 'h': ch, 'hand': 0.88, 'headTop': top_a, 'w': cw}
    poses, feet, top, fig = {}, {}, {}, 0
    for p in STAND:
        im = Image.open(f'{INTEROP}/webp/prehistoric/{c}-{p}.webp').convert('RGBA'); save(im, f'{S}/{c}-{p}.webp', 82)
        bb = im.getchannel('A').point(lambda v: 255 if v > 127 else 0).getbbox()
        poses[p] = [im.width, im.height]; feet[p] = round((bb[3]) / im.height, 4); top[p] = round(bb[1] / im.height, 4); fig = max(fig, im.height)
    stand[c] = {'feet': feet, 'figH': fig, 'poses': poses, 'top': top}
    for g, p in [('seat', x) for x in SEAT] + [('front', x) for x in STAND]: origins[(c, p)] = frames[(c, p, g)]['origin']
sset = {'formatVersion': 1, 'id': 'prehistoric', 'name': 'Prehistoric', 'level': 'full', 'seat': seat, 'stand': stand}
json.dump(sset, open(f'{S}/set.json', 'w'), indent=1)

# ---- provenance (097 FR-063, FR-067, FR-068; spec 102 FR-209) ----
def prompts_of(c):
    out = []
    for k in 'FST':
        f = f'{INTEROP}/prompts/prehistoric-{c}-{k}.txt'
        if os.path.exists(f): out.append(f'[sheet {k}] ' + re.sub(r'\s+', ' ', open(f).read()).strip())
    return ' '.join(out)
CLAUSE = 'This person is fictional and must not resemble any real or famous person; no real person, celebrity, brand, logo or franchise is named.'
cave_md = open(f'{CAVE_ROOT}/ASSETS-cave.md').read()
def cave_prompt(name):
    m = re.search(r'## gen/%s/%s\.png.*?```text\n(.*?)\n```' % (name, name), cave_md, re.S)
    return re.sub(r'\s+', ' ', m.group(1)).strip() if m else ''
wm = ['# Real office world: Prehistoric cave (provenance, spec 097 FR-062..FR-069, spec 102 FR-205)', '',
 'Every picture in this folder, where it comes from, who made and approved it, the exact prompt, and how it was cut and re-encoded.',
 'Checked by `npm run test:realoffice-assets`. Only the `.webp` files, `world.json` (as `realoffice/worlds/cave/world.js`) and `world.css` ship; this file stays in the repository.', '',
 '- **Licence:** MIT, like the code.',
 "- **Tool:** Codex image generation (`codex exec`), codex-cli 0.163.0, on Vikram's ChatGPT plan with his OK, one run at a time, 2026-10-31. Reference for the style only: Paco's Prehistoric crew portrait of Big Beard (`src/renderer/crew/art/`).",
 "- **Made by:** Vikram's agent (Claude Code), 2026-10-31. **Approved by:** Paco, 2026-10-31 (all 11 images, relayed by his agent in the team chat, 11:41 UTC: \"Está bien\"); `[KNOWN GAP]` the owner's own approval of the cave world is the gate in the spec's *Changes* (2026-11-01) and is not yet given.",
 '- **Cut and re-encoded** by `scripts/build-cave-pack.py` (Pillow): the nine fixtures are the lobby sheet cropped with feathered edges, scaled by one factor (the door is the band\'s height) and set on a common floor line of 300; the desk is stretched to the engine\'s one desk shape; the floor tile and wall are resized; the monitor (`monitor.webp`) is the slate frame. WebP with alpha, no metadata.',
 '- **Not generated:** flames, glows, name plates, lamps, screen text and all words are CSS or the app\'s own.', '', '']
def sec(name, files, src, prompt, cut, extra=''):
    return f"### {name}\n\n- files: {files}\n- source: {src}\n- tool: Codex image generation (`codex exec`), codex-cli 0.163.0\n- date: 2026-10-31\n- made by: Vikram's agent (Claude Code)\n- approved by: Paco, 2026-10-31 (relayed by his agent)\n- reference: Paco's Big Beard portrait, style only\n- prompt: {prompt}\n- cut: {cut}\n- licence: MIT\n{extra}\n"
files_of = lambda pat: ' '.join(sorted(f for f in os.listdir(W) if re.match(pat, f)))
wm.append(sec('lobby', files_of(r'fx-.*\.webp'), 'gen/lobby/lobby.png (not shipped)', cave_prompt('lobby'), 'each fixture cropped with feathered edges, scaled to one factor, bottoms on one floor line (the hanging globe from the top)'))
wm.append(sec('wall', 'wall.webp', 'gen/wall/wall.png (not shipped)', cave_prompt('wall'), 'top 660 px, resized, WebP'))
wm.append(sec('desk', 'desk.webp', 'gen/desk/desk.png (not shipped)', cave_prompt('desk'), 'cropped to its alpha box, resized to the engine\'s desk shape'))
wm.append(sec('slate', 'monitor.webp', 'gen/slate/slate.png (not shipped)', cave_prompt('slate'), 'the frame, resized; CSS draws the screen text on the dark face'))
wm.append(sec('floor', 'floor.webp', 'gen/floor/floor.png (not shipped)', cave_prompt('floor'), 'resized to a 320 px tile, desaturated and darkened for calm (the cave art step), WebP'))
wm += ['## References (not shipped)', '', '- Paco\'s crew portraits, used for style only.', '', '## Removed', '', 'None.', '']
open(f'{W}/ASSETS.md', 'w').write('\n'.join(wm))

sm = ['# Real office set: Prehistoric (provenance, spec 097 FR-062..FR-069, spec 102 FR-205)', '',
 'Six invented cave people, each with the 12 Real office poses (six seated, six standing). Checked by `npm run test:realoffice-assets`. Only the `.webp` files and `set.json` (as `realoffice/sets/prehistoric/set.js`) ship; this file stays in the repository.', '',
 '- **Licence:** MIT, like the code and the crew art.',
 "- **Tool:** the poses marked `new` below: Codex image generation (`codex exec`), codex-cli 0.163.0, one sheet per call (prompts below), cleaned and scaled so each character's upright pose matches its existing approved picture; the poses marked `existing` are Paco's approved crew portraits and cave pose sheets, unchanged.",
 "- **Made by:** Vikram's agent (Claude Code), 2026-10-31 and 2026-11-01. **Approved by:** Paco, 2026-11-01 (every seated and standing frame, relayed by his agent; the rescaled inventor frames included).",
 "- **Cut and re-encoded** by `scripts/build-cave-pack.py` (Pillow): the six seated poses of a person are set on one canvas cut at the desk, every picture is WebP with alpha and no metadata, and `set.json` holds numbers measured from the shipped pictures.",
 '- **Fictional people (FR-067, spec 102 FR-209):** ' + CLAUSE, '',
 '', '']
for c in CHARS:
    org = ', '.join(f'{p} {o.split(":")[0]}' for (cc, p), o in sorted(origins.items()) if cc == c)
    sm.append(f"### set-{c}\n\n- files: {' '.join(sorted(f for f in os.listdir(S) if f.startswith(c + '-')))}\n- source: sheets `prehistoric-{c}-F`, `-S`, `-T` and the existing crew art (not shipped); per pose: {org}\n- tool: Codex image generation (`codex exec`), codex-cli 0.163.0 (new poses); Paco's approved art (existing poses)\n- date: 2026-11-01\n- made by: Vikram's agent (Claude Code)\n- approved by: Paco, 2026-11-01 (relayed by his agent)\n- reference: Paco's {c} portrait and full-body picture\n- fictional: {CLAUSE}\n- likeness-check: Paco, 2026-11-01 (relayed by his agent; invented cave people)\n- prompt: {prompts_of(c)}\n- cut: slices of the sheets, cleaned and scaled as above, seated poses on one canvas, WebP quality 82 with alpha, no metadata\n- licence: MIT\n")
sm += ['## Earlier versions, not in the pack', '', 'None.', '', '## Removed', '', 'None.', '']
open(f'{S}/ASSETS.md', 'w').write('\n'.join(sm))
print('world', sum(os.path.getsize(f'{W}/{f}') for f in os.listdir(W)) // 1024, 'KB; set', sum(os.path.getsize(f'{S}/{f}') for f in os.listdir(S)) // 1024, 'KB')
