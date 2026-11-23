/**
 * Spec 118 T009 (FR-007, FR-009, FR-025): `feedAllowed` and `makeFeedGet`, Durbar's own update-check request, on a fake request
 * layer (an event emitter, as in test-updatecheck.ts). `npm run test:selfupdate-feedget`. No network, no real timer in an assert:
 * the timeout runs on a fake timer, the streaming cap on a chunk counter. The token test plants a value in a child's environment.
 */
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { feedAllowed, makeFeedGet, FEED_FAILURES, FEED_TIMEOUT_MS, FIXED_HEADERS } from '../src/main/netget';
import type { FeedAnswer, FeedTimer,NetRequestFactory, NetRequestLike, NetRequestOptions } from '../src/main/netget';
import { decodeUtf8Strict, validateFeed, MAX_FEED_BYTES, MAX_RELEASES_JSON_BYTES } from '../src/shared/selfupdate';

const SLUG = 'three-feathers/agent-durbar';
const LIST = `https://api.github.com/repos/${SLUG}/releases?per_page=30`;
const RAW = `https://raw.githubusercontent.com/${SLUG}/v0.1.29/releases.json`;

class FakeRes extends EventEmitter { constructor(public statusCode: number, public headers: Record<string, string> = {}) { super(); } }
class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  aborted = false;
  constructor(public opts: NetRequestOptions, private script: (r: FakeReq) => void) { super(); }
  setHeader(k: string, v: string): void { this.headers[k] = v; }
  end(): void { setImmediate(() => this.script(this)); }
  abort(): void { this.aborted = true; }
}
function netWith(script: (r: FakeReq) => void): { factory: NetRequestFactory; reqs: FakeReq[] } {
  const reqs: FakeReq[] = [];
  return { reqs, factory: (o) => { const r = new FakeReq(o, script); reqs.push(r); return r as unknown as NetRequestLike; } };
}
const JSON_CT = { 'content-type': 'application/json; charset=utf-8' };
const answer = (status: number, body: string | Buffer, headers: Record<string, string> = JSON_CT) => (r: FakeReq) => {
  const res = new FakeRes(status, headers);
  r.emit('response', res);
  setImmediate(() => { res.emit('data', Buffer.from(body)); res.emit('end'); });
};

async function child(): Promise<void> {
  // runs with a planted GITHUB_TOKEN / GH_TOKEN in its environment; prints what the request carried
  const n = netWith(answer(200, '[]'));
  await makeFeedGet(n.factory)(LIST, SLUG);
  await makeFeedGet(netWith(answer(200, '{}', { 'content-type': 'text/plain' })).factory)(RAW, SLUG);
  process.stdout.write(JSON.stringify({ opts: n.reqs[0].opts, headers: n.reqs[0].headers }));
}

async function main(): Promise<void> {
  // FR-025: a token in the environment never rides along (planted by env in a child, never written into code)
  {
    const tok = 'tok' + randomBytes(16).toString('hex');
    const r = spawnSync(process.execPath, [__filename, '--child'], { env: { ...process.env, GITHUB_TOKEN: tok, GH_TOKEN: tok }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'the token child ran');
    assert.ok(!r.stdout.includes(tok) && !r.stderr.includes(tok), 'a planted GITHUB_TOKEN/GH_TOKEN is in no header or option');
    const got = JSON.parse(r.stdout) as { opts: NetRequestOptions; headers: Record<string, string> };
    assert.ok(!Object.keys(got.headers).some((k) => /^(authorization|cookie)$/i.test(k)), 'no Authorization or Cookie header with a token in the environment');
  }

  // FR-007: the exact allow-list
  assert.strictEqual(feedAllowed(LIST, SLUG), 'list', 'the release list of the source');
  assert.strictEqual(feedAllowed(RAW, SLUG), 'releases', "a stable tag's releases.json of the source");
  const refusedList: [string, string][] = [
    ['a look-alike host (suffix)', LIST.replace('api.github.com', 'api.github.com.evil.example')],
    ['a look-alike host (prefix)', LIST.replace('api.github.com', 'xapi.github.com')],
    ['userinfo', LIST.replace('https://', 'https://u:p@')],
    ['an explicit port', LIST.replace('api.github.com', 'api.github.com:443')],
    ['a trailing dot', LIST.replace('api.github.com', 'api.github.com.')],
    ['an IDN host', LIST.replace('api.github.com', 'api.gіthub.com')],
    ['a punycode host', LIST.replace('api.github.com', 'api.xn--gthub-n4a.com')],
    ['an upper-case host', LIST.replace('api.github.com', 'API.GITHUB.COM')],
    ['an IP literal', LIST.replace('api.github.com', '140.82.112.6')],
    ['plain http', LIST.replace('https:', 'http:')],
    ['another slug', LIST.replace(SLUG, 'ravi/durbar')],
    ['the slug in another case', LIST.replace(SLUG, SLUG.toUpperCase())],
    ['a query added', LIST + '&x=1'],
    ['another page size', LIST.replace('30', '100')],
    ['a fragment', LIST + '#x'],
    ['a trailing slash', LIST.replace('releases?', 'releases/?')],
    ['a dot segment', LIST.replace('/releases', '/x/../releases')],
    ['an encoded slash', LIST.replace(SLUG, SLUG.replaceAll('/', '%2F'))],
    ['a leading space', ' ' + LIST],
  ];
  for (const [what, u] of refusedList) assert.strictEqual(feedAllowed(u, SLUG), undefined, 'list refused: ' + what);
  const refusedRaw: [string, string][] = [
    ['another slug', RAW.replace(SLUG, 'ravi/durbar')],
    ['a look-alike raw host', RAW.replace('raw.githubusercontent.com', 'raw.githubusercontent.com.evil.example')],
    ['a pre-release tag', RAW.replace('v0.1.29', 'v0.1.29-alpha.1')],
    ['a tag without v', RAW.replace('v0.1.29', '0.1.29')],
    ['a tag with a path', RAW.replace('v0.1.29', 'v0.1.29/x')],
    ['a branch', RAW.replace('v0.1.29', 'main')],
    ['another file', RAW.replace('releases.json', 'package.json')],
    ['a query added', RAW + '?x=1'],
    ['a fragment', RAW + '#x'],
  ];
  for (const [what, u] of refusedRaw) assert.strictEqual(feedAllowed(u, SLUG), undefined, 'releases.json refused: ' + what);
  for (const s of [undefined, '', 'evil', 'a/b/c', 42]) assert.strictEqual(feedAllowed(LIST, s), undefined, 'no valid slug, nothing allowed: ' + String(s));
  assert.strictEqual(feedAllowed(42, SLUG), undefined, 'a non-string URL is refused');

  // an address off the list: refused before any request
  {
    const n = netWith(answer(200, '[]'));
    assert.deepStrictEqual(await makeFeedGet(n.factory)(LIST.replace(SLUG, 'ravi/durbar'), SLUG), { ok: false, reason: 'not-allowed' }, 'another slug is refused');
    assert.strictEqual(n.reqs.length, 0, 'no request object for an off-list address');
  }

  // the list: GET only, no cookies, no credentials, the fixed headers, end to end through the pure validator
  {
    const fixture = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'selfupdate', 'releases.fixture'), 'utf8').split('\n').slice(1).join('\n');
    const n = netWith(answer(200, fixture));
    const a = await makeFeedGet(n.factory)(LIST, SLUG);
    assert.ok(a.ok && a.kind === 'list', 'a 200 JSON list is read');
    assert.ok(a.ok && validateFeed(JSON.parse(decodeUtf8Strict(a.bytes) ?? ''), SLUG), 'the bytes reach the pure validator unchanged');
    assert.strictEqual(n.reqs.length, 1, 'one request');
    assert.strictEqual(n.reqs[0].opts.cache, 'no-store', 'no HTTP cache: a cached redirect or list never answers a check');
    assert.deepStrictEqual(n.reqs[0].opts, { method: 'GET', url: LIST, redirect: 'manual', credentials: 'omit', useSessionCookies: false, cache: 'no-store' }, 'GET, manual redirects, no credentials, no session cookies');
    assert.ok(!Object.keys(n.reqs[0].headers).some((k) => /^if-/i.test(k)), 'no validators (If-None-Match, If-Modified-Since): a 304 is never asked for');
    assert.deepStrictEqual(n.reqs[0].headers, { ...FIXED_HEADERS, Accept: 'application/vnd.github+json' }, 'exactly the FR-006 headers on the list');
  }
  {
    const n = netWith(answer(200, '{"schema":1,"versions":{}}', { 'content-type': 'text/plain; charset=utf-8' }));
    const a = await makeFeedGet(n.factory)(RAW, SLUG);
    assert.ok(a.ok && a.kind === 'releases', "releases.json is read whatever its content type (FR-009 names none; raw files are text/plain)");
    assert.deepStrictEqual(n.reqs[0].headers, { ...FIXED_HEADERS }, 'releases.json carries only the fixed headers');
  }

  // FR-007: refusals, each with its own code (a body is summarised by its size, so a failed assert never prints megabytes)
  const brief = (a: FeedAnswer) => (a.ok ? { ok: true, kind: a.kind, size: a.bytes.length } : a);
  const get = async (script: (r: FakeReq) => void, url = LIST) => { const n = netWith(script); return { a: brief(await makeFeedGet(n.factory)(url, SLUG)), n }; };
  {
    const { a, n } = await get((r) => { r.emit('redirect', 301, 'GET', 'https://api.github.com/repositories/1/releases'); answer(200, '[]')(r); });
    assert.deepStrictEqual(a, { ok: false, reason: 'redirect' }, 'a redirect event is refused, never followed');
    assert.ok(n.reqs[0].aborted, 'the redirected request is aborted');
  }
  for (const s of [301, 302, 303, 307, 308]) assert.deepStrictEqual((await get(answer(s, '[]'))).a, { ok: false, reason: 'redirect' }, 'a redirect response is refused: ' + s);
  for (const s of [300, 304, 305, 306]) assert.deepStrictEqual((await get(answer(s, '[]'))).a, { ok: false, reason: 'status' }, 'a 3xx that is not a redirect is an unexpected status: ' + s);
  for (const s of [203, 204, 404, 500]) assert.deepStrictEqual((await get(answer(s, '[]'))).a, { ok: false, reason: 'status' }, 'only 200: ' + s);
  for (const h of [{ 'content-type': 'text/html' }, {}] as Record<string, string>[]) assert.deepStrictEqual((await get(answer(200, '[]', h))).a, { ok: false, reason: 'content-type' }, 'the list must be application/json: ' + JSON.stringify(h));

  // the cap, counted while streaming: the request is cut at the first chunk past it, not after the body ends
  const stream = (chunk: number, count: number) => {
    const sent = { n: 0 };
    const script = (r: FakeReq) => {
      const res = new FakeRes(200, JSON_CT);
      r.emit('response', res);
      const next = (): void => { if (sent.n === count) { res.emit('end'); return; } sent.n++; res.emit('data', Buffer.alloc(chunk, 0x20)); setImmediate(next); };
      setImmediate(next);
    };
    return { sent, script };
  };
  {
    const s = stream(512 * 1024, 10);
    const { a, n } = await get(s.script);
    assert.deepStrictEqual(a, { ok: false, reason: 'too-large' }, 'a list over 2 MiB is refused');
    assert.strictEqual(s.sent.n, MAX_FEED_BYTES / (512 * 1024) + 1, 'cut off at the first chunk past 2 MiB, while streaming');
    assert.ok(n.reqs[0].aborted, 'the oversized request is aborted');
    assert.ok((await get(stream(512 * 1024, 4).script)).a.ok, 'exactly 2 MiB is read');
  }
  {
    const s = stream(64 * 1024, 10);
    assert.deepStrictEqual((await get(s.script, RAW)).a, { ok: false, reason: 'too-large' }, 'a releases.json over 256 KiB is refused');
    assert.strictEqual(s.sent.n, MAX_RELEASES_JSON_BYTES / (64 * 1024) + 1, 'releases.json is cut off at the first chunk past 256 KiB');
  }

  // FR-025: failures are a closed set of codes, nothing else
  const secret = 'https://u:tok@api.github.com/x?token=abc C:\\Users\\ana';
  const viaError = await get((r) => r.emit('error', new Error(secret)));
  const viaThrow = await makeFeedGet(() => { throw new Error(secret); })(LIST, SLUG);
  for (const a of [viaError.a, brief(viaThrow)]) {
    assert.deepStrictEqual(a, { ok: false, reason: 'network' }, "a network error is the code 'network', not its text");
  }
  assert.deepStrictEqual([...FEED_FAILURES].sort(), ['aborted', 'content-type', 'network', 'not-allowed', 'redirect', 'status', 'timeout', 'too-large'], 'the closed set of failure codes');

  // a response stream error after the headers is 'network' at once, not a timeout (review of #2058)
  {
    const timers: (() => void)[] = [];
    const fake: FeedTimer = { set: (cb) => { timers.push(cb); return timers.length; }, clear: () => undefined };
    let got: FeedAnswer | undefined;
    const n = netWith((r) => { const res = new FakeRes(200, JSON_CT); r.emit('response', res); res.emit('data', Buffer.from('[')); if (res.listenerCount('error') > 0) res.emit('error', new Error(secret)); });
    void makeFeedGet(n.factory, fake)(LIST, SLUG).then((a) => { got = a; });
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(got, { ok: false, reason: 'network' }, "a response error mid-body is 'network' at once, with no timer fired");
    assert.ok(n.reqs[0].aborted, 'the failed response is aborted');
  }

  // FR-004: 10 s limit, on a fake timer
  {
    const timers: { cb: () => void; ms: number }[] = [];
    let cleared = 0;
    const fake: FeedTimer = { set: (cb, ms) => { timers.push({ cb, ms }); return timers.length; }, clear: () => { cleared++; } };
    const n = netWith(() => { /* never answers */ });
    const p = makeFeedGet(n.factory, fake)(LIST, SLUG);
    assert.deepStrictEqual(timers.map((t) => t.ms), [FEED_TIMEOUT_MS], 'one 10 s timer');
    assert.strictEqual(FEED_TIMEOUT_MS, 10_000, 'the limit is 10 s (FR-004)');
    timers[0].cb();
    assert.deepStrictEqual(await p, { ok: false, reason: 'timeout' }, 'a request past the limit is a timeout');
    assert.ok(n.reqs[0].aborted, 'the timed-out request is aborted');
    const ok = await makeFeedGet(netWith(answer(200, '[]')).factory, fake)(LIST, SLUG);
    assert.ok(ok.ok && cleared >= 2, 'the timer is cleared when the request ends');
  }
  console.log('selfupdate feedget tests passed');
}

(process.argv[2] === '--child' ? child() : main()).catch((e) => { console.error(e); process.exit(1); });
