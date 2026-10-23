/**
 * Spec 001 FR-084: a pinned clock, time zone and locale for simulator screenshots, so an unchanged screen gives the same pixels on
 * every run (the Postbox times, "today", dates in the chat). Only with the simulator and `DURBAR_SIM_CLOCK=<UTC ISO time>`, a dev
 * hook (spec 010 FR-017: ignored in a packaged build). Main passes the time to the page as `simclock=<ms>`; the page's clock starts
 * there and runs on (src/renderer/simclock.js). Main also sets the time zone (TZ=UTC) and the locale (--lang=en-US) for the run.
 * Pure: no Electron import.
 */

/** Accepts only `YYYY-MM-DDTHH:MM[:SS]Z` (UTC, no offset, no fraction): milliseconds as a decimal string, else undefined. */
export function simClockQuery(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? String(ms) : undefined;
}
