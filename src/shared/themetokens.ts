/**
 * Typed theme tokens (spec 070 FR-001..FR-003): fonts from an allow-list of system fonts (no URL, no font file), the title weight,
 * radii and shadows. Pure, no imports. The renderer's `theme.js` has the same lists and grammar (it cannot import this file in the page
 * and main loads it for the AI maker); `test:theme-tokens` runs both on one corpus and fails if they differ.
 */
export type TokenType = 'font' | 'weight' | 'radius' | 'shadow';
export interface TypedToken { type: TokenType; def: string; generic?: string }

export const FONT_GENERIC = ['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-serif', 'ui-sans-serif', 'ui-rounded'];
export const FONT_ALLOW = FONT_GENERIC.concat(['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Helvetica', 'Arial', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Georgia', 'Palatino Linotype', 'Palatino', 'Book Antiqua', 'URW Palladio L', 'P052', 'Times New Roman', 'Garamond', 'EB Garamond',
  'Baskerville', 'Baskerville Old Face', 'Libre Baskerville', 'Cambria', 'Calibri', 'Candara', 'Corbel', 'Gill Sans', 'Optima', 'Futura', 'Avenir',
  'Avenir Next', 'Didot', 'American Typewriter', 'Courier New', 'Consolas', 'Menlo', 'Monaco', 'SF Mono', 'SFMono-Regular', 'Cascadia Mono',
  'Cascadia Code', 'Roboto', 'Noto Sans', 'Noto Serif', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif',
  'Liberation Mono', 'Ubuntu', 'Ubuntu Mono', 'Cantarell', 'Comic Neue', 'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'Noto Serif CJK JP',
  'Noto Serif JP', 'Source Han Serif']);
/** A Map, not a plain object: a name such as `constructor` or `__proto__` must not reach Object.prototype (review on #500). */
const FONT_INDEX: ReadonlyMap<string, string> = new Map(FONT_ALLOW.map((f) => [f.toLowerCase(), f]));

export const TYPED_TOKENS: Record<string, TypedToken> = {
  '--font': { type: 'font', def: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif', generic: 'sans-serif' },
  '--ui-display': { type: 'font', def: 'system-ui', generic: 'system-ui' },
  '--font-mono': { type: 'font', def: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', generic: 'monospace' },
  '--t1-weight': { type: 'weight', def: '650' },
  '--r-sm': { type: 'radius', def: '6px' }, '--r-md': { type: 'radius', def: '10px' }, '--r-lg': { type: 'radius', def: '14px' }, '--r-xl': { type: 'radius', def: '18px' },
  '--radius': { type: 'radius', def: '16px' },
  '--shadow-card': { type: 'shadow', def: 'none' }, '--shadow-pop': { type: 'shadow', def: '0 14px 40px rgba(40,35,25,.22)' },
};

/** Markup or CSS syntax in a value: a crafted pack (spec 070 D6, FR-020). */
export const HOSTILE_RE = /[<>{};\\@]|url\s*\(|expression\s*\(|var\s*\(/i;
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|rgba|hsl|hsla)\((?:[0-9.%\s,/+-]|deg)+\)|transparent)$/i;
const LEN_RE = /^(-?\d{1,2}(?:\.\d{1,2})?px|0)$/;
const lenPx = (v: string): number => (v === '0' ? 0 : parseFloat(v));

function fontStack(v: string, generic: string): string | null {
  const names = v.split(',').map((x) => x.trim()).filter(Boolean);
  if (!names.length || names.length > 8) return null;
  const out: string[] = [];
  for (let n of names) {
    const q = /^(["'])(.*)\1$/.exec(n);
    if (q) n = q[2].trim();
    if (!/^[A-Za-z0-9 -]{1,40}$/.test(n)) return null;
    const canon = FONT_INDEX.get(n.toLowerCase());
    if (!canon) return null;
    out.push(/\s/.test(canon) ? '"' + canon + '"' : canon);
  }
  if (!out.some((n) => FONT_GENERIC.includes(n))) out.push(generic);
  return out.join(',');
}

function shadowValue(v: string): string | null {
  if (v === 'none') return v;
  const layers = v.split(/,(?![^(]*\))/).map((x) => x.trim());
  if (!layers.length || layers.length > 2) return null;
  for (const l of layers) {
    const parts = l.split(/\s+(?![^(]*\))/);
    if (parts[0] === 'inset') parts.shift();
    const color = parts.pop();
    if (!color || !COLOR_RE.test(color) || (parts.length !== 3 && parts.length !== 4) || !parts.every((x) => LEN_RE.test(x))) return null;
    const [x, y, b, sp] = parts.map(lenPx);
    if (Math.abs(x) > 40 || Math.abs(y) > 40 || b < 0 || b > 64 || (sp !== undefined && Math.abs(sp) > 24)) return null;
  }
  return layers.join(',');
}

/** A typed token's value as it is applied, or null (wrong type, out of range, a font not on the list, hostile). */
export function typedValue(key: string, v: unknown): string | null {
  const spec = Object.prototype.hasOwnProperty.call(TYPED_TOKENS, key) ? TYPED_TOKENS[key] : undefined;
  if (!spec || typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 160 || HOSTILE_RE.test(t)) return null;
  if (spec.type === 'font') return fontStack(t, spec.generic || 'sans-serif');
  if (spec.type === 'weight') return /^(500|550|600|650|700|750|800)$/.test(t) ? t : null;
  if (spec.type === 'radius') return LEN_RE.test(t) && lenPx(t) >= 0 && lenPx(t) <= 24 ? t : null;
  if (spec.type === 'shadow') return shadowValue(t);
  return null;
}
