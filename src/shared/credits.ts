/**
 * AI-credit cap helpers (spec 011). Pure: used by the main process and by tests. The renderer is a plain script and
 * carries a tiny copy of `fmtAiu`; main re-validates every number it receives with `parseCap`.
 * Numbers only: nothing here touches content, tokens or secrets.
 */
import { parseCharacters } from './characters';
import type { CharacterChoice } from './characters';
import { parseCustomPlaces, parsePlaceMap } from './places';
import type { CustomPlace, PlaceMap } from './places';
import { parseVersionField } from './versionfield';
import { parseNewFolderParent } from './newfolder';
import { parseWarnLevels } from './mcpcost';
import type { McpWarnLevels } from './mcpcost';

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

/** A dollar cap (spec 012 FR-150, Claude's estimate): from $0.01 to $10,000, rounded to cents. */
export const MIN_USD_CAP = 0.01;
export const MAX_USD_CAP = 10_000;
export function parseUsdCap(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined || n < MIN_USD_CAP || n > MAX_USD_CAP) return undefined;
  return Math.round(n * 100) / 100;
}

/** A cap in the adapter's unit (`capUnit`, AIU when missing). */
export function parseCapIn(unit: 'aiu' | 'usd' | undefined, v: unknown): number | undefined {
  return unit === 'usd' ? parseUsdCap(v) : parseCap(v);
}

/**
 * The cap a new session starts with (spec 011, spec 012 FR-150): the explicit choice (null = none) > the folder's saved cap > the
 * settings default. The saved and default caps are AIU, so a dollar-cap adapter only ever gets an explicit cap.
 */
export function startCap(unit: 'aiu' | 'usd' | undefined, explicit: number | null | undefined, folderCap?: number, defaultCap?: number): number | undefined {
  if (explicit === null) return undefined;
  const c = explicit === undefined ? undefined : parseCapIn(unit, explicit);
  if (c !== undefined) return c;
  return unit === 'usd' ? undefined : folderCap ?? defaultCap;
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
  /** The user's own places (spec 024 FR-018): up to 3, names and icon ids. Omitted when empty. */
  customPlaces?: CustomPlace[];
  /** Serious mode (spec 034 FR-004): no heavy or monster bodies and no trouble drawings on the agent figures. Only `true` is kept. */
  seriousMode?: boolean;
  /** Active theme id (specs 035-040). Omitted = Clean Office. */
  theme?: string;
  /** Spec 077 FR-064: who sits at the desks. Omitted = the theme's own (the default is not written). */
  characters?: Exclude<CharacterChoice, 'theme'>;
  /** OS notifications when an agent needs you (spec 052 FR-059). On by default: only `false` is kept. */
  notifyNeedsMe?: false;
  /** Spec 068 FR-006: after a coffee break, always ask before going on. The default (resume by itself when it costs nothing extra) is not written. */
  breakResume?: 'ask';
  /** Spec 080 FR-025d (Q2): the user accepted the one-time note of the session browser. Asked once per app profile; only `true` is kept. */
  browserNoteAccepted?: true;
  /** Spec 080 FR-031: where a click on a chat link opens. The default (the session browser) is not written; only `'system'` is kept. */
  chatLinksIn?: 'system';
  /** Spec 080 FR-123: *Open chat links in a new tab*; only `true` is kept (the default, off, is not written). */
  chatLinksNewTab?: true;
  /** Spec 081 FR-016: the last version announced by a toast, per agent app (version strings only). */
  announcedVersions?: Record<string, string>;
  /** Spec 081 FR-022 (Q6 = A): the start check for agent-app updates is on by default; only `false` is kept. */
  checkUpdatesAtStart?: false;
  /** Spec 087 FR-007c: apps whose *Always continue without the OS sandbox on this computer* is stored (only offered where the host can never sandbox the app). */
  sandboxAlwaysContinue?: string[];
  /** Spec 100 FR-020: when the MCP warning shows; omitted = the defaults (15 and 30 %). */
  mcpWarnLevels?: McpWarnLevels;
  /** Spec 093 FR-006: the parent folder of the last folder created from + Folder (an absolute path, never a token); the picker starts there. */
  newFolderParent?: string;
}

/** Spec 087 FR-007c: only known app ids, each once; anything else is dropped. */
export function parseSandboxAlways(v: unknown): string[] {
  return Array.isArray(v) ? ANNOUNCE_APPS.filter((a) => v.includes(a)) : [];
}

/** Spec 081: the app ids that may carry an announced version. */
export const ANNOUNCE_APPS = ['claude', 'codex', 'copilot'] as const;
/** Own properties only, an allowed app id and a valid version each; anything else is dropped. */
export function parseAnnounced(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const app of ANNOUNCE_APPS) {
    if (!Object.prototype.hasOwnProperty.call(v, app)) continue;
    const ver = parseVersionField((v as Record<string, unknown>)[app]);
    if (ver) out[app] = ver;
  }
  return out;
}

/** Tolerant parse: a missing, corrupt or odd file means no settings. */
export function parseSettings(text: string): AppSettings {
  try {
    const doc = JSON.parse(text) as { defaultMaxAiCredits?: unknown; placeMap?: unknown; customPlaces?: unknown; seriousMode?: unknown; theme?: unknown; notifyNeedsMe?: unknown; breakResume?: unknown; browserNoteAccepted?: unknown; chatLinksIn?: unknown; chatLinksNewTab?: unknown } | null;
    const obj = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
    const cap = parseCap((obj as { defaultMaxAiCredits?: unknown }).defaultMaxAiCredits);
    // the custom places first: the mapping may only point to ones that exist (spec 024 FR-019)
    const custom = parseCustomPlaces((obj as { customPlaces?: unknown }).customPlaces);
    const places = parsePlaceMap((obj as { placeMap?: unknown }).placeMap, custom.map((p) => p.id));
    const theme = parseThemeId((obj as { theme?: unknown }).theme);
    const chars = parseCharacters((obj as { characters?: unknown }).characters); // spec 077 FR-064: anything not on the list is dropped
    const announced = parseAnnounced((obj as { announcedVersions?: unknown }).announcedVersions);
    return { ...(cap === undefined ? {} : { defaultMaxAiCredits: cap }), ...(Object.keys(places).length ? { placeMap: places } : {}), ...(custom.length ? { customPlaces: custom } : {}), ...((obj as { seriousMode?: unknown }).seriousMode === true ? { seriousMode: true } : {}), ...(theme === undefined ? {} : { theme }), ...(chars === undefined || chars === 'theme' ? {} : { characters: chars }), ...((obj as { notifyNeedsMe?: unknown }).notifyNeedsMe === false ? { notifyNeedsMe: false as const } : {}), ...((obj as { breakResume?: unknown }).breakResume === 'ask' ? { breakResume: 'ask' as const } : {}), ...(Object.keys(announced).length ? { announcedVersions: announced } : {}), ...((obj as { checkUpdatesAtStart?: unknown }).checkUpdatesAtStart === false ? { checkUpdatesAtStart: false as const } : {}), ...((obj as { browserNoteAccepted?: unknown }).browserNoteAccepted === true ? { browserNoteAccepted: true as const } : {}), ...(parseSandboxAlways((obj as { sandboxAlwaysContinue?: unknown }).sandboxAlwaysContinue).length ? { sandboxAlwaysContinue: parseSandboxAlways((obj as { sandboxAlwaysContinue?: unknown }).sandboxAlwaysContinue) } : {}), ...(parseNewFolderParent((obj as { newFolderParent?: unknown }).newFolderParent) ? { newFolderParent: parseNewFolderParent((obj as { newFolderParent?: unknown }).newFolderParent) } : {}), ...((obj as { chatLinksIn?: unknown }).chatLinksIn === 'system' ? { chatLinksIn: 'system' as const } : {}), ...((obj as { chatLinksNewTab?: unknown }).chatLinksNewTab === true ? { chatLinksNewTab: true as const } : {}), ...(parseWarnLevels((obj as { mcpWarnLevels?: unknown }).mcpWarnLevels) ? { mcpWarnLevels: parseWarnLevels((obj as { mcpWarnLevels?: unknown }).mcpWarnLevels) } : {}) };
  } catch {
    return {};
  }
}

/** Nano-AIU (as the runtime reports it) to a short AIU text; "-" for anything that is not a usable number. */
export function fmtAiu(nano: unknown, digits = 2): string {
  return typeof nano === 'number' && Number.isFinite(nano) && nano >= 0 ? (nano / 1e9).toFixed(digits) : '-';
}
