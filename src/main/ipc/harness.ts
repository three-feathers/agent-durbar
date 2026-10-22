/** IPC for harness setup inside the app: install, update and sign-in of an agent app, its official pages and the Copilot sign-in state (specs 051, 060; moved out of main.ts as it was, spec 045 FR-060). */
import { BrowserWindow, dialog, shell } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AdapterRouter } from '../../adapters/router';
import { nodeDetectEnv } from '../../adapters/detect';
import type { AdapterInfo } from '../../shared/adapters';
import { OFFICIAL_PAGES, allowedSignInUrl, isSetupKind, runRequest, simManagers } from '../../shared/harnesssetup';
import type { DevEnv } from '../devhooks';
import { HarnessSetup, confirmText, posixTrusted } from '../harnesssetup';
import { simulatorOn } from '../simguard';
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
}

export function register(deps: HarnessIpcDeps): void {
  const { dev, registry, router, remoteOps, toRenderer, adaptersList } = deps;
  /* Spec 051: harness setup inside the app. One fixed install, update or sign-in at a time (argv, no shell); progress and the end go to
     the window; detection runs again when it ends. Nothing of the output is logged. */
  const sysExe = (name: string): string => path.win32.join(process.env.SystemRoot && path.win32.isAbsolute(process.env.SystemRoot) ? process.env.SystemRoot : 'C:\\Windows', 'System32', name);
  const harnessSetup = new HarnessSetup({
    detectEnv: nodeDetectEnv(),
    spawn: (file, args, opts) => spawn(file, args as string[], opts),
    killTree: (c) => {
      const pid = c.pid;
      if (!pid) return;
      if (process.platform === 'win32') execFile(sysExe('taskkill.exe'), ['/pid', String(pid), '/t', '/f'], () => undefined);
      else {
        try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
        // no SIGKILL once it has exited: its group id could already belong to something else
        const cp = c as unknown as { exitCode: number | null; signalCode: string | null };
        setTimeout(() => { if (cp.exitCode !== null || cp.signalCode !== null) return; try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
      }
    },
    send: (channel: string, p: unknown) => toRenderer(channel, p),
    redetect: async () => { await adaptersList(true); },
    // spec 012 FR-158: only an adapter already created is refreshed (none is created here); Copilot restarts its shared client
    afterSignIn: async (kind: string) => {
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
  /** FR-004b: harness setup answers only the app's own page in the main frame. */
  // spec 060 FR-002: under the simulator the routes are the real ones for this OS, with a typical new machine's package managers
  // spec 060 FR-011: DURBAR_SIM_PLATFORM=win32|darwin|linux shows another OS's routes and commands in the simulator (screenshots)
  const simOs = (): NodeJS.Platform => (['win32', 'darwin', 'linux'].includes(dev.DURBAR_SIM_PLATFORM ?? '') ? dev.DURBAR_SIM_PLATFORM as NodeJS.Platform : process.platform);
  ipcHandle('harness:plans', (e, kind: unknown, op: unknown) => (fromApp(e) && isSetupKind(kind) && (op === 'install' || op === 'update') ? (simulatorOn(dev) ? harnessSetup.plans(kind, op, simManagers(simOs(), dev.DURBAR_SIM_MANAGERS), simOs()) : harnessSetup.plans(kind, op)) : { plans: [], page: '', name: '', manual: [] }));
  ipcHandle('harness:run', async (e, kind: unknown, op: unknown, planIndex: unknown) => {
    // spec 060 FR-012: the window sends only an index into main's fixed table; anything else is refused, never read as "the first"
    const req = fromApp(e) ? runRequest(kind, op, planIndex) : undefined;
    if (!req) return { ok: false, error: 'invalid request' };
    const p = harnessSetup.prepare(req.kind, req.op, req.idx);
    if (!p.ok) return p;
    // FR-004b: an install or update changes the computer, so the main process asks itself, in a native dialog the page cannot
    // answer, showing the real path and arguments. Sign-in runs the harness's own fixed login and changes nothing else.
    if (req.op !== 'signin') {
      const t = confirmText(p.job);
      const opts = { type: 'question' as const, buttons: ['Cancel', t.button], defaultId: 0, cancelId: 0, noLink: true, title: 'Agent Durbar', message: t.message, detail: t.detail };
      const win = deps.getWin();
      const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      if (r.response !== 1) return { ok: false, cancelled: true, error: 'Cancelled.' };
    }
    // spec 060 FR-001: an official installer is downloaded only now, after the user confirmed, from the vendor's fixed hosts
    const ready = await harnessSetup.withScript(p.job);
    if (!ready.ok) return ready;
    return harnessSetup.start(ready.job);
  });
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
}
