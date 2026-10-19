/**
 * Harness setup runner (spec 051 FR-004, FR-005): runs one fixed install, update or sign-in at a time, streams what the user needs
 * (the last lines, the sign-in link and code) and re-checks the harness when it ends. No shell: argv only; a Windows `.cmd` (npm)
 * goes through `cmd /d /s /c` with its own quotes, after the same metacharacter check as detection. Nothing is logged or stored.
 */
import * as path from 'path';
import { CMD_UNSAFE, candidates } from '../adapters/detect';
import type { DetectEnv } from '../adapters/detect';
import { windowsCmd } from '../shared/wincmd';
import { redact } from '../shared/redact';
import { SIGN_IN, installPlans, lastLines, managersFor, parseSignIn, updatePlans, validPaste, OFFICIAL_PAGES, SETUP_NAMES } from '../shared/harnesssetup';
import type { PackageManager, SetupKind, SetupPlan, SignInView } from '../shared/harnesssetup';

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
export type SpawnLike = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdio: ['pipe' | 'ignore', 'pipe', 'pipe']; windowsVerbatimArguments?: boolean; detached?: boolean; windowsHide?: boolean }) => ChildLike;

export interface SetupProgress { kind: SetupKind; op: SetupOp; lines: string[]; elapsedMs: number; url?: string; code?: string; needsPaste?: boolean }
export interface SetupDone { kind: SetupKind; op: SetupOp; ok: boolean; exitCode?: number | null; reason?: 'timeout' | 'cancelled' | 'error'; lines: string[] }

export interface SetupDeps {
  detectEnv: DetectEnv;
  spawn: SpawnLike;
  /** Stops a child and what it started (process group, or `taskkill /T` on Windows). */
  killTree(child: ChildLike): void;
  send(channel: 'harness:progress', p: SetupProgress): void;
  send(channel: 'harness:done', p: SetupDone): void;
  /** Re-runs detection after an operation ends (the cards update from it). */
  redetect(): Promise<void>;
  now?: () => number;
  /** Limits in ms (FR-004: 15 min install/update; FR-005: 16 min sign-in). */
  limits?: { install: number; signin: number };
}

const MAX_OUT = 64 * 1024;

export class HarnessSetup {
  private running: { child: ChildLike; kind: SetupKind; op: SetupOp; out: string; started: number; timer?: ReturnType<typeof setTimeout>; ended: boolean; reason?: SetupDone['reason']; paste: boolean } | undefined;

  constructor(private readonly deps: SetupDeps) {}

  /** The first runnable path of a binary on PATH or the usual install folders, or undefined. */
  find(name: string): string | undefined {
    const env = this.deps.detectEnv;
    const extra = env.platform === 'linux' ? ['/home/linuxbrew/.linuxbrew/bin', path.posix.join(env.homedir, '.linuxbrew/bin')] : [];
    const list = candidates({ name, versionArgs: [], installHint: '' }, env);
    const p = env.platform === 'win32' ? path.win32 : path.posix;
    for (const d of extra) list.push(p.join(d, name));
    return list.find((c) => env.isFile(c));
  }

  /** FR-002/FR-003: what the dialog offers for install or update, plus the official page. */
  plans(kind: SetupKind, op: 'install' | 'update'): { plans: SetupPlan[]; page: string; name: string } {
    const found = new Set<PackageManager>(managersFor(this.deps.detectEnv.platform).filter((m) => this.find(m)));
    const plans = (op === 'install' ? installPlans : updatePlans)(kind, this.deps.detectEnv.platform, found);
    return { plans, page: OFFICIAL_PAGES[kind], name: SETUP_NAMES[kind] };
  }

  get busy(): boolean { return !!this.running && !this.running.ended; }

  /**
   * Starts one operation. `planIndex` picks one of `plans(kind, op)` (install/update); sign-in runs the harness's own command.
   * Returns at once; progress and the end come as events.
   */
  run(kind: SetupKind, op: SetupOp, planIndex = 0): { ok: true } | { ok: false; error: string } {
    if (this.busy) return { ok: false, error: 'Another setup step is still running.' };
    let file: string | undefined;
    let args: string[];
    if (op === 'signin') {
      const s = SIGN_IN[kind];
      file = this.find(s.bin);
      if (!file) return { ok: false, error: kind === 'copilot' ? 'The GitHub Copilot CLI is not installed. Install it first; Durbar uses it only to sign in.' : `${SETUP_NAMES[kind]} is not installed.` };
      args = [...s.args];
    } else {
      const plan = this.plans(kind, op).plans[planIndex];
      if (!plan) return { ok: false, error: 'No package manager was found for this. Open the official page instead.' };
      file = this.find(plan.bin);
      if (!file) return { ok: false, error: `${plan.bin} was not found.` };
      args = [...plan.args];
    }
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
    const paste = op === 'signin' && SIGN_IN[kind].mode === 'paste';
    let child: ChildLike;
    try {
      child = this.deps.spawn(spawnFile, spawnArgs, {
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_fund: 'false', npm_config_audit: 'false' },
        stdio: [paste ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: verbatim,
        detached: env.platform !== 'win32',
        windowsHide: true,
      });
    } catch (e) {
      return { ok: false, error: 'Could not start it: ' + (e instanceof Error ? e.message : String(e)) };
    }
    const now = this.deps.now ?? Date.now;
    const r = { child, kind, op, out: '', started: now(), ended: false, paste } as NonNullable<HarnessSetup['running']>;
    this.running = r;
    const limit = op === 'signin' ? this.deps.limits?.signin ?? 16 * 60_000 : this.deps.limits?.install ?? 15 * 60_000;
    r.timer = setTimeout(() => { r.reason = 'timeout'; this.deps.killTree(child); }, limit);
    (r.timer as { unref?: () => void }).unref?.(); // a pending limit never keeps the process alive by itself
    const onData = (d: Buffer | string): void => {
      r.out = (r.out + String(d)).slice(-MAX_OUT);
      this.deps.send('harness:progress', this.progress(r));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', () => { r.reason = r.reason ?? 'error'; });
    child.on('close', (code) => { void this.finish(r, code); });
    this.deps.send('harness:progress', this.progress(r));
    return { ok: true };
  }

  private progress(r: NonNullable<HarnessSetup['running']>): SetupProgress {
    const base: SetupProgress = { kind: r.kind, op: r.op, lines: this.safeLines(r.out), elapsedMs: (this.deps.now ?? Date.now)() - r.started };
    if (r.op !== 'signin') return base;
    const v: SignInView = parseSignIn(r.kind, r.out);
    return { ...base, ...(v.url ? { url: v.url } : {}), ...(v.code ? { code: v.code } : {}), needsPaste: v.needsPaste };
  }

  /** The last lines for display, redacted. A sign-in's own link and code are shown separately, so they are left out here. */
  private safeLines(out: string): string[] {
    return lastLines(out).map((l) => redact(l));
  }

  private async finish(r: NonNullable<HarnessSetup['running']>, code: number | null): Promise<void> {
    if (r.ended) return;
    r.ended = true;
    if (r.timer) clearTimeout(r.timer);
    try { await this.deps.redetect(); } catch { /* the cards keep their last state */ }
    const ok = !r.reason && code === 0;
    this.deps.send('harness:done', { kind: r.kind, op: r.op, ok, exitCode: code, ...(r.reason ? { reason: r.reason } : {}), lines: this.safeLines(r.out) });
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
