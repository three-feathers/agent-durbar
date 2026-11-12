/**
 * Theme tokens guard (spec 070 FR-040), no Electron, no credits: `npm run test:theme-tokens`.
 *  1. the typed tokens of the renderer (`theme.js`) and of main (`src/shared/themetokens.ts`) are the same lists and give the same
 *     verdict on one corpus of good, out-of-range and hostile values; the contrast pairs equal the AI maker's;
 *  2. every typed token has a default that passes its own grammar (fonts on the allow-list) and equals the `:root` value of styles.css;
 *  3. the colour literals and font-family declarations outside the token defaults are counted per renderer file and compared with the
 *     ratchet `scripts/fixtures/theme-literals.json`: more fails ("use a token"), fewer fails until the ratchet is lowered in the same
 *     change, so the count only goes down (Phase 2, FR-041).
 *  4. per-token fallbacks: a pack's unusable values are dropped one by one and counted, hostile ones refuse the pack (FR-020).
 *  5. figures and gadget slots validate (FR-010, FR-011).
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BAR_TOKENS, FONT_ALLOW, HOSTILE_RE, TYPED_TOKENS, typedValue } from '../src/shared/themetokens';
import { BAR_PAIRS, BRAND_HOVER_MIX, brandHoverTarget, mixHex, COLOUR_HUE_RE, COLOUR_NUM_RE, CONTRAST_PAIRS, NAMED_COLOURS, UI_PAIRS, BRAND_UIS, WORLD_GLASS, contrast, glassOver, luminance, parseColor, resolveColor, themeIssues } from '../src/shared/themegen';
import { ART_SLOTS, TOKEN_VALUE_MAX, checkUserManifest } from '../src/shared/themes';

const ROOT = process.cwd();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(ROOT, 'src', 'renderer', 'theme.js'));

// ---- 1. the two copies agree ----
assert.deepStrictEqual(T.TYPED_TOKENS, TYPED_TOKENS, 'theme.js and themetokens.ts register the same typed tokens');
assert.deepStrictEqual(T.FONT_ALLOW, FONT_ALLOW, 'the same font allow-list');
// spec 070 FR-053: the bar's closed list, its pairs and its glass share are one in both copies
assert.deepStrictEqual(T.BAR_TOKENS, BAR_TOKENS, 'theme.js and themetokens.ts register the same --wb-* names and defaults');
assert.deepStrictEqual(T.BAR_PAIRS, BAR_PAIRS, 'the bar pairs of WORLD_PAIRS are the shared contrast check\'s');
assert.strictEqual(T.WORLD_GLASS, WORLD_GLASS, 'the same glass share');
assert.deepStrictEqual(T.CONTRAST_PAIRS, CONTRAST_PAIRS, 'theme.js checks the same text pairs as the AI maker');
assert.strictEqual(T.BRAND_HOVER_MIX, BRAND_HOVER_MIX, 'the same hover share of --brand-mark in the primary button (issue #1614)');
assert.deepStrictEqual(T.BRAND_UIS, BRAND_UIS, 'the same UI styles that paint with --brand-bg');
// the two copies of the hover target and of the sRGB mix (issue #1614, review of PR #1618): equal on fills x texts, light, mid and dark, the dark-fill fixtures (#2a6a9a, #8a5a28 white text; #808080 black text) among them
for (const bg of ['#ffffff', '#e4ece6', '#d9c7a8', '#808080', '#8a5a28', '#2a6a9a', '#244634', '#000000']) for (const mk of ['#ffffff', '#000000', '#4f7f65', '#3f6551', '#909090', '#ffd24a', '#2a6a9a']) {
  assert.strictEqual(T._mixHex(bg, mk, 0.14).slice(0, 7), mixHex(bg, mk, 0.14), `mixHex ${bg} toward ${mk}: the same colour in theme.js and themegen`);
  assert.strictEqual(T._brandHover(mk, bg), brandHoverTarget(mk, bg), `hover target of ${mk} on ${bg}: the same in theme.js and themegen`);
}
assert.strictEqual(T._brandHover('#ffffff', '#2a6a9a'), '#000000', 'dark-fill fixture: white text on #2a6a9a hovers toward black');
assert.strictEqual(T._brandHover('#ffffff', '#8a5a28'), '#000000', 'dark-fill fixture: white text on #8a5a28 hovers toward black');
assert.strictEqual(T._brandHover('#000000', '#808080'), '#ffffff', 'dark-fill fixture: black text on #808080 hovers toward white');
assert.deepStrictEqual(T.ART_SLOTS, ART_SLOTS, 'the same art slots');
assert.strictEqual(T._HOSTILE_RE.source + '/' + T._HOSTILE_RE.flags, HOSTILE_RE.source + '/' + HOSTILE_RE.flags, 'the same hostile-value rule (FR-020)');
const corpus = [
  'Georgia', 'georgia, serif', '"Palatino Linotype", Palatino, serif', "'Segoe UI'", 'Comic Sans MS', 'Arial;}body{x', 'url(https://x/f.woff2)', '@import x',
  'Georgia, Georgia, Georgia, Georgia, Georgia, Georgia, Georgia', '', '   ', 'var(--x)', 'Arial\\,x',
  '500', '650', '800', '900', '640', 'bold', '0', '6px', '24px', '24.5px', '30px', '-2px', '1em', '12', '10px 4px',
  'none', '0 2px 8px rgba(0,0,0,.12)', 'inset 0 0 0 1px #fff', '0 1px 2px #000, 0 8px 24px rgba(40,35,25,.2)', '0 1px 2px #000, 0 2px 3px #000, 0 3px 4px #000',
  '0 99px 2px #000', '0 2px 80px #000', '0 2px red', '0 2px 4px expression(alert(1))', '0 2px 4px hsl(10deg 20% 30% / .5)', '0 2px 4px transparent',
  '<script>', '0 2px 4px #12', 'x'.repeat(170),
];
let n = 0;
for (const k of Object.keys(TYPED_TOKENS)) for (const v of corpus) {
  assert.strictEqual(T._typedValue(k, v), typedValue(k, v), `${k} = ${JSON.stringify(v).slice(0, 40)}: same verdict in renderer and main`);
  n++;
}
assert.strictEqual(typedValue('--font', 'georgia, "times new roman"'), 'Georgia,"Times New Roman",sans-serif', 'canonical names, quoted, generic appended');
assert.strictEqual(typedValue('--font-mono', 'Menlo'), 'Menlo,monospace');
assert.strictEqual(typedValue('--font', 'Comic Sans MS'), null, 'a font not on the list');
assert.strictEqual(typedValue('--font', 'url(x)'), null, 'no URL');
assert.strictEqual(typedValue('--r-md', '30px'), null, 'radius over 24px');
assert.strictEqual(typedValue('--t1-weight', '900'), null, 'weight out of range');
assert.strictEqual(typedValue('--shadow-card', '0 2px 8px rgba(0,0,0,.12)'), '0 2px 8px rgba(0,0,0,.12)');
assert.strictEqual(typedValue('--shadow-card', '0 2px 4px expression(x)'), null);
// names that live on Object.prototype are not fonts (review on #500): the allow-list is looked up by own property only
for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'Georgia, constructor']) for (const k of ['--font', '--ui-display', '--font-mono']) {
  assert.strictEqual(typedValue(k, name), null, `${k} ${JSON.stringify(name)} is not on the font list`);
  assert.strictEqual(T._typedValue(k, name), null, `and not in the renderer: ${k} ${JSON.stringify(name)}`);
}
for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
  assert.strictEqual(typedValue(k, 'Georgia'), null, `${k} is not a typed token`);
  assert.strictEqual(T._typedValue(k, 'Georgia'), null, `and not in the renderer: ${k}`);
}
for (const v of ['Arial\\', '\\41 rial', 'Georgia\\;x', '0 2px 4px #000\\']) for (const k of ['--font', '--shadow-card']) {
  assert.strictEqual(typedValue(k, v), null, `a backslash is refused: ${k} ${JSON.stringify(v)}`);
  assert.strictEqual(T._typedValue(k, v), null, `and in the renderer: ${k} ${JSON.stringify(v)}`);
}

// ---- 2. defaults ----
const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
// the :root declarations as a map (parsed, not matched with a regex built from a token name)
const rootDecls = new Map<string, string>();
for (const d of rootBlock.slice(rootBlock.indexOf('{') + 1).replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
  const i = d.indexOf(':');
  if (i > 0) rootDecls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
}
assert.strictEqual(rootDecls.get('--r-md'), '10px', 'the :root parser reads a declaration');
for (const [k, spec] of Object.entries(TYPED_TOKENS)) {
  assert.notStrictEqual(typedValue(k, spec.def), null, `${k}: its default passes its own grammar (fonts on the allow-list)`);
  const v = rootDecls.get(k);
  if (k === '--ui-display') { assert.strictEqual(v, undefined, '--ui-display has no :root value: a UI style (themes.css) or the pack sets it, else titles inherit'); continue; }
  assert.ok(v !== undefined, `${k} has a :root default in styles.css`);
  assert.strictEqual(v!.replace(/\s+/g, ''), spec.def.replace(/\s+/g, ''), `${k}: the :root default equals the registry's`);
}

// ---- 3. the literal ratchet ----
const RATCHET = path.join(ROOT, 'scripts', 'fixtures', 'theme-literals.json');
const FILES = ['styles.css', 'screens.css', 'themes.css', 'app.js', 'screens.js', 'scenekits.js', 'index.html', 'realoffice-world.css'];
function literals(file: string): { colors: number; fonts: number } {
  let src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', file), 'utf8');
  if (file.endsWith('.css')) src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  if (file === 'styles.css') { const i = src.indexOf(':root{'); src = src.slice(0, i) + src.slice(src.indexOf('}', i) + 1); } // the token defaults
  const colors = (src.match(/#[0-9a-fA-F]{3,8}\b(?![-\w])/g) || []).filter((h) => [4, 5, 7, 9].includes(h.length)).length + (src.match(/\b(?:rgba?|hsla?)\(/g) || []).length;
  const fonts = (src.match(/font-family:\s*([^;}"'`]+)/g) || []).filter((d) => !/^font-family:\s*(var\(|inherit)/.test(d)).length;
  return { colors, fonts };
}
const now: Record<string, { colors: number; fonts: number }> = Object.fromEntries(FILES.map((f) => [f, literals(f)]));
if (process.env.THEME_LITERALS_WRITE === '1') {
  fs.writeFileSync(RATCHET, JSON.stringify(now, null, 2) + '\n');
  console.log('theme-literals.json written');
}
const ratchet = JSON.parse(fs.readFileSync(RATCHET, 'utf8')) as Record<string, { colors: number; fonts: number }>;
for (const f of FILES) {
  for (const kind of ['colors', 'fonts'] as const) {
    const was = ratchet[f] ? ratchet[f][kind] : 0, is = now[f][kind];
    assert.ok(is <= was, `${f}: ${is} ${kind === 'colors' ? 'colour literals' : 'font-family declarations'}, the ratchet allows ${was}. Use a theme token (var(--name)) instead of a new literal (spec 070 FR-040).`);
    assert.ok(is >= was, `${f}: ${is} ${kind}, down from ${was}: lower the ratchet in scripts/fixtures/theme-literals.json in this change (THEME_LITERALS_WRITE=1 npm run test:theme-tokens).`);
  }
}

// ---- 4. fallbacks: unusable values are dropped one by one, hostile ones refuse the pack ----
{
  const pack = { id: 'fb', tokens: { '--bg': '#fff', '--font': 'Comic Sans MS', '--r-md': '40px', '--t1-weight': '700', '--chair': 'not a colour!', '--nope': '#fff' } };
  const c = checkUserManifest(JSON.stringify(pack));
  assert.ok(c.ok, 'a pack with only unusable values still imports');
  assert.deepStrictEqual(c.dropped!.sort(), ['--chair', '--font', '--r-md'].sort(), 'and names what is dropped (an unknown --name is kept on disk and ignored)');
  const v = T._validateManifest(pack);
  assert.deepStrictEqual(v.tokens, { '--bg': '#fff', '--t1-weight': '700' }, 'the renderer keeps only the usable values');
  assert.deepStrictEqual(v.dropped.sort(), ['--chair', '--font', '--nope', '--r-md'].sort(), 'and counts the dropped ones for the Settings note');
  // FR-020: each hostile character or function refuses the pack on its own (one case per part of HOSTILE_RE, so removing any part fails here)
  const hostile: [string, Record<string, string>][] = [
    [';', { '--font': 'Georgia; color:red' }], [';', { '--bg': '#fff;x' }], ['<', { '--bg': '<b' }], ['>', { '--bg': 'a>b' }],
    ['{', { '--bg': 'a{b' }], ['}', { '--bg': 'a}b' }], ['\\', { '--font': 'Georgia\\' }], ['@', { '--bg': '@x' }],
    ['url(', { '--bg': 'url(x)' }], ['expression(', { '--bg': 'expression(1)' }], ['var(', { '--bg': 'var(--ink)' }], ['var(', { '--shadow-card': '0 2px 4px var(--ink)' }],
  ];
  for (const [part, tokens] of hostile) {
    const r = checkUserManifest(JSON.stringify({ id: 'h', tokens }));
    assert.strictEqual(r.ok, false, `${part} alone refuses the pack: ${JSON.stringify(tokens)}`);
    for (const [k, v] of Object.entries(tokens)) assert.strictEqual(T._validateManifest({ id: 'h', tokens: { [k]: v } }).tokens[k], undefined, `and the renderer never applies ${JSON.stringify(v)}`);
  }
  // prototype names as fonts: unusable, not hostile (the pack imports, the font is dropped); the AI maker drops it with a warning
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = checkUserManifest(JSON.stringify({ id: 'p', tokens: { '--bg': '#fff', '--font': name } }));
    assert.ok(r.ok && r.dropped!.includes('--font'), `--font ${name}: the pack imports and the font is dropped`);
    assert.strictEqual(T._validateManifest({ id: 'p', tokens: { '--font': name } }).tokens['--font'], undefined, `the renderer drops --font ${name}`);
  }
  for (const bad of ['Georgia;}*{display:none', 'url(https://example.com/x.woff2)', '<b>', '@font-face']) {
    assert.strictEqual(checkUserManifest(JSON.stringify({ id: 'h', tokens: { '--font': bad } })).ok, false, `hostile ${bad} refuses the pack`);
    assert.strictEqual(T._validateManifest({ id: 'h', tokens: { '--font': bad } }).tokens['--font'], undefined, 'and the renderer never applies it');
  }
}
// contrast (FR-021, FR-023): a user pack's unreadable pair is fixed minimally on its text side; the surfaces stay; built-ins are left as designed
{
  const ratio = (x: string, y: string): number => contrast(x, y);
  const pairsPass = (id: string): string[] => {
    T.setTheme(id);
    return CONTRAST_PAIRS.filter(([fg, bg, min]) => /^#/.test(T.token(fg)) && /^#/.test(T.token(bg)) && ratio(T.token(fg), T.token(bg)) < min).map(([fg, bg]) => `${fg} on ${bg}`);
  };
  // spec 077 (review on PR 621): a built-in is NOT repaired at run time (applyTokens skips contrastFix for built-ins), so its authored tokens must meet every pair themselves:
  // Clean Office on every pair, including --desk-new on --card and --desk-needs on --card-waiting (spec 001 FR-178); Cheeky is a Characters choice on top of it since spec 077 FR-066
  for (const id of ['clean-office']) assert.deepStrictEqual(pairsPass(id), [], `built-in ${id}: its authored tokens meet every contrast pair, with no run-time repair`);
  const pack = { id: 'lowc', tokens: { '--ink': '#cccccc', '--bg': '#ffffff', '--surface': '#ffffff', '--chair': '#c2185b' } };
  T.registerUserThemes({ lowc: pack });
  T.setTheme('lowc');
  const fb = T.fallbacks('lowc');
  assert.ok(fb.contrast.includes('--ink') && !fb.contrast.includes('--bg') && !fb.contrast.includes('--surface'), `ink on bg failed: only the ink changes (${fb.contrast})`);
  assert.strictEqual(T.token('--bg'), '#ffffff', 'the surface stays the pack\'s');
  // just enough: the ink sits on several of Clean Office's light surfaces, so the darkest one (--card-waiting...) decides, at 4.5:1
  const inkOn = CONTRAST_PAIRS.filter(([fg]) => fg === '--ink').map(([, bg]) => ratio(T.token('--ink'), T.token(bg)));
  assert.ok(Math.min(...inkOn) >= 4.5 && Math.min(...inkOn) < 4.7, `the ink is darkened just enough (${T.token('--ink')}: ${inkOn.map((r) => r.toFixed(2))})`);
  assert.strictEqual(T.token('--chair'), '#c2185b', 'a value with no contrast pair is kept');
  assert.deepStrictEqual(pairsPass('lowc'), [], 'every pair passes');

  // spec 040 FR-027 (#905): a dark pack that keeps Clean Office's light room tints: the tints are repaired, never --ink/--muted/--room-path (the tooltip and cards read them on the dark surfaces)
  {
    const night = { id: 'night-tint', tokens: { '--bg': '#14171c', '--surface': '#1d2127', '--raised': '#22272e', '--card': '#1d2127', '--soft': '#20252c', '--note': '#2a2f37', '--ink': '#e8eaee', '--ink-2': '#c4c9d1', '--muted': '#9aa2ae', '--card-waiting': '#2b2618', '--card-error': '#2e1c1c' } };
    T.registerUserThemes({ 'night-tint': night });
    const fn = T.fallbacks('night-tint').contrast;
    assert.ok(['sage', 'blue', 'sand', 'clay'].every((t) => fn.includes('--tint-' + t)), `the room tints are repaired (${fn})`);
    assert.ok(!fn.includes('--ink') && !fn.includes('--muted'), `the ink and muted text are not (${fn})`);
    T.setTheme('night-tint');
    assert.strictEqual(T.token('--muted'), '#9aa2ae', 'the muted text stays');
    assert.strictEqual(T.token('--ink'), '#e8eaee', 'the ink stays light');
    for (const bg of ['--surface', '--card', '--raised']) assert.ok(ratio(T.token('--ink'), T.token(bg)) >= 4.5, `ink on ${bg} still reads`);
    assert.deepStrictEqual(pairsPass('night-tint'), [], 'every pair passes');
  }

  // the dark fixture as designed: nothing to adjust
  const DARK = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'themes', 'dark-audit.json'), 'utf8'));
  T.registerUserThemes({ 'audit-dark': DARK });
  assert.deepStrictEqual(T.fallbacks('audit-dark').contrast, [], 'the dark fixture reads as designed');
  // ... with one dim text colour and one dim button accent: it stays dark (the probe of the review on #500)
  const dim = { ...DARK, id: 'dim-dark', tokens: { ...DARK.tokens, '--muted': '#4a4a44', '--sage-ink': '#2a3a30' } };
  T.registerUserThemes({ 'dim-dark': dim });
  const fd = T.fallbacks('dim-dark');
  assert.deepStrictEqual(fd.contrast.slice().sort(), ['--muted', '--sage-ink'], `only the two failing colours change (${fd.contrast})`);
  T.setTheme('dim-dark');
  for (const k of ['--bg', '--surface', '--surface-2', '--raised', '--card', '--soft', '--note', '--ink', '--ink-2']) assert.strictEqual(T.token(k), DARK.tokens[k], `${k} stays the pack's`);
  assert.ok(luminance(T.token('--surface')) < 0.2 && luminance(T.token('--muted')) > luminance(DARK.tokens['--surface']), 'still a dark theme with light text');
  assert.ok(luminance(T.token('--sage-ink')) > luminance('#2a3a30'), 'the accent is lifted so the dark button text reads on it');
  assert.deepStrictEqual(pairsPass('dim-dark'), [], 'every pair passes');
  assert.deepStrictEqual(T.contrastCheck(dim).slice().sort(), ['--muted', '--sage-ink'], 'the AI preview sees the same adjustments (FR-024)');
  assert.deepStrictEqual(T.contrastCheck(DARK), [], 'and none for a readable theme');

  // built-ins: no fallbacks reported, and applying one leaves every pair token exactly as designed (a fix on built-ins would change Retro's ink)
  for (const t of T.list()) assert.deepStrictEqual(T.fallbacks(t.id), { dropped: [], contrast: [], unmeasured: [] }, `built-in ${t.id} uses all of its values`);
  const keys = [...new Set(CONTRAST_PAIRS.flatMap(([fg, bg]) => [fg, bg]))];
  for (const id of Object.keys(T._builtins())) {
    const own = { ...T._builtins()[T.CLEAN_ID].tokens, ...(T._builtins()[id].tokens || {}) };
    T.setTheme(id);
    assert.strictEqual(T.current().id, id);
    for (const k of keys) if (own[k] !== undefined) assert.strictEqual(T.token(k), own[k], `built-in ${id}: ${k} is applied as designed`);
  }
  T.setTheme(T.CLEAN_ID);
}
// ---- 5. figures and gadgets ----
{
  const v = T._validateManifest({ id: 'f', figures: { shirts: ['#e0218a', '#abc', 'pink', 12], hairs: ['#000000'] }, art: { 'gadget-cup': '<rect x="98" y="76" width="10" height="10" fill="#fff"/>', 'gadget-laptop': '<image href="x"/>' } });
  assert.deepStrictEqual(v.figures, { shirts: ['#e0218a', '#aabbcc'], hairs: ['#000000'] }, 'hex colours kept as #rrggbb, others dropped');
  assert.ok(v.dropped.includes('figures.shirts.2') && v.dropped.includes('figures.shirts.3'));
  assert.ok(v.art['gadget-cup'] && !v.art['gadget-laptop'], 'gadget art through the sanitizer: an <image> is refused');
  assert.ok(v.dropped.includes('art.gadget-laptop'));
  assert.strictEqual(T._validateManifest({ id: 'big', art: { 'gadget-cup': '<g>' + '<rect x="1" y="1" width="1" height="1"/>'.repeat(700) + '</g>' } }).art['gadget-cup'], undefined, 'a slot over 24,000 characters is dropped');
}

// ---- 6. spec 097 FR-100, FR-113: a Real office world's token set (owner 2026-10-31 10:46: the top bar and menus follow the world) ----
{
  assert.deepStrictEqual(T.WORLD_IDS, ['photo', 'retro', 'cave'], 'the photo office, the arcade and the cave (the arcade and the cave are behind their flags)');
  const t = T.worldTokens('photo') as Record<string, string>;
  assert.strictEqual(T.worldTokens('loft'), null, 'a world that is not built has no set');
  assert.strictEqual(T.worldTokens('__proto__'), null, 'own keys only');
  // complete: every Clean Office colour token has a value, so contrast never depends on the user's theme
  for (const k of Object.keys(T._builtins()[T.CLEAN_ID].tokens).concat(Object.keys(T._tokens()))) assert.ok(t[k] !== undefined, `the world set has ${k}`);
  // the world's own values are hex colours (the colour grammar), and status colours keep their meaning (070 FR-050): unchanged
  const clean = T._tokens() as Record<string, string>;
  for (const k of Object.keys(clean).filter((x) => /^--(c|pb|pc|halo)-|^--(amber|red|green|blue)(-ink)?$|^--desk-(new|needs)$/.test(x))) assert.strictEqual(t[k], clean[k], `status colour ${k} is unchanged`);
  // 070 D4 on the resolved set: every CONTRAST_PAIR, the world's own pairs (glass composited over the worst backdrop) and themegen's UI_PAIRS
  const rows = T.worldContrast('photo') as Array<{ fg: string; bg: string; min: number; ratio: number }>;
  assert.ok(rows.length >= CONTRAST_PAIRS.length + 15, 'the world pairs are checked too: ' + rows.length);
  // a glass pair is measured on the fill as it shows: the token mixed WORLD_GLASS with its worst backdrop (computed here on its own)
  const mixG = (a: string, over: string): string => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * T.WORLD_GLASS + parseInt(over.slice(i, i + 2), 16) * (1 - T.WORLD_GLASS)).toString(16).padStart(2, '0')).join('');
  const glass = rows.filter((r) => / \(glass over #[0-9a-f]{6}\)$/.test(r.bg));
  assert.ok(glass.length >= 15, 'the glass pairs are composited: ' + glass.length);
  for (const r of glass) {
    const [, bgk, over] = /^(\S+) \(glass over (#[0-9a-f]{6})\)$/.exec(r.bg) as RegExpExecArray;
    const want = contrast(t[r.fg], mixG(t[bgk], over));
    assert.ok(Math.abs(r.ratio - want) < 0.01, `${r.fg} on ${r.bg}: ${r.ratio.toFixed(3)} is the composited ratio ${want.toFixed(3)}`);
  }
  const bad = rows.filter((r) => !(r.ratio >= r.min));
  assert.deepStrictEqual(bad.map((r) => `${r.fg} on ${r.bg} ${r.ratio.toFixed(2)}:1 < ${r.min}`), [], 'every pair of the photo world passes WCAG AA');
  // spec 070 FR-080: every colour form is measured (the page is --bg over white, a translucent surface over it, text over its surface), as theme.js does
  const pg = resolveColor(t['--bg']) as string;
  const px = (k: string, over?: string): string => resolveColor(t[k], k === '--bg' ? '#ffffff' : over ?? pg) as string;
  const hex = (v: string): boolean => resolveColor(v) !== null;
  for (const [fg, bg, min] of CONTRAST_PAIRS) { assert.ok(hex(t[fg]) && hex(t[bg]), `${fg} and ${bg} are measurable colours`); const b = px(bg); assert.ok(contrast(px(fg, b), b) >= min, `${fg} on ${bg}: themegen agrees`); }
  for (const [fg, bg, min, why] of UI_PAIRS) assert.ok(contrast(t[fg], t[bg]) >= min, `${fg} on ${bg} (${why}): ${contrast(t[fg], t[bg]).toFixed(2)}:1`);
  // the hovered primary fill (issue #1614) is left out: the Photo office's chrome is ui clean (#1144), which never paints a primary button with --brand-bg (its hover is measured by check-052-primary-btn)
  for (const ui of ['clean', ...BRAND_UIS]) assert.deepStrictEqual(themeIssues(t, clean, ui).filter((x) => !/the top bar|on the hovered --brand-bg/.test(x)), [], `no contrast issue with ui ${ui}`);
  const worst = Math.min(...rows.map((r) => r.ratio / r.min));
  // spec 102 FR-263 (owner, 2026-11-03): the arcade is dark everywhere. Complete; every status hue unchanged; the three status -ink shades
  // lightened in the same hue (070 FR-050, amended for dark worlds); every pair AA, panels' glass composited over white
  {
    const r = T.worldTokens('retro') as Record<string, string>, rr = T.worldContrast('retro') as Array<{ fg: string; bg: string; min: number; ratio: number }>;
    for (const k of Object.keys(T._builtins()[T.CLEAN_ID].tokens).concat(Object.keys(T._tokens()))) assert.ok(r[k] !== undefined, `retro has ${k}`);
    const INKS = ['--red-ink', '--amber-ink', '--blue-ink'];
    // spec 102 RA6 (2026-11-07): the status fills `--pb-*` and their inks `--pc-*` are dark/light shades of the same hue too, or a `.note` card (permission,
    // question, limit) is cream with the page's light ink (#1279). Every other status colour is unchanged.
    const FILLS = ['working', 'thinking', 'waiting', 'idle', 'error', 'done'].flatMap((s) => [`--pb-${s}`, `--pc-${s}`]);
    for (const k of Object.keys(clean).filter((x) => /^--(c|pb|pc|halo)-|^--(amber|red|green|blue)(-ink)?$|^--desk-(new|needs)$/.test(x) && !INKS.includes(x) && !FILLS.includes(x))) assert.strictEqual(r[k], clean[k], `retro: status colour ${k} is unchanged`);
    const hue = (h: string): number => { const [R, G, B] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255), mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn; if (!d) return 0; const x = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; return (x * 60 + 360) % 360; };
    for (const k of INKS) { assert.ok(luminance(r[k]) > luminance(clean[k]), `retro: ${k} is lighter`); const dh = Math.abs(hue(r[k]) - hue(clean[k])); assert.ok(Math.min(dh, 360 - dh) <= 12, `retro: ${k} keeps its hue (${dh.toFixed(1)} degrees)`); }
    for (const s of ['working', 'thinking', 'waiting', 'idle', 'error', 'done']) {
      assert.ok(luminance(r[`--pb-${s}`]) < 0.05, `retro: --pb-${s} is a dark fill (${r[`--pb-${s}`]})`);
      assert.ok(luminance(r[`--pc-${s}`]) > luminance(r[`--pb-${s}`]), `retro: --pc-${s} is lighter than its fill`);
      if (s !== 'idle') for (const k of [`--pb-${s}`, `--pc-${s}`]) { const dh = Math.abs(hue(r[k]) - hue(clean[k])); assert.ok(Math.min(dh, 360 - dh) <= 12, `retro: ${k} keeps its hue (${dh.toFixed(1)} degrees)`); }
    }
    // the card's ink on its fill, measured here on its own: a permission, question or limit card is .note (ink-2 on pb-waiting), an error card .note.err (red-ink on pb-error)
    for (const [fg, bg] of [['--ink-2', '--pb-waiting'], ['--ink', '--pb-waiting'], ['--ink-2', '--pb-error'], ['--amber-ink', '--pb-waiting'], ['--red-ink', '--pb-error'], ['--pc-working', '--pb-working'], ['--pc-thinking', '--pb-thinking'], ['--pc-waiting', '--pb-waiting'], ['--pc-idle', '--pb-idle'], ['--pc-error', '--pb-error'], ['--pc-done', '--pb-done'], ['--red-ink', '--bad-bg'], ['--ink-2', '--bad-bg'], ['--ink', '--bad-bg']]) {
      assert.ok(contrast(r[fg], r[bg]) >= 4.5, `retro: ${fg} on ${bg}: ${contrast(r[fg], r[bg]).toFixed(2)}:1 is under 4.5:1`);
      assert.ok(rr.some((x) => x.fg === fg && x.bg === bg && x.min === 4.5), `retro: worldContrast checks ${fg} on ${bg}`);
    }
    // review of #1283: no pale Clean Office `-bg` fill is left under the arcade's light ink (`--bad-bg` was: the limit chip at 1.77:1). Every `-bg` token of the arcade that is a
    // plain colour is dark, bar and brand fills apart (own pairs); the drop overlay (`--drop-bg`, light `--drop-ink`) is a pair of its own. Not text fills: `--walker-bg` (an avatar disc), `--done-bg` (a tick disc)
    for (const k of Object.keys(r).filter((x) => /-bg$/.test(x) && !/^--(wb|wp)-|^--(brand|walker|done)-bg$/.test(x))) assert.ok(/^#[0-9a-f]{6}$/i.test(r[k]) && luminance(r[k]) < 0.05, `retro: ${k} is a dark fill (${r[k]})`);
    assert.ok(contrast(r['--brand-bg'], r['--wb-bg-2']) >= 4.5, `retro: the marquee name (--brand-bg on --wb-bg-2) ${contrast(r['--brand-bg'], r['--wb-bg-2']).toFixed(2)}:1`);
    assert.ok(contrast(r['--drop-ink'], r['--drop-bg']) >= 4.5, `retro: --drop-ink on --drop-bg ${contrast(r['--drop-ink'], r['--drop-bg']).toFixed(2)}:1`);
    assert.ok(luminance(r['--surface']) < 0.05 && luminance(r['--bg']) < 0.05 && luminance(r['--card']) < 0.05 && luminance(r['--wb-bg']) < 0.05, 'retro: page, cards and bar are dark');
    assert.deepStrictEqual(rr.filter((x) => !(x.ratio >= x.min)).map((x) => `${x.fg} on ${x.bg} ${x.ratio.toFixed(2)}:1 < ${x.min}`), [], 'every pair of the arcade passes WCAG AA');
    assert.ok(rr.some((x) => / \(glass over #ffffff\)$/.test(x.bg) && x.fg === '--ink'), 'a dark panel is checked over white');
    // spec 070 FR-081 (#1278): the info tone (file chips, ask tags, selected rows) is measured in every world, and the arcade sets its own: derived from the light working pair it was 2.16:1
    for (const [fg, bg, min] of [['--tone-info-ink', '--tone-info-soft', 4.5], ['--tone-info-ink', '--tone-info-faint', 4.5], ['--tone-info-ink', '--tone-info-hover', 4.5], ['--ink', '--tone-info-soft', 4.5], ['--ink-2', '--tone-info-soft', 4.5],
      ['--tone-ok-ink', '--tone-ok-soft', 4.5], ['--tone-ok-ink', '--tone-ok-faint', 4.5], ['--tone-ok-ink', '--tone-ok-hover', 4.5], // image chips (#1278 follow-up)
      // #1309 review: every other tone pair the CSS paints, measured in every world (.fl-focus, .sub-st.done, .mtag.extra, .hs-ok; .mtag.warn, .imp-block, .scr-warn, .quick; .dlg .derr, .note.limit, .chip.fail, .btn.danger:hover; .mtag.src; .scr-note.ok, .srv-org, .fl-err on the page)
      ['--tone-ok-ink', '--tone-ok-bg', 4.5], ['--tone-warn-ink', '--tone-warn-bg', 4.5], ['--tone-warn-ink', '--tone-warn-faint', 4.5], ['--tone-warn-ink', '--tone-warn-soft', 4.5], ['--tone-warn-ink', '--tone-warn-hover', 4.5],
      ['--tone-bad-ink', '--tone-bad-bg', 4.5], ['--tone-bad-ink', '--tone-bad-soft', 4.5], ['--tone-idea-ink', '--tone-idea-bg', 4.5],
      ['--tone-ok-ink', '--surface', 4.5], ['--tone-warn-ink', '--surface', 4.5], ['--tone-bad-ink', '--surface', 4.5],
    ] as Array<[string, string, number]>) {
      assert.ok(rr.some((x) => x.fg === fg && x.bg === bg && x.min === min), `the arcade checks ${fg} on ${bg}`);
      for (const w of T.WORLD_IDS) assert.ok((T.worldContrast(w) as typeof rr).some((x) => x.fg === fg && x.bg === bg && x.ratio >= min), `${w}: ${fg} on ${bg} reaches ${min}:1`);
    }
    // the chip's 1px border is its edge in the dark world (non-text, WCAG 1.4.11: 3:1) against the panel and its own fills; the light worlds keep the app's quiet 1.5:1 hairline, the fill and the text carry the chip there
    const ti0 = T.toneInfo(r) as Record<string, string>;
    for (const n of ['info', 'ok', 'warn', 'bad', 'idea']) for (const against of ['--surface', `--tone-${n}-bg`, `--tone-${n}-soft`, `--tone-${n}-faint`]) assert.ok(contrast(ti0[`--tone-${n}-line`], ti0[against] ?? r[against]) >= 3, `the arcade's ${n} border on ${against} is ${contrast(ti0[`--tone-${n}-line`], ti0[against] ?? r[against]).toFixed(2)}:1`);
    for (const n of ['info', 'ok', 'warn', 'bad', 'idea']) for (const k of ['ink', 'bg', 'soft', 'faint', 'hover', 'line']) assert.ok(/^#[0-9a-f]{6}$/i.test(r[`--tone-${n}-${k}`]), `the arcade sets --tone-${n}-${k} as hex`);
    // every painted fill is dark and every ink light (the .fl-focus and .sub-st.done bug of #1309: light ink on the light --pb-done)
    for (const n of ['info', 'ok', 'warn', 'bad', 'idea']) { for (const k of ['bg', 'soft', 'faint', 'hover']) assert.ok(luminance(r[`--tone-${n}-${k}`]) < 0.1, `the arcade's --tone-${n}-${k} is dark`); assert.ok(luminance(r[`--tone-${n}-ink`]) > 0.3, `the arcade's --tone-${n}-ink is light`); }
    assert.ok(contrast(r['--tone-info-ink'], r['--tone-info-soft']) >= 4.5 && luminance(r['--tone-info-soft']) < 0.05, 'the arcade .att chip: light blue ink on a dark soft fill');
    assert.deepStrictEqual(['--pb-working', '--pc-working'].map((k) => r[k]), ['#142534', '#9dcdf1'], 'the working status pair is spec 102 RA6\'s dark pair (#1283); the tone fix does not touch it');
    // the same pair as the CSS derives it, for each built-in theme (Retro Pixel included): ink is --pc-working, soft is 55% --pb-working over --surface
    for (const [id, b] of Object.entries(T._builtins() as Record<string, { tokens: Record<string, string> }>)) {
      const ti = T.toneInfo({ ...clean, ...b.tokens }) as Record<string, string>;
      for (const n of ['info', 'ok', 'warn', 'bad', 'idea']) {
        for (const bgk of ['bg', 'soft', 'faint', 'hover']) assert.ok(contrast(ti[`--tone-${n}-ink`], ti[`--tone-${n}-${bgk}`]) >= 4.5, `built-in ${id}: --tone-${n}-ink on ${bgk} is ${contrast(ti[`--tone-${n}-ink`], ti[`--tone-${n}-${bgk}`]).toFixed(2)}:1`);
        if (n === 'info' || n === 'ok') for (const bgk of ['soft', 'faint']) assert.ok(contrast(ti[`--tone-${n}-line`], ti[`--tone-${n}-${bgk}`]) >= 1.5, `built-in ${id}: the ${n} border is visible on ${bgk}`);
      }
    }
    const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
    // every tone of :root derives the way toneInfo() models it (ink, bg, soft, faint, line, hover): a changed line fails here, not in the picture
    for (const [n, st] of [['info', 'working'], ['ok', 'done'], ['warn', 'waiting'], ['bad', 'error'], ['idea', 'thinking']]) {
      const row = css.split('\n').find((l) => l.trimStart().startsWith(`--tone-${n}-bg:`)) || '';
      assert.strictEqual(row.trim().replace(/\s+/g, ' '), `--tone-${n}-bg:var(--pb-${st}); --tone-${n}-ink:var(--pc-${st}); --tone-${n}-soft:color-mix(in srgb,var(--pb-${st}) 55%,var(--surface)); --tone-${n}-faint:color-mix(in srgb,var(--pb-${st}) 28%,var(--surface)); --tone-${n}-line:color-mix(in srgb,var(--pc-${st}) 26%,var(--pb-${st})); --tone-${n}-hover:color-mix(in srgb,var(--pb-${st}) 88%,var(--pc-${st}));`, `styles.css derives the ${n} tone the way toneInfo() models it`);
    }
  }
  // the cave's set: complete, status colours unchanged, every pair AA with the glass composited (the same checks as the photo set)
  {
    const c = T.worldTokens('cave') as Record<string, string>, cr = T.worldContrast('cave') as Array<{ fg: string; bg: string; min: number; ratio: number }>;
    for (const k of Object.keys(T._builtins()[T.CLEAN_ID].tokens).concat(Object.keys(T._tokens()))) assert.ok(c[k] !== undefined, `the cave set has ${k}`);
    for (const k of Object.keys(clean).filter((x) => /^--(c|pb|pc|halo)-|^--(amber|red|green|blue)(-ink)?$|^--desk-(new|needs)$/.test(x))) assert.strictEqual(c[k], clean[k], `cave: status colour ${k} is unchanged`);
    assert.deepStrictEqual(cr.filter((r) => !(r.ratio >= r.min)).map((r) => `${r.fg} on ${r.bg} ${r.ratio.toFixed(2)}:1 < ${r.min}`), [], 'every pair of the cave world passes WCAG AA');
    for (const [fg, bg, min] of CONTRAST_PAIRS) { assert.ok(hex(c[fg]) && hex(c[bg]), `cave: ${fg} and ${bg} are measurable`); const cp = resolveColor(c['--bg']) as string, b = resolveColor(c[bg], bg === '--bg' ? '#ffffff' : cp) as string; assert.ok(contrast(resolveColor(c[fg], b) as string, b) >= min, `cave: ${fg} on ${bg}: themegen agrees`); }
    for (const [fg, bg, min, why] of UI_PAIRS) assert.ok(contrast(c[fg], c[bg]) >= min, `cave: ${fg} on ${bg} (${why})`);
  }
  console.log(`photo world: ${rows.length} pairs + ${UI_PAIRS.length} UI pairs pass; tightest margin ${worst.toFixed(2)}x its minimum`);
  // the CSS: the world rules are tokens only, the glass share equals WORLD_GLASS, forced colours win, reduced transparency is opaque
  const block = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice-world.css'), 'utf8');
  assert.ok(block.length > 500, 'the world rules are in realoffice-world.css');
  assert.ok(!fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8').includes('realoffice-world.css'), 'flat mode does not load the world rules (FR-061)');
  assert.strictEqual((block.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) || []).length, 0, 'no colour literal in the world rules');
  assert.ok(new RegExp(`var\\(--surface\\) ${Math.round(T.WORLD_GLASS * 100)}%,transparent`).test(block) && new RegExp(`var\\(--wb-bg\\) ${Math.round(T.WORLD_GLASS * 100)}%,transparent`).test(block), 'the glass share in the CSS is WORLD_GLASS');
  assert.ok(/@media \(forced-colors:active\)\{[^@]*\.topbar\{background:Canvas;color:CanvasText/.test(block), 'forced colours: system colours on the bar');
  assert.ok(/@media \(prefers-reduced-transparency:reduce\),\(prefers-contrast:more\)\{[^@]*backdrop-filter:none/.test(block), 'reduced transparency: opaque panels');
  for (const [k, v] of T.WORLD_BAR_MAP as Array<[string, string]>) {
    assert.ok(block.includes(`${k}:var(${v})`), `the bar re-scopes ${k} to ${v}`);
    assert.ok(block.includes(`${k}:var(--wp-${k.slice(2)})`), `the bar's menu gets ${k} back`);
    assert.strictEqual(t['--wp-' + k.slice(2)], t[k], `--wp-${k.slice(2)} is the page value`);
    assert.ok(t[v], `${v} is in the set`);
  }
  assert.ok(!/(?:font|font-size|padding|margin|width|height|gap|line-height)\s*:/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), 'no font, size or spacing in the world rules (070 D2)');
}
// ---- 6b. spec 097 FR-180: what world CSS may animate, and nothing blends  ----
function worldCssProblems(cssIn: string): string[] {
  const css = cssIn.replace(/\/\*[\s\S]*?\*\//g, ''), out: string[] = [];
  if (/mix-blend-mode\s*:/.test(css)) out.push('mix-blend-mode: nothing blends (FR-180)');
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const d of m[2].matchAll(/([a-z-]+)\s*:/g)) if (!['transform', 'opacity', 'animation-timing-function'].includes(d[1])) out.push(`@keyframes ${m[1]} animates ${d[1]}: only transform and opacity (FR-180)`);
  }
  for (const m of css.matchAll(/(?:^|[;{\s])transition(?:-property)?\s*:\s*([^;}]+)/g)) {
    for (const part of m[1].replace(/\([^)]*\)/g, '').split(',')) { const name = part.trim().split(/\s+/)[0]; if (!['transform', 'opacity', 'none'].includes(name)) out.push(`transition names ${name}: only transform and opacity (FR-180)`); }
  }
  /* FR-181: a light moves in steps; FR-180, T151: the lights have no box-shadow to repaint */
  /* (the people's loops keep to the 1/12 s grid, checked by `check-097-motion`, spec 097 FR-229; the lights are stepped here) */
  for (const r of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) if (/\.ro-(glow|call|lamp|fxl)\b/.test(r[1])) for (const m of r[2].matchAll(/(?:^|[;{\s])animation\s*:\s*([^;}]+)/g)) if (!/steps\(\d+|step-(?:start|end)/.test(m[1]) && !/^none\b/.test(m[1].trim())) out.push(`animation "${m[1].trim()}" is not stepped (FR-181)`);
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) if (/\.ro-(glow|call|lamp|fxl)\b/.test(m[1]) && /box-shadow\s*:(?!\s*none)/.test(m[2])) out.push(`${m[1].trim()} has a box-shadow: a light is a static gradient (T151)`);
  /* FR-182: a blur only on the allow list, whatever the media query; `none` turns it off */
  const ALLOW = new Set(['.toast', '.more-menu', '.mode-menu', '.grants-pop', '.ct-more-pop', '#defaultsPop', '#foldersPop', '#floorsPop']);
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!/(?:^|[;\s])(?:-webkit-)?backdrop-filter\s*:(?!\s*none)/.test(m[2])) continue;
    const sel = m[1].replace(/html\[data-world\]\s*/g, '').trim();
    const inner = /^:is\((.*)\)$/.exec(sel);
    for (const one of (inner ? inner[1] : sel).split(',').map((x) => x.trim())) if (!ALLOW.has(one)) out.push(`backdrop-filter on ${one}: not on FR-182's allow list`);
  }
  if (/will-change\s*:/.test(css)) out.push('will-change: only on an element that animates now, and none does today (FR-180)');
  return out;
}
{
  /* FR-182 holds in every style sheet of the app, not only a world's */
  for (const f of fs.readdirSync(path.join(ROOT, 'src', 'renderer')).filter((x) => x.endsWith('.css'))) assert.deepStrictEqual(worldCssProblems(fs.readFileSync(path.join(ROOT, 'src', 'renderer', f), 'utf8')).filter((p) => /backdrop-filter/.test(p)), [], `${f}: FR-182`);
  for (const f of ['realoffice.css', 'realoffice-world.css']) assert.deepStrictEqual(worldCssProblems(fs.readFileSync(path.join(ROOT, 'src', 'renderer', f), 'utf8')), [], `${f}: FR-180`);
  const red = (css: string, why: RegExp, what: string): void => assert.ok(worldCssProblems(css).some((p) => why.test(p)), 'red: ' + what);
  red('.a{mix-blend-mode:screen}', /mix-blend-mode/, 'a blend mode');
  red('@keyframes k{50%{box-shadow:0 0 1px red}}', /animates box-shadow/, 'a keyframe with box-shadow');
  red('@keyframes k{0%{opacity:0}50%{filter:blur(1px)}}', /animates filter/, 'a keyframe with filter');
  red('.a{transition:width 1s}', /transition names width/, 'a transition of a layout property');
  red('.a{transition:opacity 1s,top 1s}', /transition names top/, 'the second name of a transition');
  red('.a{transition:all 1s}', /transition names all/, 'transition: all');
  red('.a{will-change:transform}', /will-change/, 'will-change');
  red('html[data-world] :is(.toast,.dlg){backdrop-filter:blur(2px)}', /on \.dlg/, 'a blur on .dlg');
  red('.scr-panel{-webkit-backdrop-filter:blur(2px)}', /on \.scr-panel/, 'a blur on a large panel');
  assert.deepStrictEqual(worldCssProblems('html[data-world] .toast{backdrop-filter:blur(2px)}.dlg{backdrop-filter:none}@media (forced-colors:active){.dlg{backdrop-filter:none}}'), [], 'a listed blur, and turning it off, pass');
  red('.ro-glow.a{animation:k 2s ease-in-out infinite}', /not stepped/, 'a smooth light');
  red('.ro-glow.x{opacity:1;box-shadow:0 0 1px red}', /box-shadow/, 'a light with a box-shadow');
  assert.deepStrictEqual(worldCssProblems('/* mix-blend-mode:screen */ .a{transition:opacity 1s;background:red}@keyframes k{50%{opacity:.5;transform:scale(2)}}'), [], 'the allowed forms pass');
  assert.deepStrictEqual(worldCssProblems('.a{animation:k 2s steps(4,end) infinite;box-shadow:0 0 1px red}.ro-call.b{animation:none}.m-a{animation:k 1s linear infinite}'), [], 'a stepped animation, none, a shadow on something that is not a light, and a person\'s loop (the 1/12 s grid is check-097-motion\'s) pass');
}
// ---- 7. applied while Real office is shown, the user's theme restored on leaving (on a stub page) ----
{
  const mkDoc = (): { documentElement: { style: { m: Map<string, string>; setProperty: (k: string, v: string) => void; removeProperty: (k: string) => void }; dataset: Record<string, string> } } => {
    const m = new Map<string, string>();
    return { documentElement: { style: { m, setProperty: (k: string, v: string) => { m.set(k, String(v)); }, removeProperty: (k: string) => { m.delete(k); } }, dataset: {} } };
  };
  const g = global as unknown as { document?: unknown };
  const fresh = (): { T: typeof T; doc: ReturnType<typeof mkDoc> } => {
    const doc = mkDoc(); g.document = doc;
    const file = require.resolve(path.join(ROOT, 'src', 'renderer', 'theme.js'));
    delete require.cache[file];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const X = require(file);
    return { T: X, doc };
  };
  const snap = (d: ReturnType<typeof mkDoc>): string => JSON.stringify([[...d.documentElement.style.m.entries()].sort(), Object.keys(d.documentElement.dataset).sort().map((k) => [k, d.documentElement.dataset[k]])]);
  const ids = (T.list() as Array<{ id: string }>).map((x) => x.id);
  const dark = ids.find((id) => { const tk = T._builtins()[id].tokens || {}; return tk['--surface'] && luminance(tk['--surface']) < 0.2; }) || ids[1];
  const other = ids.find((id) => id !== dark && id !== T.CLEAN_ID) || T.CLEAN_ID;
  // the reference: a page that only ever had the theme
  const ref = fresh(); ref.T.setTheme(dark); const want = snap(ref.doc);
  const ref2 = fresh(); ref2.T.setTheme(other); const want2 = snap(ref2.doc);
  const { T: W, doc } = fresh();
  W.setTheme(dark);
  assert.strictEqual(W.world(), null, 'flat by default: no world');
  assert.strictEqual(snap(doc), want, 'no world: the theme alone');
  assert.strictEqual(W.setWorld('photo'), 'photo');
  const st = doc.documentElement.style.m, wt = W.worldTokens('photo');
  for (const k of ['--surface', '--ink', '--bg', '--sage-ink', '--focus', '--wb-bg', '--wb-ink', '--wp-surface']) assert.strictEqual(st.get(k), wt[k], `world shown: ${k} is the world's`);
  assert.strictEqual(doc.documentElement.dataset.world, 'photo', 'html[data-world] is set');
  assert.ok(!('dark' in doc.documentElement.dataset), 'the world page is light');
  assert.strictEqual(W.token('--surface'), wt['--surface'], 'token() reads the world (scenes draw what the CSS shows)');
  assert.ok(/46,32,18/.test(String(st.get('--shadow-pop'))), 'the world shadow');
  W.setTheme(other);
  assert.strictEqual(st.get('--surface'), wt['--surface'], 'a theme picked while Real office is shown does not replace the world');
  assert.strictEqual(W.setWorld(null), null);
  assert.strictEqual(snap(doc), want2, 'leaving Real office restores the user\'s theme exactly (the one picked meanwhile)');
  W.setWorld('photo'); W.setWorld('photo');
  W.setWorld('nope');
  assert.strictEqual(W.world(), null, 'an unknown world is flat');
  assert.strictEqual(snap(doc), want2, 'and restores the theme');
  // dark theme again, round trip twice
  W.setTheme(dark); W.setWorld('photo'); W.setWorld(null); W.setWorld('photo'); W.setWorld(null);
  assert.strictEqual(snap(doc), want, 'round trips leave the theme exactly as it was');
  // the arcade: its own chrome style and a dark page while shown; leaving gives the theme back, its UI style and darkness too
  W.setTheme(other); const want3 = snap(doc);
  W.setWorld('retro');
  assert.deepStrictEqual([doc.documentElement.dataset.ui, 'dark' in doc.documentElement.dataset, st.get('--surface')], ['retro', true, W.worldTokens('retro')['--surface']], 'the arcade shown');
  W.setWorld(null);
  assert.strictEqual(snap(doc), want3, 'leaving the arcade restores the theme exactly');
  // #1309 review: the arcade's own keys (--tone-*) do not stay on the page when Real office goes from the arcade straight to another world
  W.setTheme(other); const want5 = snap(doc);
  W.setWorld('retro'); assert.strictEqual(st.get('--tone-ok-bg'), W.worldTokens('retro')['--tone-ok-bg'], 'the arcade sets its ok fill');
  for (const w of ['photo', 'cave']) {
    W.setWorld('retro'); W.setWorld(w);
    assert.deepStrictEqual([...st.keys()].filter((k) => /^--tone-/.test(k)), [], `retro to ${w}: no arcade tone key is left on the page`);
    assert.strictEqual(doc.documentElement.dataset.world, w, `${w} is shown`);
  }
  W.setWorld(null);
  assert.strictEqual(snap(doc), want5, 'and leaving restores the theme exactly');
  // #1144 (spec 097 FR-245): the photo office and the cave set their own plain chrome, so Retro Pixel's offset button shadows never reach them
  W.setTheme('retro'); const want4 = snap(doc);
  assert.strictEqual(doc.documentElement.dataset.ui, 'retro', 'Retro Pixel sets its UI style');
  W.setWorld('photo');
  assert.strictEqual(doc.documentElement.dataset.ui, 'clean', 'the photo office sets the plain UI style over the Retro theme');
  W.setWorld(null);
  assert.strictEqual(snap(doc), want4, 'leaving the photo office restores the theme exactly');
  W.setWorld('cave');
  assert.strictEqual(doc.documentElement.dataset.ui, 'clean', 'the cave sets the plain UI style over the Retro theme');
  W.setWorld(null);
  assert.strictEqual(snap(doc), want4, 'leaving the cave restores the theme exactly');
  // spec 097 FR-350 (issue #1153, superseded by worlds, owner 2026-11-08): a world keeps its own colours whatever theme is picked, measured on
  // the page's applied style map for every built-in theme and a dark user pack over every world: every key the world sets (any colour form),
  // its shadows, UI style and dark flag are the world's, status colours are Clean Office's, the applied colour pairs pass, and leaving
  // restores the theme exactly in both orders.
  {
    const fx = (n: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'themes', n), 'utf8'));
    const packs = ['dark-audit.json'].map(fx);
    const nrm = (v: unknown): string => String(v === undefined ? '' : v).replace(/\s/g, '').toLowerCase();
    const mapOf = (d: ReturnType<typeof mkDoc>): Map<string, string> => new Map(d.documentElement.style.m);
    const cleanRef = fresh(); cleanRef.T.setTheme(cleanRef.T.CLEAN_ID); const clean = mapOf(cleanRef.doc);
    const WANT: Record<string, { ui: string; dark: boolean; shadow: RegExp }> = {
      photo: { ui: 'clean', dark: false, shadow: /46,\s*32,\s*18/ }, cave: { ui: 'clean', dark: false, shadow: /40,\s*22,\s*10/ }, retro: { ui: 'retro', dark: true, shadow: /rgba\(0,\s*0,\s*0/ },
    };
    assert.deepStrictEqual([...(T.WORLD_IDS as string[])].sort(), Object.keys(WANT).sort(), 'every world has an expectation here');
    const picks: Array<string | Record<string, unknown>> = [...ids, ...packs];
    let measured = 0;
    const wShadow: Record<string, Record<string, string>> = {}; // the first pick is Clean Office, which sets no shadow of its own
    for (const wid of T.WORLD_IDS as string[]) {
      const wt = T.worldTokens(wid) as Record<string, string>;
      assert.ok(Object.keys(wt).length > 100, `${wid}: the world sets a complete token set`);
      // worldContrast reads no theme: once per world (section 6 has the numbers)
      for (const r of T.worldContrast(wid) as Array<{ fg: string; bg: string; min: number; ratio: number }>) assert.ok(r.ratio >= r.min, `${wid}: ${r.fg} on ${r.bg} is ${r.ratio.toFixed(2)}:1, needs ${r.min}`);
      for (const pick of picks) {
        const pid = typeof pick === 'string' ? pick : String(pick.id), label = `${wid} over ${pid}`;
        const { T: V, doc: d2 } = fresh();
        V.setTheme(pick);
        assert.strictEqual(V.current().id, pid, `${label}: the theme was applied (not Clean Office after a refusal)`);
        const before = mapOf(d2), alone = snap(d2);
        if (typeof pick !== 'string') {
          const tk = pick.tokens as Record<string, string>;
          const own = Object.keys(tk).filter((k) => /^#[0-9a-f]{6}$/i.test(tk[k]) && nrm(tk[k]) !== nrm(clean.get(k)))[0];
          assert.ok(own, `${label}: the pack has a colour of its own`);
          assert.strictEqual(nrm(before.get(own)), nrm(tk[own]), `${label}: the pack's ${own} is applied before the world`);
        }
        V.setWorld(wid);
        const m = mapOf(d2), ds = d2.documentElement.dataset;
        // every key the world sets, whatever its colour form
        for (const k of Object.keys(wt)) assert.strictEqual(nrm(m.get(k)), nrm(wt[k]), `${label}: ${k} is the world's, the theme does not reach it`);
        // status colours: Clean Office's, in every world (070 FR-050), not the theme's own (Retro Pixel's differ in the flat office)
        for (const k of [...clean.keys()].filter((x) => /^--(c|halo)-(working|thinking|waiting|idle|error|done)$/.test(x))) assert.strictEqual(nrm(m.get(k)), nrm(clean.get(k)), `${label}: ${k} is Clean Office's status colour`);
        if (pid === 'retro') assert.notStrictEqual(nrm(before.get('--c-working')), nrm(m.get('--c-working')), 'Retro Pixel\'s own status colour does not show in a world (measured, FR-350)');
        // shadows, UI style, dark flag
        for (const k of ['--shadow-card', '--shadow-pop']) { assert.ok(WANT[wid].shadow.test(String(m.get(k))), `${label}: ${k} is the world's (${m.get(k)})`); if (!wShadow[wid]) wShadow[wid] = {}; if (!wShadow[wid][k]) wShadow[wid][k] = nrm(m.get(k)); assert.strictEqual(nrm(m.get(k)), wShadow[wid][k], `${label}: ${k} equals the world's value under the first theme (a theme's shadow does not reach it)`); }
        assert.strictEqual(ds.world, wid, `${label}: data-world`);
        assert.strictEqual(ds.ui, WANT[wid].ui, `${label}: the world's own UI style`);
        assert.strictEqual('dark' in ds, WANT[wid].dark, `${label}: the dark flag is the world's`);
        // contrast of what the page now holds (the applied style map, per theme and world), for every hex pair of 070 D4 on the world's own values
        for (const [fg, bg, min] of CONTRAST_PAIRS as Array<[string, string, number]>) {
          const a = m.get(fg), b = m.get(bg);
          if (/^#[0-9a-f]{6}$/i.test(String(a)) && /^#[0-9a-f]{6}$/i.test(String(b))) { assert.ok(contrast(String(a), String(b)) >= min, `${label}: ${fg} on ${bg} (${contrast(String(a), String(b)).toFixed(2)}:1, needs ${min}) as applied`); measured++; }
        }
        // leaving gives the theme back exactly; the other order (world first, theme picked meanwhile) also ends on the reference page
        V.setWorld(null);
        assert.strictEqual(snap(d2), alone, `${label}: leaving the world restores the theme exactly`);
        const { T: U, doc: d3 } = fresh(); U.setWorld(wid); U.setTheme(pick);
        for (const k of Object.keys(wt)) assert.strictEqual(nrm(d3.documentElement.style.m.get(k)), nrm(wt[k]), `${label}: ${k} stays the world's when the theme is picked meanwhile`);
        U.setWorld(null); assert.strictEqual(snap(d3), alone, `${label}: world first, then the theme, then leaving: the theme alone`);
      }
    }
    // FR-351 one source: the arcade's drop overlay fill is world.css's rule or a --drop-bg token in its set, never both (a dead source)
    {
      const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds', 'retro', 'world.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const rule = /html\[data-world="retro"\]\s*\.drop-ov\s*\{[^}]*background/.test(css);
      const token = nrm((T.worldTokens('retro') as Record<string, string>)['--drop-bg']) !== nrm(cleanRef.T.worldTokens('photo')['--drop-bg']);
      assert.ok(!(rule && token), 'the arcade sets --drop-bg in WORLD_SETS.retro and world.css still has the .drop-ov rule: delete the rule (one source, FR-351)');
      assert.ok(rule || token, 'the arcade\'s drop overlay has a fill of its own: the world.css rule or a --drop-bg in WORLD_SETS.retro (FR-351)');
    }
    assert.ok(measured > 3 * 3 * 7, `the applied-style contrast ran (${measured} pairs)`);
  }
  g.document = undefined;
}
console.log(`theme tokens guard passed (${n} corpus checks, ${FILES.length} files under the ratchet)`);

// ---- 7. the toggle switch (.swt, spec 033 delta 2026-11-01): contrast per world, tokens only ----
{
  const scr = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.css'), 'utf8');
  const rule = (sel: string): string => { const at = ('\n' + scr).indexOf('\n' + sel + '{'); assert.ok(at >= 0, `${sel} rule exists`); const from = at + sel.length + 1; return scr.slice(from, scr.indexOf('}', from)); }; // plain string search: no selector is turned into a pattern
  for (const sel of ['.swt', '.swt i', '.swt.on', '.swt.on i']) assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rule(sel)), `${sel}: no colour literal, tokens only`);
  assert.ok(/background:var\(--switch-on\)/.test(rule('.swt.on')) && /background:var\(--surface\)/.test(rule('.swt.on i')) && /background:var\(--ink-2\)/.test(rule('.swt i')), 'the on track is --switch-on, the knobs --surface (on) and --ink-2 (off)');
  assert.ok(/@media \(forced-colors:active\)\{[^@]*\.swt\.on\{background:Highlight/.test(scr), 'forced colours: on and off still differ');
  const mixHex = (a: string, pct: number, b: string): string => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * pct + parseInt(b.slice(i, i + 2), 16) * (1 - pct)).toString(16).padStart(2, '0')).join('');
  const sets: Array<[string, Record<string, string>]> = [['Clean Office', { ...T._tokens(), ...T._builtins()[T.CLEAN_ID].tokens }], ['Photo office', T.worldTokens('photo')]];
  for (const [name, tk] of sets) {
    const track = mixHex(tk['--ink'], 0.16, tk['--surface']); // --tone-neutral-track
    const rows: Array<[string, string, string]> = [['on track on the page', tk['--sage-ink'], tk['--surface']], ['on knob on the on track', tk['--surface'], tk['--sage-ink']], ['off knob on the off track', tk['--ink-2'], track]];
    for (const [what, a, b] of rows) assert.ok(contrast(a, b) >= 3, `${name}: ${what} ${contrast(a, b).toFixed(2)}:1 is under 3:1`);
  }
  { // 070 T024 (FR-051): tier 3 for the switch and the primary button; the chain ends in --sage-ink, so the on track follows the world
  const root = css.slice(css.indexOf(':root{'), css.indexOf('\n}', css.indexOf(':root{')));
  const declIn = (src: string, n: string): string => { const all = [...src.matchAll(new RegExp('(?:^|[\\s;])' + n + ':([^;]+);', 'g'))]; assert.ok(all.length > 0, `${n} declared in :root`); return all[all.length - 1][1]; }; // CSS applies the last declaration, so the last one is read
  const decl = (n: string): string => declIn(root, n);
  assert.equal(declIn(':root{--accent:var(--sage-ink);--accent:var(--blue-ink);}', '--accent'), 'var(--blue-ink)', 'mutant: a later duplicate --accent wins, as in CSS');
  assert.equal(decl('--accent'), 'var(--sage-ink)');
  const scr2 = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.css'), 'utf8');
  // the aliases sit on the consuming selectors (not :root), so each resolves per element and follows a scope that re-sets --surface or --ink
  for (const n of ['--btn-primary-bg', '--btn-primary-ink', '--switch-on', '--switch-off']) assert.ok(!new RegExp('(?:^|[\\s;])' + n + ':').test(root), `${n} is not declared in :root (a :root alias resolves there and misses a scope's --surface or --ink)`);
  assert.ok(/\.btn\.primary\{--btn-primary-bg:var\(--accent\);--btn-primary-ink:var\(--surface\);/.test(css), '.btn.primary sets its own aliases: bg from --accent, ink from --surface, resolved on the element');
  assert.ok(/\.swt\{--switch-on:var\(--accent\);--switch-off:var\(--tone-neutral-track\);/.test(scr2), '.swt sets its own aliases, resolved on the element');
  assert.ok(/\.swt\{[^}]*background:var\(--switch-off\)/.test(scr2), '.swt off track reads --switch-off');
  assert.ok(/\.btn\.primary\{[^}]*background:var\(--btn-primary-bg\)[^}]*color:var\(--btn-primary-ink\)/.test(css), '.btn.primary reads the tier 3 names');
  assert.ok(/\.att\.plan-chip\{border-color:var\(--accent\);background:color-mix\(in srgb,var\(--accent\) 12%,var\(--surface\)\);color:var\(--ink\)\}/.test(css), 'the plan chip reads the world: accent edge, tinted page colour, page ink (no fixed green, no info tone: 2.9:1 in the arcade)');
  assert.ok(!/\.swt\.on\{[^}]*sage-ink/.test(scr2) && !/\.btn\.primary[^{]*\{[^}]*sage-ink/.test(css), 'no direct --sage-ink in the switch or the primary button');
}
console.log('toggle switch: on track, both knobs pass 3:1 in Clean Office and the photo world; tokens only; forced colours');
}

// ---- 070 T023 (FR-052, FR-053): `--wb-*` are on the registry; a pack sets the bar, a failing pair is repaired, a tier 3 name is refused ----
{
  const names = Object.keys(BAR_TOKENS);
  assert.strictEqual(names.length, 13, 'the bar list');
  assert.ok(names.every((k) => /^--wb-[a-z0-9-]+$/.test(k) && /^#[0-9a-f]{6}$/.test(BAR_TOKENS[k])), 'wb names, opaque hex defaults');
  assert.ok(names.every((k) => !(k in T._tokens()) && !(k in TYPED_TOKENS)), 'in no other list: the bar list is its own');
  assert.ok(BAR_PAIRS.length >= 14 && BAR_PAIRS.every(([a, b]) => a in BAR_TOKENS && b in BAR_TOKENS), 'every bar pair names the list');
  // Flat's default bar passes its own pairs (the glass fill as it shows)
  for (const [fg, bg, min, over] of BAR_PAIRS) assert.ok(contrast(BAR_TOKENS[fg], glassOver(BAR_TOKENS[bg], over)) >= min, `default ${fg} on ${bg}`);
  // a pack with the bar: 0 dropped on both sides (before T023 on main both names were dropped: measured 2026-11-07)
  const dark = { '--wb-bg': '#1c1f24', '--wb-bg-2': '#14161a', '--wb-surface': '#262a31', '--wb-surface-2': '#2e333b', '--wb-ink': '#f1f3f6', '--wb-ink-2': '#d3d8df', '--wb-muted': '#b4bcc7',
    '--wb-line': '#3a404a', '--wb-line-2': '#4a515d', '--wb-line-ctl': '#8e98a6', '--wb-focus': '#ffd36b', '--wb-warn-bg': '#4a3510', '--wb-warn-ink': '#ffd9a0' };
  const v = T._validateManifest({ id: 'barpack', name: 'Bar pack', tokens: dark });
  assert.deepStrictEqual(v.dropped, [], 'a pack with all 13 bar names drops none');
  assert.deepStrictEqual(v.tokens, dark, 'and keeps them');
  assert.deepStrictEqual(themeIssues(dark, T._tokens()), [], 'the shared check: no issue for a good bar');
  assert.ok(checkUserManifest(JSON.stringify({ id: 'barpack', name: 'x', tokens: dark })).ok, 'main accepts the same manifest');
  // hostile or unusable bar values: dropped one by one, as other colours
  const bad = T._validateManifest({ id: 'badbar', name: 'x', tokens: { '--wb-bg': 'url(x)', '--wb-ink': '#102030' } });
  assert.deepStrictEqual(bad.dropped, ['--wb-bg'], 'a hostile bar value is dropped by name');
  // tier 3 names (FR-051) are no pack's: dropped, never reach the page
  for (const k of ['--btn-primary-bg', '--switch-on', '--pop-shadow', '--overlay', '--h-ctl', '--wp-bg', '--wb-bar-shadow']) {
    const r = T._validateManifest({ id: 't3', name: 'x', tokens: { [k]: '#102030' } });
    assert.deepStrictEqual([r.dropped, r.tokens], [[k], {}], `${k} is refused`);
  }
  // a failing pair is repaired on its non-surface side: light ink on the default light bar
  const weak = { id: 'weakbar', name: 'Weak bar', tokens: { '--wb-ink': '#cfcfcf', '--wb-bg': '#fafafa' } };
  assert.ok(themeIssues(weak.tokens, T._tokens()).some((i) => i.startsWith('--wb-ink ')), 'the shared check reports it');
  T.registerUserThemes({ weakbar: weak });
  const fixed = T.fallbacks('weakbar').contrast as string[];
  assert.ok(fixed.includes('--wb-ink') && !fixed.includes('--wb-bg'), `only the ink changes (${fixed})`);
  T.setTheme('weakbar');
  assert.strictEqual(T.token('--wb-bg'), '#fafafa', 'the surface stays the pack\'s');
  for (const [fg, bg, min, over] of BAR_PAIRS) {
    const a = T.token(fg) ?? BAR_TOKENS[fg], b = T.token(bg) ?? BAR_TOKENS[bg];
    assert.ok(contrast(a, glassOver(b, over)) >= min, `repaired: ${fg} on ${bg}`);
  }
  T.setTheme(T.CLEAN_ID);
  // a dark bar: the glass is measured as it shows (0.9 of the colour over white), not as the bare colour (review of #1252)
  const dk = { ...dark, '--wb-bg': '#202020', '--wb-ink': '#707070' };
  assert.ok(contrast('#707070', glassOver('#202020', '#ffffff')) < 4.5, 'the dark pair fails on the glass');
  assert.ok(contrast('#878787', '#202020') >= 4.5 && contrast('#878787', glassOver('#202020', '#ffffff')) < 4.5, 'and a repair that ignored the glass (#878787) would pass bare and still fail on it');
  assert.ok(themeIssues(dk, T._tokens()).some((i) => i.startsWith('--wb-ink (#707070) on --wb-bg') && i.includes("bar's glass")), 'the shared check reports the dark pair on the glass');
  assert.ok(themeIssues({ ...dk, '--wb-ink': '#878787' }, T._tokens()).some((i) => i.startsWith('--wb-ink (#878787) on --wb-bg')), 'a pair that passes bare (#878787 on #202020) but fails on the glass is reported');
  T.registerUserThemes({ darkbar: { id: 'darkbar', name: 'Dark bar', tokens: dk } });
  assert.ok((T.fallbacks('darkbar').contrast as string[]).includes('--wb-ink'), 'the ink of a dark bar is repaired');
  T.setTheme('darkbar');
  assert.strictEqual(T.token('--wb-bg'), '#202020', 'the dark surface stays the pack\'s');
  for (const [fg, bg, min, over] of BAR_PAIRS) {
    const a = T.token(fg) ?? BAR_TOKENS[fg], b = T.token(bg) ?? BAR_TOKENS[bg];
    assert.ok(contrast(a, glassOver(b, over)) >= min, `dark bar repaired on the glass: ${fg} (${a}) on ${bg} (${b}) is ${contrast(a, glassOver(b, over)).toFixed(2)}:1, needs ${min}:1`);
  }
  T.setTheme(T.CLEAN_ID);
  // switching from a theme with bar tokens to one without leaves no stale inline --wb-* (removeProperty)
  {
    const m = new Map<string, string>();
    const g = global as unknown as { document?: unknown };
    g.document = { documentElement: { style: { setProperty: (k: string, v: string) => { m.set(k, String(v)); }, removeProperty: (k: string) => { m.delete(k); } }, dataset: {} } };
    try {
      const file = require.resolve(path.join(ROOT, 'src', 'renderer', 'theme.js'));
      delete require.cache[file];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const X = require(file);
      X.registerUserThemes({ withbar: { id: 'withbar', name: 'With bar', tokens: dark }, nobar: { id: 'nobar', name: 'No bar', tokens: { '--bg': '#ffffff' } } });
      X.setTheme('withbar');
      assert.ok([...m.keys()].some((k) => k.startsWith('--wb-')), 'a theme with bar tokens sets them inline');
      X.setTheme('nobar');
      assert.deepStrictEqual([...m.keys()].filter((k) => k.startsWith('--wb-')), [], 'switching to a theme without a bar leaves no --wb-* behind');
    } finally { g.document = undefined; delete require.cache[require.resolve(path.join(ROOT, 'src', 'renderer', 'theme.js'))]; }
  }
  console.log('bar tokens: 13 names in both copies, 0 dropped from a pack, a failing pair repaired, tier 3 names refused');
}

// ---- 070 T022 (FR-054): the size ratchet, `scripts/inventory.js --check`, inside this test; no second lint ----
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const inv = require(path.join(ROOT, 'scripts', 'inventory.js')) as { inventory(dir: string, repo?: string): { chrome: Record<string, number>; office: Record<string, number>; buttonSets: string[] }; compare(a: unknown, b: unknown): string[]; KINDS: string[]; BASELINE: string };
  const base = JSON.parse(fs.readFileSync(inv.BASELINE, 'utf8'));
  const real = inv.inventory(path.join(ROOT, 'src', 'renderer'), ROOT);
  assert.deepStrictEqual(inv.compare(real, base), [], 'the renderer equals scripts/fixtures/ui-inventory.json (lower it with node scripts/inventory.js --update, never raise it)');
  assert.ok(real.chrome['font-size'] > 100 && real.buttonSets.length > 50 && real.office.shadow > 0, 'the counts are real, chrome and office apart');
  // planted literals, one of each kind, in a scratch renderer: each fails by its own name; a clean copy passes; a lowered count fails until the baseline is lowered
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'inv-'));
  try {
    const rd = path.join(dir, 'src', 'renderer'); fs.mkdirSync(rd, { recursive: true });
    const css = (extra: string): string => `.a{font-size:var(--t3-size);padding:var(--s-2)}\n${extra}\n`;
    const html = (cls: string): string => `<button class="${cls}">x</button>`;
    const run = (extra: string, cls = 'btn'): Array<string> => {
      fs.writeFileSync(path.join(rd, 's.css'), css(extra)); fs.writeFileSync(path.join(rd, 'a.js'), html(cls));
      return inv.compare(inv.inventory(rd, dir), start);
    };
    fs.writeFileSync(path.join(rd, 's.css'), css('')); fs.writeFileSync(path.join(rd, 'a.js'), html('btn'));
    const start = inv.inventory(rd, dir);
    assert.deepStrictEqual(run(''), [], 'a clean scratch renderer equals its own baseline');
    const planted: Array<[string, string, RegExp]> = [
      ['font-size', '.b{font-size:13px}', /chrome font-size: 1 is over the baseline 0/], ['line-height', '.b{line-height:20px}', /chrome line-height: 1 is over/], ['font-weight', '.b{font-weight:700}', /chrome font-weight: 1 is over/],
      ['spacing', '.b{padding:5px 7px}', /chrome spacing: 2 is over/], ['radius', '.b{border-radius:5px}', /chrome radius: 1 is over/], ['shadow', '.b{box-shadow:0 1px 2px #000}', /chrome shadow: 1 is over/],
      ['office rule', '#stage .b{font-size:13px}', /office font-size: 1 is over/],
      ['font shorthand', '.b{font:700 13px/20px Georgia}', /chrome font-size: 1 is over/], ['font shorthand weight', '.b{font:700 13px/20px Georgia}', /chrome font-weight: 1 is over/], ['font shorthand line-height', '.b{font:13px/20px Georgia}', /chrome line-height: 1 is over/],
      ['rem size', '.b{font-size:0.8rem}', /chrome font-size: 1 is over/], ['em line-height', '.b{line-height:1.2em}', /chrome line-height: 1 is over/], ['logical padding', '.b{padding-inline-start:7px}', /chrome spacing: 1 is over/],
      ['text-shadow', '.b{text-shadow:0 1px 2px #000}', /chrome shadow: 1 is over/], ['drop-shadow', '.b{filter:drop-shadow(0 1px 2px #000)}', /chrome shadow: 1 is over/], ['uppercase unit', '.b{font-size:13PX}', /chrome font-size: 1 is over/],
      ['logical margin', '.b{margin-block:4px 6px}', /chrome spacing: 2 is over/], ['inset', '.b{inset:4px}', /chrome spacing: 1 is over/], ['logical radius', '.b{border-start-start-radius:5px}', /chrome radius: 1 is over/],
    ];
    for (const [what, extra, re] of planted) assert.ok(run(extra).some((m) => re.test(m)), `a planted ${what} literal fails`);
    assert.deepStrictEqual(run('.b{font-size:var(--t3-size);border-radius:var(--r-sm);box-shadow:var(--shadow-card);padding:var(--s-2);border-radius:999px}'), [], 'tokens, the pill and the scale cost nothing');
    assert.ok(run('', 'btn novel').some((m) => /new button class set "btn novel"/.test(m)), 'a new button class set fails');
    // under the baseline fails until lowered: a baseline that holds one more literal than the code
    const high = JSON.parse(JSON.stringify(start)); high.chrome['font-size'] += 1;
    assert.ok(inv.compare(start, high).some((m) => /under the baseline/.test(m)), 'a lower count fails until the baseline is lowered');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`size ratchet: ${inv.KINDS.length} kinds, chrome and office apart, ${real.buttonSets.length} button class sets; a planted literal of each kind fails`);
}

{ // spec 070 A14 (T034, T036, T038, T044; FR-061, FR-066, FR-067, FR-075): Flat's modern look is behind html[data-flat-look] and only Flat matches
  const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
  const flat = (k: string) => (root.match(new RegExp(`--flat-${k}:\\s*(#[0-9a-f]{6})`)) || [])[1] as string;
  const GATE = 'html[data-flat-look]:not([data-ui]):not([data-world])';
  const block = css.slice(css.indexOf(GATE + '{'));
  assert.ok(block.length > 0 && css.split('data-flat-look').length > 1, 'the flat-look block exists');
  // the gate: every rule naming the flag also excludes another pack and a world (a mutant that drops either is caught here)
  for (const m of css.matchAll(/([^{}]*data-flat-look[^{}]*)\{/g)) assert.ok(/:not\(\[data-ui\]\):not\(\[data-world\]\)/.test(m[1]), `flag rule is gated to Flat: ${m[1].trim().slice(0, 60)}`);
  // the flat section (from the first flag rule to the end of the file) holds nothing but gated rules: an unscoped `.btn{height:24px}` next to them would change every world
  const sectRules = [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  assert.ok(sectRules.length >= 2, 'the flat section has its rules');
  for (const m of sectRules) assert.ok(m[1].trim().startsWith(GATE), `flat section: every selector starts with the gate, not "${m[1].trim().slice(0, 60)}"`);
  assert.strictEqual(block.replace(/[^{}]/g, '').replace(/\{\}/g, '').length, 0, 'flat section: no nested or unbalanced blocks (an @media would hide an ungated rule)');
  // flag off: the edited-in-place rules resolve (through :root) to main's values, so a token swap such as .inbox radius var(--r-md) fails
  const screens = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const offCss = css.slice(0, css.indexOf(GATE + '{')) + '\n' + screens;
  const rootDecl = (n: string): string => { const all = [...root.matchAll(new RegExp(`${n}:\\s*([^;}]+)`, 'g'))]; assert.ok(all.length > 0, `:root declares ${n}`); return all[all.length - 1][1].trim(); };
  const resolve = (v: string): string => v.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(rootDecl(n)));
  const offVal = (sel: string, prop: string): string => {
    let found = ''; const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of offCss.matchAll(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^{}]*)\\}`, 'g'))) { const d = m[1].match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`)); if (d) found = d[1].trim(); }
    return resolve(found);
  };
  for (const [sel, prop, want] of [
    ['.inbox', 'border-radius', '14px'], ['.inbox', 'padding', '6px'], ['.ib', 'width', '34px'], ['.ib', 'height', '34px'], ['.ib', 'border-radius', '10px'],
    ['.composer', 'padding', '8px max(16px,calc((100% - 880px)/2))'], ['.ptab', 'height', '30px'], ['.ptab', 'padding', '0 12px'], ['.btn', 'height', '32px'], ['.btn', 'padding', '0 14px'], ['.btn', 'border-radius', '10px'],
    ['.btn', 'font-size', '13px'], ['.btn', 'font-weight', '550'], ['.btn.sm', 'height', '28px'], ['.ph .btn', 'height', '28px'], ['.notice-strip .btn', 'height', '28px'], ['.ctoolbar', '--h-chip', '28px'],
  ] as Array<[string, string, string]>) assert.strictEqual(offVal(sel, prop), want, `flag off: ${sel} ${prop} is main's ${want}`);
  // off by default: the :root values, which every other world and pack read, are today's
  for (const [k, v] of [['--h-ctl', '32px'], ['--r-md', '10px'], ['--btn-pad', '14px'], ['--btn-fw', '550'], ['--ib-size', '34px'], ['--ptab-h', '30px'], ['--btn-sm-h', '28px'], ['--composer-pad', '8px']]) assert.ok(new RegExp(`${k}:\\s*${v}\\b`).test(root), `${k} keeps ${v} in :root`);
  // FR-075 sizes in the block: 24 px controls, 12 px text at weight 500, 8 px padding, radii 3/4/6/8; nothing under 24
  for (const re of [/--h-ctl:\s*24px/, /--btn-pad:\s*8px/, /--btn-fs:\s*var\(--t4-size\)/, /--btn-fw:\s*500/, /--ib-size:\s*24px/, /--r-sm:\s*3px;\s*--r-md:\s*4px;\s*--r-lg:\s*6px;\s*--r-xl:\s*8px/]) assert.ok(re.test(block), `flat-look sets ${re}`);
  for (const m of block.matchAll(/--(?:h-ctl|h-chip|ib-size|ptab-h|ct-h|btn-sm-h):\s*(\d+)px/g)) assert.ok(Number(m[1]) >= 24, `no control token under 24px in the flat block (${m[0]})`);
  // FR-067: the contrast pairs of FR-061 (4.5:1 for text, 3:1 for the control edge)
  const page = flat('page'), page2 = flat('page-2'), acc = flat('accent'), hov = flat('accent-hover'), ctl = flat('line-ctl');
  const ink = '#2c3733', ink2 = '#56605b', muted = '#535a55';
  for (const [fg, bg, min, what] of [[ink, page, 4.5, 'ink on page'], [ink2, page, 4.5, 'ink-2 on page'], [muted, page, 4.5, 'muted on page'], [ink, page2, 4.5, 'ink on surface-2'], [ink2, page2, 4.5, 'ink-2 on surface-2'], [muted, page2, 4.5, 'muted on surface-2'], [page, acc, 4.5, 'primary text on accent'], [page, hov, 4.5, 'primary text on hover'], [ctl, page, 3, 'control edge on page'], [ctl, page2, 3, 'control edge on surface-2']] as Array<[string, string, number, string]>) assert.ok(contrast(fg, bg) >= min, `flat look: ${what} ${contrast(fg, bg).toFixed(2)} < ${min}`);
  console.log('flat look: gated to Flat, off values kept in :root, 24 px floor, FR-061 pairs pass');
}

// ---- spec 070 FR-080 (#1259): the renderer measures and repairs every colour form; it reports what it cannot measure ----
{
  // theme.js parses exactly as themegen.ts does, on every form and every name
  const forms = ['#fff', '#f008', '#1b2230', '#ff000080', 'rgb(255, 0, 0)', 'rgb(233 241 248 / .93)', 'rgb(100% 0% 0% / 50%)', 'rgba(0,0,255,.5)', 'hsl(120deg 100% 25%)', 'hsla(240 100% 50% / .25)', 'white', 'RebeccaPurple', 'transparent',
    'currentColor', 'inherit', 'none', 'hsl(1turn 50% 50%)', 'rgb(.5-50+9)', 'rgb(.5.5.5)', 'rgb(1 2)', '#12345', 'nope', '', ...Object.keys(T.NAMED_COLOURS)];
  for (const f of forms) assert.deepStrictEqual(T.parseColor(f), parseColor(f), `theme.js and themegen.ts parse ${JSON.stringify(f)} alike`);
  assert.deepStrictEqual(T.NAMED_COLOURS, NAMED_COLOURS, 'the same named colours');
  for (const [over, f] of [['#ffffff', 'rgba(0,0,0,.5)'], ['#101010', 'rgb(255 255 255 / .2)'], ['#00ff00', '#ff000000'], ['#ffffff', 'currentColor']]) assert.strictEqual(T.colorHex(f, over), resolveColor(f, over), `colorHex ${f}`);

  // a user pack that writes a failing pair as rgb() is repaired like its hex twin, and a passing one is left as written
  const packs: Record<string, unknown> = {};
  const mk = (id: string, ink: string): void => { packs[id] = { id, tokens: { '--ink': ink, '--bg': 'rgb(255 255 255)', '--surface': 'white', '--raised': 'hsl(0 0% 100%)' } }; T.registerUserThemes(packs); };
  mk('rgb-low', 'rgb(204, 204, 204)'); mk('hex-low', '#cccccc'); mk('rgb-ok', 'rgb(20 20 20)');
  const fixed = T.fallbacks('rgb-low').contrast as string[];
  assert.ok(fixed.includes('--ink') && !fixed.includes('--bg'), `an rgb() ink that fails is repaired, the surface is not (${fixed})`);
  assert.deepStrictEqual(T.fallbacks('rgb-low').contrast, T.fallbacks('hex-low').contrast, 'rgb() and hex give the same repair');
  T.setTheme('rgb-low');
  assert.ok(Math.min(...CONTRAST_PAIRS.filter(([fg]) => fg === '--ink').map(([, bg]) => contrast(T.token('--ink'), resolveColor(T.token(bg)) as string))) >= 4.5, 'the repaired rgb() ink reads at 4.5:1');
  assert.deepStrictEqual(T.fallbacks('rgb-ok').contrast, [], 'a readable rgb() pair is not touched');
  assert.deepStrictEqual(T.fallbacks('rgb-ok').unmeasured, [], 'and nothing is unmeasured');
  // a translucent text colour is measured over its surface (black at 15% is far under 4.5:1)
  mk('alpha-low', 'rgba(0,0,0,.15)');
  assert.ok((T.fallbacks('alpha-low').contrast as string[]).includes('--ink'), 'translucent ink is repaired');
  // what cannot be measured is listed, not skipped silently, and not "repaired"
  mk('keyword', 'currentColor');
  const fk = T.fallbacks('keyword');
  assert.deepStrictEqual(fk.unmeasured, ['--ink'], 'currentColor in a pair is reported as unmeasured');
  assert.ok(!fk.contrast.includes('--ink'), 'and left as written');
  // built-ins report nothing (designed by hand)
  console.log('theme colour forms: measured, repaired or reported');
}

// ---- review of #1307 (FR-030): the findings, one test each ----
{
  const doc = { documentElement: { style: { setProperty() { /* */ }, removeProperty() { /* */ } }, dataset: {} as Record<string, string> } };
  (global as unknown as { document?: unknown }).document = doc;
  const file = require.resolve(path.join(ROOT, 'src', 'renderer', 'theme.js'));
  delete require.cache[file];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require(file) as typeof T;
  const CL = R._tokens() as Record<string, string>;
  const reg = (id: string, tokens: Record<string, string>): void => { R.registerUserThemes({ [id]: { id, tokens } }); };
  const issuesOf = (tokens: Record<string, string>): string[] => themeIssues(tokens, CL);
  // 1. a name that is an Object.prototype member is not a colour, in both parsers (it used to throw in themegen.ts)
  for (const n of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.strictEqual(parseColor(n), null, n); assert.deepStrictEqual(R.parseColor(n), null, n);
    assert.ok(issuesOf({ '--ink': n }).some((i) => i.startsWith(`--ink (${n}) is in a contrast pair`)), `${n} is reported unmeasured, not thrown`);
  }
  // 4. the two CSS grammars are not mixed; both parsers refuse the same malformed forms and read the same good ones
  const grammar = ['rgb(0 0 0 0)', 'rgb(0,,0,0)', 'rgb(0, 0 0)', 'rgb(0 0, 0)', 'rgb(0,0,0 / .5)', 'rgb(0 0 0 / )', 'rgb(0,0,0,)', 'rgb(0 0 0 / .5 / .5)', 'hsl(0 100% 50% 50%)', 'rgb(0 0 0/.5)', 'rgb( 0 , 0 , 0 )', 'rgb(0 0 0 / 50%)', 'hsl(0,100%,50%,.5)', 'rgb(1,2,3,.5)'];
  for (const g of grammar) assert.deepStrictEqual(R.parseColor(g), parseColor(g), `parsers agree on ${g}`);
  for (const bad of grammar.slice(0, 9)) assert.strictEqual(parseColor(bad), null, `${bad} is not a colour`);
  for (const good of grammar.slice(9)) assert.notStrictEqual(parseColor(good), null, `${good} is a colour`);
  // review of #1307, finding 1: forms Chromium rejects (mixed number and percent in the comma syntax, a number ending in a dot) are refused by both
  // parsers alike; mixing in the space syntax is valid CSS and read alike
  const chromium = ['rgb(72.549%, 199, 194)', 'rgb(50%, 100, 0)', 'rgba(10, 20%, 30, .5)', 'rgb(185. 199. 194.)', 'rgb(1. 2 3)', 'hsl(0 0% 100% / 1.)', 'hsl(1. 50% 50%)', 'rgb(0 0 0 / .5.)',
    'rgb(72.549% 199 194)', 'rgb(50% 100 0 / 50%)', 'rgb(10%, 20%, 30%, .5)', 'rgb(1, 2, 3, 50%)', 'rgb(.5 1.5 +2)'];
  for (const g of chromium) assert.deepStrictEqual(R.parseColor(g), parseColor(g), `parsers agree on ${g}`);
  for (const bad of chromium.slice(0, 8)) assert.strictEqual(R.parseColor(bad), null, `theme.js: ${bad} is not a colour`);
  for (const good of chromium.slice(8)) assert.notStrictEqual(R.parseColor(good), null, `theme.js: ${good} is a colour`);
  reg('chromium-bad', { '--ink': 'rgb(72.549%, 199, 194)' });
  assert.ok((R.fallbacks('chromium-bad').unmeasured as string[]).includes('--ink'), 'a mixed comma --ink is listed unmeasured by the renderer, not measured');
  // finding 2: one length limit and the same linear number regexes in both copies; a value over the limit is not parsed
  assert.strictEqual(R._TOKEN_VALUE_MAX, TOKEN_VALUE_MAX, 'theme.js TOKEN_VALUE_MAX equals themes.ts');
  assert.strictEqual(String(R._COLOUR_NUM_RE), String(COLOUR_NUM_RE), 'the same number regex');
  assert.strictEqual(String(R._COLOUR_HUE_RE), String(COLOUR_HUE_RE), 'the same hue regex');
  for (const n of [TOKEN_VALUE_MAX - 9, TOKEN_VALUE_MAX - 8]) { const v = `rgb(${'0'.repeat(n)} 0 0)`; assert.deepStrictEqual(R.parseColor(v), parseColor(v), `parsers agree at length ${v.length}`); }
  assert.strictEqual(R.parseColor(`rgb(${'0'.repeat(TOKEN_VALUE_MAX)} 0 0)`), null, 'theme.js: a value over TOKEN_VALUE_MAX is not parsed');
  // 12. alpha is clamped to 0..1, both forms, both parsers
  for (const [v, a] of [['rgb(0 0 0 / 2)', 1], ['rgb(0 0 0 / -1)', 0], ['rgb(0 0 0 / 200%)', 1], ['rgba(0,0,0,5)', 1], ['hsl(0 0% 0% / 3)', 1]] as Array<[string, number]>) { assert.strictEqual(parseColor(v)?.[3], a, v); assert.strictEqual(R.parseColor(v)?.[3], a, v); }

  // 2. a translucent --bg is composited over white once: the page is #808080, not #404040
  assert.deepStrictEqual(issuesOf({ '--bg': 'rgba(0,0,0,.5)', '--ink': '#111111' }).filter((i) => /^--ink .* on --bg/.test(i)), [], 'ink #111 on the painted page #808080 (4.8:1) is not reported');
  assert.ok(issuesOf({ '--bg': 'rgba(0,0,0,.5)', '--ink': '#444444' }).some((i) => /^--ink .* on --bg/.test(i)), 'and #444 on #808080 is');
  reg('tr-page', { '--bg': 'rgba(0,0,0,.5)', '--ink': '#111111', '--room-path': '#111111' });
  assert.ok(!(R.fallbacks('tr-page').contrast as string[]).includes('--ink'), 'the renderer does not repair what reads at 4.8:1 on the translucent page');
  // 12. the renderer's translucent surface over a non-white page: white at 10% over a black page paints #1a1a1a (every surface the text pairs read on is set so)
  const glassy: Record<string, string> = { '--bg': '#000000' };
  for (const [fg, bg] of CONTRAST_PAIRS) if (/^--(ink|ink-2|muted|room-path)$/.test(fg) && bg !== '--bg') glassy[bg] = 'rgba(255,255,255,.1)';
  reg('tr-surf-ok', { ...glassy, '--ink': '#dddddd', '--ink-2': '#dddddd', '--muted': '#dddddd', '--room-path': '#dddddd' });
  assert.deepStrictEqual((R.fallbacks('tr-surf-ok').contrast as string[]).filter((k) => /^--(ink|ink-2|muted|room-path)$/.test(k)), [], 'light text on the dark translucent surfaces reads, no text token is repaired (composited over white they would read #f0f0f0, 1.4:1)');
  assert.deepStrictEqual(themeIssues({ ...glassy, '--ink': '#dddddd', '--ink-2': '#dddddd', '--muted': '#dddddd', '--room-path': '#dddddd' }, CL).filter((i) => /^--(ink|ink-2|muted|room-path) /.test(i)), [], 'and themegen agrees');
  reg('tr-surf-low', { ...glassy, '--ink': '#222222' });
  assert.ok((R.fallbacks('tr-surf-low').contrast as string[]).includes('--ink'), 'dark ink on them is repaired');
  // 3. translucent bar text: check and repair agree on the glass (over the glass, not the bare background); swept over alphas
  const wbBg = { '--wb-bg': '#000000', '--wb-bg-2': '#000000', '--wb-surface': '#000000', '--wb-surface-2': '#000000', '--wb-warn-bg': '#000000' };
  let flagged = 0;
  for (let a = 0.2; a <= 0.8; a += 0.005) {
    const ink = `rgba(255,255,255,${a.toFixed(3)})`, tk = { ...wbBg, '--wb-ink': ink };
    const said = themeIssues(tk, CL).some((i) => i.startsWith('--wb-ink ')), fixed = (() => { reg('bar-alpha', tk); return (R.fallbacks('bar-alpha').contrast as string[]).includes('--wb-ink'); })();
    assert.strictEqual(fixed, said, `bar text ${ink}: themeIssues ${said}, contrastFix ${fixed}`);
    if (said) flagged++;
  }
  assert.ok(flagged > 0 && flagged < 121, `the sweep crosses the 4.5:1 line (${flagged} of 121 flagged)`);
  // 12. a bar token set to a value that cannot be measured is reported by both
  assert.ok(issuesOf({ '--wb-ink': 'currentColor' }).some((i) => i.startsWith('--wb-ink (currentColor) is in a contrast pair')), 'themeIssues names an unmeasured --wb-ink');
  reg('bar-kw', { '--wb-ink': 'currentColor' });
  assert.ok((R.fallbacks('bar-kw').unmeasured as string[]).includes('--wb-ink'), 'fallbacks lists it');
  assert.ok(!(R.fallbacks('bar-kw').contrast as string[]).includes('--wb-ink'), 'and does not change it');

  // 5. worlds: worldContrast measures every colour form; the arcade sets its own --drop-bg (dark ink was left on Clean Office's light drop zone)
  for (const id of R.WORLD_IDS as string[]) {
    const rows = R.worldContrast(id) as Array<{ fg: string; bg: string; min: number; ratio: number }>, t = R.worldTokens(id) as Record<string, string>;
    const expect = CONTRAST_PAIRS.filter(([f, b]) => resolveColor(t[f]) !== null && resolveColor(t[b]) !== null).length;
    assert.ok(rows.filter((r) => CONTRAST_PAIRS.some(([f, b]) => f === r.fg && b === r.bg)).length >= expect, `${id}: every page pair is measured, rgb() ones too`);
    assert.ok(rows.some((r) => r.fg === '--drop-ink' && r.bg === '--drop-bg'), `${id}: the drop zone pair is measured`);
    assert.deepStrictEqual(rows.filter((r) => !(r.ratio >= r.min)).map((r) => `${id} ${r.fg} on ${r.bg} ${r.ratio.toFixed(2)}`), [], `${id}: every pair passes`);
  }
  const arcade = R.worldTokens('retro') as Record<string, string>;
  assert.ok(luminance(resolveColor(arcade['--drop-bg']) as string) < 0.1 && /^#[0-9a-f]{6}$/i.test(arcade['--drop-bg']), 'the arcade has its own dark --drop-bg');
  assert.ok(contrast(arcade['--drop-ink'], arcade['--drop-bg']) >= 4.5, 'its drop zone reads');
  // review of #1307, finding 3: one --drop-bg in the arcade's page set (a second key in the same object literal is dead: the later one wins silently)
  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'theme.js'), 'utf8');
    const at = src.indexOf("name:'Retro arcade'"), page = src.slice(at, src.indexOf('bar:{', at));
    assert.ok(at > 0 && page.length > 0, 'the arcade set is found in theme.js');
    assert.strictEqual(page.split("'--drop-bg':").length - 1, 1, 'WORLD_SETS.retro.page sets --drop-bg exactly once');
  }

  // 6. data-dark follows --surface in any colour form
  for (const [v, dark] of [['rgb(20 20 30)', true], ['hsl(240 20% 10%)', true], ['black', true], ['#000000ff', true], ['rgb(250 250 250)', false], ['white', false], ['rgba(0,0,0,.1)', false], ['currentColor', false]] as Array<[string, boolean]>) {
    reg('dk', { '--surface': v }); R.setTheme('dk');
    assert.strictEqual('dark' in doc.documentElement.dataset, dark, `data-dark for --surface ${v}`);
  }
  R.setTheme(R.CLEAN_ID);

  // 9. a missing manifest still has every key
  assert.deepStrictEqual(R.fallbacks('no-such-theme'), { dropped: [], contrast: [], unmeasured: [] }, 'fallbacks of an unknown id');

  // 14. a user theme with a light --drop-ink and no --drop-bg of its own is now adjusted (the drop zone it sets over Clean Office's light one used to pass unseen)
  reg('light-drop-ink', { '--drop-ink': '#e0ecf8' });
  assert.deepStrictEqual(R.fallbacks('light-drop-ink').contrast, ['--drop-ink'], 'its --drop-ink is adjusted and counted for the Settings note');
  assert.ok(issuesOf({ '--drop-ink': '#e0ecf8' }).some((i) => i.startsWith('--drop-ink (#e0ecf8) on --drop-bg (rgb(233 241 248 / .93))')), 'and themeIssues reports it');
  delete (global as unknown as { document?: unknown }).document;
  console.log('review of #1307: own-property names, one grammar, translucent page and bar, worlds, data-dark, unmeasured bar tokens, alpha clamp');
}
