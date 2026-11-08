/** Contrast rules for user themes (spec 040 FR-017, FR-027; the AI theme maker was retired, FR-031): `themeIssues`, `CONTRAST_PAIRS`, `contrast`. `npm run test:themegen`. Specs 096 and 102 reuse them. */
import * as assert from 'assert';
import * as path from 'path';
import { CONTRAST_PAIRS, contrast, themeIssues } from '../src/shared/themegen';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string> };
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
console.log('themegen: ok');
