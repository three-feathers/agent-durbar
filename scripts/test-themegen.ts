/** Contrast rules for user themes (spec 040 FR-017, FR-027; the AI theme maker was retired, FR-031): `themeIssues`, `CONTRAST_PAIRS`, `contrast`. `npm run test:themegen`. Specs 096 and 102 reuse them. */
import * as assert from 'assert';
import * as path from 'path';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { BRAND_HOVER_MIX, brandHoverTarget, COLOUR_HUE_RE, COLOUR_NUM_RE, CONTRAST_PAIRS, NAMED_COLOURS, contrast, mixHex, parseColor, resolveColor, themeIssues } from '../src/shared/themegen';
import { TOKEN_VALUE_MAX } from '../src/shared/themes';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string>; setTheme(m: unknown): string; setWorld(id: string | null): string | null; token(k: string): string; contrastCheck(m: unknown): string[]; fallbacks(id: string): { contrast: string[] } };
const clean = T._tokens(); // a fresh module: Clean Office's full token set
assert.ok(Object.keys(clean).length > 100, 'all of Clean Office');

// a dark theme that leaves light defaults behind: named for a fix, with the room tints too
{
  const issues = themeIssues({ '--bg': '#121417', '--surface': '#1b1e23', '--raised': '#23272d', '--ink': '#eef1f5', '--muted': '#a9b0bb', '--room-path': '#a9b0bb' }, clean);
  assert.ok(issues.some((i) => /the page is dark but these tokens keep the light default; set them for the dark look: .*--surface-2/.test(i)), 'light leftovers named');
  assert.ok(issues.some((i) => /^--ink \(.*\) on --tint-sage \(#eaf0e9\)/.test(i)), 'light room tints under light text are named');
}

// contrast issues name the pair
{
  const iss = themeIssues({ '--bg': '#ffffff', '--ink': '#dddddd', '--pb-error': '#fbe9e7', '--pc-error': '#f5c6c0' }, clean);
  assert.ok(iss.some((i) => /^--ink \(#dddddd\) on --bg \(#ffffff\)/.test(i)));
  assert.ok(iss.some((i) => /^--pc-error .* on --pb-error/.test(i)));
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
  assert.ok(!themeIssues({ '--brand-bg': '#6e3d00', '--brand-mark': '#ffffff' }, clean, 'retro').some((i) => /--brand-mark/.test(i)));
  // spec 052 FR-053 (issue #1614): the hovered primary button (--brand-bg with BRAND_HOVER_MIX of --brand-mark mixed in) keeps 4.5:1 too, in every ui that paints with --brand-bg
  assert.strictEqual(BRAND_HOVER_MIX, 0.14, 'the share themes.css and theme.js use');
  const hov = (mark: string, bg: string): number => contrast(mark, mixHex(bg, mark, BRAND_HOVER_MIX));
  // Clean Office's pale pair, inherited by a retro-ui user theme with no brand tokens (the check-user fixture): 3.83 at rest, 2.8 hovered with black, under 4.5 either way
  assert.ok(contrast(clean['--brand-mark'], clean['--brand-bg']) < 4.5, 'the pair a retro-ui theme inherits is under 4.5:1 at rest');
  const inherited = themeIssues({}, clean, 'retro');
  assert.ok(inherited.some((i) => /^--brand-mark .* on --brand-bg .* has contrast 3\.8:1, needs 4\.5:1/.test(i)), 'inherited pair at rest: ' + inherited.join('|'));
  assert.ok(inherited.some((i) => /^--brand-mark \(#[0-9a-f]{6}\) on the hovered --brand-bg \(#[0-9a-f]{6}\) has contrast [0-9.]+:1, needs 4\.5:1/.test(i)), 'inherited pair hovered: ' + inherited.join('|'));
  assert.ok(!themeIssues({}, clean, 'clean').some((i) => /hovered/.test(i)), 'ui clean does not paint a primary button with --brand-bg: no hover pair (Clean Office is pale on purpose)');
  // review of PR #1618 (finding 1): toward the text LOWERS the contrast of a dark or mid-tone fill with light text; the target is then away from the text, never below rest
  assert.ok(contrast('#ffffff', mixHex('#2a6a9a', '#ffffff', BRAND_HOVER_MIX)) < 4.5, 'dark-fill: toward white text is 4.31 on #2a6a9a (the failure itself)');
  assert.strictEqual(brandHoverTarget('#ffffff', '#2a6a9a'), '#000000', 'dark-fill: white text on #2a6a9a hovers toward black');
  assert.strictEqual(brandHoverTarget('#000000', '#808080'), '#ffffff', 'mid-fill: black text on #808080 hovers toward white');
  assert.strictEqual(brandHoverTarget('#3f6551', '#e4ece6'), '#3f6551', 'pale fill: the toward-text mix is kept where it reads');
  for (const [bg, mk] of [['#2a6a9a', '#ffffff'], ['#8a5a28', '#ffffff'], ['#808080', '#000000']]) {
    const issues = themeIssues({ '--brand-bg': bg, '--brand-mark': mk }, clean, 'retro').filter((i) => /^--brand-mark/.test(i));
    assert.deepStrictEqual(issues, [], `dark-fill ${bg} with ${mk}: the hover goes away from the text, no issue: ${issues.join('|')}`);
    assert.ok(contrast(mk, mixHex(bg, brandHoverTarget(mk, bg), BRAND_HOVER_MIX)) >= 4.5, `dark-fill ${bg}/${mk}: hovered at 4.5:1 or better with the chosen target`);
  }
  // an unfixable pair is reported: a mid fill with a mid text (rest under 4.5 and under it hovered either way)
  assert.ok(themeIssues({ '--brand-bg': '#808080', '--brand-mark': '#909090' }, clean, 'retro').some((i) => /on the hovered --brand-bg/.test(i)), 'an unreadable pair is reported hovered');
  assert.ok(!themeIssues({ '--brand-bg': '#e4ece6', '--brand-mark': '#244634' }, clean, 'retro').some((i) => /^--brand-mark/.test(i)), 'a dark enough mark passes both');
  // theme.js (the user-theme repair, the renderer's copy): a retro-ui theme with no brand tokens is repaired to 4.5:1 hovered, a clean-ui one is left alone, a built-in is never repaired
  const repaired = (ui: string): { fixed: string[]; mark: string; bg: string } => { T.setTheme({ id: 'hov-' + ui, name: 'H', version: '1.0', author: 't', ui, tokens: { '--bg': '#efe9dc' } }); return { fixed: T.contrastCheck({ id: 'hov-' + ui, name: 'H', version: '1.0', author: 't', ui, tokens: { '--bg': '#efe9dc' } }), mark: T.token('--brand-mark'), bg: T.token('--brand-bg') }; };
  const rr = repaired('retro');
  assert.ok(rr.fixed.includes('--brand-mark'), 'theme.js repairs --brand-mark in a retro-ui theme: ' + rr.fixed.join());
  assert.ok(contrast(rr.mark, rr.bg) >= 4.5 && hov(rr.mark, rr.bg) >= 4.5, `the repaired pair ${rr.mark} on ${rr.bg}: rest ${contrast(rr.mark, rr.bg).toFixed(2)}, hovered ${hov(rr.mark, rr.bg).toFixed(2)}`);
  assert.strictEqual(rr.bg, clean['--brand-bg'], 'the fill (a base surface) is not moved');
  assert.deepStrictEqual(themeIssues({ '--brand-bg': rr.bg, '--brand-mark': rr.mark }, clean, 'retro').filter((i) => /^--brand-mark/.test(i)), [], 'themegen agrees with the repair');
  // the fixture the simulator driver measures (check-user.json, ui retro, no brand tokens): the same repair
  T.setTheme(JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'themes', 'check-user.json'), 'utf8')));
  assert.ok(contrast(T.token('--brand-mark'), T.token('--brand-bg')) >= 4.5 && hov(T.token('--brand-mark'), T.token('--brand-bg')) >= 4.5, 'check-user.json: the primary button text is repaired to 4.5:1, rest and hovered');
  // review of PR #1618 (findings 1 and 2): the grid of 14 fills by 14 marks through theme.js's repair (retro ui): rest and hovered (the --brand-hover target the repair wrote) at 4.5:1 for EVERY pair, in themegen too
  const FILLS = ['#ffffff', '#e4ece6', '#c9d8cc', '#d9c7a8', '#ffd24a', '#808080', '#9a5b00', '#8a5a28', '#2a6a9a', '#3c7d5a', '#7a3f98', '#244634', '#1a1a2e', '#000000'];
  const MARKS = ['#ffffff', '#000000', '#f5f5f5', '#101010', '#808080', '#909090', '#4f7f65', '#d9c7a8', '#ffd24a', '#2a6a9a', '#8a5a28', '#e4ece6', '#7a3f98', '#cc3333'];
  let gridUnder = 0, gridUnderBefore = 0, gridN = 0;
  for (const bg of FILLS) for (const mk of MARKS) {
    gridN++;
    const man = { id: 'grid', name: 'G', version: '1.0', author: 't', ui: 'retro', tokens: { '--brand-bg': bg, '--brand-mark': mk } };
    T.setTheme({ ...man, id: 'grid-' + gridN });
    const m = T.token('--brand-mark'), b = T.token('--brand-bg'), h = T.token('--brand-hover');
    assert.ok(/^#[0-9a-f]{6}$/.test(h || ''), `grid: ${mk} on ${bg}: the repair wrote a --brand-hover target (got ${h})`);
    const rest = contrast(m, b), hovered = contrast(m, mixHex(b, h, BRAND_HOVER_MIX));
    if (rest < 4.5 || hovered < 4.5) gridUnder++;
    if (contrast(m, mixHex(b, m, BRAND_HOVER_MIX)) < 4.5) gridUnderBefore++; // the toward-text hover of the first version of this PR, on the same repaired text
    assert.ok(rest >= 4.5, `grid: ${mk} on ${bg}: repaired text ${m} reads ${rest.toFixed(2)}:1 at rest`);
    assert.ok(hovered >= 4.5, `grid: ${mk} on ${bg}: hovered fill reads ${hovered.toFixed(2)}:1 (target ${h})`);
    assert.ok(hovered >= rest - 0.01 || h === m, `grid: ${mk} on ${bg}: the hovered fill is not below rest unless it is the toward-text mix`);
    assert.strictEqual(h, brandHoverTarget(m, b), `grid: ${mk} on ${bg}: theme.js and themegen choose the same target`);
    assert.strictEqual(b, bg, `grid: ${bg} is not moved`);
  }
  assert.strictEqual(gridUnder, 0, 'grid: no pair under 4.5:1 after the repair');
  assert.ok(gridUnderBefore >= 10, `grid: the toward-text-only hover left ${gridUnderBefore} of ${gridN} pairs under 4.5:1 (the review found 42 on its grid)`);
  console.log(`themegen grid: ${gridN} pairs, ${gridUnderBefore} under 4.5:1 hovered toward the text only, ${gridUnder} after the repair`);
  // the three dark fills the review names, with the text the repair keeps
  for (const [bg, mk] of [['#2a6a9a', '#000000'], ['#8a5a28', '#000000'], ['#808080', '#ffffff']]) {
    T.setTheme({ id: 'dk-' + bg, name: 'D', version: '1.0', author: 't', ui: 'retro', tokens: { '--brand-bg': bg, '--brand-mark': mk } });
    const m = T.token('--brand-mark'), b = T.token('--brand-bg'), h = T.token('--brand-hover');
    assert.ok(contrast(m, b) >= 4.5 && contrast(m, mixHex(b, h, BRAND_HOVER_MIX)) >= 4.5, `dark fill ${bg}: text ${m} rest ${contrast(m, b).toFixed(2)}, hovered ${contrast(m, mixHex(b, h, BRAND_HOVER_MIX)).toFixed(2)} (target ${h})`);
  }
  // the least mix: a mid text on a mid fill is moved only as far as 4.5:1 at rest, not to pure black
  T.setTheme({ id: 'dk-mid', name: 'D', version: '1.0', author: 't', ui: 'retro', tokens: { '--brand-bg': '#808080', '--brand-mark': '#8a8a8a' } });
  assert.ok(T.token('--brand-mark') !== '#000000' && contrast(T.token('--brand-mark'), '#808080') < 5.2, `least mix: #8a8a8a on #808080 is repaired to ${T.token('--brand-mark')} (${contrast(T.token('--brand-mark'), '#808080').toFixed(2)}:1), not pushed to pure black`);
  T.setTheme({ id: 'dk-clean', name: 'D', version: '1.0', author: 't', ui: 'clean', tokens: { '--brand-bg': '#2a6a9a' } });
  assert.strictEqual(T.token('--brand-hover'), null, 'a clean-ui theme gets no hover target');
  const rc = repaired('clean');
  assert.ok(!rc.fixed.includes('--brand-mark') && rc.mark === clean['--brand-mark'], 'a clean-ui theme keeps Clean Office\'s own pale pair');
  // review round 2 of PR #1618 (finding 1): a --brand-mark written as a name, rgb() or hsl() is resolved before the hover target is chosen; setTheme never throws, and a value that is no colour is left (listed unmeasured)
  for (const mk of ['white', 'rgb(255,255,255)', 'hsl(0,0%,100%)', 'rgb(255 255 255 / 1)', 'WHITE', 'not-a-colour', 'currentColor', '']) {
    const man = { id: 'form-' + mk, name: 'F', version: '1.0', author: 't', ui: 'retro', tokens: { '--brand-bg': '#2a6a9a', '--brand-mark': mk } };
    assert.doesNotThrow(() => { T.setTheme(man); T.contrastCheck(man); T.fallbacks('form-' + mk); }, `a retro-ui theme with --brand-mark "${mk}" does not throw`);
    if (parseColor(mk)) {
      const h = T.token('--brand-hover'), m = T.token('--brand-mark');
      assert.strictEqual(h, '#000000', `"${mk}" on #2a6a9a: the resolved white hovers toward black (got ${h})`);
      assert.ok(contrast(resolveColor(m, '#2a6a9a') as string, '#2a6a9a') >= 4.5, `"${mk}" on #2a6a9a reads 4.5:1 at rest`);
    }
  }
  // review round 2 (finding 2): the least-mix search keeps the text at 4.5:1 at rest too (the review's pair: #ffa243 was 4.30 at rest, 4.51 hovered)
  const restHov = (bg: string, mk: string): [number, number] => {
    T.setTheme({ id: `rh-${bg}-${mk}`, name: 'R', version: '1.0', author: 't', ui: 'retro', tokens: { '--brand-bg': bg, '--brand-mark': mk } });
    const m = T.token('--brand-mark'), b = T.token('--brand-bg'), h = T.token('--brand-hover');
    return [contrast(m, b), contrast(m, mixHex(b, h, BRAND_HOVER_MIX))];
  };
  for (const [bg, mk] of [['#0000ff', '#ff8000'], ['#b20513', '#0dd89f']]) {
    const [rest, hovd] = restHov(bg, mk);
    assert.ok(rest >= 4.5 && hovd >= 4.5, `fixture ${mk} on ${bg}: rest ${rest.toFixed(3)}, hovered ${hovd.toFixed(3)}`);
  }
  // a seeded random grid (mulberry32), 4000 pairs, rest and hovered both at 4.5:1
  {
    let seed = 20261112;
    const rnd = (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const hx = (): string => '#' + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
    let n = 0, underRest = 0, underHov = 0, minRest = 99, minHov = 99;
    for (; n < 4000; n++) {
      const bg = hx(), mk = hx(), [rest, hovd] = restHov(bg, mk);
      minRest = Math.min(minRest, rest); minHov = Math.min(minHov, hovd);
      if (rest < 4.5) underRest++;
      if (hovd < 4.5) underHov++;
    }
    assert.strictEqual(underRest, 0, `random grid: ${underRest} of ${n} pairs under 4.5:1 at rest (min ${minRest.toFixed(3)})`);
    assert.strictEqual(underHov, 0, `random grid: ${underHov} of ${n} pairs under 4.5:1 hovered (min ${minHov.toFixed(3)})`);
    console.log(`themegen random grid: ${n} pairs (seed 20261112), under 4.5:1 at rest ${underRest} (min ${minRest.toFixed(3)}), hovered ${underHov} (min ${minHov.toFixed(3)})`);
  }
  // review round 2 (findings 4 and 5): --brand-hover on <html> follows the theme and the world (a stub document; theme.js only needs documentElement.style and .dataset)
  {
    const props = new Map<string, string>();
    const stub = { documentElement: { style: { setProperty: (k: string, v: string) => { props.set(k, v); }, removeProperty: (k: string) => { props.delete(k); } }, dataset: {} as Record<string, string> } };
    const g = globalThis as unknown as { document?: unknown };
    const had = g.document;
    g.document = stub;
    try {
      const user = (id: string, ui: string, tokens: Record<string, string>) => ({ id, name: id, version: '1.0', author: 't', ui, tokens });
      T.setTheme(user('st-retro', 'retro', { '--brand-bg': '#2a6a9a', '--brand-mark': '#ffffff' }));
      assert.strictEqual(props.get('--brand-hover'), '#000000', 'a retro-ui user theme sets --brand-hover on the root');
      T.setTheme(user('st-clean', 'clean', { '--brand-bg': '#2a6a9a' }));
      assert.strictEqual(props.has('--brand-hover'), false, 'a theme without --brand-hover after one with it clears the property');
      T.setTheme(user('st-retro2', 'retro', { '--brand-bg': '#2a6a9a', '--brand-mark': '#ffffff' }));
      T.setTheme('retro');
      assert.strictEqual(props.has('--brand-hover'), false, 'a built-in theme after a user theme clears it');
      T.setTheme(user('st-retro3', 'retro', { '--brand-bg': '#2a6a9a', '--brand-mark': '#ffffff' }));
      const W = T as unknown as { setWorld(id: string | null): string | null };
      W.setWorld('cave');
      assert.strictEqual(props.has('--brand-hover'), false, 'a world shown over a user theme removes its --brand-hover');
      W.setWorld(null);
      assert.strictEqual(props.get('--brand-hover'), '#000000', 'leaving the world brings the user theme\'s --brand-hover back');
      W.setWorld('retro');
      assert.strictEqual(props.has('--brand-hover'), false, 'the arcade over a user theme removes it too');
      W.setWorld(null);
    } finally { if (had === undefined) delete g.document; else g.document = had; }
  }
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
// spec 070 FR-080 (#1259): every colour form a theme may take is measured; one that cannot be is reported as unmeasured, never passed silently
{
  // one parse per form
  const eq = (v: string, want: number[]): void => assert.deepStrictEqual(parseColor(v)?.map((x) => Math.round(x * 1000) / 1000), want, v);
  eq('#fff', [255, 255, 255, 1]); eq('#1b2230', [27, 34, 48, 1]);
  eq('#f008', [255, 0, 0, 0.533]); eq('#ff000080', [255, 0, 0, 0.502]);
  eq('rgb(255, 0, 0)', [255, 0, 0, 1]); eq('rgb(255 0 0)', [255, 0, 0, 1]); eq('rgba(0,0,255,.5)', [0, 0, 255, 0.5]);
  eq('rgb(233 241 248 / .93)', [233, 241, 248, 0.93]); eq('rgb(100% 0% 0% / 50%)', [255, 0, 0, 0.5]); eq('RGB(300 -5 0)', [255, 0, 0, 1]);
  eq('hsl(0, 100%, 50%)', [255, 0, 0, 1]); eq('hsl(120deg 100% 25%)', [0, 128, 0, 1]); eq('hsla(240 100% 50% / .25)', [0, 0, 255, 0.25]); eq('hsl(0 0% 100%)', [255, 255, 255, 1]);
  eq('white', [255, 255, 255, 1]); eq('Rebeccapurple', [102, 51, 153, 1]); eq('transparent', [0, 0, 0, 0]);
  // what it cannot resolve is null: keywords, var(), color-mix(), calc(), an angle unit but deg, malformed
  for (const bad of ['currentColor', 'inherit', 'initial', 'none', 'notacolour', 'var(--x)', 'color-mix(in srgb, red 50%, blue)', 'rgb(calc(1+1) 0 0)', 'hsl(1turn 50% 50%)', 'hsl(0 50 50)', 'rgb(.5-50+9)', 'rgb(.5.5.5)', 'rgb(1 2)', '#12', '#12345', 'rgb(1 2 3 4 5)', '']) assert.strictEqual(parseColor(bad), null, bad);
  // all 148 CSS names: the table is pinned by a hash of "name:rrggbb" (sorted) computed from the npm `color-name` 1.1.4 table when this was written
  // (it is only a transitive dev dependency, so the test does not require it), plus values of the CSS Color 4 spec
  assert.strictEqual(Object.keys(NAMED_COLOURS).length, 148);
  const table = Object.keys(NAMED_COLOURS).sort().map((k) => `${k}:${NAMED_COLOURS[k]}`).join(',');
  assert.strictEqual(createHash('sha256').update(table).digest('hex'), '2e0dc585a01c414f086e17cbd8b1cbe39a1032e9757b57ac54b0d8cb304b70a4', 'the named colours are the CSS Color 4 table');
  for (const [k, v] of Object.entries({ red: [255, 0, 0], rebeccapurple: [102, 51, 153], lightgoldenrodyellow: [250, 250, 210], darkslategrey: [47, 79, 79], yellowgreen: [154, 205, 50] })) assert.deepStrictEqual(parseColor(k)?.slice(0, 3), v, k);
  // a name that is an Object.prototype member is not a colour (review of #1307: it used to throw)
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) { assert.strictEqual(parseColor(k), null, k); assert.doesNotThrow(() => themeIssues({ '--ink': k }, clean), k); }
  // the two grammars of rgb()/hsl() are not mixed (CSS rejects these, and the page falls back to an inherited colour)
  for (const bad of ['rgb(0 0 0 0)', 'rgb(0,,0,0)', 'rgb(0, 0 0)', 'rgb(0 0, 0)', 'rgb(0,0,0 / .5)', 'rgb(0 0 0 / )', 'rgb(0,0,0,)', 'rgb(0 0 0 / .5 / .5)', 'hsl(0 100% 50% 50%)']) assert.strictEqual(parseColor(bad), null, bad);
  for (const good of ['rgb(0 0 0/.5)', 'rgb( 0 , 0 , 0 )', 'rgb(0 0 0 / 50%)', 'rgba(1,2,3,.5)']) assert.notStrictEqual(parseColor(good), null, good);
  // alpha is clamped to 0..1
  for (const [v, a] of [['rgb(0 0 0 / 2)', 1], ['rgb(0 0 0 / -1)', 0], ['rgb(0 0 0 / 200%)', 1], ['rgba(0,0,0,5)', 1]] as Array<[string, number]>) assert.strictEqual(parseColor(v)?.[3], a, v);
  assert.strictEqual(resolveColor('rgb(0 0 0 / 2)'), '#000000'); assert.strictEqual(resolveColor('rgb(0 0 0 / -1)'), '#ffffff');
  // review of #1307, finding 1: forms Chromium rejects (CSS.supports false in Electron 44) are not colours, so they are reported unmeasured, not measured and passed.
  // The comma syntax takes three numbers or three percentages; a number never ends in a dot. The space syntax may mix numbers and percentages.
  for (const bad of ['rgb(72.549%, 199, 194)', 'rgb(50%, 100, 0)', 'rgba(10, 20%, 30, .5)', 'rgb(185. 199. 194.)', 'rgb(1. 2 3)', 'hsl(0 0% 100% / 1.)', 'hsl(1. 50% 50%)', 'rgb(0 0 0 / .5.)']) {
    assert.strictEqual(parseColor(bad), null, `${bad} is not a colour`);
    assert.ok(themeIssues({ '--ink': bad }, clean).some((i) => i.startsWith(`--ink (${bad}) is in a contrast pair but is not a colour that can be measured`)), `${bad} is reported unmeasured`);
  }
  for (const [good, want] of [['rgb(72.549% 199 194)', [185, 199, 194, 1]], ['rgb(50% 100 0 / 50%)', [128, 100, 0, 0.5]], ['rgb(10%, 20%, 30%, .5)', [26, 51, 77, 0.5]], ['rgb(1, 2, 3, 50%)', [1, 2, 3, 0.5]], ['rgb(.5 1.5 +2)', [1, 2, 2, 1]]] as Array<[string, number[]]>) eq(good, want);
  // finding 2: the number regexes are linear (\d+\.?\d* was quadratic), and parseColor refuses input longer than a token value (TOKEN_VALUE_MAX)
  assert.strictEqual(parseColor(`rgb(${'0'.repeat(TOKEN_VALUE_MAX)} 0 0)`), null, 'a value longer than TOKEN_VALUE_MAX is not parsed');
  assert.deepStrictEqual(parseColor(`rgb(${'0'.repeat(TOKEN_VALUE_MAX - 9)} 0 0)`), [0, 0, 0, 1], 'one of exactly TOKEN_VALUE_MAX is');
  {
    // CPU time (not wall clock) of failing matches on digits then 'x', the same number of characters on both sides: k runs on 2,000 digits
    // against k/8 runs on 16,000. Linear is a ratio of about 1 (under 1: fewer calls), quadratic (\d+\d*, or the old \d+\.?\d*) about 8; the limit is 3.
    // k is raised until the short side takes FLOOR_US, far above the CPU timer step (about 15.6 ms on Windows): the old check divided
    // by a 1 us baseline there, a timer read of 0, and failed linear code at "78000x" (spec 070 `## Changes` 2026-11-09). The ratio
    // never divides by less than half the floor. Best of three rounds and a round that passes stops, so load or a GC pause slows a round, not the verdict.
    const FLOOR_US = process.platform === 'win32' ? 250_000 : 20_000;
    const cpu = (re: RegExp, s: string, n: number): number => {
      const t0 = process.cpuUsage();
      for (let i = 0; i < n; i++) re.test(s);
      const d = process.cpuUsage(t0);
      return d.user + d.system;
    };
    for (const [name, re] of [['COLOUR_NUM_RE', COLOUR_NUM_RE], ['COLOUR_HUE_RE', COLOUR_HUE_RE]] as Array<[string, RegExp]>) {
      const s1 = '1'.repeat(2000) + 'x', s8 = '1'.repeat(16000) + 'x';
      let k = 8;
      while (cpu(re, s1, k) < FLOOR_US && k < 2 ** 24) k *= 2;
      let small = Infinity, big = Infinity;
      for (let r = 0; r < 3; r++) {
        small = Math.min(small, cpu(re, s1, k));
        big = Math.min(big, cpu(re, s8, k / 8));
        if (big / Math.max(small, FLOOR_US / 2) < 3) break;
      }
      const ratio = big / Math.max(small, FLOOR_US / 2);
      assert.ok(ratio < 3, `${name} grows linearly: the same characters in 8x longer inputs took ${ratio.toFixed(1)}x the CPU (${small} us for ${k} runs of ${s1.length}, ${big} us for ${k / 8} runs of ${s8.length}; linear is about 1, quadratic about 8, limit 3, floor ${FLOOR_US} us)`);
    }
  }
  // a translucent --bg is composited over white once: rgba(0,0,0,.5) paints #808080, so #111 ink reads 4.8:1 (it was measured on #404040, 1.8:1)
  assert.deepStrictEqual(themeIssues({ '--bg': 'rgba(0,0,0,.5)', '--ink': '#111111' }, clean).filter((i) => /^--ink .* on --bg/.test(i)), []);
  assert.ok(themeIssues({ '--bg': 'rgba(0,0,0,.5)', '--ink': '#444444' }, clean).some((i) => /^--ink .* on --bg/.test(i)), '#444 on #808080 fails');
  // translucent bar text is composited over the glass fill
  assert.ok(themeIssues({ '--wb-bg': '#000000', '--wb-bg-2': '#000000', '--wb-surface': '#000000', '--wb-surface-2': '#000000', '--wb-warn-bg': '#000000', '--wb-ink': 'rgba(255,255,255,.3)' }, clean).some((i) => i.startsWith('--wb-ink ')), 'faint bar text is caught');
  // a bar token that cannot be measured is reported
  assert.ok(themeIssues({ '--wb-ink': 'currentColor' }, clean).some((i) => i.startsWith('--wb-ink (currentColor) is in a contrast pair')), 'unmeasured --wb-ink');
  // alpha is composited over the page, not ignored
  assert.strictEqual(resolveColor('rgba(0,0,0,.5)', '#ffffff'), '#808080');
  assert.strictEqual(resolveColor('#ff000000', '#00ff00'), '#00ff00');
  assert.strictEqual(resolveColor('transparent', '#123456'), '#123456');
  assert.strictEqual(resolveColor('currentColor'), null);

  // the bug: a failing pair written as rgb(), hsl(), a name or with alpha is now caught, exactly as its hex twin
  const hexIss = themeIssues({ '--bg': '#ffffff', '--ink': '#dddddd' }, clean);
  assert.ok(hexIss.some((i) => /^--ink \(#dddddd\) on --bg/.test(i)), 'baseline: hex');
  for (const ink of ['rgb(221, 221, 221)', 'rgb(221 221 221)', 'hsl(0 0% 86.67%)', 'gainsboro', 'rgba(0, 0, 0, 0.13)']) {
    const iss = themeIssues({ '--bg': 'white', '--ink': ink }, clean);
    assert.ok(iss.some((i) => i.startsWith(`--ink (${ink}) on --bg (white) has contrast`)), `${ink} on white is caught: ${iss.join('|')}`);
  }
  assert.ok(themeIssues({ '--bg': 'rgb(255 255 255)', '--ink': 'rgb(51 51 51)' }, clean).every((i) => !/^--ink /.test(i)), 'a readable rgb() pair has no issue');
  // a translucent text colour is measured on its surface: black at 20% on white is about 1.6:1
  assert.ok(themeIssues({ '--bg': '#ffffff', '--surface': '#ffffff', '--ink': 'rgba(0,0,0,.2)' }, clean).some((i) => /^--ink \(rgba\(0,0,0,.2\)\) on --surface/.test(i)), 'alpha text');
  // a translucent surface is measured over the page: white at 10% over a black page leaves a near-black surface, so dark ink on it fails
  assert.ok(themeIssues({ '--bg': '#000000', '--surface': 'rgba(255,255,255,.1)', '--ink': '#222222' }, clean).some((i) => /^--ink \(#222222\) on --surface/.test(i)), 'alpha surface over the page');
  // 8-digit hex alpha is no longer ignored
  assert.ok(themeIssues({ '--bg': '#ffffff', '--surface': '#ffffff', '--ink': '#00000033' }, clean).some((i) => /^--ink \(#00000033\) on --surface/.test(i)), '#rrggbbaa text');
  // unmeasured: reported by name and value
  for (const v of ['currentColor', 'inherit', 'banana']) {
    const iss = themeIssues({ '--bg': '#ffffff', '--ink': v }, clean);
    assert.ok(iss.some((i) => i.startsWith(`--ink (${v}) is in a contrast pair but is not a colour that can be measured, so its contrast is unmeasured`)), `${v} reported: ${iss.join('|')}`);
  }
  assert.deepStrictEqual(themeIssues({ '--drop-bg': 'rgb(233 241 248 / .93)' }, clean), [], 'the shipped drop-bg form measures fine and passes');
  assert.ok(!themeIssues({ '--ink': '#222222' }, clean).some((i) => /unmeasured/.test(i)), 'nothing unmeasured by default');
}
console.log('themegen: ok');
