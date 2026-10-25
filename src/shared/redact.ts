/**
 * Secret redaction (spec 012 FR-006, constitution III). Pure: no Electron, no Node-only imports, so it is unit-tested.
 * Everything that reaches the `DURBAR_LOG` debug log, and later vendor stderr, goes through `redact` first.
 */

/** Longest input handled per call; the rest is dropped, so a huge stderr cannot stall the main process. */
export const REDACT_MAX_CHARS = 1_000_000;

const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/i;
const SECRET_PREFIX = /^(GH_|GITHUB_|OPENAI_|ANTHROPIC_|COPILOT_)/i;
/** Long but harmless values: excluded from the "20+ characters" rule only (the name rule still applies). */
const LONG_OK_NAME = /^(PATH|PATHEXT|PSMODULEPATH|HOME|HOMEPATH|HOMEDRIVE|USERPROFILE|PWD|OLDPWD|SHELL|TMPDIR|TEMP|TMP|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMROOT|WINDIR|COMSPEC|NODE_PATH|MANPATH|INFOPATH|LS_COLORS|LSCOLORS|TERM_PROGRAM_VERSION|DISPLAY|DBUS_SESSION_BUS_ADDRESS|SSH_AUTH_SOCK|INIT_CWD|_|__CF.*|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS|.*_HOME|ONEDRIVE.*|COMMONPROGRAMFILES.*|PROGRAMW6432|ALLUSERSPROFILE|PUBLIC|TERM_SESSION_ID|XPC_SERVICE_NAME|VSCODE_.*|TERM_PROGRAM.*|ITERM_.*|COLORTERM|DURBAR_.*|XDG_.*|LC_.*|npm_.*)$/i;

/* Token and key shapes start where no letter or digit precedes them, not at `\b`: there is no word boundary between `_` and a
   letter, so `\b` let a token wrapped in Markdown emphasis (`_ghp_…_`, `__sk-…__`) or glued to a snake_case word (`my_ghp_…`)
   through (spec 012 FR-080 delta 2026-10-22). JWTs keep their stricter start (never after a letter, digit, `_` or `-`, so a long
   base64url run is never rescanned from inside and the pattern stays linear); the wrapping is a bounded prefix instead: up to 8
   underscores and up to 4 snake_case words (`my_eyJ…`, `MY__eyJ…`, `____eyJ…`), kept in the output (T128). */
/* A token may also start right after a percent-encoded byte (`?q=token%3Dghp_…`, `%22ghp_…%22`, `%2F`, `%3A`), where the char before
   it is a hex digit (spec 012 FR-080 delta 2026-10-22, T129, review of PR #543), and after a `%` encoded any number of times
   (`%253D`, `%2525253D`): the last escape of a re-encoded `%` always follows `25`, so `(?:%|25)XX` covers every depth with a
   fixed-width lookbehind (T130; over-masks a token glued to a literal `25XX`, fail-safe). It may also start right after a backslash
   escape (`\n`, `\t`, `\uXXXX`, `\xXX`), because the debug log redacts *after* `JSON.stringify`, which turns a token at the start of a
   line into `\nghp_…` (T130, review of PR #549). A quoted-printable escape (`=3Dghp_…`: `=` and two upper-case hex digits) and a
   `%uXXXX` escape (`%u003Dghp_…`, merged into the `%XX` branch so the start costs no more per position) start a token too (T132, issue #551). Every branch is fixed-width, so each position costs O(1): still linear. */
const PCT = String.raw`(?<=(?:%(?:u[0-9A-Fa-f]{2})?|25)[0-9A-Fa-f]{2}|=[0-9A-F]{2}|\\(?:[nrtbfv]|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}))`;
/** Where a token shape may start: no letter or digit before it, or right after a `%XX`, `%uXXXX`, `=XX` or backslash escape. */
const START = String.raw`(?:(?<![A-Za-z0-9])|${PCT})`;
const shape = (body: string, flags = 'g'): RegExp => new RegExp(START + body, flags);
/** A shape that is only tried when the text matches its marker (a cheap test before a 1 MB regex scan). The marker is a superset of
    every spelling the shape accepts (case-insensitive; `:` also as `\u003a`, `\x3a` or `%…3a`), which `test-redact.ts` checks
    against the unguarded run (`maskTokenShapesUnguarded`). */
type Guarded = { re: RegExp; marker: RegExp };
const guarded = (re: RegExp, marker: RegExp): Guarded => ({ re, marker });
/** A literal host or word matched in any case: `[Hh][Oo]…`, dots escaped. */
const ci = (lit: string): string => lit.replace(/[A-Za-z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`).replace(/\./g, String.raw`\.`);
/** A `/` as written in a URL, JSON-escaped (`\/`, `\\/`, `\u002f`, `\x2f`) or percent-encoded any number of times (`%2F`, `%252F`, up to 8 re-encodings). */
const SL = String.raw`(?:\\{0,2}\/|\\{1,2}(?:u002[Ff]|x2[Ff])|%(?:25){0,8}2[Ff])`;
/** One or two of them (`//`) between URL segments. */
const SL2 = String.raw`(?:${SL}){1,2}`;
/** A `:` written the same ways (`:`, `\u003a`, `\x3a`, `%3A`, `%253A`, ...). */
const COLON = String.raw`(?::|\\{1,2}(?:u003[Aa]|x3[Aa])|%(?:25){0,8}3[Aa])`;
/** A `.` as written, or percent-encoded any number of times (`%2E`). */
const DOT = String.raw`(?:\.|%(?:25){0,8}2[Ee])`;
/** After a webhook host: an optional trailing dot and an optional `:port` (the colon in any spelling). */
const HOSTX = String.raw`\.?(?:${COLON}[0-9]{1,5})?`;
/** Bare token shapes (GitHub, OpenAI/Anthropic, Bearer, JWT, AWS, Slack, Discord, Telegram); also used by the folder-setup display (spec 061 FR-014). */
const TOKEN_SHAPES: Array<RegExp | Guarded> = [
  shape(String.raw`gh[pousr]_[A-Za-z0-9]{20,}`),
  shape(String.raw`github_pat_[A-Za-z0-9_]{20,}`),
  shape(String.raw`sk-(?:ant-)?[A-Za-z0-9_-]{20,}`),
  // any case: `bearer xyz` in a lowercased log line is the same secret (review on PR #630)
  shape(String.raw`[Bb][Ee][Aa][Rr][Ee][Rr]\s{1,8}[A-Za-z0-9._~+/=-]{8,}`),
  // The JWT starts at its literal `eyJ`, and its start and prefix are checked behind it (a bounded lookbehind), so the engine only
  // stops at an `eyJ`. Matching the prefix forward instead tried up to 40 word characters at every position of a run that passes
  // the `%XX` start (`2525…`): linear, but about 40x the cost of the other shapes (T130, review of PR #549). The prefix stays.
  new RegExp(String.raw`(?<=(?:(?<![A-Za-z0-9_-])|${PCT})_{0,8}(?:[A-Za-z0-9]{1,40}_{1,3}){0,4})eyJ[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}`, 'g'),
  shape(String.raw`(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])`),
  // Chat-tool secrets (T132, issue #551). Slack tokens: `xoxb-`, `xoxp-`, `xoxa-`, `xoxc-`, `xoxd-` (browser session), `xoxr-`, `xoxs-`,
  // `xoxe-` and `xapp-`, then 10+ token characters or `%XX` escapes (a URL-encoded `xoxd-…%2B…%2F`); `xoxo-` is not a Slack prefix.
  guarded(shape(String.raw`(?:xox[abcdeprs]|xapp)-(?:[A-Za-z0-9-]|%[0-9A-Fa-f]{2}){10,}`), /xox|xapp-/i),
  // Webhooks: the fixed host and path sit in a lookbehind (host in any case, optional trailing dot and `:port`), so the scheme and host
  // stay and only the secret path is masked. Between segments one or two slashes (`//`); the segments before the last are bounded
  // classes split by a fixed `/`, the last one is unbounded (`[A-Za-z0-9_-]+`, a long or underscore secret is masked whole), so there
  // is no nested quantifier. Slack: `services`, `workflows` and `triggers` paths.
  guarded(new RegExp(String.raw`(?<=${ci('hooks.slack.com')}${HOSTX}${SL2}(?:${ci('services')}|${ci('workflows')}|${ci('triggers')})${SL2})(?:[A-Za-z0-9]{1,64}${SL2}){2,3}[A-Za-z0-9_-]+`, 'g'), /hooks\.slack\.com/i),
  guarded(new RegExp(String.raw`(?<=${ci('discord')}(?:${ci('app')})?${ci('.com')}${HOSTX}${SL2}${ci('api')}${SL2}(?:[Vv][0-9]{1,2}${SL2})?${ci('webhooks')}${SL2})[0-9]{5,30}${SL2}[A-Za-z0-9_-]{20,}`, 'g'), /discord(?:app)?\.com/i),
  // Telegram bot token: `<6-12 digits>:<exactly 35 chars>` (the real shape, so an id, a session or a file name is not one), bare or
  // right after `/bot` on any host, port or path (`api.telegram.org/bot…`, `api.telegram.org/file/bot…`, a local Bot API server, a
  // proxy): a letter then precedes it, so the lookbehind is host-free.
  guarded(shape(String.raw`[0-9]{6,12}${COLON}[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])`), /[0-9]{6}[:%\\]/),
  guarded(new RegExp(String.raw`(?<=${SL}[Bb][Oo][Tt])[0-9]{6,12}${COLON}[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])`, 'g'), /bot[0-9]{6}/i),
  // Discord bot token (the id is the base64 of a numeric id, so its second character is D, T, j or z; the dots may be percent-encoded): base64 user id, `.`, 6-character timestamp, `.`, HMAC (27 or more); the first character is M, N or O.
  guarded(shape(String.raw`[MNO][DTjz][A-Za-z0-9_-]{21,26}${DOT}[A-Za-z0-9_-]{6}${DOT}[A-Za-z0-9_-]{27,}`), /(?:\.|%(?:25){0,8}2[Ee])[A-Za-z0-9_-]{6}(?:\.|%(?:25){0,8}2[Ee])/),
];

function maskShapes(text: string, mask: string, guard: boolean): string {
  let out = text;
  // A function, so `$&` or `$1` in the mask stays literal; the JWT's prefix is outside its match (lookbehind), so it stays too.
  for (const t of TOKEN_SHAPES) {
    if (t instanceof RegExp) out = out.replace(t, () => mask);
    else if (!guard || t.marker.test(out)) out = out.replace(t.re, () => mask);
  }
  return out;
}

/** Replaces every bare token shape with `mask` (a JWT's leading underscores and words stay). Linear; no env rules, no header or URL rules. */
export function maskTokenShapes(text: string, mask: string): string {
  return maskShapes(text, mask, true);
}
/** Test only: the same without the marker guard, to prove the guard never changes the result. */
export function maskTokenShapesUnguarded(text: string, mask: string): string {
  return maskShapes(text, mask, false);
}

/** Key-like shapes. Each is linear: bounded classes, no nested quantifiers, starts anchored where a token cannot already be running. Order matters: header and URL first. */
const PATTERNS: Array<[RegExp, string]> = [
  [shape(String.raw`(authorization\s{0,8}[:=]\s{0,8})(?:(?:bearer|basic|token)\s{1,8})?(?!'?\[redacted\]'?\}*(?:[\s",;]|$))[^\s",;]+`, 'gi'), '$1[redacted]'], // a value R12 already hid, whole, inside single quotes (`Authorization='[redacted]'}`) stays as it is; `[redacted]TOKEN` is not a hidden value
  [shape(String.raw`([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/:@"]{1,200}:[^\s/@"]{1,200}@`, 'gi'), '$1[redacted]@'],
  [/(?<![A-Za-z0-9_-])tid=[0-9a-f]{8,64};[^\s"]{0,2000}/g, '[redacted]'],
  // OAuth values in a URL's query or fragment (an authorization address, a loopback callback), also percent-encoded inside another
  // URL; the names are not secret-looking, so the token shapes miss them (review on #635: a CLI's stderr reaches the debug sink).
  // A fixed separator and name, then a bounded value that stops at the next separator: linear.
  [/((?:[?&#;]|%(?:3[Ff]|26|23|3[Bb]))(?:code|state|code_verifier|code_challenge|id_token|access_token|refresh_token|client_secret)(?:=|%3[Dd]))[^&;#\s"'\\<>]{1,4096}/gi, '$1[redacted]'],
];

type Env = Record<string, string | undefined>;

function envSecrets(env: Env): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value.length <= 7) continue;
    const byName = SECRET_NAME.test(name) || SECRET_PREFIX.test(name);
    const byLength = value.length >= 20 && !/\s/.test(value) && !LONG_OK_NAME.test(name);
    if (!byName && !byLength) continue;
    // Also the forms the value takes inside JSON (once, twice escaped) and inside a URL.
    const j1 = JSON.stringify(value).slice(1, -1);
    const j2 = JSON.stringify(j1).slice(1, -1);
    for (const v of new Set([value, j1, j2, encodeURIComponent(value)])) out.push([name, v]);
  }
  // Longest first, so a value that contains another one is replaced whole.
  return out.sort((a, b) => b[1].length - a[1].length);
}

const TOKEN_CHAR = /[A-Za-z0-9_\-.~+/=:@%]/;
const TRUNCATED = ' [truncated]';

/** Cut to `max` chars without leaving the start of a token (a secret may straddle the cut) or a newline. */
export function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  if (end > 0 && /[\ud800-\udbff]/.test(s[end - 1])) end--; // never leave half a surrogate pair
  while (end > 0 && TOKEN_CHAR.test(s[end - 1])) end--;
  // a loop, not `/[ \t]+$/`: that regex retries at every blank of a long run (quadratic on a 1 MB run of spaces)
  while (end > 0 && (s[end - 1] === ' ' || s[end - 1] === '\t')) end--;
  return s.slice(0, end) + TRUNCATED;
}

/** Env snapshots made by the masking helpers: their secret list is computed once, so a 100 000-token command does not rescan the env per token. */
const SNAPSHOTS = new WeakMap<Env, Array<[string, string]>>();
function snapshot(env?: Env): Env {
  if (env && SNAPSHOTS.has(env)) return env;
  const e: Env = { ...(env ?? (globalThis as { process?: { env?: Env } }).process?.env ?? {}) };
  SNAPSHOTS.set(e, envSecrets(e));
  return e;
}

/** Replace secret environment values and key-like strings. Never throws; keeps line structure. */
export function redact(text: unknown, env?: Env): string {
  try {
    let s = typeof text === 'string' ? text : text == null ? '' : String(text);
    const e: Env = env ?? (globalThis as { process?: { env?: Env } }).process?.env ?? {};
    // Replace first, then cut: a secret straddling the cut is already gone.
    for (const [name, value] of SNAPSHOTS.get(e) ?? envSecrets(e)) {
      if (s.includes(value)) s = s.split(value).join(`[redacted:${name}]`);
    }
    s = cut(s, REDACT_MAX_CHARS);
    for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
    return maskTokenShapes(s, '[redacted]');
  } catch {
    return '[redaction failed]';
  }
}

/**
 * `k` is `u` with its Markdown marks removed. Masks `k`, and also every token-like run of `u` that `redact` changes on its own, together
 * with the token characters glued after it (spec 073 FR-014, review of PR #614): removing `**` can glue a token to the word before it
 * (`x**ghp_...**` -> `xghp_...`, which no shape matches) or join a late-split token's tail (`ghp_<20>**K1l2...`). Anything either pass
 * finds is masked; neither pass's output simply wins. The window's DurbarSafeText (`src/renderer/safetext.js`, `both`) does the same.
 */
export function redactMarkdown(u: string, k: string, env?: Env): string {
  let m = redact(k, env);
  const seen = new Set<string>();
  const found: string[] = [];
  for (const r of u.match(/[A-Za-z0-9_\-.+/=:@%]{12,}/g) ?? []) {
    if (seen.has(r)) continue;
    seen.add(r);
    if (redact(r, env) !== r) found.push(r);
  }
  found.sort((a, b) => b.length - a.length);
  for (const r of found) m = m.replace(new RegExp(r.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[A-Za-z0-9_-]*', 'g'), () => MASK);
  return m;
}

const MASK = '[redacted]';
/** T065 (#374): a string longer than this is replaced by `[redacted]` whole, before any rule runs and never cut, so a 1 MB arg costs nothing. Above the 4096 display cap (T054) and the 4096 per-arg limit of per-folder extras (FR-022). */
export const MASK_INPUT_MAX = 12288;
const capped = (x: unknown): unknown => (typeof x === 'string' && x.length > MASK_INPUT_MAX ? MASK : x);
const SECRET_SUB = /token|secret|passw|passphrase|apikey|privatekey|credential|cookie|signature|jwt/;
const SECRET_WORDS = new Set(['key', 'pass', 'pwd', 'pw', 'pat', 'bearer', 'auth', 'authorization', 'session', 'sig']);
const HEADER_FLAGS = new Set(['-h', '--header', '--headers', '--http-header']);

/**
 * Does a flag, header, query or `NAME=` name look secret (spec 041 FR-053)? Case-insensitive, after percent-decoding and splitting on
 * `-`, `_`, `.` and camelCase boundaries (`privateKey` is `private`, `key`). Over-masking is accepted (`--no-auth`, `--session-name`).
 */
export function secretFlag(flag: string): boolean {
  let n = String(flag ?? '').replace(/^(?:-+|\/)/, '').slice(0, 256);
  if (!n) return false;
  if (n.includes('%')) { try { n = decodeURIComponent(n); } catch { /* keep the raw name */ } }
  const words = n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[\s\-_.]+/).filter(Boolean);
  return SECRET_SUB.test(n.toLowerCase()) || SECRET_SUB.test(words.join('')) || words.some((w) => SECRET_WORDS.has(w));
}

/** A flag arg split into name, separator (first `=`, `:` or space) and the rest. A flag starts with `-`, or is a Windows-style one-segment `/name`. */
export function parseFlag(a: string): { name: string; sep?: string; rest?: string } | undefined {
  const m = /^(-[^\s=:]*|\/[^\s=:/\\]+)(?:([=:\s])([\s\S]*))?$/.exec(a);
  return m ? { name: m[1], sep: m[2], rest: m[3] } : undefined;
}

const URL_SHAPE = /^[a-z][a-z0-9+.-]{1,20}:\/\//i;
/** `NAME=value`, also the PowerShell `$env:NAME=value` form (no spaces around `=` needed; `$env:NAME = 'v'` is the same rule). */
const KV = /^(\s*)((?:\$env:)?[A-Za-z_][A-Za-z0-9_.-]{0,127})(\s*=)([\s\S]*)$/i;
const ENV_PREFIX = /^\$env:/i;
/** The next arg after a secret flag stays a flag (not its value) only when it has the shape of a long flag: `--name`, `--name=..`. */
const LONG_FLAG = /^--[A-Za-z][A-Za-z0-9_.-]*(?:[=:\s]|$)/;
/** `Bearer x` / `Basic x` as a whole arg: the word and exactly one token (so `Basic setup of the server` stays). */
const BEARER = /^(bearer|basic)(\s+)\S+\s*$/i;
/** R11: auth scheme words; the secret is the next arg. */
const SCHEME = /^(?:bearer|basic|token|digest|negotiate|apikey)$/i;
/** `Name: <scheme word>` with nothing after it and a secret-looking name (`Authorization: Bearer`): the secret is the next arg (R11 b). */
function schemeHeader(a: string, anyName = false): boolean {
  const h = HDR.exec(a);
  return !!h && !URL_SHAPE.test(a) && SCHEME.test(h[2].trim()) && (anyName || secretFlag(h[1]));
}
/**
 * R11(b) on the raw text of a `command`, before `redact()` (R8) can mask the scheme word and hide the shape: in `Name: <scheme>` (also
 * quoted) with a secret-looking name, the word after it is the secret. Bounded pieces, starting at the start, a whitespace or a `=`: linear.
 */
export function maskSchemeSecrets(c: string): string {
  if (!/:/.test(c)) return c;
  // `Name:` (the name starts at the text start, a whitespace or a `=`: `--header=Authorization:Digest SEC`; a quote may come before it)
  const head = /(^|[\s=])(["']?)([A-Za-z0-9][A-Za-z0-9_-]{0,127})(\s{0,8}:\s{0,8})/g;
  const scheme = /["']?(?:bearer|basic|token|digest|negotiate|apikey)["']?\s{1,8}/iy; // the scheme word, quoted or not, and the space after it
  const bare = /(?!-)[^\s"']{1,4096}/y;
  // a quoted run from `at` (a quote character): up to the closing quote within 4096, else to the end of the text (fail-safe: an unclosed quote hides the rest)
  const runEnd = (at: number): number => { const k = c.indexOf(c[at], at + 1); return k < 0 || k - at > 4097 ? c.length : k + 1; };
  let out = '';
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = head.exec(c)) !== null) {
    const e = m.index + m[0].length;
    if (!secretFlag(m[3])) { head.lastIndex = Math.max(e, head.lastIndex); continue; }
    let keepTo = e; // text kept as it is, up to here
    let maskTo = -1; // then `[redacted]` replaces up to here
    scheme.lastIndex = e;
    const sm = scheme.exec(c);
    if (sm) { // R11 (b): the scheme word stays, the secret after it is a bare word or a quoted run (`Authorization: Basic "SEC x"`)
      const r = e + sm[0].length;
      if (c[r] === '"' || c[r] === "'") { keepTo = r; maskTo = runEnd(r); } else { bare.lastIndex = r; const bm = bare.exec(c); if (bm) { keepTo = r; maskTo = r + bm[0].length; } }
    }
    if (maskTo < 0 && (c[e] === '"' || c[e] === "'")) { keepTo = e; maskTo = runEnd(e); } // a quoted value after the name is masked whole (redact() would stop at the first space: `Authorization: 'a SEC'`)
    if (maskTo < 0) continue;
    out += c.slice(from, keepTo) + MASK;
    from = maskTo;
    head.lastIndex = maskTo;
  }
  return from === 0 ? c : out + c.slice(from);
}
const HDR = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\s{0,8}:\s*([\s\S]*)$/;
/** `Name:` alone: its value is the next arg (R5). */
const HDR_NAME_ONLY = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\s{0,8}:\s{0,8}$/;
/** Pieces of a text: `;`, and a `,` only when a `name=` follows (bounded look-ahead), so a password with a comma stays whole (R6). */
const PAIR_SPLIT = /(;|,(?=\s{0,8}[A-Za-z_][A-Za-z0-9_.-]{0,127}\s{0,8}=))/;
/** Levels of nesting (shell split, `NAME=value`, quoted word: 1 each). Past it a value that would need another pass is masked whole (fail-safe), never shown. */
const MAX_DEPTH = 8;

function maskJsonValue(v: unknown, force: boolean, depth: number, env: Env | undefined, d: number): unknown {
  if (depth > 32) return MASK;
  if (Array.isArray(v)) {
    // an array of strings is an args list (`["--token","x"]`)
    if (v.length > 0 && v.every((x) => typeof x === 'string')) return force ? v.map(() => MASK) : maskArgs(v as string[], snapshot(env), d);
    return v.map((x) => maskJsonValue(x, force, depth + 1, env, d));
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    const o = v as Record<string, unknown>;
    // R7: `{"name":"token","value":"x"}` / `{"key":"Authorization","value":"x"}`: the test is on the raw name string.
    const nameKey = Object.keys(o).find((k) => k.toLowerCase() === 'name' && typeof o[k] === 'string') ?? Object.keys(o).find((k) => k.toLowerCase() === 'key' && typeof o[k] === 'string');
    const pn = nameKey === undefined ? undefined : (o[nameKey] as string);
    const pairSecret = pn !== undefined && secretFlag(pn);
    for (const [k, x] of Object.entries(o)) out[k] = maskJsonValue(x, force || secretFlag(k) || (pairSecret && /^value$/i.test(k)), depth + 1, env, d);
    return out;
  }
  if (typeof v === 'string') return force ? MASK : maskText(v, d, env);
  if (typeof v === 'number') return force ? MASK : v;
  return v;
}

/** Valid JSON: every string or number under a secret-looking key, at any depth, is masked; written back compactly. */
function maskJson(v: string, env: Env | undefined, force: boolean, d: number): string | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(v); } catch { return undefined; }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  return JSON.stringify(maskJsonValue(parsed, force, 0, env, d));
}

/** R7 on escaped objects: `{\"name\":\"token\",\"value\":\"x\"}` (or `\"key\"`): a secret-looking name masks the `\"value\"` of the same object. One level (no braces inside), bounded. */
function maskEscapedObjects(v: string): string {
  if (!v.includes('{')) return v;
  return v.replace(/\{([^{}]{0,4100})\}/g, (m, body: string) => {
    const n = /\\{1,16}"(?:name|key)\\{1,16}"\s{0,8}:\s{0,8}\\{1,16}"([^"\\]{0,100})\\{1,16}"/i.exec(body);
    if (!n || !secretFlag(n[1])) return m;
    return '{' + body.replace(/(\\{1,16}"value\\{1,16}"\s{0,8}:\s{0,8})(?:(\\{1,16}")[^"\\]{0,2000}(\\{1,16}")|\[[^\[\]]{0,2000}\]|[^\s,}\[\]"\\][^\s,}\]"\\]{0,1999})/i, (_x, pre: string, q1?: string, q2?: string) => `${pre}${q1 ? `${q1}${MASK}${q2}` : MASK}`) + '}';
  });
}

/** `\"name\":\"value\"` pairs with escaped quotes (any escape depth; JSON inside a shell string that R1 cannot parse). The value may contain spaces. */
function maskEscapedPairs(v: string, force = false): string {
  if (!v.includes('\\"')) return v;
  if (!force) v = maskEscapedObjects(v); // R7 first: the test is on the raw name string, before the pair rule below masks it
  return v.replace(/(\\{1,16}")([^"\\]{1,100})(\\{1,16}")(\s{0,8}:\s{0,8})(?:(\\{1,16}")[^"\\]{0,2000}(\\{1,16}")|[^\s,}\]"\\]{1,2000})/g, (m, q1: string, name: string, q2: string, colon: string, vq1?: string, vq2?: string) => {
    if (!force && !secretFlag(name)) return m;
    return `${q1}${name}${q2}${colon}${vq1 ? `${vq1}${MASK}${vq2}` : MASK}`;
  });
}

/** Text that is not valid JSON: `"name": "value"` pairs with a secret-looking name, by pattern. */
function maskJsonPairs(v: string, force = false): string {
  // the same pairs with escaped quotes (`{\"token\":\"x\"}`, JSON inside a shell string that R1 could not parse)
  return maskEscapedPairs(v, force).replace(/"([^"\\]{1,100})"(\s{0,8}:\s{0,8})("(?:[^"\\]|\\.){0,2000}"?|[^\s,}\]"]{1,2000})/g, (m, name: string, colon: string, val: string) => {
    if (!force && !secretFlag(name)) return m;
    return `"${name}"${colon}${val.startsWith('"') ? `"${MASK}"` : MASK}`;
  });
}

/** One `NAME=value` or `Name: value` piece: masked when the name looks secret; otherwise its value is masked recursively (a URL, JSON). */
function maskKv(part: string, depth: number, env?: Env): string {
  const kv = KV.exec(part);
  if (kv) {
    if (secretFlag(kv[2].replace(ENV_PREFIX, ''))) { // R12: a hashtable member already hidden (`'[redacted]'}`) keeps its quotes and what closes it
      const hid = /^(\s*)(["']?)\[redacted\](["';}\s]*)$/.exec(kv[4]);
      return hid ? `${kv[1]}${kv[2]}${kv[3]}${hid[1]}${hid[2]}${MASK}${hid[3]}` : `${kv[1]}${kv[2]}=${MASK}`;
    }
    const hv = HDR_NAME_ONLY.exec(kv[4].trim());
    if (hv && secretFlag(hv[1])) return part; // `NAME=Name:` (R5): the value of `Name:` is the next word, masked by maskArgs; masking `Name:` here repeated `[redacted]` at each depth level
    // `OPTS=\"--token x\"`: a stray quote in front of a flag-shaped value is set aside so the flag is seen
    const lead = depth > 0 ? /^[\\"'`]+/.exec(kv[4])?.[0] ?? '' : '';
    if (lead && /^[-/]/.test(kv[4].slice(lead.length))) return `${kv[1]}${kv[2]}${kv[3]}${lead}${maskText(kv[4].slice(lead.length), depth - 1, env)}`;
  }
  if (kv) return depth > 0 ? `${kv[1]}${kv[2]}${kv[3]}${maskText(kv[4], depth - 1, env)}` : kv[4].trim() === '' ? part : `${kv[1]}${kv[2]}=${MASK}`; // budget spent: fail-safe
  const h = HDR.exec(part);
  if (h && !URL_SHAPE.test(part)) return secretFlag(h[1]) ? `${h[1]}: ${MASK}` : part;
  const b = BEARER.exec(part);
  return b ? `${b[1]}${b[2]}${MASK}` : part;
}

/**
 * Words of a shell string (R1): split on whitespace outside quotes. A `"` or `'` opens a span that ends at the next same quote and stays
 * inside the word with its quotes; an unmatched quote is a literal. No escapes, `$(...)` or heredocs (`[KNOWN GAP]`; the payload of a shell
 * wrapper is unescaped by `maskScriptText` before this, T067). `seps` has one more
 * entry than `words` (the whitespace before the first word, between words, after the last), so `seps[0] + words[0] + seps[1] ...` is the
 * input. Linear: a matched span is skipped and, once a quote type has no match, there is none after it (one failed search per type).
 */
export function shellWords(s: string): { words: string[]; seps: string[] } {
  const words: string[] = [];
  const seps: string[] = [];
  const n = s.length;
  const WS = /\s/;
  let noDq = false;
  let noSq = false;
  let i = 0;
  while (i < n && WS.test(s[i])) i++;
  seps.push(s.slice(0, i));
  while (i < n) {
    let j = i;
    while (j < n && !WS.test(s[j])) {
      const c = s[j];
      if ((c === '"' && !noDq) || (c === "'" && !noSq)) {
        const k = s.indexOf(c, j + 1);
        if (k >= 0) { j = k + 1; continue; }
        if (c === '"') noDq = true; else noSq = true;
      }
      j++;
    }
    words.push(s.slice(i, j));
    let k = j;
    while (k < n && WS.test(s[k])) k++;
    seps.push(s.slice(j, k));
    i = k;
  }
  return { words, seps };
}

/** Words split on whitespace only (quotes ignored); same shape as `shellWords`. Used when R1 leaves a text with spaces in one word. */
function plainWords(s: string): { words: string[]; seps: string[] } {
  const words: string[] = [];
  const seps: string[] = [/^\s*/.exec(s)![0]];
  const re = /(\S+)(\s*)/g;
  re.lastIndex = seps[0].length;
  for (let m = re.exec(s); m; m = re.exec(s)) { words.push(m[1]); seps.push(m[2]); }
  return { words, seps };
}

/** R3: a text with whitespace is masked word by word as an args list; the separators, and the trailing run of `[;&|]+` of a word, are kept. A secret that ends in those characters shows only them. */
function maskShellString(v0: string, depth: number, env?: Env, plain = false): string {
  const v = maskEscapedPairs(maskSchemeSecrets(v0)); // the scheme pre-pass first (R11 b, as for a command), then before the split: an escaped value may hold spaces
  let { words, seps } = plain ? plainWords(v) : shellWords(v);
  if (words.length === 1 && unquote(words[0])[1] !== '') return seps[0] + maskArgs(words, snapshot(env), depth)[0] + seps[1]; // one whole-quoted word (`A="x --token y"`, `--cmd='...'`): its inside
  if (words.length < 2) {
    // R1 could not split it (escaped quotes such as `\"`): the plain whitespace split, quotes ignored, so text with spaces is never shown unmasked
    if (!/\s/.test(v.trim()) || KV.test(v)) return v; // (a `NAME=value` word had its value masked by `maskKv` already)
    ({ words, seps } = plainWords(v));
  }
  const cores: string[] = [];
  const idx: number[] = [];
  const leads: string[] = [];
  const tails: string[] = [];
  const outWords: string[] = [];
  words.forEach((w, i) => {
    let e = w.length; // the trailing run of `;`, `&`, `|` (a backward loop: a regex `[;&|]+$` is quadratic on a long run)
    while (e > 0 && ';&|'.includes(w[e - 1])) e--;
    const body = w.slice(0, e);
    const tail = w.slice(e);
    // a stray quote or backslash in front of an unquoted word (`\"--token`, an unmatched `"`) is set aside, so the flag behind it is seen
    const lead = unquote(body)[1] === '' ? (/^[\\"'`]+/.exec(body) ?? (/^[-/]/.test(body) ? null : /^[^\s"'\\`]*[\\"'`]+(?=[-/])/.exec(body)))?.[0] ?? '' : '';
    const core = body.slice(lead.length);
    leads[i] = lead;
    tails[i] = tail;
    outWords[i] = lead + tail;
    if (core !== '') { cores.push(core); idx.push(i); }
  });
  const masked = maskArgs(cores, snapshot(env), depth, false, false);
  idx.forEach((wi, k) => { outWords[wi] = leads[wi] + masked[k] + tails[wi]; });
  let out = seps[0];
  for (let i = 0; i < outWords.length; i++) out += outWords[i] + seps[i + 1];
  return out;
}

/*
 * T067 (#447): shell wrappers whose payload holds escaped quotes. R1 knows no escapes, so `sh -c "srv -H \"X-Api-Key: x\""` or
 * `powershell -Command "srv `"x`""` used to be cut at the escaped quote and the secret showed. The payload after `sh|bash|... -c`,
 * `cmd /c` (or `/k`) and `powershell|pwsh -Command` is unescaped one level with that shell's own rules, masked by the usual rules and,
 * when anything changed, written back with the same quoting. At most `WRAP_MAX` decodes nest; a payload past that, or one whose quotes
 * do not close, is masked to its end (fail closed). Every pass is a single scan (a backslash run is matched whole), so the cost stays linear.
 */
type ShellKind = 'sh' | 'cmd' | 'ps';
/** Text that may hold an escape of one of the three shells (`''` is PowerShell's quote inside `'...'`); without one the plain rules already see every quote (R1). */
const SCRIPT_GATE = /[\\`^]|""|''/;
const WRAP_MAX = 2;
let wrapActive = 0;
const SH_EXE = /^(?:sh|bash|zsh|dash|ksh|mksh|ash|fish)$/;

function shellKind(word: string): ShellKind | undefined {
  const w = unquote(word)[0];
  const base = w.slice(Math.max(w.lastIndexOf('/'), w.lastIndexOf('\\')) + 1).toLowerCase().replace(/\.exe$/, '');
  if (SH_EXE.test(base)) return 'sh';
  if (base === 'cmd') return 'cmd';
  if (base === 'powershell' || base === 'pwsh') return 'ps';
  return undefined;
}
function isCommandFlag(kind: ShellKind, w: string): boolean {
  if (kind === 'sh') return /^-[A-Za-z]*c[A-Za-z]*$/.test(w); // -c, -lc, -ec
  if (kind === 'cmd') return /^\/[ck]$/i.test(w);
  return /^-(?:c|co|com|comm|comma|comman|command)$/i.test(w); // PowerShell accepts any prefix of -Command
}
/** Flags of each shell that take the next word as their value (`sh -o pipefail -c`, `powershell -ExecutionPolicy Bypass -Command`). */
const VALUE_FLAG: Record<ShellKind, RegExp> = {
  sh: /^(?:[-+][oO]|--rcfile|--init-file)$/, // `-o pipefail`, `-O extglob` (bash shopt)
  cmd: /^$/,
  ps: /^-(?:executionpolicy|ep|ex|windowstyle|w|workingdirectory|wd|configurationname|settingsfile|inputformat|if|outputformat|of|version|v)$/i,
};

/** Where each wrapper's payload starts: a shell word, up to 8 flag words, then its command flag. One R1 pass over the text. */
function findWrappers(s: string): Array<{ kind: ShellKind; start: number }> {
  const { words, seps } = shellWords(s);
  const pos: number[] = [];
  let p = seps[0].length;
  for (let i = 0; i < words.length; i++) { pos.push(p); p += words[i].length + seps[i + 1].length; }
  const found: Array<{ kind: ShellKind; start: number }> = [];
  for (let i = 0; i < words.length; i++) {
    const kind = shellKind(words[i]);
    if (!kind) continue;
    for (let j = i + 1; j < words.length && j <= i + 9; j++) {
      const w = words[j];
      if (isCommandFlag(kind, w)) {
        const k = kind === 'sh' && words[j + 1] === '--' ? j + 2 : j + 1; // `bash -c -- "..."`: `--` ends the options, the script follows
        if (k < words.length) found.push({ kind, start: pos[k] });
        break;
      }
      if (!/^[-+/]/.test(w)) break;
      if (VALUE_FLAG[kind].test(w)) j++;
    }
  }
  return found;
}

type Decoded = { value: string; end: number; quote: string };
/** POSIX: one word from `i` (`\x` outside quotes, `'...'` literal, `"..."` with `\"`, `\\`, `\$`, `` \` ``). Undefined when a quote does not close. */
function decodeSh(s: string, i: number): Decoded | undefined {
  const n = s.length;
  const out: string[] = [];
  let j = i;
  while (j < n) {
    const c = s[j];
    if (/\s/.test(c) || c === ';' || c === '&' || c === '|') break;
    if (c === '\\') { if (j + 1 < n) { if (s[j + 1] !== '\n') out.push(s[j + 1]); j += 2; } else { out.push(c); j++; } continue; }
    if (c === "'") { const k = s.indexOf("'", j + 1); if (k < 0) return undefined; out.push(s.slice(j + 1, k)); j = k + 1; continue; }
    if (c === '"') {
      j++;
      let closed = false;
      while (j < n) {
        const e = s[j];
        if (e === '\\' && j + 1 < n && '"\\$`\n'.includes(s[j + 1])) { if (s[j + 1] !== '\n') out.push(s[j + 1]); j += 2; continue; }
        if (e === '"') { closed = true; j++; break; }
        out.push(e);
        j++;
      }
      if (!closed) return undefined;
      continue;
    }
    out.push(c);
    j++;
  }
  return { value: out.join(''), end: j, quote: s[i] === '"' || s[i] === "'" ? s[i] : '' };
}
/**
 * PowerShell: a word of glued parts from `i` when it starts with a quote (`"..."` with `` `x ``, `""` and the `\"` of the Windows command
 * line; `'...'` with `''`; unquoted parts with `` `x `` and `\"`), up to whitespace; otherwise the unquoted rest of the line. Undefined
 * when a quote does not close.
 */
function decodePs(s: string, i: number): Decoded | undefined {
  const n = s.length;
  const out: string[] = [];
  const quote = s[i] === '"' || s[i] === "'" ? s[i] : '';
  let j = i;
  while (j < n) {
    const c = s[j];
    if (quote && /\s/.test(c)) break;
    if (c === '"' || c === "'") {
      j++;
      let closed = false;
      while (j < n) {
        const e = s[j];
        if (c === '"' && (e === '`' || (e === '\\' && s[j + 1] === '"')) && j + 1 < n) { out.push(s[j + 1]); j += 2; continue; }
        if (e === c) {
          if (s[j + 1] === c) { out.push(c); j += 2; continue; }
          closed = true;
          j++;
          break;
        }
        out.push(e);
        j++;
      }
      if (!closed) return undefined;
      continue;
    }
    if ((c === '`' || (c === '\\' && s[j + 1] === '"')) && j + 1 < n) { out.push(s[j + 1]); j += 2; continue; }
    out.push(c);
    j++;
  }
  return { value: out.join(''), end: j, quote };
}
/** cmd: the rest of the line; one outer pair of quotes is removed, then `^x` and the `\"` of the program's command line. */
function decodeCmd(s: string, i: number): Decoded {
  const rest = s.slice(i);
  const quoted = rest.length >= 2 && rest[0] === '"' && rest[rest.length - 1] === '"';
  const inner = quoted ? rest.slice(1, -1) : rest;
  // `^x` is cmd's escape; a run of backslashes before `"` is halved (the program's command line: 2n+1 backslashes and `"` are n and a quote)
  // a whole backslash run is matched at once (with or without its `"`), so a long run without a quote is not retried from each position
  const value = inner.replace(/\^([\s\S])|(\\+)("?)/g, (_m, x?: string, b?: string, q?: string) => x ?? (q ? '\\'.repeat((b ?? '').length >> 1) + '"' : (b ?? '')));
  return { value, end: s.length, quote: quoted ? '"' : '' };
}
/** The masked payload written back in the quoting it came in (display only; `$` and `` ` `` stay as they are in sh). */
function encodePayload(kind: ShellKind, v: string, d: Decoded, raw: string): string {
  if (kind === 'sh') {
    if (d.quote === "'") return shQuote(v, true);
    if (d.quote === '"') return '"' + v.replace(/[\\"]/g, '\\$&') + '"'; // every backslash and quote escaped: each reads back as one char
    return v.replace(/[\s"'\\;&|<>()]/g, '\\$&');
  }
  if (kind === 'ps') {
    if (d.quote === "'") return "'" + v.replace(/'/g, "''") + "'";
    return d.quote + v.replace(/[`"]|\\$/g, '`$&') + d.quote; // a last backslash too, or with the closing quote it reads as `\"`
  }
  // the program's command line: the backslashes right before a `"` are doubled, then the quote is escaped (decodeCmd halves them back)
  // whole backslash runs again (linear): a run before a `"` is doubled, a run without one is kept, a bare `"` becomes `\"`
  const body = raw.includes('\\"') ? v.replace(/(\\+)("?)|"/g, (_m, b?: string, q?: string) => (b === undefined ? '\\"' : q ? b + b + '\\"' : b)) : v.replace(/"/g, '^"');
  return d.quote ? `"${body}"` : body;
}
const HAS_ESC: Record<ShellKind, RegExp> = { sh: /\\/, cmd: /\^|\\"/, ps: /`|""|\\"|''/ };

/** A segment between wrappers, masked by `plain` with its outer whitespace kept. */
function maskSegment(seg: string, plain: (x: string) => string): string {
  let a = 0;
  let b = seg.length;
  while (a < b && /\s/.test(seg[a])) a++;
  while (b > a && /\s/.test(seg[b - 1])) b--;
  return a === b ? seg : seg.slice(0, a) + plain(seg.slice(a, b)) + seg.slice(b);
}

/**
 * The text with each shell wrapper's payload unescaped one level, masked and written back; undefined when no wrapper's payload holds an
 * escape (the caller then uses its usual rules, unchanged). `plain` masks the text around the payloads.
 */
function maskScriptText(s0: string, d: number, env: Env | undefined, plain: (x: string) => string): string | undefined {
  if (!SCRIPT_GATE.test(s0)) return undefined;
  // the escaped-pair rule, made for raw escaped text, runs first on the text as it is (`{\\"token\\":\\"x\\"}` inside `sh -c "..."`
  // decodes to `{\token\:\x\}`, where no rule sees a pair any more); it keeps the escape runs, so the decode below still works.
  // Not `redact()` or the scheme rule here: their value class takes a backslash (`Bearer x\"` would lose its `\` and break the quoting)
  const s = maskEscapedPairs(s0);
  const ws = findWrappers(s);
  if (!ws.length) return undefined;
  // only when some payload may hold an escape: a cmd or PowerShell payload runs to the end of the text, so the first one decides; a sh
  // payload is one word (each scanned once, words do not overlap)
  // A cmd or PowerShell payload runs to the end, so a later one of the same kind is inside it: each kind is tested once, at its first
  // payload (at most two scans); a nested wrapper of the other kind (`cmd /c powershell -Command "..."`) is still looked at.
  let esc = false;
  const tested = new Set<ShellKind>();
  for (const w of ws) {
    if (w.kind !== 'sh') {
      if (tested.has(w.kind)) continue;
      tested.add(w.kind);
      if (HAS_ESC[w.kind].test(s.slice(w.start))) { esc = true; break; }
      continue;
    }
    const dec = decodeSh(s, w.start);
    if (!dec || HAS_ESC.sh.test(s.slice(w.start, dec.end))) { esc = true; break; }
  }
  if (!esc) return undefined;
  let out = '';
  let cur = 0;
  for (const w of ws) {
    if (w.start < cur) continue; // inside a payload already handled
    out += maskSegment(s.slice(cur, w.start), plain);
    if (wrapActive >= WRAP_MAX) return out + MASK; // deeper than WRAP_MAX decodes: the payload is masked whole, to the end
    const dec = w.kind === 'sh' ? decodeSh(s, w.start) : w.kind === 'ps' ? decodePs(s, w.start) : decodeCmd(s, w.start);
    if (!dec) return out + MASK; // a quote that does not close: masked to the end of the payload (fail closed)
    const raw = s.slice(w.start, dec.end);
    let inner: string;
    wrapActive++;
    try { inner = maskShellScript(w.kind, dec.value, Math.max(d - 1, 0), env); } finally { wrapActive--; }
    out += inner === dec.value ? raw : encodePayload(w.kind, inner, dec, raw);
    cur = dec.end;
  }
  return out + maskSegment(s.slice(cur), plain);
}

/** Escapes inside a script a shell runs (no outer quotes): sh `\x`, PowerShell `` `x ``, cmd `^x` and the program's `\"`. */
const SCRIPT_ESC: Record<ShellKind, RegExp> = { sh: /\\/, ps: /`/, cmd: /\^|\\"/ };

/**
 * A script that a shell of `kind` runs (the decoded payload of a wrapper, or the arg after `sh -c` / `cmd /c` / `powershell -Command`
 * in an args list). Without an escape of that shell it is masked by the usual rules; with one it is unescaped one level first (sh word
 * by word, each changed word written back in its own quoting; PowerShell and cmd as a whole, shown unescaped when anything changed).
 * Past `WRAP_MAX` decodes it is masked whole.
 */
function maskShellScript(kind: ShellKind, script: string, d: number, env: Env | undefined): string {
  if (!SCRIPT_ESC[kind].test(script)) return redact(maskText(script, d, env), env);
  if (wrapActive >= WRAP_MAX) return MASK;
  wrapActive++;
  try {
    if (kind === 'sh') return maskShWords(maskEscapedPairs(script), d, env); // escaped pairs first, on the raw text (see maskScriptText)
    const dec = kind === 'ps' ? script.replace(/`([\s\S])/g, '$1') : script.replace(/\^([\s\S])|\\"/g, (_m, x?: string) => x ?? '"');
    const inner = redact(maskText(dec, Math.max(d - 1, 0), env), env);
    return inner === dec ? script : inner;
  } finally { wrapActive--; }
}

/** A sh script word by word (`decodeSh`), masked as an args list; a word the rules changed is written back in its own quoting. A quote that does not close masks the rest. */
function maskShWords(s: string, d: number, env: Env | undefined): string {
  const spans: Array<{ start: number; dec: Decoded }> = [];
  const n = s.length;
  let i = 0;
  let failAt = -1;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (';&|'.includes(c)) { let j = i; while (j < n && ';&|'.includes(s[j])) j++; spans.push({ start: i, dec: { value: s.slice(i, j), end: j, quote: '' } }); i = j; continue; }
    const dec = decodeSh(s, i);
    if (!dec) { failAt = i; break; }
    if (dec.end <= i) { i++; continue; }
    spans.push({ start: i, dec });
    i = dec.end;
  }
  const masked = maskArgs(spans.map((x) => x.dec.value), snapshot(env), Math.max(d - 1, 0));
  let out = '';
  let cur = 0;
  spans.forEach((x, k) => {
    const m = redact(masked[k], env);
    out += s.slice(cur, x.start) + (m === x.dec.value ? s.slice(x.start, x.dec.end) : encodePayload('sh', m, x.dec, ''));
    cur = x.dec.end;
  });
  return failAt < 0 ? out + s.slice(cur) : out + s.slice(cur, failAt) + MASK;
}

// ---- R12 (spec 041 FR-053, T072, issue #502): PowerShell hashtable literals `@{ Name = Value; ... }` ----
const HT_LITERAL_MAX = 4000; // a literal is read up to this many characters from its `@{`; past that the rest up to its `}` is hidden
const WORD_END = /[\s;}]/g;

/** The index of the quote that closes the string opened at `p` (`""` / `''` doubled, and `` `x `` in a double-quoted one, are escapes), or -1 before `max`. */
function htCloseQuote(s: string, p: number, max: number): number {
  const q = s[p];
  for (let k = p + 1; k < max; k++) {
    if (q === '"' && s[k] === '`') k++;
    else if (s[k] === q) { if (s[k + 1] === q) k++; else return k; }
  }
  return -1;
}

/** Fast character tests for the scanner below (ASCII first; a regex only for the rest of Unicode white space). */
const htWs = (c: string): boolean => { const k = c.charCodeAt(0); return k < 128 ? k === 32 || (k >= 9 && k <= 13) : /\s/.test(c); };
const htWordStop = (c: string): boolean => c === ';' || c === '}' || htWs(c);
const htNameStop = (c: string): boolean => c === '=' || c === '"' || c === "'" || c === '{' || htWordStop(c);

/** The name test for a member name (`secretFlag` after the quote marks are removed), remembered for the short names a literal repeats (bounded). */
const HT_NAMES = new Map<string, boolean>();
function htSecretName(raw: string): boolean {
  if (raw.length > 64) return secretFlag(raw.replace(/[`"']/g, ''));
  let r = HT_NAMES.get(raw);
  if (r === undefined) {
    r = secretFlag(raw.replace(/[`"']/g, ''));
    if (HT_NAMES.size >= 512) HT_NAMES.clear();
    HT_NAMES.set(raw, r);
  }
  return r;
}

/** Where a PowerShell expression that starts at `p` ends: the next `;`, `}` or line break outside brackets and strings (a backtick continues the line). Never past `max`. */
function htExprEnd(s: string, p: number, max: number): number {
  let d = 0;
  let k = p;
  while (k < max) {
    const c = s[k];
    if (c === '"' || c === "'") { const e = htCloseQuote(s, k, max); if (e < 0) return max; k = e + 1; continue; }
    if (c === '`') { k += s[k + 1] === '\r' && s[k + 2] === '\n' ? 3 : 2; continue; }
    if (c === '(' || c === '{') d++;
    else if (c === ')') { if (d > 0) d--; }
    else if (c === '}') { if (d === 0) break; d--; }
    else if ((c === ';' || c === '\n') && d === 0) break;
    k++;
  }
  k = Math.min(k, max);
  while (k > p && /\s/.test(s[k - 1])) k--;
  return k;
}

/** Where the literal that is open at `p` (with `depth` levels open) ends: the index of its closing `}`, or the end of the text. Quote-aware, one pass. */
function htLitEnd(s: string, p: number, depth: number): number {
  const n = s.length;
  for (let k = p; k < n; k++) {
    const c = s[k];
    if (c === '"' || c === "'") { const e = htCloseQuote(s, k, n); if (e < 0) return n; k = e; }
    else if (c === '`') k++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth <= 0) return k;
  }
  return n;
}

/**
 * The value ranges to hide in the hashtable literals of `s`: for each member whose name looks secret (`secretFlag`, the test of R7 and the
 * secret flags) the value, without its quotes when it is one plain quoted string or bare word. Any other value of a secret member (an
 * expression, a here-string, a string followed by more code) is hidden whole up to the member's end (fail closed). A member whose value
 * is a nested literal restarts the scan inside it (any depth). `<#...#>` is white space (an unclosed one hides the rest of the literal).
 * A literal is read up to HT_LITERAL_MAX characters; past that everything up to its closing `}` (or the end of the text) is hidden. One
 * pass: every character is read a constant number of times, so the cost is linear in the text. `\"` counts as a quote (the args form).
 */
function hashtableRanges(s: string): Array<[number, number]> {
  if (!s.includes('\\"')) return htRanges(s);
  const r = htRanges(s.replace(/\\+"/g, (m) => ' '.repeat(m.length - 1) + '"')); // same length: backslashes then a quote are spaces and a quote
  const out: Array<[number, number]> = [];
  for (const [a, b] of r) { let b2 = b; if (s[b] === '"') while (b2 > a && s[b2 - 1] === '\\') b2--; if (b2 > a) out.push([a, b2]); }
  return out;
}
function htRanges(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = s.length;
  const hide = (from2: number, to: number): void => {
    if (to <= from2) return;
    const last = out[out.length - 1];
    if (last && last[1] === from2) last[1] = to; else out.push([from2, to]);
  };
  const toEnd = (q: number): boolean => { // after a value ending at q: only spaces then `;`, `}`, a line break or the end
    while (q < n && (s[q] === ' ' || s[q] === '\t')) q++;
    return q >= n || s[q] === ';' || s[q] === '}' || s[q] === '\n' || s[q] === '\r';
  };
  let from = 0;
  let depth = 1;
  let limit = 0;
  let sp = 0; // the last token boundary (outside any quote) and the bracket depth there: where the past-the-bound scan starts
  let sd = 1;
  const hsAt = [-2, -2]; // cached here-string closer position per kind ('@ and "@), -1 = none after the scan point
  let ld = -2; // the last `"` and the last `'`, found once (linear)
  let ls = -2;
  const lastDq = (): number => (ld === -2 ? (ld = s.lastIndexOf('"')) : ld);
  const lastSq = (): number => (ls === -2 ? (ls = s.lastIndexOf("'")) : ls);
  let cmAt = -2; // cached `#>` position
  const skipSp = (p0: number): number => { // the gap between a name, `=` and a value: white space (line breaks too) and block comments; a comment with an `=` in it is hidden (it may be a commented-out member)
    let p = p0;
    for (;;) {
      const ch = s[p];
      if (ch === undefined) return p;
      if (htWs(ch)) p++;
      else if (ch === '<' && s[p + 1] === '#') {
        if (cmAt === -2 || (cmAt >= 0 && cmAt < p + 2)) cmAt = s.indexOf('#>', p + 2);
        if (cmAt < 0) p += 2; // never closes: only the mark is white space, the text behind it is read as code
        else { let eq = false; for (let k = p + 2; k < cmAt && !eq; k++) eq = s[k] === '='; if (eq) hide(p + 2, cmAt); p = cmAt + 2; } // (read once: the comment is passed)
      }
      else if (ch === '#' && s[p + 1] === '>') p += 2;
      else return p;
    }
  };
  for (;;) {
    const at = s.indexOf('@{', from);
    if (at < 0) return out;
    limit = Math.min(n, at + HT_LITERAL_MAX);
    let p = at + 2;
    depth = 1;
    sp = p;
    sd = depth;
    while (p < limit && depth > 0) {
      sp = p;
      sd = depth;
      const c = s[p];
      if (c === '}') { p++; depth--; continue; }
      if (c === ';' || htWs(c)) { p++; continue; }
      if ((c === '<' && s[p + 1] === '#') || (c === '#' && s[p + 1] === '>')) { p += 2; continue; } // block comment marks are white space; the inside is read as code
      if (c === '@' && s[p + 1] === '{') { p += 2; depth++; continue; }
      const mEnd = limit;
      let ns: number;
      let ne: number;
      if (c === '"' || c === "'") {
        const e = htCloseQuote(s, p, mEnd);
        if (e < 0) { p++; continue; } // a stray quote: the text behind it is read as it is
        ns = p + 1; ne = e; p = e + 1;
      } else {
        ns = p;
        while (p < mEnd && !htNameStop(s[p])) p++;
        ne = p;
        if (ne === ns) { p++; continue; }
      }
      p = skipSp(p);
      if (s[p] !== '=' || p >= mEnd) { if ((c === '"' || c === "'") && s.indexOf(c, ns) >= ne) p = ns; continue; } // not `Name = Value`: a bare word is passed, a quoted one with no doubled quote in it is read again from inside (its quotes may be the stray ones; reading a doubled-quote run again would be quadratic)
      p = skipSp(p + 1);
      const secret = htSecretName(s.slice(ns, ne)); // `"api""key"` is the name api"key: the quote marks go before the test
      if (s.startsWith('[ordered]', p)) p += 9;
      while (s[p] === '`' && (s[p + 1] === '\n' || (s[p + 1] === '\r' && s[p + 2] === '\n'))) { // a line continuation right after `=`
        p += s[p + 1] === '\n' ? 2 : 3;
        while (p < mEnd && (s[p] === ' ' || s[p] === '\t')) p++;
      }
      const vc = s[p];
      if (vc === '@' && s[p + 1] === '{' && !secret) { p += 2; depth++; continue; } // a nested literal: scanned in place
      if (vc === '@' && (s[p + 1] === "'" || s[p + 1] === '"')) { // here-string: up to its closing `'@` / `"@` at a line start
        const hq = s[p + 1] === "'" ? 0 : 1; // the closer is searched once per kind, then reused: a text of `@'` openers with no closer stays linear
        if (hsAt[hq] === -2 || (hsAt[hq] >= 0 && hsAt[hq] < p + 2)) hsAt[hq] = s.indexOf('\n' + s[p + 1] + '@', p + 2); // (positions only grow, so -1 stays -1)
        const close = hsAt[hq];
        const end = close < 0 || close + 3 > limit ? limit : close + 3;
        if (secret) hide(p, end);
        p = Math.max(end, p + 2); // (always forward, whatever the cache holds)
        continue;
      }
      if (vc === '"' || vc === "'") {
        const e = htCloseQuote(s, p, mEnd);
        if (e < 0) { // unclosed: a secret's rest is hidden (fail closed); to the end of the text when no such quote follows at all, else to the literal bound
          const none = (vc === '"' ? lastDq() : lastSq()) <= p;
          if (secret) hide(p + 1, none ? n : mEnd);
          p = none ? n : mEnd;
          continue;
        }
        if (!secret) { p = e + 1; continue; }
        const hidden = e - p === MASK.length + 1 && s.startsWith(MASK, p + 1); // a value hidden already: said again it must give the same text; more after it is code
        if (toEnd(e + 1)) { if (!hidden) hide(p + 1, e); p = e + 1; continue; }
        const end = htExprEnd(s, p, mEnd); // a string followed by more code
        hide(p, end);
        p = Math.max(end, e + 1);
        continue;
      }
      const vs = p;
      while (p < mEnd && !htWordStop(s[p])) p++;
      if (secret && p >= mEnd && p < n) { // a bare word longer than the literal bound: hidden to its end (fail closed), found in one pass
        WORD_END.lastIndex = p;
        p = WORD_END.exec(s)?.index ?? n;
        hide(vs, p);
        continue;
      }
      if (!secret) continue;
      const hidden = p - vs === MASK.length && s.startsWith(MASK, vs);
      if (toEnd(p) && !/[({]/.test(s.slice(vs, p))) { if (!hidden) hide(vs, p); continue; } // a bare word with brackets (`(Get-Secret)`, `@{a=1}`) is an expression
      const end = htExprEnd(s, vs, mEnd);
      hide(vs, end);
      p = Math.max(end, p);
    }
    if (depth > 0 && p >= limit && limit < n) { // past the literal bound: the rest up to the literal's end is hidden (fail closed)
      const e = htLitEnd(s, sp, sd); // from the last token boundary: the bound may fall inside a string
      if (e > p) {
        if (!(s.startsWith(MASK, p) && /^[\s"';]*$/.test(s.slice(p + MASK.length, e)))) hide(p, e); // (an earlier [redacted] and its closers stay as they are)
        p = e;
      }
    }
    from = Math.max(at + 2, p);
  }
}

/** `s` with the value of each secret-looking hashtable member shown as `[redacted]` (R12), quotes kept. */
function maskHashtables(s: string): string {
  if (!s.includes('@{')) return s;
  const r = hashtableRanges(s);
  if (!r.length) return s;
  let out = '';
  let cur = 0;
  for (const [a, b] of r) { out += s.slice(cur, a) + MASK; cur = b; }
  return out + s.slice(cur);
}

/** Reads `a` from `from` and says whether every literal opened so far is closed at its end: `{` and `}` count outside quotes only (`st` carries the state to the next arg). Linear. */
function htClosed(a: string, from: number, st: { depth: number; q: string }): boolean {
  for (let k = from; k < a.length; k++) {
    const c = a[k];
    if (st.q) {
      if (c === '`' && st.q === '"') k++;
      else if (c === st.q) st.q = ''; // a doubled quote closes and opens again
    } else if (c === '"' || c === "'") st.q = c;
    else if (c === '{') st.depth++;
    else if (c === '}' && st.depth > 0) st.depth--;
  }
  return st.depth === 0 && st.q === '';
}

/** R12 for an args list: a literal split across args (`@{token=`, `SEC;`, `port=8080}`) is read as the args joined by a space; a value that spans args is hidden in the first and cut from the later ones. */
function maskHashtableArgs(args: readonly string[]): readonly string[] {
  if (!Array.isArray(args) || !args.some((a) => typeof a === 'string' && a.includes('@{'))) return args;
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (typeof a !== 'string' || !a.includes('@{')) { out.push(a); i++; continue; }
    let j = i;
    const st = { depth: 0, q: '' }; // brackets outside quotes, across the args: a `}` inside quotes does not close the literal
    let closed = htClosed(a, a.indexOf('@{'), st);
    while (!closed && j + 1 < args.length && typeof args[j + 1] === 'string') { // (no length bound: a literal that is still open past the bound has its later args hidden)
      j++;
      closed = htClosed(args[j], 0, st);
    }
    const group = args.slice(i, j + 1) as string[];
    const joined = group.join(' ');
    const ranges = hashtableRanges(joined);
    if (!ranges.length) { out.push(...group); i = j + 1; continue; }
    let off = 0;
    for (const g of group) {
      const end = off + g.length;
      let t = '';
      let cur = off;
      for (const [r0, r1] of ranges) {
        if (r1 <= off || r0 >= end) continue;
        t += joined.slice(cur, Math.max(r0, off, cur));
        if (r0 >= off) t += MASK; // the range starts here; in a later arg only its tail is cut
        cur = Math.min(r1, end);
      }
      t += joined.slice(cur, end);
      if (t !== '' || g === '') out.push(t);
      off = end + 1;
    }
    i = j + 1;
  }
  return out;
}

/** A free-standing value or arg: JSON, URL, connection string (`;`/`,`-separated pairs), `NAME=value`, `Name: value`, a shell string. The caller finishes with `redact()`. */
function maskText(v: string, depth: number, env?: Env, noScript = false): string {
  if (!noScript && SCRIPT_GATE.test(v) && /\s/.test(v)) { // T067 (#447): a shell wrapper whose payload has escaped quotes, decoded one level first
    const sc = maskScriptText(v, depth, env, (seg) => maskText(seg, depth, env, true));
    if (sc !== undefined) return sc;
  }
  if (v.includes('@{')) v = maskHashtables(v); // R12
  // T067: a leading quote that closes nowhere in the value (`--opt="token=x`) is set aside, so the rules see what is behind it (fail closed)
  if ((v[0] === '"' || v[0] === "'") && v.indexOf(v[0], 1) < 0) return v[0] + maskText(v.slice(1), depth, env, noScript);
  if (v.startsWith('{') || v.startsWith('[')) {
    const e = v.trimEnd();
    const j = e.endsWith('}') || e.endsWith(']') ? maskJson(v, env, false, depth) : undefined; // parse only what can be JSON
    if (j !== undefined) return j;
    const p = maskJsonPairs(v); // not valid JSON: the pairs by pattern, then what is left of it split on whitespace only (quotes cannot be trusted in broken JSON), once
    return depth > 0 ? (/\s/.test(p.trim()) ? maskShellString(p, depth - 1, env, true) : p) : /\s|["']/.test(p.trim()) ? MASK : p;
  }
  if (v.startsWith('-') || v.startsWith('/')) { // a flag-shaped value (`A=--token=x`, `{"a":"--api-key=x"}`) uses one level of the budget
    const f = parseFlag(v);
    if (f) {
      if (depth > 0) return maskArgs([v], snapshot(env), depth - 1)[0];
      if (f.rest) return MASK; // budget spent
    }
  }
  const t = v.includes('://') ? maskSecretUrl(v, env) : v; // a URL anywhere in the text, not only at its start
  if (URL_SHAPE.test(t)) return t;
  const h = HDR.exec(t); // R4: the header shape first, before the `;` / `,` split
  if (h && h[2] !== '' && secretFlag(h[1])) return `${h[1]}: ${MASK}`;
  const r = PAIR_SPLIT.test(t) ? t.split(PAIR_SPLIT).map((p, i) => (i % 2 ? p : maskKv(p, depth, env))).join('') : maskKv(t, depth, env);
  if (depth > 0) return /\s/.test(r.trim()) ? maskShellString(r, depth - 1, env) : r; // R3
  return /\s|["']/.test(r.trim()) ? MASK : r; // budget spent and another pass would be needed: masked whole, never shown
}

/** `Name: value` after a header flag: the value is masked whatever the name (FR-012: no header values). */
function maskHeaderValue(v: string, env: Env | undefined, d: number): string {
  if (v.startsWith('{') || v.startsWith('[')) return redact(maskJson(v, env, true, d) ?? maskJsonPairs(v, true), env); // JSON headers: every value, whatever the key
  const h = HDR.exec(v);
  if (h && !URL_SHAPE.test(v)) return `${h[1]}: ${MASK}`;
  const kv = KV.exec(v);
  if (kv && !v.includes('://')) return `${kv[1]}${kv[2]}=${MASK}`; // `Name=value` form
  return redact(maskText(v, d, env), env);
}

/**
 * One word as a POSIX shell reads it, for display only (spec 041 T067, spec 061 T057: the one display-quoting helper). A word of only
 * safe characters is shown bare unless `always`; anything else (whitespace, shell characters, empty) goes in single quotes, a `'` inside
 * written `'\''`. Used by the folder setup list (`foldersetup.ts`) and by the shell-wrapper payload written back here.
 */
export function shQuote(w: string, always = false): string {
  return !always && /^[A-Za-z0-9_@%+=:,./~^-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`;
}

/** R2: an arg that starts and ends with the same quote: its inside and the quote. */
function unquote(a: string): [string, string] {
  const q = a[0];
  return a.length >= 2 && (q === '"' || q === "'") && a[a.length - 1] === q ? [a.slice(1, -1), q] : [a, ''];
}

/**
 * Command-line arguments for display (spec 041 FR-053): the value of a secret-looking flag (next arg, or the rest of the same arg after
 * the first `=`, `:` or space), header values after a header flag, `NAME=value` and `Name: value` pieces, JSON, connection strings,
 * URL-shaped values and shell strings (an arg with spaces is masked word by word, to `MAX_DEPTH` levels) are masked, a whole-quoted arg on
 * its inside, and everything goes through `redact()`. Never throws; returns a new array of the same length.
 */
export function maskSecretArgs(args: readonly string[], envIn?: Env): string[] {
  return maskArgsImpl(args, envIn, true);
}
function maskArgsImpl(args: readonly string[], envIn: Env | undefined, cap: boolean): string[] {
  return maskArgs((cap && Array.isArray(args) ? args.map(capped) : args) as string[], snapshot(envIn), MAX_DEPTH, true);
}

function maskArgs(args0: readonly string[], env: Env, d: number, top = false, ht = true): string[] {
  const args = ht ? maskHashtableArgs(args0) : args0; // R12 (not for the words of a text that maskText already read whole: the `;` that ended a member is not in them)
  const rd = (x: string): string => (top ? redact(x, env) : x); // a nested call is redacted by the outer one, over the whole arg
  const out: string[] = [];
  let pending: 'secret' | 'header' | undefined;
  // T067: `sh -c <script>`, `cmd /c <script>`, `powershell -Command <script>` as separate args. A sh script is the one arg after `-c`;
  // cmd and PowerShell join every arg after their flag into the script, so each of those args keeps that shell's escapes: it is
  // unescaped one level and then goes through the rules below with the others (a `-H` before it still counts); shown as it was when
  // the rules change nothing.
  let wrapKind: ShellKind | undefined; // a shell word seen, its command flag not yet
  let wrapSeen = 0;
  let wrapValue = false; // the arg is the value of a flag of that shell (`-ExecutionPolicy Bypass`)
  let scriptKind: ShellKind | undefined; // sh: the next arg is the script
  let joinKind: ShellKind | undefined; // cmd, PowerShell: every later arg is part of the script
  let fix: { i: number; dec: string; raw: string } | undefined;
  const unfix = (): void => { if (fix && out[fix.i] === fix.dec) out[fix.i] = fix.raw; fix = undefined; };
  for (const raw of Array.isArray(args) ? args : []) {
    unfix();
    try {
      let a0 = typeof raw === 'string' ? raw : String(raw ?? '');
      const sk = scriptKind;
      scriptKind = undefined;
      if (sk === 'sh' && a0 === '--') { scriptKind = 'sh'; out.push(a0); continue; } // `bash -c -- <script>`
      if (wrapKind) {
        if (wrapValue) { wrapValue = false; }
        else if (isCommandFlag(wrapKind, a0)) { if (wrapKind === 'sh') scriptKind = 'sh'; else joinKind = wrapKind; wrapKind = undefined; }
        else if (/^[-+/]/.test(a0) && ++wrapSeen <= 9) { wrapValue = VALUE_FLAG[wrapKind].test(a0); }
        else wrapKind = undefined;
      } else if ((wrapKind = shellKind(a0))) { wrapSeen = 0; wrapValue = false; } // also inside a cmd script (`cmd /c powershell -Command ...`)
      if (sk && !pending && SCRIPT_ESC.sh.test(a0)) { out.push(rd(maskShellScript('sh', a0, d, env))); continue; }
      if (joinKind && (joinKind === 'ps' ? /`|''|""/ : SCRIPT_ESC.cmd).test(a0)) {
        const pd = joinKind === 'ps' ? decodePs(a0, 0) : undefined; // PowerShell: a quoted word (`'a ''b'''`) or the arg with `` `x `` removed
        const dec = joinKind === 'ps' ? (pd && pd.end === a0.length ? pd.value : a0.replace(/`([\s\S])/g, '$1')) : a0.replace(/\^([\s\S])|\\"/g, (_m, x?: string) => x ?? '"');
        fix = { i: out.length, dec, raw: a0 };
        a0 = dec;
      }
      // T067 (#447): a leading quote with no closing quote in the arg (`"--token=x`, `"X-Api-Key:` from a naive split) is set aside, so the
      // flag, `Name:` or `NAME=` behind it is seen and the rest of the arg is masked by the rules (fail closed); it is put back in front
      const lead = (a0[0] === '"' || a0[0] === "'") && a0.indexOf(a0[0], 1) < 0 ? a0[0] : '';
      if (lead) a0 = a0.slice(1);
      const push = (x: string): void => { out.push(lead && x !== MASK ? lead + x : x); };
      const [a, q] = unquote(a0);
      const W = (x: string): string => (q && (x !== MASK || a === MASK) ? q + x + q : x); // R12: a value already hidden inside its quotes keeps them
      const f = a.startsWith('-') || a.startsWith('/') ? parseFlag(a) : undefined;
      if (pending && !LONG_FLAG.test(a) && (pending === 'secret' || !a.startsWith('-'))) {
        if (pending === 'header' && HDR_NAME_ONLY.test(a)) { push(W(a)); pending = 'secret'; continue; } // R5: `Name:` then its value as the next arg
        if (SCHEME.test(a.trim()) || (pending === 'header' && schemeHeader(a))) { push(W(a)); pending = 'secret'; continue; } // R11 a/b: the scheme word stays, the next arg is the secret
        if (pending === 'header' && schemeHeader(a, true)) { push(W(maskHeaderValue(a, env, d))); pending = 'secret'; continue; } // R11 after a header flag: any name (FR-012: header values are masked whatever the name)
        push(pending === 'secret' ? MASK : W(maskHeaderValue(a, env, d)));
        pending = undefined;
        continue;
      }
      pending = undefined;
      if (!f && ((top ? /^(?:bearer|basic)$/i : /^Bearer$/).test(a.trim()) || schemeHeader(a))) { push(W(a)); pending = 'secret'; continue; } // R11 c (`Basic` and a lowercase `bearer` only at top level: in prose, `Basic setup` must stay) and b
      if (!f) {
        const hn = HDR_NAME_ONLY.exec(a);
        if (hn && secretFlag(hn[1])) { push(W(a)); pending = 'secret'; continue; } // R5
      }
      if (f) {
        const secret = secretFlag(f.name);
        if (f.rest === undefined) {
          pending = secret ? 'secret' : HEADER_FLAGS.has(f.name.toLowerCase()) ? 'header' : undefined;
          push(W(rd(a)));
        } else if (secret) {
          if (SCHEME.test(f.rest.trim())) { push(W(a)); pending = 'secret'; continue; } // R11 a: `--auth=Bearer` and then the secret as its own arg
          push(`${f.name}${f.sep}${MASK}`);
          if (f.rest === '') pending = 'secret'; // `--token=` and then the value as its own arg
        }
        else if (HEADER_FLAGS.has(f.name.toLowerCase())) {
          push(W(`${f.name}${f.sep}${maskHeaderValue(f.rest, env, d)}`));
          if (schemeHeader(f.rest, true) || HDR_NAME_ONLY.test(f.rest.replace(/^["']/, ''))) pending = 'secret'; // R11 b: `--header=Authorization: Bearer`, and R5 (T067): `--header="X-Api-Key:`, then the secret
        }
        else { const [rv, rq] = unquote(f.rest); push(W(`${f.name}${f.sep}${rq}${rd(maskText(rv, d, env))}${rq}`)); } // a whole-quoted value (`--env="API_TOKEN=x"`) is masked on its inside, like a top-level arg (R2); same depth as that path
        continue;
      }
      {
        // `OPTS=\"--token` (a secret flag with no value, as the value of NAME=): the next word is its value
        const kvm = KV.exec(a.replace(/^[\\"'`]+/, ''));
        const inner = kvm ? kvm[4].replace(/^[\\"'`]+/, '') : '';
        const f2 = inner.startsWith('-') || inner.startsWith('/') ? parseFlag(inner) : undefined;
        if (f2 && f2.rest === undefined && secretFlag(f2.name) && !secretFlag(kvm![2].replace(ENV_PREFIX, ''))) pending = 'secret';
        const hv = kvm ? HDR_NAME_ONLY.exec(inner.trim()) : null;
        if (hv && secretFlag(hv[1])) pending = 'secret'; // `NAME=Name:` then its value as the next arg (R5)
      }
      push(W(rd(maskText(a, d, env))));
    } catch {
      out.push(MASK);
    }
  }
  unfix();
  return out;
}

/**
 * Splits a command string into words for display (`shellWords`, R1): whitespace outside `"..."` and `'...'` separates words, and a quoted span
 * stays in its word with its quotes. Not parsed here (`[KNOWN GAP]`): backslash, backtick and `^` escapes (`maskSecretCommand` unescapes a
 * shell wrapper's payload first, T067), `$(...)`, heredocs. A drive or UNC
 * path (`C:\Program Files\nodejs\node.exe`) is one token: it ends at the first whitespace-separated chunk that has no `\` or `/` (or has `=`,
 * or starts with `-`, `/`, `\` or a drive); the rest is split as above.
 */
export function splitCommand(command: unknown): string[] {
  const s = (typeof command === 'string' ? command : '').trim();
  if (!s) return [];
  const chunks = shellWords(s).words;
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(s)) return chunks;
  // Drive or UNC path: one token up to the first space, and each following chunk joins it only when it still looks like the rest of
  // the path (it contains a `\` or `/`, and does not start with `-`, `/`, `\` or a drive). `serve`, `s.js` and `token=x` end the path.
  let end = 1;
  while (end < chunks.length && /[\\/]/.test(chunks[end]) && !chunks[end].includes('=') && !/^(?:[-/\\]|[A-Za-z]:[\\/])/.test(chunks[end])) end++;
  return [chunks.slice(0, end).join(' '), ...chunks.slice(end)];
}

/**
 * Words of a command where the first word that opens a quote closing nowhere later starts one last word that runs to the end (T067: an
 * unclosed quote makes the rest one argument, so it is masked as one; R1 alone kept it a literal and `srv "--token x more` showed `more`).
 */
function joinUnclosed(w: string[]): string[] {
  let laterDq = false;
  let laterSq = false;
  let at = -1;
  for (let i = w.length - 1; i >= 0; i--) {
    const x = w[i];
    if ((x[0] === '"' && !laterDq && x.indexOf('"', 1) < 0) || (x[0] === "'" && !laterSq && x.indexOf("'", 1) < 0)) at = i;
    if (x.includes('"')) laterDq = true;
    if (x.includes("'")) laterSq = true;
  }
  return at < 0 ? w : [...w.slice(0, at), w.slice(at).join(' ')];
}

/**
 * A command for display: `redact()` on the raw text first (R8: `Authorization: Bearer x` and `Bearer x` side by side), split like
 * `splitCommand`, masked like `maskSecretArgs`, joined with one space. T067: the payload of a shell wrapper (`sh -c`, `cmd /c`,
 * `powershell -Command`) with escaped quotes is unescaped one level and masked before the split. `mapWord` (the read tools' path reducer)
 * runs on each masked word outside such a payload. Never throws.
 */
export function maskSecretCommand(command: unknown, envIn?: Env, mapWord?: (word: string) => string): string {
  return maskCommandImpl(command, envIn, true, mapWord);
}
function maskCommandImpl(command: unknown, envIn: Env | undefined, cap: boolean, mapWord?: (word: string) => string): string {
  try {
    if (cap && typeof command === 'string' && command.length > MASK_INPUT_MAX) return MASK;
    const env = snapshot(envIn);
    const plain = (c: string): string => {
      const out = maskArgs(joinUnclosed(splitCommand(redact(maskSchemeSecrets(maskHashtables(c)), env))), env, MAX_DEPTH, true);
      return (mapWord ? out.map((x) => mapWord(x)) : out).join(' ');
    };
    const c = typeof command === 'string' ? command : '';
    return maskScriptText(c, MAX_DEPTH, env, plain) ?? plain(c);
  } catch { return '[redaction failed]'; }
}

/**
 * TEST ONLY (scripts/test-redact.ts): the same rules as the public functions without the `MASK_INPUT_MAX` cap, so the
 * linearity and cost rows measure the rule path and not the cap. Nothing under `src/` may use it.
 */
export const _uncappedForTest = {
  maskSecretArgs: (args: readonly string[], envIn?: Env): string[] => maskArgsImpl(args, envIn, false),
  maskSecretCommand: (command: unknown, envIn?: Env): string => maskCommandImpl(command, envIn, false),
  /** A wrapper payload written back by `encodePayload` and read again by that shell's decoder (T067: it must read back the same). */
  payloadRoundTrip: (kind: ShellKind, quote: string, v: string, raw = ''): string | undefined => {
    const enc = encodePayload(kind, v, { value: v, end: 0, quote }, raw);
    return (kind === 'sh' ? decodeSh(enc, 0) : kind === 'cmd' ? decodeCmd(enc, 0) : decodePs(enc, 0))?.value;
  },
};

/**
 * OAuth query and fragment values that are secrets although their names do not look like one (review on PR #630): an authorization
 * `code`, the `state` that pairs with it, and the tokens a redirect can carry. Only in a URL's query or fragment, never as flags.
 */
const OAUTH_PARAMS = new Set(['code', 'state', 'id_token', 'refresh_token', 'access_token', 'code_verifier', 'client_secret']);
const oauthParam = (name: string): boolean => {
  let n = name;
  if (n.includes('%')) { try { n = decodeURIComponent(n); } catch { /* keep the raw name */ } }
  return OAUTH_PARAMS.has(n.toLowerCase());
};

/**
 * Home folders in free text become `~` (review on PR #630: a copied error must not carry the user name): `/home/<user>`,
 * `/Users/<user>`, `<drive>:\Users\<user>` (also with `/` or doubled `\\` as in JSON), and the given home folders themselves
 * (`HOME`, `USERPROFILE` of this process by default). A user name with spaces is covered when a separator follows it. Bounded; never throws.
 */
export function maskHomePaths(text: unknown, homes?: readonly (string | undefined)[]): string {
  try {
    let s = typeof text === 'string' ? text : text == null ? '' : String(text);
    const env = (globalThis as { process?: { env?: Env } }).process?.env ?? {};
    const list = (homes ?? [env.HOME, env.USERPROFILE]).filter((h): h is string => typeof h === 'string' && h.replace(/[\\/]+$/, '').length >= 4);
    for (const h of [...new Set(list.map((x) => x.replace(/[\\/]+$/, '')))].sort((a, b) => b.length - a.length)) {
      // only a whole folder: `/home/vik` is not the start of `/home/vikram`
      for (const v of new Set([h, JSON.stringify(h).slice(1, -1)])) s = s.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`(?![^\\/\s"'<>|:;,*?])`, 'g'), '~');
    }
    return s.replace(/(?<![A-Za-z0-9_.~-])(?:\/(?:home|Users)\/|[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/))(?:[^\\/\r\n"'<>|:;,*?]{1,128}(?=[\\/])|[^\\/\s"'<>|:;,*?]{1,128})/g, '~');
  } catch {
    return '[redaction failed]';
  }
}

/**
 * A URL for display (FR-053): everything between `://` and the last `@` of the authority becomes `[redacted]` (with or without a colon),
 * query and fragment values with a secret-looking name (percent-decoded) are masked, and the known path secrets (Telegram bot token,
 * Slack and Discord webhooks) too; then `redact()`. Other path secrets are not detected (`[KNOWN GAP]`).
 */
export function maskSecretUrl(url: unknown, envIn?: Env): string {
  const env = snapshot(envIn);
  let s = typeof url === 'string' ? url : '';
  s = s.replace(/([a-z][a-z0-9+.-]{1,20}:\/\/)[^/?#\s]{0,2000}@/gi, '$1' + MASK + '@');
  s = s.replace(/([?&;#])([^=&;#?\s]{1,100})=([^&;#\s]*)/g, (m, sep: string, name: string) => (secretFlag(name) || oauthParam(name) ? `${sep}${name}=${MASK}` : m));
  s = s.replace(/(\/bot\d{1,20}:)[^/?#\s]+/gi, '$1' + MASK);
  s = s.replace(/(hooks\.slack\.com\/services\/[^/?#\s]+\/[^/?#\s]+\/)[^/?#\s]+/gi, '$1' + MASK);
  s = s.replace(/(\/api(?:\/v\d{1,3})?\/webhooks\/[^/?#\s]+\/)[^/?#\s]+/gi, '$1' + MASK);
  return redact(s, env);
}

/**
 * The one debug-log sink (`DURBAR_LOG`): every record is JSON-encoded, redacted once, then appended as one line.
 * A record over the cap is written as `{"truncated":true,"head":"..."}`, so the file stays valid JSONL.
 * `append` and `env` are injected so tests need no Electron or real log file.
 */
export function createDebugSink(file: string, env: Env, append: (file: string, data: string) => void): (record: unknown) => void {
  return (record) => {
    let line: string;
    try { line = JSON.stringify(record) ?? 'null'; } catch { line = '"[unserializable]"'; }
    const over = line.length > REDACT_MAX_CHARS;
    const safe = redact(line, env);
    append(file, (over ? JSON.stringify({ truncated: true, head: safe }) : safe) + '\n');
  };
}

// ---- Notes (spec 083 FR-005, issue 699) ----

/** Characters that can sit inside a token without being part of it: emphasis, code, strike, link brackets, a Markdown escape's backslash, zero-width characters. */
const NOTE_MARK = /[*`~[\]\\​-‍﻿]/;
const NOTE_ESCAPABLE = '\\`*_{}[]()#+-.!~|<>';
const NOTE_RUN = /[A-Za-z0-9_\-.+/=:@%]{12,}/g;

/** `s` without its split marks, and for each kept character its index in `s` (plus a final entry, `s.length`). */
function withoutMarks(s: string): { k: string; at: number[] } {
  const keep: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (i + 1 < s.length && NOTE_ESCAPABLE.includes(s[i + 1])) { keep.push(s[i + 1]); at.push(i + 1); i++; }
      else { keep.push(c); at.push(i); } // a Windows path's backslash is a character
      continue;
    }
    if (NOTE_MARK.test(c)) continue;
    keep.push(c);
    at.push(i);
  }
  at.push(s.length);
  return { k: keep.join(''), at };
}

/** Replace each [a, b) span of `s` (in `s` coordinates, overlapping ones joined) with the mask. */
function maskSpans(s: string, spans: Array<[number, number]>): string {
  if (!spans.length) return s;
  spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  let out = '';
  let pos = 0;
  let cur: [number, number] | undefined;
  const flush = (): void => { if (cur) { out += s.slice(pos, cur[0]) + MASK; pos = cur[1]; } };
  for (const sp of spans) {
    if (cur && sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]);
    else { flush(); cur = [sp[0], sp[1]]; }
  }
  flush();
  return out + s.slice(pos);
}

/** The first and last character of `k` that `r` (its masked copy) changed, line by line when the line count is kept (else for the whole text). */
function changedRegions(k: string, r: string): Array<[number, number]> {
  const diff = (a: string, b: string, base: number): [number, number] | undefined => {
    if (a === b) return undefined;
    let p = 0;
    const max = Math.min(a.length, b.length);
    while (p < max && a[p] === b[p]) p++;
    let q = 0;
    while (q < max - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    let from = p;
    let to = a.length - q;
    if (to <= from) { if (from > 0) from--; else to = Math.min(a.length, from + 1); } // only inserted text: take a neighbouring character
    return [base + from, base + to];
  };
  const ka = k.split('\n');
  const ra = r.split('\n');
  if (ka.length !== ra.length) { const d = diff(k, r, 0); return d ? [d] : []; }
  const out: Array<[number, number]> = [];
  let base = 0;
  for (let i = 0; i < ka.length; i++) {
    const d = diff(ka[i], ra[i], base);
    if (d) out.push(d);
    base += ka[i].length + 1;
  }
  return out;
}

/**
 * Masks what a mark hides: a secret split by `**`, a backtick, `~`, a bracket or a Markdown escape. Works on the text without marks and
 * maps each find back to the text as written, so the Markdown around it stays. `find` gives the spans (in `k` coordinates) to mask.
 */
function maskAcrossMarks(s: string, find: (k: string, at: number[], u: string) => Array<[number, number]>): string {
  if (!NOTE_MARK.test(s)) return s;
  const { k, at } = withoutMarks(s);
  const spans: Array<[number, number]> = [];
  for (const [a, b] of find(k, at, s)) if (b > a) spans.push([at[a], at[b - 1] + 1]);
  return maskSpans(s, spans);
}

/**
 * Spec 083 FR-005 (D3): the one mask every note passes before it is stored, keeping the Markdown as written. In this order:
 * (1) the known secret values (the folder's and the session's; under 4 characters skipped, longest first), also when marks split them;
 * (2) every token-like run, or region, that `redact` only finds once the Markdown marks are removed (a token split by `**` or a backtick,
 * or glued to the word before it), judged on the text as written, before `redact` can mask a head and leave its tail; (3) `redact`
 * (env secrets and token shapes) on the whole text. Mask first, cut after (the caller): a secret across
 * the cut would leave a head. `changed` says whether anything was masked (the note's `hidden`). Linear: one pass per step.
 */
export function maskNoteText(text: unknown, values: readonly string[] = []): { text: string; changed: boolean } {
  const original = typeof text === 'string' ? text : text == null ? '' : String(text);
  let s = original;
  const vals = [...new Set(values.filter((v) => typeof v === 'string' && v.length >= 4))].sort((a, b) => b.length - a.length);
  for (const v of vals) if (s.includes(v)) s = s.split(v).join(MASK);
  if (vals.length) {
    s = maskAcrossMarks(s, (k) => {
      const out: Array<[number, number]> = [];
      for (const v of vals) for (let i = k.indexOf(v); i >= 0; i = k.indexOf(v, i + v.length)) out.push([i, i + v.length]);
      return out;
    });
  }
  s = maskAcrossMarks(s, (k, at, u) => {
    const out: Array<[number, number]> = [];
    // a run of `u` (marks are not run characters) that `redact` changes on its own, with the token characters glued after it across marks
    const kIndex = new Map<number, number>();
    at.forEach((uIdx, kIdx) => kIndex.set(uIdx, kIdx));
    const seen = new Map<string, boolean>();
    for (const m of u.matchAll(NOTE_RUN)) {
      const i = m.index ?? 0;
      const touches = (i > 0 && NOTE_MARK.test(u[i - 1])) || (i + m[0].length < u.length && NOTE_MARK.test(u[i + m[0].length]));
      if (!touches) continue;
      let hit = seen.get(m[0]);
      if (hit === undefined) { hit = redact(m[0]) !== m[0]; seen.set(m[0], hit); }
      if (!hit) continue;
      const a = kIndex.get(i);
      const lastK = kIndex.get(i + m[0].length - 1);
      if (a === undefined || lastK === undefined) continue;
      let b = lastK + 1;
      while (b < k.length && /[A-Za-z0-9_-]/.test(k[b])) b++;
      out.push([a, b]);
    }
    // whatever `redact` finds in the text without marks that it did not find in the text as written
    out.push(...changedRegions(k, redact(k)));
    return out;
  });
  s = redact(s);
  return { text: s, changed: s !== original };
}
