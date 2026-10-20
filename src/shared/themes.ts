/**
 * User theme packs (spec 040): validation used in main and in unit tests.
 * The renderer runs its own JS validator (theme.js); both enforce the same contract:
 * data-only manifest, id kebab-case ≤64 chars, manifest ≤64 KB, ≤160 tokens, ≤24 art slots, ≤24 words.
 */
import { parseThemeId } from './credits';

export const USER_THEME_LIMITS = {
  manifestBytes: 64 * 1024,
  maxTokens: 160, // every Clean Office token (135) fits: a full dark look needs them (spec 040 FR-020; was 40)
  maxArt: 24,
  maxWords: 24,
  maxFiles: 8,
  maxFileBytes: 64 * 1024,
};

export interface UserThemeCheck {
  ok: boolean;
  error?: string;
  id?: string;
  name?: string;
  manifest?: Record<string, unknown>;
}

/**
 * Token grammar (spec 040 FR-006), the same as `isTokenValue` in theme.js: a colour, a number with an optional unit or one
 * keyword, at most 64 characters. Keys must be `--name`. Returns the first offending key, or null.
 */
const TOKEN_KEY_RE = /^--[a-z0-9-]{1,48}$/;
const TOKEN_VALUE_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9a-z., %/+-]*\)|-?[0-9]*\.?[0-9]+(px|em|rem|%|s|ms|deg)?|[a-z][a-z-]*)$/i;
export function badToken(tokens: unknown): string | null {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
  for (const [k, v] of Object.entries(tokens as Record<string, unknown>)) {
    if (!TOKEN_KEY_RE.test(k)) return JSON.stringify(k.slice(0, 40));
    if (typeof v !== 'string' || v.trim().length > 64 || !TOKEN_VALUE_RE.test(v.trim())) return k;
  }
  return null;
}

/** UI styles a manifest may name (spec 035 FR-009); the same list as `UI_STYLES` in theme.js. */
/** Art slots the renderer draws (spec 040 FR-010); the same list as `ART_SLOTS` in theme.js. */
export const ART_SLOTS = ['plant', 'room-back-wall', 'room-back-window', 'room-floor', 'lobby-art', 'door-art',
  'place-library', 'place-software', 'place-terminal', 'place-web', 'place-other',
  'char-body', 'char-robe', 'char-headwear', 'char-collar', 'desk-back', 'desk-art', 'monitor-art', 'hair-acc'];
/** Scene kits a manifest may name (spec 035 FR-013); the same list as `SCENE_KITS` in theme.js. */
export const SCENE_KITS = ['office', 'corporate', 'pixel', 'court-indian', 'court-european', 'court-japanese'];
export const UI_STYLES = ['clean', 'corporate', 'retro', 'court-indian', 'court-european', 'court-japanese'];

/** Validate one manifest.json text. Never throws. */
export function checkUserManifest(text: string): UserThemeCheck {
  if (text.length > USER_THEME_LIMITS.manifestBytes) return { ok: false, error: 'manifest.json is over 64 KB' };
  let doc: unknown = null;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'manifest.json is not JSON' };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'manifest.json is not an object' };
  const m = doc as Record<string, unknown>;
  const id = parseThemeId(m.id);
  if (!id) return { ok: false, error: 'a theme needs an id like "my-office" (lowercase letters, digits, - and _)' };
  const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 60) : id;
  const count = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as object).length : 0);
  if (count(m.tokens) > USER_THEME_LIMITS.maxTokens) return { ok: false, error: 'too many tokens (max ' + USER_THEME_LIMITS.maxTokens + ')' };
  if (count(m.art) > USER_THEME_LIMITS.maxArt) return { ok: false, error: 'too many art slots (max 24)' };
  if (count(m.words) > USER_THEME_LIMITS.maxWords) return { ok: false, error: 'too many words (max 24)' };
  if (m.ui !== undefined && !(typeof m.ui === 'string' && UI_STYLES.includes(m.ui))) return { ok: false, error: 'ui must be one of: ' + UI_STYLES.join(', ') };
  if (m.scene !== undefined && !(typeof m.scene === 'string' && SCENE_KITS.includes(m.scene))) return { ok: false, error: 'scene must be one of: ' + SCENE_KITS.join(', ') };
  const art = m.art && typeof m.art === 'object' && !Array.isArray(m.art) ? Object.keys(m.art as object) : [];
  const unknownSlot = art.find((k) => !ART_SLOTS.includes(k));
  if (unknownSlot !== undefined) return { ok: false, error: 'art slot ' + JSON.stringify(unknownSlot.slice(0, 40)) + ' is not one the app draws' };
  const bad = badToken(m.tokens);
  if (bad) return { ok: false, error: 'token ' + bad + ' is not allowed (keys are --names; values are a colour, a number or one word)' };
  return { ok: true, id, name, manifest: m };
}
