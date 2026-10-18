/**
 * AI-credit cap helpers (spec 011). Pure: used by the main process and by tests. The renderer is a plain script and
 * carries a tiny copy of `fmtAiu`; main re-validates every number it receives with `parseCap`.
 * Numbers only: nothing here touches content, tokens or secrets.
 */
import { parsePlaceMap } from './places';
import type { PlaceMap } from './places';

/** Upper bound for a cap (AI credits). Anything above is refused as a typo. */
export const MAX_CAP = 1_000_000;

/** The smallest cap the runtime accepts (GitHub docs and the runtime: "Minimum session limit is 30 AI credits"). 1 credit = USD 0.01. */
export const MIN_CAP = 30;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** A usable cap: finite number in [MIN_CAP, MAX_CAP], rounded to 2 decimals. Otherwise undefined = no cap. */
export function parseCap(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined || n < MIN_CAP || n > MAX_CAP) return undefined;
  return Math.round(n * 100) / 100;
}

/** An amount of credits to add to a cap: finite number in (0, MAX_CAP], 2 decimals. */
export function parseAmount(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined || n <= 0 || n > MAX_CAP) return undefined;
  const r = Math.round(n * 100) / 100;
  return r > 0 ? r : undefined;
}

export const THEME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A theme id: lowercase kebab, 1-64 chars. Anything else is dropped (Clean Office applies). */
export function parseThemeId(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return THEME_ID_RE.test(t) ? t : undefined;
}

/** Settings file content (`durbar-settings.json`): the global default cap (AI credits) for new sessions, the place mapping (spec 024) and the theme (spec 037). */
export interface AppSettings {
  defaultMaxAiCredits?: number;
  /** MCP server name -> place (spec 024 FR-007). Omitted when empty. */
  placeMap?: PlaceMap;
  /** Serious mode (spec 034 FR-004): no heavy or monster bodies and no trouble drawings on the agent figures. Only `true` is kept. */
  seriousMode?: boolean;
  /** Active theme id (specs 035-040). Omitted = Clean Office. */
  theme?: string;
}

/** Tolerant parse: a missing, corrupt or odd file means no settings. */
export function parseSettings(text: string): AppSettings {
  try {
    const doc = JSON.parse(text) as { defaultMaxAiCredits?: unknown; placeMap?: unknown; seriousMode?: unknown; theme?: unknown } | null;
    const obj = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
    const cap = parseCap((obj as { defaultMaxAiCredits?: unknown }).defaultMaxAiCredits);
    const places = parsePlaceMap((obj as { placeMap?: unknown }).placeMap);
    const theme = parseThemeId((obj as { theme?: unknown }).theme);
    return { ...(cap === undefined ? {} : { defaultMaxAiCredits: cap }), ...(Object.keys(places).length ? { placeMap: places } : {}), ...((obj as { seriousMode?: unknown }).seriousMode === true ? { seriousMode: true } : {}), ...(theme === undefined ? {} : { theme }) };
  } catch {
    return {};
  }
}

/** Nano-AIU (as the runtime reports it) to a short AIU text; "-" for anything that is not a usable number. */
export function fmtAiu(nano: unknown, digits = 2): string {
  return typeof nano === 'number' && Number.isFinite(nano) && nano >= 0 ? (nano / 1e9).toFixed(digits) : '-';
}
