#!/usr/bin/env python3 -I
"""Converts a Codex-drawn "asleep, seated" picture into the Retro pixel people's `sit` frame (spec 102 FR-259, owner 2026-11-03).

  python3 -I scripts/build-arcade-sleep.py <pNN> <drawn.png> [<repo>] [--height N] [--preview out.png]
  python3 -I scripts/build-arcade-sleep.py --assets [<repo>]      write the ASSETS.md entries (the note and one `sit` line per person)

  <drawn.png>  the image-generation result: the person on a flat magenta (#FF00FF) background.
What it does (no art is invented here): keys the magenta out, crops to the figure, shrinks it to the pack's grid (a LANCZOS resize to 8 x 8
fine pixels per grid pixel, each fine pixel snapped to the nearest colour of that person's own palette, the colours of their other frames, then
each grid pixel takes the commonest colour of its 64, with the face's skin, a closed eye's line and the dark outline favoured), binary alpha, closes any gap in a dark outline
(a dark pixel outside every opaque edge pixel that is not already dark), and writes `pNN-sit.webp` (lossless, one file pixel per grid pixel) and
the pose's numbers into set.json (`poses`, `feet`, `top`, `foot`). Needs Pillow. Same input, same bytes."""
import importlib.util, io, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('pack', os.path.join(HERE, 'build-arcade-pack.py')); pack = importlib.util.module_from_spec(spec)
sys.argv, argv = sys.argv[:1], sys.argv; spec.loader.exec_module(pack); sys.argv = argv

def key_magenta(im):
    im = im.convert('RGBA'); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 128 or (r > 150 and b > 150 and g < 120 and abs(r - b) < 90): px[x, y] = (0, 0, 0, 0)
    return im

def palette_of(S, pid):
    cols = set()
    for f in os.listdir(S):
        if f.startswith(pid + '-') and f.endswith('.webp') and f != pid + '-sit.webp':
            im = Image.open(os.path.join(S, f)).convert('RGBA'); cols |= {p[:3] for p in im.getdata() if p[3]}
    return sorted(cols)

# the two people whose faceBox (crown to chin, read from the figure's width) is off: their skin tone read by eye from the standing frame's swatches
SKIN = {'p08': (186, 106, 59), 'p10': (251, 197, 154)}

def head_info(S, pid):
    """from the person's own standing `face-book` frame: the colours of the head (faceBox) and the skin colour (commonest light-enough colour of the
    cheeks below the eyes: 62 % to 80 % of the box's height, 32 % to 68 % of its width)"""
    meta = json.load(open(os.path.join(S, 'set.json'))); x, y, w, h = meta['faceBox'][pid]['box']; im = Image.open(os.path.join(S, pid + '-face-book.webp')).convert('RGBA'); px = im.load()
    head = {px[i, j][:3] for j in range(y, y + h) for i in range(x, x + w) if px[i, j][3]}
    cnt = {}
    for j in range(y + round(.62 * h), y + round(.80 * h)):                  # below the eyes: cheeks, nose, mouth (not hair, hat or glasses)
        for i in range(x + round(.32 * w), x + round(.68 * w)):
            if px[i, j][3] and sum(px[i, j][:3]) > 150: cnt[px[i, j][:3]] = cnt.get(px[i, j][:3], 0) + 1
    return sorted(head), SKIN.get(pid) or max(sorted(cnt), key=lambda c: cnt[c])

EYE = (1, 2, 3)   # stands for a closed eye's line until the block vote is done

def dist(a, b): return sum((x - y) ** 2 for x, y in zip(a, b)) ** .5

def convert(drawn, pal, height, info=None, lilac=False):
    im = key_magenta(drawn); bb = im.getbbox(); im = im.crop(bb)
    w = max(1, round(im.width * height / im.height)); F = 8; Q = F * F // 16; big = im.resize((w * F, height * F), Image.LANCZOS)   # F fine pixels per grid pixel; thresholds below are for 16 and scaled by Q
    # every fine pixel snapped to the palette first, then the commonest colour of each grid pixel's 8x8 fine block wins (crisp, no blended
    # colours); a dark outline colour wins from half the block so thin lines survive the shrink (thresholds written for 16 and scaled by Q)
    cache = {}; dark = min(pal, key=sum); headpal, skin = info if info else (None, None)
    import colorsys; hair = None
    if lilac and headpal:      # p15: the standing hair is the commonest lilac of the standing head
        li = [c for c in headpal if .68 < colorsys.rgb_to_hsv(*[v / 255 for v in c])[0] < .93 and colorsys.rgb_to_hsv(*[v / 255 for v in c])[1] > .12]
        hair = max(li, key=sum) if li else None
    # the drawn skin tone: the commonest colour of the upper part within reach of the standing skin colour; it is mapped straight to the standing skin
    gskin = None
    if skin:
        import colorsys
        hs = colorsys.rgb_to_hsv(*[v / 255 for v in skin]); sc = {}
        for y in range(big.height * 8 // 100, big.height * 52 // 100):                       # the face rows of a seated, nodding figure (not the hat above, not the clothes below)
            for x in range(0, big.width):
                q = big.getpixel((x, y))
                if q[3] < 128: continue
                h2 = colorsys.rgb_to_hsv(*[v / 255 for v in q[:3]]); dh = min(abs(h2[0] - hs[0]), 1 - abs(h2[0] - hs[0]))
                if dh < .05 and .2 < h2[1] < .85 and h2[2] > .45: sc[q[:3]] = sc.get(q[:3], 0) + 1     # skin hue, a lit face of any lightness
        # the face is the lightest of the big skin-hued clusters (hair of the same hue is darker or more saturated)
        top = max(sc.values()) if sc else 0; gskin = max(sorted(c for c in sc if sc[c] >= .25 * top), key=lambda c: (colorsys.rgb_to_hsv(*c)[2], sc[c])) if sc else None
        if os.environ.get('DBG'): print('gskin', gskin, 'ref skin', skin, len(sc))
    sm = Image.new('RGBA', (w, height)); sp = sm.load(); bp = big.load()
    for y in range(height):
        for x in range(w):
            cnt = {}; solid = 0
            for dy in range(F):
                for dx in range(F):
                    p = bp[x * F + dx, y * F + dy]
                    if p[3] >= 128:
                        solid += 1; k = p[:3]
                        head = y * 100 < height * 48
                        key = (k, head)
                        if key not in cache:
                            if gskin and head and dist(k, gskin) < 32: cache[key] = skin
                            elif hair and head and .68 < colorsys.rgb_to_hsv(*[v / 255 for v in k])[0] < .93 and colorsys.rgb_to_hsv(*[v / 255 for v in k])[1] > .12: cache[key] = hair   # a drawn lilac hair keeps the standing lilac, not a pale colour
                            elif gskin and head and 22 < dist(k, gskin) < 60 and sum(k) > sum(gskin) + 20: cache[key] = EYE      # lighter than the face and close to it: a closed eye's line
                            else: cache[key] = nearest(k, headpal if (headpal and head) else pal)
                        c = cache[key]; cnt[c] = cnt.get(c, 0) + 1
            if solid >= 8 * Q:
                best = max(sorted(cnt), key=lambda c: cnt[c])
                if skin and cnt.get(EYE, 0) >= 3 * Q and cnt.get(skin, 0) + cnt.get(EYE, 0) >= 6 * Q: best = EYE
                elif skin and cnt.get(skin, 0) >= 5 * Q:                        # a face is not eaten by its outline; a strong minority (a closed eye's line) still shows
                    best = skin
                    mino = [c for c in cnt if c != skin and cnt[c] >= 3 * Q and dist(c, skin) > 26]
                    if mino:
                        best = max(sorted(mino), key=lambda c: cnt[c])
                        if sum(best) > sum(skin) and sum(skin) > 500: best = nearest(tuple(int(v * .5) for v in skin), pal)   # a pale eye line on pale skin does not read at this size: a soft brown line
                elif sum(best) > 200 and cnt.get(dark, 0) >= 8 * Q: best = dark
                if best == EYE: best = nearest(tuple(int(v * .5) for v in skin), pal) if sum(skin) > 500 else tuple(min(255, int(v * 1.4)) for v in skin)   # a soft brown line on pale skin, a lighter line on dark skin
                sp[x, y] = best + (255,)
    return sm

def nearest(c, pal): return min(pal, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, c)))

def outline(im, pal):
    dark = min(pal, key=lambda p: sum(p)); px = im.load(); w, h = im.size
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0)); out.alpha_composite(im, (1, 1)); op = out.load(); src = out.copy().load()
    for y in range(h + 2):
        for x in range(w + 2):
            if src[x, y][3]: continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w + 2 and 0 <= ny < h + 2 and src[nx, ny][3] and sum(src[nx, ny][:3]) > 200: op[x, y] = dark + (255,); break
    return out

HINTS = {'p01': 'same face, glasses, brown hair, orange hoodie, blue jeans, shoes', 'p02': 'same face, cream bucket hat, dark curly hair, tan skin, cream top, teal trousers, brown boots',
 'p03': 'same face, black afro hair, dark skin, purple sweater, dark grey trousers, dark shoes', 'p04': 'same face, red bob hair, white blouse, blue skirt, dark tights, red shoes',
 'p05': 'same face, spiky blue hair, headband, red jacket over white shirt, black trousers, white sneakers', 'p06': 'same face, black hair in a bun, mint green sweater, dark purple-grey trousers',
 'p07': 'same face, long wavy blonde hair with a flower, pink sweater, blue jeans', 'p08': 'same face, warm medium-brown skin (never grey), grey beanie, round glasses, olive green jacket, dark trousers',
 'p09': 'same face, yellow raincoat with hood up, dark skin, navy trousers, dark boots', 'p10': 'same face, brown hair in two pigtails with red ties, teal jacket, grey shorts, white socks',
 'p11': 'same face, long black braid, mustard yellow shawl, brown trousers', 'p12': 'same face, bald with ginger beard, green apron over cream shirt, brown trousers',
 'p13': 'same face, warm medium-brown skin (never grey), silver-grey hair in a bun, teal top, white trousers', 'p14': 'same face, orange cap, brown hair, light blue shirt with a satchel bag, khaki shorts, sneakers',
 'p15': 'same face, pale lavender hair with a clear dark outline, the face skin in the same pale peach tone, round glasses drawn as dark thin lines, a warm beige knit sweater that is a shade darker than the hair with a clear dark outline, grey trousers; strong contrast between hair, face and sweater'}
PROMPT = ('Use your image generation tool to create ONE image and save it in the current folder as sit.png. Image: the same character as the reference pixel-art picture ({h}), now fast asleep while sitting on a small plain brown wooden arcade stool: '
 'whole body visible, front three-quarter view, same chibi proportions (big head), same clothes, hair and skin colours exactly as in the reference (do not make hair redder or lighter, do not darken the skin). '
 'Keep the face easy to read: the head tilted down only slightly, the face fully visible and evenly lit in the same skin tone as the reference (no dark shading, no shadow over the face), the closed eyes drawn as clear light-coloured curved lines, '
 'and the hair, hat or hood must not cover the face. Arms resting relaxed in the lap, knees bent, feet on the floor. Same chunky pixel-art style with dark outlines and flat colours, hard pixel edges, no anti-aliasing, no gradients, '
 'on a plain flat pure magenta (#FF00FF) background. No text, no logos, no letters, no z z. Do nothing else.')

def assets(repo):
    S = os.path.join(repo, 'src/renderer/realoffice/sets/retro'); ap = os.path.join(S, 'ASSETS.md'); txt = open(ap, encoding='utf8').read()
    sizes = {pid: tuple(st['poses']['sit']) for pid, st in json.load(open(os.path.join(S, 'set.json')))['stand'].items() if 'sit' in st['poses']}   # the height each frame was built at
    a = txt.index('- **Seated on a stool**'); b = txt.index('\n', a) + 1
    txt = txt[:a] + ('- **Seated on a stool** (`sit`, the asleep pose, spec 102 FR-259, owner 2026-11-03): drawn by Codex image generation (`codex exec`, one run per person, reference = the person\'s own `face-book` frame at 8x, prompt in each person\'s `sit` line), '
      'then converted by `scripts/build-arcade-sleep.py` (magenta keyed out, cropped, shrunk to the grid with a block vote, head pixels snapped to the colours of the person\'s own standing head, the drawn skin tone replaced by the standing frame\'s skin tone so a face is never shaded to a dark blob, closed-eye lines kept, outline closed, lossless WebP; it refuses a frame whose mean skin colour is more than 25 off the standing frame\'s). Replaces the code-made frame of the same day. Each person\'s own standing frame was attached as the reference image of their run (a first batch of 2026-11-03 without it was thrown away). Made by Vikram\'s agent (Claude Code), 2026-11-03; waits for the owner\'s look.\n') + txt[b:]
    for pid in sorted(HINTS):
        ref = ''
        w, h = sizes.get(pid, (0, 0))
        line = f'- sit: `{pid}-sit.webp` ({w} x {h} grid px, `--height {h}`), tool Codex image generation (`codex exec`) then `scripts/build-arcade-sleep.py`, 2026-11-03, reference `{pid}-face-book.webp` at 8x,' + ref + ' prompt: "' + PROMPT.format(h=HINTS[pid]) + '"\n'
        head = f'### set-{pid}\n'; i = txt.index(head); js = [x for x in (txt.find('\n### ', i + 1), txt.find('\n## ', i + 1)) if x >= 0]; j = min(js) if js else len(txt)
        sec = txt[i:j]; k = sec.find('\n- sit: ')
        if k >= 0: e = sec.index('\n', k + 1); sec = sec[:k + 1] + line.rstrip('\n') + sec[e:]
        else: sec = sec.rstrip('\n') + '\n' + line + '\n'
        txt = txt[:i] + sec + txt[j:]
    open(ap, 'w', encoding='utf8').write(txt)

def main():
    if '--assets' in sys.argv: return assets(([x for x in sys.argv[1:] if not x.startswith('--')] or [os.getcwd()])[0])
    a = [x for x in sys.argv[1:] if not x.startswith('--')]; height = 58; prev = None
    if '--height' in sys.argv: height = int(sys.argv[sys.argv.index('--height') + 1]); a = [x for x in a if x != str(height)]
    if '--preview' in sys.argv: prev = sys.argv[sys.argv.index('--preview') + 1]; a = [x for x in a if x != prev]
    pid, src = a[0], a[1]; repo = a[2] if len(a) > 2 else os.getcwd()
    S = os.path.join(repo, 'src/renderer/realoffice/sets/retro'); pal = palette_of(S, pid)
    info = head_info(S, pid); im = outline(convert(Image.open(src), pal, height, info, pid == 'p15'), pal); im = pack.binary_alpha(im)
    if prev: im.save(prev)                                                    # a preview is written even when the check below refuses it
    # the check: the mean colour of the skin pixels of the new frame against the standing frame's skin colour
    px = im.load(); sk = info[1]; near = [px[i, j][:3] for j in range(im.height) for i in range(im.width) if px[i, j][3] and dist(px[i, j][:3], sk) < 40]
    mean = tuple(sum(c[k] for c in near) / max(1, len(near)) for k in range(3))
    print(pid, im.size, 'skin pixels', len(near), 'mean-skin delta %.1f' % dist(mean, sk))
    if len(near) < 25 or dist(mean, sk) > 25: raise SystemExit(pid + ': the face skin is not the standing frame\'s skin tone (a dark blob?)')
    # the check runs before the pack is written: a refused frame leaves the pack as it was
    if not prev:
        pack.save(im, os.path.join(S, f'{pid}-sit.webp')); jp = os.path.join(S, 'set.json'); meta = json.load(open(jp)); st = meta['stand'][pid]
        tp, bt, fc = pack.measure(im)
        st['poses']['sit'] = [im.width, im.height]; st['feet']['sit'] = round((bt + 1) / im.height, 4); st['top']['sit'] = round(tp / im.height, 4); st['foot']['sit'] = round(fc, 4)
        with open(jp, 'w') as f: f.write(json.dumps(meta, indent=1, sort_keys=True) + '\n')

if __name__ == '__main__': main()
