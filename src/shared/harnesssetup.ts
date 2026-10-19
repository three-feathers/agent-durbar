/**
 * Harness setup inside the app (spec 051): what Durbar may run to install, update or sign in to a harness, and how it reads the
 * vendor's sign-in output. Pure data and functions, no I/O: `src/main/harnesssetup.ts` runs the plans.
 *
 * Every command here is fixed (argv, no shell). Durbar never pipes a downloaded script into a shell (D1): without a package
 * manager it opens the vendor's page instead. Routes come from the vendors' docs (2026-10-19); see the spec for which were tried.
 */

export type SetupKind = 'claude' | 'codex' | 'copilot';
export type PackageManager = 'winget' | 'brew' | 'npm';

/** One way to install or update: the package manager's binary name and its fixed arguments. */
export interface SetupPlan {
  manager: PackageManager;
  /** Binary name looked up on PATH (`winget`, `brew`, `npm`). */
  bin: PackageManager;
  args: string[];
  /** Shown before it runs (FR-004): exactly what will run. */
  display: string;
  /** A short note shown with the plan (admin rights, deprecation). */
  note?: string;
}

interface Route {
  manager: PackageManager;
  install: string[];
  update: string[];
  note?: string;
}

// spec 051 FR-004b: from the winget community source only, never another configured source that might carry the same id
const WINGET_AGREE = ['--source', 'winget', '--accept-source-agreements', '--accept-package-agreements'];
const npm = (pkg: string): Pick<Route, 'manager' | 'install' | 'update'> => ({ manager: 'npm', install: ['install', '-g', pkg], update: ['install', '-g', `${pkg}@latest`] });

/** FR-002: routes per harness and OS, in the order they are offered. */
const ROUTES: Record<SetupKind, Partial<Record<'win32' | 'darwin' | 'linux', Route[]>>> = {
  claude: {
    win32: [
      { manager: 'winget', install: ['install', '--id', 'Anthropic.ClaudeCode', '-e', ...WINGET_AGREE], update: ['upgrade', '--id', 'Anthropic.ClaudeCode', '-e', ...WINGET_AGREE], note: 'Windows may ask for permission to install.' },
      { ...npm('@anthropic-ai/claude-code'), note: 'Deprecated by Anthropic: use it only if nothing else works.' },
    ],
    darwin: [
      { manager: 'brew', install: ['install', '--cask', 'claude-code'], update: ['upgrade', '--cask', 'claude-code'] },
      { ...npm('@anthropic-ai/claude-code'), note: 'Deprecated by Anthropic: use it only if nothing else works.' },
    ],
    linux: [
      { manager: 'brew', install: ['install', '--cask', 'claude-code'], update: ['upgrade', '--cask', 'claude-code'] },
      { ...npm('@anthropic-ai/claude-code'), note: 'Deprecated by Anthropic: use it only if nothing else works.' },
    ],
  },
  copilot: {
    win32: [
      { manager: 'winget', install: ['install', '--id', 'GitHub.Copilot', '-e', ...WINGET_AGREE], update: ['upgrade', '--id', 'GitHub.Copilot', '-e', ...WINGET_AGREE], note: 'Windows may ask for permission to install.' },
      { ...npm('@github/copilot'), note: 'Needs Node.js 22 or later.' },
    ],
    darwin: [{ manager: 'brew', install: ['install', '--cask', 'copilot-cli'], update: ['upgrade', '--cask', 'copilot-cli'] }, { ...npm('@github/copilot'), note: 'Needs Node.js 22 or later.' }],
    linux: [{ manager: 'brew', install: ['install', '--cask', 'copilot-cli'], update: ['upgrade', '--cask', 'copilot-cli'] }, { ...npm('@github/copilot'), note: 'Needs Node.js 22 or later.' }],
  },
  codex: {
    win32: [{ ...npm('@openai/codex'), note: 'Codex on Windows is experimental (OpenAI suggests WSL).' }],
    darwin: [{ manager: 'brew', install: ['install', '--cask', 'codex'], update: ['upgrade', '--cask', 'codex'] }, npm('@openai/codex')],
    linux: [npm('@openai/codex')],
  },
};

/** FR-003: the vendor's own install page, opened when no package manager is found. */
export const OFFICIAL_PAGES: Record<SetupKind, string> = {
  claude: 'https://code.claude.com/docs/en/setup',
  copilot: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
  codex: 'https://github.com/openai/codex',
};

/** What the user installs for each harness (Copilot: the CLI, needed only to sign in; FR-006). */
export const SETUP_NAMES: Record<SetupKind, string> = { claude: 'Claude Code', codex: 'the Codex CLI', copilot: 'the GitHub Copilot CLI' };

const osOf = (platform: string): 'win32' | 'darwin' | 'linux' | undefined => (platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : undefined);

function plansFor(kind: SetupKind, platform: string, found: ReadonlySet<PackageManager>, op: 'install' | 'update'): SetupPlan[] {
  const os = osOf(platform);
  const routes = (os && ROUTES[kind]?.[os]) || [];
  return routes
    .filter((r) => found.has(r.manager))
    .map((r) => {
      const args = op === 'install' ? r.install : r.update;
      return { manager: r.manager, bin: r.manager, args: [...args], display: [r.manager, ...args].join(' '), ...(r.note ? { note: r.note } : {}) };
    });
}

/** FR-002: install routes for this OS whose package manager was found, in order (the first is preselected). */
export const installPlans = (kind: SetupKind, platform: string, found: ReadonlySet<PackageManager>): SetupPlan[] => plansFor(kind, platform, found, 'install');
/** FR-002: the same managers, upgrading. */
export const updatePlans = (kind: SetupKind, platform: string, found: ReadonlySet<PackageManager>): SetupPlan[] => plansFor(kind, platform, found, 'update');

/** Package managers worth looking for on this OS. */
export const managersFor = (platform: string): PackageManager[] => (platform === 'win32' ? ['winget', 'npm'] : ['brew', 'npm']);

/** FR-005: the harness's own sign-in command (run with the found binary) and how the user finishes it. */
export interface SignInPlan {
  /** The binary to find (`copilot` is the Copilot CLI, not Durbar's runtime). */
  bin: 'claude' | 'codex' | 'copilot';
  args: string[];
  /** `device`: open a link and type the code shown; `paste`: open a link, then paste the code the page shows. */
  mode: 'device' | 'paste';
}

export const SIGN_IN: Record<SetupKind, SignInPlan> = {
  codex: { bin: 'codex', args: ['login', '--device-auth'], mode: 'device' },
  copilot: { bin: 'copilot', args: ['login', '--device-code'], mode: 'device' },
  claude: { bin: 'claude', args: ['auth', 'login'], mode: 'paste' },
};

/** FR-005: the hosts each harness signs in on; a link anywhere else is never shown or opened. */
const SIGN_IN_HOSTS: Record<SetupKind, readonly string[]> = {
  codex: ['auth.openai.com'],
  copilot: ['github.com'],
  claude: ['claude.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com'],
};

/** ANSI colour and cursor sequences, removed before any parsing or display. */
export function stripAnsi(s: string): string {
  return String(s ?? '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/\r(?!\n)/g, '\n');
}

/** True when `url` is https on one of the harness's own sign-in hosts (exact host, or a subdomain of a listed one). */
export function allowedSignInUrl(kind: SetupKind, url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  return (SIGN_IN_HOSTS[kind] ?? []).some((a) => h === a || h.endsWith('.' + a));
}

export interface SignInView {
  url?: string;
  code?: string;
  /** Claude asked for the code from the sign-in page. */
  needsPaste: boolean;
}

const CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/;

/** FR-005: the first allowed link, the first one-time code outside that link, and whether Claude waits for a pasted code. */
export function parseSignIn(kind: SetupKind, raw: string): SignInView {
  const text = stripAnsi(raw);
  const url = (text.match(/https:\/\/[^\s"'<>`]+/g) ?? []).map((u) => u.replace(/[).,;]+$/, '')).find((u) => allowedSignInUrl(kind, u));
  const rest = url ? text.split(url).join(' ') : text;
  const code = SIGN_IN[kind].mode === 'device' ? CODE.exec(rest)?.[0] : undefined;
  return { ...(url ? { url } : {}), ...(code ? { code } : {}), needsPaste: SIGN_IN[kind].mode === 'paste' && /paste (the )?code/i.test(text) };
}

/** FR-005: what may be written to Claude's sign-in: 1-512 printable characters, no line breaks or control characters. */
export function validPaste(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!t || t.length > 512 || /[\u0000-\u001f\u007f]/.test(t)) return undefined;
  return t;
}

/** The last `n` non-empty lines of output, ANSI removed, each cut to 200 characters (the caller also passes them through `redact()`). */
export function lastLines(raw: string, n = 6): string[] {
  return stripAnsi(raw).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n).map((l) => (l.length > 200 ? l.slice(0, 199) + '…' : l));
}

export const isSetupKind = (k: unknown): k is SetupKind => k === 'claude' || k === 'codex' || k === 'copilot';
