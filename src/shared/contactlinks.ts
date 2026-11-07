/**
 * Spec 084 FR-040..FR-045, SC-003 (T011, issue 701): the one pure builder of the links main opens for a contact (option C).
 * Main calls it from `contacts:preview` with the stored channel and the masked text; the window never passes a URL.
 *
 * Safety, independent of the contact model (fail closed):
 * - every result starts with one entry of `CONTACT_LINK_ALLOWLIST`, the only list of these prefixes (a static test checks `src/`);
 * - every field placed in a URL is checked again here (ASCII shapes of FR-003 / FR-004); anything else is `bad-channel`;
 * - every value is percent-encoded strictly (RFC 3986 unreserved only, so `!'()*` are encoded too): a value holds only
 *   `A-Z a-z 0-9 - . _ ~` and `%XX`, so no text can end its parameter, add one or start a fragment;
 * - a lone surrogate in the text (a cut emoji) is replaced with U+FFFD (visible as `\ufffd`) instead of making `encodeURIComponent` throw;
 * - the encoded length is counted before anything is built, in one linear pass, so a huge text costs no huge string.
 * No imports: usable from main, tests and any OS.
 */

// Exported values are frozen and the module itself only uses its private bindings: in CommonJS an importer can replace a property
// of `exports`, so internal code never reads its own exports (review of PR 1246).
/** FR-040: the five prefixes a contact link may start with. The one list; the builder takes its prefixes from here. */
const ALLOWLIST: readonly string[] = Object.freeze([
  'https://teams.microsoft.com/l/chat/0/0?',
  'msteams:/l/chat/0/0?',
  'mailto:',
  'slack://user?',
  'https://t.me/',
]);
export const CONTACT_LINK_ALLOWLIST: readonly string[] = ALLOWLIST;
const [TEAMS_WEB, TEAMS_APP, MAILTO, SLACK, TELEGRAM] = ALLOWLIST;

/** FR-045: `CONTACTS_LIMITS.urlChars` of spec 084 FR-005 (T010, `src/shared/contacts.ts`, not merged yet): switch to it when it lands. */
const URL_CHARS = 2_000;
/** FR-042: the subject is the first line, cut at a word to at most this many code points. */
const SUBJECT_CP = 78;
export const SUBJECT_CODE_POINTS = SUBJECT_CP;

/** What the builder reads of a channel (spec 084 FR-003); the contact model's `Channel` fits it. Other fields are ignored. */
export interface LinkChannel {
  kind: string;
  upn?: string;
  address?: string;
  team?: string;
  user?: string;
  username?: string;
}

export interface LinkOptions {
  /** FR-041: Settings > *Open Teams links in* > *The Teams app*: the `msteams:` form. */
  teamsApp?: boolean;
  /** FR-045: the link without `message` / `body` / `text`; the text is returned as `copyText` for the clipboard. */
  copyOnly?: boolean;
}

export type LinkError = 'bad-channel' | 'bad-text' | 'bad-options' | 'too-long';
export type LinkResult =
  | { url: string; encodedLength: number; prefill: boolean; copyText?: string }
  | { error: LinkError; encodedLength?: number };

// FR-004 (the same shape as the contact model's `addressOk`): ASCII `local@domain`, at most 254 characters, local part 1..64 of
// `A-Z a-z 0-9 . _ + -` (no leading, trailing or doubled dot), two or more domain labels of letters, digits and inner dashes, the last
// with a letter. None of these characters has a meaning in a `mailto:` path or needs encoding there.
const LOCAL_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// FR-003
const SLACK_TEAM_RE = /^T[A-Z0-9]{2,20}$/;
const SLACK_USER_RE = /^[UW][A-Z0-9]{2,20}$/;
const TELEGRAM_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
/**
 * t.me paths that open a Telegram page or action, not a person's chat (sharing, invite links, sticker, emoji and theme sets, chat
 * folders, proxies, log-in, language packs, phone confirmation, invoices, gift codes, boosts, contact tokens, message, preview and
 * Instant View links). They are refused case-insensitively, as Telegram usernames are. Names shorter than 5 fail TELEGRAM_RE anyway
 * and are listed so this stays the one list (T018: spec 084 T010's save check uses it too). From reading t.me links, `read:`.
 */
const RESERVED: readonly string[] = Object.freeze([
  'share', 'joinchat', 'addstickers', 'addemoji', 'addtheme', 'addlist', 'proxy', 'socks', 'login', 'setlanguage', 'confirmphone',
  'invoice', 'giftcode', 'boost', 'contact', 'c', 's', 'm', 'iv', 'bg',
]);
/** The list, exported frozen for spec 084 T010's save check (T018); the Set the check uses stays private. */
export const TELEGRAM_RESERVED_PATHS: readonly string[] = RESERVED;
const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED);
/** FR-003 and the reserved paths: a name that opens a person's or a group's chat. */
export function telegramNameOk(v: unknown): v is string {
  return typeof v === 'string' && TELEGRAM_RE.test(v) && !RESERVED_SET.has(v.toLowerCase());
}

export function linkAddressOk(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 254) return false;
  const at = v.indexOf('@');
  if (at < 1 || at !== v.lastIndexOf('@')) return false;
  const local = v.slice(0, at);
  if (!LOCAL_RE.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = v.slice(at + 1).split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return false;
  return /[A-Za-z]/.test(labels[labels.length - 1]);
}

/** `wellFormed` where the runtime has no `String.prototype.toWellFormed` (older than Node 20 / Chromium 111). */
export function wellFormedFallback(s: string): string {
  return s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');
}
const nativeWellFormed = (String.prototype as { toWellFormed?: (this: string) => string }).toWellFormed;

/** A lone surrogate becomes U+FFFD; a valid pair is kept. Linear. */
export function wellFormed(s: string): string {
  return nativeWellFormed ? nativeWellFormed.call(s) : wellFormedFallback(s);
}

/** RFC 3986 unreserved: `A-Z a-z 0-9 - . _ ~`. */
const unreserved = (c: number): boolean =>
  (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e || c === 0x5f || c === 0x7e;

/** Strict percent-encoding (RFC 3986 unreserved kept, everything else as UTF-8 `%XX`). The input must be well-formed. */
export function encodeValue(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** The length `encodeValue(s)` would have, counted without building it (linear, no allocation). The input must be well-formed. */
export function encodedLengthOf(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += unreserved(c) ? 1 : 3;
    else if (c < 0x800) n += 6;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 12; i++; }
    else n += 9;
  }
  return n;
}

const LINE_BREAK_RE = /\r\n|\r|\n/;
/** A cluster that starts with white space (a space can carry marks of its own). */
const WHITESPACE_RE = /^\s/u;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * FR-042: the email's subject and body. The subject is the first line, cut to at most 78 code points without splitting a grapheme
 * cluster (an emoji sequence, a flag, a letter and its marks): at the last space before the limit, else at the last cluster boundary
 * (a single cluster longer than 78 code points gives an empty subject). The body is the rest, line breaks as CRLF. When the first
 * line was cut, the body starts with the whole first line, so no word is lost. One line: an empty subject and the text as the body.
 */
export function emailParts(text: string): { subject: string; body: string } {
  const t = wellFormed(text);
  const m = LINE_BREAK_RE.exec(t);
  if (!m) return { subject: '', body: t };
  const first = t.slice(0, m.index);
  const rest = t.slice(m.index + m[0].length).split(LINE_BREAK_RE).join('\r\n');
  const subject = cutSubject(first);
  if (subject === first) return { subject, body: rest };
  return { subject, body: first + '\r\n' + rest };
}

const unitsAt = (s: string, i: number): number => ((s.codePointAt(i) as number) > 0xffff ? 2 : 1);

function cutSubject(line: string): string {
  // the first 78 code points (UTF-16 units: `limit`), walked once; the rest of a huge line is never read
  let limit = 0;
  for (let points = 0; limit < line.length && points < SUBJECT_CP; points++) limit += unitsAt(line, limit);
  if (limit >= line.length) return line;
  // A grapheme boundary depends only on the text before it and the one code point after it, so segmenting the limit plus one code
  // point gives every boundary at or before the limit exactly.
  const head = line.slice(0, limit + unitsAt(line, limit));
  let hard = 0;
  let space = 0;
  for (const { index, segment } of GRAPHEMES.segment(head)) {
    if (index > limit) break;
    if (index > 0) hard = index;
    if (index > 0 && WHITESPACE_RE.test(segment)) space = index;
  }
  if (space > 0) {
    const cut = line.slice(0, space).trimEnd();
    if (cut) return cut;
  }
  return line.slice(0, hard);
}

/**
 * An own data property only: never the prototype, never a getter (it is not called). A Proxy trap may still throw here; the caller
 * catches that.
 */
function ownValue(c: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(c, key);
  return d && 'value' in d ? d.value : undefined;
}
function field(c: object, key: string): string | undefined {
  const v = ownValue(c, key);
  return typeof v === 'string' ? v : undefined;
}

/** `prefix` + `fixed` + the encoded value of each `[name, value]`, if it fits the cap. */
function assemble(head: string, params: Array<[string, string]>): LinkResult {
  let encodedLength = head.length;
  params.forEach(([name, value], i) => { encodedLength += (i ? 1 : 0) + name.length + 1 + encodedLengthOf(value); });
  if (encodedLength > URL_CHARS) return { error: 'too-long', encodedLength };
  const url = head + params.map(([name, value]) => name + '=' + encodeValue(value)).join('&');
  if (!ALLOWLIST.some((p) => url.startsWith(p))) return { error: 'bad-channel' };
  return { url, encodedLength: url.length, prefill: true };
}

interface ReadInput { kind?: string; upn?: string; address?: string; team?: string; user?: string; username?: string; text: string; teamsApp: boolean; copyOnly: boolean }

/**
 * Everything the builder uses, copied once into plain values. Reading a hostile object (a Proxy whose trap throws, a revoked Proxy)
 * can throw only here, and each part's throw becomes its own error; after this only strings and booleans are touched.
 */
function readInput(channel: unknown, text: unknown, opts: unknown): ReadInput | { error: LinkError } {
  let c: Omit<ReadInput, 'text' | 'teamsApp' | 'copyOnly'>;
  try {
    if (!channel || typeof channel !== 'object') return { error: 'bad-channel' };
    c = {
      kind: field(channel, 'kind'), upn: field(channel, 'upn'), address: field(channel, 'address'),
      team: field(channel, 'team'), user: field(channel, 'user'), username: field(channel, 'username'),
    };
  } catch {
    return { error: 'bad-channel' };
  }
  if (typeof text !== 'string') return { error: 'bad-text' };
  let teamsApp = false;
  let copyOnly = false;
  try {
    if (opts !== undefined && opts !== null) {
      if (typeof opts !== 'object') return { error: 'bad-options' };
      teamsApp = ownValue(opts, 'teamsApp') === true;
      copyOnly = ownValue(opts, 'copyOnly') === true;
    }
  } catch {
    return { error: 'bad-options' };
  }
  return { ...c, text, teamsApp, copyOnly };
}

/**
 * FR-040..FR-045: the link for one channel and text. Teams `users` + `message` (FR-041), email `subject` + `body` (FR-042),
 * Slack `team` + `id` with the text to copy (FR-043), Telegram `text` (FR-044); over 2,000 characters `too-long` (FR-045).
 * `copyOnly` drops `message` / `body` / `text` and returns `copyText` (for email the body; the subject stays).
 * Never throws: a channel, text or options it cannot read gives `bad-channel`, `bad-text` or `bad-options`.
 */
export function buildContactLink(channel: LinkChannel, text: string, opts?: LinkOptions): LinkResult {
  const input = readInput(channel, text, opts);
  if ('error' in input) return input;
  const { kind, copyOnly } = input;
  const t = wellFormed(input.text);
  const copied = (r: LinkResult, copyText: string): LinkResult => ('url' in r ? { ...r, prefill: false, copyText } : r);
  if (kind === 'teams') {
    const upn = input.upn;
    if (!linkAddressOk(upn)) return { error: 'bad-channel' };
    const head = input.teamsApp ? TEAMS_APP : TEAMS_WEB;
    if (copyOnly) return copied(assemble(head, [['users', upn]]), t);
    return assemble(head, [['users', upn], ['message', t]]);
  }
  if (kind === 'email') {
    const address = input.address;
    if (!linkAddressOk(address)) return { error: 'bad-channel' };
    const { subject, body } = emailParts(t);
    if (copyOnly) return copied(assemble(MAILTO + address + '?', [['subject', subject]]), body);
    return assemble(MAILTO + address + '?', [['subject', subject], ['body', body]]);
  }
  if (kind === 'slack') {
    const { team, user } = input;
    if (team === undefined || user === undefined || !SLACK_TEAM_RE.test(team) || !SLACK_USER_RE.test(user)) return { error: 'bad-channel' };
    return copied(assemble(SLACK, [['team', team], ['id', user]]), t);
  }
  if (kind === 'telegram') {
    const username = input.username;
    if (!telegramNameOk(username)) return { error: 'bad-channel' };
    if (copyOnly) return copied(assemble(TELEGRAM + username, []), t);
    return assemble(TELEGRAM + username + '?', [['text', t]]);
  }
  return { error: 'bad-channel' };
}
