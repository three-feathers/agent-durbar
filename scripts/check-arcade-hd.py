#!/usr/bin/env python3
"""Spec 102 FR-393, FR-394, FR-403 (issue #2055): measures the HD person frames for test-realoffice-assets.ts (plain Node cannot decode WebP; Pillow only,
the pattern of frame-hashes.py; CI's art step runs it with Pillow required).
    python3 -I scripts/check-arcade-hd.py a.webp b.webp ...  ->  one JSON line per file: name, w, h, opaque, colours (opaque RGB), alphas (the
        alpha levels used), orphans (opaque pixels with no 4-neighbour of the same RGBA), lone (opaque pixels with no opaque 4-neighbour),
        edge (the distinct colours of the opaque pixels that touch a clear 4-neighbour or the frame's edge: the outline), head ([crown to neck / height, head width]);
        then a last line {"palette": <distinct opaque RGB over all files>, "rgba": <distinct RGBA of the non-opaque, non-clear pixels>}
    python3 -I scripts/check-arcade-hd.py --speckle|--alpha|--colour|--edge in.webp out.webp  ->  a planted copy (the test's red cases): every 7th opaque pixel
        nudged to a new colour; one inner pixel half transparent; one inner pixel a colour of its own; one outline pixel an inner colour"""
import json, os, sys
from PIL import Image


def measure(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = list(im.getdata())
    opaque = [p[3] > 0 for p in px]   # every drawn pixel; the alpha rule (FR-403) is read from `alphas`
    rgb, alphas, orph, lone, edge = set(), set(), 0, 0, set()
    for i, p in enumerate(px):
        alphas.add(p[3])
        if not opaque[i]:
            continue
        rgb.add(p[:3])
        y, x = divmod(i, w)
        nb = [j for j, ok in ((i - w, y > 0), (i + w, y < h - 1), (i - 1, x > 0), (i + 1, x < w - 1)) if ok]
        if not any(opaque[j] for j in nb):
            lone += 1
        if len(nb) < 4 or not all(opaque[j] for j in nb):
            edge.add(p[:3])
        if not any(px[j] == p for j in nb):
            orph += 1
    semi = {p for p in px if 0 < p[3] < 255}
    # FR-402: crown to neck over the figure's height, and the head's width: the neck is the narrowest run through the head's centre column between 14 % and 36 % of the height
    rows = [y for y in range(h) if any(opaque[y * w:(y + 1) * w])]
    top, fh = rows[0], rows[-1] - rows[0] + 1
    xs = [x for y in range(top, top + max(2, int(0.08 * fh))) for x in range(w) if opaque[y * w + x]]
    xc = (min(xs) + max(xs)) // 2

    def run(y):
        if not opaque[y * w + xc]:
            return 0
        l = r = xc
        while l > 0 and opaque[y * w + l - 1]:
            l -= 1
        while r < w - 1 and opaque[y * w + r + 1]:
            r += 1
        return r - l + 1
    lo = top + int(0.14 * fh)
    ws = [run(y) or 10 ** 6 for y in range(lo, top + int(0.36 * fh))]
    neck = lo + ws.index(min(ws))
    head = [round((neck - top) / fh, 3), max(run(y) for y in range(top, neck))]
    return {'name': os.path.basename(path), 'w': w, 'h': h, 'opaque': sum(opaque), 'colours': len(rgb), 'alphas': sorted(alphas), 'orphans': orph, 'lone': lone, 'edge': len(edge), 'head': head}, rgb, semi


if sys.argv[1:2] in (['--speckle'], ['--alpha'], ['--colour'], ['--edge']):
    im = Image.open(sys.argv[2]).convert('RGBA')
    px = list(im.getdata())
    w, h = im.size
    inner = [i for i in range(w, len(px) - w) if 0 < i % w < w - 1 and all(px[j][3] == 255 for j in (i, i - 1, i + 1, i - w, i + w))]
    if sys.argv[1] == '--speckle':
        n = 0
        for i, p in enumerate(px):
            if p[3] == 255:
                n += 1
                if n % 7 == 0:
                    px[i] = ((p[0] + 37) % 256, (p[1] + 91) % 256, (p[2] + 53) % 256, 255)
    elif sys.argv[1] == '--alpha':
        p = px[inner[len(inner) // 2]]; px[inner[len(inner) // 2]] = p[:3] + (128,)
    elif sys.argv[1] == '--colour':
        px[inner[len(inner) // 2]] = (1, 254, 127, 255)
    else:   # one outline pixel takes an inner colour of the frame: a second outline colour, no new colour
        edge = [i for i, p in enumerate(px) if p[3] and (i % w in (0, w - 1) or i < w or i >= len(px) - w or not all(px[j][3] for j in (i - 1, i + 1, i - w, i + w)))]
        px[edge[len(edge) // 2]] = px[inner[len(inner) // 2]]
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
