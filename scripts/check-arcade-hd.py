#!/usr/bin/env python3
"""Spec 102 FR-393, FR-394 (issue #2055): measures the HD person frames for test-realoffice-assets.ts (plain Node cannot decode WebP; Pillow only).
    python3 -I scripts/check-arcade-hd.py a.webp b.webp ...  ->  one JSON line per file: name, w, h, opaque, colours (opaque RGB), alphas (the
        alpha levels used), orphans (opaque pixels with no 4-neighbour of the same RGBA), lone (opaque pixels with no opaque 4-neighbour);
        then a last line {"palette": <distinct opaque RGB over all files>, "rgba": <distinct RGBA of the non-opaque, non-clear pixels>}
    python3 -I scripts/check-arcade-hd.py --speckle in.webp out.webp  ->  a planted copy: every 7th opaque pixel nudged to a new colour (the test's red case)"""
import json, os, sys
from PIL import Image


def measure(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = list(im.getdata())
    opaque = [p[3] == 255 for p in px]
    rgb, alphas, orph, lone = set(), set(), 0, 0
    for i, p in enumerate(px):
        alphas.add(p[3])
        if not opaque[i]:
            continue
        rgb.add(p[:3])
        y, x = divmod(i, w)
        nb = [j for j, ok in ((i - w, y > 0), (i + w, y < h - 1), (i - 1, x > 0), (i + 1, x < w - 1)) if ok]
        if not any(opaque[j] for j in nb):
            lone += 1
        if not any(px[j] == p for j in nb):
            orph += 1
    semi = {p for p in px if 0 < p[3] < 255}
    return {'name': os.path.basename(path), 'w': w, 'h': h, 'opaque': sum(opaque), 'colours': len(rgb), 'alphas': sorted(alphas), 'orphans': orph, 'lone': lone}, rgb, semi


if sys.argv[1:2] == ['--speckle']:
    im = Image.open(sys.argv[2]).convert('RGBA')
    px = list(im.getdata())
    n = 0
    for i, p in enumerate(px):
        if p[3] == 255:
            n += 1
            if n % 7 == 0:
                px[i] = ((p[0] + 37) % 256, (p[1] + 91) % 256, (p[2] + 53) % 256, 255)
    im.putdata(px)
    im.save(sys.argv[3], 'WEBP', lossless=True, exact=True)
    sys.exit(0)

pal, semi = set(), set()
for f in sys.argv[1:]:
    row, rgb, s = measure(f)
    pal |= rgb
    semi |= s
    print(json.dumps(row))
print(json.dumps({'palette': len(pal), 'rgba': len(semi)}))
