#!/usr/bin/env python3
"""Photo office helper kids (spec 097 FR-371, T328, issue #1641): cut-out PNGs -> WebP pictures + the `kids` block of world.json.

    python3 scripts/build-kid-pack.py <cut-dir> [--write]

<cut-dir> holds kid1..kid6/<state>.png, one transparent cut-out per state (working, thinking, waiting, error, limit, done, asleep),
made from Codex pose sheets by the cutting step recorded in the world's ASSETS.md (the sheets and cut-outs are not in the repo, so
this script only repeats the last, deterministic step: resize, WebP, measure). Writes src/renderer/realoffice/worlds/photo/kidN-<state>.webp
(Pillow, WebP quality 80, method 6, no EXIF, XMP or ICC chunk) and prints the `kids` JSON; with --write it also puts it in world.json.
One scale (SCALE) for every picture of every kid, so a pose is never stretched against another (FR-369: "shrink everything together").
All numbers in `kids` are in SHIPPED picture pixels. Without --write nothing is changed but the pictures."""
import json, os, sys
from PIL import Image

STATES = ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'asleep']
SCALE = 0.5            # cut-out (about 500 px tall) -> shipped (at most 264 px tall): a kid is drawn 73 to 117 px tall, so DPR 2 still has pixels to spare
REF = 'limit'          # the standing reference figure: bodyH, headTop and face are measured on it (arms low, whole figure upright)
# head (hair to chin) of each kid's REF cut-out, looked at on a contact sheet (x0, y0, x1, y1 in cut-out pixels); a person's `headTop` and
# `bodyH` in the sets' set.json play the same part (realoffice-layout.ts headCrop)
HEAD = {1: (45, 0, 235, 190), 2: (48, 4, 218, 128), 3: (10, 0, 236, 142), 4: (20, 4, 230, 122), 5: (14, 0, 214, 165), 6: (40, 2, 218, 112)}
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
WORLD = os.path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds', 'photo')

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1: sys.exit(__doc__)
    cut, kids = args[0], {}
    for k in range(1, 7):
        poses = {}
        for st in STATES:
            im = Image.open(os.path.join(cut, 'kid%d' % k, st + '.png')).convert('RGBA')
            im = im.resize((max(1, round(im.width * SCALE)), max(1, round(im.height * SCALE))), Image.LANCZOS)
            im.save(os.path.join(WORLD, 'kid%d-%s.webp' % (k, st)), 'WEBP', quality=80, method=6, exact=False)  # no exif/icc/xmp passed
            poses[st] = [im.width, im.height]
        x0, y0, x1, y1 = [round(v * SCALE) for v in HEAD[k]]
        w, h = poses[REF]
        kids['kid%d' % k] = {'bodyH': h, 'face': [x0, y0, x1 - x0, y1 - y0], 'h': h, 'headTop': y0, 'poses': poses, 'ref': REF, 'w': w,
                             'widest': max(STATES, key=lambda s: poses[s][0])}
    print(json.dumps(kids, indent=1, sort_keys=True))
    if '--write' in sys.argv:
        p = os.path.join(WORLD, 'world.json'); d = json.load(open(p)); d['kids'] = kids
        json.dump(d, open(p, 'w'), indent=1); open(p, 'a').write('\n')

main()
