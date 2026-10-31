/** AI theme maker (spec 040 FR-014..FR-020, #182): prompts, the safe subset, art through the renderer's sanitizer, contrast issues for fix passes, unique ids. `npm run test:themegen`. No model, no credits. */
import * as assert from 'assert';
import * as path from 'path';
import { ART_STYLE, CONTRAST_PAIRS, GEN_ART, MAX_PLACE_NAME, artWarnings, fitPlaceName, GEN_WORDS, THEME_IDEAS, buildFixPrompt, buildRetryPrompt, keepArt, buildThemePrompt, contrast, firstJsonObject, isBlocking, parseGeneratedTheme, pickIdeas, themeIssues, toHex } from '../src/shared/themegen';
import { checkUserManifest, SCENE_KITS, UI_STYLES } from '../src/shared/themes';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string>; _sanitizeSlot(s: string): string | null; ART_SLOTS: string[] };
const clean = T._tokens(); // a fresh module: Clean Office's full token set
assert.ok(Object.keys(clean).length > 100, 'all of Clean Office');
const ctx = { clean, sanitizeArt: (s: string) => T._sanitizeSlot(s), taken: () => false };

const light = {
  name: 'Paper newsroom', ui: 'clean', scene: 'office',
  tokens: { '--bg': '#eceff3', '--surface': '#fbfcfd', '--ink': '#1b2230', '--ink-2': '#3a4456', '--muted': '#5f6a7c', '--sage': '#3f7d6c', '--brand-bg': '#9A5B00', '--brand-mark': '#ffffff' },
  words: { 'place-library': 'Archive', 'place-web': 'Newswire', 'lobby-label': 'The newsroom floor' },
  art: { 'char-headwear': '<path d="M62 33h24l-3-7H65z" fill="#2b3344"/>', 'place-web': '<circle cx="10" cy="10" r="6"/>' },
};

// prompts
{
  const p = buildThemePrompt('  a ship\'s   bridge\n at dawn ' + 'x'.repeat(400), clean);
  assert.match(p, /The look the user wants: "a ship's bridge at dawn x+"/);
  assert.ok(!/x{301}/.test(p), 'description cut at 300');
  for (const u of UI_STYLES) assert.ok(p.includes(JSON.stringify(u)));
  for (const k of SCENE_KITS) assert.ok(p.includes(JSON.stringify(k)));
  for (const k of Object.keys(clean)) assert.ok(p.includes(k + '='), 'every Clean token with its value: ' + k);
  for (const k of Object.keys(GEN_WORDS)) assert.ok(p.includes(k));
  for (const k of Object.keys(GEN_ART)) assert.ok(p.includes(k) && T.ART_SLOTS.includes(k), 'art slot exists in the renderer: ' + k);
  assert.match(p, /No text, no images, no style, no scripts, no links, no url\(\)/);
  assert.match(p, /for a dark look set EVERY token/);
  const f = buildFixPrompt({ name: 'x' }, ['--ink on --bg has contrast 2.0:1, needs 4.5:1']);
  assert.match(f, /\{"name":"x"\}/);
  assert.match(f, /- --ink on --bg/);
  assert.match(f, /WHOLE corrected theme/);
  // the worst case stays far below Windows' 32,767-character command line: the art is never sent back
  const fullArt = Object.fromEntries(Object.keys(GEN_ART).map((k) => [k, 'a'.repeat(4000)]));
  const worst = buildFixPrompt({ name: 'n'.repeat(40), ui: 'clean', scene: 'office', tokens: T._tokens(), words: Object.fromEntries(Object.keys(GEN_WORDS).map((k) => [k, 'w'.repeat(40)])), art: fullArt }, Array(30).fill('--ink (#000000) on --bg (#000000) has contrast 1.0:1, needs 4.5:1'));
  assert.ok(worst.length < 16000, 'fix prompt length ' + worst.length);
  assert.ok(!worst.includes('aaaa'), 'no art in the fix prompt');
  assert.ok(buildThemePrompt('x'.repeat(300), T._tokens()).length < 16000);
}

// JSON extraction
assert.deepStrictEqual(firstJsonObject('Sure!\n```json\n{"a":"}{","b":{"c":1}}\n```'), { a: '}{', b: { c: 1 } });
assert.strictEqual(firstJsonObject('no json here'), undefined);
assert.deepStrictEqual(firstJsonObject('{bad} then {"ok":true}'), { ok: true });

// a fix pass leaves out the art: keepArt carries the earlier (already sanitised) art over, and keeps a fix's own art
{
  const first = parseGeneratedTheme(JSON.stringify(light), 'a newsroom', ctx);
  const { art: _a, ...noArt } = light as Record<string, unknown>;
  const fixed = parseGeneratedTheme(JSON.stringify(noArt), 'a newsroom', ctx);
  assert.ok(first.ok && fixed.ok && first.manifest.art && !fixed.manifest.art);
  if (first.ok && fixed.ok) {
    const k = keepArt(fixed, first);
    assert.deepStrictEqual(k.manifest.art, first.manifest.art);
    assert.strictEqual(keepArt(first, fixed), first, 'a pass with its own art keeps it');
    assert.strictEqual(keepArt(fixed, fixed), fixed, 'nothing to carry');
  }
}

// token names without the leading `--` (what Copilot's `auto` wrote on 2026-10-20) are read as the same tokens; unknown bare names still drop
{
  const bare = { ...(light as Record<string, unknown>), tokens: { ...Object.fromEntries(Object.entries((light as { tokens: Record<string, string> }).tokens).map(([k, v]) => [k.replace(/^--/, ''), v])), 'not-a-token': '#123456' } };
  const a = parseGeneratedTheme(JSON.stringify(light), 'a newsroom', ctx);
  const b = parseGeneratedTheme(JSON.stringify(bare), 'a newsroom', ctx);
  assert.ok(a.ok && b.ok, JSON.stringify(b).slice(0, 200));
  if (a.ok && b.ok) {
    assert.deepStrictEqual((b.manifest as { tokens: unknown }).tokens, (a.manifest as { tokens: unknown }).tokens);
    assert.ok(b.warnings.some((w) => /1 colour was not usable/.test(w)), 'the unknown bare name is dropped');
  }
}

// a good light reply: valid user theme, art rebuilt by the sanitizer, no issues
{
  const r = parseGeneratedTheme(JSON.stringify(light), 'a newsroom', ctx);
  assert.ok(r.ok, JSON.stringify(r));
  if (r.ok) {
    const m = r.manifest as Record<string, unknown>;
    assert.strictEqual(m.id, 'ai-paper-newsroom');
    assert.strictEqual(m.author, 'AI theme maker');
    assert.strictEqual((m.tokens as Record<string, string>)['--brand-bg'], '#9a5b00');
    assert.deepStrictEqual(Object.keys(m.art as object).sort(), ['char-headwear', 'place-web']);
    assert.ok(checkUserManifest(JSON.stringify(m)).ok);
    assert.deepStrictEqual(r.issues, []);
  }
}

// art that the sanitizer refuses is left out (scripts, events, images, links, text, style, url())
{
  const evil = { ...light, art: {
    'char-robe': '<script>alert(1)</script>', 'char-collar': '<path d="M1 1" onload="x()"/>', 'desk-art': '<image href="http://x/y.png"/>',
    'plant': '<a href="http://x"><path d="M1 1"/></a>', 'door-art': '<path d="M1 1" style="fill:red"/>', 'lobby-art': '<rect width="1" height="1" fill="url(http://x)"/>',
    'hair-acc': '<circle cx="74" cy="28" r="3" fill="var(--sage)"/>', 'monitor-art': 'x'.repeat(5000), 'not-a-slot': '<path d="M1 1"/>',
  } };
  const r = parseGeneratedTheme(JSON.stringify(evil), 'x', ctx);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepStrictEqual(Object.keys(r.manifest.art as object), ['hair-acc'], 'only the safe fragment survives');
    assert.ok(r.warnings.some((w) => /art left out by the safety check: .*char-robe.*char-collar/.test(w)));
  }
}

// colours: hex only, Clean keys only; ui/scene fall back; words plain
{
  const bad = { ...light, ui: 'javascript:alert(1)', scene: '../x', css: 'body{}',
    tokens: { ...light.tokens, '--sage': 'url(http://x)', '--blue': 'red;x', '--evil': '#000', '--line': 'rgb(1,2,3)' },
    words: { 'place-library': '<img onerror=x>Archive', 'door-close': '{{x}}', 'place-other': 'a'.repeat(80) } };
  const r = parseGeneratedTheme(JSON.stringify(bad), 'x', ctx);
  assert.ok(r.ok);
  if (r.ok) {
    const m = r.manifest as Record<string, unknown>, t = m.tokens as Record<string, string>, w = m.words as Record<string, string>;
    assert.strictEqual(m.ui, 'clean');
    assert.strictEqual(m.scene, 'office');
    assert.strictEqual(m.css, undefined);
    for (const k of ['--sage', '--blue', '--evil']) assert.strictEqual(t[k], undefined, k);
    assert.strictEqual(t['--line'], '#010203', 'rgb() is converted');
    assert.strictEqual(w['place-library'], 'img', 'tags are stripped, then the name is cut to whole words that fit a lobby tile (14 characters)');
    assert.strictEqual(w['door-close'], 'x');
    assert.strictEqual(w['place-other'].length, 14, 'a place name is cut at 14 characters, the tile width');
  }
}

// dark themes are allowed; light leftovers and bad pairs become issues for a fix pass
{
  const darkPartial = { name: 'Night', tokens: { '--bg': '#121417', '--surface': '#1b1e23', '--raised': '#23272d', '--card': '#1f2328', '--card-waiting': '#2b2614', '--card-error': '#2b1818', '--soft': '#1a1d21', '--note': '#1a1d21', '--ink': '#eef1f5', '--ink-2': '#c9ced6', '--muted': '#9aa2ad' } };
  const r = parseGeneratedTheme(JSON.stringify(darkPartial), 'x', ctx);
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(r.issues.some((i) => /the page is dark but these tokens keep the light default; set them for the dark look: .*--surface-2/.test(i)), 'light leftovers named');
    // spec 040 FR-027: the room tints it left at the light default now fail the text on them, which the fix pass corrects
    assert.ok(r.issues.some((i) => /^--ink \(.*\) on --tint-sage \(#eaf0e9\)/.test(i)), 'light room tints under light text are named');
  }
  const full: Record<string, string> = {};
  for (const k of Object.keys(clean)) full[k] = '#20242a';
  Object.assign(full, { '--bg': '#121417', '--surface': '#1b1e23', '--ink': '#eef1f5', '--ink-2': '#c9ced6', '--muted': '#9aa2ad', '--room-path': '#9aa2ad', '--drop-ink': '#eef1f5', '--brand-mark': '#eef1f5', '--idle-stub-ink': '#eef1f5', '--desk-new': '#5fd08a', '--desk-needs': '#f0a060', '--sage-ink': '#8abaa1', '--red-ink': '#bc7a74', '--amber-ink': '#cbb693' }); // spec 052 FR-169: a dark theme needs light button inks (they sit under --surface text)
  for (const s of ['working', 'thinking', 'waiting', 'idle', 'error', 'done']) { full['--pb-' + s] = '#20242a'; full['--pc-' + s] = '#e8ecf2'; }
  const r2 = parseGeneratedTheme(JSON.stringify({ name: 'Full night', tokens: full }), 'x', ctx);
  assert.ok(r2.ok && r2.issues.length === 0, JSON.stringify(r2.ok ? r2.issues : r2));
  if (r2.ok) assert.ok(checkUserManifest(JSON.stringify(r2.manifest)).ok, 'all 135 tokens fit the raised cap');
}

// contrast issues name the pair; ink on bg is blocking
{
  const iss = themeIssues({ '--bg': '#ffffff', '--ink': '#dddddd', '--pb-error': '#fbe9e7', '--pc-error': '#f5c6c0' }, clean);
  assert.ok(iss.some((i) => /^--ink \(#dddddd\) on --bg \(#ffffff\)/.test(i)));
  assert.ok(iss.some((i) => /^--pc-error .* on --pb-error/.test(i)));
  assert.ok(iss.filter(isBlocking).length >= 1);
  assert.ok(!isBlocking('--pc-error (#1) on --pb-error (#2) has contrast 1:1, needs 4.5:1'));
  assert.strictEqual(CONTRAST_PAIRS.length, 37);
  // spec 052 FR-169: --surface is the text of a primary (--sage-ink), danger (--red-ink) and warn (--amber-ink) button, so each is a pair
  for (const ink of ['--sage-ink', '--red-ink', '--amber-ink']) {
    assert.ok(CONTRAST_PAIRS.some(([a, b, m]) => a === '--surface' && b === ink && m === 4.5), ink);
    assert.ok(themeIssues({ '--surface': '#ffffff', [ink]: '#cccccc' }, clean).some((i) => i.startsWith('--surface (#ffffff) on ' + ink)), 'a pale ' + ink + ' under a white --surface is an issue');
    assert.ok(!themeIssues({ '--surface': '#ffffff', [ink]: '#333333' }, clean).some((i) => i.includes(' on ' + ink)));
  }
  // spec 052 FR-052: --muted on --surface needs 4.5:1 (was 3:1); #8a8f99 on white is about 3.3:1, now an issue
  assert.ok(CONTRAST_PAIRS.some(([a, b, m]) => a === '--muted' && b === '--surface' && m === 4.5));
  assert.ok(themeIssues({ '--surface': '#ffffff', '--muted': '#8a8f99' }, clean).some((i) => /^--muted \(#8a8f99\) on --surface/.test(i)));
  assert.ok(!themeIssues({ '--surface': '#ffffff', '--muted': '#5f6a7c' }, clean).some((i) => /^--muted /.test(i)));
  // the top bar of retro is --ink under fixed light text: a light --ink there is an issue; clean is fine
  const darkTok = { '--bg': '#101010', '--surface': '#181818', '--ink': '#f0f0f0', '--raised': '#202020', '--card': '#202020', '--card-waiting': '#2a2410', '--card-error': '#2a1414', '--soft': '#1c1c1c', '--note': '#1c1c1c' };
  assert.ok(themeIssues(darkTok, clean, 'retro').some((i) => /^the top bar: with ui "retro" it is filled with --ink/.test(i)));
  assert.ok(!themeIssues(darkTok, clean, 'clean').some((i) => /^the top bar/.test(i)));
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrast('#777', '#777777cc') - 1) < 1e-9, 'alpha ignored, short hex expanded');
}

// too little, or nothing usable
assert.ok(!parseGeneratedTheme('{"name":"x","tokens":{"--bg":"#fff"}}', 'x', ctx).ok);
assert.ok(!parseGeneratedTheme('I cannot do that.', 'x', ctx).ok);

// ids
{
  const taken = new Set(['ai-paper-newsroom', 'ai-paper-newsroom-2']);
  const r = parseGeneratedTheme(JSON.stringify(light), 'x', { ...ctx, taken: (id: string) => taken.has(id) });
  assert.ok(r.ok && r.manifest.id === 'ai-paper-newsroom-3');
  const r2 = parseGeneratedTheme(JSON.stringify({ ...light, name: 'Ça Été Très Joli!' }), 'x', ctx);
  assert.ok(r2.ok && r2.manifest.id === 'ai-ca-ete-tres-joli');
}
// rgb() colours become hex; ideas; the retry prompt
assert.strictEqual(toHex('rgb(255, 0, 16)'), '#ff0010');
assert.strictEqual(toHex('rgba(0,0,0,.5)'), '#00000080');
assert.strictEqual(toHex('rgba(0,0,0,1)'), '#000000');
assert.strictEqual(toHex('rgb(300,0,0)'), undefined);
assert.strictEqual(toHex('red'), undefined);
assert.strictEqual(toHex('#ABC'), '#abc');
// spec 070 FR-031: the CSS forms the prompt's defaults use (real haiku reply, 2026-10-22)
assert.strictEqual(toHex('transparent'), '#00000000');
assert.strictEqual(toHex('rgb(251 236 240 / .93)'), '#fbecf0ed');
assert.strictEqual(toHex('rgb(251 236 240)'), '#fbecf0');
assert.strictEqual(toHex('rgb(251 236 240 / 1)'), '#fbecf0');
assert.strictEqual(toHex('rgb(251, 236 240)'), undefined);
assert.strictEqual(toHex('rgb(300 0 0 / .5)'), undefined);
{
  const r = parseGeneratedTheme(JSON.stringify({ ...light, tokens: { ...light.tokens, '--sage': 'rgb(63, 125, 108)' } }), 'x', ctx);
  assert.ok(r.ok && (r.manifest.tokens as Record<string, string>)['--sage'] === '#3f7d6c', 'rgb() converted, not dropped');
}
assert.ok(THEME_IDEAS.length >= 20 && new Set(THEME_IDEAS).size === THEME_IDEAS.length, 'a list of distinct ideas');
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const four = pickIdeas(4, rand);
assert.strictEqual(new Set(four).size, 4);
assert.ok(four.every((i) => THEME_IDEAS.includes(i)));
assert.strictEqual(pickIdeas(99).length, THEME_IDEAS.length);
assert.match(buildRetryPrompt('a fox den', clean, 'no JSON'), /a fox den[\s\S]*Your previous reply could not be used \(no JSON\)/);
// spec 070 FR-030: fonts, weight, radii, shadows by their own grammar; figures; gadget slots; per-value warnings
{
  const p = buildThemePrompt('a pink fashion studio', clean);
  for (const k of ['--font', '--ui-display', '--font-mono', '--t1-weight', '--r-md', '--radius', '--shadow-card', '--shadow-pop', '"figures"', 'gadget-cup', 'gadget-laptop', 'Georgia']) assert.ok(p.includes(k), 'the prompt asks for ' + k);
  assert.ok(/never a URL/.test(p) && /Sizes, spacing and borders are fixed/.test(p));
  const reply = { ...light, tokens: { ...light.tokens, font: 'Avenir Next, Arial', '--ui-display': 'Didot, Comic Sans MS', '--r-md': '14px', '--radius': '99px', '--shadow-card': '0 2px 8px rgba(224,33,138,.18)', '--t1-weight': '700' },
    figures: { shirts: ['#e0218a', '#ff8cc6', 'hotpink', 'rgb(255, 95, 176)'], hairs: ['#f2d16b'] }, art: { ...light.art, 'gadget-cup': '<rect x="98" y="76" width="10" height="10" fill="#ff5fb0"/>' } };
  const g = parseGeneratedTheme(JSON.stringify(reply), 'pink', ctx);
  assert.ok(g.ok);
  if (g.ok) {
    const t = g.manifest.tokens as Record<string, string>;
    assert.strictEqual(t['--font'], '"Avenir Next",Arial,sans-serif', 'a bare token name, normalized font stack');
    assert.strictEqual(t['--ui-display'], undefined, 'a stack with a font not on the list is dropped');
    assert.strictEqual(t['--radius'], undefined, 'a radius over 24px is dropped');
    assert.strictEqual(t['--r-md'], '14px');
    assert.strictEqual(t['--t1-weight'], '700');
    assert.strictEqual(t['--shadow-card'], '0 2px 8px rgba(224,33,138,.18)');
    assert.deepStrictEqual(g.manifest.figures, { shirts: ['#e0218a', '#ff8cc6', '#ff5fb0'], hairs: ['#f2d16b'] }, 'rgb() converted, a name dropped');
    assert.ok(g.warnings.some((w) => /2 font or shape values were not usable/.test(w)), g.warnings.join('|'));
    assert.ok(g.warnings.some((w) => /1 clothes or hair colour was not usable/.test(w)), g.warnings.join('|'));
    assert.ok((g.manifest.art as Record<string, string>)['gadget-cup'], 'the gadget art is kept');
    const c = checkUserManifest(JSON.stringify(g.manifest));
    assert.ok(c.ok && c.dropped!.length === 0, 'the saved pack imports with nothing dropped');
  }
  // review on #500: a font name that lives on Object.prototype is only an unusable font, not a reason to refuse the whole theme
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = parseGeneratedTheme(JSON.stringify({ ...light, tokens: { ...light.tokens, '--font': name } }), 'proto', ctx);
    assert.ok(r.ok, `--font ${name}: the theme is kept`);
    if (r.ok) {
      assert.strictEqual((r.manifest.tokens as Record<string, string>)['--font'], undefined, `--font ${name} is dropped`);
      assert.ok(r.warnings.some((w) => /font or shape value was not usable/.test(w)), r.warnings.join('|'));
      assert.ok(checkUserManifest(JSON.stringify(r.manifest)).ok, 'and the saved pack imports');
    }
  }
}
// ---- spec 040 FR-025..FR-030 (#903): quality stage 1 ----
// FR-025 (R2): the scenery slots the renderer supports are in the prompt, with their geometry, and survive parsing
{
  const p = buildThemePrompt('a sunny wooden library', clean);
  for (const k of ['room-back-wall', 'room-back-window', 'room-floor', 'desk-back']) {
    assert.ok(GEN_ART[k] && /viewBox 0 0 (320 118|200 124)/.test(GEN_ART[k]), `${k} has its geometry`);
    assert.ok(p.includes(`  ${k}: `), `${k} is in the prompt`);
    assert.ok(T.ART_SLOTS.includes(k), `${k} is a renderer slot`);
  }
  const scenery = { ...light, art: {
    'room-back-wall': '<rect x="0" y="0" width="320" height="70" fill="#c9a36b"/><rect x="10" y="10" width="60" height="50" fill="#8a5a2b"/><rect x="90" y="10" width="60" height="50" fill="#8a5a2b"/><rect x="170" y="10" width="60" height="50" fill="#8a5a2b"/>',
    'room-back-window': '<rect x="120" y="8" width="80" height="44" fill="#9ed0f0"/><circle cx="160" cy="30" r="12" fill="#ffd45e"/><path d="M120 30h80" stroke="#6b4a2b" stroke-width="3"/>',
    'room-floor': '<rect x="0" y="40" width="320" height="78" fill="#b98a55"/><path d="M0 60h320M0 80h320M0 100h320" stroke="#8a5a2b" stroke-width="2"/><path d="M60 40v78M160 40v78M260 40v78" stroke="#8a5a2b" stroke-width="2"/><rect x="100" y="70" width="120" height="30" fill="#7a2f2f"/>',
    'desk-back': '<rect x="14" y="80" width="172" height="8" fill="#6b4a2b"/><rect x="30" y="81" width="40" height="5" fill="#9a6b3b"/>',
  } };
  const r = parseGeneratedTheme(JSON.stringify(scenery), 'wood', ctx);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepStrictEqual(Object.keys(r.manifest.art as object).sort(), ['desk-back', 'room-back-wall', 'room-back-window', 'room-floor'], 'all four are kept');
    assert.ok(checkUserManifest(JSON.stringify(r.manifest)).ok);
    assert.deepStrictEqual(r.warnings.filter((w) => /sparse|thin|small/.test(w)), [], 'good scenery has no art warnings');
  }
  const evil = parseGeneratedTheme(JSON.stringify({ ...light, art: { 'room-floor': '<script>x</script>', 'room-back-wall': '<rect onclick="x()" width="1" height="1"/>' } }), 'x', ctx);
  assert.ok(evil.ok && !evil.manifest.art && evil.warnings.some((w) => /art left out by the safety check: room-back-wall, room-floor|room-floor, room-back-wall/.test(w)), 'scenery goes through the same sanitizer');
}

// FR-026 (R3): grouped tokens with meanings; every token still listed once, with its value
{
  const p = buildThemePrompt('x', clean);
  for (const k of Object.keys(clean)) assert.strictEqual(p.split(new RegExp(`(?:^|\\s)${k}=`)).length - 1, 1, `${k} appears once with its value`);
  assert.match(p, /Brand\. --brand-bg fills the lobby tile icons and the primary buttons in the UI style "retro"/);
  assert.match(p, /Room tints\./);
  assert.match(p, /--room-path the folder path in each room header, which sits on the room tints/);
  assert.match(p, /--raised buttons, chips and the lobby tiles/);
  assert.ok(p.length < 16000, 'prompt length ' + p.length);
}

// FR-027 (R5): the new pairs. --brand-bg on --raised and --bg (non-text 3:1) in the UI styles that paint with it, the primary button text, and the text on every room tint
{
  const dark = { '--bg': '#121417', '--surface': '#1b1e23', '--raised': '#23272d', '--tint-sage': '#1c2420', '--tint-blue': '#1c2127', '--tint-sand': '#25221c', '--tint-clay': '#261f1c', '--ink': '#eef1f5', '--muted': '#a9b0bb', '--room-path': '#a9b0bb', '--brand-mark': '#101010' };
  const ok = { ...dark, '--brand-bg': '#e0a84a' };
  assert.deepStrictEqual(themeIssues(ok, clean, 'retro').filter((i) => /--brand|--tint/.test(i)), [], 'a bright brand colour on a dark theme passes');
  // a pastel brand colour on a light page: the lobby icons vanish (the audit's 1.2:1)
  const pastel = { '--bg': '#f7f6f3', '--raised': '#ffffff', '--brand-bg': '#e4ece6', '--brand-mark': '#1b2230' };
  for (const ui of ['retro']) {
    const iss = themeIssues(pastel, clean, ui);
    assert.ok(iss.some((i) => /^--brand-bg \(#e4ece6\) on --raised \(#ffffff\) has contrast 1\.2:1, needs 3:1/.test(i)), `${ui}: brand-bg on raised`);
    assert.ok(iss.some((i) => /^--brand-bg \(#e4ece6\) on --bg \(#f7f6f3\)/.test(i)), `${ui}: brand-bg on bg`);
  }
  assert.ok(!themeIssues(pastel, clean, 'clean').some((i) => /--brand-bg/.test(i)), 'UI "clean" does not paint with --brand-bg: no pair (Clean Office itself is pale)');
  // the primary button text, 4.5:1 (it was 3:1)
  const btn = themeIssues({ '--brand-bg': '#9a5b00', '--brand-mark': '#d9c7a8' }, clean, 'retro');
  assert.ok(btn.some((i) => /^--brand-mark \(#d9c7a8\) on --brand-bg \(#9a5b00\) has contrast 3\.3:1, needs 4\.5:1/.test(i)), btn.join('|'));
  assert.ok(!themeIssues({ '--brand-bg': '#9a5b00', '--brand-mark': '#ffffff' }, clean, 'retro').some((i) => /--brand-mark/.test(i)));
  // paths, muted text and ink on each room tint, not only --bg
  for (const t of ['sage', 'blue', 'sand', 'clay']) for (const fg of ['--room-path', '--muted', '--ink']) {
    assert.ok(CONTRAST_PAIRS.some(([a, b, m]) => a === fg && b === `--tint-${t}` && m === 4.5), `${fg} on --tint-${t}`);
    const iss = themeIssues({ ...dark, [`--tint-${t}`]: '#6a7a70', [fg]: '#5a6a60' }, clean, 'clean');
    assert.ok(iss.some((i) => i.startsWith(`${fg} (#5a6a60) on --tint-${t} (#6a7a70)`)), `${fg} on --tint-${t} is reported`);
  }
  assert.ok(!themeIssues(dark, clean, 'clean').some((i) => /--tint-/.test(i)), 'readable text on the tints: no issue');
  // a dark theme that left the light default tints: the dark ink on... reported, so the fix pass sets them
  assert.ok(themeIssues({ '--bg': '#121417', '--ink': '#eef1f5', '--muted': '#a9b0bb', '--room-path': '#a9b0bb' }, clean, 'clean').some((i) => /on --tint-sage \(#eaf0e9\)/.test(i)));
  // Clean Office itself passes the tint pairs (built-ins are not repaired at run time)
  assert.deepStrictEqual(themeIssues({}, clean, 'clean'), [], 'the defaults pass every pair');
}

// FR-028 (R7): the art style guide, and warnings for art that is too small or too sparse
{
  const p = buildThemePrompt('x', clean);
  assert.ok(p.includes(ART_STYLE));
  assert.match(ART_STYLE, /Nothing thinner than about 3 px/);
  assert.match(ART_STYLE, /Fill the slot's main area/);
  assert.match(ART_STYLE, /One consistent palette/);
  assert.match(ART_STYLE, /Scenery evokes the look/);
  assert.match(ART_STYLE, /No text/);
  assert.deepStrictEqual(artWarnings('room-floor', '<rect x="0" y="40" width="320" height="78" fill="#b98a55"/>').length, 1, 'a floor of one shape is sparse');
  assert.match(artWarnings('room-floor', '<rect x="0" y="40" width="320" height="78" fill="#b98a55"/>')[0], /room-floor: sparse \(1 shape, at least 4 expected\)/);
  assert.strictEqual(artWarnings('lobby-art', '<path d="M0 0h4" /><path d="M0 0h4" /><path d="M0 0h4" /><path d="M0 0h4" /><path d="M0 0h4" />').length, 0);
  assert.ok(artWarnings('char-robe', '<path d="M60 70h30v20H60z" stroke="#000" stroke-width="0.4" fill="none"/><path d="M60 70h30" stroke="#000" stroke-width="0.4"/>').some((w) => /lines too thin/.test(w)));
  assert.ok(artWarnings('place-web', '<circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="0.5" fill="none"/>').some((w) => /too thin/.test(w)), 'icons: under 1');
  assert.strictEqual(artWarnings('place-web', '<circle cx="10" cy="10" r="6" stroke-width="1.5"/>').length, 0);
  assert.ok(artWarnings('char-headwear', '<rect x="70" y="30" width="2" height="2"/><rect x="74" y="30" width="2" height="2"/>').some((w) => /too small/.test(w)), 'all shapes under 3 units');
  assert.strictEqual(artWarnings('char-headwear', '<rect x="62" y="28" width="24" height="8" stroke-width="2"/><rect x="68" y="24" width="12" height="5"/>').length, 0, 'bold shapes pass; stroke-width is not a size');
  // the parser reports them to the person
  const r = parseGeneratedTheme(JSON.stringify({ ...light, art: { 'room-floor': '<rect x="0" y="40" width="320" height="78" fill="#b98a55"/>' } }), 'x', ctx);
  assert.ok(r.ok && r.warnings.some((w) => /room-floor: sparse/.test(w)));
}

// FR-029 (R11): place names fit a lobby tile
{
  assert.strictEqual(MAX_PLACE_NAME, 14);
  assert.strictEqual(fitPlaceName('Chart Room'), 'Chart Room');
  assert.strictEqual(fitPlaceName('Observation Deck Annex'), 'Observation');
  assert.strictEqual(fitPlaceName('Supercalifragilistic'), 'Supercalifragi');
  assert.strictEqual(fitPlaceName('Exactly14chars'), 'Exactly14chars');
  const p = buildThemePrompt('x', clean);
  assert.match(p, new RegExp(`"place-\\.\\.\\." name is shown on a lobby tile and must be at most ${MAX_PLACE_NAME} characters`));
  const r = parseGeneratedTheme(JSON.stringify({ ...light, words: { 'place-library': 'The Grand Reading Library', 'place-boss': 'Captain', 'door-close': 'Close the whole room for now please' } }), 'x', ctx);
  assert.ok(r.ok);
  if (r.ok) {
    const w = r.manifest.words as Record<string, string>;
    assert.strictEqual(w['place-library'], 'The Grand', 'cut to whole words that fit');
    assert.strictEqual(w['place-boss'], 'Captain');
    assert.strictEqual(w['door-close'], 'Close the whole room for now please', 'other words keep 40');
    assert.ok(r.warnings.some((x) => /place name shortened to fit a lobby tile \(14 characters\): place-library/.test(x)));
  }
}
console.log('themegen: ok');
