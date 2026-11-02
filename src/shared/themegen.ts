/**
 * Contrast rules for user themes (spec 040 FR-017, FR-027; the AI theme maker that first used them was retired, FR-031):
 * the text pairs a theme must keep readable (`CONTRAST_PAIRS`, kept equal to theme.js by `test:theme-tokens`), the pairs
 * that matter in some UI styles (`UI_PAIRS`) and `themeIssues`, which lists what fails. Pure. Specs 096 and 102 reuse them.
 */
import { UI_STYLES } from './themes';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const hex6 = (h: string): string => {
  const s = h.slice(1);
  if (s.length === 3) return '#' + s.split('').map((c) => c + c).join('');
  return '#' + s.slice(0, 6);
};

/** Relative luminance of a `#rgb`, `#rrggbb` or `#rrggbbaa` colour (WCAG; alpha ignored). */
export function luminance(hex: string): number {
  const h = hex6(hex).slice(1);
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TINTS = ['sage', 'blue', 'sand', 'clay'];
/** The pairs checked on every pass (FR-017): [text, background, minimum]. */
export const CONTRAST_PAIRS: Array<[string, string, number]> = [
  ['--ink', '--bg', 4.5], ['--ink', '--surface', 4.5], ['--ink', '--raised', 4.5], ['--ink', '--card', 4.5], ['--ink', '--card-waiting', 4.5], ['--ink', '--card-error', 4.5], ['--ink-2', '--soft', 4.5], ['--ink-2', '--note', 4.5], ['--ink-2', '--surface', 4.5], ['--muted', '--surface', 4.5] /* spec 052 FR-052: muted text is read, not decoration (was 3:1) */, ['--room-path', '--bg', 3],
  ...['working', 'thinking', 'waiting', 'idle', 'error', 'done'].map((s): [string, string, number] => [`--pc-${s}`, `--pb-${s}`, 4.5]),
  ['--surface', '--sage-ink', 4.5], ['--surface', '--red-ink', 4.5], ['--surface', '--amber-ink', 4.5] /* spec 052 FR-169: the text of a primary, danger or warn button is --surface on these three */,
  ['--drop-ink', '--drop-bg', 4.5], ['--brand-mark', '--brand-bg', 3], ['--idle-stub-ink', '--idle-stub', 3],
  ['--desk-new', '--card', 3], ['--desk-needs', '--card-waiting', 3] /* spec 001 FR-178: the glow of a New desk and of a desk that needs you shows on its card */,
  // spec 040 FR-027 (#903): the text of a room header and a desk sits on the room tint, not on --bg (the audit found paths at 2.5 to 3.0:1 in dark themes)
  ...TINTS.flatMap((t): Array<[string, string, number]> => [['--room-path', `--tint-${t}`, 4.5], ['--muted', `--tint-${t}`, 4.5], ['--ink', `--tint-${t}`, 4.5]]),
];

/**
 * Pairs that matter only in some UI styles (spec 040 FR-027). `--brand-bg` fills the lobby tile icons and the primary buttons in every style
 * but "clean" (themes.css), so it must stand out from the tile (--raised, and --bg behind it: non-text 3:1, WCAG 1.4.11) and carry the
 * button text (--brand-mark, 4.5:1). Clean Office's own --brand-bg is a pale tint on purpose, so these are not in CONTRAST_PAIRS.
 * [fg, bg, minimum, what it is for].
 */
export const UI_PAIRS: Array<[string, string, number, string]> = [
  ['--brand-bg', '--raised', 3, 'the lobby tile icons are painted with --brand-bg on --raised'],
  ['--brand-bg', '--bg', 3, 'the lobby tile icons are painted with --brand-bg on a mix of --raised and --bg'],
  ['--brand-mark', '--brand-bg', 4.5, 'the text of a primary button is --brand-mark on --brand-bg'],
];
/** The UI styles that paint with --brand-bg (every one but "clean"). */
export const BRAND_UIS = UI_STYLES.filter((u) => u !== 'clean');

/**
 * The top bar of some UI styles has fixed light text on a theme colour (themes.css): retro paints it with --ink.
 * [token behind the text, the fixed text colour].
 */
export const TOP_BAR: Record<string, [string, string]> = { retro: ['--ink', '#ffec27'] };

/** The problems with a theme's colours (contrast, the top bar of the UI style, a dark page with light leftovers). Empty = good. */
export function themeIssues(tokens: Record<string, string>, clean: Record<string, string>, ui = 'clean'): string[] {
  const c = (k: string): string | undefined => {
    const v = tokens[k] ?? clean[k];
    return v && HEX.test(v) ? v : undefined;
  };
  const out: string[] = [];
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    const a = c(fg), b = c(bg);
    if (!a || !b) continue;
    const r = contrast(a, b);
    if (r < min) out.push(`${fg} (${tokens[fg] ?? clean[fg]}) on ${bg} (${tokens[bg] ?? clean[bg]}) has contrast ${r.toFixed(1)}:1, needs ${min}:1`);
  }
  if (BRAND_UIS.includes(ui)) {
    for (const [fg, bg, min, why] of UI_PAIRS) {
      const a = c(fg), b = c(bg);
      if (!a || !b) continue;
      const r = contrast(a, b);
      if (r < min) out.push(`${fg} (${a}) on ${bg} (${b}) has contrast ${r.toFixed(1)}:1, needs ${min}:1 (with ui "${ui}", ${why}); change ${fg === '--brand-mark' ? '--brand-mark' : '--brand-bg'}`);
    }
  }
  const tb = TOP_BAR[ui];
  const tbBg = tb ? c(tb[0]) : undefined;
  if (tb && tbBg && contrast(tb[1], tbBg) < 4.5) out.push(`the top bar: with ui "${ui}" it is filled with ${tb[0]} (${tbBg}) under fixed light text ${tb[1]} (contrast ${contrast(tb[1], tbBg).toFixed(1)}:1, needs 4.5:1); make ${tb[0]} darker, or use ui "clean", whose top bar follows --surface and --ink`);
  const bg = c('--bg');
  if (bg && luminance(bg) < 0.2) {
    const missing = Object.keys(clean).filter((k) => !(k in tokens) && HEX.test(clean[k]) && luminance(clean[k]) > 0.6);
    if (missing.length) out.push(`the page is dark but these tokens keep the light default; set them for the dark look: ${missing.join(', ')}`);
  }
  return out;
}
