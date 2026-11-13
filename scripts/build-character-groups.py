#!/usr/bin/env python3
"""Character group pictures (spec 102 FR-303, T265b): one picture per character set showing many of its people, for the Settings cards.

    python3 scripts/build-character-groups.py [--write | --check] [set-id ...]
    python3 scripts/build-character-groups.py --selftest

A set's group picture is made only from that set's own shipped pictures (`src/renderer/realoffice/sets/<id>/<person>-rest.webp`, the seated
resting pose): a head-and-shoulders square of each person, cut from `set.json`'s `seat` numbers, laid out in rows, the last row centred,
people in sorted id order. Never new art, no network, no randomness: the same pictures give the same bytes. Pillow only (WebP, no EXIF, XMP
or ICC chunk), like `build-kid-pack.py`. Each picture is at most MAX_BYTES (64 KB, FR-303): the script lowers the WebP quality step by step,
then the tile size, and fails (never drops a person, never writes an oversized file) when nothing fits.

    (no flag)  prints each set's size and layout, writes nothing
    --write    writes src/renderer/realoffice/groups/<id>.webp
    --check    fails when a committed picture is not byte for byte what the pictures give now, or is over the budget (exit 1)

The pure parts (`plan_grid`, `head_shoulders`, `person_ids`, `fit_budget`) take numbers and return numbers; `build_group` is the only one that
reads pictures. The face floor of FR-303 (no face under 24 px on the card): a tile's face is at least FACE_MIN_PX of TILE px, checked at build."""
import io, json, math, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SETS = os.path.join(ROOT, 'src', 'renderer', 'realoffice', 'sets')
OUT = os.path.join(ROOT, 'src', 'renderer', 'realoffice', 'groups')

MAX_BYTES = 64 * 1024          # FR-303: at most 64 KB per group picture
TILE = 96                      # one person's cell, pixels; the cards show the picture at about this size, so the face is about FACE_U * (1 / HS_U) of it
TILE_MIN = 96                  # the smallest tile the budget may use: below 96 a face (FACE_U of the body, a whole bust tile) can fall under 24 px, so today only the quality gives
QUALITIES = (80, 70, 60, 50, 40)
FACE_U = 0.30                  # a face's height as a share of the seated body (src/shared/realoffice-layout.ts FACE_U: test-character-groups.js compares them)
HS_U = 0.55                    # a torso picture's head-and-shoulders square, side as a share of the body height: the head plus the shoulders under it
TORSO_SETS = ('office',)       # sets whose seated picture shows the body down to the lap or chair; every other set draws a bust, which is cropped whole (square)
ASPECT = 1.6                   # the group's width : height the rows aim at (a card's picture is wider than tall)
FACE_MIN_PX = 24               # FR-303's floor: a face is at least this many pixels in a tile (the app's own face height, FACE_U of the body, as `headCrop` takes it)

MUTANT = os.environ.get('CG_MUTANT', '')   # test-character-groups.js runs the selftest with one of these set; each must fail it


def person_ids(seat):
    """The people of a set in the order they are drawn: sorted by id, so a different key order in set.json changes nothing."""
    ids = list(seat)
    return ids if MUTANT == 'unsorted' else sorted(ids)


def plan_grid(n):
    """Rows and columns for n people, and where each sits: [(col, row, x_offset_in_cells)], the last row centred. n >= 1."""
    if n < 1: raise ValueError('a group needs at least one person')
    rows = max(1, round(math.sqrt(n / ASPECT)))
    cols = math.ceil(n / rows)
    cells = []
    for i in range(n):
        r, c = divmod(i, cols)
        left = n - r * cols if r == rows - 1 else cols            # people on this row
        left = min(left, cols)
        cells.append((c, r, (cols - left) / 2 if MUTANT != 'uncentred' else 0))
    return {'cols': cols, 'rows': rows, 'cells': cells}


def head_shoulders(seat, torso=False):
    """The square (x, y, s in the picture's own pixels) holding a seated person's head and shoulders. `seat` has w, h, headTop, bodyH
    (set.json, in the pictures' pixels, as `headCrop` in realoffice-layout.ts). A torso picture (office) is cut to HS_U of its body; a bust picture is
    already head and shoulders, so its whole square is taken (looked at: HS_U of a bust cuts the hair, hats and crowns). Sideways centred, top at the
    top of the head, kept inside the picture."""
    s = min(seat['bodyH'] * HS_U if torso else seat['w'], seat['w'], seat['h'])
    x = max(0, min(seat['w'] - s, seat['w'] / 2 - s / 2))
    y = max(0, min(seat['h'] - s, seat['headTop'] - s * 0.04))     # a little air over the hair
    if MUTANT == 'unclamped': y = seat['headTop'] + seat['h']
    return {'x': x, 'y': y, 's': s}


def to_pixels(seat, size, name=''):
    """`set.json` keeps its numbers in the source sheet's pixels, the shipped picture may be a resize of it (office: 640 px tall at most): one scale for
    all of w, h, headTop and bodyH, taken from the picture, which must keep the sheet's proportions (a 1% slack for rounding)."""
    k = size[1] / seat['h']
    if abs(size[0] - seat['w'] * k) > 0.01 * size[0] + 1: raise SystemExit('%s: %dx%d does not keep the proportions of set.json (%dx%d)' % (name, size[0], size[1], seat['w'], seat['h']))
    return {'w': size[0], 'h': size[1], 'headTop': seat['headTop'] * k, 'bodyH': seat['bodyH'] * k}


def face_px(seat, tile, torso=False):
    """A face's height in pixels in a tile of `tile` px (the crop's side maps to the tile)."""
    return tile * seat['bodyH'] * FACE_U / head_shoulders(seat, torso)['s']


def fit_budget(encode, limit=MAX_BYTES, tile_min=TILE_MIN):
    """`encode(tile, quality)` -> bytes. Walks quality down, then the tile down (8 px steps, never under `tile_min`), and returns (bytes, tile, quality) for the first that fits `limit`.
    Raises when none does: a person is never dropped and an oversized picture is never returned."""
    tile = TILE
    while tile >= tile_min:
        for q in QUALITIES:
            data = encode(tile, q)
            if len(data) <= limit and MUTANT != 'nobudget': return data, tile, q
            if MUTANT == 'nobudget': return data, tile, q
        tile -= 8
    raise SystemExit('no tile size and quality fit %d bytes' % limit)


def _encode(seat_info, pics, pixel, torso, tile, quality):
    from PIL import Image
    ids = person_ids(seat_info)
    g = plan_grid(len(ids))
    sheet = Image.new('RGBA', (round(g['cols'] * tile), g['rows'] * tile), (0, 0, 0, 0))
    kz = max(1, int(tile // max(head_shoulders(seat_info[i], torso)['s'] for i in ids)))   # pixel art: ONE whole-number zoom for the set, so people keep their relative size
    for pid, (c, r, off) in zip(ids, g['cells']):
        seat = seat_info[pid]
        box = head_shoulders(seat, torso)
        im = pics[pid].crop((round(box['x']), round(box['y']), round(box['x'] + box['s']), round(box['y'] + box['s'])))
        if pixel:                                   # pixel art: one whole-number zoom (`kz`) with the nearest pixel, never a blur; centred in the tile
            k = kz
            im = im.resize((im.width * k, im.height * k), Image.NEAREST)
            cell = Image.new('RGBA', (tile, tile), (0, 0, 0, 0))
            cell.alpha_composite(im, (round((tile - im.width) / 2), round((tile - im.height) / 2))) if im.width <= tile else cell.alpha_composite(im.crop((round((im.width - tile) / 2), round((im.height - tile) / 2), round((im.width + tile) / 2), round((im.height + tile) / 2))), (0, 0))
            im = cell
        else:
            im = im.resize((tile, tile), Image.LANCZOS)
        sheet.alpha_composite(im, (round((c + off) * tile), r * tile))
    out = io.BytesIO()
    if pixel: sheet.save(out, 'WEBP', lossless=True, method=6, exif=b'')
    else: sheet.save(out, 'WEBP', quality=quality, method=6, exif=b'')
    return out.getvalue()


def build_group(set_id, sets_dir=SETS):
    """-> (bytes, info). Reads `<sets_dir>/<set_id>/set.json` and each person's `-rest.webp`; nothing else."""
    from PIL import Image
    d = os.path.join(sets_dir, set_id)
    with open(os.path.join(d, 'set.json'), encoding='utf8') as f: meta = json.load(f)
    seat = meta['seat']
    pics = {}
    for pid in seat:
        with Image.open(os.path.join(d, pid + '-rest.webp')) as im: pics[pid] = im.convert('RGBA')
        seat[pid] = to_pixels(seat[pid], pics[pid].size, '%s/%s-rest.webp' % (set_id, pid))
    pixel, torso = bool(meta.get('pixelArt')), set_id in TORSO_SETS
    for pid in seat:
        if face_px(seat[pid], TILE_MIN, torso) < FACE_MIN_PX - 0.01: raise SystemExit('%s/%s: a face would be under the floor at the smallest tile' % (set_id, pid))
    data, tile, q = fit_budget(lambda t, qq: _encode(seat, pics, pixel, torso, t, qq))
    g = plan_grid(len(seat))
    return data, {'set': set_id, 'people': len(seat), 'cols': g['cols'], 'rows': g['rows'], 'tile': tile, 'quality': 'lossless' if pixel else q, 'bytes': len(data)}


def set_ids(sets_dir=SETS):
    return sorted(d for d in os.listdir(sets_dir) if os.path.isfile(os.path.join(sets_dir, d, 'set.json')))


def selftest():
    # grid: every person has a cell, none twice, rows balanced, the last row centred
    for n in range(1, 41):
        g = plan_grid(n)
        assert len(g['cells']) == n and len({(c, r) for c, r, _ in g['cells']}) == n, 'n=%d: one cell each' % n
        assert g['cols'] * g['rows'] >= n and g['cols'] * (g['rows'] - 1) < n, 'n=%d: no empty row' % n
        last = [o for c, r, o in g['cells'] if r == g['rows'] - 1]
        assert abs(min(last) - (g['cols'] - len(last)) / 2) < 1e-9, 'n=%d: the last row is centred' % n
    assert (plan_grid(15)['cols'], plan_grid(15)['rows']) == (5, 3) and (plan_grid(6)['cols'], plan_grid(6)['rows']) == (3, 2)
    assert (plan_grid(13)['cols'], plan_grid(13)['rows']) == (5, 3) and plan_grid(13)['cells'][-1][2] == 1.0
    # order: sorted ids whatever the key order
    assert person_ids({'b': 1, 'a': 2, 'c': 3}) == ['a', 'b', 'c'] and person_ids({'c': 1, 'a': 2, 'b': 3}) == ['a', 'b', 'c']
    # the crop stays inside the picture, in the first and the last case
    for seat in ({'w': 457, 'h': 618, 'headTop': 111, 'bodyH': 507}, {'w': 80, 'h': 79, 'headTop': 2, 'bodyH': 77}, {'w': 100, 'h': 100, 'headTop': 90, 'bodyH': 400}):
        for torso in (True, False): b = head_shoulders(seat, torso); assert b['s'] > 0
        b = head_shoulders(seat, True)
        assert 0 <= b['x'] and 0 <= b['y'] and b['x'] + b['s'] <= seat['w'] + 1e-9 and b['y'] + b['s'] <= seat['h'] + 1e-9 and b['s'] > 0, 'inside the picture: %r' % (seat,)
    k = to_pixels({'w': 457, 'h': 618, 'headTop': 111, 'bodyH': 507}, (230, 309))
    assert k['h'] == 309 and abs(k['bodyH'] - 253.5) < 1e-9 and abs(k['headTop'] - 55.5) < 1e-9, 'numbers follow the picture scale'
    try: to_pixels({'w': 457, 'h': 618, 'headTop': 1, 'bodyH': 5}, (300, 309))
    except SystemExit: pass
    else: raise AssertionError('a picture with other proportions is refused')
    # the budget walks down and refuses; it never returns an oversized picture
    calls = []
    def enc(t, q): calls.append((t, q)); return b'x' * (t * q)
    data, tile, q = fit_budget(enc, limit=60 * 70)
    assert len(data) <= 60 * 70 and (tile, q) == (96, 40), 'the first quality that fits at the full tile'
    data, tile, q = fit_budget(enc, limit=90 * 40, tile_min=80)
    assert (tile, q) == (88, 40), 'the tile shrinks only when no quality fits'
    assert calls[0] == (TILE, QUALITIES[0]), 'starts at the full tile and best quality'
    try: fit_budget(lambda t, q: b'x' * 100000)
    except SystemExit: pass
    else: raise AssertionError('refuses when nothing fits')
    # the real sets: every one builds, fits, and two runs give the same bytes (needs Pillow)
    try: import PIL
    except ImportError: print('selftest: Pillow missing, the picture part is skipped'); return
    for sid in set_ids():
        a, info = build_group(sid); b, _ = build_group(sid)
        assert a == b, '%s: two runs give different bytes' % sid
        assert info['bytes'] <= MAX_BYTES and a[:4] == b'RIFF' and a[8:12] == b'WEBP', '%s: a WebP under the budget' % sid
    print('selftest ok')


def main(argv):
    flags = [a for a in argv if a.startswith('--')]; ids = [a for a in argv if not a.startswith('--')]
    if '--selftest' in flags: return selftest()
    bad = [f for f in flags if f not in ('--write', '--check')]
    if bad or ('--write' in flags and '--check' in flags): sys.exit(__doc__)
    ids = ids or set_ids()
    problems = []
    for sid in ids:
        if sid not in set_ids(): sys.exit('unknown set: ' + sid)
        data, info = build_group(sid)
        target = os.path.join(OUT, sid + '.webp')
        print('%-12s %2d people  %dx%d  tile %d  q %s  %5.1f KB' % (sid, info['people'], info['cols'], info['rows'], info['tile'], info['quality'], len(data) / 1024))
        if '--write' in flags:
            os.makedirs(OUT, exist_ok=True)
            with open(target, 'wb') as f: f.write(data)
        if '--check' in flags:
            if not os.path.isfile(target): problems.append(sid + ': no committed picture')
            else:
                with open(target, 'rb') as f: have = f.read()
                if len(have) > MAX_BYTES: problems.append('%s: %d bytes, over %d' % (sid, len(have), MAX_BYTES))
                if have != data: problems.append(sid + ': not what the set pictures give now (run with --write)')
    if problems: sys.exit('\n'.join(problems))


if __name__ == '__main__':
    main(sys.argv[1:])
