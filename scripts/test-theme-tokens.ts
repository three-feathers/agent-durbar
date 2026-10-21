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
import { FONT_ALLOW, TYPED_TOKENS, typedValue } from '../src/shared/themetokens';
import { CONTRAST_PAIRS } from '../src/shared/themegen';
import { ART_SLOTS, checkUserManifest } from '../src/shared/themes';

const ROOT = process.cwd();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(ROOT, 'src', 'renderer', 'theme.js'));

// ---- 1. the two copies agree ----
assert.deepStrictEqual(T.TYPED_TOKENS, TYPED_TOKENS, 'theme.js and themetokens.ts register the same typed tokens');
assert.deepStrictEqual(T.FONT_ALLOW, FONT_ALLOW, 'the same font allow-list');
assert.deepStrictEqual(T.CONTRAST_PAIRS, CONTRAST_PAIRS, 'theme.js checks the same text pairs as the AI maker');
assert.deepStrictEqual(T.ART_SLOTS, ART_SLOTS, 'the same art slots');
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

// ---- 2. defaults ----
const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
for (const [k, spec] of Object.entries(TYPED_TOKENS)) {
  assert.notStrictEqual(typedValue(k, spec.def), null, `${k}: its default passes its own grammar (fonts on the allow-list)`);
  const m = new RegExp(k.replace(/-/g, '\\-') + ':([^;]+);').exec(rootBlock);
  if (k === '--ui-display') { assert.ok(!m, '--ui-display has no :root value: a UI style (themes.css) or the pack sets it, else titles inherit'); continue; }
  assert.ok(m, `${k} has a :root default in styles.css`);
  assert.strictEqual(m![1].replace(/\s+/g, ''), spec.def.replace(/\s+/g, ''), `${k}: the :root default equals the registry's`);
}

// ---- 3. the literal ratchet ----
const RATCHET = path.join(ROOT, 'scripts', 'fixtures', 'theme-literals.json');
const FILES = ['styles.css', 'screens.css', 'themes.css', 'app.js', 'screens.js', 'scenekits.js', 'index.html'];
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
  for (const bad of ['Georgia;}*{display:none', 'url(https://example.com/x.woff2)', '<b>', '@font-face']) {
    assert.strictEqual(checkUserManifest(JSON.stringify({ id: 'h', tokens: { '--font': bad } })).ok, false, `hostile ${bad} refuses the pack`);
    assert.strictEqual(T._validateManifest({ id: 'h', tokens: { '--font': bad } }).tokens['--font'], undefined, 'and the renderer never applies it');
  }
}
// contrast: a user pack's unreadable pair falls back as a pair; built-ins are left as designed
{
  const pack = { id: 'lowc', tokens: { '--ink': '#cccccc', '--bg': '#ffffff', '--surface': '#202020', '--chair': '#c2185b' } };
  T.registerUserThemes({ lowc: pack });
  T.setTheme('lowc');
  const fb = T.fallbacks('lowc');
  assert.ok(fb.contrast.includes('--ink') && fb.contrast.includes('--bg'), 'ink on bg failed: both set back');
  assert.strictEqual(T.token('--ink'), '#2c3733', 'the scenes read the set-back value (Clean Office\'s ink)');
  assert.strictEqual(T.token('--chair'), '#c2185b', 'a value with no contrast pair is kept');
  for (const t of T.list()) assert.deepStrictEqual(T.fallbacks(t.id), { dropped: [], contrast: [] }, `built-in ${t.id} uses all of its values`);
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
console.log(`theme tokens guard passed (${n} corpus checks, ${FILES.length} files under the ratchet)`);
