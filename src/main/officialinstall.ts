/**
 * Spec 060 FR-001: download a vendor's official install script, safely, after the user has confirmed it. HTTPS only; every redirect
 * hop is checked against that vendor's fixed hosts (and a path prefix on a shared host); at most 3 redirects, 1 MB and 30 s; the file
 * goes into a new private folder (0700, file 0600) that the caller deletes when the install ends. Nothing here runs the script.
 */
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import type { OfficialScript } from '../shared/harnesssetup';

export const MAX_SCRIPT_BYTES = 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const SCRIPT_TIMEOUT_MS = 30_000;

/** True when `url` is HTTPS, on one of the script's hosts (and under its path prefix there), with no user, password or odd port. */
export function allowedScriptUrl(script: OfficialScript, url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return script.hosts.some((h) => u.hostname === h.host && (!h.pathPrefix || u.pathname.startsWith(h.pathPrefix)));
}

export interface HttpResponse { status: number; location?: string; contentType?: string; body: Buffer }
/** One GET without following redirects (tests hand in a fake). */
export type HttpGet = (url: string, opts: { timeoutMs: number; maxBytes: number }) => Promise<HttpResponse>;

/**
 * One GET with no redirects followed, a size cap while reading, and two time limits: an idle one (nothing arrives) and a TOTAL
 * one, so a server that drips bytes cannot keep the download open (review on #393). `get` is `https.get`; a test hands in
 * `http.get` with a local server, so the real stream code is what is tested.
 */
export function makeGet(get: typeof https.get): HttpGet {
  return (url, { timeoutMs, maxBytes }) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e: Error): void => { if (!settled) { settled = true; clearTimeout(total); reject(e); } };
      const ok = (r: HttpResponse): void => { if (!settled) { settled = true; clearTimeout(total); resolve(r); } };
      const req = get(url, { headers: { 'User-Agent': 'AgentDurbar', Accept: '*/*' } }, (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
        const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : undefined;
        if (status >= 300 && status < 400) { res.resume(); ok({ status, location, contentType, body: Buffer.alloc(0) }); return; }
        const parts: Buffer[] = [];
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          // settle first: a fully received response can still emit 'end' after destroy() (found by the local-server test)
          if (n > maxBytes) { fail(new Error('The installer is larger than expected; not downloaded.')); req.destroy(); return; }
          parts.push(c);
        });
        res.on('end', () => ok({ status, contentType, body: Buffer.concat(parts) }));
        res.on('error', fail);
      });
      const tooLong = (): void => { fail(new Error('The download took too long.')); req.destroy(); };
      const total = setTimeout(tooLong, timeoutMs);
      req.setTimeout(timeoutMs, tooLong);
      req.on('error', fail);
    });
}
export const httpsGet: HttpGet = makeGet(https.get);

/**
 * Review on #393: what came back must look like the script, not a web page. A 200 HTML page (a CDN challenge, a login wall)
 * would otherwise go to bash, where lines such as `word > name` create or truncate files. `.sh` must start with `#!`;
 * `.ps1` must not start with `<` (after a UTF-8 BOM and whitespace); `text/html` is refused either way.
 */
export function looksLikeScript(body: Buffer, ext: '.sh' | '.ps1', contentType?: string): boolean {
  if (contentType && /^\s*text\/html\b/i.test(contentType)) return false;
  const head = body.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '');
  if (ext === '.sh') return head.startsWith('#!');
  const first = head.trimStart();
  return first.length > 0 && !first.startsWith('<');
}

/** Downloads the script into a new private folder; returns its path and the folder to delete afterwards. */
export async function downloadScript(script: OfficialScript, ext: '.sh' | '.ps1', deps: { get?: HttpGet; tmpdir?: string } = {}): Promise<{ file: string; dir: string }> {
  const get = deps.get ?? httpsGet;
  let url = script.url;
  if (!allowedScriptUrl(script, url)) throw new Error('That installer address is not allowed.');
  let res: HttpResponse | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    res = await get(url, { timeoutMs: SCRIPT_TIMEOUT_MS, maxBytes: MAX_SCRIPT_BYTES });
    if (res.status >= 300 && res.status < 400) {
      if (!res.location || hop === MAX_REDIRECTS) throw new Error('The installer address redirected too often.');
      const next = new URL(res.location, url).href;
      if (!allowedScriptUrl(script, next)) throw new Error(`The installer redirected to a host that is not the vendor's (${new URL(next).hostname}); not downloaded.`);
      url = next;
      continue;
    }
    break;
  }
  if (!res || res.status !== 200) throw new Error(`The installer could not be downloaded (HTTP ${res?.status ?? '?'}).`);
  if (res.body.length === 0 || res.body.length > MAX_SCRIPT_BYTES) throw new Error('The installer file was empty or too large.');
  if (!looksLikeScript(res.body, ext, res.contentType)) throw new Error("What came back is not the vendor's install script (it looks like a web page); nothing was run. Try again later, or use the vendor's page.");
  const dir = fs.mkdtempSync(path.join(deps.tmpdir ?? os.tmpdir(), 'durbar-install-'));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'install' + ext);
  fs.writeFileSync(file, res.body, { mode: 0o600 });
  return { file, dir };
}
