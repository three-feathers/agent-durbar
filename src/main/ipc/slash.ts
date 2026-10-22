/**
 * IPC for the composer's "/" list (spec 072 FR-010): the window asks by agent id; main looks the agent up, makes sure its session is
 * live (no prompt, no credits, like the profile list) and returns the adapter's entries re-checked and cut (`publicSlash`): names,
 * one-line descriptions and display paths only, never an absolute path or a file's contents.
 */
import { ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import { publicSlash } from '../../adapters/slashcommands';
import type { AgentInfo } from '../../shared/api';
import { errText } from '../agentops';
import type { EnsureLive } from './types';

export interface SlashIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  ensureLive: EnsureLive;
}

export function register(deps: SlashIpcDeps): void {
  const { agents, router, ensureLive } = deps;
  ipcHandle('agents:slashCommands', async (_e, id: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad?.listSlashCommands) return { ok: false, error: 'This agent app has no commands here.', entries: [] };
    try {
      await ensureLive(a, { quiet: true });
      return { ok: true, entries: publicSlash(await ad.listSlashCommands(a.id)) };
    } catch (err) {
      return { ok: false, error: errText(err), entries: [] };
    }
  });
}
