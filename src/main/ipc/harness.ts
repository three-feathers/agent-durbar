/** IPC for harness setup inside the app: install, update and sign-in of an agent app, its official pages and the Copilot sign-in state (specs 051, 060; moved out of main.ts as it was, spec 045 FR-060). */
import { BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AdapterRouter } from '../../adapters/router';
import { killChildTree, nodeDetectEnv, nodeExec } from '../../adapters/detect';
import type { AdapterInfo } from '../../shared/adapters';
import { OFFICIAL_PAGES, SETUP_NAMES, allowedSignInUrl, isSetupKind, runRequest, simManagers } from '../../shared/harnesssetup';
import type { SetupKind } from '../../shared/harnesssetup';
import { policyView, wingetTermsQuestion } from '../../shared/updatecheck';
import { parseVersionField } from '../../shared/versionfield';
import { UpdateChecker } from '../updatecheck';
import type { UpdatesView } from '../updatecheck';
import { UpdateGate, updateRunRefusal } from '../updategate';
import type { GateChoice, SessionCount } from '../updategate';
import { electronRequestFactory, makeDownloadGet, makeLookupGet } from '../netget';
import { updatePolicy } from '../updatepolicy';
import type { SettingsStore } from '../settings';
import type { DevEnv } from '../devhooks';
import { HarnessSetup, confirmText, posixTrusted } from '../harnesssetup';
import { simulatorOn } from '../simguard';
import { accountCheck, createAccountCache } from '../accounts';
import { copilotDir, copilotServerNames } from '../mcpfiles';
import type { createRemoteOps } from '../remoteops';

export interface HarnessIpcDeps {
  dev: DevEnv;
  registry: AdapterRegistry;
  router: AdapterRouter;
  remoteOps: ReturnType<typeof createRemoteOps>;
  toRenderer(channel: string, payload: unknown): void;
  getWin(): BrowserWindow | undefined;
  /** The cached list of agent apps; `true` probes again. */
  adaptersList(refresh: boolean): Promise<AdapterInfo[]>;
  /** Read when a handler runs (created when the app is ready). */
  getSettingsStore(): SettingsStore | undefined;
  /** Spec 081 FR-013: the open sessions of an app's adapter, and ending them (`stopTurnOp`, then `endSessionOp`). */
  sessions: { count(kind: SetupKind): SessionCount; endAll(kind: SetupKind): Promise<void> };
  /** Spec 081 FR-013: scheduled prompts held while an update lock is on may go once it is released. */
  lockReleased(kind: SetupKind): void;
}

/** What main needs from the harness IPC: the update lock (no start or resume while an update runs) and the checker (the start check). */
export interface HarnessIpc {
  blocksStart(kind: string): boolean;
  checker: UpdateChecker;
  releaseAll(): void;
  /** The window reloaded or went away: a lock waiting for its answer is released (review on #721). */
  releaseAsking(): void;
}

export function register(deps: HarnessIpcDeps): HarnessIpc {
  const { dev, registry, router, remoteOps, toRenderer, adaptersList } = deps;
  /* Spec 051: harness setup inside the app. One fixed install, update or sign-in at a time (argv, no shell); progress and the end go to
     the window; detection runs again when it ends. Nothing of the output is logged. */
  /* Spec 051 FR-014, FR-015: the account each app reports, cached for the run; sent only to the window, never logged. None under
     the simulator (spec 010 FR-030): its page answers a fake identity itself. */
  const accounts = createAccountCache({
    list: () => adaptersList(false),
    check: accountCheck({ simulator: simulatorOn(dev), has: (id) => registry.has(id), instance: (id) => router.instance(id), copilotServers: () => copilotServerNames(copilotDir(dev)) }),
  });
  const detectEnv = nodeDetectEnv();
  const harnessSetup = new HarnessSetup({
    detectEnv,
    exec: nodeExec,
    checked: (kind) => (policyView(updatePolicy()).checkHidden ? undefined : checker.checkedVersion(kind)),
    policy: updatePolicy,
    regular: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
    snapshot: async () => {
      const out: Partial<Record<SetupKind, { version?: string; where?: string }>> = {};
      for (const i of await adaptersList(false)) if (isSetupKind(i.id)) out[i.id] = { ...(i.version ? { version: i.version } : {}), ...(i.where ? { where: i.where } : {}) };
      return out;
    },
    httpGet: makeDownloadGet(electronRequestFactory()), // spec 081 T024: the installer download follows the proxy and the OS certificates too
    spawn: (file, args, opts) => spawn(file, args as string[], opts),
    killTree: (c) => killChildTree(c as unknown as Parameters<typeof killChildTree>[0], process.platform, process.env), // the one tree kill (taskkill /t /f; SIGTERM to the group, SIGKILL after 3 s)
    send: (channel: string, p: unknown) => {
      toRenderer(channel, p);
      // spec 081 FR-013: the update lock is held to the end of the run; the card then needs no network to know the new version
      const done = p as { kind?: string; op?: string; ok?: boolean };
      if (channel === 'harness:done' && done.op === 'update' && isSetupKind(done.kind)) {
        gate.release(done.kind);
        void checker.afterUpdate(done.kind).catch(() => undefined);
      }
    },
    redetect: async () => { await adaptersList(true); },
    // spec 012 FR-158: only an adapter already created is refreshed (none is created here); Copilot restarts its shared client
    afterSignIn: async (kind: string) => {
      accounts.forget(kind); // spec 051 FR-014: the account line is asked again after a sign-in
      const ad = router.created().find((x) => x.id === kind);
      if (!ad?.refreshAuth) return;
      // spec 012 FR-158 / 054 FR-011: a reconnected session is not remote any more; say so instead of keeping a stale Remote chip
      for (const id of remoteOps.ids()) if (router.adapterIdOf(id) === kind) { remoteOps.forget(id); toRenderer('agents:remoteOff', id); }
      await ad.refreshAuth();
    },
    realpath: (p: string) => fs.realpathSync(p),
    trustedPath: (p: string) => process.platform === 'win32' || posixTrusted(p, (q) => fs.statSync(q).mode),
    isRoot: () => typeof process.getuid === 'function' && process.getuid() === 0, // spec 060 FR-001
  } as ConstructorParameters<typeof HarnessSetup>[0]);
  // spec 081: the checker's tools are the ones the runner finds (the npm that owns a copy, its brew, winget), so both share these
  let settingsVisible = false;
  const copiesNow = async (): Promise<Partial<Record<SetupKind, { state: string; version?: string; where?: string }>>> => {
    const out: Partial<Record<SetupKind, { state: string; version?: string; where?: string }>> = {};
    for (const i of await adaptersList(false)) if (isSetupKind(i.id)) out[i.id] = { state: i.state, ...(i.version ? { version: i.version } : {}), ...(i.where ? { where: i.where } : {}) };
    return out;
  };
  const runtimeVersion = (): string | undefined => {
    // the SDK's package.json is not an export, so walk up from its entry file to the folder whose package.json names it (FR-002)
    try {
      let dir = path.dirname(require.resolve('@github/copilot-sdk'));
      for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
        const f = path.join(dir, 'package.json');
        if (!fs.existsSync(f)) continue;
        const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { name?: unknown; version?: unknown };
        if (j.name === '@github/copilot-sdk') return parseVersionField(j.version);
      }
    } catch { /* not shown */ }
    return undefined;
  };
  const emitUpdates = (v: UpdatesView): void => toRenderer('harness:updatesChanged', v);
  const gate: UpdateGate = new UpdateGate({
    count: deps.sessions.count,
    endAll: deps.sessions.endAll,
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
    changed: () => emitUpdates(checker.view()),
    // a waiting update that ended before it ran (the confirmation was cancelled, or it failed): the window hears it like a finished run
    failed: (kind, r) => toRenderer('harness:done', { kind, op: 'update', ok: false, lines: [], reason: r.cancelled ? 'cancelled' : 'error', ...(r.error ? { error: r.error } : {}) }),
    released: deps.lockReleased,
  });
  const checker: UpdateChecker = new UpdateChecker({
    detectEnv,
    exec: nodeExec,
    lookup: makeLookupGet(electronRequestFactory()),
    copies: copiesNow,
    locate: (app) => { const at = harnessSetup.find(app); if (!at) return undefined; try { return fs.realpathSync(at); } catch { return undefined; } },
    findTool: (name) => harnessSetup.find(name),
    readText: (file, cap) => { try { const b = fs.readFileSync(file); return b.length > cap ? undefined : b.toString('utf8'); } catch { return undefined; } },
    policy: updatePolicy,
    userSwitch: () => deps.getSettingsStore()?.checkUpdatesAtStart ?? true,
    simulator: simulatorOn(dev),
    wall: () => Date.now(),
    announced: () => deps.getSettingsStore()?.announcedVersions ?? {},
    saveAnnounced: (app, v) => { deps.getSettingsStore()?.setAnnouncedVersion(app, v); },
    settingsVisible: () => settingsVisible,
    emit: emitUpdates,
    runtime: runtimeVersion,
    waiting: () => gate.waiting(),
  });
  /** FR-004b: harness setup answers only the app's own page in the main frame. */
  // spec 060 FR-002: under the simulator the routes are the real ones for this OS, with a typical new machine's package managers
  // spec 060 FR-011: DURBAR_SIM_PLATFORM=win32|darwin|linux shows another OS's routes and commands in the simulator (screenshots)
  const simOs = (): NodeJS.Platform => (['win32', 'darwin', 'linux'].includes(dev.DURBAR_SIM_PLATFORM ?? '') ? dev.DURBAR_SIM_PLATFORM as NodeJS.Platform : process.platform);
  /** Spec 081: the real routes; for an update, the Codex label is read first (it decides whether `codex update` may run). Not used under the simulator. */
  const realPlans = async (kind: SetupKind, op: 'install' | 'update') => {
    if (op === 'update') await harnessSetup.warm(kind);
    return harnessSetup.plans(kind, op);
  };
  /** Spec 081 FR-008: the native confirmation of an install or update, showing the real path, the arguments and (for an update) the target version and what the route checks. */
  const confirm = async (job: Parameters<typeof confirmText>[0]): Promise<boolean> => {
    const t = confirmText(job);
    const opts = { type: 'question' as const, buttons: ['Cancel', t.button], defaultId: 0, cancelId: 0, noLink: true, title: 'Agent Durbar', message: t.message, detail: t.detail };
    const win = deps.getWin();
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return r.response === 1;
  };
  /** Spec 081 plan D5 step 3: the fresh check (FR-023), prepare, the native confirmation, the count again, then the run. */
  const runUpdate = async (kind: SetupKind, idx: number, recount: () => number): Promise<{ ok: boolean; error?: string; cancelled?: boolean; recount?: boolean }> => {
    const pv = policyView(updatePolicy());
    if (!pv.checkHidden) {
      // the source may have moved on since the last check: the dialog shows what will be installed now. A source that cannot be reached gives no update.
      const adapter = (await adaptersList(false)).find((i) => i.id === kind);
      const fresh = await checker.checkApp(kind);
      if (fresh && fresh.state === 'could-not-check' && adapter?.state !== 'too-old') return { ok: false, error: `Durbar could not check what is newest${fresh.reason ? ' (' + fresh.reason + ')' : ''}, so it does not update now. Try again later.` };
      if (fresh && (fresh.state === 'up-to-date' || fresh.state === 'outside') && adapter?.state !== 'too-old') return { ok: false, error: fresh.state === 'outside' ? "This copy was installed outside Durbar's routes: update it with the tool that installed it." : `${SETUP_NAMES[kind]} is already up to date.` };
    }
    await harnessSetup.warm(kind);
    const p = harnessSetup.prepare(kind, 'update', idx);
    if (!p.ok) return p;
    if (!(await confirm(p.job))) return { ok: false, cancelled: true, error: 'Cancelled.' };
    // spec 081 FR-013: count again after the confirmation; a session open by now sends the user back to the gate dialog
    if (recount() > 0) return { ok: false, recount: true };
    const ready = await harnessSetup.withScript(p.job);
    if (!ready.ok) return ready;
    return harnessSetup.start(ready.job);
  };
  ipcHandle('harness:plans', (e, kind: unknown, op: unknown) => (fromApp(e) && isSetupKind(kind) && (op === 'install' || op === 'update') ? (simulatorOn(dev) ? harnessSetup.plans(kind, op, simManagers(simOs(), dev.DURBAR_SIM_MANAGERS), simOs()) : realPlans(kind, op)) : { plans: [], page: '', name: '', manual: [] }));
  ipcHandle('harness:run', async (e, kind: unknown, op: unknown, planIndex: unknown, gateArg?: unknown) => {
    // spec 060 FR-012: the window sends only an index into main's fixed table; anything else is refused, never read as "the first"
    const req = fromApp(e) ? runRequest(kind, op, planIndex) : undefined;
    if (!req) return { ok: false, error: 'invalid request' };
    if (req.op === 'update') {
      const refused = updateRunRefusal(policyView(updatePolicy()));
      if (refused) return { ok: false, error: refused };
      const g: GateChoice | undefined = gateArg === 'wait' || gateArg === 'end' || gateArg === 'cancel' ? gateArg : undefined;
      if (gateArg !== undefined && g === undefined) return { ok: false, error: 'invalid request' };
      return gate.request(req.kind, g, (recount) => runUpdate(req.kind, req.idx, recount));
    }
    const p = harnessSetup.prepare(req.kind, req.op, req.idx);
    if (!p.ok) return p;
    // FR-004b: an install changes the computer, so the main process asks itself, in a native dialog the page cannot
    // answer, showing the real path and arguments. Sign-in runs the harness's own fixed login and changes nothing else.
    if (req.op !== 'signin' && !(await confirm(p.job))) return { ok: false, cancelled: true, error: 'Cancelled.' };
    // spec 060 FR-001: an official installer is downloaded only now, after the user confirmed, from the vendor's fixed hosts
    const ready = await harnessSetup.withScript(p.job);
    if (!ready.ok) return ready;
    return harnessSetup.start(ready.job);
  });
  /* Spec 081 FR-003, FR-012: the kept check results; 'check' asks anew (all apps, or one). Another frame gets an empty view (review on #721). */
  const emptyView = (): UpdatesView => ({ results: [], checking: [], startCheck: false, policy: { checkHidden: true, installBlocked: true, unreadable: false, startAllowed: false }, waiting: {} });
  /** FR-004: main asks itself, natively, before one winget check may accept the source terms (the window cannot approve it). */
  const askWingetTerms = async (): Promise<boolean> => {
    const opts = { type: 'question' as const, buttons: ['Cancel', 'Accept and check'], defaultId: 0, cancelId: 0, noLink: true, title: 'Agent Durbar', message: 'Accept the winget source terms?',
      detail: "winget needs you to accept the terms of its package source (the Microsoft Store and winget sources) before it can answer. Durbar never accepts them for you. 'Accept and check' runs this one check with --accept-source-agreements." };
    const win = deps.getWin();
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return r.response === 1;
  };
  ipcHandle('harness:updates', async (e, what?: unknown, app?: unknown) => {
    if (!fromApp(e)) return emptyView();
    if (what === 'check') {
      if (isSetupKind(app)) {
        const acceptTerms = !simulatorOn(dev) && wingetTermsQuestion(checker.result(app)) ? await askWingetTerms() : false;
        await checker.checkApp(app, { acceptTerms });
      } else await checker.checkAll();
    }
    return checker.view();
  });
  /* Spec 081 FR-016: the window says whether Settings > Agent apps is on screen (then the card is the announcement and no toast is shown) */
  ipcHandle('harness:visible', (e, on: unknown) => { if (!fromApp(e)) return false; settingsVisible = on === true; return true; });
  ipcHandle('harness:paste', (e, text: unknown) => (fromApp(e) ? harnessSetup.paste(text) : { ok: false, error: 'invalid request' }));
  ipcHandle('harness:cancel', (e) => fromApp(e) && harnessSetup.cancel());
  ipcHandle('harness:openPage', async (e, kind: unknown) => {
    if (!fromApp(e) || !isSetupKind(kind)) return { ok: false };
    await shell.openExternal(OFFICIAL_PAGES[kind]);
    return { ok: true };
  });
  ipcHandle('harness:openSignIn', async (e, kind: unknown, url: unknown) => {
    // FR-005: only a link on that harness's own sign-in hosts is ever opened, and the parsed, normalised form of it
    if (!fromApp(e) || !isSetupKind(kind) || typeof url !== 'string' || !allowedSignInUrl(kind, url)) return { ok: false };
    await shell.openExternal(new URL(url).href);
    return { ok: true };
  });
  // FR-022: `true` = Settings opened (cached once-per-run facts kept); 'check' = Check again or a finished sign-in (asked anew)
  ipcHandle('harness:accounts', async (e, refresh: unknown) => (fromApp(e) ? accounts.get(refresh === true || refresh === 'check', refresh === 'check') : {}));
  ipcHandle('harness:copilotAuth', async (e) => {
    if (!fromApp(e)) return { known: false };
    const pw = harnessSetup.pwshMissing() ? { pwshMissing: true } : {}; // spec 052 FR-073: Windows only, a file check, no process
    try {
      const ad = registry.has('copilot') ? router.instance('copilot') : undefined;
      if (!ad || typeof ad.authStatus !== 'function') return { known: false, ...pw };
      return { known: true, ...(await ad.authStatus()), ...pw };
    } catch {
      return { known: false, ...pw };
    }
  });
  return { blocksStart: (kind) => isSetupKind(kind) && gate.blocksStart(kind), checker, releaseAll: () => gate.releaseAll(), releaseAsking: () => gate.releaseAsking() };
}
