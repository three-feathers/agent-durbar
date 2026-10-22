/**
 * Spec 058 T116: a demo remote MCP server that REQUIRES an OAuth sign-in, for the real check of FR-064/FR-070 (`scripts/mcp-oauth-real.ts`,
 * workflow "MCP OAuth real check"). Dependency-free (Node's `http` and `crypto`; the MCP part is Durbar's own `McpSession`, spec 041).
 * Test material only: it runs on loopback, keeps everything in memory, and auto-approves every sign-in (no consent page to click).
 *
 * The OAuth 2.1 flow of the MCP authorization spec (2025-06-18):
 *   - `POST /mcp` without a valid bearer token -> 401 with `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"`
 *   - protected-resource metadata (RFC 9728) -> `authorization_servers: [<base>]`
 *   - authorization-server metadata (RFC 8414), dynamic client registration (RFC 7591)
 *   - `/authorize`: S256 PKCE required, a registered `redirect_uri` only; auto-approves with a 302 to the redirect URI (code + state)
 *   - `/token`: `authorization_code` (verifier checked) and `refresh_token`; access tokens bound to the `resource` (RFC 8707): the
 *     resource asked for at `/authorize` (or `/token`), else this server's `/mcp`; `/mcp` refuses a token issued for another resource
 *
 *   node dist-scripts/scripts/demo-oauth-mcp.js [port]      (prints the MCP URL; Ctrl+C stops it)
 *
 * The counters (`stats`) are what the real check reads: a later session that connects with NO new `/authorize` proves the sign-in was kept.
 * No token is ever printed: `stats` holds counts only.
 */
import * as http from 'http';
import { createHash, randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { McpSession } from '../src/main/mcp/protocol';

export interface DemoStats {
  /** 401s for a request with no or a bad token. */
  challenges: number;
  registrations: number;
  /** `/authorize` requests that were approved (each one is a browser sign-in). */
  authorizations: number;
  /** `/authorize` or `/token` requests refused (bad client, redirect, PKCE, code). */
  refused: number;
  codeGrants: number;
  refreshGrants: number;
  /** MCP requests served with a valid token. */
  authorizedRequests: number;
  /** Method names seen with a valid token (no params). */
  methods: string[];
}

export interface DemoServer {
  /** The MCP endpoint, e.g. `http://127.0.0.1:12345/mcp`. */
  url: string;
  base: string;
  stats: DemoStats;
  close(): Promise<void>;
}

export interface DemoOptions {
  port?: number;
  /** Access-token lifetime in seconds (default one hour). */
  accessTtl?: number;
}

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (): string => b64url(randomBytes(32));
const MAX_BODY = 64 * 1024;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function startDemoOAuthMcp(opts: DemoOptions = {}): Promise<DemoServer> {
  const accessTtl = opts.accessTtl ?? 3600;
  const stats: DemoStats = { challenges: 0, registrations: 0, authorizations: 0, refused: 0, codeGrants: 0, refreshGrants: 0, authorizedRequests: 0, methods: [] };
  const clients = new Map<string, { redirectUris: string[] }>();
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; resource?: string; expires: number }>();
  const access = new Map<string, { clientId: string; resource: string; expires: number }>();
  const refresh = new Map<string, { clientId: string; resource: string }>();
  const sessions = new Map<string, McpSession>();
  let base = '';
  const resource = (): string => `${base}/mcp`;
  /** RFC 8707 resource indicators compared without a trailing slash. */
  const canon = (r: string): string => r.replace(/\/+$/, '');
  const prmUrl = (): string => `${base}/.well-known/oauth-protected-resource/mcp`;

  const prm = (): unknown => ({ resource: resource(), authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['mcp'] });
  const asMeta = (): unknown => ({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });

  const issue = (clientId: string, aud: string): Record<string, unknown> => {
    const at = token();
    const rt = token();
    access.set(at, { clientId, resource: canon(aud), expires: Date.now() + accessTtl * 1000 });
    refresh.set(rt, { clientId, resource: canon(aud) });
    return { access_token: at, token_type: 'Bearer', expires_in: accessTtl, refresh_token: rt, scope: 'mcp' };
  };

  const tokenEndpoint = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const raw = await readBody(req);
    const ct = String(req.headers['content-type'] ?? '');
    const p: Record<string, string> = ct.includes('application/json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    const bad = (error: string): void => { stats.refused++; json(res, 400, { error }); };
    if (p.grant_type === 'authorization_code') {
      const c = codes.get(p.code ?? '');
      codes.delete(p.code ?? ''); // one use
      if (!c || c.expires < Date.now()) return bad('invalid_grant');
      if (p.client_id && p.client_id !== c.clientId) return bad('invalid_client');
      if (p.redirect_uri !== c.redirectUri) return bad('invalid_grant');
      if (!p.code_verifier || b64url(createHash('sha256').update(p.code_verifier).digest()) !== c.challenge) return bad('invalid_grant');
      if (p.resource && c.resource && canon(p.resource) !== canon(c.resource)) return bad('invalid_target');
      stats.codeGrants++;
      return json(res, 200, issue(c.clientId, c.resource || p.resource || resource()));
    }
    if (p.grant_type === 'refresh_token') {
      const r = refresh.get(p.refresh_token ?? '');
      if (!r || (p.client_id && p.client_id !== r.clientId)) return bad('invalid_grant');
      if (p.resource && canon(p.resource) !== r.resource) return bad('invalid_target');
      refresh.delete(p.refresh_token); // rotation
      stats.refreshGrants++;
      return json(res, 200, issue(r.clientId, r.resource));
    }
    return bad('unsupported_grant_type');
  };

  const authorize = (u: URL, res: http.ServerResponse): void => {
    const q = u.searchParams;
    const client = clients.get(q.get('client_id') ?? '');
    const redirectUri = q.get('redirect_uri') ?? '';
    // never redirect to an address the client did not register (an open redirect otherwise)
    if (!client || !client.redirectUris.includes(redirectUri)) { stats.refused++; return json(res, 400, { error: 'invalid_request' }); }
    const back = new URL(redirectUri);
    const state = q.get('state');
    if (state !== null) back.searchParams.set('state', state);
    if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) {
      stats.refused++;
      back.searchParams.set('error', 'invalid_request');
    } else {
      const code = token();
      codes.set(code, { clientId: q.get('client_id')!, redirectUri, challenge: q.get('code_challenge')!, resource: q.get('resource') || undefined, expires: Date.now() + 120_000 });
      stats.authorizations++; // auto-approved: this is the "browser sign-in"
      back.searchParams.set('code', code);
    }
    res.writeHead(302, { location: back.toString(), 'cache-control': 'no-store' });
    res.end();
  };

  const mcp = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const auth = String(req.headers.authorization ?? '');
    const at = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    const grant = at ? access.get(at) : undefined;
    // RFC 8707: a token issued for another resource (audience) is not valid here
    if (!grant || grant.expires < Date.now() || grant.resource !== canon(resource())) {
      stats.challenges++;
      const err = at ? ', error="invalid_token"' : '';
      return json(res, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${prmUrl()}", scope="mcp"${err}` });
    }
    if (req.method === 'GET') { res.writeHead(405, { allow: 'POST, DELETE' }); res.end(); return; } // no server-to-client stream
    const sidHeader = String(req.headers['mcp-session-id'] ?? '');
    if (req.method === 'DELETE') { sessions.delete(sidHeader); res.writeHead(204); res.end(); return; }
    let msg: { method?: unknown; id?: unknown };
    const raw = await readBody(req);
    try { msg = JSON.parse(raw); } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    stats.authorizedRequests++;
    if (typeof msg.method === 'string' && stats.methods.length < 50) stats.methods.push(msg.method);
    let sid = sidHeader;
    let s = sessions.get(sid);
    if (msg.method === 'initialize') {
      sid = token();
      s = new McpSession({
        serverInfo: { name: 'durbar-demo-oauth', version: '1.0.0' },
        methods: {
          'tools/list': () => ({ tools: [{ name: 'demo_echo', description: 'Echo the text back (demo OAuth MCP server).', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }),
          'tools/call': (params) => {
            const t = (params as { arguments?: { text?: unknown } } | undefined)?.arguments?.text;
            return { content: [{ type: 'text', text: `demo: ${String(t ?? '').slice(0, 200)}` }] };
          },
        },
      });
      sessions.set(sid, s);
    }
    if (!s) return json(res, 404, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'Session not found' } });
    const reply = await s.handleLine(raw);
    if (reply === null) { res.writeHead(202, { 'mcp-session-id': sid }); res.end(); return; }
    json(res, 200, reply, { 'mcp-session-id': sid });
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', base || 'http://127.0.0.1');
    const route = async (): Promise<void> => {
      if (req.method === 'GET' && (u.pathname === '/.well-known/oauth-protected-resource/mcp' || u.pathname === '/.well-known/oauth-protected-resource')) return json(res, 200, prm());
      if (req.method === 'GET' && (u.pathname === '/.well-known/oauth-authorization-server' || u.pathname === '/.well-known/openid-configuration')) return json(res, 200, asMeta());
      if (req.method === 'POST' && u.pathname === '/register') {
        const p = JSON.parse((await readBody(req)) || '{}') as { redirect_uris?: unknown; client_name?: unknown };
        const uris = Array.isArray(p.redirect_uris) ? p.redirect_uris.filter((x): x is string => typeof x === 'string' && /^https?:\/\//.test(x)) : [];
        if (!uris.length) { stats.refused++; return json(res, 400, { error: 'invalid_redirect_uri' }); }
        const id = `demo-${b64url(randomBytes(9))}`;
        clients.set(id, { redirectUris: uris });
        stats.registrations++;
        return json(res, 201, { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: typeof p.client_name === 'string' ? p.client_name.slice(0, 64) : undefined });
      }
      if (req.method === 'GET' && u.pathname === '/authorize') return authorize(u, res);
      if (req.method === 'POST' && u.pathname === '/token') return tokenEndpoint(req, res);
      if (u.pathname === '/mcp') return mcp(req, res);
      json(res, 404, { error: 'not_found' });
    };
    route().catch(() => { if (!res.headersSent) json(res, 400, { error: 'invalid_request' }); else res.end(); });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const { address, port } = server.address() as AddressInfo;
      base = `http://${address}:${port}`; // from the bound address, so a test sees a bind other than loopback
      resolve({ url: resource(), base, stats, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] ?? 0) || 0;
  startDemoOAuthMcp({ port }).then((s) => console.log(`demo OAuth MCP server: ${s.url}`), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
