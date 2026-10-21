/** Unit test: the MCP OAuth challenge classifier and `stripMcpChallenge` (spec 058 FR-061; not the remote-control handshake of `test-mcp-auth.ts`). `npm run test:mcpauth`. No process, no account, no credits. */
import * as assert from 'assert';
import { isMcpAuthChallenge, stripMcpChallenge } from '../src/adapters/mcpauth';

const ISSUE = 'MCP tool catalog changed before tool "github-search_issues" could be invoked: Failed to verify cached MCP tools: MCP OAuth challenge required (HTTP 401)';
const yes = [
  ISSUE,
  'Failed to verify cached MCP tools: MCP OAuth challenge required (HTTP 401)',
  'MCP server "notion" requires authentication. Run `/mcp auth notion` to authenticate.',
  'MCP server "notion" requires authentication. Run /mcp auth notion to authenticate.',
  'Re-authentication required for MCP server "notion". Run /mcp auth notion',
  'x '.repeat(500) + ISSUE, // inside the bounded window
];
for (const t of yes) assert.ok(isMcpAuthChallenge(t), `challenge: ${t.slice(-80)}`);

const no = [
  '',
  'You can add OAuth to your MCP server by returning a 401 with a WWW-Authenticate header.',
  'The docs say the MCP OAuth flow needs a challenge from the server.',
  "You've hit your usage limit. Try again later.",
  'Failed to authenticate. API Error: 401 OAuth access token is invalid. Please run /login',
  'HTTP 401 Unauthorized',
  'MCP server "notion" failed to start: ECONNREFUSED',
  'Please sign in to continue',
  'Re-authentication required for MCP server access. Please run copilot login',
];
for (const t of no) assert.ok(!isMcpAuthChallenge(t), `not a challenge: ${t.slice(0, 80)}`);
for (const v of [undefined, null, 5, {}, ['MCP OAuth challenge required']]) assert.ok(!isMcpAuthChallenge(v), 'non-string');

// the stripped text keeps what is not the challenge
assert.ok(!/MCP OAuth|401/.test(stripMcpChallenge(ISSUE)), 'issue clause and its HTTP code removed');
assert.ok(stripMcpChallenge('API Error: 401 Please run /login. MCP OAuth challenge required (HTTP 401)').includes('Please run /login'));

// bounded input: a phrase past the window is not read; a 1 MB text is cheap
assert.ok(!isMcpAuthChallenge('x'.repeat(5000) + ISSUE), 'beyond the bound is ignored');
{
  const t0 = Date.now();
  isMcpAuthChallenge('MCP server "' + 'a'.repeat(1_000_000));
  isMcpAuthChallenge('Re-authentication required for MCP serve'.repeat(100_000));
  assert.ok(Date.now() - t0 < 500, 'linear time');
}
console.log('mcpauth: the issue text, runtime phrases, negatives, bounded input OK');
