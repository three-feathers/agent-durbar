#!/usr/bin/env python3
"""Rows with alpha > 128 in the first and the last column of each WebP given (spec 097 FR-371, used by test-realoffice-assets.ts).
    python3 -I scripts/kid-edge-rows.py a.webp b.webp   ->  one line per file: <name> <left rows> <right rows>
    python3 -I scripts/kid-edge-rows.py --red           ->  a built-in picture cut flat on its left edge (the test's red case)"""
import os, sys
from PIL import Image

def rows(im):
    a = im.convert('RGBA').getchannel('A'); w, h = a.size; p = a.load()
    return [sum(p[x, y] > 128 for y in range(h)) for x in (0, w - 1)]

if sys.argv[1:] == ['--red']:
    im = Image.new('RGBA', (60, 90), (0, 0, 0, 0))
    for y in range(90):
        for x in range(30): im.putpixel((x, y), (200, 0, 0, 255))
    print('red', *rows(im))
else:
    for f in sys.argv[1:]: print(os.path.basename(f), *rows(Image.open(f)))
