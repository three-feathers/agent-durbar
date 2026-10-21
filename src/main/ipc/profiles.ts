/** IPC for the custom agent of a session: list, select; a repository agent needs a confirmation for its exact file (spec 043 FR-003; moved out of main.ts as it was, spec 045 FR-060). */
import { ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import { errText } from '../agentops';
import type { AgentTrustStore } from '../agenttrust';
import { hashAgentFile } from '../agenttrust';
import { PROFILE_ID } from '../folders';
import type { EnsureLive } from './types';

export interface ProfilesIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  /** Created when the app is ready: read when a handler runs. */
  getAgentTrust(): AgentTrustStore | undefined;
  wsKey(a: AgentInfo): string;
  ensureLive: EnsureLive;
}

export function register(deps: ProfilesIpcDeps): void {
  const { agents, router, wsKey, ensureLive } = deps;
  const agentTrust = deps.getAgentTrust;
  // ---- custom agent per session (spec 043 FR-003): list, select; a repository agent needs a confirmation for its exact file ----
  ipcHandle('agents:listProfiles', async (_e, id: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad?.listAgentProfiles) return { ok: false, error: 'This agent app has no profiles.', profiles: [] };
    try {
      await ensureLive(a); // a restored or ended agent starts its session (no prompt, no credits)
      const profiles = (await ad.listAgentProfiles(a.id)).map((p) => ({ ...p, trusted: p.source !== 'repo' || (!!p.path && agentTrust()?.isTrusted(wsKey(a), p.id, hashAgentFile(p.path))) }));
      return { ok: true, profiles };
    } catch (err) {
      return { ok: false, error: errText(err), profiles: [] };
    }
  });
  ipcHandle('agents:selectProfile', async (_e, id: unknown, profileId: unknown, confirm: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad?.selectAgentProfile) return { ok: false, error: 'This agent app has no profiles.' };
    if (profileId !== null && (typeof profileId !== 'string' || !PROFILE_ID.test(profileId))) return { ok: false, error: 'Unknown agent.' };
    try {
      await ensureLive(a);
      if (profileId !== null) {
        const p = (await ad.listAgentProfiles?.(a.id))?.find((x) => x.id === profileId);
        if (!p) return { ok: false, error: 'That agent is not available in this session.' };
        if (p.source === 'repo') {
          const sha = p.path ? hashAgentFile(p.path) : undefined;
          if (!sha) return { ok: false, error: 'The agent file could not be read.' };
          if (!agentTrust()?.isTrusted(wsKey(a), p.id, sha)) {
            if (confirm !== true) return { ok: false, needsConfirm: true, profile: p };
            agentTrust()?.trust(wsKey(a), p.id, sha);
          }
        }
      }
      const profile = await ad.selectAgentProfile(a.id, profileId as string | null);
      return { ok: true, profile };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });
}
