/**
 * Agent-app update check (spec 081): runs the checks the pure module describes, one app at a time, keeps the results in memory, and
 * tells the window. It contacts a source only (a) at Durbar's start, once per installed app, in the background, unless the user's
 * switch or the organization's policy turns that off, and (b) when the user asks. Nothing is logged, nothing is saved but the version
 * strings already announced (FR-016). The simulator never gets here (FR-020).
 *
 * Every dependency is injected, so tests run it with fake tools and fake lookups.
 */
import * as path from 'path';
import { execFound } from '../adapters/detect';
import type { DetectEnv, Exec } from '../adapters/detect';
import { SETUP_NAMES } from '../shared/harnesssetup';
import type { SetupKind } from '../shared/harnesssetup';
import {
  MAX_TOOL_OUTPUT, announceRule, brewInfoCmd, brewOutdatedCmd, classifyFailure, copilotVersionFromPath, decide, decideClaudeChannels, lookupLatest, npmCheck, npmOwns, parseBrewInfo, parseBrewOutdated,
  parseNpmView, parseVersionField, parseWingetList, pathFor, policyView, sourceLabel, sourceOf, startCheckAllowed, versionFromCaskroom, versionFromPackageJson, versionFromWingetPath, wingetCheck, WINGET_IDS, WINGET_TERMS_REASON,
} from '../shared/updatecheck';
import type { Announced, CheckCmd, CheckResult, LookupGet, PolicyView, UpdatePolicy, UpdateSource } from '../shared/updatecheck';

export const APPS: readonly SetupKind[] = ['claude', 'codex', 'copilot'];
/** One app's check may take this long (FR-003). */
export const CHECK_LIMIT_MS = 30_000;

/** What detection says about an app (the adapters list), for the installed version. */
export interface InstalledCopy { state: string; version?: string }

export interface UpdatesView {
  results: CheckResult[];
  /** Apps whose check is running now. */
  checking: SetupKind[];
  /** The user's switch (Settings > Agent apps). */
  startCheck: boolean;
  policy: PolicyView;
  /** The bundled Copilot runtime (read from the SDK's package.json), shown with "updates with Durbar". */
  runtime?: string;
  /** Apps with an update waiting for sessions to end, with how many. */
  waiting: Partial<Record<SetupKind, number>>;
  /** Set on a change that should announce a new version in the window (one toast per app and version). */
  announce?: { app: SetupKind; version: string; name: string };
}

export interface CheckerDeps {
  detectEnv: DetectEnv;
  exec: Exec;
  lookup: LookupGet;
  /** Detection's answer per app (the cached adapters list, `refresh` false). */
  copies(): Promise<Partial<Record<SetupKind, InstalledCopy>>>;
  /** The real path of the copy Durbar finds for an app (symlinks resolved), or undefined. */
  locate(app: SetupKind): string | undefined;
  /** A tool by name on this computer (npm, brew, winget): the first found. */
  findTool(name: 'npm' | 'brew' | 'winget'): string | undefined;
  /** At most `cap` bytes of a small text file, or undefined. */
  readText(file: string, cap: number): string | undefined;
  policy(): UpdatePolicy;
  userSwitch(): boolean;
  simulator: boolean;
  /** Wall clock (the card's time) and a monotonic clock. */
  wall(): number;
  announced(): Announced;
  saveAnnounced(app: SetupKind, version: string): void;
  /** True while the window shows Settings > Agent apps (the card is then the announcement). */
  settingsVisible(): boolean;
  emit(v: UpdatesView): void;
  runtime?: () => string | undefined;
  waiting?: () => Partial<Record<SetupKind, number>>;
  /** Defers the start check until after the current work (main passes `setImmediate`). */
  defer?: (fn: () => void) => void;
  limitMs?: number;
}

export class UpdateChecker {
  private results = new Map<SetupKind, CheckResult>();
  private checking = new Set<SetupKind>();
  private all: Promise<void> | undefined;
  private inflight = new Map<SetupKind, Promise<CheckResult | undefined>>();
  private chain: Promise<unknown> = Promise.resolve();
  private started = false;

  constructor(private readonly d: CheckerDeps) {}

  view(announce?: UpdatesView['announce']): UpdatesView {
    const runtime = this.d.runtime?.();
    return {
      results: [...this.results.values()],
      checking: [...this.checking],
      startCheck: this.d.userSwitch(),
      policy: policyView(this.d.policy()),
      ...(runtime ? { runtime } : {}),
      waiting: this.d.waiting?.() ?? {},
      ...(announce ? { announce } : {}),
    };
  }

  private changed(announce?: UpdatesView['announce']): void {
    try { this.d.emit(this.view(announce)); } catch { /* the window is gone */ }
  }

  /**
   * Plan D6, FR-003, FR-022: called once from main after the office is shown and detection has finished. One check per installed app,
   * in the background. Returns whether a check was scheduled (never on the simulator, with the switch off, or when the policy says no or cannot be read).
   */
  scheduleStart(): boolean {
    if (this.started) return false;
    this.started = true;
    if (!startCheckAllowed({ simulator: this.d.simulator, userSwitch: this.d.userSwitch(), policy: this.d.policy() })) return false;
    (this.d.defer ?? ((fn) => setImmediate(fn)))(() => { void this.checkAll(); });
    return true;
  }

  /** All installed apps, one at a time. A call while a run is going joins it (no doubling). */
  checkAll(): Promise<void> {
    if (policyView(this.d.policy()).checkHidden) return Promise.resolve();
    if (this.all) return this.all;
    const run = (async () => {
      for (const app of APPS) await this.checkApp(app);
    })().finally(() => { this.all = undefined; });
    this.all = run;
    return run;
  }

  /** One app (a card's Check, or the fresh check before a confirmation). Joins a check of that app that is running. */
  checkApp(app: SetupKind, opts: { acceptTerms?: boolean } = {}): Promise<CheckResult | undefined> {
    if (policyView(this.d.policy()).checkHidden) return Promise.resolve(this.results.get(app));
    const running = this.inflight.get(app);
    if (running) return running;
    const p = this.chain.then(() => this.run(app, opts)).finally(() => { this.inflight.delete(app); });
    this.chain = p.catch(() => undefined);
    this.inflight.set(app, p);
    return p;
  }

  /** The kept result for an app, or undefined. */
  result(app: SetupKind): CheckResult | undefined {
    return this.results.get(app);
  }

  /**
   * After an update ended: detection already ran again, so the card learns the new version without contacting any source. At or above
   * the latest it knew: up to date; otherwise the old answer is dropped (the card says Not checked) rather than shown stale.
   */
  async afterUpdate(app: SetupKind): Promise<void> {
    const r = this.results.get(app);
    if (!r) return;
    const copy = (await this.d.copies())[app];
    const installed = parseVersionField(copy?.version);
    const target = r.stable ?? r.latest;
    if (installed && target && decide(installed, target).state === 'up-to-date') {
      const { newerOnLatest: _n, ...rest } = r;
      void _n;
      this.results.set(app, { ...rest, state: 'up-to-date', installed, checkedAt: this.d.wall() });
    } else this.results.delete(app);
    this.changed();
  }

  /** The version an update would install: the kept `update-available` result's latest (Claude native: the stable channel). */
  checkedVersion(app: SetupKind): string | undefined {
    const r = this.results.get(app);
    return r && r.state === 'update-available' ? (r.stable ?? r.latest) : undefined;
  }

  private async run(app: SetupKind, opts: { acceptTerms?: boolean }): Promise<CheckResult | undefined> {
    this.checking.add(app);
    this.changed();
    let res: CheckResult | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      res = await Promise.race([
        this.check(app, opts),
        new Promise<CheckResult>((resolve) => { timer = setTimeout(() => resolve(this.fail(app, undefined, 'timed out')), this.d.limitMs ?? CHECK_LIMIT_MS); }),
      ]);
    } catch (e) {
      res = this.fail(app, undefined, shortReason(e));
    } finally {
      if (timer) clearTimeout(timer);
    }
    this.checking.delete(app);
    if (res) this.results.set(app, res);
    else this.results.delete(app);
    let announce: UpdatesView['announce'];
    if (res) {
      const a = announceRule(res, this.d.announced(), this.d.settingsVisible());
      if (a.save) {
        this.d.saveAnnounced(app, a.save);
        if (a.toast) announce = { app, version: a.save, name: SETUP_NAMES[app] };
      }
    }
    this.changed(announce);
    return res;
  }

  private fail(app: SetupKind, src: UpdateSource | undefined, reason: string, installed?: string): CheckResult {
    return { app, state: 'could-not-check', ...(installed ? { installed } : {}), source: src ? sourceLabel(src) : '', sourceKind: src?.kind ?? 'outside', reason, checkedAt: this.d.wall() };
  }

  private async check(app: SetupKind, opts: { acceptTerms?: boolean }): Promise<CheckResult | undefined> {
    const env = this.d.detectEnv;
    const copies = await this.d.copies();
    const copy = copies[app];
    if (app !== 'copilot' && (!copy || copy.state === 'not-installed')) return undefined;
    const real = this.d.locate(app);
    if (!real) return app === 'copilot' ? undefined : this.fail(app, undefined, 'the program was not found');
    const src = sourceOf(app, real, env.platform, { homedir: env.homedir, env: env.env });
    const base = { app, source: sourceLabel(src), sourceKind: src.kind, ...(src.kind === 'outside' && src.hint ? { hint: src.hint } : {}) };
    // the installed version: detection's for Claude and Codex; the Copilot CLI is never run, so it comes from the copy's own files (FR-002)
    const installed = app === 'copilot' ? this.copilotInstalled(src, real) : parseVersionField(copy?.version);
    if (src.kind === 'outside') return { ...base, state: 'outside', ...(installed ? { installed } : {}), checkedAt: this.d.wall() };
    if (!installed) return this.fail(app, src, app === 'copilot' ? "the version could not be read from the program's files" : 'the installed version could not be read');
    try {
      return { ...base, ...(await this.compare(app, src, installed, opts)), installed, checkedAt: this.d.wall() };
    } catch (e) {
      return this.fail(app, src, shortReason(e), installed);
    }
  }

  private copilotInstalled(src: UpdateSource, real: string): string | undefined {
    const env = this.d.detectEnv;
    switch (src.kind) {
      case 'npm': {
        // <prefix>/lib/node_modules/@github/copilot/...: the package.json of that folder
        const segs = real.split(env.platform === 'win32' ? /[\\/]/ : '/');
        const i = segs.map((s) => s.toLowerCase()).lastIndexOf('node_modules');
        if (i < 0 || segs[i + 1]?.toLowerCase() !== '@github' || segs[i + 2]?.toLowerCase() !== 'copilot') return undefined;
        const root = segs.slice(0, i + 3).join(env.platform === 'win32' ? '\\' : '/');
        const t = this.d.readText(pathFor(env.platform).join(root, 'package.json'), MAX_TOOL_OUTPUT); // the target platform's flavour, not the host's
        return t === undefined ? undefined : versionFromPackageJson(t);
      }
      case 'brew': return versionFromCaskroom(real);
      case 'winget': return versionFromWingetPath(real);
      case 'official': return copilotVersionFromPath(real, env.platform, { homedir: env.homedir, env: env.env });
      default: return undefined;
    }
  }

  /** Runs one tool command with the owning tool's path (a missing tool is a short reason, never a guess). */
  private async tool(c: CheckCmd, file: string): Promise<string> {
    const r = await execFound(file, c.args, this.d.detectEnv, this.d.exec, { timeoutMs: CHECK_LIMIT_MS, env: c.env });
    if (r.timedOut) throw new Error('timed out');
    if (r.errorCode || r.code !== 0) {
      const cls = classifyFailure({ code: r.code, errorCode: r.errorCode, text: `${r.stderr}\n${r.stdout}`.slice(-2000), platform: this.d.detectEnv.platform });
      throw new Error(cls === 'network' ? 'network problem' : cls === 'admin' ? 'not allowed' : `exit ${r.code ?? r.errorCode ?? '?'}`);
    }
    return r.stdout;
  }

  private async compare(app: SetupKind, src: UpdateSource, installed: string, opts: { acceptTerms?: boolean }): Promise<Pick<CheckResult, 'state'> & Partial<CheckResult>> {
    const env = this.d.detectEnv;
    switch (src.kind) {
      case 'npm': {
        let npm = src.npm && env.isFile(src.npm) ? src.npm : undefined;
        if (!npm) {
          const first = this.d.findTool('npm');
          if (first && npmOwns(first, this.d.locate(app) ?? '', env.platform)) npm = first;
        }
        if (!npm) throw new Error('npm for this copy was not found');
        const latest = parseNpmView(await this.tool(npmCheck(app), npm));
        if (!latest) throw new Error('unexpected answer');
        const d = decide(installed, latest);
        return { latest, state: d.state, ...(d.installedNewer ? { installedNewer: true } : {}) };
      }
      case 'brew': {
        const brew = path.posix.join(src.prefix, 'bin', 'brew');
        const file = env.isFile(brew) ? brew : undefined;
        if (!file) throw new Error('brew for this copy was not found');
        const info = parseBrewInfo(await this.tool(brewInfoCmd(src.cask), file), src.cask);
        if (!info) throw new Error('unexpected answer');
        let latest = info.latest;
        let flagged = info.outdated === true;
        if (info.outdated === undefined || info.autoUpdates) {
          // the first answer has no usable `outdated` (or the cask updates itself): the second run, with --greedy only for a self-updating cask
          const o = parseBrewOutdated(await this.tool(brewOutdatedCmd(src.cask, info.autoUpdates), file), src.cask);
          if (o === undefined) throw new Error('unexpected answer');
          flagged = o !== null;
          if (o) latest = o.current;
        }
        const d = decide(installed, latest);
        return { latest, state: flagged ? d.state : 'up-to-date', asHomebrew: true, ...(d.installedNewer ? { installedNewer: true } : {}) };
      }
      case 'winget': {
        const file = this.d.findTool('winget');
        if (!file) throw new Error('winget was not found');
        const id = WINGET_IDS[app];
        if (!id) throw new Error('no winget route');
        // the background check never accepts source agreements for the user; an explicit check carries the flag only after the terms note was confirmed (FR-004)
        const a = parseWingetList(await this.toolWinget(wingetCheck(id, opts.acceptTerms === true), file), id);
        if (a.kind === 'terms') throw new Error(WINGET_TERMS_REASON);
        if (a.kind === 'unknown') throw new Error('unexpected answer');
        if (a.kind === 'current') return { latest: installed, state: 'up-to-date' };
        const d = decide(installed, a.available);
        return { latest: a.available, state: d.state, ...(d.installedNewer ? { installedNewer: true } : {}) };
      }
      case 'official': {
        const l = await lookupLatest(app, this.d.lookup);
        if (app === 'claude' && l.stable) {
          const d = decideClaudeChannels(installed, l.stable, l.latest);
          return { latest: l.latest, stable: l.stable, state: d.state, ...(d.newerOnLatest ? { newerOnLatest: d.newerOnLatest } : {}), ...(d.installedNewer ? { installedNewer: true } : {}) };
        }
        const d = decide(installed, l.latest);
        return { latest: l.latest, state: d.state, ...(d.installedNewer ? { installedNewer: true } : {}) };
      }
      default: throw new Error('outside');
    }
  }

  /** winget prints its "terms" answer on a non-zero exit, so that text is read too. */
  private async toolWinget(c: CheckCmd, file: string): Promise<string> {
    const r = await execFound(file, c.args, this.d.detectEnv, this.d.exec, { timeoutMs: CHECK_LIMIT_MS, env: c.env });
    if (r.timedOut) throw new Error('timed out');
    const text = `${r.stdout}\n${r.stderr}`;
    if (r.errorCode) throw new Error(`exit ${r.errorCode}`);
    // "No installed package found" and the terms answer arrive on a non-zero exit; parseWingetList reads both
    if (r.code !== 0 && !/source agreements|terms of transaction|no installed package found|no applicable upgrade|no newer package versions/i.test(text)) throw new Error(`exit ${r.code ?? '?'}`);
    return text;
  }
}

/** A short reason for the card: a known short word, else a generic one. Raw output is never used. */
export function shortReason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // Chromium's network errors (net::ERR_INTERNET_DISCONNECTED, ERR_NAME_NOT_RESOLVED, ERR_PROXY_*, ...) and Node's are a network problem (FR-003, FR-014)
  if (/\bnet::ERR_|\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b/.test(m)) return 'network problem';
  return /^[a-z0-9 .,'-]{1,80}$/i.test(m) ? m : 'unexpected answer';
}
