#!/usr/bin/env python3 -I
"""Builds the Retro arcade world pack (spec 102 FR-250..FR-258, T206; the people set it once built was removed by T502).

  python3 -I scripts/build-arcade-pack.py --world [<repo>]              the world: wall, floor, cabinets, fixtures, into src/renderer/realoffice/worlds/retro
  python3 -I scripts/build-arcade-pack.py --selftest                    the checks that need no art (a frame off the grid is refused, same bytes twice, the welcome picture)

What it makes (dev only, not run in CI, output committed and checked by `npm run test:realoffice-assets`):
  wall and floor in a day and a night light (drawn here, a few flat colours, from the mockup's code), three cabinet strips (four bodies
  in four colours each; level glass, side panel, stepped top: spec 102 FR-258), nine fixtures, a glow strip, a console.
Every picture is lossless WebP; two runs give the same bytes. Needs Pillow."""
import hashlib, io, json, os, sys
from PIL import Image, ImageDraw

def save(im, path):
    """lossless WebP, no metadata, deterministic"""
    buf = io.BytesIO(); im.save(buf, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    data = buf.getvalue()
    if data[12:16] != b'VP8L': raise SystemExit(path + ': not a lossless picture')
    with open(path, 'wb') as f: f.write(data)
    return len(data)

# ---------------------------------------------------------------------------------------------------------------- canvas (the mockup's R())
class C:
    def __init__(self, w, h): self.im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); self.w = w; self.h = h
    @staticmethod
    def col(c): return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    def R(self, c, X, Y, w, h, a=1.0):
        X, Y = int(X), int(Y); x0, y0, x1, y1 = max(0, X), max(0, Y), min(self.w, X + int(w)), min(self.h, Y + int(h))
        if x1 <= x0 or y1 <= y0: return
        r, g, b = self.col(c)
        if a >= 1: ImageDraw.Draw(self.im).rectangle([x0, y0, x1 - 1, y1 - 1], fill=(r, g, b, 255))
        else:
            ov = Image.new('RGBA', (x1 - x0, y1 - y0), (r, g, b, round(255 * a))); reg = self.im.crop((x0, y0, x1, y1))
            self.im.paste(Image.alpha_composite(reg, ov), (x0, y0))
    def clear(self, X, Y, w, h): ImageDraw.Draw(self.im).rectangle([X, Y, X + w - 1, Y + h - 1], fill=(0, 0, 0, 0))
    def draw(self, other, X, Y): self.im.alpha_composite(other.im, (X, Y))

P = dict(k='#0b0b1a', navy='#1d2b53', plum='#7e2553', green='#008751', brown='#ab5236', dg='#5f574f', lg='#c2c3c7', cream='#fff1e8', red='#ff004d',
         orange='#ffa300', yellow='#ffec27', lime='#00e436', blue='#29adff', lav='#83769c', pink='#ff77a8', peach='#ffccaa')
BODY = ['#2a2142', '#1f2a52', '#34223a', '#22303d']; TRIM = ['#c2467f', '#2a8fc9', '#d98a12', '#1fae5a']

# ---------------------------------------------------------------------------------------------------------------- cabinet (level: FR-258)
BODIES = ['upright', 'cocktail', 'racer', 'pinball']   # spec 102 FR-306 (owner 2026-11-03: "make arcade look different"): one cell rectangle, four bodies

def marquee_trim(c, Fw, trim, m):
    """the frame around the marquee hole: a neon line, bulbs, a checker or three stripes (the hole itself stays for the app's name)"""
    R = c.R
    if m == 0: R(trim, 3, 2, Fw - 6, 1); R(trim, 3, 10, Fw - 6, 1)
    elif m == 1:
        for x in range(3, Fw - 3, 2): R(P['yellow'] if x % 4 == 3 else P['cream'], x, 1, 1, 1); R(P['yellow'] if x % 4 == 1 else P['cream'], x, 11, 1, 1)
    elif m == 2:
        for x in range(2, Fw - 2): R(trim if x % 2 else P['k'], x, 1, 1, 1); R(P['k'] if x % 2 else trim, x, 2, 1, 1); R(trim if x % 2 else P['k'], x, 10, 1, 1); R(P['k'] if x % 2 else trim, x, 11, 1, 1)
    else: R(P['pink'], 2, 1, Fw - 4, 1); R(P['blue'], 2, 2, Fw - 4, 1); R(P['blue'], 2, 10, Fw - 4, 1); R(P['yellow'], 2, 11, Fw - 4, 1)

def cab_front(Fw, Hf, gw, gh, body, trim, m=0):
    """the upright's front; the other bodies keep only its marquee and screen (above the panel) and draw their own lower part (cabinet())"""
    c = C(Fw, Hf); R = c.R
    R(P['k'], 0, 0, Fw, Hf); R(body, 1, 1, Fw - 2, Hf - 2); R(trim, 1, 1, 1, Hf - 2)
    R(P['k'], 2, 1, Fw - 4, 11); R('#3a3158', 2, 1, Fw - 4, 1); marquee_trim(c, Fw, trim, m); c.clear(4, 3, Fw - 8, 7)   # marquee: a hole the app's HTML fills
    by, bh = 13, gh + 10
    R('#3b3354', 2, by, Fw - 4, bh); R(P['lav'], 2, by, Fw - 4, 1); R(P['lav'], 2, by, 1, bh); R('#17142a', 2, by + bh - 1, Fw - 4, 1); R('#17142a', Fw - 3, by, 1, bh)
    c.clear(5, by + 5, gw, gh)                                                                      # glass: a hole, the same place in every body
    for a, b in ((5, by + 5), (5 + gw - 1, by + 5), (5, by + 5 + gh - 1), (5 + gw - 1, by + 5 + gh - 1)): R('#3b3354', a, b, 1, 1)
    yd, yl = by + bh, by + bh + 10
    R(P['k'], 0, yd, Fw, 10); R('#4a4068', 1, yd + 1, Fw - 2, 2); R('#2f2750', 1, yd + 3, Fw - 2, 6)
    R(P['k'], 3, by + bh - 3, 2, 1); R(P['dg'], round(Fw * .2), yd + 5, 1, 3); R(P['red'], round(Fw * .2) - 1, yd + 3, 3, 2)   # one stick, four buttons
    for f, col in ((.44, P['red']), (.54, P['yellow']), (.64, P['blue']), (.76, P['lime'])): R(P['k'], round(Fw * f), yd + 3, 4, 4); R(col, round(Fw * f) + 1, yd + 3, 2, 2)
    R('#1a1530', 2, yl, Fw - 4, Hf - yl - 1)
    cx0 = round(Fw / 2) - 8; R(P['k'], cx0, yl, 16, 4); R(P['yellow'], cx0 + 3, yl + 1, 2, 2); R(P['yellow'], cx0 + 11, yl + 1, 2, 2)
    R(P['k'], 1, Hf - 2, Fw - 2, 1)
    return c

def cab_side(Sd, Hf, trim, art=0):
    """the side panel's art: stripes, a zigzag, stars or chevrons in the trim colour"""
    c = C(Sd, Hf); R = c.R
    R(P['k'], 0, 0, Sd, Hf); R('#16122a', 1, 1, Sd - 2, Hf - 2)
    for y in range(18, Hf - 10, 6):
        if art == 0: R(trim, 2, y, 1, 2); R(trim, 3, y + 2, 1, 2); R(trim, 4, y + 4, 1, 2)
        elif art == 1:
            for i, x in enumerate((1, 2, 3, 4, 5, 4)): R(trim, x, y + i, 1, 1)
        elif art == 2:
            if (y // 6) % 2: R(trim, 3, y, 1, 3); R(trim, 2, y + 1, 3, 1)
            else: R(P['cream'], 2 if (y // 12) % 2 else 4, y + 1, 1, 1)
        else: R(trim, 2, y, 1, 1); R(trim, 3, y + 1, 1, 1); R(trim, 4, y + 2, 1, 1); R(trim, 3, y + 3, 1, 1); R(trim, 2, y + 4, 1, 1)
    R('#3a3158', 1, 1, Sd - 2, 1)
    return c

SIDE_TOP = [2, 3, 3, 4, 4, 5, 5]   # the upright's side panel: one step per column from the front

def cabinet(gw, gh, variant, kind=0):
    """one cabinet, the screen on the left and the side panel on the right (the app mirrors it, with a static transform, for the other side).
    Four silhouettes in one cell (spec 102 FR-306): an upright with its tall stepped side; a cocktail table (the screen on a wide low table
    with a glass edge and four legs, no side above it); a racer (a wide low body, a big wheel and a seat shell on the side); a pinball (a
    framed backbox, then a sloped playfield flaring out below it, on legs). The glass and the marquee stay in one place, nothing leaves the
    cell, so nothing reaches the person beside it or the plate."""
    Fw, Sd = gw + 10, 7; Hf = gh + 38; CW, CH = Fw + Sd, max(Hf + 3, 73)
    trim, body = TRIM[variant % 4], BODY[variant % 4]
    f = cab_front(Fw, Hf, gw, gh, body, trim, variant % 4)
    c = C(CW, CH); oy = CH - Hf - 3; R = c.R
    yd, yb = oy + gh + 23, oy + Hf                                                                         # the panel's top, the floor line
    R('#000000', 0, yb, CW, 2, .38)
    if kind == 0:
        c.draw(f, 0, oy)
        c.clear(0, oy, 3, 1); c.clear(Fw - 3, oy, 3, 1); c.clear(0, oy + 1, 1, 1); c.clear(Fw - 1, oy + 1, 1, 1)   # stepped crown
        s = cab_side(Sd, Hf, trim, variant % 4)                                                                    # side art: the upright's only
        for i, off in enumerate(SIDE_TOP): c.im.alpha_composite(s.im.crop((i, 0, i + 1, Hf)).resize((1, Hf - off), Image.NEAREST), (Fw + i, oy + off))
        R('#3a3158', Fw, oy + 2, Sd, 1)
    else:
        top = C(Fw, yd - oy); top.im.alpha_composite(f.im.crop((0, 0, Fw, yd - oy)), (0, 0)); c.draw(top, 0, oy)   # marquee and screen only
    def stick(x, y, col): R(P['dg'], x, y + 2, 1, 2); R(col, x - 1, y, 3, 2)
    if kind == 1:                                                                                          # cocktail table
        for i, n in enumerate((3, 2, 1)): c.clear(0, oy + i, n, 1); c.clear(Fw - n, oy + i, n, 1)
        t = yd                                                                                             # the table top, across the whole cell
        R(P['k'], 0, t, CW, 6); R(P['cream'], 1, t, CW - 2, 1); R(P['lav'], 1, t + 1, CW - 2, 1); R(trim, 1, t + 2, CW - 2, 1); R(body, 1, t + 3, CW - 2, 2)
        stick(4, t - 3, P['blue']); stick(CW - 5, t - 3, P['pink'])
        R(P['k'], 3, t + 6, CW - 6, 3); R('#2f2750', 4, t + 6, CW - 8, 2)                                  # the apron
        for x in (3, round(CW * .3), round(CW * .7) - 2, CW - 6):                                          # four legs, floor between them
            R(P['k'], x, t + 9, 3, yb - t - 9); R(trim, x + 1, t + 9, 1, yb - t - 10)
    if kind == 2:                                                                                          # racer
        for i, n in enumerate((4, 2, 1)): c.clear(0, oy + i, n, 1); c.clear(Fw - n, oy + i, n, 1)
        R(trim, 1, oy + 12, 1, yd - oy - 12); R(trim, Fw - 2, oy + 12, 1, yd - oy - 12)
        sx = Fw - 1                                                                                        # the seat shell on the side, rising above the body
        R(P['k'], sx, yd - 34, CW - sx, 35); R(trim, sx + 1, yd - 33, CW - sx - 2, 33); R('#0e0b1c', sx + 2, yd - 31, CW - sx - 4, 30); R(trim, sx + 2, yd - 14, CW - sx - 4, 1)
        c.clear(sx, yd - 34, 1, 1); c.clear(CW - 1, yd - 34, 1, 1)
        b = yd                                                                                             # a wide low body
        R(P['k'], 0, b, CW, yb - b); R(body, 1, b + 1, CW - 2, yb - b - 2); R(trim, 1, b + 1, CW - 2, 1); R(trim, 1, yb - 4, CW - 2, 1)
        R(P['k'], 1, yb - 2, CW - 2, 1)
        cx, cy, r = round(Fw / 2), b + 3, 5                                                                # a big wheel at the base of the screen
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                d = (dx * dx + dy * dy) ** .5
                if r - 1.2 <= d <= r + .3 and cy + dy > oy + 18 + gh: R(P['lg'] if dy < 0 else P['dg'], cx + dx, cy + dy, 1, 1)
        R(trim, cx - r + 1, cy, 2 * r - 1, 1); R(P['k'], cx, cy, 1, r)
        R(P['dg'], round(Fw * .84), b + 2, 1, 5); R(P['cream'], round(Fw * .84) - 1, b + 1, 3, 2)
    if kind == 3:                                                                                          # pinball
        c.clear(0, oy, 2, yd - oy); c.clear(Fw - 2, oy, 2, yd - oy)                                        # a backbox, framed in lights
        R(trim, 2, oy, Fw - 4, 1); R(trim, 2, oy, 1, yd - oy); R(trim, Fw - 3, oy, 1, yd - oy)
        for x in range(4, Fw - 4, 3): R(P['yellow'] if (x // 3) % 2 else P['red'], x, oy, 1, 1)
        for y in range(oy + 4, yd - 2, 4): R(P['yellow'], 2, y, 1, 1); R(P['yellow'], Fw - 3, y, 1, 1)
        p0, p1 = oy + 18 + gh + 1, yb - 4                                                                  # the playfield flares out towards us, from under the glass
        for y in range(p0, p1):
            k = (y - p0) / max(1, p1 - p0 - 1); l = round(2 - 2 * k); r = round(Fw - 3 + (CW - Fw + 2) * k)
            R(P['k'], l, y, r - l + 1, 1); R('#16507e' if (y - p0) % 4 else '#1b5f93', l + 1, y, r - l - 1, 1)
        R(trim, 2, p0, Fw - 4, 1)
        mid = round(CW / 2)
        for f_, col in ((.28, P['red']), (.5, P['lime']), (.72, P['blue'])): R(col, round(CW * f_) - 1, p0 + 2, 3, 2); R(P['cream'], round(CW * f_), p0 + 2, 1, 1)
        for i in range(5): R(P['yellow'], mid - 7 + i, p1 - 4 + i // 2, 1, 1); R(P['yellow'], mid + 6 - i, p1 - 4 + i // 2, 1, 1)
        for x in range(4, CW - 4, 4): R(P['pink'] if (x // 4) % 2 else P['orange'], x, p1 - 1, 2, 1)
        R(P['lg'], 1, p1, CW - 2, 1); R(P['cream'], CW - 4, p1 - 5, 1, 4)                                  # lockdown bar, plunger
        for x in (2, CW - 5): R(P['k'], x, p1 + 1, 3, yb - p1 - 1); R(trim, x + 1, p1 + 1, 1, yb - p1 - 2)
    return c, dict(cell=[CW, CH], glass=[5, oy + 18, gw, gh], marquee=[4, oy + 3, Fw - 8, 7], oy=oy)

def cab_strip(gw, gh):
    """16 cells: cell = body * 4 + colour (spec 102 FR-306)"""
    cells = [cabinet(gw, gh, v, b) for b in range(4) for v in range(4)]; cw, ch = cells[0][0].w, cells[0][0].h
    strip = C(cw * len(cells), ch)
    for i, (c, _) in enumerate(cells): strip.draw(c, i * cw, 0)
    return strip, cells[0][1]

# ---------------------------------------------------------------------------------------------------------------- fixtures (nine, from the mockup)
def fixture(fid):
    def o(w, h, fn): c = C(w, h); fn(c, w, h); return c
    def box(x, X, Y, w, h, fill, edge=None): x.R(edge or P['k'], X, Y, w, h); x.R(fill, X + 1, Y + 1, w - 2, h - 2)
    def shadow(x, w, h): x.R('#000000', 2, h - 2, w - 4, 2, .4)
    R = lambda x, *a: x.R(*a)
    if fid == 'library':
        def f(x, w, h):
            box(x, 1, 6, 42, 30, '#3a4f8a'); box(x, 3, 8, 38, 18, '#1d2b53'); x.R(P['blue'], 3, 8, 38, 1); x.R(P['cream'], 6, 11, 1, 5); x.R(P['cream'], 36, 11, 1, 5)
            for a, c in ((7, P['pink']), (16, P['yellow']), (25, P['lime'])):
                box(x, a, 17, 8, 8, c); x.R(P['k'], a + 2, 19, 1, 1); x.R(P['k'], a + 5, 19, 1, 1); x.R(P['k'], a + 3, 22, 2, 1)
            x.R(P['yellow'], 35, 14, 5, 5); x.R(P['k'], 35, 19, 5, 1); x.R(P['yellow'], 37, 20, 1, 4); x.R(P['orange'], 35, 24, 5, 2)
            box(x, 1, 27, 42, 10, P['brown']); x.R(P['orange'], 3, 29, 38, 1); x.R(P['k'], 19, 31, 6, 4); shadow(x, w, h)
        return o(44, 40, f)
    if fid == 'software':
        def f(x, w, h):
            box(x, 2, 2, 36, 38, '#2f2750'); cols = [P['red'], P['blue'], P['yellow'], P['lime'], P['pink'], P['orange'], P['lav'], P['cream'], P['blue']]
            for r in range(4):
                for q in range(3):
                    X, Y = 5 + q * 11, 5 + r * 9; box(x, X, Y, 9, 8, P['dg']); x.R(cols[(r * 3 + q) % 9], X + 1, Y + 2, 7, 4); x.R(P['k'], X + 3, Y + 6, 3, 1)
            shadow(x, w, h)
        return o(40, 42, f)
    if fid == 'terminal':
        def f(x, w, h):
            box(x, 5, 1, 26, 40, '#34223a'); box(x, 8, 4, 20, 14, P['k']); x.R(P['lime'], 10, 7, 12, 1); x.R(P['lime'], 10, 10, 8, 1); x.R(P['lime'], 10, 13, 14, 1)
            box(x, 8, 21, 20, 8, P['dg'])
            for q in range(4): x.R(P['lg'], 10 + q * 4, 23, 2, 2); x.R(P['lg'], 10 + q * 4, 26, 2, 1)
            box(x, 12, 31, 12, 6, P['red']); x.R(P['pink'], 14, 32, 8, 1); shadow(x, w, h)
        return o(36, 44, f)
    if fid == 'web':
        def f(x, w, h):
            box(x, 4, 1, 36, 14, '#2a2142'); box(x, 7, 3, 30, 8, P['k'])
            for a, c in ((9, P['pink']), (15, P['yellow']), (21, P['blue']), (27, P['lime'])): x.R(c, a, 5, 4, 3)
            for y in range(20): inset = y // 5; x.R(P['k'], 3 + inset, 15 + y, 38 - inset * 2, 1)
            for y in range(1, 19): inset = y // 5; x.R('#2a8fc9', 4 + inset, 15 + y, 36 - inset * 2, 1)
            for a, b, c in ((14, 20, P['yellow']), (26, 20, P['pink']), (20, 26, P['lime'])): x.R(P['k'], a, b, 5, 5); x.R(c, a + 1, b + 1, 3, 3)
            x.R(P['cream'], 21, 31, 2, 2); x.R(P['red'], 12, 33, 6, 2); x.R(P['red'], 26, 33, 6, 2); x.R(P['dg'], 8, 36, 3, 6); x.R(P['dg'], 33, 36, 3, 6); shadow(x, w, h)
        return o(44, 44, f)
    if fid == 'boss':
        def f(x, w, h):
            box(x, 2, 1, 62, 44, '#3a2a14', P['k']); x.R(P['yellow'], 3, 2, 60, 2); x.R(P['orange'], 3, 4, 60, 1)
            box(x, 8, 6, 50, 7, P['k'])
            for q in range(12): x.R(P['yellow'] if q % 2 else P['orange'], 10 + q * 4, 8, 2, 2); x.R(P['orange'] if q % 2 else P['yellow'], 10 + q * 4, 10, 2, 2)
            box(x, 8, 15, 50, 21, '#1a1530'); x.R(P['k'], 11, 17, 44, 17)
            for i, c in enumerate([P['pink'], P['blue'], P['yellow'], P['lime']]):
                X, Y, ww, hh = 13 + i * 3, 18 + i * 2, 40 - i * 6, 15 - i * 4
                x.R(c, X, Y, ww, 1); x.R(c, X, Y + hh - 1, ww, 1); x.R(c, X, Y, 1, hh); x.R(c, X + ww - 1, Y, 1, hh)
            x.R(P['cream'], 31, 24, 4, 3); box(x, 4, 37, 58, 7, P['brown']); x.R(P['orange'], 6, 39, 54, 1)
            for a, c in ((14, P['red']), (22, P['yellow']), (44, P['blue']), (52, P['lime'])): x.R(c, a, 41, 3, 2)
            shadow(x, w, h)
        return o(66, 48, f)
    if fid == 'coffee':
        def f(x, w, h):
            box(x, 4, 1, 26, 42, '#2a8fc9'); box(x, 7, 4, 20, 9, P['k']); x.R(P['yellow'], 10, 7, 3, 3); x.R(P['yellow'], 14, 7, 3, 3); x.R(P['yellow'], 18, 7, 3, 3)
            box(x, 8, 16, 18, 3, P['k']); x.R(P['lime'], 9, 17, 16, 1); box(x, 8, 22, 18, 9, P['lg']); x.R(P['k'], 12, 25, 10, 3)
            box(x, 9, 34, 16, 7, P['dg']); x.R(P['yellow'], 12, 36, 3, 2); x.R(P['orange'], 18, 36, 3, 2); shadow(x, w, h)
        return o(34, 46, f)
    if fid == 'bank':
        def f(x, w, h):
            box(x, 3, 6, 34, 30, P['dg']); box(x, 7, 10, 26, 22, '#3a3330'); box(x, 14, 15, 12, 12, P['lg']); x.R(P['k'], 19, 17, 2, 8); x.R(P['k'], 16, 20, 8, 2)
            for q in range(6): x.R(P['yellow'] if q % 2 else P['orange'], 5 + q * 5, 3, 5, 3); x.R(P['k'], 5 + q * 5, 6, 5, 1)
            x.R(P['red'], 30, 29, 6, 5); x.R(P['cream'], 31, 30, 4, 1); shadow(x, w, h)
        return o(40, 38, f)
    if fid == 'postbox':
        def f(x, w, h):
            box(x, 4, 2, 24, 38, P['red']); box(x, 8, 6, 16, 8, P['k']); x.R(P['yellow'], 10, 9, 12, 2)
            box(x, 8, 18, 16, 4, P['k']); x.R(P['cream'], 10, 20, 12, 12); x.R(P['k'], 10, 23, 12, 1); x.R(P['red'], 12, 26, 8, 1); x.R(P['cream'], 12, 33, 8, 5)
            x.R(P['k'], 12, 35, 1, 1); x.R(P['k'], 19, 35, 1, 1); shadow(x, w, h)
        return o(32, 44, f)
    def f(x, w, h):                                                                                     # other: the repair bench
        box(x, 2, 18, 36, 14, P['brown']); x.R(P['orange'], 3, 19, 34, 1); box(x, 6, 8, 18, 10, P['red']); x.R(P['dg'], 14, 5, 3, 3)
        x.R(P['lg'], 28, 6, 2, 12); x.R(P['lg'], 26, 5, 6, 2); x.R(P['blue'], 33, 10, 2, 8); x.R(P['k'], 33, 8, 2, 2)
        x.R(P['lime'], 8, 11, 14, 4); x.R(P['k'], 10, 12, 2, 1); x.R(P['k'], 16, 12, 2, 1); x.R(P['dg'], 4, 32, 4, 4); x.R(P['dg'], 32, 32, 4, 4); shadow(x, w, h)
    return o(40, 36, f)
FIXTURES = ['library', 'software', 'terminal', 'web', 'boss', 'coffee', 'bank', 'postbox', 'other']

# ---------------------------------------------------------------------------------------------------------------- room: wall and floor, day and night
WALL_W, WALL_H, SHADOW = 720, 112, 6
# the four neon signs wall() draws (grid px of the 720 x 118 wall, tube and halo): the renderer keeps name chips and place plates off them (spec 102 T445, issue #2009)
WALL_SIGNS = [dict(id='bolt', x=200, y=10, w=15, h=23), dict(id='star', x=291, y=8, w=23, h=22), dict(id='sign', x=407, y=10, w=23, h=17), dict(id='heart', x=508, y=5, w=21, h=22)]
def wall(day):
    c = C(WALL_W, WALL_H + SHADOW); R = c.R; w, band = WALL_W, WALL_H
    R('#bfae84' if day else '#141b3d', 0, 0, w, band)
    for r in range(0, band, 4):
        for q in range(-(r // 4 % 2) * 4, w, 8): R('#ead9b4' if day else '#18214a', q + 1, r + 1, 7, 3)
    for r in range(band):
        a = max(0, 1 - r / (band * .8)) * (.12 if day else .55); dark = '#8a7a58' if day else '#060814'
        if r % 2 == 0: R(dark, 0, r, w, 1, a)
        else:
            for q in range(0 if r % 4 == 1 else 1, w, 2): R(dark, q, r, 1, 1, a)
    def tube(pts, col, halo):
        for (a, b) in pts:
            n = max(abs(b[0] - a[0]), abs(b[1] - a[1]), 1)
            for i in range(n + 1):
                X, Y = round(a[0] + (b[0] - a[0]) * i / n), round(a[1] + (b[1] - a[1]) * i / n)
                if not day:
                    for dx in range(-2, 3):
                        for dy in range(-2, 3):
                            if (X + dx + Y + dy) % 2 == 0 and abs(dx) + abs(dy) >= 2: R(halo, X + dx, Y + dy, 1, 1, .4)
        for (a, b) in pts:
            n = max(abs(b[0] - a[0]), abs(b[1] - a[1]), 1)
            for i in range(n + 1):
                X, Y = round(a[0] + (b[0] - a[0]) * i / n), round(a[1] + (b[1] - a[1]) * i / n)
                R('#c9a9a0' if day else col, X, Y, 1, 1)
                if day: R(P['cream'], X, Y, 1, 1, .9)
    poly = lambda pp, closed=False: [(pp[i], pp[(i + 1) % len(pp)]) for i in range(len(pp) - (0 if closed else 1))]
    y0, top = 4, band - 5
    tube(poly([[2, y0 + 2], [w - 3, y0 + 2]]), P['pink'], P['pink']); tube(poly([[2, top], [w - 3, top]]), P['blue'], P['blue'])
    # four signs in the middle of the picture: the room is shown cropped at the middle at the other scales (RA3), so none sits at its edge
    a = round(w * .28); b = y0 + 8
    tube(poly([[a + 6, b], [a, b + 9], [a + 5, b + 9], [a + 1, b + 18], [a + 10, b + 7], [a + 5, b + 7], [a + 8, b]]), P['yellow'], P['orange'])
    a = round(w * .42); b = y0 + 14
    tube(poly([[a, b - 8], [a + 3, b - 2], [a + 9, b - 1], [a + 4, b + 3], [a + 6, b + 9], [a, b + 5], [a - 6, b + 9], [a - 4, b + 3], [a - 9, b - 1], [a - 3, b - 2]], True), P['blue'], P['blue'])
    a = round(w * .58); b = y0 + 14
    tube(poly([[a - 9, b - 6], [a + 9, b - 6], [a + 9, b + 6], [a - 9, b + 6]], True), P['lime'], P['lime']); tube(poly([[a - 4, b], [a + 4, b]]), P['lime'], P['lime']); tube(poly([[a, b - 3], [a, b + 3]]), P['lime'], P['lime'])
    a = round(w * .72); b = y0 + 12
    tube(poly([[a - 8, b - 6], [a, b + 8], [a + 8, b - 6], [a + 4, b - 9], [a, b - 5], [a - 4, b - 9]], True), P['pink'], P['pink'])
    if day:
        for X in range(w):
            st = (X // 6) % 2
            R(P['k'], X, band - 5 + st, 1, 1); R(P['brown'], X, band - 4 + st, 1, 1); R('#c97d45', X, band - 3 + st, 1, 2); R(P['k'], X, band - 1 + st, 1, 1)
        for i, fx in enumerate((.35, .5, .65)):
            X, Y, col = round(w * fx) - 6, 5 + (i % 2) * 2, ['#29adff', '#ff77a8', '#00e436'][i]
            R(P['k'], X, Y, 13, 13); R(col, X + 1, Y + 1, 11, 11); R(P['lg'], X + 3, Y + 1, 7, 4); R(P['k'], X + 7, Y + 2, 1, 2); R(P['cream'], X + 2, Y + 7, 9, 5); R(P['dg'], X + 3, Y + 9, 7, 1)
    else: R(P['k'], 0, band - 3, w, 3)
    for r in range(SHADOW):                                                                              # the soft dithered shadow the wall throws on the floor
        for X in range(w):
            if (X + r) % 2 == 0 and r < 5 - (1 if X % 3 else 0): R('#6a5a3a' if day else '#05060f', X, band + r, 1, 1, (.22 if day else .35) - r * .04)
    return c

def floor(day):
    c = C(24, 24); R = c.R
    R('#f6e8d2' if day else '#0f1536', 0, 0, 24, 24)
    for Y in range(24):
        for X in range(24):
            u, v = (X + Y) % 12, (X - Y + 1200) % 12
            if u == 0 or v == 0: R('#ecdcc0' if day else '#141b42', X, Y, 1, 1)
            elif u == 6 and v == 6: R('#e0cba8' if day else '#1b2455', X, Y, 1, 1)
    return c

STATES = ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'idle']
STATE_COL = dict(working='#3b82c4', thinking='#8a6fd1', waiting='#f0a020', error='#d9473a', limit='#f0a020', done='#3f9a63', idle='#4aa6a0')
def glow():
    """one cell per state: a dithered pool of light in three rings (56 x 15 grid pixels); the app sets how strong it is"""
    wl, hl = 56, 15; c = C(wl * len(STATES), hl)
    for i, st in enumerate(STATES):
        for Y in range(hl):
            for X in range(wl):
                dx, dy = (X + .5 - wl / 2) / (wl / 2), (Y + .5 - hl / 2) / (hl / 2); d = (dx * dx + dy * dy) ** .5
                lvl = 3 if d < .45 else 2 if d < .72 else 1 if d < 1 else 0
                if not lvl or (lvl == 1 and (X + Y) % 2): continue
                c.R(STATE_COL[st], i * wl + X, Y, 1, 1, (1 if lvl == 3 else .65 if lvl == 2 else .4))
    return c

def console():
    """a low console and a stool, for a person who is asleep (FR-259): a placeholder drawing, nobody has looked at it yet"""
    c = C(40, 22); R = c.R
    R(P['k'], 2, 6, 36, 14); R('#2f2750', 3, 7, 34, 12); R('#4a4068', 3, 7, 34, 2); R(P['k'], 6, 10, 10, 4); R(P['lime'], 7, 11, 8, 1); R(P['yellow'], 24, 11, 3, 3); R(P['red'], 29, 11, 3, 3)
    R(P['dg'], 4, 19, 4, 3); R(P['dg'], 32, 19, 4, 3)
    return c

# ---------------------------------------------------------------------------------------------------------------- welcome (T206: the first-run picture)
WELCOME_W, WELCOME_H = 480, 300        # 16:10 like the 1920x1200 cap; one file pixel is one grid pixel, shown at 3 px a pixel in a 1440 px window

def screen_art(c, x, y, w, h, kind):
    """what a cabinet's glass shows when nobody plays: an attract loop drawn as a few flat blocks (invented shapes, no game or brand)"""
    R = c.R; R('#05060f', x, y, w, h)
    if kind == 0:                                                     # a cannon under rows of block creatures
        for r in range(4):
            for q in range(7):
                col = (P['lime'], P['yellow'], P['pink'], P['blue'])[r]; X, Y = x + 5 + q * ((w - 10) // 7), y + 5 + r * 7
                R(col, X, Y, 6, 4); R('#05060f', X + 1, Y + 1, 1, 1); R('#05060f', X + 4, Y + 1, 1, 1)
        R(P['cream'], x + w // 2 - 1, y + h - 14, 2, 5); R(P['lime'], x + w // 2 - 4, y + h - 9, 9, 3); R(P['lime'], x + w // 2 - 2, y + h - 11, 5, 2)
    elif kind == 1:                                                   # a road running to a horizon: dark sky, a horizon line, a two-edged road in perspective, a dashed centre line, two cars
        hz = y + max(8, h * 2 // 5); cx = x + w // 2; rows = y + h - hz
        for X in range(x + 3, x + w - 3, 9): R(P['cream'], X + (X // 9) % 3, y + 2 + (X // 9) % 3 * 2, 1, 1)          # a few stars
        R(P['plum'], x, hz - 3, w, 2); R(P['pink'], x, hz - 1, w, 1)                                                    # the glow on the horizon
        R(P['green'], x, hz, w, rows); R('#05060f', x, hz + 1, w, 1)                                                    # the verge, dark at the horizon
        for Y in range(hz, y + h):
            t = (Y - hz + 1) / rows; half = max(2, round(2 + t * (w // 2 - 4))); band = int(t * 7) % 2                  # the road widens to the foot of the glass
            R(P['dg'] if band else '#3b3550', cx - half, Y, 2 * half, 1)
            R(P['red'] if band else P['cream'], cx - half - 1, Y, 2, 1); R(P['red'] if band else P['cream'], cx + half - 1, Y, 2, 1)
            if int(t * 9) % 2 == 0: R(P['yellow'], cx - (1 if t > .5 else 0), Y, 1 + (1 if t > .5 else 0), 1)           # dashes, longer near us
        R(P['k'], cx - 2, hz + 5, 5, 1); R(P['blue'], cx - 2, hz + 3, 5, 2); R(P['cream'], cx - 1, hz + 2, 3, 1)       # a far car, going away
        R(P['k'], cx - 6, y + h - 4, 12, 1); R(P['red'], cx - 6, y + h - 7, 12, 3); R(P['pink'], cx - 4, y + h - 9, 8, 2); R(P['k'], cx - 3, y + h - 8, 6, 1); R(P['yellow'], cx - 5, y + h - 6, 2, 1); R(P['yellow'], cx + 3, y + h - 6, 2, 1)   # our car from behind, its lights on
    elif kind == 2:                                                   # two bats and a ball
        for Y in range(y + 2, y + h - 2, 4): R(P['lg'], x + w // 2, Y, 1, 2)
        R(P['blue'], x + 4, y + h // 3, 2, 10); R(P['pink'], x + w - 6, y + h // 2, 2, 10); R(P['cream'], x + w // 2 + 8, y + h // 2 - 3, 3, 3)
        R(P['lg'], x + w // 2 - 14, y + 3, 4, 1); R(P['lg'], x + w // 2 + 10, y + 3, 4, 1)
    elif kind == 3:                                                   # a stack of falling blocks
        for i, (col, bx, by) in enumerate(((P['blue'], 2, 6), (P['blue'], 3, 6), (P['orange'], 0, 5), (P['orange'], 1, 5), (P['pink'], 0, 4), (P['lime'], 2, 4), (P['lime'], 3, 4), (P['yellow'], 1, 3), (P['yellow'], 2, 3), (P['red'], 0, 6), (P['red'], 1, 6))):
            bw = (w - 8) // 5; R(P['k'], x + 4 + bx * bw, y + h - 4 - (by + 1) * 6, bw, 6); R(col, x + 5 + bx * bw, y + h - 3 - (by + 1) * 6, bw - 2, 4)
        R(P['cream'], x + w - 12, y + 4, 8, 1); R(P['cream'], x + w - 12, y + 8, 6, 1)
    else:                                                             # a snake of blocks round a maze
        R(P['blue'], x + 3, y + 3, w - 6, 1); R(P['blue'], x + 3, y + h - 4, w - 6, 1); R(P['blue'], x + 3, y + 3, 1, h - 6); R(P['blue'], x + w - 4, y + 3, 1, h - 6)
        for X in range(x + 8, x + w - 8, 5): R(P['cream'], X, y + h // 2, 1, 1)
        for i in range(10): R(P['lime'], x + 8 + i * 2, y + 9 + i // 3, 2, 2)
        R(P['red'], x + w - 14, y + h // 2 - 2, 4, 4)

def lit_marquee(c, x, y, w, h, trim):
    """the marquee strip, lit: the app writes the real words here, the picture only has a glow of dashes"""
    c.R('#150f24', x, y, w, h)
    for X in range(x + 4, x + w - 4, 4): c.R(trim, X, y + h // 2, 3, 1, .85)

def welcome():
    """the first-run hall (spec 102 T206): the night wall, the lattice floor, a back row of cabinets with their attract loops lit, two big ones at the
    edges nearer to us, pools of light on the floor, the edges dimmed. The middle stays quiet: the first-run card stands there."""
    W, H = WELCOME_W, WELCOME_H; c = C(W, H)
    tile = floor(False)
    for ty in range(0, H, 24):
        for tx in range(0, W, 24): c.draw(tile, tx, ty)
    wl = wall(False); c.im.alpha_composite(wl.im.crop(((WALL_W - W) // 2, 0, (WALL_W + W) // 2, wl.h)), (0, 0))
    def stand(kind, variant, gw, gh, cx, base, art, mirror=False):
        cab, g = cabinet(gw, gh, variant, kind); cell = C(cab.w, cab.h)
        screen_art(cell, g['glass'][0], g['glass'][1], g['glass'][2], g['glass'][3], art); mq = g['marquee']; lit_marquee(cell, mq[0], mq[1], mq[2], mq[3], TRIM[variant % 4])
        cell.draw(cab, 0, 0)
        im = cell.im.transpose(Image.FLIP_LEFT_RIGHT) if mirror else cell.im
        X, Y = cx - cab.w // 2, base - cab.h
        pool = C(cab.w + 30, 14)                                           # the pool of the screen's light on the floor in front of it
        for yy in range(14):
            for xx in range(pool.w):
                dx, dy = (xx + .5 - pool.w / 2) / (pool.w / 2), (yy + .5 - 7) / 7
                if (dx * dx + dy * dy) ** .5 < 1 and (xx + yy) % 2 == 0: pool.R(TRIM[variant % 4], xx, yy, 1, 1, .22)
        c.draw(pool, X - 15, base - 4); c.im.alpha_composite(im, (X, Y))
    back = [(0, 3, 0), (1, 0, 1), (0, 1, 2), (2, 2, 3), (0, 0, 4), (3, 3, 0), (0, 2, 1), (1, 1, 2), (0, 3, 3)]       # (body, colour, loop) along the wall
    for i, (kind, var, art) in enumerate(back):
        cx = 26 + i * 53
        if 150 < cx < 330 and kind == 0: continue                          # a gap behind the card, where the floor runs back to the wall
        stand(kind, var, 44, 32, cx, 140 + (i % 2) * 2, art, mirror=cx > W // 2)
    stand(0, 1, 75, 50, 30, 268, 1); stand(0, 3, 75, 50, W - 30, 268, 3, mirror=True)
    stand(3, 0, 56, 32, 118, 286, 2); stand(2, 2, 56, 32, W - 118, 286, 0, mirror=True)
    edge = Image.new('RGBA', (W, H), (0, 0, 0, 0)); px = edge.load()      # the dimmed edges: a dither, no gradient
    for y in range(H):
        for x in range(W):
            d = min(x, W - 1 - x, (y + 20) // 2 if y < 100 else 999) / 70
            if d < 1 and (x + y) % 2 == 0 and (x // 2 + y // 2) % 2 == 0 or d < .5 and (x + y) % 2 == 0: px[x, y] = (5, 6, 15, round(150 * (1 - d)))
    c.im.alpha_composite(edge)
    return c

def write_world(repo):
    W = os.path.join(repo, 'src/renderer/realoffice/worlds/retro'); os.makedirs(W, exist_ok=True)
    for f in os.listdir(W):
        if f.endswith('.webp'): os.remove(os.path.join(W, f))
    total = 0
    total += save(wall(True).im, f'{W}/wall.webp'); total += save(wall(False).im, f'{W}/wall-night.webp')
    total += save(floor(True).im, f'{W}/floor.webp'); total += save(floor(False).im, f'{W}/floor-night.webp')
    fx, ftop = {}, {}; FL = max(fixture(f).im.height for f in FIXTURES)
    for fid in FIXTURES:
        im = fixture(fid).im; cv = Image.new('RGBA', (im.width, FL), (0, 0, 0, 0)); cv.alpha_composite(im, (0, FL - im.height))
        total += save(cv, f'{W}/fx-{fid}.webp'); fx[fid] = [im.width, FL]; ftop[fid] = FL - im.height
    mon = {}
    for key, (name, gw, gh) in dict(big=('monitor.webp', 75, 50), small=('monitor-half.webp', 56, 32), narrow=('monitor-narrow.webp', 44, 32)).items():
        strip, g = cab_strip(gw, gh); total += save(strip.im, f'{W}/{name}'); cw, chh = g['cell']
        mon[key] = dict(file=name, cells=16, bodies=4, cell=[cw, chh], screenRect=[round(v, 4) for v in (g['glass'][0] / cw, g['glass'][1] / chh, g['glass'][2] / cw, g['glass'][3] / chh)],
                        marqueeRect=[round(v, 4) for v in (g['marquee'][0] / cw, g['marquee'][1] / chh, g['marquee'][2] / cw, g['marquee'][3] / chh)], glass=g['glass'], marquee=g['marquee'])
    total += save(glow().im, f'{W}/glow.webp'); total += save(console().im, f'{W}/desk.webp'); total += save(welcome().im, f'{W}/welcome.webp')
    meta = dict(formatVersion=1, id='retro', name='Retro arcade', defaultSet='retro', pixelArt=True, storeys=True, arrangement='aisles', css='world.css', wall='wall.webp', floorTile=[24, 24],
                night=dict(wall='wall-night.webp', floor='floor-night.webp'), welcome='welcome.webp', monitor=mon, glow=dict(file='glow.webp', cells=STATES, cell=[56, 15]),
                desk=[40, 22], fixtures=fx, fixtureTop=ftop, floorLine=FL, wallSize=[WALL_W, WALL_H + SHADOW], bandRows=WALL_H, wallSigns=WALL_SIGNS)
    with open(os.path.join(W, 'world.json'), 'w') as f: f.write(json.dumps(meta, indent=1, sort_keys=True) + '\n')
    return meta, total

def selftest():
    w1, w2 = io.BytesIO(), io.BytesIO(); wall(False).im.save(w1, 'WEBP', lossless=True); wall(False).im.save(w2, 'WEBP', lossless=True)
    assert hashlib.sha256(w1.getvalue()).digest() == hashlib.sha256(w2.getvalue()).digest(), 'two runs differ'
    # T206: the first-run picture is 16:10 inside the part's cap, a lossless drawing with no metadata, and two runs give the same bytes
    wa, wb = io.BytesIO(), io.BytesIO(); welcome().im.save(wa, 'WEBP', lossless=True, quality=100, method=6, exact=True); welcome().im.save(wb, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    assert wa.getvalue() == wb.getvalue(), 'welcome: two runs differ'
    assert wa.getvalue()[12:16] == b'VP8L' and len(wa.getvalue()) <= 150 * 1024 and welcome().im.size == (480, 300), 'welcome: not a lossless 480x300 picture within 150 KB'
    assert len(set(welcome().im.convert('RGB').getdata())) > 40, 'welcome: nearly blank'
    c, g = cabinet(56, 32, 0); assert c.w == 73 and c.h == 73 and g['glass'] == [5, 18, 56, 32], g
    assert c.im.getpixel((10, 25))[3] == 0, 'the glass is a hole'
    args_selftest()
    print('build-arcade-pack selftest ok')

def parse_args(argv):
    """the command line, checked before anything is read or deleted (#1079 review: `--help` was taken for the art folder and the build
    deleted the set's pictures). Returns ('selftest',) / ('world', repo); anything else exits with the usage. The people set it once built
    is gone (spec 102 T502): the Retro pixel people are the HD set (`hd/`, built from the art cache's own pipeline, ASSETS.md)."""
    a = list(argv)
    if a[:1] == ['--selftest'] and len(a) == 1: return ('selftest',)
    def repo_ok(r):
        if not (os.path.isfile(os.path.join(r, 'package.json')) and os.path.isdir(os.path.join(r, 'src', 'renderer', 'realoffice'))): raise SystemExit(f'not the repository: {r}\n' + __doc__)
        return r
    if a[:1] == ['--world'] and len(a) <= 2 and not any(x.startswith('-') for x in a[1:]): return ('world', repo_ok(a[1] if len(a) > 1 else os.getcwd()))
    raise SystemExit(__doc__)

def args_selftest():
    """a wrong command line exits before it deletes anything: `--help`, an unknown flag, a folder that is not the art cache, a repo that is not one"""
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as t:
        S = os.path.join(t, 'src/renderer/realoffice/sets/retro'); os.makedirs(S); keep = os.path.join(S, 'p01-book.webp'); open(keep, 'wb').write(b'x')
        open(os.path.join(t, 'package.json'), 'w').write('{}')
        for args in (['--help'], ['-h'], ['--world', '--force'], ['--sit'], [t], [os.path.join(t, 'nowhere')], ['--world', os.path.join(t, 'src')]):
            r = subprocess.run([sys.executable, '-I', os.path.abspath(__file__)] + args, cwd=t, capture_output=True)
            assert r.returncode != 0, f'not refused: {args}'
            assert os.path.exists(keep), f'deleted a picture: {args}'

if __name__ == '__main__':
    cmd = parse_args(sys.argv[1:])
    if cmd[0] == 'selftest': selftest(); sys.exit(0)
    write_world(cmd[1])
