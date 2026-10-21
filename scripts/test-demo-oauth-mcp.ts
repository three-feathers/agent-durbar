/**
 * Unit test (spec 058 T116): the demo OAuth MCP server really enforces the flow the real check relies on, so a "connected without a new
 * sign-in" result can only come from a kept token. Loopback only, no agent app, no credits.
 */
import * as assert from 'assert';
import { createHash, randomBytes } from 'crypto';
import { startDemoOAuthMcp } from './demo-oauth-mcp';

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const REDIRECT = 'http://127.0.0.1:1/callback'; // never fetched: the test reads the 302's Location

async function main(): Promise<void> {
  const s = await startDemoOAuthMcp();
  try {
    const rpc = (body: unknown, token?: string, sid?: string): Promise<Response> =>
      fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };

    // 1. no token -> 401 with the resource metadata address
    const r401 = await rpc(init);
    assert.strictEqual(r401.status, 401);
    const wa = r401.headers.get('www-authenticate') ?? '';
    const prmUrl = /resource_metadata="([^"]+)"/.exec(wa)?.[1];
    assert.ok(prmUrl && prmUrl.startsWith(s.base), `WWW-Authenticate names the metadata: ${wa}`);
    assert.strictEqual((await rpc(init, 'not-a-token')).status, 401, 'a made-up token is refused');

    // 2. discovery
    const prm = (await (await fetch(prmUrl)).json()) as { resource: string; authorization_servers: string[] };
    assert.strictEqual(prm.resource, s.url);
    const as = (await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as Record<string, string | string[]>;
    assert.deepStrictEqual(as.code_challenge_methods_supported, ['S256']);

    // 3. dynamic client registration
    const reg = (await (await fetch(String(as.registration_endpoint), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'test', redirect_uris: [REDIRECT] }) })).json()) as { client_id: string };
    assert.ok(reg.client_id);

    const authorize = async (challenge: string | null, redirect = REDIRECT, method = 'S256'): Promise<Response> => {
      const u = new URL(String(as.authorization_endpoint));
      u.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, state: 'st4te', resource: s.url, ...(challenge ? { code_challenge: challenge, code_challenge_method: method } : {}) }).toString();
      return fetch(u, { redirect: 'manual' });
    };
    const tokenReq = (p: Record<string, string>): Promise<Response> => fetch(String(as.token_endpoint), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p).toString() });

    // 4. refusals: an unregistered redirect (no redirect at all), no PKCE (error back to the client)
    const open = await authorize('x', 'https://evil.example/cb');
    assert.strictEqual(open.status, 400, 'no redirect to an unregistered address');
    const noPkce = await authorize(null);
    assert.strictEqual(noPkce.status, 302);
    assert.strictEqual(new URL(noPkce.headers.get('location')!).searchParams.get('error'), 'invalid_request');
    const plain = await authorize('abc', REDIRECT, 'plain');
    assert.strictEqual(new URL(plain.headers.get('location')!).searchParams.get('error'), 'invalid_request', 'plain PKCE refused');
    assert.strictEqual(s.stats.authorizations, 0);

    // 5. a wrong verifier is refused, and the code is then spent
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const a1 = new URL((await authorize(challenge)).headers.get('location')!);
    assert.strictEqual(a1.searchParams.get('state'), 'st4te');
    const code1 = a1.searchParams.get('code')!;
    assert.strictEqual((await tokenReq({ grant_type: 'authorization_code', code: code1, code_verifier: 'wrong', redirect_uri: REDIRECT, client_id: reg.client_id })).status, 400);
    assert.strictEqual((await tokenReq({ grant_type: 'authorization_code', code: code1, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.client_id })).status, 400, 'a code works once');

    // 6. the right verifier gets tokens
    const code2 = new URL((await authorize(challenge)).headers.get('location')!).searchParams.get('code')!;
    const t = (await (await tokenReq({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.client_id, resource: s.url })).json()) as { access_token: string; refresh_token: string; token_type: string };
    assert.strictEqual(t.token_type, 'Bearer');
    assert.strictEqual(s.stats.authorizations, 2);
    assert.strictEqual(s.stats.codeGrants, 1);

    // 7. MCP with the token: initialize, initialized, tools/list
    const ri = await rpc(init, t.access_token);
    assert.strictEqual(ri.status, 200);
    const sid = ri.headers.get('mcp-session-id')!;
    assert.ok(sid);
    assert.strictEqual(((await ri.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'durbar-demo-oauth');
    assert.strictEqual((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, t.access_token, sid)).status, 202);
    const tl = (await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, t.access_token, sid)).json()) as { result: { tools: { name: string }[] } };
    assert.deepStrictEqual(tl.result.tools.map((x) => x.name), ['demo_echo']);
    assert.strictEqual((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, t.access_token, 'nope')).status, 404, 'unknown MCP session');

    // 8. refresh rotates; the old refresh token is spent; the new access token works
    const t2 = (await (await tokenReq({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: reg.client_id })).json()) as { access_token: string };
    assert.ok(t2.access_token && t2.access_token !== t.access_token);
    assert.strictEqual((await tokenReq({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: reg.client_id })).status, 400);
    assert.strictEqual((await rpc(init, t2.access_token)).status, 200);
    assert.strictEqual(s.stats.refreshGrants, 1);
    assert.ok(s.stats.challenges >= 2 && s.stats.refused >= 5, JSON.stringify(s.stats));
    // no token in the counters
    assert.ok(!JSON.stringify(s.stats).includes(t.access_token));
  } finally {
    await s.close();
  }
  console.log('demo OAuth MCP server: 401 + metadata, DCR, PKCE S256 only, one-use codes, registered redirects, tokens, refresh rotation, MCP OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
