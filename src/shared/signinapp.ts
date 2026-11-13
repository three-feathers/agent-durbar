/**
 * Spec 058 FR-233..FR-236 (issue #1667): the app (client) ID an agent app uses for its built-in Microsoft Entra MCP sign-in, as plain
 * data. No imports, no vendor type (constitution II): the mode-to-ID table and the agent app's own option stay in its adapter. Loads in
 * the page too (`src/shared` with no imports).
 *
 * Owner decision (Vikram, DM 2026-11-13 06:22 UTC): a missing or malformed value reads as the default, Visual Studio Code's app, "to keep
 * compatibility to how it worked earlier" (SDK 1.0.24 borrowed that app by itself, issue #1084); only an explicit `off` passes no app.
 * A client ID is not a secret, but it is never logged (FR-236): logs say the mode only.
 */
/** FR-234: `copilot-cli` is stored and kept but, until Q25 names a source for its ID, not offered and read as the default. `off`: no app. */
export const SIGN_IN_APP_MODES = ['off', 'vscode', 'copilot-cli', 'custom'] as const;
export type SignInAppMode = (typeof SIGN_IN_APP_MODES)[number];

/** FR-233: the stored choice. `clientId` only with `custom` (always a valid, lower-case GUID there). */
export interface SignInAppChoice {
  mode: SignInAppMode;
  clientId?: string;
}

/** The owner's default (2026-11-13 06:22 UTC): what a missing, malformed or not-yet-available (`copilot-cli`) value reads as. */
export const SIGN_IN_APP_DEFAULT: Readonly<SignInAppChoice> = Object.freeze({ mode: 'vscode' as const });

/** FR-235: the fixed reply for a refused ID. It never repeats what was typed (a pasted client secret goes nowhere). */
export const SIGN_IN_APP_REFUSED = "Not an app (client) ID. It looks like 00000000-0000-0000-0000-000000000000 with your app's digits.";

/** FR-236: what a configured ID becomes in any text Durbar logs, copies or shows. */
export const SIGN_IN_APP_ID_MASK = '<sign-in app ID>';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * FR-235: a client ID, or undefined. Outer white space trimmed, matched case-insensitively, returned lower case; never the zero GUID.
 * Braces, `urn:uuid:`, inner spaces, 32 bare hex digits and anything longer are refused. Linear: a long input is refused by length first.
 */
export function parseClientId(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 200) return undefined;
  const s = v.trim().toLowerCase();
  if (!GUID.test(s) || s === ZERO_GUID) return undefined;
  return s;
}

/**
 * FR-233: the stored choice, or undefined (none stored: the default). Only an own `mode` from the list and, for `custom` only, an own
 * valid `clientId`; anything else (wrong type, unknown mode, `custom` without a valid ID, an ID on another mode, extra keys) is undefined.
 */
export function parseSignInApp(v: unknown): SignInAppChoice | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const keys = Object.keys(v);
  if (keys.some((k) => k !== 'mode' && k !== 'clientId')) return undefined;
  if (!Object.prototype.hasOwnProperty.call(v, 'mode')) return undefined;
  const mode = (v as { mode?: unknown }).mode;
  if (typeof mode !== 'string' || !(SIGN_IN_APP_MODES as readonly string[]).includes(mode)) return undefined;
  const hasId = Object.prototype.hasOwnProperty.call(v, 'clientId');
  if (mode !== 'custom') return hasId ? undefined : { mode: mode as SignInAppMode };
  const id = hasId ? parseClientId((v as { clientId?: unknown }).clientId) : undefined;
  return id ? { mode: 'custom', clientId: id } : undefined;
}

/**
 * The choice in force for a stored value: the stored one when valid, else `SIGN_IN_APP_DEFAULT`; `copilot-cli` reads as the default
 * until Q25 is answered (FR-234). Always a fresh object.
 */
export function effectiveSignInApp(v: unknown): SignInAppChoice {
  const p = parseSignInApp(v);
  return p && p.mode !== 'copilot-cli' ? p : { ...SIGN_IN_APP_DEFAULT };
}

/** Two stored values give the same choice in force: FR-237's "the same value again does nothing" (no restart). */
export function sameSignInApp(a: unknown, b: unknown): boolean {
  const x = effectiveSignInApp(a);
  const y = effectiveSignInApp(b);
  return x.mode === y.mode && (x.clientId ?? '') === (y.clientId ?? '');
}

/** FR-236: the debug log's words for a stored value: the mode in force, "(set)" for a custom ID, why a default applies; never the ID. */
export function signInAppLogLabel(v: unknown): string {
  const p = parseSignInApp(v);
  const e = effectiveSignInApp(v);
  const now = e.mode === 'custom' ? 'custom (set)' : e.mode;
  if (!p) return `${now} (default)`;
  return p.mode === 'copilot-cli' ? `${now} (copilot-cli is not available in this build)` : now;
}

/**
 * FR-236: `text` with every occurrence of the configured ID (any case) replaced by `SIGN_IN_APP_ID_MASK`. A value that is not a valid
 * ID changes nothing (so a bad value cannot turn this into a wide replace). Run it before any cut, so no part of the ID is left.
 */
export function maskSignInAppId(text: string, id: string | undefined): string {
  const g = parseClientId(id);
  if (!g || typeof text !== 'string' || !text) return text;
  return text.replace(new RegExp(g, 'gi'), SIGN_IN_APP_ID_MASK); // a valid GUID has only hex digits and hyphens: no regex metacharacter
}
