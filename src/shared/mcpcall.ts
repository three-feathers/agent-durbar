/**
 * Spec 058 FR-187 (issue #779 A): what a failed MCP tool call says about the server, as a class word only: `auth` (it needs a sign-in)
 * or `policy` (the organization's access policy refused it, for example Entra Conditional Access, `AADSTS53xxxx`). Pure and
 * linear-time (no nested quantifiers, input cut first). It reads the text and never returns any of it: the claims blob, IDs and e-mail
 * addresses of the vendor text stay where they are and never reach the window. Apply it to failed MCP tool results only.
 * `src/renderer/sim.ts` keeps a marked copy (`mcpcall:begin`); `scripts/test-mcpcall.ts` checks both give the same answer.
 */
export type McpCallClass = 'auth' | 'policy';

const MAX = 4000;

/** Organization access policy: Entra Conditional Access / device compliance. Tested first, because such a refusal also says "AADSTS" or "sign in". */
const POLICY = /\bAADSTS53(?:0\d\d|\d{4})\b|\binsufficient_claims\b|conditional access|device (?:is )?(?:required )?(?:to be )?managed|managed device|compliant device|device (?:is )?not (?:compliant|enrolled)/i;
/**
 * The server wants a sign-in. Each Entra code below is one that signing in again fixes (meanings from Microsoft's published AADSTS error
 * list, written from memory and not re-checked online); every other `AADSTS50xxx` / `70xxx` code gets no class, because signing in does
 * not fix it (for example 50105 or 50020, a user not assigned to the app or from another tenant; 50144, an expired password):
 *   50058 no user signed in (session information missing)     50072 user must enrol for two-step verification
 *   50074 strong authentication (MFA) required               50076 MFA required by policy
 *   50078 the MFA claim expired                              50079 user must enrol for MFA
 *   50132 session revoked (password change, sign-in frequency) 50133 session expired
 *   50173 fresh sign-in needed (grant expired or revoked)     70008 the refresh token or code expired
 *   70043 refresh token expired (sign-in frequency)           70044 session expired (sign-in frequency policy)
 *   700082 refresh token expired from inactivity              65001 consent not given (signing in again can grant it)
 * An HTTP 401 counts only as "401 Unauthorized", or next to an HTTP / status / code / error / response word: a bare 401 ("line 401 of
 * input.csv", "issue 401 not found", "Page 401 of 900") is not a sign-in.
 */
const AUTH = /\b401\s+unauthori[sz]ed|\b(?:http(?:\/\d(?:\.\d)?)?|status(?: code)?|code|error|response)[\s:=(-]{0,4}401\b|unauthori[sz]ed|\bAADSTS(?:50058|50072|50074|50076|50078|50079|50132|50133|50173|70008|70043|70044|700082|65001)\b|invalid_grant|token (?:is |has )?(?:expired|invalid)|sign[- ]?in (?:is )?required|MCP OAuth challenge required/i;

/** `auth` when the adapter already said so (`mcpAuth`), else the class of the text, else undefined (nothing guessed). */
export function classifyMcpCall(text: unknown, mcpAuth?: boolean): McpCallClass | undefined {
  const t = typeof text === 'string' ? text.slice(0, MAX) : '';
  if (POLICY.test(t)) return 'policy';
  if (mcpAuth === true || AUTH.test(t)) return 'auth';
  /* after sign-in: Entra's normal MFA and re-sign-in answers carry this word too, and signing in does fix those */
  return /\binteraction_required\b/i.test(t) ? 'policy' : undefined;
}

/**
 * Spec 058 FR-225 (review of PR 1210): the narrow signal the check before a message acts on. `classifyMcpCall` is wide on purpose (it
 * only words a failed call); a check restarts a server, so it reads only an HTTP 401 form, the runtime's own "MCP OAuth challenge
 * required", `invalid_grant`, or an Entra sign-in code that signing in again fixes. Never a bare "unauthorized" or "token expired"
 * ("unauthorized_client", "page token expired", "unauthorized for this plan tier", "error 401: license seat" are not sign-ins).
 * A policy text (Conditional Access) is never one. Linear time, input cut first; reads the text, returns only a boolean.
 */
const CHECK_AUTH = /\bMCP OAuth challenge required\b|\bhttp(?:\/\d(?:\.\d)?)?[\s:=(-]{0,4}401\b|\b401\s+unauthori[sz]ed\b|\binvalid_grant\b|\bAADSTS(?:50058|50072|50074|50076|50078|50079|50132|50133|50173|70008|70043|70044|700082|65001)\b/i;
export function isCheckUnauthorized(text: unknown): boolean {
  const t = typeof text === 'string' ? text.slice(0, MAX) : '';
  if (POLICY.test(t)) return false;
  return CHECK_AUTH.test(t);
}

/**
 * Spec 058 FR-240 (issue #1667): Microsoft refused the sign-in app (the Entra app ID Copilot's sign-in used), as a reason word only.
 * `app`: this server does not accept that app (`ENTRA_CLIENT_NOT_PREAUTHORIZED`, the runtime's word, or `AADSTS65002`); `redirect`: the
 * app does not list this computer's sign-in address (`AADSTS50011`). Whole words, any case, input cut first; read from the masked text.
 * Not `auth` and not `classifyMcpCall`'s business (which stays as it is): signing in again with the same app does not fix these
 * (AADSTS65001, consent, stays `auth`). Returns undefined for anything else.
 */
export type SignInAppRefusal = 'app' | 'redirect';
export function signInAppRefusal(text: unknown): SignInAppRefusal | undefined {
  const t = typeof text === 'string' ? text.slice(0, MAX) : '';
  if (/\bENTRA_CLIENT_NOT_PREAUTHORIZED\b|\bAADSTS65002\b/i.test(t)) return 'app';
  if (/\bAADSTS50011\b/i.test(t)) return 'redirect';
  return undefined;
}

/**
 * FR-240's words for a refusal: with a sign-in app set (`label`, the Settings choice's display name), which app and why; with Off, the
 * plain sentence (the caller adds the existing CLI steps, FR-068). Fixed words: nothing of the vendor text is repeated.
 */
export function signInAppRefusalText(kind: SignInAppRefusal, label: string | undefined): string {
  if (!label) return "Microsoft refused Copilot's sign-in app for this server.";
  const reason = kind === 'redirect' ? "the app does not list this computer's sign-in address" : 'this server does not accept that app';
  return `Microsoft refused the sign-in app chosen in Settings > MCP servers (${label}): ${reason}. Choose another app or Off.`;
}
