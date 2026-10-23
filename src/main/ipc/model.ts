/** IPC for the model of a session: change it in place, cancel a queued change, hand off, compact, and the list of models (spec 030, spec 012 FR-120; moved out of main.ts as it was, spec 045 FR-060). */
import { ipcHandle } from '../ipcguard';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AdapterRouter } from '../../adapters/router';
import { modelOptionsOf } from '../../adapters/router';
import type { AgentInfo, ModelChoice } from '../../shared/api';
import { parseFocus, parseSwitchRequest } from '../../shared/modelswitch';
import type { ModelSwitchRequest, ModelSwitchResult } from '../../shared/modelswitch';
import { errText } from '../agentops';
import type { FolderStore } from '../folders';

export interface ModelIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  registry: AdapterRegistry;
  /** Created when the app is ready: read when a handler runs. */
  getFolderStore(): FolderStore | undefined;
  wsKey(a: AgentInfo): string;
  /** Spec 076 FR-202/FR-203 (issue #602): why the agent app's own organization policy blocks this model, or undefined. */
  orgModel?(adapterId: string, model: string): string | undefined;
}

export function register(deps: ModelIpcDeps): void {
  const { agents, router, registry, wsKey } = deps;
  const folderStore = deps.getFolderStore;
  /** The last list of models the account offers; a switch request is checked against it (spec 030 FR-018). */
  let lastModels: ModelChoice[] = [];
  const modelsForValidation = async (): Promise<ModelChoice[]> => {
    if (!lastModels.length) lastModels = (await modelOptionsOf(router.instance(registry.defaultId))).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m);
    return lastModels;
  };
  const NO_SWITCH = 'This agent cannot change its model in place. Start a new session with the model you want.';

  ipcHandle('agents:setModel', async (_e, id: unknown, raw: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'unknown agent' };
    if (typeof ad.setModel !== 'function') return { ok: false, error: NO_SWITCH };
    try {
      const parsed = parseSwitchRequest(raw, await modelsForValidation());
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const req: ModelSwitchRequest = parsed.request;
      const org = deps.orgModel?.(a.adapterId ?? registry.defaultId, req.model); // FR-203: refused before anything changes
      if (org) return { ok: false, error: `${org}: pick another model.` };
      // Not started (or ended) yet: nothing is running to switch. The choice is saved and the first start (create or resume) uses it (FR-013).
      const result: ModelSwitchResult = ad.isLive(a.id) ? await ad.setModel(a.id, req) : { status: 'applied', model: req.model, message: 'Used from the first message: this agent has not started yet.' };
      if (result.status === 'applied') {
        // Saved only in this app's own folder file; never in Copilot's settings (no repoScope / modelChangeScope / pickerPersistence is ever sent).
        a.model = req.model;
        if (req.effort === null) a.effort = undefined;
        else if (req.effort !== undefined) a.effort = req.effort;
        a.tier = req.contextTier === 'long' ? 'long' : undefined;
        folderStore()?.setModelChoice(wsKey(a), { model: req.model, effort: req.effort, contextTier: a.tier });
      }
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });

  ipcHandle('agents:cancelQueuedModel', async (_e, id: unknown, queueId: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad || typeof queueId !== 'string' || !queueId || queueId.length > 200) return { ok: false, error: 'unknown agent' };
    if (typeof ad.cancelQueuedModel !== 'function') return { ok: false, error: NO_SWITCH };
    try {
      await ad.cancelQueuedModel(a.id, queueId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });

  // Spec 030 FR-034: a hand-off summary of a live session (user content: never logged; shown for editing in the window).
  ipcHandle('agents:handoff', async (_e, id: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'unknown agent' };
    if (typeof ad.handoffSummary !== 'function') return { ok: false, error: 'This agent app cannot make a summary.' };
    if (!ad.isLive(a.id)) return { ok: false, error: 'This session has not started yet, so there is nothing to summarize.' };
    try {
      const r = await ad.handoffSummary(a.id);
      return { ok: true, summary: r.summary, ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}) };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });
  ipcHandle('agents:compact', async (_e, id: unknown, focus: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'unknown agent' };
    if (typeof ad.compact !== 'function') return { ok: false, error: 'This agent cannot compact its context in place. Start a new session instead.' };
    try {
      if (!ad.isLive(a.id)) return { ok: true, result: { success: false, message: 'This agent has not started yet, so there is nothing to compact.' } };
      return { ok: true, result: await ad.compact(a.id, parseFocus(focus)) };
    } catch (err) {
      return { ok: false, error: errText(err) }; // the focus text is never logged or echoed
    }
  });

  ipcHandle('models:list', async (_e, kind: unknown): Promise<{ ok: boolean; error?: string; models: ModelChoice[] }> => {
    // spec 012 FR-120: one list per agent kind; no kind = the default kind (as before); an unknown kind is refused
    const id = kind === undefined || kind === null || kind === '' ? registry.defaultId : typeof kind === 'string' && registry.has(kind) ? kind : undefined;
    if (!id) return { ok: false, error: 'unknown agent app', models: [] };
    try {
      const models = (await modelOptionsOf(router.instance(id))).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => {
        const org = deps.orgModel?.(id, m.id); // FR-202: kept in the list, greyed out with the reason
        return org ? { ...m, orgBlocked: org } : m;
      });
      if (id !== registry.defaultId) return { ok: true, models };
      lastModels = models;
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: errText(err), models: [] };
    }
  });
}
