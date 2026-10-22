/**
 * Unit test (spec 058 T116): the demo OAuth MCP server really enforces the flow the real check relies on, so a "connected without a new
 * sign-in" result can only come from a kept token. Loopback only, no agent app, no credits.
 */
import * as assert from 'assert';
import { createHash, randomBytes } from 'crypto';
import { startDemoOAuthMcp } from './demo-oauth-mcp';
import { statusSequence } from './mcp-oauth-real';
import type { AgentEvent } from '../src/adapters/types';

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const REDIRECT = 'http://127.0.0.1:1/callback'; // never fetched: the test reads the 302's Location

async function main(): Promise<void> {
  const s = await startDemoOAuthMcp();
  try {
    assert.ok(s.base.startsWith('http://127.0.0.1:'), `loopback only: ${s.base}`);
    assert.strictEqual(s.url, `${s.base}/mcp`);
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

    const authorize = async (challenge: string | null, redirect = REDIRECT, method = 'S256', resource = s.url): Promise<Response> => {
      const u = new URL(String(as.authorization_endpoint));
      u.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, state: 'st4te', resource, ...(challenge ? { code_challenge: challenge, code_challenge_method: method } : {}) }).toString();
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

    // 5b. a code redeemed with another redirect_uri than the one it was issued for is refused (even with the right verifier)
    const codeR = new URL((await authorize(challenge)).headers.get('location')!).searchParams.get('code')!;
    assert.strictEqual((await tokenReq({ grant_type: 'authorization_code', code: codeR, code_verifier: verifier, redirect_uri: 'http://127.0.0.1:2/callback', client_id: reg.client_id })).status, 400, 'redirect_uri must match the authorization request');
    assert.strictEqual(s.stats.codeGrants, 0);

    // 6. the right verifier gets tokens
    const code2 = new URL((await authorize(challenge)).headers.get('location')!).searchParams.get('code')!;
    const t = (await (await tokenReq({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.client_id, resource: s.url })).json()) as { access_token: string; refresh_token: string; token_type: string };
    assert.strictEqual(t.token_type, 'Bearer');
    assert.strictEqual(s.stats.authorizations, 3);
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

    // 7b. RFC 8707: a token issued for another resource is refused by /mcp (401 invalid_token); a refresh cannot change its resource
    const codeO = new URL((await authorize(challenge, REDIRECT, 'S256', `${s.base}/other`)).headers.get('location')!).searchParams.get('code')!;
    const tO = (await (await tokenReq({ grant_type: 'authorization_code', code: codeO, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.client_id })).json()) as { access_token: string; refresh_token: string };
    assert.ok(tO.access_token);
    const rO = await rpc(init, tO.access_token);
    assert.strictEqual(rO.status, 401, 'a token for another resource is not valid at /mcp');
    assert.match(rO.headers.get('www-authenticate') ?? '', /error="invalid_token"/);
    assert.strictEqual((await tokenReq({ grant_type: 'refresh_token', refresh_token: tO.refresh_token, client_id: reg.client_id, resource: s.url })).status, 400, 'refresh keeps the resource');
    // with no resource at all the token is for this server's /mcp
    const codeN = new URL((await authorize(challenge, REDIRECT, 'S256', '')).headers.get('location')!).searchParams.get('code')!;
    const tN = (await (await tokenReq({ grant_type: 'authorization_code', code: codeN, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.client_id })).json()) as { access_token: string };
    assert.strictEqual((await rpc(init, tN.access_token)).status, 200, 'no resource indicator: bound to /mcp');

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

  // the real check's status log: every mcp state per session, in order, repeats folded, other sessions and servers ignored
  const ev = (sessionId: string, servers: Array<{ name: string; status: string }>): AgentEvent => ({ type: 'mcp', sessionId, servers } as unknown as AgentEvent);
  const events: AgentEvent[] = [
    ev('a', [{ name: 'demo-oauth', status: 'pending' }]),
    ev('b', [{ name: 'demo-oauth', status: 'failed' }]),
    ev('a', [{ name: 'demo-oauth', status: 'needs-auth' }, { name: 'other', status: 'connected' }]),
    ev('a', [{ name: 'demo-oauth', status: 'needs-auth' }]),
    { type: 'status', sessionId: 'a' } as unknown as AgentEvent,
    ev('a', [{ name: 'demo-oauth', status: 'connected' }]),
    ev('a', [{ name: 'other', status: 'connected' }]),
  ];
  assert.deepStrictEqual(statusSequence(events, 'a'), ['pending', 'needs-auth', 'connected', '(absent)']);
  assert.deepStrictEqual(statusSequence(events, 'b'), ['failed']);
  assert.deepStrictEqual(statusSequence(events, 'c'), []);
  console.log('demo OAuth MCP server: 401 + metadata, DCR, PKCE S256 only, one-use codes, registered redirects, redirect_uri match, resource-bound tokens, refresh rotation, MCP OK; status sequence');
}
main().catch((e) => { console.error(e); process.exit(1); });
