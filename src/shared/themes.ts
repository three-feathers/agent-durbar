/**
 * User theme packs (spec 040): validation used in main and in unit tests.
 * The renderer runs its own JS validator (theme.js); both enforce the same contract:
 * data-only manifest, id kebab-case ≤64 chars, manifest ≤64 KB, ≤40 tokens, ≤24 art slots, ≤24 words.
 */
import { parseThemeId } from './credits';

export const USER_THEME_LIMITS = {
  manifestBytes: 64 * 1024,
  maxTokens: 40,
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
  if (count(m.tokens) > USER_THEME_LIMITS.maxTokens) return { ok: false, error: 'too many tokens (max 40)' };
  if (count(m.art) > USER_THEME_LIMITS.maxArt) return { ok: false, error: 'too many art slots (max 24)' };
  if (count(m.words) > USER_THEME_LIMITS.maxWords) return { ok: false, error: 'too many words (max 24)' };
  return { ok: true, id, name, manifest: m };
}
