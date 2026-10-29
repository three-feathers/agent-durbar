/**
 * Pure helpers of the Copilot adapter for model switching (spec 030 Phase 2): the model list in the UI's shape,
 * the session config for create/resume, and the mapping of the SDK's switch and compaction results. No SDK import at run time,
 * so all of it is unit-tested on plain objects (no session, no credits).
 *
 * EVERYTHING here is built from the SDK 1.0.22-1.0.26 type definitions and docs. Nothing was run against a real account (spec 030 T040..T046):
 * the unit of the token prices, the long-tier window, the `status` strings of a switch and the compaction decision values are unverified,
 * and the code degrades (price absent, `rejected` with the runtime's message) instead of guessing.
 */
import type { ModelOption, ModelPricing, PriceClass, ContextTier, ModelSwitchResult, CompactResult, TierPricing, AutoTier, ManagedAutoTier } from '../shared/modelswitch';
import { AUTO_TIERS, parseAutoTier } from '../shared/modelswitch';
export type { ModelOption };

const pos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** The structural subset of the SDK's `ModelBillingTokenPrices` / `...LongContext` that is read. */
interface RawTierPrices {
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  maxPromptTokens?: number;
  /** The tier's prompt budget (real 2026-10-20: the runtime's `tokenLimit` on that tier). */
  contextMax?: number;
}
export interface RawTokenPrices extends RawTierPrices {
  batchSize?: number;
  longContext?: RawTierPrices;
}

/**
 * The SDK reports "AI Credits cost per billing batch of N tokens". Credits per million tokens = price / batchSize * 1e6.
 * Checked on a paid account (spec 030 T044, `real:` 2026-10-20): `gpt-6-luna` lists `inputPrice` 10 per batch of 1e6 tokens and its
 * calls were billed at exactly 10e9 nano-AIU per 1e6 input tokens (the same for cache reads, cache writes and output), so these are AI
 * credits per million tokens and are no longer marked `unverified`. The long-context prices were NOT charged for a small prompt on the
 * long tier (the default prices were); the UI applies them only above the default window.
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
  return { ...base, ...(long ? { long } : {}) };
}

/** `modelPickerPriceCategory` (low | medium | high | very_high) -> the neutral price class. Anything else is absent. */
export function priceClassOf(v: unknown): PriceClass | undefined {
  return v === 'low' || v === 'medium' || v === 'high' ? v : v === 'very_high' ? 'very-high' : undefined;
}

/** The structural subset of the SDK's `ModelInfo` that is read; every field may be missing. */
export interface RawModelInfo {
  id: string;
  name?: string;
  capabilities?: { limits?: { max_context_window_tokens?: number; max_output_tokens?: number; max_prompt_tokens?: number } };
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
  // The runtime's window (`usage_info.tokenLimit`, real 2026-10-20) is the PROMPT budget, not `max_context_window_tokens`:
  // gpt-6-luna 272k (tokenPrices.contextMax; the 1M context window is never offered), long tier 872k (longContext.contextMax),
  // mai-code-1.1-flash 128k (contextMax / max_prompt_tokens, not its 256k window), claude-haiku-4.5 128k (max_prompt_tokens).
  const limits = m.capabilities?.limits;
  const win = [tp?.contextMax, tp?.maxPromptTokens, limits?.max_prompt_tokens, limits?.max_context_window_tokens].find(pos);
  const longWindow = advertisesLong ? [tp?.longContext?.contextMax, tp?.longContext?.maxPromptTokens].find(pos) : undefined;
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
  /** The Auto tier the user chose and Durbar saved (spec 007 FR-016); absent = none chosen. */
  autoTier?: AutoTier;
}

/** Spec 007 FR-012: the oldest runtime that takes an Auto routing preference (issue #607, from the vendor's docs; not checked on an older runtime). */
export const AUTO_TIER_MIN_RUNTIME = [1, 0, 87] as const;

/** `true` only for a plain `x.y.z` version (a `-pre` or `+build` suffix allowed) at or above {@link AUTO_TIER_MIN_RUNTIME}; anything unreadable is `false`. */
export function runtimeHasAutoTiers(version: unknown): boolean {
  if (typeof version !== 'string' || version.length > 64) return false;
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.+-]*)?$/.exec(version.trim());
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) if (v[i] !== AUTO_TIER_MIN_RUNTIME[i]) return v[i] > AUTO_TIER_MIN_RUNTIME[i];
  return true;
}

const own = (o: unknown, k: string): unknown => (o && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/**
 * Spec 007 FR-017: the organization's Auto tier from the runtime's `managedSettings.resolve` answer (`values.autoTier`, `meta.autoTier.overridable`).
 * The answer reflects files and server policy Durbar does not control, so it is read like hostile input: own properties only, `overridable` a
 * boolean (when `meta` is there at all), anything malformed and the whole thing is ignored. `overridable: false` = locked, and a lock FAILS CLOSED:
 * a well-formed lock on a tier outside the three names (`fast`, a future name; a short plain word) is still a lock, only without a name we can show.
 * Without a lock, the tier must be one of the three names (an organization default), else it is ignored.
 */
const POLICY_WORD = /^[A-Za-z0-9._-]{1,64}$/;
export function managedAutoTierFrom(r: unknown): ManagedAutoTier | undefined {
  const raw = own(own(r, 'values'), 'autoTier');
  const meta = own(own(r, 'meta'), 'autoTier');
  const overridable = meta === undefined ? undefined : own(meta, 'overridable');
  if (meta !== undefined && typeof overridable !== 'boolean') return undefined;
  const tier = parseAutoTier(raw);
  if (overridable === false && typeof raw === 'string' && POLICY_WORD.test(raw)) return tier ? { tier, locked: true } : { locked: true };
  return tier ? { tier, locked: false } : undefined;
}

/** Spec 007 FR-012/FR-017: the `auto` option gains the tiers (when the runtime has them) and the organization's tier; every other option is unchanged. */
export function withAutoTiers(options: ModelOption[], supported: boolean, managed: ManagedAutoTier | undefined): ModelOption[] {
  if (!supported) return options;
  return options.map((o) => (o.id === 'auto' ? { ...o, autoTiers: [...AUTO_TIERS], ...(managed ? { autoTierManaged: { ...managed } } : {}) } : o));
}

/**
 * The Auto tier to send for `model` (spec 007 FR-016/FR-017), or none. Under a locked policy: none (the runtime applies the policy). The user's
 * own tier: that one. Otherwise the app's cheapest default (`efficiency`) only when `useDefault` and the organization sets no default of its own.
 */
export function autoTierToSend(model: string | undefined, chosen: AutoTier | null | undefined, managed: ManagedAutoTier | undefined, useDefault: boolean): AutoTier | null | undefined {
  if (model !== 'auto' || managed?.locked) return undefined;
  // `null` (an Undo back to "no tier of its own"): the default again, i.e. Efficiency, or the provider's default (null) under an organization default
  if (chosen === null) return managed ? null : 'efficiency';
  if (chosen) return chosen;
  return useDefault && !managed ? 'efficiency' : undefined;
}

/**
 * The model part of the create/resume config (spec 030 FR-013). The saved model, effort and tier are passed on create AND on resume, so a model
 * the user switched to survives a restart or an ended session. `capi.autoTier` (the routing preference of `auto`): the user's own saved tier on
 * create and resume (spec 007 FR-016); with none, the cheapest default only on a NEW `auto` session (on resume it would override whatever routing
 * the session had), and never under the organization's tier (FR-017).
 */
export function modelConfig(o: SessionConfigInput, resume: boolean, managed?: ManagedAutoTier): Record<string, unknown> {
  const tier = o.contextTier === 'long' ? 'long_context' : undefined; // the default tier is the runtime's own default: not sent
  const autoTier = autoTierToSend(o.model, parseAutoTier(o.autoTier), managed, !resume) ?? undefined;
  return {
    model: o.model,
    ...(o.reasoningEffort ? { reasoningEffort: o.reasoningEffort } : {}),
    ...(tier ? { contextTier: tier } : {}),
    ...(autoTier ? { capi: { autoTier } } : {}),
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
