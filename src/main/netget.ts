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
        req = factory({ method, url, redirect: 'manual', credentials: 'omit', useSessionCookies: false });
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
export const FEED_FAILURES = ['not-allowed', 'redirect', 'status', 'content-type', 'too-large', 'timeout', 'network'] as const;
export type FeedFailure = typeof FEED_FAILURES[number];
export type FeedAnswer = { ok: true; kind: FeedKind; bytes: Buffer } | { ok: false; reason: FeedFailure };
export type FeedGet = (url: string, slug: string) => Promise<FeedAnswer>;
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
  return (url, slug) =>
    new Promise<FeedAnswer>((resolve) => {
      const kind = feedAllowed(url, slug);
      if (!kind) { resolve({ ok: false, reason: 'not-allowed' }); return; }
      let settled = false;
      let req: NetRequestLike | undefined;
      const done = (a: FeedAnswer): void => {
        if (settled) return;
        settled = true;
        timer.clear(handle);
        resolve(a);
        try { req?.abort(); } catch { /* already finished */ }
      };
      const fail = (reason: FeedFailure) => (): void => done({ ok: false, reason });
      const handle = timer.set(fail('timeout'), timeoutMs);
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
