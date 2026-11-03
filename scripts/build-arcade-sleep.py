#!/usr/bin/env python3 -I
"""Converts a Codex-drawn "asleep, seated" picture into the Retro pixel people's `sit` frame (spec 102 FR-259, owner 2026-11-03).

  python3 -I scripts/build-arcade-sleep.py <pNN> <drawn.png> [<repo>] [--height N] [--preview out.png]
  python3 -I scripts/build-arcade-sleep.py --assets [<repo>]      write the ASSETS.md entries (the note and one `sit` line per person)

  <drawn.png>  the image-generation result: the person on a flat magenta (#FF00FF) background.
What it does (no art is invented here): keys the magenta out, crops to the figure, shrinks it to the pack's grid (BOX average, then each pixel
snapped to the nearest colour of that person's own palette, the colours of their other frames), binary alpha, closes any gap in a dark outline
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

def convert(drawn, pal, height):
    im = key_magenta(drawn); bb = im.getbbox(); im = im.crop(bb)
    w = max(1, round(im.width * height / im.height)); big = im.resize((w * 4, height * 4), Image.LANCZOS)
    # every fine pixel snapped to the palette first, then the commonest colour of each 4x4 block wins (crisp, no blended colours); a dark
    # outline colour wins from 8 of 16 so thin lines survive the shrink
    cache = {}; dark = min(pal, key=sum)
    sm = Image.new('RGBA', (w, height)); sp = sm.load(); bp = big.load()
    for y in range(height):
        for x in range(w):
            cnt = {}; solid = 0
            for dy in range(4):
                for dx in range(4):
                    p = bp[x * 4 + dx, y * 4 + dy]
                    if p[3] >= 128:
                        solid += 1; k = p[:3]
                        if k not in cache: cache[k] = nearest(k, pal)
                        c = cache[k]; cnt[c] = cnt.get(c, 0) + 1
            if solid >= 8:
                best = max(sorted(cnt), key=lambda c: cnt[c])
                if sum(best) > 200 and cnt.get(dark, 0) >= 8: best = dark
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
 'p15': 'same face, pale lavender hair, round glasses, cream knit sweater, grey trousers'}
PROMPT = ('Use your image generation tool to create ONE image and save it in the current folder as sit.png. Image: the same character as the reference pixel-art picture ({h}), now fast asleep while sitting on a small plain brown wooden arcade stool: '
 'whole body visible, head tilted and nodding forward and down, eyes closed, arms resting relaxed in the lap, knees bent, feet on the floor, same front three-quarter view and same chibi proportions (big head), same clothes, and hair and skin colours exactly as in the reference '
 '(do not make the hair redder or lighter), same chunky pixel-art style with dark outlines and flat colours. Pixel art, hard pixel edges, no anti-aliasing, no gradients, on a plain flat pure magenta (#FF00FF) background. No text, no logos, no letters, no z z. Do nothing else.')

def assets(repo):
    S = os.path.join(repo, 'src/renderer/realoffice/sets/retro'); ap = os.path.join(S, 'ASSETS.md'); txt = open(ap, encoding='utf8').read()
    a = txt.index('- **Seated on a stool**'); b = txt.index('\n', a) + 1
    txt = txt[:a] + ('- **Seated on a stool** (`sit`, the asleep pose, spec 102 FR-259, owner 2026-11-03): drawn by Codex image generation (`codex exec`, one run per person, reference = the person\'s own `face-book` frame at 8x, prompt in each person\'s `sit` line), '
      'then converted by `scripts/build-arcade-sleep.py` (magenta keyed out, cropped, shrunk to the grid, every pixel snapped to the person\'s own palette, outline closed, lossless WebP). Replaces the code-made frame of the same day. Made by Vikram\'s agent (Claude Code), 2026-11-03; waits for the owner\'s look.\n') + txt[b:]
    for pid in sorted(HINTS):
        ref = '' if pid in ('p01', 'p02') else ' NOTE: no reference image reached this run (script error), so the person was described in words only: likeness to the standing frames is by colour and costume, not by face;'
        line = f'- sit: `{pid}-sit.webp`, tool Codex image generation (`codex exec`) then `scripts/build-arcade-sleep.py`, 2026-11-03, reference `{pid}-face-book.webp` at 8x,' + ref + ' prompt: "' + PROMPT.format(h=HINTS[pid]) + '"\n'
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
    im = outline(convert(Image.open(src), pal, height), pal); im = pack.binary_alpha(im)
    if prev: im.save(prev)
    else:
        pack.save(im, os.path.join(S, f'{pid}-sit.webp')); jp = os.path.join(S, 'set.json'); meta = json.load(open(jp)); st = meta['stand'][pid]
        tp, bt, fc = pack.measure(im)
        st['poses']['sit'] = [im.width, im.height]; st['feet']['sit'] = round((bt + 1) / im.height, 4); st['top']['sit'] = round(tp / im.height, 4); st['foot']['sit'] = round(fc, 4)
        with open(jp, 'w') as f: f.write(json.dumps(meta, indent=1, sort_keys=True) + '\n')
    print(pid, im.size)

if __name__ == '__main__': main()
