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
import { BAR_PAIRS, CONTRAST_PAIRS, UI_PAIRS, BRAND_UIS, WORLD_GLASS, contrast, glassOver, luminance, themeIssues } from '../src/shared/themegen';
import { ART_SLOTS, checkUserManifest } from '../src/shared/themes';

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
  for (const t of T.list()) assert.deepStrictEqual(T.fallbacks(t.id), { dropped: [], contrast: [] }, `built-in ${t.id} uses all of its values`);
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
  const hex = (v: string): boolean => /^#[0-9a-f]{3,8}$/i.test(String(v || ''));
  for (const [fg, bg, min] of CONTRAST_PAIRS) if (hex(t[fg]) && hex(t[bg])) assert.ok(contrast(t[fg], t[bg]) >= min, `${fg} on ${bg}: themegen agrees`); /* non-hex (--drop-bg's rgb()) is Clean Office's, as in theme.js */
  for (const [fg, bg, min, why] of UI_PAIRS) assert.ok(contrast(t[fg], t[bg]) >= min, `${fg} on ${bg} (${why}): ${contrast(t[fg], t[bg]).toFixed(2)}:1`);
  for (const ui of ['clean', ...BRAND_UIS]) assert.deepStrictEqual(themeIssues(t, clean, ui).filter((x) => !/the top bar/.test(x)), [], `no contrast issue with ui ${ui}`);
  const worst = Math.min(...rows.map((r) => r.ratio / r.min));
  // spec 102 FR-263 (owner, 2026-11-03): the arcade is dark everywhere. Complete; every status hue unchanged; the three status -ink shades
  // lightened in the same hue (070 FR-050, amended for dark worlds); every pair AA, panels' glass composited over white
  {
    const r = T.worldTokens('retro') as Record<string, string>, rr = T.worldContrast('retro') as Array<{ fg: string; bg: string; min: number; ratio: number }>;
    for (const k of Object.keys(T._builtins()[T.CLEAN_ID].tokens).concat(Object.keys(T._tokens()))) assert.ok(r[k] !== undefined, `retro has ${k}`);
    const INKS = ['--red-ink', '--amber-ink', '--blue-ink'];
    for (const k of Object.keys(clean).filter((x) => /^--(c|pb|pc|halo)-|^--(amber|red|green|blue)(-ink)?$|^--desk-(new|needs)$/.test(x) && !INKS.includes(x))) assert.strictEqual(r[k], clean[k], `retro: status colour ${k} is unchanged`);
    const hue = (h: string): number => { const [R, G, B] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255), mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn; if (!d) return 0; const x = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; return (x * 60 + 360) % 360; };
    for (const k of INKS) { assert.ok(luminance(r[k]) > luminance(clean[k]), `retro: ${k} is lighter`); const dh = Math.abs(hue(r[k]) - hue(clean[k])); assert.ok(Math.min(dh, 360 - dh) <= 12, `retro: ${k} keeps its hue (${dh.toFixed(1)} degrees)`); }
    assert.ok(luminance(r['--surface']) < 0.05 && luminance(r['--bg']) < 0.05 && luminance(r['--card']) < 0.05 && luminance(r['--wb-bg']) < 0.05, 'retro: page, cards and bar are dark');
    assert.deepStrictEqual(rr.filter((x) => !(x.ratio >= x.min)).map((x) => `${x.fg} on ${x.bg} ${x.ratio.toFixed(2)}:1 < ${x.min}`), [], 'every pair of the arcade passes WCAG AA');
    assert.ok(rr.some((x) => / \(glass over #ffffff\)$/.test(x.bg) && x.fg === '--ink'), 'a dark panel is checked over white');
  }
  // the cave's set: complete, status colours unchanged, every pair AA with the glass composited (the same checks as the photo set)
  {
    const c = T.worldTokens('cave') as Record<string, string>, cr = T.worldContrast('cave') as Array<{ fg: string; bg: string; min: number; ratio: number }>;
    for (const k of Object.keys(T._builtins()[T.CLEAN_ID].tokens).concat(Object.keys(T._tokens()))) assert.ok(c[k] !== undefined, `the cave set has ${k}`);
    for (const k of Object.keys(clean).filter((x) => /^--(c|pb|pc|halo)-|^--(amber|red|green|blue)(-ink)?$|^--desk-(new|needs)$/.test(x))) assert.strictEqual(c[k], clean[k], `cave: status colour ${k} is unchanged`);
    assert.deepStrictEqual(cr.filter((r) => !(r.ratio >= r.min)).map((r) => `${r.fg} on ${r.bg} ${r.ratio.toFixed(2)}:1 < ${r.min}`), [], 'every pair of the cave world passes WCAG AA');
    for (const [fg, bg, min] of CONTRAST_PAIRS) if (hex(c[fg]) && hex(c[bg])) assert.ok(contrast(c[fg], c[bg]) >= min, `cave: ${fg} on ${bg}: themegen agrees`);
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
