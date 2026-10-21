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

/** Key-like shapes. Each is linear: bounded classes, no nested quantifiers, starts anchored where a token cannot already be running. Order matters: header and URL first. */
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(authorization\s{0,8}[:=]\s{0,8})(?:(?:bearer|basic|token)\s{1,8})?[^\s",;]+/gi, '$1[redacted]'],
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/:@"]{1,200}:[^\s/@"]{1,200}@/gi, '$1[redacted]@'],
  [/(?<![A-Za-z0-9_-])tid=[0-9a-f]{8,64};[^\s"]{0,2000}/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  [/\bBearer\s{1,8}[A-Za-z0-9._~+/=-]{8,}/g, '[redacted]'],
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}/g, '[redacted]'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted]'],
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
  return s.slice(0, end).replace(/[ \t]+$/, '') + TRUNCATED;
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
    return s;
  } catch {
    return '[redaction failed]';
  }
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
    if (secretFlag(kv[2].replace(ENV_PREFIX, ''))) return `${kv[1]}${kv[2]}=${MASK}`;
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
 * inside the word with its quotes; an unmatched quote is a literal. No escapes, `$(...)` or heredocs (`[KNOWN GAP]`). `seps` has one more
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
  const masked = maskArgs(cores, snapshot(env), depth);
  idx.forEach((wi, k) => { outWords[wi] = leads[wi] + masked[k] + tails[wi]; });
  let out = seps[0];
  for (let i = 0; i < outWords.length; i++) out += outWords[i] + seps[i + 1];
  return out;
}

/** A free-standing value or arg: JSON, URL, connection string (`;`/`,`-separated pairs), `NAME=value`, `Name: value`, a shell string. The caller finishes with `redact()`. */
function maskText(v: string, depth: number, env?: Env): string {
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
  return maskArgs((Array.isArray(args) ? args.map(capped) : args) as string[], snapshot(envIn), MAX_DEPTH, true);
}

function maskArgs(args: readonly string[], env: Env, d: number, top = false): string[] {
  const rd = (x: string): string => (top ? redact(x, env) : x); // a nested call is redacted by the outer one, over the whole arg
  const out: string[] = [];
  let pending: 'secret' | 'header' | undefined;
  for (const raw of Array.isArray(args) ? args : []) {
    try {
      const a0 = typeof raw === 'string' ? raw : String(raw ?? '');
      const [a, q] = unquote(a0);
      const W = (x: string): string => (q && x !== MASK ? q + x + q : x);
      const f = a.startsWith('-') || a.startsWith('/') ? parseFlag(a) : undefined;
      if (pending && !LONG_FLAG.test(a) && (pending === 'secret' || !a.startsWith('-'))) {
        if (pending === 'header' && HDR_NAME_ONLY.test(a)) { out.push(W(a)); pending = 'secret'; continue; } // R5: `Name:` then its value as the next arg
        if (SCHEME.test(a.trim()) || (pending === 'header' && schemeHeader(a))) { out.push(W(a)); pending = 'secret'; continue; } // R11 a/b: the scheme word stays, the next arg is the secret
        if (pending === 'header' && schemeHeader(a, true)) { out.push(W(maskHeaderValue(a, env, d))); pending = 'secret'; continue; } // R11 after a header flag: any name (FR-012: header values are masked whatever the name)
        out.push(pending === 'secret' ? MASK : W(maskHeaderValue(a, env, d)));
        pending = undefined;
        continue;
      }
      pending = undefined;
      if (!f && ((top ? /^(?:bearer|basic)$/i : /^Bearer$/).test(a.trim()) || schemeHeader(a))) { out.push(W(a)); pending = 'secret'; continue; } // R11 c (`Basic` and a lowercase `bearer` only at top level: in prose, `Basic setup` must stay) and b
      if (!f) {
        const hn = HDR_NAME_ONLY.exec(a);
        if (hn && secretFlag(hn[1])) { out.push(W(a)); pending = 'secret'; continue; } // R5
      }
      if (f) {
        const secret = secretFlag(f.name);
        if (f.rest === undefined) {
          pending = secret ? 'secret' : HEADER_FLAGS.has(f.name.toLowerCase()) ? 'header' : undefined;
          out.push(W(rd(a)));
        } else if (secret) {
          if (SCHEME.test(f.rest.trim())) { out.push(W(a)); pending = 'secret'; continue; } // R11 a: `--auth=Bearer` and then the secret as its own arg
          out.push(`${f.name}${f.sep}${MASK}`);
          if (f.rest === '') pending = 'secret'; // `--token=` and then the value as its own arg
        }
        else if (HEADER_FLAGS.has(f.name.toLowerCase())) {
          out.push(W(`${f.name}${f.sep}${maskHeaderValue(f.rest, env, d)}`));
          if (schemeHeader(f.rest, true)) pending = 'secret'; // R11 b: `--header=Authorization: Bearer` and then the secret
        }
        else out.push(W(`${f.name}${f.sep}${rd(maskText(f.rest, d, env))}`));
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
      out.push(W(rd(maskText(a, d, env))));
    } catch {
      out.push(MASK);
    }
  }
  return out;
}

/**
 * Splits a command string into words for display (`shellWords`, R1): whitespace outside `"..."` and `'...'` separates words, and a quoted span
 * stays in its word with its quotes. Not parsed (`[KNOWN GAP]`): backslash, backtick and `^` escapes, `$(...)`, heredocs. A drive or UNC
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

/** A command for display: `redact()` on the raw text first (R8: `Authorization: Bearer x` and `Bearer x` side by side), split like `splitCommand`, masked like `maskSecretArgs`, joined with one space. Never throws. */
export function maskSecretCommand(command: unknown, envIn?: Env): string {
  try {
    if (typeof command === 'string' && command.length > MASK_INPUT_MAX) return MASK;
    const env = snapshot(envIn);
    return maskArgs(splitCommand(redact(maskSchemeSecrets(typeof command === 'string' ? command : ''), env)), env, MAX_DEPTH, true).join(' ');
  } catch { return '[redaction failed]'; }
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
  s = s.replace(/([?&;#])([^=&;#?\s]{1,100})=([^&;#\s]*)/g, (m, sep: string, name: string) => (secretFlag(name) ? `${sep}${name}=${MASK}` : m));
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
