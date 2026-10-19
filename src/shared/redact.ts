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
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  while (end > 0 && TOKEN_CHAR.test(s[end - 1])) end--;
  return s.slice(0, end) + TRUNCATED;
}

/** Replace secret environment values and key-like strings. Never throws; keeps line structure. */
export function redact(text: unknown, env?: Env): string {
  try {
    let s = typeof text === 'string' ? text : text == null ? '' : String(text);
    const e: Env = env ?? (globalThis as { process?: { env?: Env } }).process?.env ?? {};
    // Replace first, then cut: a secret straddling the cut is already gone.
    for (const [name, value] of envSecrets(e)) {
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
/** A flag name that looks secret: contains token/secret/password/apikey/credential, or has a `key`, `pass` or `auth` word (`--api-key`, `--access_token`, `--auth`). */
function secretFlag(flag: string): boolean {
  const n = flag.replace(/^-+/, '').toLowerCase();
  if (!n) return false;
  return /token|secret|passw|apikey|credential/.test(n) || n.split(/[-_.]/).some((w) => w === 'key' || w === 'pass' || w === 'auth' || w === 'authorization');
}

/**
 * Command-line arguments for display (spec 041 FR-053): the value after a secret-looking flag (`--token abc`, `--api-key=abc`) is
 * masked, then every argument goes through `redact()`. Never throws; returns a new array of the same length.
 */
export function maskSecretArgs(args: readonly string[], env?: Env): string[] {
  const out: string[] = [];
  let maskNext = false;
  for (const raw of Array.isArray(args) ? args : []) {
    const a = typeof raw === 'string' ? raw : String(raw ?? '');
    if (maskNext) {
      maskNext = false;
      if (!a.startsWith('-')) { out.push(MASK); continue; }
    }
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        out.push(secretFlag(a.slice(0, eq)) ? `${a.slice(0, eq)}=${MASK}` : redact(a, env));
        continue;
      }
      maskNext = secretFlag(a);
    }
    out.push(redact(a, env));
  }
  return out;
}

/** A URL for display: `redact()` (user:password@ and key-like shapes) plus the value of any query parameter whose name looks secret. */
export function maskSecretUrl(url: unknown, env?: Env): string {
  const s = typeof url === 'string' ? url : '';
  const masked = s.replace(/([?&;#])([^=&;#?\s]{1,100})=([^&;#\s]*)/g, (m, sep: string, name: string) => (secretFlag(name) ? `${sep}${name}=${MASK}` : m));
  return redact(masked, env);
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
