/**
 * Spec 118 T507 (FR-006; spec 076 FR-155, FR-156): update requests use their own session. `npm run test:selfupdate-session`.
 * Stub sessions and a stub request layer (an event emitter, as in test-selfupdate-feedget.ts): no Electron, no network. The real
 * run through a recording proxy is `scripts/check-118-update-session.js` (through el.sh, not in `npm test`).
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { FIXED_HEADERS, UPDATE_PARTITION, jsString, makeUpdateFeedGet, pacFor, updateSession, useDefaultSessionProxy } from '../src/main/netget';
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
  constructor(public opts: NetRequestOptions & { session: NetSessionLike }, private held = false) { super(); }
  setHeader(k: string, v: string): void { this.headers[k] = v; }
  end(): void {
    if (this.held) return; // never answers: the caller's own timer ends it
    setImmediate(() => {
      const res = new FakeRes(200, { 'content-type': 'application/json; charset=utf-8' });
      this.emit('response', res);
      setImmediate(() => { res.emit('data', Buffer.from('[]')); res.emit('end'); });
    });
  }
  abort(): void { /* nothing */ }
}
function requests(held = false): { request: SessionRequest; reqs: FakeReq[] } {
  const reqs: FakeReq[] = [];
  return { reqs, request: (o) => { const r = new FakeReq(o, held); reqs.push(r); return r as unknown as NetRequestLike; } };
}
// CRLF-safe (Windows checkouts): line ends are normalised before anything is cut
const stripComments = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const ticks = async (n = 8): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
/** A fake clock: `set` arms a callback at now + ms, `advance` moves the clock and fires what is due. */
function fakeClock(): { timer: FeedTimer; now: () => number; advance(ms: number): void } {
  let t = 0;
  let ids = 0;
  const due: { at: number; cb: () => void; id: number }[] = [];
  return {
    now: () => t,
    timer: { set: (cb, ms) => { ids++; due.push({ at: t + ms, cb, id: ids }); return ids; }, clear: (h) => { const i = due.findIndex((d) => d.id === h); if (i >= 0) due.splice(i, 1); } },
    advance(ms) { t += ms; for (const d of due.filter((x) => x.at <= t)) { due.splice(due.indexOf(d), 1); d.cb(); } },
  };
}
/** FR-156 guard: a certificate verifier or an app-level certificate-error handler, in any quote style or listener form. */
const CERT_VERIFY = /\bsetCertificateVerifyProc\b/;
const APP_CERT_ERROR = /\bapp\s*\??\.\s*(?:on|once|addListener|prependListener|prependOnceListener)\s*\(\s*(['"`])certificate-error\1/;
const certHook = (src: string): boolean => { const code = stripComments(src); return CERT_VERIFY.test(code) || APP_CERT_ERROR.test(code); };

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
    const s = sessionsWith(async (u) => (new URL(u).host === 'api.github.com' ? 'PROXY 10.0.0.1:3128; DIRECT' : 'DIRECT'));
    const t = new StubSession('t');
    await useDefaultSessionProxy(t, s, LIST);
    assert.deepStrictEqual(s.def.asked, [LIST], 'the default session is asked for the exact URL');
    assert.deepStrictEqual(t.proxies, [{ mode: 'pac_script', pacScript: pacFor('PROXY 10.0.0.1:3128; DIRECT') }], 'its answer is set on the target');
    const body = (r: string): string | undefined => { const p = pacFor(r); return p === undefined ? undefined : decodeURIComponent(p.slice('data:application/x-ns-proxy-autoconfig,'.length)); };
    assert.strictEqual(body('PROXY 10.0.0.1:3128;  DIRECT'), 'function FindProxyForURL(url, host) { return "PROXY 10.0.0.1:3128; DIRECT"; }', 'a PAC answer becomes a one-line PAC script');
    for (const ok of ['DIRECT', 'HTTPS proxy.corp.example:443', 'SOCKS5 [fe80::1]:1080; PROXY p_1.example:80; DIRECT', 'QUIC q.example:443']) assert.ok(pacFor(ok), `accepted: ${ok}`);
    for (const bad of ['', 'PROXY a:1"; x(); "', 'PROXY a:1</script>', 'PROXY host', 'FTP a:21', 'PROXY a\u2028b:1', 'PROXY a\u2029:1', 'direct', 'PROXY a b:1']) {
      assert.strictEqual(pacFor(bad), undefined, `refused (never written into code; loosened-host mutant dies here): ${JSON.stringify(bad).slice(0, 40)}`);
      const t2 = new StubSession('t2');
      await assert.rejects(useDefaultSessionProxy(t2, sessionsWith(async () => bad), LIST), 'a proxy answer outside the grammar is refused');
      assert.deepStrictEqual(t2.proxies, [], 'and nothing is set');
    }
  }

  // review of PR 2123, item 3c: each layer of the PAC script on its own, each with a hostile answer
  {
    // layer 1, the entry grammar: a host with a quote, a backslash, a single quote, a backtick, an angle bracket, a brace or a newline
    for (const host of ['a"b', 'a\\b', "a'b", 'a`b', 'a<b', 'a}b', 'a\nb', 'a/b', 'a(b)']) {
      assert.strictEqual(pacFor(`PROXY ${host}:8080; DIRECT`), undefined, `layer grammar: a hostile host is refused: ${JSON.stringify(host)} (loosened-host mutant dies here)`);
    }
    // layer 2, the caps: 16 valid entries are accepted, a 17th is refused; valid entries past 4096 characters are refused
    const host = (i: number): string => `h${i}.` + 'a'.repeat(245);
    assert.ok(pacFor(Array.from({ length: 16 }, (_, i) => `PROXY h${i}.example:1`).join('; ')), 'layer caps: 16 short entries are accepted');
    assert.strictEqual(pacFor(Array(17).fill('DIRECT').join('; ')), undefined, 'layer caps: a 17th entry is refused (entry-cap mutant dies here)');
    const long = Array.from({ length: 16 }, (_, i) => `PROXY ${host(i)}:1`).join('; ');
    assert.ok(long.length > 4096 && long.split('; ').every((e) => e.length < 260), 'the fixture: valid entries, longer than 4096 in all');
    assert.strictEqual(pacFor(long), undefined, 'layer caps: an answer longer than 4096 characters is refused (length-cap mutant dies here)');
    // layer 3, the string literal: jsString quotes and escapes on its own, whatever the grammar lets through
    const hostile = 'a"b\\c\nd</script>\u2028\u2029`${x}`\'e';
    assert.ok(jsString('a"b').startsWith('"a\\"') && jsString('a\nb') === '"a\\nb"', 'layer string: quotes and newlines are escaped by JSON.stringify (no-JSON.stringify mutant dies here)');
    assert.strictEqual(jsString(hostile), '"a\\"b\\\\c\\nd\\u003c\\u002fscript\\u003e\\u2028\\u2029`${x}`\'e"', 'layer string: the exact literal (no-escape mutant dies here)');
    // eslint-disable-next-line no-new-func
    assert.strictEqual(new Function(`return ${jsString(hostile)};`)(), hostile, 'layer string: the literal evaluates back to the same text, never code');
    // layer 4, the data: URL: only encodeURIComponent's characters after the prefix, and it decodes to the exact script
    const pac = pacFor('SOCKS5 [fe80::1]:1080; DIRECT') ?? '';
    assert.ok(/^data:application\/x-ns-proxy-autoconfig,[A-Za-z0-9\-_.!~*'()%]+$/.test(pac), 'layer url: the script is percent-encoded (no-encoding mutant dies here)');
    assert.strictEqual(decodeURIComponent(pac.slice('data:application/x-ns-proxy-autoconfig,'.length)), 'function FindProxyForURL(url, host) { return "SOCKS5 [fe80::1]:1080; DIRECT"; }', 'layer url: it decodes to the exact script');
  }

  // a request: the update session (never the default one), the helper before it, no cookie, no credentials
  {
    const s = sessionsWith(async (u) => `PROXY p-${new URL(u).host}:8080`);
    const n = requests();
    const get = makeUpdateFeedGet(s, n.request);
    assert.deepStrictEqual(await get(LIST, SLUG), { ok: true, kind: 'list', bytes: Buffer.from('[]') }, 'the list is read');
    assert.deepStrictEqual(await get(RAW, SLUG), { ok: true, kind: 'releases', bytes: Buffer.from('[]') }, 'releases.json is read');
    const upd = s.parts[0];
    assert.strictEqual(s.parts.length, 1, 'one update session for every request');
    assert.ok(n.reqs.every((r) => r.opts.session === upd), 'every request runs on the update session (default-session mutant dies here)');
    assert.ok(n.reqs.every((r) => r.opts.session !== s.def), 'no request on the default session');
    assert.deepStrictEqual(s.def.asked, [LIST, RAW], 'the default session is asked for each URL, in order (helper-skipped mutant dies here)');
    assert.deepStrictEqual(upd.proxies.map((p) => p.pacScript), [pacFor('PROXY p-api.github.com:8080'), pacFor('PROXY p-raw.githubusercontent.com:8080')],
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

  // review of PR 2123, item 1: a late proxy answer of an ended request never changes the proxy of the next one
  for (const how of ['timeout', 'abort'] as const) {
    let release: ((r: string) => void) | undefined;
    let calls = 0;
    const s = sessionsWith((u) => { calls++; return calls === 1 ? new Promise<string>((r) => { release = r; }) : Promise.resolve(`PROXY b-${new URL(u).host}:2`); });
    const clock = fakeClock();
    const n = requests(true);
    const get = makeUpdateFeedGet(s, n.request, clock.timer, 10_000, clock.now);
    const ac = new AbortController();
    const a = get(LIST, SLUG, ac.signal);
    await ticks();
    if (how === 'timeout') clock.advance(10_000); else ac.abort();
    assert.deepStrictEqual(await a, { ok: false, reason: how === 'timeout' ? 'timeout' : 'aborted' }, `late answer (${how}): the first request ends without its lookup`);
    void get(RAW, SLUG);
    await ticks();
    assert.strictEqual(n.reqs.length, 1, `late answer (${how}): the second request is in flight`);
    release?.('PROXY a-late.example:1');
    await ticks();
    assert.deepStrictEqual(s.parts[0].proxies.map((p) => p.pacScript), [pacFor('PROXY b-raw.githubusercontent.com:2')],
      `late answer (${how}): only the second request's proxy was set; the first one's late answer set nothing (gate-removed mutant dies here)`);
  }

  // review of PR 2123, item 2: a throw (fromPartition before the app is ready) answers network and the queue stays usable
  {
    const s = sessionsWith();
    const real = s.fromPartition.bind(s);
    let first = true;
    s.fromPartition = (p, o) => { if (first) { first = false; throw new Error('Session can only be received when app is ready'); } return real(p, o); };
    const n = requests();
    const get = makeUpdateFeedGet(s, n.request);
    const one = await get(LIST, SLUG).catch((e: unknown) => ({ rejected: String(e) }));
    assert.deepStrictEqual(one, { ok: false, reason: 'network' }, 'a throw answers network, never a rejection (no-catch mutant dies here)');
    const two = await get(RAW, SLUG).catch((e: unknown) => ({ rejected: String(e) }));
    assert.deepStrictEqual(two, { ok: true, kind: 'releases', bytes: Buffer.from('[]') }, 'the next request still runs (poisoned-queue mutant dies here)');
  }

  // review of PR 2123, item 3a: one 10 s budget for the lookup and the request together (fake clock)
  {
    let release: ((r: string) => void) | undefined;
    const s = sessionsWith(() => new Promise<string>((r) => { release = r; }));
    const clock = fakeClock();
    const n = requests(true);
    let answer: unknown = 'pending';
    void makeUpdateFeedGet(s, n.request, clock.timer, 10_000, clock.now)(LIST, SLUG).then((a) => { answer = a; });
    await ticks();
    clock.advance(6_000);
    release?.('DIRECT');
    await ticks();
    assert.strictEqual(n.reqs.length, 1, 'budget: a 6 s lookup, then the request starts');
    clock.advance(6_000);
    await ticks();
    assert.deepStrictEqual(answer, { ok: false, reason: 'timeout' }, 'budget: 6 s lookup + 6 s request times out at 10 s (separate-budget mutant dies here)');
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
    // review of PR 2123, item 3b: the guard catches every spelling, and passes the webContents handlers and comments
    const caught = [
      'session.defaultSession.setCertificateVerifyProc((r, cb) => cb(0));', 'ses.setCertificateVerifyProc(null);', 'x["setCertificateVerifyProc"](f)',
      'app.on("certificate-error", h);', "app.once('certificate-error', h);", 'app.addListener(`certificate-error`, h);', "app.prependListener( 'certificate-error' , h);",
      "app.prependOnceListener('certificate-error', h);", "app?.on('certificate-error', h);", "app\r\n  .on('certificate-error', h);", "/* note */ app.on('certificate-error', h);",
    ];
    for (const c of caught) assert.ok(certHook(c), `cert guard catches: ${c} (single-quote-only or on-only mutants die here)`);
    const passed = ["on(wc, 'certificate-error', h.certificateError as never);", "wc.on('certificate-error', h);", "// app.on('certificate-error', h)", "/* ses.setCertificateVerifyProc(f) */", 'const n = "setCertificateVerifyProcX";'];
    for (const c of passed) assert.ok(!certHook(c), `cert guard passes: ${c}`);
    for (const f of walk(path.join(root, 'src', 'main'))) {
      assert.ok(!certHook(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)}: no certificate verifier or app certificate-error handler (else apply it to the update session as well)`);
    }
  }
  console.log('selfupdate-session: all checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
