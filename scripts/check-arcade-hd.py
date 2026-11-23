#!/usr/bin/env python3
"""Spec 102 FR-393, FR-394, FR-403 (issue #2055): measures the HD person frames for test-realoffice-assets.ts (plain Node cannot decode WebP; Pillow only,
the pattern of frame-hashes.py; CI's art step runs it with Pillow required).
    python3 -I scripts/check-arcade-hd.py a.webp b.webp ...  ->  one JSON line per file: name, w, h, opaque, colours (opaque RGB), alphas (the
        alpha levels used), orphans (opaque pixels with no 4-neighbour of the same RGBA), lone (opaque pixels with no opaque 4-neighbour),
        edge (the distinct colours of the opaque pixels that touch a clear 4-neighbour or the frame's edge: the outline), head ([crown to neck / height, head width]);
        then a last line {"palette": <distinct opaque RGB over all files>, "rgba": <distinct RGBA of the non-opaque, non-clear pixels>}
    python3 -I scripts/check-arcade-hd.py --speckle|--alpha|--colour|--edge in.webp out.webp  ->  a planted copy (the test's red cases): every 7th opaque pixel
        nudged to a new colour; one inner pixel half transparent; a hundred inner pixels each a colour of their own; one outline pixel an inner colour"""
import json, os, re, sys
from PIL import Image


AV_BGS = ((30, 26, 54), (38, 32, 68))   # FR-407: every avatar circle of the arcade: --surface-2 of the retro theme (door, inbox header) and the rail's #262044; a dark figure is weakest on the lighter one


def rel_lum(c):
    v = [x / 255 for x in c[:3]]
    v = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in v]
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]


def lstar(c):
    y = rel_lum(c)
    return 116 * y ** (1 / 3) - 16 if y > 216 / 24389 else y * 24389 / 27


def ratio(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def median(v):
    v = sorted(v)
    return v[len(v) // 2] if v else 0


def legibility(px, opaque, w, h):
    """[the silhouette's edge contrast on the circle (the better median of the outline ring and the ring inside it), the features' L* step below the skin (None: no feature found)]"""
    def nbs(i):
        y, x = divmod(i, w)
        return [j for j, ok in ((i - w, y > 0), (i + w, y < h - 1), (i - 1, x > 0), (i + 1, x < w - 1)) if ok]
    ring = {i for i in range(len(px)) if opaque[i] and any(not opaque[j] for j in nbs(i))}
    inner = {j for i in ring for j in nbs(i) if opaque[j] and j not in ring}
    edge = min(max(median([ratio(px[i], bg) for i in ring]), median([ratio(px[i], bg) for i in inner])) for bg in AV_BGS)
    region = [i for i in range(len(px)) if opaque[i] and i not in ring and int(0.3 * h) <= i // w < int(0.75 * h) and int(0.25 * w) <= i % w < int(0.75 * w)]
    if not region:
        return [round(edge, 2), None]
    cnt = {}
    for i in region:   # the skin: the most common warm colour of the face area (hair, a hat or a beard may be more common)
        p = px[i]
        if p[0] > p[1] > p[2] and p[0] - p[2] > 30 and lstar(p) > 20:
            cnt[p] = cnt.get(p, 0) + 1
    if not cnt:
        return [round(edge, 2), None]
    skin = max(cnt, key=cnt.get); ls = lstar(skin)
    feat = [lstar(px[i]) for i in features(region, px, w, ls)]
    return [round(edge, 2), round(ls - median(feat), 1) if feat else None]


def features(region, px, w, ls):
    """the eyes, brows and mouth: small 4-connected clusters of the face area darker than the skin (hair and shading are large clusters)"""
    dark = {i for i in region if lstar(px[i]) < ls - 8}
    seen, out = set(), []
    for i in dark:
        if i in seen:
            continue
        comp, stack = [], [i]; seen.add(i)
        while stack:
            j = stack.pop(); comp.append(j)
            for k in (j - w, j + w, j - 1, j + 1):
                if k in dark and k not in seen and abs(k % w - j % w) <= 1:
                    seen.add(k); stack.append(k)
        if len(comp) <= max(2, 0.06 * len(region)):
            out += comp
    return out


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
    tile = None
    topc = None
    if path.endswith('-face-book@4.webp'):   # FR-408: the colours that cover at least 1 % of the front reading frame
        cnt = {}
        for i, p in enumerate(px):
            if opaque[i]:
                cnt[p[:3]] = cnt.get(p[:3], 0) + 1
        n = sum(cnt.values())
        topc = [list(c) + [round(k / n, 3)] for c, k in sorted(cnt.items(), key=lambda t: -t[1]) if k / n >= 0.01]
    if re.search(r'-t\d+\.webp$', path):   # FR-407: an avatar tile on the darkest avatar circle
        tile = legibility(px, opaque, w, h)
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
    if neck - top < 0.2 * fh:   # long hair over the shoulders hides the neck (p07): the chin is where the first run of face skin under the crown ends
        half = max(1, fh // 14)
        rows_ = [y for y in range(top, top + int(0.4 * fh)) if sum(1 for x in range(max(0, xc - half), min(w, xc + half + 1)) if opaque[y * w + x] and px[y * w + x][0] > px[y * w + x][1] > px[y * w + x][2] and px[y * w + x][0] - px[y * w + x][2] > 30 and px[y * w + x][0] > 90) >= 2]
        if rows_ and rows_[0] - top < 0.3 * fh:
            end = rows_[0]
            for y in rows_[1:]:
                if y - end > 2:
                    break
                end = y
            neck = max(neck, end + 1)
    head = [round((neck - top) / fh, 3), max(run(y) for y in range(top, neck))]
    return {'name': os.path.basename(path), 'w': w, 'h': h, 'opaque': sum(opaque), 'colours': len(rgb), 'alphas': sorted(alphas), 'orphans': orph, 'lone': lone, 'edge': len(edge), 'head': head, 'tile': tile, 'top': topc}, rgb, semi


if sys.argv[1:2] in (['--speckle'], ['--alpha'], ['--colour'], ['--edge'], ['--norim'], ['--hue']):
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
    elif sys.argv[1] == '--colour':   # a hundred inner pixels each a colour of their own: more than the shared palette holds
        for n, i in enumerate(inner[::max(1, len(inner) // 100)][:100]):
            px[i] = (1 + n, 254 - n, 127, 255)
    elif sys.argv[1] == '--hue':   # every colour's channels turned round: the person's own colours are gone
        px = [(p[1], p[2], p[0], p[3]) if p[3] else p for p in px]
    elif sys.argv[1] == '--norim':   # the lit edge of a tile taken off: its outline ring becomes the darkest colour of the tile
        ring = [i for i, p in enumerate(px) if p[3] and (i % w in (0, w - 1) or i < w or i >= len(px) - w or not all(px[j][3] for j in (i - 1, i + 1, i - w, i + w)))]
        dark = min((p for p in px if p[3]), key=lambda p: p[0] + p[1] + p[2])
        for i in ring:
            px[i] = dark
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
