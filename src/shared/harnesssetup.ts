/**
 * Harness setup inside the app (spec 051): what Durbar may run to install, update or sign in to a harness, and how it reads the
 * vendor's sign-in output. Pure data and functions, no I/O: `src/main/harnesssetup.ts` runs the plans.
 *
 * Every command here is fixed (argv, no shell). Durbar never pipes a downloaded script into a shell (D1). Since spec 060 FR-001 it
 * may run a vendor's official installer: main downloads it from that vendor's fixed hosts to a private file, the user confirms, and
 * it runs as `bash <file>` / `powershell -File <file>`. Routes are ordered least privilege first (owner, 2026-10-20).
 */

export type SetupKind = 'claude' | 'codex' | 'copilot';
/** What can be found on this computer: package managers and the interpreters that run an official installer. */
export type PackageManager = 'winget' | 'brew' | 'npm' | 'bash' | 'powershell';
/** A route's kind: a package manager, or the vendor's official installer (spec 060 FR-001). */
export type RouteManager = 'winget' | 'brew' | 'npm' | 'official';

/** Spec 060 FR-001: a vendor's official install script and the only hosts (and, for a shared host, path prefix) it may come from. */
export interface OfficialScript {
  url: string;
  hosts: readonly { host: string; pathPrefix?: string }[];
}

/** One way to install or update: the package manager's binary name and its fixed arguments. */
export interface SetupPlan {
  manager: RouteManager;
  /** Binary name looked up on PATH (`winget`, `brew`, `npm`; `bash`/`powershell` for an official installer). */
  bin: PackageManager;
  /** The official installer this plan downloads and runs (spec 060 FR-001); `args` then end with the downloaded file. */
  script?: OfficialScript;
  args: string[];
  /** Shown before it runs (FR-004): exactly what will run. */
  display: string;
  /** A short note shown with the plan (admin rights, what it needs). */
  note?: string;
}

interface Route {
  manager: RouteManager;
  install: string[];
  update: string[];
  note?: string;
  script?: OfficialScript;
}

// spec 051 FR-004b: from the winget community source only, never another configured source that might carry the same id
const WINGET_AGREE = ['--source', 'winget', '--accept-source-agreements', '--accept-package-agreements'];
const npm = (pkg: string, note?: string): Route => ({ manager: 'npm', install: ['install', '-g', pkg], update: ['install', '-g', `${pkg}@latest`], ...(note ? { note } : {}) });
const MAY_ADMIN = 'May ask for administrator rights.';
const NO_ADMIN = 'Installs into your home folder; no administrator rights needed.';

/** Spec 060 FR-001: the vendors' official scripts and the hosts they redirect to (checked 2026-10-20, research.md). */
const SCRIPTS = {
  claudeSh: { url: 'https://claude.ai/install.sh', hosts: [{ host: 'claude.ai' }, { host: 'downloads.claude.ai' }] },
  claudePs1: { url: 'https://claude.ai/install.ps1', hosts: [{ host: 'claude.ai' }, { host: 'downloads.claude.ai' }] },
  copilotSh: { url: 'https://gh.io/copilot-install', hosts: [{ host: 'gh.io' }, { host: 'raw.githubusercontent.com', pathPrefix: '/github/copilot-cli/' }] },
  codexSh: { url: 'https://chatgpt.com/codex/install.sh', hosts: [{ host: 'chatgpt.com' }, { host: 'releases.openai.com' }] },
  codexPs1: { url: 'https://chatgpt.com/codex/install.ps1', hosts: [{ host: 'chatgpt.com' }, { host: 'releases.openai.com' }] },
} satisfies Record<string, OfficialScript>;
/** The interpreter arguments before the downloaded file (the file is appended by main once it exists). */
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];
const official = (script: OfficialScript, ps: boolean): Route => ({ manager: 'official', script, install: ps ? [...PS_ARGS] : [], update: ps ? [...PS_ARGS] : [], note: NO_ADMIN });
/** Spec 060 (read 2026-10-21, code.claude.com/docs/en/setup): npm is an advanced option, not deprecated; the native installer is "Recommended". */
const CLAUDE_NPM = 'Needs Node.js 22 or later. Anthropic recommends its native installer.';

/** FR-002 and spec 060 FR-001: routes per harness and OS, least privilege first (owner 2026-10-20); Claude's npm route is last (Anthropic lists it under advanced options). */
const ROUTES: Record<SetupKind, Partial<Record<'win32' | 'darwin' | 'linux', Route[]>>> = {
  claude: {
    win32: [
      official(SCRIPTS.claudePs1, true),
      { manager: 'winget', install: ['install', '--id', 'Anthropic.ClaudeCode', '-e', ...WINGET_AGREE], update: ['upgrade', '--id', 'Anthropic.ClaudeCode', '-e', ...WINGET_AGREE], note: MAY_ADMIN },
      npm('@anthropic-ai/claude-code', CLAUDE_NPM),
    ],
    darwin: [official(SCRIPTS.claudeSh, false), { manager: 'brew', install: ['install', '--cask', 'claude-code'], update: ['upgrade', '--cask', 'claude-code'], note: MAY_ADMIN }, npm('@anthropic-ai/claude-code', CLAUDE_NPM)],
    linux: [official(SCRIPTS.claudeSh, false), { manager: 'brew', install: ['install', '--cask', 'claude-code'], update: ['upgrade', '--cask', 'claude-code'], note: MAY_ADMIN }, npm('@anthropic-ai/claude-code', CLAUDE_NPM)],
  },
  copilot: {
    win32: [
      npm('@github/copilot', 'Needs Node.js 22 or later. Installs into your user folder; no administrator rights needed.'),
      // spec 060 FR-012: the route for a PC without Node.js (owner's report 2026-10-21), and the dialog says so
      { manager: 'winget', install: ['install', '--id', 'GitHub.Copilot', '-e', ...WINGET_AGREE], update: ['upgrade', '--id', 'GitHub.Copilot', '-e', ...WINGET_AGREE], note: 'No Node.js needed. ' + MAY_ADMIN },
    ],
    darwin: [official(SCRIPTS.copilotSh, false), npm('@github/copilot', 'Needs Node.js 22 or later.'), { manager: 'brew', install: ['install', '--cask', 'copilot-cli'], update: ['upgrade', '--cask', 'copilot-cli'], note: MAY_ADMIN }],
    linux: [official(SCRIPTS.copilotSh, false), npm('@github/copilot', 'Needs Node.js 22 or later.'), { manager: 'brew', install: ['install', '--cask', 'copilot-cli'], update: ['upgrade', '--cask', 'copilot-cli'], note: MAY_ADMIN }],
  },
  codex: {
    win32: [official(SCRIPTS.codexPs1, true), npm('@openai/codex', 'Codex on Windows is experimental (OpenAI suggests WSL). Installs into your user folder.')],
    darwin: [official(SCRIPTS.codexSh, false), npm('@openai/codex'), { manager: 'brew', install: ['install', '--cask', 'codex'], update: ['upgrade', '--cask', 'codex'], note: MAY_ADMIN }],
    linux: [official(SCRIPTS.codexSh, false), npm('@openai/codex')],
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

/**
 * Spec 060 FR-009: the vendors' own install commands, to copy and run yourself in a terminal. Durbar never runs these lines: some
 * pipe a download into a shell, which spec 051 D1 forbids Durbar to do. Word for word from each vendor's install page (read
 * 2026-10-21, spec 060 research.md). Windows labels name the terminal: "PowerShell" or "PowerShell (winget)".
 */
export interface ManualCommand {
  label: string;
  command: string;
  note?: string;
  /**
   * Spec 060 FR-012: the install route that does the same thing, so the dialog can offer **Run** for it when that route is found.
   * Run never runs `command`: it starts that route from main's fixed table (for `official`, the same vendor script, downloaded
   * from its fixed hosts and run as a file: `powershell -File` / `bash`, never `irm … | iex` or `curl … | sh`).
   */
  route: RouteManager;
}
const NPM_CMD: Record<SetupKind, string> = { claude: 'npm install -g @anthropic-ai/claude-code', copilot: 'npm install -g @github/copilot', codex: 'npm install -g @openai/codex' };
const NODE22 = 'Needs Node.js 22 or later.';
/** Spec 060 FR-012: which route each manual command's label stands for (one table, so a new row cannot miss its route). */
const LABEL_ROUTE: Readonly<Record<string, RouteManager>> = Object.freeze({ PowerShell: 'official', Terminal: 'official', 'PowerShell (winget)': 'winget', Homebrew: 'brew', npm: 'npm' });
const MANUAL: Record<SetupKind, Record<'win32' | 'darwin' | 'linux', Omit<ManualCommand, 'route'>[]>> = {
  claude: {
    win32: [
      { label: 'PowerShell', command: 'irm https://claude.ai/install.ps1 | iex', note: "Anthropic's recommended installer; no administrator rights." },
      { label: 'PowerShell (winget)', command: 'winget install Anthropic.ClaudeCode' },
      { label: 'npm', command: NPM_CMD.claude, note: NODE22 },
    ],
    darwin: [{ label: 'Terminal', command: 'curl -fsSL https://claude.ai/install.sh | bash' }, { label: 'Homebrew', command: 'brew install --cask claude-code' }, { label: 'npm', command: NPM_CMD.claude, note: NODE22 }],
    linux: [{ label: 'Terminal', command: 'curl -fsSL https://claude.ai/install.sh | bash' }, { label: 'Homebrew', command: 'brew install --cask claude-code' }, { label: 'npm', command: NPM_CMD.claude, note: NODE22 }],
  },
  copilot: {
    win32: [{ label: 'PowerShell (winget)', command: 'winget install GitHub.Copilot' }, { label: 'npm', command: NPM_CMD.copilot, note: NODE22 }],
    darwin: [{ label: 'Terminal', command: 'curl -fsSL https://gh.io/copilot-install | bash' }, { label: 'Homebrew', command: 'brew install --cask copilot-cli' }, { label: 'npm', command: NPM_CMD.copilot, note: NODE22 }],
    linux: [{ label: 'Terminal', command: 'curl -fsSL https://gh.io/copilot-install | bash' }, { label: 'Homebrew', command: 'brew install --cask copilot-cli' }, { label: 'npm', command: NPM_CMD.copilot, note: NODE22 }],
  },
  codex: {
    win32: [
      { label: 'PowerShell', command: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', note: "OpenAI's installer for Windows." },
      { label: 'npm', command: NPM_CMD.codex },
    ],
    darwin: [{ label: 'Terminal', command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' }, { label: 'Homebrew', command: 'brew install --cask codex' }, { label: 'npm', command: NPM_CMD.codex }],
    linux: [{ label: 'Terminal', command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' }, { label: 'npm', command: NPM_CMD.codex }],
  },
};
/** Spec 060 FR-009: the commands to run yourself on this OS, in the vendor's order (copies, so a caller cannot change the table). */
export const manualCommands = (kind: SetupKind, platform: string): ManualCommand[] => {
  const os = osOf(platform);
  return os ? (MANUAL[kind]?.[os] ?? []).map((c) => ({ ...c, route: LABEL_ROUTE[c.label] })) : [];
};

function plansFor(kind: SetupKind, platform: string, found: ReadonlySet<PackageManager>, op: 'install' | 'update'): SetupPlan[] {
  const os = osOf(platform);
  const routes = (os && ROUTES[kind]?.[os]) || [];
  const interp: PackageManager = os === 'win32' ? 'powershell' : 'bash';
  return routes
    .filter((r) => (r.manager === 'official' ? found.has(interp) : found.has(r.manager)))
    .map((r) => {
      const args = op === 'install' ? r.install : r.update;
      if (r.manager === 'official' && r.script) {
        // the same script installs and updates; what runs is the interpreter with the downloaded file (appended by main)
        const display = `${r.script.url} (downloaded, then run with ${interp === 'powershell' ? 'Windows PowerShell' : 'bash'})`;
        return { manager: r.manager, bin: interp, script: r.script, args: [...args], display, ...(r.note ? { note: r.note } : {}) };
      }
      const bin = r.manager as PackageManager;
      return { manager: r.manager, bin, args: [...args], display: [bin, ...args].join(' '), ...(r.note ? { note: r.note } : {}) };
    });
}

/** FR-002: install routes for this OS whose package manager was found, in order (the first is preselected). */
export const installPlans = (kind: SetupKind, platform: string, found: ReadonlySet<PackageManager>): SetupPlan[] => plansFor(kind, platform, found, 'install');
/** FR-002: the same managers, upgrading. */
export const updatePlans = (kind: SetupKind, platform: string, found: ReadonlySet<PackageManager>): SetupPlan[] => plansFor(kind, platform, found, 'update');

/**
 * Spec 060 FR-002: what the simulator assumes is installed, per OS, so its setup screen shows the real routes for a typical new
 * machine: Windows 10/11 ship PowerShell 5.1 and winget; a new Mac has bash but no Homebrew and no Node; a Linux desktop has bash.
 */
export const SIM_FOUND: Readonly<Record<'win32' | 'darwin' | 'linux', readonly PackageManager[]>> = Object.freeze({ win32: ['powershell', 'winget'], darwin: ['bash'], linux: ['bash'] });
export const simFoundFor = (platform: string): PackageManager[] => [...(SIM_FOUND[osOf(platform) ?? 'linux'] ?? [])];
/** The simulator's managers: `DURBAR_SIM_MANAGERS=winget,brew,npm` (a driver that needs the command dialog), else `SIM_FOUND`; unknown names dropped. */
export function simManagers(platform: string, override?: string): PackageManager[] {
  if (override === undefined) return simFoundFor(platform);
  const ok = new Set<PackageManager>(['winget', 'brew', 'npm', 'bash', 'powershell']);
  return [...new Set(override.split(',').map((x) => x.trim()).filter((x): x is PackageManager => ok.has(x as PackageManager)))];
}

/** Package managers worth looking for on this OS. */
export const managersFor = (platform: string): PackageManager[] => (platform === 'win32' ? ['powershell', 'winget', 'npm'] : ['bash', 'brew', 'npm']);

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

/**
 * Spec 060 FR-012: the plan index the window may send to `harness:run`: an integer 0-7, else undefined (refused; it used to fall
 * back to the first plan). The index only picks a row of main's fixed table; main still checks that the row exists.
 */
export const validPlanIndex = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 8 ? v : undefined);

export const isSetupKind = (k: unknown): k is SetupKind => k === 'claude' || k === 'codex' || k === 'copilot';

/**
 * Spec 060 FR-001 (review on #393): which install route owns an installed binary, from its real path, so Update uses that route
 * and never leaves a second copy (the official script would install into ~/.local/bin while detection still finds the old one).
 * Pure; `undefined` when the path says nothing (then the usual order applies).
 */
export function routeOwning(realPath: string): RouteManager | undefined {
  const p = realPath.replace(/\\/g, '/');
  if (/\/node_modules\//i.test(p) || /\/npm\/[^/]+\.cmd$/i.test(p)) return 'npm';
  if (/\/(Cellar|Caskroom)\//.test(p) || p.startsWith('/opt/homebrew/') || /\/\.?linuxbrew\//.test(p)) return 'brew';
  if (/\/WinGet\/(Packages|Links)\//i.test(p)) return 'winget';
  if (/\/\.local\/(bin|share)\//.test(p) || /\/\.claude\/local\//.test(p) || /\/Programs\/OpenAI\/Codex\//i.test(p)) return 'official';
  return undefined;
}
