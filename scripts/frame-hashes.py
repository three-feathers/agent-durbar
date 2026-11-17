#!/usr/bin/env python3
"""Pixel hashes of WebP frames (spec 102 FR-326, used by test-realoffice-assets.ts; plain Node cannot decode WebP).
    python3 -I scripts/frame-hashes.py a.webp b.webp  ->  one line per file: <name> <hash> <hash of the horizontal mirror>
    python3 -I scripts/frame-hashes.py --mirror in.webp out.webp  ->  writes the horizontal mirror, lossless (the test's planted mirror)
The hash is SHA-256 of the width, the height and the RGBA bytes with the colour of a fully transparent pixel zeroed (a hidden colour is not a
different picture). A mirrored copy therefore has the mirror hash of its source as its own hash."""
import hashlib, os, struct, sys
from PIL import Image, ImageOps

def digest(im):
    w, h = im.size
    raw = bytearray(im.tobytes())
    for i in range(0, len(raw), 4):
        if raw[i + 3] == 0: raw[i] = raw[i + 1] = raw[i + 2] = 0
    return hashlib.sha256(struct.pack('>II', w, h) + bytes(raw)).hexdigest()

if sys.argv[1:2] == ['--mirror']:
    ImageOps.mirror(Image.open(sys.argv[2]).convert('RGBA')).save(sys.argv[3], 'WEBP', lossless=True, exact=True)
    sys.exit(0)

for f in sys.argv[1:]:
    im = Image.open(f).convert('RGBA')
    print(os.path.basename(f), digest(im), digest(ImageOps.mirror(im)))
