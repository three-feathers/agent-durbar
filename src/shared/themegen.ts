/**
 * AI theme maker (spec 040 FR-014..FR-020, issue #182). Pure: the prompts for a harness, and turning a reply into a theme
 * manifest that keeps only safe values, with checks that are sent back to the model for up to three passes.
 * - Colours: every Clean Office token may be set (the model gets Clean's values as a reference), hex values only.
 * - Art: character, desk, monitor, plant, place, door and lobby slots as SVG fragments, each passed through the renderer's own
 *   sanitizer (injected, so this file stays pure and the result is exactly what the app will draw).
 * - Words: the scene words, short plain text.
 * The result then goes through `checkUserManifest` like any imported pack. The description is user text: never logged.
 */
import { checkUserManifest, SCENE_KITS, UI_STYLES } from './themes';

/** The scene words a generated theme may rename (spec 036 FR-003). */
export const GEN_WORDS: Record<string, string> = {
  'place-library': 'where agents read files (default "Library")',
  'place-software': 'where agents use package and code tools ("Software library")',
  'place-terminal': 'where agents run commands ("Terminal")',
  'place-web': 'where agents browse ("Web")',
  'place-other': 'other tools ("Other tools")',
  'lobby-label': 'the lobby caption ("Lobby: the places where agents work")',
  'door-close': 'button to close a room ("Close room")',
  'door-open': 'button to open a room ("Open room")',
};

/** Art slots a generated theme may draw, with where and how big (spec 040 FR-010, FR-020). */
export const GEN_ART: Record<string, string> = {
  'char-headwear': 'a hat or headdress on the person. Office scene coordinates (viewBox 0 0 200 124): the head is a circle at cx 74 cy 44 r 12.5, so a hat sits about y 24-36, x 60-88',
  'char-robe': 'clothing over the body: the torso spans about x 55-93, y 63-99 (a jacket, robe, uniform)',
  'char-collar': 'a collar, scarf or badge at the neck: about x 66-82, y 58-68',
  'char-body': 'an extra layer on the body behind the robe (optional), same area as char-robe',
  'hair-acc': 'a small hair accessory near the top of the head: about x 66-84, y 24-34',
  'desk-art': 'a small object on the desk top (y 78-86) between x 20 and 100, or a front panel on the desk front (y 93-114, x 15-185)',
  'monitor-art': 'a small frame or sticker on the monitor bezel ONLY (the bezel is x 112-176, y 32-77; keep x 116-172, y 36-73 clear: that is the screen that shows the agent state)',
  'plant': 'the potted plant in each room header: viewBox 0 0 26 30 (pot at the bottom, about y 20-30)',
  'place-library': 'icon for the Library place: viewBox 0 0 20 20, drawn with strokes (stroke="currentColor", fill="none", about 1.5 wide)',
  'place-software': 'icon for the Software library place: same as above',
  'place-terminal': 'icon for the Terminal place: same as above',
  'place-web': 'icon for the Web place: same as above',
  'place-other': 'icon for the Other tools place: same as above',
  'door-art': 'a small emblem on the room door: viewBox 0 0 20 20, the door is x 4-16, y 2.5-17.5',
  'lobby-art': 'a decorative band above the lobby: viewBox 0 0 320 36 (stretched to the lobby width)',
};
export const MAX_ART_CHARS = 4000;

/** Example looks shown in the dialog (a few at random) so people see how to describe one (spec 040 FR-021). */
export const THEME_IDEAS = [
  'a pirate ship at midnight', "a ship's bridge at dawn", 'a calm library at night', 'a night-shift newsroom', 'a Moroccan riad in the afternoon sun',
  'a Scandinavian design studio', 'a 1980s arcade', 'a Japanese tea house in spring', 'a space station control room', 'a cozy bakery at sunrise',
  'a botanical greenhouse', 'a jazz club in the 1950s', 'a desert observatory at dusk', 'a mountain ski lodge', 'a Bauhaus workshop',
  'an underwater research lab', 'a Victorian detective agency', 'a lavender field in Provence', 'a neon-lit Tokyo alley, but calm', 'a monastery scriptorium',
  'a beach shack in the tropics', 'an autumn forest cabin', 'a mid-century airport lounge', 'a chess club in Vienna',
];

/** `n` different ideas, picked with `rand` (Math.random by default). */
export function pickIdeas(n: number, rand: () => number = Math.random): string[] {
  const pool = THEME_IDEAS.slice();
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}
export const MAX_DESCRIPTION = 300;
export const MAX_PASSES = 3;

const svgRules = 'Each art value is an SVG fragment (no <svg> wrapper) using only g, path, rect, circle, ellipse, line, polyline, polygon, with attributes fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, opacity, d, x, y, width, height, rx, ry, cx, cy, r, x1, y1, x2, y2, points, transform. Colours in art may be hex or var(--token). No text, no images, no style, no scripts, no links, no url().';

/** Pass 1: the whole theme. `clean` = Clean Office's token values, sent as the reference for what each token is. */
export function buildThemePrompt(description: string, clean: Record<string, string>): string {
  const d = String(description ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);
  return [
    'Design a complete theme for "Agent Durbar", a desktop app that shows AI agents as people working at desks in the rooms of an office, with a lobby of places they walk to.',
    `The look the user wants: "${d}".`,
    'Reply with ONE JSON object and nothing else (no code fence, no explanation). Fields:',
    '- "name": a short theme name, at most 40 characters.',
    `- "ui": one of ${UI_STYLES.map((u) => JSON.stringify(u)).join(', ')} (the shape of buttons and panels; "retro" suits pixel and arcade looks, the court styles suit palaces).`,
    `- "scene": one of ${SCENE_KITS.map((u) => JSON.stringify(u)).join(', ')} (how people and furniture are drawn; only "office" shows your character art).`,
    '- "tokens": colours as hex like "#1a2b3c", for ALL of these keys. The value after each key is the default light theme, so you can see what the token is for:',
    Object.entries(clean).map(([k, v]) => `${k}=${v}`).join(' '),
    '- "words": short plain-text names (at most 40 characters) that fit the look, for:',
    ...Object.entries(GEN_WORDS).map(([k, v]) => `  ${k}: ${v}`),
    '- "art": SVG fragments for these slots (give the character a costume that fits the look):',
    ...Object.entries(GEN_ART).map(([k, v]) => `  ${k}: ${v}`),
    svgRules,
    'The UI style matters for the top bar: "corporate" and "retro" fill it with --ink and "court-indian"/"court-european" with --brand-bg, under FIXED light text, so those tokens must be dark there; "clean" and "court-japanese" use --surface and --ink. For a dark page, "clean" or "court-japanese" is the safe choice.',
    'Rules: light or dark are both fine, but be consistent: for a dark look set EVERY token, so nothing of the light default remains. Text must read well: --ink on --bg and --surface at least 4.5:1, --ink-2 on --surface 4.5:1, --muted on --surface 4.5:1, and each status pill text --pc-X on its background --pb-X at least 4.5:1. Keep the status meaning: working is blue-ish, thinking violet-ish, waiting amber, error red, done green, idle grey. Keep it calm: no neon on neon.',
  ].join('\n');
}

/** A retry after a reply that could not be used at all (no JSON, too few colours): the same request, with what went wrong. */
export function buildRetryPrompt(description: string, clean: Record<string, string>, error: string): string {
  return buildThemePrompt(description, clean) + `\nYour previous reply could not be used (${error}). Reply with ONE valid JSON object with all the fields, colours as "#rrggbb".`;
}

/** Pass 2 and 3: the model's own JSON back, with what failed the checks. The art is left out: the checks are about colours, and
 *  15 art slots of up to 4000 characters would make the prompt too long for one command line (Windows allows 32,767 characters
 *  in all). The art of the earlier pass is kept (`keepArt`). */
export function buildFixPrompt(previous: Record<string, unknown>, issues: string[]): string {
  const { art: _art, ...rest } = previous;
  return [
    'You made this theme for Agent Durbar (its art is not shown and is kept as it is):',
    JSON.stringify(rest),
    'It failed these checks:',
    ...issues.map((i) => '- ' + i),
    'Reply with the WHOLE corrected theme as ONE JSON object with name, ui, scene, tokens and words, nothing else; leave out art. Change only what is needed to pass; keep the look.',
  ].join('\n');
}

/** After a fix pass: the art of the pass before, when the fix left it out, if the theme still passes `checkUserManifest`. */
export function keepArt(next: Extract<GenResult, { ok: true }>, prev: Extract<GenResult, { ok: true }>): Extract<GenResult, { ok: true }> {
  if (next.manifest.art || !prev.manifest.art) return next;
  const manifest = { ...next.manifest, art: prev.manifest.art };
  if (!checkUserManifest(JSON.stringify(manifest)).ok) return { ...next, warnings: [...next.warnings, 'the art was left out: with it the theme failed the pack checks'] };
  return { ...next, manifest, raw: { ...next.raw, art: prev.raw.art } };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A colour as lower-case hex: hex as is, rgb()/rgba() converted (alpha kept); anything else undefined. */
export function toHex(v: string): string | undefined {
  if (HEX.test(v)) return v.toLowerCase();
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/i.exec(v);
  if (!m) return undefined;
  const ch = [m[1], m[2], m[3]].map(Number);
  if (ch.some((x) => x > 255)) return undefined;
  const a = m[4] !== undefined ? Math.round(Number(m[4]) * 255) : undefined;
  return '#' + [...ch, ...(a !== undefined && a < 255 ? [a] : [])].map((x) => x.toString(16).padStart(2, '0')).join('');
}
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

/** The pairs checked on every pass (FR-017): [text, background, minimum]. */
export const CONTRAST_PAIRS: Array<[string, string, number]> = [
  ['--ink', '--bg', 4.5], ['--ink', '--surface', 4.5], ['--ink', '--raised', 4.5], ['--ink', '--card', 4.5], ['--ink', '--card-waiting', 4.5], ['--ink', '--card-error', 4.5], ['--ink-2', '--soft', 4.5], ['--ink-2', '--note', 4.5], ['--ink-2', '--surface', 4.5], ['--muted', '--surface', 4.5] /* spec 052 FR-052: muted text is read, not decoration (was 3:1) */, ['--room-path', '--bg', 3],
  ...['working', 'thinking', 'waiting', 'idle', 'error', 'done'].map((s): [string, string, number] => [`--pc-${s}`, `--pb-${s}`, 4.5]),
  ['--drop-ink', '--drop-bg', 4.5], ['--brand-mark', '--brand-bg', 3], ['--idle-stub-ink', '--idle-stub', 3],
];

const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const plain = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[<>{}\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The first balanced `{…}` object in a reply (models sometimes add a fence or a sentence). */
export function firstJsonObject(text: string): unknown {
  const s = String(text ?? '');
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0;
    let inStr = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          return JSON.parse(s.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

export interface GenContext {
  /** Clean Office's tokens (name -> value): which keys exist, and the fallback for a key the reply leaves out. */
  clean: Record<string, string>;
  /** The renderer's art sanitizer (`theme.js` `_sanitizeSlot`): returns the rebuilt fragment, or null when it is refused. */
  sanitizeArt(svg: string): string | null;
  /** True when an id is already used (built-in or saved). */
  taken(id: string): boolean;
}

export type GenResult =
  | { ok: true; manifest: Record<string, unknown>; warnings: string[]; issues: string[]; raw: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * The top bar of some UI styles has fixed light text on a theme colour (themes.css): corporate and retro paint it with --ink,
 * the Indian and European courts with --brand-bg. [token behind the text, the fixed text colour].
 */
export const TOP_BAR: Record<string, [string, string]> = { corporate: ['--ink', '#ffffff'], retro: ['--ink', '#ffec27'], 'court-indian': ['--brand-bg', '#f6d58a'], 'court-european': ['--brand-bg', '#e8c873'] };
export const TOP_BAR_ISSUE = 'the top bar';

/** The problems a fix pass should solve (contrast, the top bar of the UI style, a dark page with light leftovers). Empty = good. */
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
  const tb = TOP_BAR[ui];
  const tbBg = tb ? c(tb[0]) : undefined;
  if (tb && tbBg && contrast(tb[1], tbBg) < 4.5) out.push(`${TOP_BAR_ISSUE}: with ui "${ui}" it is filled with ${tb[0]} (${tbBg}) under fixed light text ${tb[1]} (contrast ${contrast(tb[1], tbBg).toFixed(1)}:1, needs 4.5:1); make ${tb[0]} darker, or use ui "clean" or "court-japanese", whose top bar follows --surface and --ink`);
  const bg = c('--bg');
  if (bg && luminance(bg) < 0.2) {
    const missing = Object.keys(clean).filter((k) => !(k in tokens) && HEX.test(clean[k]) && luminance(clean[k]) > 0.6);
    if (missing.length) out.push(`the page is dark but these tokens keep the light default; set them for the dark look: ${missing.join(', ')}`);
  }
  return out;
}

/** A reply to a user theme manifest: only safe values, a unique `ai-…` id, the issues for a fix pass, then `checkUserManifest`. */
export function parseGeneratedTheme(reply: string, description: string, ctx: GenContext): GenResult {
  const o = firstJsonObject(reply);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'The reply had no theme in it (no JSON object).' };
  const r = o as Record<string, unknown>;
  const warnings: string[] = [];
  const name = plain(r.name, 40) || 'My AI theme';
  const base = ('ai-' + (slug(name) || 'theme')).slice(0, 60);
  let id = base;
  for (let n = 2; ctx.taken(id); n++) id = `${base}-${n}`.slice(0, 64);
  const ui = typeof r.ui === 'string' && UI_STYLES.includes(r.ui) ? r.ui : 'clean';
  const scene = typeof r.scene === 'string' && SCENE_KITS.includes(r.scene) ? r.scene : 'office';
  if (r.ui !== undefined && ui !== r.ui) warnings.push('unknown UI style, using clean');
  if (r.scene !== undefined && scene !== r.scene) warnings.push('unknown scene kit, using office');
  const tokens: Record<string, string> = {};
  const rt = r.tokens && typeof r.tokens === 'object' && !Array.isArray(r.tokens) ? (r.tokens as Record<string, unknown>) : {};
  let dropped = 0;
  for (const [k0, v] of Object.entries(rt)) {
    // spec 040 FR-015 (real, 2026-10-20): Copilot's `auto` wrote every token name without the leading `--` (`bg`, not `--bg`)
    const k = !k0.startsWith('--') && Object.prototype.hasOwnProperty.call(ctx.clean, '--' + k0) ? '--' + k0 : k0;
    if (!Object.prototype.hasOwnProperty.call(ctx.clean, k)) { dropped++; continue; }
    const hx = typeof v === 'string' ? toHex(v.trim()) : undefined;
    if (hx) tokens[k] = hx;
    else dropped++;
  }
  if (dropped) warnings.push(`${dropped} colour${dropped > 1 ? 's were' : ' was'} not usable and left out`);
  if (Object.keys(tokens).length < 4) return { ok: false, error: 'The reply had too few usable colours.' };
  const words: Record<string, string> = {};
  const rw = r.words && typeof r.words === 'object' && !Array.isArray(r.words) ? (r.words as Record<string, unknown>) : {};
  for (const k of Object.keys(GEN_WORDS)) {
    const w = plain(rw[k], 40);
    if (w) words[k] = w;
  }
  const art: Record<string, string> = {};
  const ra = r.art && typeof r.art === 'object' && !Array.isArray(r.art) ? (r.art as Record<string, unknown>) : {};
  const refused: string[] = [];
  for (const k of Object.keys(GEN_ART)) {
    const v = ra[k];
    if (typeof v !== 'string' || !v.trim()) continue;
    const clean = v.length <= MAX_ART_CHARS ? ctx.sanitizeArt(v) : null;
    if (clean) art[k] = clean;
    else refused.push(k);
  }
  if (refused.length) warnings.push(`art left out by the safety check: ${refused.join(', ')}`);
  const manifest: Record<string, unknown> = {
    id, name, author: 'AI theme maker', version: '1.0',
    description: String(description ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION),
    extends: 'clean-office', ui, scene, tokens, words,
    ...(Object.keys(art).length ? { art } : {}),
  };
  const v = checkUserManifest(JSON.stringify(manifest));
  if (!v.ok) return { ok: false, error: 'The theme did not pass the checks: ' + (v.error || 'invalid') };
  const raw = { name, ui, scene, tokens, words, ...(Object.keys(art).length ? { art: ra } : {}) };
  return { ok: true, manifest, warnings, issues: themeIssues(tokens, ctx.clean, ui), raw };
}

/** Issues that make a theme unusable even after the passes (text you cannot read). */
export const isBlocking = (issue: string): boolean => /^--(ink|ink-2|muted) /.test(issue);
