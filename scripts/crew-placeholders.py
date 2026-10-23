#!/usr/bin/env python3
"""Generates the PLACEHOLDER crew pictures in src/renderer/crew/ (spec 077). Developer tool, not part of the build or of npm test:
the WebP files are committed. Flat busts drawn with Pillow, no AI, no external image; they stand in until the owners' real pictures
(ChatGPT, edited by a person, see ASSETS.md) replace them with the same file names, sizes and poses.

  python3 scripts/crew-placeholders.py

Each picture is 176x200 (the picture box on the 200x124 stage is 44x50 units, so 4 pixels per unit) with a transparent background
and no metadata. Poses: working (eyes on the screen), waiting (eyebrows up, a small open mouth), resting (eyes closed, a smile)."""
import os
from PIL import Image, ImageDraw

W, H, S = 176, 200, 4          # final size and supersampling
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'renderer', 'crew')
INK = (58, 51, 49, 255)

CAST = {
    'punk':      dict(skin=(241, 199, 163), shirt=(34, 37, 42), hair=(60, 207, 110)),
    'scientist': dict(skin=(232, 180, 143), shirt=(247, 247, 244), hair=(242, 242, 242)),
    'gamer':     dict(skin=(201, 139, 98), shirt=(123, 92, 214), hair=(44, 36, 32)),
    'hacker':    dict(skin=(176, 122, 88), shirt=(58, 66, 80), hair=(43, 49, 60)),
}
POSES = ('working', 'waiting', 'resting')
CX, CY, R = 88, 64, 52           # the head, in final pixels (stage 74,52 radius 13)

def rgba(c, a=255):
    return (c[0], c[1], c[2], a)

def draw(char, pose):
    c = CAST[char]
    im = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    def E(box, fill, outline=None, width=0):
        d.ellipse([v * S for v in box], fill=fill, outline=outline, width=width * S)
    def Rr(box, fill, r=0):
        d.rounded_rectangle([v * S for v in box], radius=r * S, fill=fill)
    def P(pts, fill):
        d.polygon([(x * S, y * S) for x, y in pts], fill=fill)
    def L(pts, fill, width):
        d.line([(x * S, y * S) for x, y in pts], fill=fill, width=int(width * S), joint='curve')
    skin, shirt, hair = rgba(c['skin']), rgba(c['shirt']), rgba(c['hair'])
    shade = tuple(max(0, v - 28) for v in c['skin']) + (255,)
    # shoulders and neck
    E((4, 128, 172, 260), shirt)
    Rr((72, 100, 104, 140), shade, 8)
    if char == 'punk':
        P([(84, 130), (88, 190), (92, 130)], (200, 56, 47, 255))
        for x, y in ((30, 160), (40, 178), (146, 160), (136, 178)):
            E((x - 5, y - 5, x + 5, y + 5), (201, 204, 209, 255))
    if char == 'scientist':
        L([(70, 132), (88, 160), (106, 132)], (207, 210, 204, 255), 4)
        Rr((120, 150, 138, 168), (156, 195, 230, 255), 3)
    if char == 'gamer':
        L([(70, 136), (88, 152), (106, 136)], (95, 69, 176, 255), 5)
        L([(80, 150), (79, 176)], (255, 255, 255, 255), 3); L([(98, 150), (99, 176)], (255, 255, 255, 255), 3)
    if char == 'hacker':
        E((14, 128, 162, 250), shirt)
        L([(78, 136), (74, 170)], (207, 213, 222, 255), 3); L([(98, 136), (102, 170)], (207, 213, 222, 255), 3)
    # back-of-head parts
    if char == 'hacker':
        E((CX - R - 14, CY - R - 12, CX + R + 14, CY + R + 20), shirt)
    # head
    E((CX - R, CY - R, CX + R, CY + R), skin)
    # hair, headwear
    if char == 'punk':
        P([(62, 30), (68, -4), (76, 26), (82, -14), (90, 26), (98, -4), (106, 30)], hair)
    if char == 'scientist':
        for x, y, r in ((44, 38, 22), (132, 38, 22), (60, 14, 22), (116, 14, 22), (88, 6, 20)):
            E((x - r, y - r, x + r, y + r), hair, (214, 214, 214, 255), 2)
    if char == 'gamer':
        P([(40, 62), (46, 26), (130, 26), (136, 62), (124, 44), (88, 36), (52, 44)], hair)
        pink = (240, 143, 184, 255)
        L([(34, 70), (36, 30), (88, 12), (140, 30), (142, 70)], pink, 12)
        P([(46, 34), (42, 2), (72, 22)], pink); P([(130, 34), (134, 2), (104, 22)], pink)
        Rr((22, 68, 46, 112), pink, 10); Rr((130, 68, 154, 112), pink, 10)
    if char == 'hacker':
        P([(CX - R + 2, CY - 8), (CX - 30, CY - R + 4), (CX + 30, CY - R + 4), (CX + R - 2, CY - 8), (CX + 34, CY - 20), (CX - 34, CY - 20)], shirt)
        Rr((CX - 40, CY - 30, CX + 40, CY - 14), hair, 8)
    # face
    ex = (70, 106); ey = CY + 4
    if pose == 'resting':
        for x in ex:
            d.arc([(x - 8) * S, (ey - 6) * S, (x + 8) * S, (ey + 6) * S], 20, 160, fill=INK, width=4 * S)
    else:
        for x in ex:
            E((x - 5, ey - 6, x + 5, ey + 6), INK)
            E((x - 2, ey - 4, x + 1, ey - 1), (255, 255, 255, 255))
    if pose == 'waiting':
        for x in ex:
            L([(x - 9, ey - 17), (x + 9, ey - 21)] if x < 88 else [(x - 9, ey - 21), (x + 9, ey - 17)], INK, 3)
        E((82, CY + 28, 94, CY + 42), (122, 75, 58, 255))
    elif pose == 'resting':
        d.arc([74 * S, (CY + 16) * S, 102 * S, (CY + 38) * S], 20, 160, fill=(122, 75, 58, 255), width=4 * S)
    else:
        d.arc([76 * S, (CY + 14) * S, 100 * S, (CY + 32) * S], 20, 160, fill=(122, 75, 58, 255), width=4 * S)
    E((50, CY + 12, 62, CY + 24), (255, 150, 150, 70)); E((114, CY + 12, 126, CY + 24), (255, 150, 150, 70))
    # eyewear
    if char == 'scientist':
        for x in ex:
            Rr((x - 14, ey - 12, x + 14, ey + 12), (191, 227, 255, 90), 8)
            d.rounded_rectangle([(x - 14) * S, (ey - 12) * S, (x + 14) * S, (ey + 12) * S], radius=8 * S, outline=(91, 107, 117, 255), width=3 * S)
        L([(84, ey), (92, ey)], (91, 107, 117, 255), 3)
    im = im.resize((W, H), Image.LANCZOS)
    return im

os.makedirs(OUT, exist_ok=True)
for char in CAST:
    for pose in POSES:
        im = draw(char, pose)
        im.save(os.path.join(OUT, f'{char}-{pose}.webp'), 'WEBP', quality=82, method=6, exif=b'', icc_profile=None)
        print('wrote', f'{char}-{pose}.webp')
