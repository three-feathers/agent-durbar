/**
 * Pure helpers of the Copilot adapter for model switching (spec 030 Phase 2): the model list in the UI's shape,
 * the session config for create/resume, and the mapping of the SDK's switch and compaction results. No SDK import at run time,
 * so all of it is unit-tested on plain objects (no session, no credits).
 *
 * EVERYTHING here is built from the SDK 1.0.22 type definitions and docs. Nothing was run against a real account (spec 030 T040..T046):
 * the unit of the token prices, the long-tier window, the `status` strings of a switch and the compaction decision values are unverified,
 * and the code degrades (price absent, `rejected` with the runtime's message) instead of guessing.
 */
import type { ModelPricing, PriceClass, ContextTier, ModelSwitchResult, CompactResult, TierPricing } from '../shared/modelswitch';

/** A model the account can use, as shown in the picker. */
export interface ModelOption {
  id: string;
  name: string;
  /** Billing cost multiplier reported by the API, when there is one. */
  multiplier?: number;
  efforts: string[];
  defaultEffort?: string;
  disabled: boolean;
  /** Context window in tokens when the runtime says so (it reports 0 for `auto`, which is treated as unknown). */
  contextWindow?: number;
  /** Token prices in credits per million tokens (UNVERIFIED unit, see `pricingFromTokenPrices`); absent when the runtime reports none. */
  pricing?: ModelPricing;
  priceClass?: PriceClass;
  /** `['default','long']` only when the runtime advertises a long-context tier. */
  contextTiers?: ContextTier[];
  /** Window of the long tier = its prompt budget + the model's max output tokens (UNVERIFIED semantics). */
  longWindow?: number;
}

const pos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** The structural subset of the SDK's `ModelBillingTokenPrices` / `...LongContext` that is read. */
interface RawTierPrices {
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  maxPromptTokens?: number;
}
export interface RawTokenPrices extends RawTierPrices {
  batchSize?: number;
  longContext?: RawTierPrices;
}

/**
 * The SDK reports "AI Credits cost per billing batch of N tokens". Credits per million tokens = price / batchSize * 1e6.
 * `unverified` is always true: no real account's numbers were ever read (T040), so the unit scale may be off by a constant factor.
 * The UI says so, compares models only by ratio (valid in any common unit) and does not check the cap with these numbers.
 * A missing, zero, negative or non-numeric field stays absent; with no batch size nothing is guessed.
 */
export function pricingFromTokenPrices(tp: RawTokenPrices | undefined | null): ModelPricing | undefined {
  if (!tp || typeof tp !== 'object' || !pos(tp.batchSize)) return undefined;
  const per = (p: unknown): number | undefined => (pos(p) ? (p / (tp.batchSize as number)) * 1e6 : undefined);
  const tier = (t: RawTierPrices): TierPricing | undefined => {
    const r: TierPricing = { inputPerMTok: per(t.inputPrice), outputPerMTok: per(t.outputPrice), cachedPerMTok: per(t.cacheReadPrice) };
    return r.inputPerMTok === undefined && r.outputPerMTok === undefined ? undefined : r;
  };
  const base = tier(tp);
  if (!base) return undefined;
  const long = tp.longContext && typeof tp.longContext === 'object' ? tier(tp.longContext) : undefined;
  return { ...base, ...(long ? { long } : {}), unverified: true };
}

/** `modelPickerPriceCategory` (low | medium | high | very_high) -> the neutral price class. Anything else is absent. */
export function priceClassOf(v: unknown): PriceClass | undefined {
  return v === 'low' || v === 'medium' || v === 'high' ? v : v === 'very_high' ? 'very-high' : undefined;
}

/** The structural subset of the SDK's `ModelInfo` that is read; every field may be missing. */
export interface RawModelInfo {
  id: string;
  name?: string;
  capabilities?: { limits?: { max_context_window_tokens?: number; max_output_tokens?: number } };
  policy?: { state?: string };
  billing?: { multiplier?: number; tokenPrices?: RawTokenPrices };
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  /** Present on the runtime's own model list; `ModelInfo` of `client.listModels()` may not carry them (read defensively). */
  modelPickerPriceCategory?: string;
  supportedContextTiers?: string[];
}

export function modelOptionFrom(m: RawModelInfo): ModelOption {
  const tp = m.billing?.tokenPrices;
  const pricing = pricingFromTokenPrices(tp);
  const advertisesLong = !!(tp && typeof tp.longContext === 'object' && tp.longContext) || (Array.isArray(m.supportedContextTiers) && m.supportedContextTiers.includes('long_context'));
  const win = m.capabilities?.limits?.max_context_window_tokens;
  const out = m.capabilities?.limits?.max_output_tokens;
  const longPrompt = tp?.longContext?.maxPromptTokens;
  const longWindow = advertisesLong && pos(longPrompt) && pos(out) ? longPrompt + out : undefined;
  const priceClass = priceClassOf(m.modelPickerPriceCategory);
  return {
    id: m.id,
    name: m.name || m.id,
    multiplier: m.billing?.multiplier,
    efforts: m.supportedReasoningEfforts ?? [],
    defaultEffort: m.defaultReasoningEffort,
    disabled: m.policy?.state === 'disabled',
    contextWindow: pos(win) ? win : undefined,
    ...(pricing ? { pricing } : {}),
    ...(priceClass ? { priceClass } : {}),
    ...(advertisesLong ? { contextTiers: ['default', 'long'] as ContextTier[] } : {}),
    ...(longWindow ? { longWindow } : {}),
  };
}

/** The SDK's name of a tier. */
export const sdkTier = (t: ContextTier | undefined): 'default' | 'long_context' | undefined => (t === 'long' ? 'long_context' : t === 'default' ? 'default' : undefined);

export interface SessionConfigInput {
  model?: string;
  reasoningEffort?: string;
  contextTier?: ContextTier;
  autoTier?: 'efficiency' | 'balance' | 'intelligence';
}

/**
 * The model part of the create/resume config (spec 030 FR-013). The saved model, effort and tier are passed on create AND on resume, so a model
 * the user switched to survives a restart or an ended session. `capi.autoTier` (the routing preference of `auto`) only on a NEW `auto`
 * session: on resume it would override whatever routing the session had.
 */
export function modelConfig(o: SessionConfigInput, resume: boolean): Record<string, unknown> {
  const tier = o.contextTier === 'long' ? 'long_context' : undefined; // the default tier is the runtime's own default: not sent
  return {
    model: o.model,
    ...(o.reasoningEffort ? { reasoningEffort: o.reasoningEffort } : {}),
    ...(tier ? { contextTier: tier } : {}),
    ...(!resume && o.model === 'auto' && o.autoTier ? { capi: { autoTier: o.autoTier } } : {}),
  };
}

/** The fields of `ModelSwitchToResult` that are read (`status` is a free string in the SDK types). */
export interface RawSwitchResult {
  queueId?: string;
  modelId?: string;
  deferred?: boolean;
  status?: string;
  confirmation?: { targetModelDisplayName?: string; currentTokens?: number; targetLimit?: number };
  message?: string;
  warning?: string;
}

/**
 * SDK result -> normalized result. Order matters and every branch that depends on a guessed value says so:
 * a confirmation request, a deferred (queued) switch, a model id equal to the one asked for (applied), else `rejected` with the runtime's message.
 * Seen on a real runtime (T041): `applied`, `cancelled` (model not usable), and `deferred: true` + `queueId` for a switch queued during a turn; `confirmation_required` is still unseen (T045), so no other status is trusted on its own.
 */
export function switchResultFrom(r: RawSwitchResult | undefined | null, requested: string): ModelSwitchResult {
  if (!r || typeof r !== 'object') return { status: 'rejected', message: 'The runtime gave no answer to the switch; the model was not changed.' };
  const warning = typeof r.warning === 'string' && r.warning ? r.warning.slice(0, 300) : undefined;
  const message = typeof r.message === 'string' && r.message ? r.message.slice(0, 300) : undefined;
  if (r.status === 'confirmation_required' || r.confirmation) {
    const c = r.confirmation ?? {};
    return { status: 'needs-confirmation', model: requested, warning, confirmation: { targetName: c.targetModelDisplayName || requested, currentTokens: Number(c.currentTokens) || 0, targetLimit: Number(c.targetLimit) || 0 } };
  }
  // real: (T041) a model this account may not use answers `status: 'cancelled'` and keeps the old `modelId` (free plan: only `auto` is usable).
  if (r.status === 'cancelled') return { status: 'rejected', model: requested, message: message ?? 'That model is not available on this Copilot account or plan, so the model was not changed.', warning };
  if (r.deferred === true) return { status: 'queued', model: requested, queueId: typeof r.queueId === 'string' ? r.queueId : undefined, warning, message };
  if (r.modelId === requested) return { status: 'applied', model: requested, warning, message };
  return { status: 'rejected', model: requested, message: message ?? 'The runtime did not confirm the switch; the model was not changed.', warning };
}

/** The runtime wraps its errors as "Request <method> failed with message: <text>"; the user needs the text only. */
export function runtimeMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : '';
  const text = raw.replace(/^Request \S+ failed with message:\s*/i, '').trim();
  return (text || fallback).slice(0, 300);
}

/** SDK compaction result -> normalized. `contextWindow.currentTokens` is the size after. */
export function compactResultFrom(r: { success?: boolean; tokensRemoved?: number; contextWindow?: { currentTokens?: number } } | undefined | null): CompactResult {
  if (!r || typeof r !== 'object') return { success: false, message: 'The runtime gave no answer to the compaction.' };
  if (r.success !== true) return { success: false, message: 'The runtime did not compact the conversation (nothing was changed).' };
  const after = r.contextWindow?.currentTokens;
  return { success: true, tokensRemoved: typeof r.tokensRemoved === 'number' && r.tokensRemoved >= 0 ? r.tokensRemoved : undefined, tokensAfter: typeof after === 'number' && after >= 0 ? after : undefined };
}
