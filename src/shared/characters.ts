/**
 * Characters, separate from themes (spec 077 FR-064..FR-067, issue #814): who sits at the desks, chosen apart from the theme.
 * Pure rules shared by main (the settings file) and the tests; `src/renderer/theme.js` keeps the same list and `kitFor`
 * (it cannot import TS), and `test:characters` checks both answer alike.
 */

/** Spec 102 FR-266, FR-320: the stored Characters value that names the Retro pixel people (the SET is `retro`, `sets/retro`; T344 renames the value only if the owner confirms C1). Declared first: the list below uses it. */
export const PIXEL_CHARACTERS = 'pixel';

/**
 * The Characters values, in the order Settings lists them. `theme` = the theme's own kit (the default, never written). `mine` (spec 096 FR-040) is My characters; it works on
 * any theme, like the others. Settings offers it only once it can draw them (T042, T044): until then no window control can choose it (`test:characters`; spec `## Changes`, 2026-10-31).
 */
export const CHARACTER_CHOICES = ['theme', 'office', 'minimalist', 'cheeky', 'prehistoric', 'pirate', 'monster', 'royal', 'rebels', PIXEL_CHARACTERS, 'mine'] as const;
export type CharacterChoice = (typeof CHARACTER_CHOICES)[number];

/** Spec 102 FR-320, FR-321: the values that name a Real office people set (Office people, Retro pixel), not a flat kit. Flat draws the heads of `FLAT_HEAD_SETS` (FR-203; Retro pixel, T390); Office people since T391. */
export type SetChoice = 'office' | typeof PIXEL_CHARACTERS;
export const SET_CHOICES: readonly SetChoice[] = ['office', PIXEL_CHARACTERS];

/** The set values whose heads Flat draws (spec 102 FR-203, T390 Retro pixel, T391 Office people). */
export const FLAT_HEAD_SETS: readonly SetChoice[] = ['office', PIXEL_CHARACTERS];

/** The scene kit (spec 035 FR-013) each explicit choice draws; Retro pixel and Office people draw the crew kit's head crops of their sets (FR-203, T390, T391). */
export const CHARACTER_KITS: Readonly<Record<Exclude<CharacterChoice, 'theme'>, string>> = { office: 'crew', pixel: 'crew', minimalist: 'office', cheeky: 'crew', prehistoric: 'crew', pirate: 'crew', monster: 'crew', royal: 'crew', rebels: 'crew', mine: 'crew' };

/** The theme id that was Cheeky Crew before FR-066; kept reserved, migrated by FR-067. */
export const LEGACY_CREW_THEME = 'cheeky-crew';

/** One of the list, or undefined for anything else (FR-064: a stored value that is not one of the list is dropped). */
export function parseCharacters(v: unknown): CharacterChoice | undefined {
  return typeof v === 'string' && (CHARACTER_CHOICES as readonly string[]).includes(v) ? (v as CharacterChoice) : undefined;
}

/** FR-065: the kit drawn for a theme's own kit and a choice. An unknown choice is the default (the theme's own). */
export function kitFor(themeKit: string | undefined, choice: unknown): string {
  const c = parseCharacters(choice);
  if (c && c !== 'theme' && (!(SET_CHOICES as readonly string[]).includes(c) || (FLAT_HEAD_SETS as readonly string[]).includes(c))) return CHARACTER_KITS[c as Exclude<CharacterChoice, 'theme'>];
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
