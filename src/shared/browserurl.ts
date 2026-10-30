import { isHttpUrl } from './url';

/**
 * Spec 080 FR-005, FR-024: what the session browser's address field accepts, and what a link may do.
 * Pure and linear: no regex backtracks over the input (the length is checked first, then one anchored pattern).
 * No search engine: text that is not an address is refused with a reason (no third party).
 */
export const BROWSER_URL_MAX = 2048;

export type AddressResult = { ok: true; url: string } | { ok: false; reason: string };

// `host[:port][/path?query#hash]`, the host being a name (letters of any script), an IPv4 address (any form URL reads: 127.1, 2130706433,
// 0x7f000001) or a bracketed IPv6 address; no userinfo. One anchored pattern, no nested quantifiers: linear.
const BARE = /^(?:\[[0-9a-f:.]+\]|[\p{L}\p{N}._-]+)(?::[0-9]{1,5})?(?:[/?#]\S*)?$/iu;
const EXPLICIT = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCHEMEISH = /^[a-z][a-z0-9+.-]*:/i;

// eslint-disable-next-line no-control-regex
const hasControl = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s);

/** The host of a URL as `new URL().hostname` reads it (userinfo dropped, lower case, IPv6 in brackets, IDN as punycode); '' when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * localhost, *.localhost (one trailing dot allowed), 127.0.0.0/8, ::1, IPv4-mapped 127/8 (`[::ffff:7f00:1]`) and the unspecified
 * addresses (FR-058's loopback class, used here only to pick http). **`host` must be a `URL.hostname`** (canonical: `127.1` is already
 * `127.0.0.1`, `[0:0:0:0:0:0:0:1]` is `[::1]`). For raw text use `loopbackOfAddress`.
 */
export function isLoopbackHost(host: string): boolean {
  let h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '::' || h === '0.0.0.0') return true;
  if (/^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(h)) return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(h);
  return !!mapped && parseInt(mapped[1], 16) >= 0x7f00 && parseInt(mapped[1], 16) <= 0x7fff;
}

/** Same as `isLoopbackHost` for raw host text (with optional port and path): the text goes through `URL` first. */
export function loopbackOfAddress(raw: string): boolean {
  const h = hostOf('http://' + raw);
  return h !== '' && isLoopbackHost(h);
}

// a name needs non-empty labels that do not start or end with '-' (one trailing dot is fine); IPv6 is left to URL
function hostShapeOk(host: string): boolean {
  if (!host) return false;
  if (host.startsWith('[')) return true;
  const labels = (host.endsWith('.') ? host.slice(0, -1) : host).split('.');
  return labels.every((l) => l.length > 0 && !l.startsWith('-') && !l.endsWith('-'));
}

const NOT_ADDR = 'That is not a web address.';
const ONLY_WEB = 'Only http and https addresses open here.';

/** FR-005: `localhost:3000` becomes `http://localhost:3000`, `example.com` becomes `https://example.com`, `https://x` stays. */
export function parseAddress(input: unknown): AddressResult {
  if (typeof input !== 'string') return { ok: false, reason: 'Type a web address.' };
  if (input.length > BROWSER_URL_MAX + 64) return { ok: false, reason: 'That address is too long.' };
  const text = input.trim();
  if (!text) return { ok: false, reason: 'Type a web address.' };
  if (text.length > BROWSER_URL_MAX) return { ok: false, reason: 'That address is too long.' };
  if (hasControl(text)) return { ok: false, reason: NOT_ADDR };
  if (/\s/.test(text)) return { ok: false, reason: 'That is not a web address (no search here).' };
  let candidate: string;
  if (EXPLICIT.test(text)) {
    candidate = text;
  } else if (BARE.test(text)) {
    candidate = (loopbackOfAddress(text) ? 'http://' : 'https://') + text;
  } else {
    // `http:example.com` and `https:/example.com` are mistyped web addresses, not other schemes
    return { ok: false, reason: SCHEMEISH.test(text) && !/^https?:/i.test(text) ? ONLY_WEB : NOT_ADDR };
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, reason: NOT_ADDR };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: ONLY_WEB };
  // userinfo (`user:pw@host`, `google.com@evil.com`) is refused: basic auth is cancelled (FR-025c), so it would only leak into history
  // and the page URL the agent reads, and the text before the `@` looks like the host. The authority is read from the text given.
  const authority = candidate.slice(candidate.indexOf('//') + 2).split(/[/?#\\]/, 1)[0];
  if (u.username || u.password || authority.includes('@')) return { ok: false, reason: 'Addresses with a user name or password are not supported.' };
  if (!hostShapeOk(u.hostname)) return { ok: false, reason: NOT_ADDR };
  return { ok: true, url: u.href };
}

export type LinkKind = 'web' | 'mailto' | 'refused';

/**
 * FR-024 "Other apps": only `mailto:` may be offered to the system, and only after a click on a button. Every other scheme
 * (ms-msdt:, search-ms:, smb:, file:, vscode:, tel: ...) is refused with no offer. Case and leading blanks do not change that.
 */
export function classifyLink(input: unknown): LinkKind {
  if (typeof input !== 'string' || input.length > 4096) return 'refused';
  const text = input.trim();
  if (!text || hasControl(text)) return 'refused';
  if (isHttpUrl(text)) return 'web';
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return 'refused';
  }
  if (u.protocol === 'mailto:') return parseMailto(text) ? 'mailto' : 'refused';
  return 'refused';
}

/** A mail link is at most this long (FR-024 hardening, 2026-10-30 security review): it is handed to the system. */
export const MAILTO_MAX = 512;
// an address: a conservative local part, `@`, a host name; or a `%XX` escape that is not a control character, a space, a quote, a backslash or an angle bracket
const MAIL_ADDR = /^(?:[A-Za-z0-9._+-]|%(?!00|0[0-9A-Fa-f]|1[0-9A-Fa-f]|20|22|3[Cc]|3[Ee]|5[Cc]|7[Ff])[0-9A-Fa-f]{2})+@[A-Za-z0-9.-]+$/;
const MAIL_VALUE = /^(?:[A-Za-z0-9._+@,~*!'()-]|%(?!00|0[0-9A-Fa-f]|1[0-9A-Fa-f]|7[Ff])[0-9A-Fa-f]{2})*$/;
const MAIL_HEADERS = new Set(['subject', 'cc', 'bcc']);

/** Decoded characters a mail link may not carry: every control (C0 and C1, NEL included), every format character (bidi controls, zero-width, soft hyphen, word joiner, tag characters ...), line and paragraph separators. */
const BAD_DECODED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/**
 * True when an escaped sequence decodes to a forbidden character or is not valid UTF-8, or when the escapes decode to a `%` at all: a literal
 * percent is not needed in a mail link, and a `%` that comes out of an escape is a double encoding (`%2541`, `%25%30A`, `%25%32%35`).
 */
function badEscapes(text: string): boolean {
  if (/%25/i.test(text)) return true;
  for (const run of text.match(/(?:%[0-9A-Fa-f]{2})+/g) ?? []) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(run);
    } catch {
      return true;
    }
    if (decoded.includes('%') || BAD_DECODED.test(decoded)) return true;
  }
  return false;
}
/** A host: dot-separated labels of letters, digits and hyphens, none empty, none longer than 63, none starting or ending with a hyphen. */
function mailHostOk(host: string): boolean {
  const labels = host.split('.');
  return labels.length > 0 && labels.every((l) => l.length > 0 && l.length <= 63 && !l.startsWith('-') && !l.endsWith('-'));
}
function mailAddressOk(a: string): boolean {
  if (a.length === 0 || a.length > 254 || a.includes('..') || !MAIL_ADDR.test(a)) return false;
  const at = a.lastIndexOf('@');
  return !a.startsWith('-') && mailHostOk(a.slice(at + 1)) && !badEscapes(a);
}

/**
 * FR-024: the only link that may be handed to another app. A conservative grammar, checked in main again when the user clicks Open, and the
 * text handed to the system is the normalised result (never the raw link): `mailto:` + one or more addresses (comma-separated) + optional
 * `subject`, `cc` and `bcc` headers. Anything else (a space, quote, backslash, angle bracket, control character, an `attach`, `body`, `from` or
 * other header, an escaped control character, more than `MAILTO_MAX` characters) is refused as a whole. Returns the href, or null.
 */
export function parseMailto(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text.length > MAILTO_MAX || hasControl(text) || !/^mailto:/i.test(text)) return null;
  const rest = text.slice('mailto:'.length);
  const q = rest.indexOf('?');
  const path = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? '' : rest.slice(q + 1);
  const addrs = path.split(',');
  if (!addrs.length || !addrs.every(mailAddressOk)) return null;
  const kept: string[] = [];
  if (q >= 0) {
    if (!query) return null;
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) return null;
      const key = pair.slice(0, eq).toLowerCase();
      const val = pair.slice(eq + 1);
      if (!MAIL_HEADERS.has(key) || !MAIL_VALUE.test(val) || badEscapes(val)) return null;
      if ((key === 'cc' || key === 'bcc') && !val.split(',').every(mailAddressOk)) return null; // cc and bcc hold addresses
      kept.push(key + '=' + val);
    }
  }
  const href = 'mailto:' + addrs.join(',') + (kept.length ? '?' + kept.join('&') : '');
  return href.length <= MAILTO_MAX ? href : null;
}
