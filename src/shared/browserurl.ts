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
    return { ok: false, reason: SCHEMEISH.test(text) ? ONLY_WEB : NOT_ADDR };
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, reason: NOT_ADDR };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: ONLY_WEB };
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
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return 'refused';
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') return 'web';
  if (u.protocol === 'mailto:') return 'mailto';
  return 'refused';
}
