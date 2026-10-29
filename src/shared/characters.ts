/**
 * Characters, separate from themes (spec 077 FR-064..FR-067, issue #814): who sits at the desks, chosen apart from the theme.
 * Pure rules shared by main (the settings file) and the tests; `src/renderer/theme.js` keeps the same list and `kitFor`
 * (it cannot import TS), and `test:characters` checks both answer alike.
 */

/** The Characters values, in the order Settings lists them. `theme` = the theme's own kit (the default, never written). */
export const CHARACTER_CHOICES = ['theme', 'minimalist', 'cheeky', 'prehistoric'] as const;
export type CharacterChoice = (typeof CHARACTER_CHOICES)[number];

/** The scene kit (spec 035 FR-013) each explicit choice draws. */
export const CHARACTER_KITS: Readonly<Record<Exclude<CharacterChoice, 'theme'>, string>> = { minimalist: 'office', cheeky: 'crew', prehistoric: 'crew' };

/** The theme id that was Cheeky Crew before FR-066; kept reserved, migrated by FR-067. */
export const LEGACY_CREW_THEME = 'cheeky-crew';

/** One of the list, or undefined for anything else (FR-064: a stored value that is not one of the list is dropped). */
export function parseCharacters(v: unknown): CharacterChoice | undefined {
  return typeof v === 'string' && (CHARACTER_CHOICES as readonly string[]).includes(v) ? (v as CharacterChoice) : undefined;
}

/** FR-065: the kit drawn for a theme's own kit and a choice. An unknown choice is the default (the theme's own). */
export function kitFor(themeKit: string | undefined, choice: unknown): string {
  const c = parseCharacters(choice);
  if (c && c !== 'theme') return CHARACTER_KITS[c];
  return themeKit || 'office';
}

/**
 * FR-067: the old Cheeky Crew theme becomes Clean Office (no `theme`) with Characters = Cheeky, unless a valid choice is stored
 * already (kept). `changed` says the input held the old id, so the caller writes the file once; the result never holds it.
 */
export function migrateLegacyTheme<T extends { theme?: string; characters?: CharacterChoice }>(s: T): { settings: T; changed: boolean } {
  if (s.theme !== LEGACY_CREW_THEME) return { settings: s, changed: false };
  const next = { ...s };
  delete next.theme;
  const keep = parseCharacters(s.characters);
  next.characters = keep && keep !== 'theme' ? keep : 'cheeky'; // 'theme' is the default and never written: it does not count as a choice
  return { settings: next, changed: true };
}
