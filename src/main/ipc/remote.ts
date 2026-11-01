/** IPC for remote control of a live session (Copilot: github.com and GitHub Mobile): the confirmation, the events that end it, and the two handlers (spec 054 FR-003..FR-005, FR-011, FR-062; moved out of main.ts as it was, spec 045 FR-060). */
import { BrowserWindow, shell } from 'electron';
import { nativeConfirm } from '../nativeconfirm';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import type { ActivityDecision } from '../../shared/activity';
import { createRemoteOps } from '../remoteops';

export interface RemoteIpcDeps {
  /** Spec 044 FR-182: the mode a scheduled run holds this session in now. */
  runModeOf?(id: string): string | undefined;
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  toRenderer(channel: string, payload: unknown): void;
  getWin(): BrowserWindow | undefined;
  logActivity(a: AgentInfo, decision: ActivityDecision, action: string): void;
  /** Spec 054 FR-040: the agent's door is closed by the user. */
  doorClosed?(id: string): boolean;
}

/** Registers the handlers and returns the remote-control operations the rest of main uses (end a session, quit, sign-in). */
export function register(deps: RemoteIpcDeps): ReturnType<typeof createRemoteOps> {
  const { agents, router, toRenderer, logActivity } = deps;
  // Spec 054 FR-003..FR-005: remote control of a live session (Copilot: github.com and GitHub Mobile). Validated in remoteops.ts; nothing is logged.
  const remoteOps = createRemoteOps({
    known: (id) => agents.has(id),
    adapterOf: (id) => router.forAgent(id),
    open: (url) => shell.openExternal(url),
    modeOf: (id) => deps.runModeOf?.(id) ?? agents.get(id)?.permMode, // spec 044 FR-182: not during a scheduled run's Allow all either
    // FR-011: a native confirmation the page cannot answer (Cancel is the default), like harness setup's (spec 051 FR-004b)
    confirm: async (id) => {
      const a = agents.get(id);
      return nativeConfirm(deps.getWin(), {
        ok: 'Turn on remote control',
        message: `Control ${a?.label || a?.name || 'this session'} from GitHub?`,
        detail: 'Its messages are sent to GitHub, so it can be followed and steered from github.com and GitHub Mobile. Anyone who can see the session on GitHub can steer it.\n\nOnly continue if you started this in Durbar.',
      });
    },
    doorClosed: (id) => !!deps.doorClosed?.(id),
    record: (id, on) => {
      const a = agents.get(id);
      if (a) logActivity(a, on ? 'remote-on' : 'remote-off', on ? 'Remote control from GitHub turned on' : 'Remote control from GitHub turned off');
    },
  });
  router.onEvent((e) => {
    if (e.type === 'status' && e.status === 'stopped' && !e.agentId) remoteOps.forget(e.sessionId);
  });
  // spec 054 FR-062: the adapter says remote control ended on its own (for example a relaunch could not turn it back on)
  router.onEvent((e) => {
    if (e.type !== 'remote' || e.agentId) return;
    if (e.on) {
      const url = remoteOps.updateUrl(e.sessionId, e.url);
      if (url) toRenderer('agents:remoteUrl', { id: e.sessionId, url });
      return;
    }
    remoteOps.forget(e.sessionId);
    toRenderer('agents:remoteOff', { id: e.sessionId, ...(e.reason ? { reason: e.reason } : {}) });
  });
  ipcHandle('agents:setRemote', (e, id: unknown, on: unknown) => (fromApp(e) ? remoteOps.setRemote(id, on) : { ok: false, error: 'invalid request' }));
  ipcHandle('agents:openRemote', (e, id: unknown) => (fromApp(e) ? remoteOps.openRemote(id) : { ok: false }));
  return remoteOps;
}
