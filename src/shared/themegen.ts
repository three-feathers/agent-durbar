/**
 * Contrast rules for user themes (spec 040 FR-017, FR-027; the AI theme maker that first used them was retired, FR-031):
 * the text pairs a theme must keep readable (`CONTRAST_PAIRS`, kept equal to theme.js by `test:theme-tokens`), the pairs
 * that matter in some UI styles (`UI_PAIRS`) and `themeIssues`, which lists what fails. Pure. Specs 096 and 102 reuse them.
 */
import { UI_STYLES } from './themes';
import { BAR_TOKENS } from './themetokens';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const hex6 = (h: string): string => {
  const s = h.slice(1);
  if (s.length === 3) return '#' + s.split('').map((c) => c + c).join('');
  return '#' + s.slice(0, 6);
};

/** CSS named colours (the 148 of CSS Color 4 without `transparent`); theme.js `NAMED` is the same list (test:theme-tokens). */
export const NAMED_COLOURS: Record<string, string> = Object.fromEntries('aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32'.split(',').map((p) => p.split(':') as [string, string]));
export type Rgba = [number, number, number, number];
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/**
 * Parse a colour the way a theme may write it (spec 070 FR-080): #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and hsl()/hsla() in the comma and
 * the space-and-slash syntax (numbers or percentages), a named colour and `transparent`. [r, g, b] are 0..255, alpha 0..1. null = a form that cannot be
 * resolved to one colour (currentColor, inherit, var(), color-mix(), calc(), an angle unit but deg, `none`): the caller reports it as unmeasured.
 */
export function parseColor(v: string): Rgba | null {
  const s = String(v).trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = /^#([0-9a-f]+)$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1]) as Rgba;
  }
  if (/^[a-z]+$/.test(s)) {
    const h = Object.prototype.hasOwnProperty.call(NAMED_COLOURS, s) ? NAMED_COLOURS[s] : undefined; // own property: `constructor` is not a colour
    return h ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([1]) as Rgba : null;
  }
  m = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(s);
  if (!m) return null;
  // CSS has two grammars and never mixes them: `a, b, c[, alpha]` or `a b c[ / alpha]`
  const body = m[2].trim();
  let args: string[];
  if (body.includes(',')) {
    if (body.includes('/')) return null;
    args = body.split(',').map((x) => x.trim());
    if (args.some((x) => !x)) return null;
  } else {
    const sp = /^([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)(?:\s*\/\s*([^\s/]+))?$/.exec(body);
    if (!sp) return null;
    args = sp.slice(1).filter((x) => x !== undefined);
  }
  if (args.length !== 3 && args.length !== 4) return null;
  const NUM = /^[+-]?(\d+\.?\d*|\.\d+)(%?)$/;
  const num = (a: string): [number, boolean] | null => { const n = NUM.exec(a); return n ? [parseFloat(a), n[2] === '%'] : null; };
  let alpha = 1;
  if (args.length === 4) { const a = num(args[3]); if (!a) return null; alpha = clamp(a[1] ? a[0] / 100 : a[0], 0, 1); }
  if (m[1].startsWith('rgb')) {
    const rgb: number[] = [];
    for (const a of args.slice(0, 3)) { const n = num(a); if (!n) return null; rgb.push(clamp(Math.round(n[1] ? n[0] * 2.55 : n[0]), 0, 255)); }
    return [rgb[0], rgb[1], rgb[2], alpha];
  }
  const hm = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg)?$/.exec(args[0]);
  const sm = num(args[1]), lm = num(args[2]);
  if (!hm || !sm || !lm || !sm[1] || !lm[1]) return null;
  const h = (((parseFloat(hm[1]) % 360) + 360) % 360) / 360, sat = clamp(sm[0], 0, 100) / 100, l = clamp(lm[0], 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const ch = (t0: number): number => { const t = (t0 + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((x) => Math.round(x * 255)).concat([alpha]) as Rgba;
}
/** A colour as opaque `#rrggbb`: its alpha composited over `over` (the page background, as `glassOver` composites a bar's glass); null if it cannot be parsed. */
export function resolveColor(v: string | undefined, over = '#ffffff'): string | null {
  if (v === undefined) return null;
  const c = parseColor(v);
  if (!c) return null;
  const o = parseColor(over) ?? [255, 255, 255, 1];
  return '#' + [0, 1, 2].map((i) => Math.round(c[i] * c[3] + o[i] * (1 - c[3])).toString(16).padStart(2, '0')).join('');
}

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

/** The opaque share of a glass fill on the bar (spec 097 FR-226); theme.js `WORLD_GLASS` is the same number. */
export const WORLD_GLASS = 0.9;
/**
 * The bar pairs of a world (spec 070 FR-053), the `--wb-*` ones of theme.js `WORLD_PAIRS`: [text, background, minimum, the backdrop the glass fill is
 * composited over]. Measured on the fill as it shows. The page pairs of a world's own set stay in theme.js (a pack's page is `CONTRAST_PAIRS`).
 */
export const BAR_PAIRS: Array<[string, string, number, string]> = [
  ['--wb-ink', '--wb-bg', 4.5, '#ffffff'], ['--wb-ink', '--wb-bg-2', 4.5, '#ffffff'], ['--wb-ink', '--wb-surface', 4.5, '#ffffff'], ['--wb-ink', '--wb-surface-2', 4.5, '#ffffff'],
  ['--wb-ink-2', '--wb-bg', 4.5, '#ffffff'], ['--wb-ink-2', '--wb-surface', 4.5, '#ffffff'], ['--wb-muted', '--wb-bg', 4.5, '#ffffff'], ['--wb-muted', '--wb-surface', 4.5, '#ffffff'],
  ['--wb-muted', '--wb-surface-2', 4.5, '#ffffff'], ['--wb-line-ctl', '--wb-surface', 3, '#ffffff'], ['--wb-warn-ink', '--wb-warn-bg', 4.5, '#ffffff'], ['--wb-ink', '--wb-warn-bg', 4.5, '#ffffff'],
  ['--wb-focus', '--wb-bg', 3, '#ffffff'], ['--wb-focus', '--wb-surface', 3, '#ffffff'],
];
/** A glass fill as it shows: `v` at WORLD_GLASS over `over`. */
export function glassOver(v: string, over: string): string {
  const a = hex6(v).slice(1), b = hex6(over).slice(1);
  return '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * WORLD_GLASS + parseInt(b.slice(i, i + 2), 16) * (1 - WORLD_GLASS)).toString(16).padStart(2, '0')).join('');
}

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
  const unmeasured = new Map<string, string>(); // token -> its value, for the pairs that could not be measured (spec 070 FR-080)
  const raw = (k: string): string | undefined => tokens[k] ?? clean[k];
  /** a token as opaque hex, its alpha composited over `over`; a value that cannot be resolved is remembered, not skipped silently */
  const c = (k: string, over: string): string | undefined => {
    const v = raw(k);
    if (v === undefined) return undefined;
    const r = resolveColor(v, k === '--bg' ? '#ffffff' : over); // the page is --bg over white, never over itself
    if (r === null) { unmeasured.set(k, v); return undefined; }
    return r;
  };
  const page = resolveColor(raw('--bg')) ?? '#ffffff'; // what a translucent surface is composited over
  /** [text, background] of a pair as opaque hex: the background over the page, the text over that background */
  const pair = (fg: string, bg: string): [string, string] | undefined => {
    const b = c(bg, page), a = b ? c(fg, b) : (c(fg, page), undefined);
    return a && b ? [a, b] : undefined;
  };
  const out: string[] = [];
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    const p = pair(fg, bg);
    if (!p) continue;
    const r = contrast(p[0], p[1]);
    if (r < min) out.push(`${fg} (${raw(fg)}) on ${bg} (${raw(bg)}) has contrast ${r.toFixed(1)}:1, needs ${min}:1`);
  }
  if (BRAND_UIS.includes(ui)) {
    for (const [fg, bg, min, why] of UI_PAIRS) {
      const p = pair(fg, bg);
      if (!p) continue;
      const r = contrast(p[0], p[1]);
      if (r < min) out.push(`${fg} (${p[0]}) on ${bg} (${p[1]}) has contrast ${r.toFixed(1)}:1, needs ${min}:1 (with ui "${ui}", ${why}); change ${fg === '--brand-mark' ? '--brand-mark' : '--brand-bg'}`);
    }
  }
  const tb = TOP_BAR[ui];
  const tbBg = tb ? c(tb[0], page) : undefined;
  if (tb && tbBg && contrast(tb[1], tbBg) < 4.5) out.push(`the top bar: with ui "${ui}" it is filled with ${tb[0]} (${tbBg}) under fixed light text ${tb[1]} (contrast ${contrast(tb[1], tbBg).toFixed(1)}:1, needs 4.5:1); make ${tb[0]} darker, or use ui "clean", whose top bar follows --surface and --ink`);
  if (Object.keys(tokens).some((k) => k in BAR_TOKENS)) {
    const w = (k: string, over: string): string | undefined => {
      const v = tokens[k] ?? BAR_TOKENS[k];
      if (v === undefined) return undefined;
      const r = resolveColor(v, over);
      if (r === null) { unmeasured.set(k, v); return undefined; }
      return r;
    };
    for (const [fg, bg, min, over] of BAR_PAIRS) {
      const b0 = w(bg, page);
      const glass = b0 ? glassOver(b0, over) : undefined;
      const a = glass ? w(fg, glass) : (w(fg, page), undefined);
      if (!a || !b0 || !glass) continue;
      const r = contrast(a, glass);
      if (r < min) out.push(`${fg} (${a}) on ${bg} (${b0}) has contrast ${r.toFixed(1)}:1 on the bar's glass, needs ${min}:1`);
    }
  }
  const bg = c('--bg', '#ffffff');
  if (bg && luminance(bg) < 0.2) {
    const missing = Object.keys(clean).filter((k) => !(k in tokens) && HEX.test(clean[k]) && luminance(clean[k]) > 0.6);
    if (missing.length) out.push(`the page is dark but these tokens keep the light default; set them for the dark look: ${missing.join(', ')}`);
  }
  // spec 070 FR-080: a value the check cannot resolve (currentColor, inherit, ...) is reported, never passed silently
  for (const [k, v] of unmeasured) out.push(`${k} (${v}) is in a contrast pair but is not a colour that can be measured, so its contrast is unmeasured; give it as a hex, rgb or hsl colour`);
  return out;
}
