/**
 * Characters, separate from themes (spec 077 FR-064..FR-067, issue #814): who sits at the desks, chosen apart from the theme.
 * Pure rules shared by main (the settings file) and the tests; `src/renderer/theme.js` keeps the same list and `kitFor`
 * (it cannot import TS), and `test:characters` checks both answer alike.
 */

/** The Characters values, in the order Settings lists them. `theme` = the theme's own kit (the default, never written). */
export const CHARACTER_CHOICES = ['theme', 'office', 'minimalist', 'cheeky', 'prehistoric', 'pirate', 'monster', 'royal', 'rebels', 'retro'] as const;
export type CharacterChoice = (typeof CHARACTER_CHOICES)[number];

/** Spec 102 FR-320, FR-321: the values that name a Real office people set (Office people, Retro pixel), not a flat kit. Until Flat draws their heads (FR-203, T294) they draw the theme's own figures. */
export type SetChoice = 'office' | 'retro';
export const SET_CHOICES: readonly SetChoice[] = ['office', 'retro'];

/** The scene kit (spec 035 FR-013) each explicit choice draws. */
export const CHARACTER_KITS: Readonly<Record<Exclude<CharacterChoice, 'theme' | SetChoice>, string>> = { minimalist: 'office', cheeky: 'crew', prehistoric: 'crew', pirate: 'crew', monster: 'crew', royal: 'crew', rebels: 'crew' };

/** The theme id that was Cheeky Crew before FR-066; kept reserved, migrated by FR-067. */
export const LEGACY_CREW_THEME = 'cheeky-crew';

/** One of the list, or undefined for anything else (FR-064: a stored value that is not one of the list is dropped). */
export function parseCharacters(v: unknown): CharacterChoice | undefined {
  return typeof v === 'string' && (CHARACTER_CHOICES as readonly string[]).includes(v) ? (v as CharacterChoice) : undefined;
}

/** FR-065: the kit drawn for a theme's own kit and a choice. An unknown choice is the default (the theme's own). */
export function kitFor(themeKit: string | undefined, choice: unknown): string {
  const c = parseCharacters(choice);
  if (c && c !== 'theme' && !(SET_CHOICES as readonly string[]).includes(c)) return CHARACTER_KITS[c as Exclude<CharacterChoice, 'theme' | SetChoice>];
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

/**
 * Spec 102 FR-266 (T227): the second copy of `WORLD_FLAGS.retro` (src/renderer/crew.js; `test:characters` fails when they differ). While
 * closed, `SettingsStore.load` leaves a stored Retro Pixel theme alone. T230 removes both.
 */
export const RETRO_MIGRATION_OPEN = false;
/** The Characters value a Retro Pixel user gets (FR-266); it joins CHARACTER_CHOICES with T122. */
export const PIXEL_CHARACTERS = 'pixel';

/**
 * FR-266: a stored theme `retro` is removed (Clean Office) and Characters becomes `pixel` unless a choice is stored (kept, FR-202).
 * Removing the theme is the write that makes it run once: the result never holds `retro`, so a repeat changes nothing. `open` false
 * (the flag closed) changes nothing. Pure; reads and logs no value. `changed` says to write the file.
 */
export function migrateRetroTheme<T extends { theme?: string; characters?: string; retroMovePending?: true }>(s: T, open: boolean): { settings: T; changed: boolean } {
  if (!open || s.theme !== 'retro') return { settings: s, changed: false };
  const next = { ...s };
  delete next.theme;
  next.retroMovePending = true; // durable in the same save: the renderer half (T230) clears it once it has moved world, layout and light
  if (typeof s.characters !== 'string' || !s.characters) next.characters = PIXEL_CHARACTERS as T['characters'];
  return { settings: next, changed: true };
}
