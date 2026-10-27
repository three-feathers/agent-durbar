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
const POLICY = /AADSTS53\d{4}|conditional access|device (?:is )?(?:required )?(?:to be )?managed|managed device|compliant device|device (?:is )?not (?:compliant|enrolled)/i;
/** The server wants a sign-in: an HTTP 401, "unauthorized", an expired or invalid token, the usual Entra sign-in codes. */
const AUTH = /\b401\b|unauthori[sz]ed|AADSTS(?:50\d{3}|70\d{3}|65001)\b|invalid_grant|token (?:is |has )?(?:expired|invalid)|sign[- ]?in (?:is )?required|MCP OAuth challenge required/i;

/** `auth` when the adapter already said so (`mcpAuth`), else the class of the text, else undefined (nothing guessed). */
export function classifyMcpCall(text: unknown, mcpAuth?: boolean): McpCallClass | undefined {
  const t = typeof text === 'string' ? text.slice(0, MAX) : '';
  if (POLICY.test(t)) return 'policy';
  if (mcpAuth === true || AUTH.test(t)) return 'auth';
  return undefined;
}
