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
const KV = /^(\s*)([A-Za-z_][A-Za-z0-9_.-]{0,127})(\s*=)([\s\S]*)$/;
/** The next arg after a secret flag stays a flag (not its value) only when it has the shape of a long flag: `--name`, `--name=..`. */
const LONG_FLAG = /^--[A-Za-z][A-Za-z0-9_.-]*(?:[=:\s]|$)/;
/** `Bearer x` / `Basic x` as a whole arg: the word and exactly one token (so `Basic setup of the server` stays). */
const BEARER = /^(bearer|basic)(\s+)\S+\s*$/i;
const HDR = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127}):\s*([\s\S]*)$/;
const MAX_DEPTH = 4;

function maskJsonValue(v: unknown, force: boolean, depth: number, env?: Env): unknown {
  if (depth > 32) return MASK;
  if (Array.isArray(v)) {
    // an array of strings is an args list (`["--token","x"]`)
    if (v.length > 0 && v.every((x) => typeof x === 'string')) return force ? v.map(() => MASK) : maskSecretArgs(v as string[], env);
    return v.map((x) => maskJsonValue(x, force, depth + 1, env));
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = maskJsonValue(x, force || secretFlag(k), depth + 1, env);
    return out;
  }
  if (typeof v === 'string') return force ? MASK : maskText(v, MAX_DEPTH, env);
  if (typeof v === 'number') return force ? MASK : v;
  return v;
}

/** Valid JSON: every string or number under a secret-looking key, at any depth, is masked; written back compactly. */
function maskJson(v: string, env?: Env, force = false): string | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(v); } catch { return undefined; }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  return JSON.stringify(maskJsonValue(parsed, force, 0, env));
}

/** Text that is not valid JSON: `"name": "value"` pairs with a secret-looking name, by pattern. */
function maskJsonPairs(v: string, force = false): string {
  return v.replace(/"([^"\\]{1,100})"(\s{0,8}:\s{0,8})("(?:[^"\\]|\\.){0,2000}"?|[^\s,}\]"]{1,2000})/g, (m, name: string, colon: string, val: string) => {
    if (!force && !secretFlag(name)) return m;
    return `"${name}"${colon}${val.startsWith('"') ? `"${MASK}"` : MASK}`;
  });
}

/** One `NAME=value` or `Name: value` piece: masked when the name looks secret; otherwise its value is masked recursively (a URL, JSON). */
function maskKv(part: string, depth: number, env?: Env): string {
  const kv = KV.exec(part);
  if (kv) return secretFlag(kv[2]) ? `${kv[1]}${kv[2]}=${MASK}` : depth > 0 ? `${kv[1]}${kv[2]}${kv[3]}${maskText(kv[4], depth - 1, env)}` : part;
  const h = HDR.exec(part);
  if (h && !URL_SHAPE.test(part)) return secretFlag(h[1]) ? `${h[1]}: ${MASK}` : part;
  const b = BEARER.exec(part);
  return b ? `${b[1]}${b[2]}${MASK}` : part;
}

/** A free-standing value or arg: JSON, URL, connection string (`;`-separated pairs), `NAME=value`, `Name: value`. The caller finishes with `redact()`. */
function maskText(v: string, depth: number, env?: Env): string {
  if (v.startsWith('{') || v.startsWith('[')) return maskJson(v, env) ?? maskJsonPairs(v);
  const t = v.includes('://') ? maskSecretUrl(v, env) : v; // a URL anywhere in the text, not only at its start
  if (URL_SHAPE.test(t)) return t;
  if (t.includes(';')) return t.split(';').map((p) => maskKv(p, depth, env)).join(';');
  return maskKv(t, depth, env);
}

/** `Name: value` after a header flag: the value is masked whatever the name (FR-012: no header values). */
function maskHeaderValue(v: string, env?: Env): string {
  if (v.startsWith('{') || v.startsWith('[')) return redact(maskJson(v, env, true) ?? maskJsonPairs(v, true), env); // JSON headers: every value, whatever the key
  const h = HDR.exec(v);
  if (h && !URL_SHAPE.test(v)) return `${h[1]}: ${MASK}`;
  const kv = KV.exec(v);
  if (kv && !v.includes('://')) return `${kv[1]}${kv[2]}=${MASK}`; // `Name=value` form
  return redact(maskText(v, MAX_DEPTH, env), env);
}

/**
 * Command-line arguments for display (spec 041 FR-053): the value of a secret-looking flag (next arg, or the rest of the same arg after
 * the first `=`, `:` or space), header values after a header flag, `NAME=value` and `Name: value` pieces, JSON, connection strings and
 * URL-shaped values are masked, and everything goes through `redact()`. Never throws; returns a new array of the same length.
 */
export function maskSecretArgs(args: readonly string[], envIn?: Env): string[] {
  const env = snapshot(envIn);
  const out: string[] = [];
  let pending: 'secret' | 'header' | undefined;
  for (const raw of Array.isArray(args) ? args : []) {
    try {
      const a = typeof raw === 'string' ? raw : String(raw ?? '');
      const f = a.startsWith('-') || a.startsWith('/') ? parseFlag(a) : undefined;
      if (pending && !LONG_FLAG.test(a) && (pending === 'secret' || !a.startsWith('-'))) {
        out.push(pending === 'secret' ? MASK : maskHeaderValue(a, env));
        pending = undefined;
        continue;
      }
      pending = undefined;
      if (f) {
        const secret = secretFlag(f.name);
        if (f.rest === undefined) {
          pending = secret ? 'secret' : HEADER_FLAGS.has(f.name.toLowerCase()) ? 'header' : undefined;
          out.push(redact(a, env));
        } else if (secret) {
          out.push(`${f.name}${f.sep}${MASK}`);
          if (f.rest === '') pending = 'secret'; // `--token=` and then the value as its own arg
        }
        else if (HEADER_FLAGS.has(f.name.toLowerCase())) out.push(`${f.name}${f.sep}${maskHeaderValue(f.rest, env)}`);
        else out.push(`${f.name}${f.sep}${redact(maskText(f.rest, MAX_DEPTH, env), env)}`);
        continue;
      }
      out.push(redact(maskText(a, MAX_DEPTH, env), env));
    } catch {
      out.push(MASK);
    }
  }
  return out;
}

/**
 * Splits a command string into tokens for display. A drive or UNC path (`C:\Program Files\nodejs\node.exe`) is one token: it ends at
 * the first whitespace-separated chunk that has no `\` or `/` (or has `=`, or starts with `-`, `/`, `\` or a drive); the rest is split on whitespace. Shell quoting is not parsed (`[KNOWN GAP]`).
 */
export function splitCommand(command: unknown): string[] {
  const s = (typeof command === 'string' ? command : '').trim();
  if (!s) return [];
  const chunks = s.split(/\s+/);
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(s)) return chunks;
  // Drive or UNC path: one token up to the first space, and each following chunk joins it only when it still looks like the rest of
  // the path (it contains a `\` or `/`, and does not start with `-`, `/`, `\` or a drive). `serve`, `s.js` and `token=x` end the path.
  let end = 1;
  while (end < chunks.length && /[\\/]/.test(chunks[end]) && !chunks[end].includes('=') && !/^(?:[-/\\]|[A-Za-z]:[\\/])/.test(chunks[end])) end++;
  return [s.split(/\s+/).slice(0, end).join(' '), ...chunks.slice(end)];
}

/** A command for display: split like `splitCommand`, masked like `maskSecretArgs`, joined with one space. Never throws. */
export function maskSecretCommand(command: unknown, env?: Env): string {
  try { return maskSecretArgs(splitCommand(command), env).join(' '); } catch { return '[redaction failed]'; }
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
