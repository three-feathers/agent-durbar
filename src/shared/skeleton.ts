/**
 * The letter skeleton of spec 111 FR-158 (T032): a **hand-written, closed, best-effort** table that maps letters which look Latin to the
 * Latin letter they look like, so two names that read the same compare equal (`nameKey`) and the frame guard of FR-012 sees through
 * them. NOT a full confusables set, by design (spec 003 owner decision 3: closed lists only): no rule is added beyond the ones below.
 * Pure: no Electron, no DOM, no import. Keys: every letter of `CYRL_LOOK` and `GREK_LOOK` (`src/renderer/lookalike.js`, spec 003
 * FR-113..FR-116; `test:skeleton` checks the keys EQUAL those lists) and the part of `LATIN_LOOK` (a range test over about 580 code
 * points) that has an obvious Latin letter (the test checks the keys are a SUBSET of it). Code points without an entry stay as they are.
 * Honest limits: a name made only of lookalike letters (`Оса`, `ΑΝΑ`) gets the same key as a Latin one (accepted); not run on Windows or macOS (pure).
 */

/** Code point -> the Latin letter it resembles (an upper-case look gives an upper-case letter). */
export const SKELETON_MAP: ReadonlyMap<number, string> = new Map<number, string>([
  // Cyrillic, lower case (CYRL_LOOK)
  [0x430, 'a'], [0x441, 'c'], [0x435, 'e'], [0x4bb, 'h'], [0x456, 'i'], [0x458, 'j'], [0x43e, 'o'], [0x440, 'p'], [0x455, 's'],
  [0x443, 'y'], [0x445, 'x'], [0x501, 'd'], [0x51b, 'q'], [0x51d, 'w'], [0x4cf, 'l'],
  // Cyrillic, capitals
  [0x410, 'A'], [0x412, 'B'], [0x415, 'E'], [0x41a, 'K'], [0x41c, 'M'], [0x41d, 'H'], [0x41e, 'O'], [0x420, 'P'], [0x421, 'C'],
  [0x422, 'T'], [0x425, 'X'], [0x405, 'S'], [0x406, 'I'], [0x408, 'J'], [0x4ae, 'Y'], [0x51a, 'Q'], [0x51c, 'W'], [0x4ba, 'H'],
  [0x4c0, 'I'],
  // Greek, lower case (GREK_LOOK)
  [0x3bf, 'o'], [0x3bd, 'v'], [0x3b1, 'a'], [0x3b9, 'i'], [0x3ba, 'k'], [0x3c5, 'u'], [0x3c1, 'p'],
  // Greek, capitals
  [0x391, 'A'], [0x392, 'B'], [0x395, 'E'], [0x396, 'Z'], [0x397, 'H'], [0x399, 'I'], [0x39a, 'K'], [0x39c, 'M'], [0x39d, 'N'],
  [0x39f, 'O'], [0x3a1, 'P'], [0x3a4, 'T'], [0x3a5, 'Y'], [0x3a7, 'X'],
  // LATIN_LOOK, the obvious ones: dotless i and j, the dental click, IPA, small capitals, a few of Latin Extended-D and -E
  [0x131, 'i'], [0x237, 'j'], [0x1c0, 'l'],
  [0x251, 'a'], [0x261, 'g'], [0x262, 'G'], [0x269, 'i'], [0x26a, 'I'], [0x274, 'N'], [0x280, 'R'], [0x28f, 'Y'], [0x299, 'B'],
  [0x29c, 'H'], [0x29f, 'L'],
  [0x1d00, 'A'], [0x1d04, 'C'], [0x1d05, 'D'], [0x1d07, 'E'], [0x1d0a, 'J'], [0x1d0b, 'K'], [0x1d0d, 'M'], [0x1d0f, 'O'],
  [0x1d18, 'P'], [0x1d1b, 'T'], [0x1d1c, 'U'], [0x1d20, 'V'], [0x1d21, 'W'], [0x1d22, 'Z'],
  [0xa730, 'F'], [0xa731, 'S'], [0xa7ae, 'I'], [0xab53, 'x'],
]);

/** Spec 109 FR-076's digit folds, after lower casing: `0` -> `o`, `1`, `i` -> `l`, `rn` -> `m`. */
const DIGIT_FOLD: ReadonlyMap<string, string> = new Map([['0', 'o'], ['1', 'l'], ['i', 'l']]);

/**
 * The text with each mapped letter replaced by its Latin letter, everything else unchanged. With `digits` on (spec 109 FR-076) the
 * result is also lower-cased and `0`, `1`, `i` and `rn` are folded; off by default. One pass per step, linear in the length.
 */
export function skeleton(text: string, opts: { digits?: boolean } = {}): string {
  let out = '';
  for (const ch of text) out += SKELETON_MAP.get(ch.codePointAt(0)!) ?? ch;
  if (opts.digits !== true) return out;
  let folded = '';
  for (const ch of out.toLowerCase()) folded += DIGIT_FOLD.get(ch) ?? ch;
  return folded.replace(/rn/g, 'm');
}

/**
 * The one key names are compared on (FR-012): NFKC, trim, white-space runs to one space, then `skeleton(.., { digits: true })`, which maps the
 * letters FIRST (the table holds capitals) and lower-cases after (2026-11-12). Limits: case is folded with `toLowerCase`, not full case
 * folding, so `Stra\u00dfe` and `STRASSE`, a dotted capital I and a final sigma are not unified; a real name made only of lookalike
 * letters gets the same key as its Latin twin (accepted). Pure code, not run on Windows or macOS.
 */
export function nameKey(name: string): string {
  return skeleton(name.normalize('NFKC').trim().replace(/\s+/gu, ' '), { digits: true });
}
