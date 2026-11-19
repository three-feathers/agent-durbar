/** IPC for the model of a session: change it in place, cancel a queued change, hand off, compact, and the list of models (spec 030, spec 012 FR-120; moved out of main.ts as it was, spec 045 FR-060). */
import { ipcHandle } from '../ipcguard';
import type { AdapterRegistry } from '../../adapters/registry';
import type { AdapterRouter } from '../../adapters/router';
import { modelOptionsOf } from '../../adapters/router';
import type { AgentInfo, ModelChoice } from '../../shared/api';
import type { AgentEvent } from '../../adapters/types';
import { parseFocus, parseSwitchRequest } from '../../shared/modelswitch';
import type { ModelSwitchRequest, ModelSwitchResult } from '../../shared/modelswitch';
import { errText } from '../agentops';
import { redact } from '../../shared/redact';
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
  /** The clock of the fresh-ask floor (tests only). */
  now?(): number;
  /** How long one model-list call may take (tests only; default {@link LIST_TIMEOUT_MS}). */
  listTimeoutMs?: number;
}

/** Spec 030 FR-073: how long one model-list call may take. The runtime calls (`models.list`, `listModels()`) have no limit of their own, and a call that never answers would hold the menu on "Checking" for good. Claude's probe has its own 20 s limit. */
export const LIST_TIMEOUT_MS = 25_000;

/** Rejects with a `TimeoutError` when `p` has not settled in `ms`; the timer never outlives the call. */
export function capListCall<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('the model list timed out'), { name: 'TimeoutError' })), ms); });
  return Promise.race([p, limit]).finally(() => { if (t) clearTimeout(t); });
}

/** Spec 030 FR-068: the least time between two fresh model-list asks of one agent app. */
export const FRESH_FLOOR_MS = 5000;

const NO_SWITCH = 'This agent cannot change its model in place. Start a new session with the model you want.';

export interface SetModelDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  defaultId: string;
  /** The models a switch is checked against (spec 030 FR-018): those of this session's own agent app (FR-063). */
  models(adapterId: string): Promise<ModelChoice[]>;
  /** Spec 076 FR-203: the agent app's own organization policy on this model. */
  orgModel?(adapterId: string, model: string): Promise<OrgVerdict | undefined>;
  /** Saves the choice in this app's own folder file. */
  save(a: AgentInfo, choice: Parameters<FolderStore['setModelChoice']>[1]): void;
}

/**
 * Spec 030 FR-065: `auto` on another agent app means its own default (the adapters take it and report it), though its list may not name it; Claude Code's
 * list calls it `default`, with that entry's efforts. Copilot's `auto` is a real entry of its list and is never added.
 */
function withOwnDefault(models: ModelChoice[], adapterId: string, defaultId: string): ModelChoice[] {
  if (adapterId === defaultId || models.some((m) => m.id === 'auto')) return models;
  const own = models.find((m) => m.id === 'default');
  return [...models, { id: 'auto', name: 'Auto', efforts: own?.efforts ?? [] }];
}

/** `agents:setModel` (spec 030; spec 076 FR-203: a model the organization policy blocks is refused before anything is switched or saved). */
export async function setModelOp(d: SetModelDeps, id: unknown, raw: unknown): Promise<{ ok: boolean; error?: string; result?: ModelSwitchResult }> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  if (typeof ad.setModel !== 'function') return { ok: false, error: NO_SWITCH };
  try {
    const parsed = parseSwitchRequest(raw, withOwnDefault(await d.models(a.adapterId ?? d.defaultId), a.adapterId ?? d.defaultId, d.defaultId));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const req: ModelSwitchRequest = parsed.request;
    // Spec 007 FR-015: the tiers come from the default kind's list (Copilot's `auto`); another agent app never gets one.
    if (req.autoTier && a.adapterId !== d.defaultId) return { ok: false, error: 'This agent app has no Auto routing tier.' };
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
      if (req.autoTier) a.autoTier = req.autoTier; // spec 007 FR-016: remembered per agent, kept while it uses another model
      else if (req.autoTier === null) a.autoTier = undefined; // an Undo back to "no tier of its own"
      d.save(a, { model: req.model, effort: req.effort, contextTier: a.tier, autoTier: req.autoTier });
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

/**
 * Spec 007 FR-019: a tier switch the runtime could not apply. The tier still in effect is shown and saved again (none of its own when the runtime
 * names none), so a resume does not ask for the failed one. Only for a top-level agent that is on Auto.
 */
export function onAutoTierFailed(e: AgentEvent, agents: Map<string, AgentInfo>, store: Pick<FolderStore, 'setAutoTier'> | undefined, wsKey: (a: AgentInfo) => string): void {
  if (e.type !== 'autoTierFailed' || e.agentId) return;
  const a = agents.get(e.sessionId);
  if (!a || (a.model ?? 'auto') !== 'auto') return;
  a.autoTier = e.effective;
  store?.setAutoTier(wsKey(a), e.effective ?? null);
}

/** `models:list`'s answer (spec 030 FR-069, FR-070): `reason` is a fixed phrase, never the error's own text; `hidden` counts policy-disabled models. */
export interface ModelListReply { ok: boolean; error?: string; reason?: string; hidden?: number; models: ModelChoice[] }

/** A short fixed phrase for why a model list failed (spec 030 FR-068): the error's text may carry account data, so only its kind is read. */
export function listReason(err: unknown): string {
  const status = err && typeof err === 'object' ? Number((err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode) : NaN;
  const t = `${err instanceof Error ? err.name : ''} ${err instanceof Error ? err.message : typeof err === 'string' ? err : ''}`;
  // narrow on purpose: "max tokens", a rate limit (429) or "author" are not a sign-in failure
  if (status === 401 || status === 403 || /\bunauthori[sz]ed\b|\bnot (signed|logged) ?in\b|\bnot authenticated\b|\bauthentication (failed|required)\b|\bsign-?in (required|expired)\b|\bHTTP 40[13]\b|"status":\s?40[13]\b/i.test(t)) return 'the sign-in was not accepted';
  if (/\btime(d)? ?out\b|\bETIMEDOUT\b/i.test(t)) return 'the request timed out';
  if (/\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH)\b|fetch failed/i.test(t)) return 'no connection';
  return 'the app could not list its models';
}

/** Runs one listing: an error or an empty list becomes a reason, and only the error's type is logged (spec 030 FR-069). */
export async function modelListReply(load: () => Promise<ModelChoice[]>, hidden: () => number, warn: (m: string) => void = (m) => console.warn(redact(m))): Promise<ModelListReply> {
  try {
    const models = await load();
    const h = hidden();
    return { ok: true, models, ...(h > 0 ? { hidden: h } : {}), ...(models.length ? {} : { reason: h > 0 ? 'every model is turned off by your account\'s policy' : 'the app returned no models' }) };
  } catch (err) {
    warn(`[models] the list failed: ${err instanceof Error && /^\w{1,40}$/.test(err.name) ? err.name : 'Error'}`);
    return { ok: false, error: listReason(err), reason: listReason(err), models: [] };
  }
}

/** What `register` hands back: the models of an agent app as `models:list` answers them (spec 111 T010 reuses it, FR-031 of spec 021). */
export interface ModelIpc {
  /** one list per agent app id (a known one), each model with the organization's verdict; throws when the app cannot list */
  modelsOf(kind: string): Promise<ModelChoice[]>;
}

export function register(deps: ModelIpcDeps): ModelIpc {
  const { agents, router, registry, wsKey } = deps;
  const folderStore = deps.getFolderStore;
  /** The last list of models each agent app offers; a switch request is checked against its session's own app (spec 030 FR-018, FR-063). */
  const lastModels = new Map<string, ModelChoice[]>();
  /** Policy-disabled models the last list of each app dropped (spec 030 FR-070). */
  const lastHidden = new Map<string, number>();
  /** `models:list`'s body (spec 076 FR-202), extracted unchanged for spec 111 T010: the list of one app with `orgBlocked`/`orgDoubt`, and remembered for a switch. `fresh`: past the app's own cache (spec 030 FR-071). */
  /** Spec 030 FR-068 (review on PR 1923): a fresh ask costs a runtime call (Claude Code starts a probe), so at most one per app per few seconds; inside the window the in-flight or last answer is returned. */
  const freshRuns = new Map<string, { at: number; p: Promise<ModelChoice[]> }>();
  const modelsOf = (id: string, fresh = false): Promise<ModelChoice[]> => {
    if (!fresh) return loadList(id, false);
    const now = (deps.now ?? Date.now)(), prev = freshRuns.get(id);
    if (prev && now - prev.at < FRESH_FLOOR_MS) return prev.p;
    const p = loadList(id, true);
    freshRuns.set(id, { at: now, p });
    return p;
  };
  const loadList = async (id: string, fresh: boolean): Promise<ModelChoice[]> => {
    const all = await capListCall(modelOptionsOf(router.instance(id), fresh ? { fresh: true } : undefined), deps.listTimeoutMs ?? LIST_TIMEOUT_MS);
    lastHidden.set(id, all.filter((m) => m.disabled).length);
    const models = await withOrgModels(all.filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m), deps.orgModel && ((m) => deps.orgModel!(id, m)));
    lastModels.set(id, models);
    return models;
  };
  const modelsForValidation = async (kind: string): Promise<ModelChoice[]> => {
    let list = lastModels.get(kind);
    if (!list?.length) {
      list = (await modelOptionsOf(router.instance(kind))).filter((m) => !m.disabled).map(({ disabled: _d, ...m }) => m);
      lastModels.set(kind, list);
    }
    return list;
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

  ipcHandle('models:list', async (_e, kind: unknown, opts: unknown): Promise<ModelListReply> => {
    // spec 012 FR-120: one list per agent kind; no kind = the default kind (as before); an unknown kind is refused
    const id = kind === undefined || kind === null || kind === '' ? registry.defaultId : typeof kind === 'string' && registry.has(kind) ? kind : undefined;
    if (!id) return { ok: false, error: 'unknown agent app', models: [] };
    const fresh = !!opts && typeof opts === 'object' && (opts as { fresh?: unknown }).fresh === true;
    return modelListReply(() => modelsOf(id, fresh), () => lastHidden.get(id) ?? 0);
  });
  return { modelsOf };
}
