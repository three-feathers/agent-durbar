/**
 * "Needs you" count on the app icon (spec 052 FR-059): pure checks, wired in main.ts.
 * The renderer is not trusted: only an integer from 0 to 999 is used.
 */

/** An integer from 0 to 999, or null for anything else. */
export function parseBadgeCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 999 ? v : null;
}

/** Windows has no badge count: flash the taskbar button when the count grows while the window is not focused. */
export function shouldFlash(prev: number, next: number, focused: boolean, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && !focused && next > prev;
}

/** macOS (spec 052 FR-085): bounce the Dock icon once ("informational") when the count grows while the window is not focused. */
export function shouldBounce(prev: number, next: number, focused: boolean, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' && !focused && next > prev;
}
