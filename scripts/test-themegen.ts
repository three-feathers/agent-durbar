/** AI theme maker (spec 040 FR-014..FR-020, #182): prompts, the safe subset, art through the renderer's sanitizer, contrast issues for fix passes, unique ids. `npm run test:themegen`. No model, no credits. */
import * as assert from 'assert';
import * as path from 'path';
import { CONTRAST_PAIRS, GEN_ART, GEN_WORDS, THEME_IDEAS, buildFixPrompt, buildRetryPrompt, keepArt, buildThemePrompt, contrast, firstJsonObject, isBlocking, parseGeneratedTheme, pickIdeas, themeIssues, toHex } from '../src/shared/themegen';
import { checkUserManifest, SCENE_KITS, UI_STYLES } from '../src/shared/themes';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string>; _sanitizeSlot(s: string): string | null; ART_SLOTS: string[] };
const clean = T._tokens(); // a fresh module: Clean Office's full token set
assert.ok(Object.keys(clean).length > 100, 'all of Clean Office');
const ctx = { clean, sanitizeArt: (s: string) => T._sanitizeSlot(s), taken: () => false };

const light = {
  name: 'Paper newsroom', ui: 'corporate', scene: 'office',
  tokens: { '--bg': '#eceff3', '--surface': '#fbfcfd', '--ink': '#1b2230', '--ink-2': '#3a4456', '--muted': '#5f6a7c', '--sage': '#3f7d6c', '--brand-bg': '#E0A84A', '--brand-mark': '#1b2230' },
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
    assert.strictEqual((m.tokens as Record<string, string>)['--brand-bg'], '#e0a84a');
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
    assert.strictEqual(w['place-library'], 'img onerror=xArchive');
    assert.strictEqual(w['door-close'], 'x');
    assert.strictEqual(w['place-other'].length, 40);
  }
}

// dark themes are allowed; light leftovers and bad pairs become issues for a fix pass
{
  const darkPartial = { name: 'Night', tokens: { '--bg': '#121417', '--surface': '#1b1e23', '--raised': '#23272d', '--card': '#1f2328', '--card-waiting': '#2b2614', '--card-error': '#2b1818', '--soft': '#1a1d21', '--note': '#1a1d21', '--ink': '#eef1f5', '--ink-2': '#c9ced6', '--muted': '#9aa2ad' } };
  const r = parseGeneratedTheme(JSON.stringify(darkPartial), 'x', ctx);
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(r.issues.some((i) => /the page is dark but these tokens keep the light default; set them for the dark look: .*--surface-2/.test(i)), 'light leftovers named');
    assert.ok(!r.issues.some(isBlocking), 'nothing blocking');
  }
  const full: Record<string, string> = {};
  for (const k of Object.keys(clean)) full[k] = '#20242a';
  Object.assign(full, { '--bg': '#121417', '--surface': '#1b1e23', '--ink': '#eef1f5', '--ink-2': '#c9ced6', '--muted': '#9aa2ad', '--room-path': '#9aa2ad', '--drop-ink': '#eef1f5', '--brand-mark': '#eef1f5', '--idle-stub-ink': '#eef1f5' });
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
  assert.strictEqual(CONTRAST_PAIRS.length, 20);
  // spec 052 FR-052: --muted on --surface needs 4.5:1 (was 3:1); #8a8f99 on white is about 3.3:1, now an issue
  assert.ok(CONTRAST_PAIRS.some(([a, b, m]) => a === '--muted' && b === '--surface' && m === 4.5));
  assert.ok(themeIssues({ '--surface': '#ffffff', '--muted': '#8a8f99' }, clean).some((i) => /^--muted \(#8a8f99\) on --surface/.test(i)));
  assert.ok(!themeIssues({ '--surface': '#ffffff', '--muted': '#5f6a7c' }, clean).some((i) => /^--muted /.test(i)));
  // the top bar of retro/corporate is --ink under fixed light text: a light --ink there is an issue; clean is fine
  const darkTok = { '--bg': '#101010', '--surface': '#181818', '--ink': '#f0f0f0', '--raised': '#202020', '--card': '#202020', '--card-waiting': '#2a2410', '--card-error': '#2a1414', '--soft': '#1c1c1c', '--note': '#1c1c1c' };
  assert.ok(themeIssues(darkTok, clean, 'retro').some((i) => /^the top bar: with ui "retro" it is filled with --ink/.test(i)));
  assert.ok(!themeIssues(darkTok, clean, 'clean').some((i) => /^the top bar/.test(i)));
  assert.ok(!themeIssues({ '--brand-bg': '#5a1a1a' }, clean, 'court-indian').some((i) => /^the top bar/.test(i)), 'a dark brand under gold text is fine');
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
}
console.log('themegen: ok');
