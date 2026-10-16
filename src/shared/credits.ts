/**
 * AI-credit cap helpers (spec 011). Pure: used by the main process and by tests. The renderer is a plain script and
 * carries a tiny copy of `fmtAiu`; main re-validates every number it receives with `parseCap`.
 * Numbers only: nothing here touches content, tokens or secrets.
 */

/** Upper bound for a cap (AIU). Anything above is refused as a typo. */
export const MAX_CAP = 1_000_000;

/** A usable cap: finite number in (0, MAX_CAP], rounded to 3 decimals (the precision the UI shows). Otherwise undefined = no cap. */
export function parseCap(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_CAP) return undefined;
  const r = Math.round(n * 1000) / 1000;
  return r > 0 ? r : undefined;
}

/** Settings file content (`durbar-settings.json`): only the global default cap for new sessions. */
export interface AppSettings {
  defaultMaxAiCredits?: number;
}

/** Tolerant parse: a missing, corrupt or odd file means no settings. */
export function parseSettings(text: string): AppSettings {
  try {
    const doc = JSON.parse(text) as { defaultMaxAiCredits?: unknown } | null;
    const cap = parseCap(doc && typeof doc === 'object' ? doc.defaultMaxAiCredits : undefined);
    return cap === undefined ? {} : { defaultMaxAiCredits: cap };
  } catch {
    return {};
  }
}

/** Nano-AIU (as the runtime reports it) to a short AIU text; "-" for anything that is not a usable number. */
export function fmtAiu(nano: unknown, digits = 2): string {
  return typeof nano === 'number' && Number.isFinite(nano) && nano >= 0 ? (nano / 1e9).toFixed(digits) : '-';
}
