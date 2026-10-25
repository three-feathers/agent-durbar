/**
 * Harness setup runner (spec 051 FR-004, FR-005): runs one fixed install, update or sign-in at a time, streams what the user needs
 * (the last lines, the sign-in link and code) and re-checks the harness when it ends. No shell: argv only; a Windows `.cmd` (npm)
 * goes through `cmd /d /s /c` with its own quotes, after the same metacharacter check as detection. Nothing is logged or stored.
 */
import * as path from 'path';
import * as os from 'os';
import { StringDecoder } from 'string_decoder';
import { candidates, execFound, isAppAlias } from '../adapters/detect';
import type { DetectEnv, Exec } from '../adapters/detect';
import { CMD_UNSAFE, windowsCmd } from '../shared/wincmd';
import { redact } from '../shared/redact';
import { SIGN_IN, installPlans, integrityLine, lastLines, managersFor, manualCommands, parseSignIn, stripAnsi, updatePlans, validPaste, OFFICIAL_PAGES, SETUP_NAMES } from '../shared/harnesssetup';
import type { ManualCommand, OfficialScript, PackageManager, SetupKind, SetupPlan, SignInView, UpdatePlanOpts } from '../shared/harnesssetup';
import { CODEX_UPDATE_COMMAND, classifyFailure, codexNeedsFallback, codexUpdateEnv, isOfficialCodex, npmOwns, sourceOf, updateDecision, updateOutcomeNote, versionLabel } from '../shared/updatecheck';
import type { FailureClass, UpdatePolicy, UpdateSource } from '../shared/updatecheck';
import * as fs from 'fs';
import { downloadScript } from './officialinstall';
import type { HttpGet } from './officialinstall';

export type SetupOp = 'install' | 'update' | 'signin';

/** The child process surface the runner needs (a subset of Node's ChildProcess), so tests can hand in a fake. */
export interface ChildLike {
  pid?: number;
  stdout: { on(ev: 'data', cb: (d: Buffer | string) => void): unknown } | null;
  stderr: { on(ev: 'data', cb: (d: Buffer | string) => void): unknown } | null;
  stdin: { write(s: string): unknown; end(): unknown } | null;
  on(ev: 'close', cb: (code: number | null) => void): unknown;
  on(ev: 'error', cb: (err: Error) => void): unknown;
}
export type SpawnLike = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdio: ['pipe' | 'ignore', 'pipe', 'pipe']; windowsVerbatimArguments?: boolean; detached?: boolean; windowsHide?: boolean; cwd?: string }) => ChildLike;

export interface SetupProgress { kind: SetupKind; op: SetupOp; lines: string[]; elapsedMs: number; url?: string; code?: string; needsPaste?: boolean }
/** One resolved operation, ready to start (spec 051 FR-004b): what the main-side confirmation shows is exactly what runs. */
export interface PreparedRun {
  kind: SetupKind; op: SetupOp; file: string; args: string[]; spawnFile: string; spawnArgs: string[]; verbatim: boolean; paste: boolean; script?: OfficialScript; cleanupDir?: string;
  /** Spec 081: the app's own updater (`claude update` ...), `codex update` (curl-to-shell, official Codex only), the version it installs, what its route checks. */
  own?: SetupKind; codexUpdate?: boolean; pinned?: string; checked?: string; integrity?: string; sourceKind?: UpdateSource['kind'];
}
export interface SetupDone {
  kind: SetupKind; op: SetupOp; ok: boolean; exitCode?: number | null; reason?: 'timeout' | 'cancelled' | 'error'; lines: string[];
  /** Spec 081 FR-014: the failure class of an update (or `vendor-up-to-date`), for the card's advice. */
  failure?: FailureClass;
  /** Spec 081 FR-009: a failing `codex update` offers the checked 060 installer; the window asks again, nothing retries by itself. */
  fallback?: 'official';
  /** Spec 081 FR-011: after an update, what Durbar finds now when it is not simply the new version. */
  note?: string;
}
/** What detection says about an app (spec 081 FR-011): the version and the display path. */
export interface DetectedCopy { version?: string; where?: string }

export interface SetupDeps {
  detectEnv: DetectEnv;
  spawn: SpawnLike;
  /** Stops a child and what it started (process group, or `taskkill /T` on Windows). */
  killTree(child: ChildLike): void;
  send(channel: 'harness:progress', p: SetupProgress): void;
  send(channel: 'harness:done', p: SetupDone): void;
  /** Re-runs detection after an operation ends (the cards update from it). */
  redetect(): Promise<void>;
  /** Spec 012 FR-158: after a sign-in that ended well, before detection and `harness:done`: the adapter picks up the new sign-in. */
  afterSignIn?(kind: SetupKind): Promise<void>;
  now?: () => number;
  /** The real path of a found binary (symlinks resolved), so what is confirmed and spawned is the file itself. */
  realpath?: (p: string) => string;
  /** False for a binary that anyone could have replaced (a world-writable file or folder on macOS/Linux): it is not run. */
  trustedPath?: (p: string) => boolean;
  /** Least time between two progress events, ms (default 250: at most about 4 a second). */
  progressMs?: number;
  /** Limits in ms (FR-004: 15 min install/update; FR-005: 16 min sign-in). */
  limits?: { install: number; signin: number };
  /** Spec 060 FR-001: true when Durbar runs as root (uid 0); an official installer is then refused (it installs into the user's home). */
  isRoot?: () => boolean;
  /** Spec 060 FR-001: the download of an official installer (tests hand in a fake). */
  httpGet?: HttpGet;
  tmpdir?: string;
  /** Spec 081: runs the app's `--version` (the Codex label); the same exec as detection. */
  exec?: Exec;
  /** Spec 081 FR-023: the checked version for an app (a kept update-available result), pinned into npm and winget. */
  checked?: (kind: SetupKind) => string | undefined;
  /** Spec 081 FR-022, FR-023: the organization policy (`max`, `allowInAppInstall`). */
  policy?: () => UpdatePolicy;
  /** Spec 081 T021: a regular file (the Codex official check). */
  regular?: (p: string) => boolean;
  /** Spec 081 FR-011: the detected version and path of each app, read before and after an update. */
  snapshot?: () => Promise<Partial<Record<SetupKind, DetectedCopy>>>;
  /** Spec 060 FR-001: true when the found Homebrew belongs to another account (it then fails from this one). Default: the file's owner. */
  ownedByOther?: (p: string) => boolean;
}

/**
 * Spec 060 FR-001 (real, install check 2026-10-20): the environment of a setup run. On Windows an official installer runs with the
 * system folders first on PATH, as Windows itself orders them: OpenAI's script calls `tar` with `C:\...` paths, and Git's GNU tar
 * (Git\usr\bin, early on PATH on some machines and on GitHub's runners) reads `C:` as a remote host and fails. Windows' own tar.exe
 * does not. `PSModulePath` is dropped (see below). The PATH key keeps its spelling (Windows environment names ignore case; two spellings would be ambiguous).
 */
export function setupEnv(base: NodeJS.ProcessEnv, platform: NodeJS.Platform, official: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_fund: 'false', npm_config_audit: 'false' };
  if (platform !== 'win32' || !official) return env;
  // Windows PowerShell 5.1 started from PowerShell 7 inherits 7's PSModulePath and then cannot load its own modules (real, install
  // check 2026-10-20: Claude's install.ps1 failed on `Get-FileHash` not found); without it, 5.1 builds its default module path
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'psmodulepath') delete env[k];
  const root = base.SystemRoot ?? base.SYSTEMROOT;
  if (!root || !path.win32.isAbsolute(root)) return env;
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path';
  const first = [path.win32.join(root, 'System32'), root, path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0')];
  const rest = (env[key] ?? '').split(';').filter((d) => d && !first.some((f) => f.toLowerCase() === d.replace(/\\+$/, '').toLowerCase()));
  env[key] = [...first, ...rest].join(';');
  return env;
}

const defaultOwnedByOther = (p: string): boolean => {
  if (typeof process.getuid !== 'function') return false;
  try { return fs.statSync(p).uid !== process.getuid(); } catch { return false; }
};

const MAX_OUT = 64 * 1024;

/** Masks OAuth values in URL queries and fragments (`?code=…`, `&state=…`, `device_code`, `access_token`, …). Linear: bounded classes. */
export function maskOAuth(line: string): string {
  return line.replace(/([?&#](?:code|state|device_code|user_code|access_token|refresh_token|id_token|token|code_verifier)=)[^\s&#"'<>]{1,2000}/gi, '$1[hidden]');
}

export class HarnessSetup {
  private running: { child: ChildLike; kind: SetupKind; op: SetupOp; out: string; started: number; timer?: ReturnType<typeof setTimeout>; ended: boolean; reason?: SetupDone['reason']; paste: boolean; lastSent: number; cleanupDir?: string; pending?: ReturnType<typeof setTimeout>; codexUpdate?: boolean; target?: string; before?: Promise<DetectedCopy | undefined> } | undefined;

  constructor(private readonly deps: SetupDeps) {}

  /** The first runnable path of a binary on PATH or the usual install folders, or undefined. */
  find(name: string): string | undefined {
    const env = this.deps.detectEnv;
    if (name === 'powershell' && env.platform === 'win32') {
      // spec 060 FR-001: Windows PowerShell 5.1 from the system folder only, never a powershell.exe earlier on PATH
      const root = env.env.SystemRoot ?? env.env.SYSTEMROOT;
      const exe = root && path.win32.isAbsolute(root) ? path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : undefined;
      return exe && env.isFile(exe) ? exe : undefined;
    }
    // candidates() covers the version-manager and Linuxbrew folders too (spec 060 FR-003)
    return candidates({ name, versionArgs: [], installHint: '' }, env).find((c) => env.isFile(c));
  }

  /**
   * Spec 052 FR-073: on Windows, true when PowerShell 7 (`pwsh.exe`) is on neither PATH, the usual folders nor
   * `%ProgramFiles%\PowerShell\7`. The Copilot card then shows a hint (text only; nothing is installed). Always false elsewhere.
   */
  pwshMissing(): boolean {
    const env = this.deps.detectEnv;
    if (env.platform !== 'win32') return false;
    if (this.find('pwsh')) return false;
    const pf = env.env.ProgramFiles ?? env.env.PROGRAMFILES;
    return !(pf && path.win32.isAbsolute(pf) && env.isFile(path.win32.join(pf, 'PowerShell', '7', 'pwsh.exe')));
  }

  /** Spec 081: the copy Durbar finds for an app (real path, symlinks resolved) and the source that installed it. */
  private ownerOf(kind: SetupKind): { real: string; src: UpdateSource } | undefined {
    const at = this.find(kind);
    if (!at) return undefined;
    let real: string;
    try { real = this.deps.realpath ? this.deps.realpath(at) : at; } catch { return undefined; }
    const env = this.deps.detectEnv;
    return { real, src: sourceOf(kind, real, env.platform, { homedir: env.homedir, env: env.env }) };
  }

  /** Spec 081 T021: the first word of Codex's `--version` (read at update time only: the label is what makes a copy official). */
  private codexLabel: string | undefined;
  /** Reads what an update needs to know first (today: the Codex label). Call before `plans` and `prepare` for an update. */
  async warm(kind: SetupKind): Promise<void> {
    if (kind !== 'codex' || !this.deps.exec) return;
    const at = this.find('codex');
    if (!at) { this.codexLabel = undefined; return; }
    try {
      const r = await execFound(at, ['--version'], this.deps.detectEnv, this.deps.exec);
      this.codexLabel = r && r.code === 0 && !r.timedOut && !r.errorCode ? versionLabel(r.stdout) : undefined;
    } catch { this.codexLabel = undefined; }
  }

  private updateOpts(kind: SetupKind, owner: { real: string; src: UpdateSource }): UpdatePlanOpts {
    const env = this.deps.detectEnv;
    const src = owner.src;
    return {
      pin: this.deps.checked?.(kind),
      ...(src.kind === 'brew' ? { cask: src.cask } : {}),
      ownUpdater: src.kind === 'official' && (kind === 'claude' || kind === 'copilot'),
      codexOfficial: kind === 'codex' && src.kind === 'official' && isOfficialCodex({
        realPath: owner.real, platform: env.platform, env: { homedir: env.homedir, env: env.env }, label: this.codexLabel,
        trusted: this.deps.trustedPath ? this.deps.trustedPath(owner.real) : true, regular: this.deps.regular ? this.deps.regular(owner.real) : true,
      }),
    };
  }

  /** FR-002/FR-003: what the dialog offers for install or update, plus the official page. */
  /** `assumeFound`: the simulator's per-OS set (spec 060 FR-002) instead of what is installed on this machine. */
  /** Spec 060 FR-009: also the vendor's commands to run yourself (`manual`) for this OS. `simPlatform` (only with `assumeFound`): the OS the simulator shows. */
  /** Spec 081 FR-008: for an update, the plan of the route that installed the copy comes first and is marked `owner`; `blocked` says why an update is not offered (organization `max`). */
  plans(kind: SetupKind, op: 'install' | 'update', assumeFound?: readonly PackageManager[], simPlatform?: NodeJS.Platform): { plans: SetupPlan[]; page: string; name: string; manual: ManualCommand[]; blocked?: string } {
    const found = new Set<PackageManager>(assumeFound ?? managersFor(this.deps.detectEnv.platform).filter((m) => this.find(m)));
    const env = this.deps.detectEnv;
    const os = assumeFound && simPlatform ? simPlatform : env.platform;
    const owner = op === 'update' && !assumeFound ? this.ownerOf(kind) : undefined;
    const base = op === 'install' ? installPlans(kind, os, found) : updatePlans(kind, os, found, owner ? this.updateOpts(kind, owner) : undefined);
    const plans = base.map((p) => {
      if (p.manager === 'brew' && !assumeFound && env.platform !== 'win32') {
        // spec 060 FR-001 (real, install check 2026-10-20): Homebrew installed by another account fails from this one (exit 1)
        const at = this.find('brew');
        let real: string | undefined;
        try { real = at ? (this.deps.realpath ?? ((x: string) => x))(at) : undefined; } catch { real = undefined; }
        if (real && (this.deps.ownedByOther ?? defaultOwnedByOther)(real)) return { ...p, note: 'Homebrew on this computer belongs to another account, so it will not work from yours. Use another way, or ask that account.' };
        return p;
      }
      if (p.manager !== 'npm' || env.platform === 'win32' || assumeFound) return p;
      // spec 060 FR-001: npm needs no admin rights only when it lives in the home folder (nvm, fnm, volta, a user prefix)
      const at = this.find('npm');
      const home = env.homedir.endsWith('/') ? env.homedir : env.homedir + '/';
      return at && at.startsWith(home) ? p : { ...p, note: [p.note, 'Node.js is installed for all users here, so this may need administrator rights.'].filter(Boolean).join(' ') };
    });
    let blocked: string | undefined;
    if (owner) {
      // review on #393: update with the route that installed the copy Durbar finds, so no second copy is left behind
      const src = owner.src;
      const i = src.kind === 'official' ? plans.findIndex((p) => !!p.own || p.manager === 'official') : src.kind === 'outside' ? -1 : plans.findIndex((p) => p.manager === src.kind);
      if (i >= 0) { plans.unshift(...plans.splice(i, 1)); plans[0] = { ...plans[0], owner: true }; }
      // spec 081 FR-023: an organization `max` allows only a route that can pin, pinned to the checked version and within the range
      const pol = this.deps.policy?.();
      const max = pol && pol.state === 'ok' ? pol.max?.[kind] : undefined;
      const dec = updateDecision(src, this.deps.checked?.(kind), max);
      if (!dec.allowed) { blocked = dec.reason; plans.length = 0; }
      else if (max) { const keep = plans.filter((p) => !!p.pinned); plans.length = 0; plans.push(...keep); }
    }
    return { plans, page: OFFICIAL_PAGES[kind], name: SETUP_NAMES[kind], manual: manualCommands(kind, os), ...(blocked ? { blocked } : {}) };
  }

  get busy(): boolean { return !!this.running && !this.running.ended; }

  /**
   * Starts one operation at once (tests and the simulator; the app goes through `prepare`, a main-side confirmation, then `start`).
   * `planIndex` picks one of `plans(kind, op)` (install/update); sign-in runs the harness's own command.
   */
  run(kind: SetupKind, op: SetupOp, planIndex = 0): { ok: true } | { ok: false; error: string } {
    const p = this.prepare(kind, op, planIndex);
    return p.ok ? this.start(p.job) : p;
  }

  /** Resolves what would run, without running it (FR-004b): the binary's real path and its fixed arguments. */
  prepare(kind: SetupKind, op: SetupOp, planIndex = 0): { ok: true; job: PreparedRun } | { ok: false; error: string } {
    if (this.busy) return { ok: false, error: 'Another setup step is still running.' };
    let file: string | undefined;
    let args: string[];
    let script: OfficialScript | undefined;
    let own: SetupKind | undefined;
    let codexUpdate: boolean | undefined;
    let pinned: string | undefined;
    let integrity: string | undefined;
    let sourceKind: UpdateSource['kind'] | undefined;
    if (op === 'signin') {
      const s = SIGN_IN[kind];
      file = this.find(s.bin);
      if (!file) return { ok: false, error: kind === 'copilot' ? 'The GitHub Copilot CLI is not installed. Install it first; Durbar uses it only to sign in.' : `${SETUP_NAMES[kind]} is not installed.` };
      args = [...s.args];
    } else {
      const plan = this.plans(kind, op).plans[planIndex];
      if (!plan) return { ok: false, error: 'No package manager was found for this. Open the official page instead.' };
      // spec 081 FR-025: every vendor updater writes into the user's home folder, so none of them runs as root
      if ((plan.script || plan.own) && this.deps.isRoot?.()) return { ok: false, error: 'These updaters write into your home folder: run Agent Durbar as yourself, not as root.' };
      if (plan.own) file = this.find(plan.own);
      else if (op === 'update' && (plan.manager === 'npm' || plan.manager === 'brew')) {
        const t = this.ownerTool(kind, plan.manager);
        if (typeof t === 'object') return { ok: false, error: t.error };
        file = t;
      } else file = this.find(plan.bin);
      if (!file) return { ok: false, error: `${plan.bin} was not found.` };
      args = [...plan.args];
      script = plan.script;
      own = plan.own;
      codexUpdate = plan.codexUpdate;
      pinned = plan.pinned;
      integrity = integrityLine(plan);
      sourceKind = plan.manager === 'official' ? 'official' : plan.manager;
    }
    // spec 060 FR-010: an App Execution Alias (winget.exe) runs only by its own path; resolving it leads into a folder users cannot run from
    if (!isAppAlias(file, this.deps.detectEnv)) {
      try { file = this.deps.realpath ? this.deps.realpath(file) : file; } catch { return { ok: false, error: 'That program could not be found any more.' }; }
    }
    if (this.deps.trustedPath && !this.deps.trustedPath(file)) return { ok: false, error: `Not run: ${file} is in a folder anyone on this computer can change.` };
    const env = this.deps.detectEnv;
    let spawnFile = file;
    let spawnArgs: string[] = args;
    let verbatim = false;
    if (env.platform === 'win32' && /\.cmd$/i.test(file)) {
      if (CMD_UNSAFE.test(file) || args.some((a) => CMD_UNSAFE.test(a) || /\s/.test(a))) return { ok: false, error: 'This command cannot be run safely on this computer.' };
      spawnFile = windowsCmd(env.env);
      spawnArgs = ['/d', '/s', '/c', `"${file}" ${args.join(' ')}`];
      verbatim = true;
    }
    return { ok: true, job: { kind, op, file, args, spawnFile, spawnArgs, verbatim, paste: op === 'signin' && SIGN_IN[kind].mode === 'paste', ...(script ? { script } : {}), ...(own ? { own } : {}), ...(codexUpdate ? { codexUpdate } : {}), ...(pinned ? { pinned } : {}), ...(op === 'update' && this.deps.checked?.(kind) ? { checked: this.deps.checked(kind) } : {}), ...(integrity ? { integrity } : {}), ...(sourceKind ? { sourceKind } : {}) } };
  }

  /** Spec 081 FR-006: the npm (or brew) that owns the copy, not the first one on PATH; a string is the file, an object an error. */
  private ownerTool(kind: SetupKind, manager: 'npm' | 'brew'): string | { error: string } {
    const owner = this.ownerOf(kind);
    const env = this.deps.detectEnv;
    if (owner?.src.kind === 'npm' && manager === 'npm') {
      if (owner.src.npm && env.isFile(owner.src.npm)) return owner.src.npm;
      const first = this.find('npm');
      return first && npmOwns(first, owner.real, env.platform) ? first : { error: 'The npm that installed this copy was not found, so it cannot be updated from here.' };
    }
    if (owner?.src.kind === 'brew' && manager === 'brew') {
      const own = path.posix.join(owner.src.prefix, 'bin', 'brew');
      if (env.isFile(own)) return own;
    }
    return this.find(manager) ?? { error: `${manager} was not found.` };
  }

  /**
   * Spec 060 FR-001: for an official installer, download the script now (after the user confirmed) and add it as the last argument.
   * The private folder is deleted when the run ends (or here, if it never starts).
   */
  async withScript(job: PreparedRun): Promise<{ ok: true; job: PreparedRun } | { ok: false; error: string }> {
    if (!job.script) return { ok: true, job };
    if (!this.deps.httpGet) return { ok: false, error: 'No network layer is set up for the installer download.' };
    try {
      const ext = this.deps.detectEnv.platform === 'win32' ? '.ps1' : '.sh';
      const { file, dir } = await downloadScript(job.script, ext, { get: this.deps.httpGet, tmpdir: this.deps.tmpdir });
      return { ok: true, job: { ...job, args: [...job.args, file], spawnArgs: [...job.spawnArgs, file], cleanupDir: dir } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Starts a prepared operation. Returns at once; progress and the end come as events. */
  start(job: PreparedRun): { ok: true } | { ok: false; error: string } {
    // review on #393: a refused start must not leave a downloaded installer behind (two quick runs can both download)
    const dropDownload = (): void => { if (job.cleanupDir) try { fs.rmSync(job.cleanupDir, { recursive: true, force: true }); } catch { /* left in the OS temp folder */ } };
    if (this.busy) { dropDownload(); return { ok: false, error: 'Another setup step is still running.' }; }
    const { kind, op, paste } = job;
    const env = this.deps.detectEnv;
    let child: ChildLike;
    let childEnv = setupEnv(process.env, env.platform, !!job.script);
    let cwd: string | undefined;
    if (job.codexUpdate) {
      // spec 081 FR-009: `codex update` runs OpenAI's installer through a shell Codex starts, so it gets no CODEX_MANAGED_BY_*, a fixed
      // system PATH and a fresh private working folder, deleted when the run ends
      try {
        cwd = fs.mkdtempSync(path.join(this.deps.tmpdir ?? os.tmpdir(), 'durbar-codex-update-'));
        fs.chmodSync(cwd, 0o700);
      } catch (e) {
        return { ok: false, error: 'Could not make a private working folder: ' + (e instanceof Error ? e.message : String(e)) };
      }
      job = { ...job, cleanupDir: cwd };
      childEnv = codexUpdateEnv({ ...childEnv }, env.platform);
    } else if (kind === 'codex' && job.script) childEnv = { ...childEnv, CODEX_NON_INTERACTIVE: '1' }; // OpenAI's own update hint sets it, in that child only
    try {
      child = this.deps.spawn(job.spawnFile, job.spawnArgs, {
        env: childEnv,
        stdio: [paste ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: job.verbatim,
        detached: env.platform !== 'win32',
        windowsHide: true,
        ...(cwd ? { cwd } : {}),
      });
    } catch (e) {
      dropDownload();
      if (cwd) try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* the OS cleans its temp folder */ }
      return { ok: false, error: 'Could not start it: ' + (e instanceof Error ? e.message : String(e)) };
    }
    const now = this.deps.now ?? Date.now;
    const r = { child, kind, op, out: '', started: now(), ended: false, paste, lastSent: 0, cleanupDir: job.cleanupDir, codexUpdate: job.codexUpdate, target: job.pinned ?? job.checked, ...(op === 'update' && this.deps.snapshot ? { before: this.deps.snapshot().then((x) => x[kind], () => undefined) } : {}) } as NonNullable<HarnessSetup['running']>;
    this.running = r;
    const limit = op === 'signin' ? this.deps.limits?.signin ?? 16 * 60_000 : this.deps.limits?.install ?? 15 * 60_000;
    r.timer = setTimeout(() => { r.reason = 'timeout'; this.deps.killTree(child); }, limit);
    (r.timer as { unref?: () => void }).unref?.(); // a pending limit never keeps the process alive by itself
    const gap = this.deps.progressMs ?? 250;
    const flush = (): void => { r.pending = undefined; if (r.ended) return; r.lastSent = now(); this.deps.send('harness:progress', this.progress(r)); };
    // FR-004c: whole characters (a UTF-8 sequence split across chunks is kept for the next one), at most one event per `gap`
    const onStream = (): ((d: Buffer | string) => void) => {
      const dec = new StringDecoder('utf8');
      return (d) => {
        r.out = (r.out + (typeof d === 'string' ? d : dec.write(d))).slice(-MAX_OUT);
        if (r.pending) return;
        const wait = r.lastSent + gap - now();
        if (wait <= 0) flush();
        else { r.pending = setTimeout(flush, wait); (r.pending as { unref?: () => void }).unref?.(); }
      };
    };
    child.stdout?.on('data', onStream());
    child.stderr?.on('data', onStream());
    // a child that never started emits 'error' and may never emit 'close': end it here too (finish runs once)
    child.on('error', () => { r.reason = r.reason ?? 'error'; void this.finish(r, null); });
    child.on('close', (code) => { void this.finish(r, code); });
    flush();
    return { ok: true };
  }

  private progress(r: NonNullable<HarnessSetup['running']>): SetupProgress {
    const v: SignInView | undefined = r.op === 'signin' ? parseSignIn(r.kind, r.out) : undefined;
    const base: SetupProgress = { kind: r.kind, op: r.op, lines: this.safeLines(r.out, v), elapsedMs: (this.deps.now ?? Date.now)() - r.started };
    if (!v) return base;
    return { ...base, ...(v.url ? { url: v.url } : {}), ...(v.code ? { code: v.code } : {}), needsPaste: v.needsPaste };
  }

  /**
   * The last lines for display, redacted. A sign-in's own link and code are shown separately (FR-005), so they are masked here,
   * and so is any OAuth value in a URL (`code`, `state`, `device_code`, tokens), so none of them sits in plain lines.
   */
  private safeLines(out: string, v?: SignInView): string[] {
    return lastLines(out).map((l) => {
      let s = l;
      if (v?.url) s = s.split(v.url).join('[sign-in link]');
      if (v?.code) s = s.split(v.code).join('[code]');
      return maskOAuth(redact(s));
    });
  }

  private async finish(r: NonNullable<HarnessSetup['running']>, code: number | null): Promise<void> {
    if (r.ended) return;
    r.ended = true;
    if (r.timer) clearTimeout(r.timer);
    if (r.pending) { clearTimeout(r.pending); r.pending = undefined; }
    if (r.cleanupDir) { try { fs.rmSync(r.cleanupDir, { recursive: true, force: true }); } catch { /* the OS cleans its temp folder */ } }
    const ok = !r.reason && code === 0;
    if (ok && r.op === 'signin' && this.deps.afterSignIn) {
      try { await this.deps.afterSignIn(r.kind); } catch { /* the sessions say so on their cards; detection still runs */ }
    }
    try { await this.deps.redetect(); } catch { /* the cards keep their last state */ }
    // spec 081 FR-014: the failure class comes from the masked output, never the raw one; a successful `claude update` that says "up to date" is not an update
    let failure: FailureClass | undefined;
    let fallback: 'official' | undefined;
    let note: string | undefined;
    if (r.op !== 'signin') {
      const text = maskOAuth(redact(stripAnsi(r.out))).slice(-4000);
      const cls = classifyFailure({ code, text, platform: this.deps.detectEnv.platform, timedOut: r.reason === 'timeout' });
      if (!ok) failure = cls;
      else if (cls === 'vendor-up-to-date') failure = cls;
      if (r.codexUpdate && codexNeedsFallback({ ok, reason: r.reason, cls })) fallback = 'official';
      if (ok && r.op === 'update' && this.deps.snapshot) {
        try {
          const before = await r.before;
          const after = (await this.deps.snapshot())[r.kind];
          note = updateOutcomeNote(SETUP_NAMES[r.kind], before, after, r.target);
        } catch { /* no note */ }
      }
    }
    this.deps.send('harness:done', { kind: r.kind, op: r.op, ok, exitCode: code, ...(r.reason ? { reason: r.reason } : {}), lines: this.safeLines(r.out, r.op === 'signin' ? parseSignIn(r.kind, r.out) : undefined), ...(failure ? { failure } : {}), ...(fallback ? { fallback } : {}), ...(note ? { note } : {}) });
    if (this.running === r) this.running = undefined;
  }

  /** FR-005: Claude's code from its sign-in page, to that process only. Never logged. */
  paste(text: unknown): { ok: boolean; error?: string } {
    const r = this.running;
    if (!r || r.ended || !r.paste || !r.child.stdin) return { ok: false, error: 'Nothing is waiting for a code.' };
    const v = validPaste(text);
    if (!v) return { ok: false, error: 'Paste the code from the sign-in page (one line).' };
    r.child.stdin.write(v + '\n');
    return { ok: true };
  }

  cancel(): boolean {
    const r = this.running;
    if (!r || r.ended) return false;
    r.reason = 'cancelled';
    this.deps.killTree(r.child);
    return true;
  }
}

/**
 * FR-004b: on macOS and Linux a binary is run only when neither it nor its folder is writable by everyone (another user, or
 * anything running as one, could have swapped it). Windows uses ACLs, which this does not read (`[KNOWN GAP]` in the spec).
 */
export function posixTrusted(file: string, modeOf: (p: string) => number): boolean {
  try {
    return [file, path.posix.dirname(file)].every((p) => (modeOf(p) & 0o002) === 0);
  } catch {
    return false;
  }
}

/** Spec 081 FR-023: which version an update installs, in one line (pinned, or the newest the source offers). */
function targetLine(job: PreparedRun): string {
  if (job.pinned) return `It installs exactly ${job.pinned}, the version Durbar just checked.`;
  if (job.checked) return `It installs the newest version the source offers (checked: ${job.checked}).`;
  return '';
}

/** FR-004b: the native confirmation's text: the exact program (real path) and its arguments. */
export function confirmText(job: PreparedRun, platform: NodeJS.Platform = process.platform): { message: string; detail: string; button: string } {
  const name = SETUP_NAMES[job.kind];
  const verb = job.op === 'install' ? 'Install' : job.op === 'update' ? 'Update' : 'Sign in to';
  const extra = [job.op === 'update' ? targetLine(job) : '', job.integrity ?? ''].filter(Boolean).join('\n');
  if (job.codexUpdate) {
    // spec 081 FR-009 (owner decision Q3 = C, limited to the official Codex CLI): say plainly what runs
    const cmd = CODEX_UPDATE_COMMAND;
    return {
      message: `Update ${name} with its own updater?`,
      detail: `${job.file} ${job.args.join(' ')}\n\ncodex update downloads OpenAI's installer script and runs it. Codex's source (commit 970111f6) runs, for this computer:\n\n${platform === 'win32' ? cmd.win32 : cmd.posix}\n\nThe Codex you have installed decides what actually runs. Durbar cannot see or check that script. sh, curl or powershell are found by Codex on the system PATH Durbar sets, and on Windows the script runs with -ExecutionPolicy Bypass.\n${extra}\n\nOnly continue if you started this in Durbar.`,
      button: 'Update',
    };
  }
  if (job.own) {
    const signin = job.own === 'copilot' ? '\nIt uses your GitHub sign-in to ask GitHub for the newest release.' : '';
    return {
      message: `Update ${name} with its own updater?`,
      detail: `Durbar will run this on your computer, as you:\n\n${job.file} ${job.args.join(' ')}\n${signin}\n${extra}\n\nOnly continue if you started this in Durbar.`,
      button: 'Update',
    };
  }
  if (job.script) {
    // spec 060 FR-001: what is downloaded from where, what runs it, and that it needs no administrator rights
    const hosts = job.script.hosts.map((h) => h.host).join(', ');
    return {
      message: `${verb} ${name} with the official installer?`,
      detail: `Durbar will download the vendor's installer from\n${job.script.url}\n(only from ${hosts}) and run it on your computer, as you:\n\n${job.file} ${[...job.args, '<installer>'].join(' ')}\n\nIt installs into your home folder and needs no administrator rights. The vendor's script may also add its folder to your shell's PATH (for example in ~/.bashrc or ~/.zprofile).${extra ? '\n' + extra : ''} Only continue if you started this in Durbar.`,
      button: job.op === 'install' ? 'Install' : 'Update',
    };
  }
  return {
    message: `${verb} ${name}?`,
    detail: `Durbar will run this on your computer, as you:\n\n${job.file} ${job.args.join(' ')}${extra ? '\n\n' + extra : ''}\n\nOnly continue if you started this in Durbar.`,
    button: job.op === 'install' ? 'Install' : job.op === 'update' ? 'Update' : 'Sign in',
  };
}
