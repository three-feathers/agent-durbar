/**
 * Spec 118 T507 (FR-006; spec 076 FR-155, FR-156): update requests use their own session. `npm run test:selfupdate-session`.
 * Stub sessions and a stub request layer (an event emitter, as in test-selfupdate-feedget.ts): no Electron, no network. The real
 * run through a recording proxy is `scripts/check-118-update-session.js` (through el.sh, not in `npm test`).
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { FIXED_HEADERS, UPDATE_PARTITION, makeUpdateFeedGet, pacFor, updateSession, useDefaultSessionProxy } from '../src/main/netget';
import type { FeedTimer, NetRequestLike, NetRequestOptions, NetSessionLike, ProxyPac, SessionRequest, SessionsLike } from '../src/main/netget';

const SLUG = 'three-feathers/agent-durbar';
const LIST = `https://api.github.com/repos/${SLUG}/releases?per_page=30`;
const RAW = `https://raw.githubusercontent.com/${SLUG}/v0.1.29/releases.json`;

class StubSession implements NetSessionLike {
  proxies: ProxyPac[] = [];
  agents: [string, string | undefined][] = [];
  spell: string[] = [];
  asked: string[] = [];
  constructor(public name: string, private rule: (url: string) => Promise<string> = async () => 'DIRECT') {}
  resolveProxy(url: string): Promise<string> { this.asked.push(url); return this.rule(url); }
  setProxy(c: ProxyPac): Promise<void> { this.proxies.push(c); return Promise.resolve(); }
  setUserAgent(ua: string, langs?: string): void { this.agents.push([ua, langs]); }
  setSpellCheckerEnabled(on: boolean): void { this.spell.push(`enabled:${on}`); }
  setSpellCheckerLanguages(l: string[]): void { this.spell.push(`languages:${JSON.stringify(l)}`); }
}
function sessionsWith(rule?: (url: string) => Promise<string>): SessionsLike & { made: [string, { cache: boolean }][]; parts: StubSession[]; def: StubSession } {
  const def = new StubSession('default', rule);
  const made: [string, { cache: boolean }][] = [];
  const parts: StubSession[] = [];
  return {
    def, made, parts, defaultSession: def,
    fromPartition(p, o) { made.push([p, o]); const s = new StubSession(p); parts.push(s); return s; },
  };
}
class FakeRes extends EventEmitter { constructor(public statusCode: number, public headers: Record<string, string> = {}) { super(); } }
class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  constructor(public opts: NetRequestOptions & { session: NetSessionLike }) { super(); }
  setHeader(k: string, v: string): void { this.headers[k] = v; }
  end(): void {
    setImmediate(() => {
      const res = new FakeRes(200, { 'content-type': 'application/json; charset=utf-8' });
      this.emit('response', res);
      setImmediate(() => { res.emit('data', Buffer.from('[]')); res.emit('end'); });
    });
  }
  abort(): void { /* nothing */ }
}
function requests(): { request: SessionRequest; reqs: FakeReq[] } {
  const reqs: FakeReq[] = [];
  return { reqs, request: (o) => { const r = new FakeReq(o); reqs.push(r); return r as unknown as NetRequestLike; } };
}
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

async function main(): Promise<void> {
  // the session: in memory, cache off, the minimal User-Agent, made once
  {
    const s = sessionsWith();
    const a = updateSession(s);
    const b = updateSession(s);
    assert.strictEqual(a, b, 'the update session is made once');
    assert.deepStrictEqual(s.made, [['durbar-update', { cache: false }]], 'one partition, cache: false (cache-on mutant dies here)');
    assert.strictEqual(UPDATE_PARTITION, 'durbar-update');
    assert.ok(!UPDATE_PARTITION.startsWith('persist:'), 'non-persistent partition: nothing of it on the disk');
    assert.deepStrictEqual(s.parts[0].agents, [['AgentDurbar', 'en']], 'the session User-Agent is exactly FR-006\'s AgentDurbar, Accept-Language en (User-Agent-left-default mutant dies here)');
    assert.strictEqual(FIXED_HEADERS['User-Agent'], 'AgentDurbar', 'the session User-Agent equals the request header');
    assert.deepStrictEqual(s.def.agents, [], 'the default session\'s User-Agent is not touched');
    assert.deepStrictEqual(s.parts[0].spell, ['languages:[]', 'enabled:false'], 'no spell checker dictionary: an empty language list (which stops the fetch a new session starts) and the checker off');
    assert.ok(!/[\s/;()]/.test(s.parts[0].agents[0][0]), 'minimal: no version, OS, Chrome or Electron token');
  }

  // the proxy helper: the default session's answer for that URL, set on the target as a PAC script
  {
    const s = sessionsWith(async (u) => (u.includes('api.github.com') ? 'PROXY 10.0.0.1:3128; DIRECT' : 'DIRECT'));
    const t = new StubSession('t');
    await useDefaultSessionProxy(t, s, LIST);
    assert.deepStrictEqual(s.def.asked, [LIST], 'the default session is asked for the exact URL');
    assert.deepStrictEqual(t.proxies, [{ mode: 'pac_script', pacScript: pacFor('PROXY 10.0.0.1:3128; DIRECT') }], 'its answer is set on the target');
    const script = decodeURIComponent(pacFor('PROXY a:1"; x(); "').slice('data:application/x-ns-proxy-autoconfig,'.length));
    assert.strictEqual(script, 'function FindProxyForURL(url, host) { return "PROXY a:1\\"; x(); \\""; }', 'the answer is quoted with JSON.stringify: never code');
    for (const bad of ['', 'x'.repeat(4097)]) {
      const t2 = new StubSession('t2');
      await assert.rejects(useDefaultSessionProxy(t2, sessionsWith(async () => bad), LIST), 'an empty or huge proxy answer is refused');
      assert.deepStrictEqual(t2.proxies, [], 'and nothing is set');
    }
  }

  // a request: the update session (never the default one), the helper before it, no cookie, no credentials
  {
    const s = sessionsWith(async (u) => `PROXY p.example:8080 ${new URL(u).host}`);
    const n = requests();
    const get = makeUpdateFeedGet(s, n.request);
    assert.deepStrictEqual(await get(LIST, SLUG), { ok: true, kind: 'list', bytes: Buffer.from('[]') }, 'the list is read');
    assert.deepStrictEqual(await get(RAW, SLUG), { ok: true, kind: 'releases', bytes: Buffer.from('[]') }, 'releases.json is read');
    const upd = s.parts[0];
    assert.strictEqual(s.parts.length, 1, 'one update session for every request');
    assert.ok(n.reqs.every((r) => r.opts.session === upd), 'every request runs on the update session (default-session mutant dies here)');
    assert.ok(n.reqs.every((r) => r.opts.session !== s.def), 'no request on the default session');
    assert.deepStrictEqual(s.def.asked, [LIST, RAW], 'the default session is asked for each URL, in order (helper-skipped mutant dies here)');
    assert.deepStrictEqual(upd.proxies.map((p) => p.pacScript), [pacFor('PROXY p.example:8080 api.github.com'), pacFor('PROXY p.example:8080 raw.githubusercontent.com')],
      'the default session\'s proxy for each URL is set on the update session before its request');
    for (const r of n.reqs) {
      assert.strictEqual(r.opts.credentials, 'omit', 'credentials omitted');
      assert.strictEqual(r.opts.useSessionCookies, false, 'no session cookies');
      assert.strictEqual(r.opts.cache, 'no-store', 'no-store on each request too');
      assert.ok(!Object.keys(r.headers).some((k) => /^(cookie|authorization)$/i.test(k)), 'no Cookie or Authorization header');
      assert.strictEqual(r.headers['User-Agent'], 'AgentDurbar', 'the request header stays AgentDurbar');
    }
  }

  // order: the proxy is set before the request object exists
  {
    const order: string[] = [];
    const s = sessionsWith(async () => { order.push('lookup'); return 'DIRECT'; });
    const n = requests();
    await makeUpdateFeedGet(s, (o) => { order.push('request'); return n.request(o); })(LIST, SLUG);
    assert.deepStrictEqual(order, ['lookup', 'request'], 'lookup first, then the request');
  }

  // one update request at a time: the second lookup starts only after the first request ended
  {
    const order: string[] = [];
    const s = sessionsWith(async (u) => { order.push('lookup ' + new URL(u).host); return 'DIRECT'; });
    const n = requests();
    const get = makeUpdateFeedGet(s, (o) => { order.push('request ' + new URL(o.url).host); const r = n.request(o); r.on('response', () => order.push('answer ' + new URL(o.url).host)); return r; });
    await Promise.all([get(LIST, SLUG), get(RAW, SLUG)]);
    assert.deepStrictEqual(order, ['lookup api.github.com', 'request api.github.com', 'answer api.github.com', 'lookup raw.githubusercontent.com', 'request raw.githubusercontent.com', 'answer raw.githubusercontent.com'],
      'two update requests at once run one after the other, so the proxy set for one URL never serves the other');
  }

  // refusals: no lookup and no request
  {
    const s = sessionsWith();
    const n = requests();
    assert.deepStrictEqual(await makeUpdateFeedGet(s, n.request)('https://evil.example/x', SLUG), { ok: false, reason: 'not-allowed' }, 'a URL off the list');
    const ac = new AbortController(); ac.abort();
    assert.deepStrictEqual(await makeUpdateFeedGet(s, n.request)(LIST, SLUG, ac.signal), { ok: false, reason: 'aborted' }, 'an aborted signal');
    assert.deepStrictEqual([s.def.asked, n.reqs.length], [[], 0], 'neither asks the proxy nor makes a request');
  }

  // a failed lookup is network, a lookup past the limit timeout, an abort during the lookup aborted: never a request
  {
    const n = requests();
    const failed = sessionsWith(async () => { throw new Error('C:\\secret\\pac failed'); });
    assert.deepStrictEqual(await makeUpdateFeedGet(failed, n.request)(LIST, SLUG), { ok: false, reason: 'network' }, 'a failed lookup is network (no text of it)');
    let fire: (() => void) | undefined;
    const fake: FeedTimer = { set: (cb) => { fire = cb; return 1; }, clear: () => { /* nothing */ } };
    const hung = sessionsWith(() => new Promise<string>(() => { /* never answers */ }));
    const p = makeUpdateFeedGet(hung, n.request, fake)(LIST, SLUG);
    await new Promise((r) => setImmediate(r));
    fire?.();
    assert.deepStrictEqual(await p, { ok: false, reason: 'timeout' }, 'a lookup that never answers ends at the limit');
    const ac = new AbortController();
    const q = makeUpdateFeedGet(sessionsWith(() => new Promise<string>(() => { /* never */ })), n.request, fake)(LIST, SLUG, ac.signal);
    ac.abort();
    assert.deepStrictEqual(await q, { ok: false, reason: 'aborted' }, 'an abort during the lookup');
    assert.strictEqual(n.reqs.length, 0, 'no request after a failed, slow or aborted lookup');
  }

  // the code: main.ts passes updateFeedGet, the real factory is net.request on updateSession, no certificate verifier anywhere
  {
    const root = path.join(__dirname, '..', '..');
    const net = stripComments(fs.readFileSync(path.join(root, 'src', 'main', 'netget.ts'), 'utf8'));
    assert.ok(/export function updateFeedGet\(\): FeedGet \{[\s\S]*?return makeUpdateFeedGet\(session as unknown as SessionsLike, \(o\) => net\.request\(o as never\)/.test(net), 'updateFeedGet: the electron session module and net.request with the session option');
    assert.ok(/request\(\{ \.\.\.o, session: ses \}\)/.test(net), 'makeUpdateFeedGet passes the update session to each request');
    const mainSrc = stripComments(fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8'));
    assert.ok(/get: updateFeedGet\(\)/.test(mainSrc) && !/makeFeedGet\(electronRequestFactory\(\)\)/.test(mainSrc), 'main.ts gives the checker the update session request');
    // FR-156: no session gets a verifier of its own, so the update session verifies exactly like the default one. If one is added, apply it in updateSession too.
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
    for (const f of walk(path.join(root, 'src', 'main'))) {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      assert.ok(!/setCertificateVerifyProc|app\.on\(\s*'certificate-error'/.test(src), `${path.relative(root, f)}: no certificate verifier or app certificate-error handler (else apply it to the update session as well)`);
    }
  }
  console.log('selfupdate-session: all checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
