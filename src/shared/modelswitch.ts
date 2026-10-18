/**
 * Switching the model and context tier of a live session (spec 030). Adapter-neutral types and the main-process
 * validation of what the renderer sends. No SDK types, no I/O. The UI decision logic (price comparison, estimates,
 * "start fresh" hint) is the plain script `src/renderer/modelswitch.js`, because the renderer cannot import modules.
 */

/** `long` is the long-context tier of a model that has one (the Copilot SDK calls it `long_context`). */
export type ContextTier = 'default' | 'long';

/** Relative price class a runtime may report instead of (or next to) token prices. */
export type PriceClass = 'low' | 'medium' | 'high' | 'very-high';

/** Credits per million tokens, as the runtime reports them (1 AI credit = USD 0.01). Absent = not reported, never zero. */
export interface TierPricing {
  inputPerMTok?: number;
  outputPerMTok?: number;
  cachedPerMTok?: number;
}
export interface ModelPricing extends TierPricing {
  /** Prices above the default tier's prompt budget, for models that offer a long-context tier. */
  long?: TierPricing;
  /** The runtime's numbers were never checked against a real account (the unit scale may be off): the UI says so and does not check the credit cap with them. */
  unverified?: boolean;
}

export interface ModelSwitchRequest {
  model: string;
  /** `null` clears the effort override (the model's default); omitted keeps the current one. */
  effort?: string | null;
  /** The tier wanted after the switch; omitted = the model's default tier (a request describes the whole state, so an effort-only change repeats the current tier). */
  contextTier?: ContextTier;
  /** Answer to a "needs-confirmation" result (the target window is smaller than the context in use). */
  confirm?: { compaction?: 'accept' | 'decline' };
}

export interface ModelSwitchResult {
  /** `applied`: the model is the new one (the next message uses it). `queued`: a turn is running, it applies when the turn ends. */
  status: 'applied' | 'queued' | 'needs-confirmation' | 'rejected';
  model?: string;
  queueId?: string;
  message?: string;
  warning?: string;
  confirmation?: { targetName: string; currentTokens: number; targetLimit: number };
}

export interface CompactResult {
  success: boolean;
  tokensRemoved?: number;
  tokensAfter?: number;
  message?: string;
}

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

/** What an agent's adapter can do about model and context. Derived from the adapter's optional members (spec 030 FR-017). */
export interface ModelControl {
  /** `live`: applies at once, `next-message`: from the next message, `none`: only a new session can change it. */
  switch: 'live' | 'next-message' | 'none';
  effort: boolean;
  contextTier: boolean;
  compact: boolean;
  /** The window size is reported by the runtime (a window of 0 or an absent one is "unknown"). */
  windowKnown: boolean;
  /** The adapter's calls are built from the SDK's documented API but were never run against a real account (spec 030 Phase 3): the UI says so. */
  unverified?: boolean;
}

export const NO_MODEL_CONTROL: ModelControl = { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true };

/** Control data from the adapter's optional members (a stand-in until spec 012's capabilities exist). */
export function modelControlFor(adapter: { setModel?: unknown; compact?: unknown }, opts: { switch?: ModelControl['switch']; contextTier?: boolean; unverified?: boolean } = {}): ModelControl {
  const canSwitch = typeof adapter.setModel === 'function';
  const canCompact = typeof adapter.compact === 'function';
  return {
    ...(opts.unverified && (canSwitch || canCompact) ? { unverified: true } : {}),
    switch: canSwitch ? opts.switch ?? 'next-message' : 'none',
    effort: canSwitch,
    contextTier: canSwitch && opts.contextTier !== false,
    compact: canCompact,
    windowKnown: true,
  };
}

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
export const MAX_FOCUS = 500;

export const parseTier = (v: unknown): ContextTier | undefined => (v === 'default' || v === 'long' ? v : undefined);

/** The focus text of a manual compaction: a short plain string (never logged); anything else is dropped. */
export function parseFocus(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, MAX_FOCUS);
  return t || undefined;
}

export interface KnownModel {
  id: string;
  efforts?: string[];
  contextTiers?: ContextTier[];
}

/**
 * Validate a switch request that came over IPC (never trust the renderer, constitution III): the model must be one the account
 * offers (the last list main fetched), the effort one of the known values and offered by that model, the tier only a tier the model
 * advertises. Returns a clean request or a message for the user.
 */
export function parseSwitchRequest(raw: unknown, models: readonly KnownModel[]): { ok: true; request: ModelSwitchRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request.' };
  const o = raw as Record<string, unknown>;
  if (typeof o.model !== 'string' || !o.model || o.model.length > 100) return { ok: false, error: 'Invalid model.' };
  const m = models.find((x) => x.id === o.model);
  if (!m) return { ok: false, error: 'That model is not in the list your account offers.' };
  const request: ModelSwitchRequest = { model: m.id };
  if (o.effort === null) request.effort = null;
  else if (o.effort !== undefined) {
    if (typeof o.effort !== 'string' || !EFFORTS.has(o.effort)) return { ok: false, error: 'Invalid reasoning effort.' };
    if (!(m.efforts ?? []).includes(o.effort)) return { ok: false, error: 'That model does not offer this reasoning effort.' };
    request.effort = o.effort;
  }
  if (o.contextTier !== undefined) {
    const t = parseTier(o.contextTier);
    if (!t) return { ok: false, error: 'Invalid context tier.' };
    if (t === 'long' && !(m.contextTiers ?? []).includes('long')) return { ok: false, error: 'That model has no long-context tier.' };
    request.contextTier = t;
  }
  if (o.confirm !== undefined) {
    const c = o.confirm && typeof o.confirm === 'object' ? (o.confirm as Record<string, unknown>).compaction : undefined;
    if (c === 'accept' || c === 'decline') request.confirm = { compaction: c };
    else if (c !== undefined) return { ok: false, error: 'Invalid confirmation.' };
  }
  return { ok: true, request };
}
