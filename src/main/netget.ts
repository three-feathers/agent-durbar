/**
 * Durbar's own HTTP requests for spec 081 (the version lookups, FR-026) and spec 060 (the official installer download): Electron's
 * `net.request` on the app session, so they follow the system or organization proxy and the OS certificate store (spec 076 FR-155,
 * FR-156), not Node's `https.get`.
 *
 * `redirect: 'manual'`, `credentials: 'omit'`, `useSessionCookies: false`, `User-Agent: AgentDurbar`. A redirect is read from the
 * `redirect` event (status and URL) and the request is aborted: `followRedirect()` is never called, so nothing is fetched from a
 * place the caller has not checked. (`net.fetch` with `redirect: 'manual'` rejects with "Redirect was cancelled" in Electron 44,
 * `real:` 2026-10-25.) The request layer is injected, so tests model it as an event emitter.
 */
import * as https from 'https';
import type { HttpGet, HttpResponse } from './officialinstall';
import { lookupAllowed, REDIRECTS } from '../shared/updatecheck';
import type { LookupGet } from '../shared/updatecheck';
import { ShownError } from '../shared/shownerror';
import { feedResponseOk, feedUrl, parseRepoSlug, releasesJsonUrl, MAX_FEED_BYTES, MAX_RELEASES_JSON_BYTES } from '../shared/selfupdate';

/** The part of Electron's `ClientRequest` this file uses. */
export interface NetRequestLike {
  on(ev: 'redirect', cb: (statusCode: number, method: string, redirectUrl: string) => void): unknown;
  on(ev: 'response', cb: (res: NetResponseLike) => void): unknown;
  on(ev: 'error', cb: (err: Error) => void): unknown;
  setHeader(name: string, value: string): void;
  end(): void;
  abort(): void;
}
export interface NetResponseLike {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  on(ev: 'data', cb: (chunk: Buffer) => void): unknown;
  on(ev: 'end', cb: () => void): unknown;
  on(ev: 'error', cb: (err: Error) => void): unknown;
}
export interface NetRequestOptions { method: 'GET' | 'HEAD'; url: string; redirect: 'manual'; credentials: 'omit'; useSessionCookies: false; cache?: 'no-store' }
export type NetRequestFactory = (o: NetRequestOptions) => NetRequestLike;

/** The real factory: `net.request` on the default session. Electron is loaded when a request is made, so tests can import this file. */
export function electronRequestFactory(): NetRequestFactory {
  return (o) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { net, session } = require('electron') as typeof import('electron');
    return net.request({ ...o, session: session.defaultSession }) as unknown as NetRequestLike;
  };
}

const UA = 'AgentDurbar';
/**
 * Spec 081 FR-017: the headers Durbar sets on every request. Chromium would otherwise add `Accept-Language` from the user's locale;
 * a fixed `en` sends no locale. Chromium still adds `Accept-Encoding` (gzip, deflate, br, zstd) and `Sec-Fetch-Site/Mode/Dest`
 * itself: fixed values that carry nothing about the user, listed in FR-017 and the README.
 */
export const FIXED_HEADERS: Readonly<Record<string, string>> = { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en' };
const setFixedHeaders = (req: NetRequestLike): void => { for (const [k, v] of Object.entries(FIXED_HEADERS)) req.setHeader(k, v); };

/**
 * Spec 081 FR-026: a lookup of one allow-listed URL. A URL that is not exactly on the list is refused before any request. A 3xx
 * is reported from the `redirect` event and the request is aborted. A body is read up to `maxBytes` and refused (never cut) when
 * larger; a request that asked for no body (`maxBytes` 0, HEAD) is aborted at the response, so nothing is read.
 */
export function makeLookupGet(factory: NetRequestFactory): LookupGet {
  return (url, { method, maxBytes, timeoutMs }) =>
    new Promise((resolve, reject) => {
      if (!lookupAllowed(url)) { reject(new Error('address not allowed')); return; }
      let settled = false;
      let req: NetRequestLike | undefined;
      const done = (f: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        f();
        try { req?.abort(); } catch { /* already finished */ }
      };
      const timer = setTimeout(() => done(() => reject(new Error('timed out'))), timeoutMs);
      try {
        // no-store (FR-466): Chromium's HTTP cache outlives a restart; a kept 3xx or body must never answer a version check
        req = factory({ method, url, redirect: 'manual', credentials: 'omit', useSessionCookies: false, cache: 'no-store' });
      } catch (e) {
        done(() => reject(e instanceof Error ? e : new Error(String(e)))); // FR-066: read, not shown (re-thrown)
        return;
      }
      setFixedHeaders(req);
      req.on('redirect', (status, _m, redirectUrl) => done(() => resolve({ kind: 'redirect', status, url: String(redirectUrl) })));
      req.on('response', (res) => {
        if (settled) return;
        if (maxBytes <= 0 || method === 'HEAD') { done(() => resolve({ kind: 'body', status: res.statusCode, text: '' })); return; }
        const parts: Buffer[] = [];
        let n = 0;
        res.on('data', (c) => {
          if (settled) return;
          n += c.length;
          if (n > maxBytes) { done(() => reject(new Error('unexpected answer'))); return; }
          parts.push(c);
        });
        res.on('end', () => done(() => resolve({ kind: 'body', status: res.statusCode, text: Buffer.concat(parts).toString('utf8') })));
        res.on('error', (e) => done(() => reject(e)));
      });
      req.on('error', (e) => done(() => reject(e)));
      req.end();
    });
}

/**
 * Spec 118 FR-007, FR-009 (T009): the only two addresses Durbar's own update check reads, for the build's source `slug`: the
 * release list (`feedUrl`) and a stable tag's `releases.json` (`releasesJsonUrl`). Exact string equality with the URL those pure
 * builders make, so any other host, spelling, port, userinfo, slug, tag, query or fragment is refused. Not `lookupAllowed`.
 */
export type FeedKind = 'list' | 'releases';
export function feedAllowed(url: unknown, slug: unknown): FeedKind | undefined {
  const s = parseRepoSlug(slug);
  if (!s || typeof url !== 'string') return undefined;
  if (url === feedUrl(s)) return 'list';
  const head = `https://raw.githubusercontent.com/${s}/`;
  const tail = '/releases.json';
  if (url.startsWith(head) && url.endsWith(tail) && releasesJsonUrl(s, url.slice(head.length, url.length - tail.length)) === url) return 'releases';
  return undefined;
}

/** FR-025: what a failed feed read reports. A closed set of codes: never a URL, header, token, path or the network's own text. */
export const FEED_FAILURES = ['not-allowed', 'redirect', 'status', 'content-type', 'too-large', 'timeout', 'network', 'aborted'] as const;
export type FeedFailure = typeof FEED_FAILURES[number];
export type FeedAnswer = { ok: true; kind: FeedKind; bytes: Buffer } | { ok: false; reason: FeedFailure };
/** `signal` (T010): turning the check off mid-request aborts it and answers `aborted`. */
export type FeedGet = (url: string, slug: string, signal?: AbortSignal) => Promise<FeedAnswer>;
export interface FeedTimer { set(cb: () => void, ms: number): unknown; clear(handle: unknown): void }
/** FR-004: one request, 10 s limit. */
export const FEED_TIMEOUT_MS = 10_000;
const FEED_CAP: Readonly<Record<FeedKind, number>> = { list: MAX_FEED_BYTES, releases: MAX_RELEASES_JSON_BYTES };
/** FR-006: the list request asks for GitHub's JSON; the raw `releases.json` keeps the fixed headers. No `Authorization`, no cookie. */
export const FEED_HEADERS: Readonly<Record<string, string>> = { ...FIXED_HEADERS, 'Accept': 'application/vnd.github+json' };
const realTimer: FeedTimer = { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * Spec 118 FR-007, FR-009, FR-025 (T009): one GET of a `feedAllowed` address, built like `makeLookupGet` (same factory options plus
 * `cache: 'no-store'`, redirect event read and aborted, never followed) but with its own allow-list, caps and answer. 200 only; the list must say
 * `application/json` (FR-007; `feedResponseOk` again at the end); the body is counted while it arrives and the request aborted past
 * the cap (2 MiB list, 256 KiB `releases.json`). Never rejects: every failure is a `FeedFailure` code. Nothing reads the environment.
 */
export function makeFeedGet(factory: NetRequestFactory, timer: FeedTimer = realTimer, timeoutMs = FEED_TIMEOUT_MS): FeedGet {
  return (url, slug, signal) =>
    new Promise<FeedAnswer>((resolve) => {
      const kind = feedAllowed(url, slug);
      if (!kind) { resolve({ ok: false, reason: 'not-allowed' }); return; }
      if (signal?.aborted) { resolve({ ok: false, reason: 'aborted' }); return; } // no request object at all
      let settled = false;
      let req: NetRequestLike | undefined;
      const onAbort = (): void => done({ ok: false, reason: 'aborted' });
      const done = (a: FeedAnswer): void => {
        if (settled) return;
        settled = true;
        timer.clear(handle);
        signal?.removeEventListener('abort', onAbort);
        resolve(a);
        try { req?.abort(); } catch { /* already finished */ }
      };
      const fail = (reason: FeedFailure) => (): void => done({ ok: false, reason });
      const handle = timer.set(fail('timeout'), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        // no-store: Chromium's HTTP cache outlives a restart; a cached 301 or list must never answer a check (review of #2058)
        req = factory({ method: 'GET', url, redirect: 'manual', credentials: 'omit', useSessionCookies: false, cache: 'no-store' });
      } catch { fail('network')(); return; }
      for (const [k, v] of Object.entries(kind === 'list' ? FEED_HEADERS : FIXED_HEADERS)) req.setHeader(k, v);
      req.on('redirect', fail('redirect'));
      req.on('response', (res) => {
        if (settled) return;
        const ct = res.headers['content-type'];
        const contentType = typeof ct === 'string' ? ct : undefined;
        if (REDIRECTS.includes(res.statusCode)) { fail('redirect')(); return; }
        if (res.statusCode !== 200) { fail('status')(); return; } // also 300, 304 (no validators are sent), 305, 306
        if (kind === 'list' && !feedResponseOk({ status: 200, contentType, bytes: 0 })) { fail('content-type')(); return; }
        const parts: Buffer[] = [];
        let n = 0;
        res.on('data', (c) => {
          if (settled) return;
          n += c.length;
          if (n > FEED_CAP[kind]) { fail('too-large')(); return; }
          parts.push(c);
        });
        res.on('end', () => {
          if (kind === 'list' && !feedResponseOk({ status: res.statusCode, contentType, bytes: n })) { fail('too-large')(); return; }
          done({ ok: true, kind, bytes: Buffer.concat(parts) });
        });
        res.on('error', fail('network'));
      });
      req.on('error', fail('network'));
      req.end();
    });
}

/**
 * Spec 118 T507 (FR-006; spec 076 FR-155, FR-156): update requests run in their own session, never the default one. In memory (no
 * `persist:`), Chromium's HTTP cache off, and the session's User-Agent is FR-006's `AgentDurbar`: Chromium writes the session's
 * User-Agent on a proxy's connect line, which the request header does not change (`real:` Electron 44.9.1, Linux, 2026-11-24).
 */
export const UPDATE_PARTITION = 'durbar-update';
export interface ProxyPac { mode: 'pac_script'; pacScript: string }
/** The part of Electron's `Session` the update requests use. */
export interface NetSessionLike {
  resolveProxy(url: string): Promise<string>;
  setProxy(config: ProxyPac): Promise<void>;
  setUserAgent(userAgent: string, acceptLanguages?: string): void;
  setSpellCheckerEnabled(enable: boolean): void;
  setSpellCheckerLanguages(languages: string[]): void;
}
/** The part of Electron's `session` module the update requests use. */
export interface SessionsLike {
  readonly defaultSession: NetSessionLike;
  fromPartition(partition: string, options: { cache: boolean }): NetSessionLike;
}
/** `net.request` with an explicit session. */
export type SessionRequest = (o: NetRequestOptions & { session: NetSessionLike }) => NetRequestLike;

const updateSessions = new WeakMap<SessionsLike, NetSessionLike>();
/** The update session, made once per `session` module (the real one: once per run), the first time an update request is made. */
export function updateSession(sessions: SessionsLike): NetSessionLike {
  let ses = updateSessions.get(sessions);
  if (!ses) {
    ses = sessions.fromPartition(UPDATE_PARTITION, { cache: false });
    // a new session fetches a Hunspell dictionary from a third party (redirector.gvt1.com) at once; turning the spell checker off does
    // not stop that fetch, an empty language list does (`real:` Electron 44.9.1, Linux, 2026-11-24): no request but the update's own
    ses.setSpellCheckerLanguages([]);
    ses.setSpellCheckerEnabled(false);
    ses.setUserAgent(UA, 'en');
    updateSessions.set(sessions, ses);
  }
  return ses;
}

/** One entry of a PAC answer as Chromium's `resolveProxy` writes it: `DIRECT`, or a scheme and `host:port` (IPv6 in brackets). */
const PAC_ENTRY = /^(?:DIRECT|(?:PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5|QUIC) (?:[A-Za-z0-9._-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\]):[0-9]{1,5})$/;
const PAC_MAX_CHARS = 4096;
const PAC_MAX_ENTRIES = 16;
const PAC_DATA = 'data:application/x-ns-proxy-autoconfig,';

/** A JavaScript string literal of `s`: `JSON.stringify`, then `<`, `>`, `/`, U+2028 and U+2029 as `\uXXXX` (safe in any script). */
export function jsString(s: string): string {
  return JSON.stringify(s).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * A PAC script that answers `rule` (a PAC answer such as `PROXY host:port; DIRECT`, from `resolveProxy`) for every URL, or
 * `undefined` when `rule` is not such an answer. Layers, each tested on its own: the size caps, the entry grammar (only entries of
 * that exact form are written, joined again), the string literal (`jsString`) and the `data:` URL encoding.
 */
export function pacFor(rule: string): string | undefined {
  if (typeof rule !== 'string' || rule.length === 0 || rule.length > PAC_MAX_CHARS) return undefined;
  const entries = rule.split(';').map((e) => e.trim().replace(/\s+/g, ' ')).filter((e) => e.length > 0);
  if (entries.length === 0 || entries.length > PAC_MAX_ENTRIES || !entries.every((e) => PAC_ENTRY.test(e))) return undefined;
  return PAC_DATA + encodeURIComponent(`function FindProxyForURL(url, host) { return ${jsString(entries.join('; '))}; }`);
}

/**
 * Spec 076 FR-155 for the update session: the one place that copies proxy settings from the default session to another session.
 * Electron cannot read a session's proxy settings, and a partition does not follow a `setProxy` made on the default session, so the
 * default session is asked which proxy it uses for this exact URL (system settings, PAC, command-line switches, an organization's
 * `setProxy`) and that answer is set on `target`, but only while `current()` still says yes (review of PR 2123: an answer that
 * arrives after its request ended must never change the proxy of the next one). Certificates need no copy: no session gets a
 * verifier of its own (FR-156, OS store).
 */
export async function useDefaultSessionProxy(target: NetSessionLike, sessions: SessionsLike, url: string, current: () => boolean = () => true): Promise<void> {
  const pacScript = pacFor(await sessions.defaultSession.resolveProxy(url));
  if (pacScript === undefined) throw new Error('no proxy answer');
  if (!current()) return;
  await target.setProxy({ mode: 'pac_script', pacScript });
}

/**
 * T507: `makeFeedGet` on the update session. Before each request the default session's proxy for that URL is set on it; a refused URL
 * or an aborted signal makes no lookup; a failed lookup is `network`, a lookup still running at the 10 s limit `timeout` (FR-004: one
 * budget for the lookup and the request together, on the injected clock). One update request at a time (a second waits for the first
 * to end), so the proxy set for one URL is never the one another URL's request starts with, and a late answer of an ended call sets
 * nothing. A throw anywhere (such as `fromPartition` before the app is ready) answers `network` and leaves the queue usable. Never rejects.
 */
export function makeUpdateFeedGet(sessions: SessionsLike, request: SessionRequest, timer: FeedTimer = realTimer, timeoutMs = FEED_TIMEOUT_MS, now: () => number = Date.now): FeedGet {
  let queue: Promise<unknown> = Promise.resolve();
  const one = async (url: string, slug: string, signal?: AbortSignal): Promise<FeedAnswer> => {
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    const started = now();
    const ses = updateSession(sessions);
    const early = await new Promise<FeedAnswer | undefined>((resolve) => {
      let ended = false;
      let handle: unknown;
      const onAbort = (): void => end({ ok: false, reason: 'aborted' });
      const end = (a: FeedAnswer | undefined): void => {
        if (ended) return;
        ended = true;
        timer.clear(handle);
        signal?.removeEventListener('abort', onAbort);
        resolve(a);
      };
      handle = timer.set(() => end({ ok: false, reason: 'timeout' }), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      useDefaultSessionProxy(ses, sessions, url, () => !ended).then(() => end(undefined), () => end({ ok: false, reason: 'network' }));
    });
    if (early) return early;
    const left = timeoutMs - (now() - started);
    if (left <= 0) return { ok: false, reason: 'timeout' };
    return makeFeedGet((o) => request({ ...o, session: ses }), timer, left)(url, slug, signal);
  };
  const safe = (url: string, slug: string, signal?: AbortSignal): Promise<FeedAnswer> =>
    one(url, slug, signal).catch((): FeedAnswer => ({ ok: false, reason: 'network' }));
  return (url, slug, signal) => {
    if (!feedAllowed(url, slug)) return Promise.resolve({ ok: false, reason: 'not-allowed' });
    const run = queue.then(() => safe(url, slug, signal));
    queue = run.catch(() => undefined);
    return run;
  };
}

/** The real update request: `net.request` on `updateSession()`. Electron is loaded when it is called, so tests can import this file. */
export function updateFeedGet(): FeedGet {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { net, session } = require('electron') as typeof import('electron');
  return makeUpdateFeedGet(session as unknown as SessionsLike, (o) => net.request(o as never) as unknown as NetRequestLike);
}

/**
 * Spec 060 FR-001 and spec 081 T024: the installer download. One GET per hop with the redirect NOT followed: the `redirect` event
 * gives the status and the next URL, the request is aborted, and the caller (`downloadScript`) checks that URL against the
 * vendor's hosts BEFORE it asks for it. Size cap while reading and a total time limit.
 */
export function makeDownloadGet(factory: NetRequestFactory): HttpGet {
  return (url, { timeoutMs, maxBytes }) =>
    new Promise<HttpResponse>((resolve, reject) => {
      let settled = false;
      let req: NetRequestLike | undefined;
      const finish = (f: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(total);
        f();
        try { req?.abort(); } catch { /* already finished */ }
      };
      const total = setTimeout(() => finish(() => reject(new ShownError('The download took too long.'))), timeoutMs);
      try {
        req = factory({ method: 'GET', url, redirect: 'manual', credentials: 'omit', useSessionCookies: false });
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e)))); // FR-066: read, not shown (re-thrown)
        return;
      }
      setFixedHeaders(req);
      req.on('redirect', (status, _m, redirectUrl) => finish(() => resolve({ status, location: String(redirectUrl), body: Buffer.alloc(0) })));
      req.on('response', (res) => {
        const status = res.statusCode;
        const ct = res.headers['content-type'];
        const contentType = typeof ct === 'string' ? ct : undefined;
        if (status >= 300 && status < 400) {
          const l = res.headers.location;
          finish(() => resolve({ status, location: typeof l === 'string' ? l : undefined, contentType, body: Buffer.alloc(0) }));
          return;
        }
        const parts: Buffer[] = [];
        let n = 0;
        res.on('data', (c) => {
          if (settled) return;
          n += c.length;
          if (n > maxBytes) { finish(() => reject(new ShownError('The installer is larger than expected; not downloaded.'))); return; }
          parts.push(c);
        });
        res.on('end', () => finish(() => resolve({ status, contentType, body: Buffer.concat(parts) })));
        res.on('error', (e) => finish(() => reject(e)));
      });
      req.on('error', (e) => finish(() => reject(e)));
      req.end();
    });
}

/**
 * Spec 081 delta 2026-10-27: the installer download for the Node scripts that run `HarnessSetup` without Electron
 * (`scripts/e2e-real.ts`, `scripts/install-check.ts`), where `net.request` does not exist. Same contract as `makeDownloadGet`:
 * one GET, no redirect followed (the caller checks the next URL against the vendor's hosts), a size cap while reading, a total
 * time limit. `get` is `https.get`; a test hands in `http.get` with a local server. The app itself never uses this: it passes
 * `makeDownloadGet(electronRequestFactory())` (`src/main/ipc/harness.ts`).
 */
export function makeNodeDownloadGet(get: typeof https.get): HttpGet {
  return (url, { timeoutMs, maxBytes }) =>
    new Promise<HttpResponse>((resolve, reject) => {
      let settled = false;
      const fail = (e: Error): void => { if (!settled) { settled = true; clearTimeout(total); reject(e); } };
      const ok = (r: HttpResponse): void => { if (!settled) { settled = true; clearTimeout(total); resolve(r); } };
      const req = get(url, { headers: { ...FIXED_HEADERS } }, (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
        const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : undefined;
        if (status >= 300 && status < 400) { ok({ status, location, contentType, body: Buffer.alloc(0) }); req.destroy(); return; }
        const parts: Buffer[] = [];
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n > maxBytes) { fail(new ShownError('The installer is larger than expected; not downloaded.')); req.destroy(); return; }
          parts.push(c);
        });
        res.on('end', () => ok({ status, contentType, body: Buffer.concat(parts) }));
        res.on('error', fail);
      });
      const tooLong = (): void => { fail(new ShownError('The download took too long.')); req.destroy(); };
      const total = setTimeout(tooLong, timeoutMs);
      req.setTimeout(timeoutMs, tooLong);
      req.on('error', fail);
    });
}
/** The Node scripts' installer download (see `makeNodeDownloadGet`). */
export const nodeDownloadGet: HttpGet = makeNodeDownloadGet(https.get);
