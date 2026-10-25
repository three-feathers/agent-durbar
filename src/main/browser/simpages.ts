/**
 * Spec 080 T018 (FR-091): the simulator's test pages, served through the `durbar-sim:` scheme on a view's own partition.
 * Only under `DURBAR_SIM`: `registerSimScheme` and `installSimPages` do nothing and say so (return false) otherwise, and
 * `viewNavigationAllowed` refuses the scheme without `sim` (src/main/hardening.ts). The pages are fixed strings in this file: no file is
 * read, no network is used, and nothing in a request chooses what is served beyond a page name from the table below.
 * Pure parts (`simPage`, `simAddress`) have no Electron import, so `scripts/test-browseripc.ts` can test them.
 */
import { SIM_VIEW_SCHEME, viewNavigationAllowed } from '../hardening';
import type { AddressResult } from '../../shared/browserurl';
import { parseAddress } from '../../shared/browserurl';

export const SIM_SCHEME_NAME = SIM_VIEW_SCHEME.slice(0, -1); // 'durbar-sim'
export const SIM_PAGE_HOST = 'pages';
/** The slow page waits this long unless `?ms=` says less (at most 10 s). */
export const SIM_SLOW_MS = 2500;

export interface SimResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/* A string as JavaScript source for an inline <script>: JSON.stringify alone leaves `</script>`, `<!--` and the line separators U+2028/U+2029 in place, so the page text could end the script (CodeQL js/bad-code-sanitization). */
const scriptJson = (v: string): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}
const page = (title: string, body: string, head = ''): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title>${head}<style>body{font:16px system-ui,sans-serif;margin:24px;line-height:1.5}a{color:#0b57d0}nav a{margin-right:12px}label{display:block;margin:8px 0}</style></head><body><nav><a href="/index">Index</a><a href="/links">Links</a><a href="/form">Form</a><a href="/slow">Slow</a></nav><h1>${esc(title)}</h1>${body}</body></html>`;

const PAGES: Record<string, (req: { method: string; body: string; query: URLSearchParams }) => SimResponse | Promise<SimResponse>> = {
  '/index': () => html('Simulator test pages', '<ul><li><a href="/links">Links</a></li><li><a href="/form">Form (POST)</a></li><li><a href="/getform">Form (GET)</a></li><li><a href="/download">Download</a></li><li><a href="/file">File input</a></li><li><a href="/slow">Slow load</a></li><li><a href="/unload">Page that asks before leaving</a></li><li><a href="/alert">Alert</a></li><li><a href="/confirm">Confirm</a></li><li><a href="/prompt">Prompt</a></li></ul>'),
  '/links': () => html('Links', '<p><a id="l-form" href="/form">Form page</a></p><p><a id="l-blank" target="_blank" href="/index">Opens in a new tab</a></p><p><a id="l-web" href="https://example.com/">A web page (needs the network)</a></p><p><a id="l-file" href="file:///etc/hostname">A file link (refused)</a></p>'),
  '/form': (r) =>
    r.method === 'POST'
      ? html('Form received', `<p id="result">Got ${r.body.split('&').filter(Boolean).length} field(s): ${esc(safeDecode(r.body))}</p>`)
      : html('Form (POST)', '<form method="post" action="/form"><label>Name <input name="name" value="Ada"></label><label>Note <input name="note"></label><button id="send" type="submit">Send</button></form>'),
  '/getform': (r) => (r.query.has('q') ? html('Search received', `<p id="result">You asked for: ${esc(r.query.get('q') ?? '')}</p>`) : html('Form (GET)', '<form action="/getform"><label>Question <input name="q"></label><button type="submit">Ask</button></form>')),
  '/download': () => ({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="sim-download.txt"' }, body: 'simulator download\n' }),
  '/file': () => html('File input', '<label>Pick a file <input id="f" type="file"></label>'),
  '/unload': () => html('Unsaved changes', '<label>Draft <input id="draft"></label><p><a href="/index">Leave</a></p>', '<script>addEventListener("beforeunload",function(e){e.preventDefault();e.returnValue="";});</script>'),
  // dialogs (FR-025d): `/alert?ms=1500&n=2` shows an alert after `ms`, and the next one `ms` after the first is closed. The text holds a fake token, built here at run time, so the masking can be seen
  '/alert': (r) => {
    const ms = delayOf(r.query.get('ms'), 300);
    const n = Math.min(Math.max(Number(r.query.get('n')) || 1, 1), 3);
    const markup = r.query.get('html') === '1' ? ' <img src=x onerror="window.__pwn=1">' : '';
    const msg = (i: number): string => `Delete item ${i}?${markup} token=${FAKE_TOKEN()}`;
    const script = `var n=${n},i=0;function go(){i++;alert(${scriptJson('')}+${scriptJson(msg(0))}.replace('item 0','item '+i));if(i<n)setTimeout(go,${ms});}setTimeout(go,${ms});`;
    return html('Alert page', '<p id="result">An alert is coming.</p>', `<script>${script}</script>`);
  },
  '/confirm': () => html('Confirm page', '<button id="ask" onclick="document.getElementById(\'result\').textContent=\'confirm returned \'+confirm(\'Delete this item?\')">Ask</button><p id="result"></p>'),
  '/prompt': () => html('Prompt page', '<script>var r;try{r="prompt returned "+prompt("Name?");}catch(e){r="prompt threw";}document.addEventListener("DOMContentLoaded",function(){document.getElementById("result").textContent=r;});</script><p id="result"></p>'),
  '/slow': async (r) => {
    const asked = Number(r.query.get('ms'));
    const ms = Number.isFinite(asked) && asked >= 0 ? Math.min(asked, 10_000) : SIM_SLOW_MS;
    await new Promise((res) => setTimeout(res, ms));
    return html('Slow page', `<p id="result">This page waited ${ms} ms.</p>`);
  },
};

/** A fake GitHub-style token, assembled at run time so no secret-looking literal sits in the source. */
const FAKE_TOKEN = (): string => 'gh' + 'p_' + 'A1b2'.repeat(9);
function delayOf(raw: string | null, dflt: number): number {
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 10_000) : dflt;
}
function html(title: string, body: string, head = ''): SimResponse {
  return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: page(title, body, head) };
}

/** The page for a `durbar-sim://pages/<name>` request. Unknown host or name: 404. POST bodies are cut at 10 000 characters. */
export async function simPage(rawUrl: string, method = 'GET', body = ''): Promise<SimResponse> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return notFound();
  }
  if (u.protocol !== SIM_VIEW_SCHEME || u.hostname !== SIM_PAGE_HOST) return notFound();
  const name = u.pathname === '/' ? '/index' : u.pathname;
  const make = Object.prototype.hasOwnProperty.call(PAGES, name) ? PAGES[name] : undefined;
  if (!make) return notFound();
  return make({ method: method.toUpperCase(), body: body.slice(0, 10_000), query: u.searchParams });
}
const notFound = (): SimResponse => ({ status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'Not found' });

/** The address bar's rule (FR-005) plus, under the simulator only, the test pages: `durbar-sim://pages/form`. */
export function simAddress(text: unknown, sim: boolean): AddressResult {
  if (sim && typeof text === 'string') {
    const t = text.trim();
    if (t.length <= 200 && t.toLowerCase().startsWith(SIM_VIEW_SCHEME + '//')) {
      try {
        const u = new URL(t);
        if (viewNavigationAllowed(u.href, true, true) && u.hostname === SIM_PAGE_HOST && !u.username && !u.password && !u.port) return { ok: true, url: u.href };
      } catch {
        /* falls through to the refusal */
      }
      return { ok: false, reason: 'That is not a web address.' };
    }
  }
  return parseAddress(text);
}

interface ProtocolLike {
  handle(scheme: string, fn: (req: { url: string; method: string; text(): Promise<string> }) => Promise<Response>): void;
}
interface SesWithProtocol {
  protocol: ProtocolLike;
}

/** Puts the test pages on one view partition. Returns false and registers nothing unless `sim` (DURBAR_SIM, decided by main). */
export function installSimPages(ses: SesWithProtocol, sim: boolean): boolean {
  if (!sim) return false;
  ses.protocol.handle(SIM_SCHEME_NAME, async (req) => {
    const r = await simPage(req.url, req.method, req.method === 'POST' ? await req.text().catch(() => '') : '');
    return new Response(r.body, { status: r.status, headers: r.headers });
  });
  return true;
}

interface SchemeRegistrar {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void;
}
/** Before the app is ready: makes the scheme standard and secure so relative links, forms and downloads work. Does nothing unless `sim`. */
export function registerSimScheme(protocol: SchemeRegistrar, sim: boolean): boolean {
  if (!sim) return false;
  protocol.registerSchemesAsPrivileged([{ scheme: SIM_SCHEME_NAME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  return true;
}
