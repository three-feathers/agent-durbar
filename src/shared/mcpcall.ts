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
const POLICY = /AADSTS53(?:0\d\d|\d{4})(?!\d)|\binsufficient_claims\b|\binteraction_required\b|conditional access|device (?:is )?(?:required )?(?:to be )?managed|managed device|compliant device|device (?:is )?not (?:compliant|enrolled)/i;
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
const AUTH = /\b401\s+unauthori[sz]ed|\b(?:http(?:\/\d(?:\.\d)?)?|status(?: code)?|code|error|response)[\s:=(-]{0,4}401\b|unauthori[sz]ed|AADSTS(?:50058|50072|50074|50076|50078|50079|50132|50133|50173|70008|70043|70044|700082|65001)\b|invalid_grant|token (?:is |has )?(?:expired|invalid)|sign[- ]?in (?:is )?required|MCP OAuth challenge required/i;

/** `auth` when the adapter already said so (`mcpAuth`), else the class of the text, else undefined (nothing guessed). */
export function classifyMcpCall(text: unknown, mcpAuth?: boolean): McpCallClass | undefined {
  const t = typeof text === 'string' ? text.slice(0, MAX) : '';
  if (POLICY.test(t)) return 'policy';
  if (mcpAuth === true || AUTH.test(t)) return 'auth';
  return undefined;
}
