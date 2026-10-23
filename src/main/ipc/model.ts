/** IPC for the model of a session: change it in place, cancel a queued change, hand off, compact, and the list of models (spec 030, spec 012 FR-120; moved out of main.ts as it was, spec 045 FR-060). */
import { ipcHandle } from '../ipcguard';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AdapterRouter } from '../../adapters/router';
import { modelOptionsOf } from '../../adapters/router';
import type { AgentInfo, ModelChoice } from '../../shared/api';
import { parseFocus, parseSwitchRequest } from '../../shared/modelswitch';
import type { ModelSwitchRequest, ModelSwitchResult } from '../../shared/modelswitch';
import { errText } from '../agentops';
import type { OrgVerdict } from '../../shared/orgpolicy';
import type { FolderStore } from '../folders';

export interface ModelIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  registry: AdapterRegistry;
  /** Created when the app is ready: read when a handler runs. */
  getFolderStore(): FolderStore | undefined;
  wsKey(a: AgentInfo): string;
  /** Spec 076 FR-202/FR-203 (issue #602): why the agent app's own organization policy blocks this model, or undefined. */
  orgModel?(adapterId: string, model: string): Promise<OrgVerdict | undefined>;
}

const NO_SWITCH = 'This agent cannot change its model in place. Start a new session with the model you want.';

export interface SetModelDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  defaultId: string;
  /** The models a switch is checked against (spec 030 FR-018). */
  models(): Promise<ModelChoice[]>;
  /** Spec 076 FR-203: the agent app's own organization policy on this model. */
  orgModel?(adapterId: string, model: string): Promise<OrgVerdict | undefined>;
  /** Saves the choice in this app's own folder file. */
  save(a: AgentInfo, choice: { model: string; effort?: string | null; contextTier?: 'long' }): void;
}

/** `agents:setModel` (spec 030; spec 076 FR-203: a model the organization policy blocks is refused before anything is switched or saved). */
export async function setModelOp(d: SetModelDeps, id: unknown, raw: unknown): Promise<{ ok: boolean; error?: string; result?: ModelSwitchResult }> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  if (typeof ad.setModel !== 'function') return { ok: false, error: NO_SWITCH };
  try {
    const parsed = parseSwitchRequest(raw, await d.models());
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const req: ModelSwitchRequest = parsed.request;
    const org = await d.orgModel?.(a.adapterId ?? d.defaultId, req.model);
    if (org?.refuse) return { ok: false, error: `${org.why}: pick another model.` };
    // Not started (or ended) yet: nothing is running to switch. The choice is saved and the first start (create or resume) uses it (FR-013).
    const result: ModelSwitchResult = ad.isLive(a.id) ? await ad.setModel(a.id, req) : { status: 'applied', model: req.model, message: 'Used from the first message: this agent has not started yet.' };
    if (result.status === 'applied') {
      // Saved only in this app's own folder file; never in Copilot's settings (no repoScope / modelChangeScope / pickerPersistence is ever sent).
      a.model = req.model;
      if (req.effort === null) a.effort = undefined;
      else if (req.effort !== undefined) a.effort = req.effort;
      a.tier = req.contextTier === 'long' ? 'long' : undefined;
      d.save(a, { model: req.model, effort: req.effort, contextTier: a.tier });
    }
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** `models:list` (spec 076 FR-202): each model with the organization's verdict; a blocked one stays listed, greyed with the reason. */
export async function withOrgModels<T extends { id: string }>(models: T[], verdict: ((id: string) => Promise<OrgVerdict | undefined>) | undefined): Promise<(T & { orgBlocked?: string; orgDoubt?: string })[]> {
  if (!verdict) return models;
  const vs = await Promise.all(models.map((m) => verdict(m.id)));
  return models.map((m, i) => (vs[i]?.refuse ? { ...m, orgBlocked: vs[i]!.why } : vs[i] ? { ...m, orgDoubt: vs[i]!.why } : m));
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

  ipcHandle('agents:setModel', (_e, id: unknown, raw: unknown) => setModelOp({ agents, router, orgModel: deps.orgModel, defaultId: registry.defaultId, models: modelsForValidation, save: (a, c) => folderStore()?.setModelChoice(wsKey(a), c) }, id, raw));

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
      const models = await withOrgModels((await modelOptionsOf(router.instance(id))).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m), deps.orgModel && ((m) => deps.orgModel!(id, m)));
      if (id !== registry.defaultId) return { ok: true, models };
      lastModels = models;
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: errText(err), models: [] };
    }
  });
}
