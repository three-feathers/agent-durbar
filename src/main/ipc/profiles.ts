/** IPC for the custom agent of a session: list, select; a repository agent needs a confirmation for its exact file (spec 043 FR-003; moved out of main.ts as it was, spec 045 FR-060). */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import { errText } from '../agentops';
import type { AgentTrustStore } from '../agenttrust';
import { hashAgentFile } from '../agenttrust';
import { PROFILE_ID } from '../folders';
import { createProfileFile, listProfileFiles, pathOfProfile, profileDirs, profileFolders, readProfileFile, saveProfileFile, userAgentDirs } from '../profilefiles';
import { openInVSCode } from '../vscode';
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

  // ---- profile files (spec 043 FR-010..FR-013): main owns every path; the window sends ids from the list (or app + place + name) ----
  /** The office's folders; the New profile form gets each as an id (a hash of its path) and main accepts only an id of a folder still here. */
  const officeFolders = (): string[] => [...new Set([...agents.values()].flatMap((a) => (a.folders && a.folders.length ? a.folders : [a.cwd])).filter((f): f is string => typeof f === 'string' && !!f))];
  const dirs = () => profileDirs(officeFolders());
  ipcHandle('profiles:listFiles', () => {
    const d = dirs();
    return { ok: true, folders: profileFolders(d), files: listProfileFiles(d), userDirs: userAgentDirs(d) }; // FR-013: the New profile hint shows the real user folders (CLAUDE_CONFIG_DIR)
  });
  ipcHandle('profiles:read', (_e, id: unknown) => readProfileFile(dirs(), id));
  ipcHandle('profiles:save', (e, id: unknown, text: unknown, baseSha: unknown, overwrite: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    return saveProfileFile(dirs(), id, text, baseSha, overwrite === true);
  });
  ipcHandle('profiles:create', (e, app: unknown, place: unknown, name: unknown, template: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    return createProfileFile(dirs(), app, place, name, template === undefined ? 'success' : template);
  });
  ipcHandle('profiles:openInVSCode', (_e, id: unknown) => {
    const file = pathOfProfile(dirs(), id);
    return file ? openInVSCode(file) : { ok: false, error: 'That profile file is not in the list any more.' };
  });
}
