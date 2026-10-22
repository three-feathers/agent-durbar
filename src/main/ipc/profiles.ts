/** IPC for the custom agent of a session: list, select; a repository agent needs a confirmation for its exact file (spec 043 FR-003; moved out of main.ts as it was, spec 045 FR-060). */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import { errText } from '../agentops';
import type { AgentTrustStore } from '../agenttrust';
import { hashAgentFile } from '../agenttrust';
import { PROFILE_ID } from '../folders';
import { PROFILE_NAME, createProfileFile, listProfileFiles, pathOfProfile, profileDirs, profileFolders, readProfileFile, saveProfileFile } from '../profilefiles';
import { openInVSCode } from '../vscode';
import * as path from 'path';
import { buildProfilePrompt, MAX_GEN_ANSWER, MAX_GEN_DESCRIPTION, PROFILE_QUESTIONS, validateGeneratedProfile } from '../../shared/profiletemplates';
import type { FrontmatterParse, GenInput } from '../../shared/profiletemplates';
import type { EnsureLive } from './types';

export interface ProfilesIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  /** Created when the app is ready: read when a handler runs. */
  getAgentTrust(): AgentTrustStore | undefined;
  wsKey(a: AgentInfo): string;
  ensureLive: EnsureLive;
  /** Spec 043 FR-023: an app's one-shot text call (the theme maker's path: no tools, no session), or undefined. */
  oneShot(id: string): { name: string; generate(prompt: string): Promise<{ text: string; costUsd?: number; nanoAiu?: number }> } | undefined;
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
    return { ok: true, folders: profileFolders(d), files: listProfileFiles(d) };
  });
  ipcHandle('profiles:read', (_e, id: unknown) => readProfileFile(dirs(), id));
  ipcHandle('profiles:save', (e, id: unknown, text: unknown, baseSha: unknown, overwrite: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    return saveProfileFile(dirs(), id, text, baseSha, overwrite === true);
  });
  ipcHandle('profiles:create', (e, app: unknown, place: unknown, name: unknown, template: unknown, text: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    return createProfileFile(dirs(), app, place, name, template === undefined ? 'success' : template, text); // text: a reviewed AI draft (FR-024)
  });
  /* spec 043 FR-021..FR-023: one prompt to an agent app's one-shot path; the reply is checked and handed back as a draft (nothing written) */
  ipcHandle('profiles:generate', async (e, req: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    const r = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>;
    const app = r.app === 'claude' || r.app === 'copilot' ? r.app : undefined;
    if (!app) return { ok: false, error: 'Choose an agent app.' };
    if (typeof r.name !== 'string' || !PROFILE_NAME.test(r.name)) return { ok: false, error: 'Choose a valid name first.' };
    const mode = r.mode === 'questions' ? 'questions' : 'describe';
    const answers: Record<string, string> = {};
    const a = (r.answers && typeof r.answers === 'object' ? r.answers : {}) as Record<string, unknown>;
    for (const q of PROFILE_QUESTIONS) if (typeof a[q.id] === 'string') answers[q.id] = (a[q.id] as string).slice(0, MAX_GEN_ANSWER);
    const input: GenInput = { app, name: r.name, mode, description: typeof r.description === 'string' ? r.description.slice(0, MAX_GEN_DESCRIPTION) : '', answers };
    if (mode === 'describe' && (input.description ?? '').trim().length < 10) return { ok: false, error: 'Describe what the agent does in a sentence or two.' };
    if (mode === 'questions' && !Object.values(answers).some((x) => x.trim())) return { ok: false, error: 'Answer at least one question.' };
    const by = typeof r.by === 'string' ? deps.oneShot(r.by.slice(0, 40)) : undefined;
    if (!by) return { ok: false, error: 'That agent app cannot write a profile here. Pick an installed, signed-in one.' };
    // the editor's own front matter check (FR-015): one parser for the editor and this check
    const PE = require(path.join(__dirname, '..', '..', 'renderer', 'profileeditor.js')) as { parseFrontmatter(t: string): FrontmatterParse };
    try {
      const g = await by.generate(buildProfilePrompt(input));
      const cost = { ...(g.costUsd ? { costUsd: g.costUsd } : {}), ...(g.nanoAiu ? { nanoAiu: g.nanoAiu } : {}) };
      const v = validateGeneratedProfile(g.text, input, (t) => PE.parseFrontmatter(t));
      return v.ok ? { ok: true, text: v.text, warnings: v.warnings, by: by.name, ...cost } : { ok: false, error: v.error, ...cost };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });
  ipcHandle('profiles:openInVSCode', (_e, id: unknown) => {
    const file = pathOfProfile(dirs(), id);
    return file ? openInVSCode(file) : { ok: false, error: 'That profile file is not in the list any more.' };
  });
}
