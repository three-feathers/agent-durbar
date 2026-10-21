/**
 * Spec 058 FR-061/FR-062: is the text of a failed MCP tool call (or an MCP status error) an MCP server's OAuth challenge, that is,
 * "this server needs you to sign in"? Pure, unit-tested (`npm run test:mcpauth`). It only reads the text and never returns it.
 * Apply it to failed MCP tool results and MCP status errors only, never to model text.
 *
 * Linear-time patterns (no nested quantifiers) over at most `MAX` characters.
 * `stripMcpChallenge` removes the matched clause so the rest of a mixed text can still be judged (an app 401 next to an MCP challenge).
 */
const MAX = 4000;

const CHALLENGE = [
  // Copilot runtime, issue #364 (real): 'MCP tool catalog changed before tool "x" could be invoked: Failed to verify cached MCP tools: MCP OAuth challenge required (HTTP 401)'
  /MCP OAuth challenge required/i,
  // Copilot runtime strings (read:): 'MCP server "<name>" requires authentication. Run `/mcp auth <name>` to authenticate.'
  /MCP server "[^"\n]{1,200}" requires authentication\.\s{0,5}Run `?\/mcp auth/i,
  // 'Re-authentication required for MCP server "<name>". Run /mcp auth <name>'
  /Re-authentication required for MCP server "[^"\n]{1,200}"/i,
];

/** True when `text` reads like an MCP server's OAuth challenge. */
export function isMcpAuthChallenge(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  const t = text.slice(0, MAX);
  return CHALLENGE.some((r) => r.test(t));
}

/** The clauses `isMcpAuthChallenge` matches, with what they carry (HTTP code, "Run /mcp auth ..." advice). Global copies for removal. */
const CLAUSES = [
  /MCP OAuth challenge required(?:\s{0,3}\(HTTP \d{3}\))?/gi,
  /MCP server "[^"\n]{1,200}" requires authentication\.\s{0,5}Run `?\/mcp auth[^\n]{0,200}/gi,
  /Re-authentication required for MCP server "[^"\n]{1,200}"\.?(?:\s{0,5}Run `?\/mcp auth[^\n]{0,200})?/gi,
];

/** `text` (first 4000 characters) without the MCP challenge clauses; other text is kept, so an app sign-in error beside them still reads as one. */
export function stripMcpChallenge(text: string): string {
  let t = text.slice(0, MAX);
  for (const r of CLAUSES) t = t.replace(r, ' ');
  return t;
}
