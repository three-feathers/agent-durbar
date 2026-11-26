/**
 * Spec 003 FR-120..FR-133 (issue 2105): Copilot's assisted approvals inside Ask first, the pure part. Only Copilot's adapter imports this; it
 * reads the runtime's request shapes (`assistedApproval`, `managedApprovalRequired`) and gives the broker vendor-free fields
 * (`PermissionLike.appReview`, `appReviewNote`). No SDK import, no I/O beyond loading the lookalike module once.
 * `read:` `@github/copilot-sdk` 1.0.24 / runtime 1.0.101 (`session-events.d.ts` `PermissionAssistedApproval`, `types.d.ts`); nothing run.
 */
import * as path from 'path';
import { maskHomePaths, maskSecretCommand, maskSecretUrl, redact } from '../shared/redact';

/** The runtime's permission modes (`session.rpc.permissions.setMode`); Durbar only ever asks for `manual` or `assisted`, never `allow-all`. */
export type CopilotPermMode = 'manual' | 'assisted';

/** Prompt kinds whose `promptRequest.managedApprovalRequired` can clear the raw marker after an assisted approval (`read:` SDK `types.d.ts`). */
const CLEARABLE_KINDS: ReadonlySet<string> = new Set(['commands', 'read', 'write', 'url', 'workflow']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: unknown, k: string): unknown => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/**
 * FR-124: whether managed policy says a human must answer. The prompt request's marker for the five kinds that can clear it, else the raw
 * marker; fail closed: any present value other than `false` (on either one) means a human must answer.
 */
export function managedHumanRequired(raw: unknown, prompt: unknown): boolean {
  const rawMark = own(raw, 'managedApprovalRequired');
  const promptMark = own(prompt, 'managedApprovalRequired');
  const set = (v: unknown): boolean => v !== undefined && v !== false;
  if (set(rawMark) && !(isObj(prompt) && CLEARABLE_KINDS.has(String(own(prompt, 'kind'))) && promptMark === false)) return true;
  return set(promptMark);
}

/**
 * FR-124, FR-130: the judge's verdict on one request, normalized. `approve: true` only when the switch is on, the verdict is exactly `approve`
 * and no managed-human marker is set; a `note` for the pending card when the verdict is one of the three others. A missing or malformed
 * verdict gives neither. The verdict's `reason` and `model` (model output) are never read.
 */
export function copilotReview(on: boolean, raw: unknown, prompt: unknown): { approve: boolean; note?: 'declined' | 'never' | 'undecided' } {
  if (!on) return { approve: false };
  const v = isObj(own(raw, 'assistedApproval')) ? own(raw, 'assistedApproval') : own(prompt, 'assistedApproval');
  const rec = own(v, 'recommendation');
  if (rec === 'approve') return { approve: !managedHumanRequired(raw, prompt) };
  if (rec === 'requireApproval') return { approve: false, note: 'declined' };
  if (rec === 'excluded') return { approve: false, note: 'never' };
  if (rec === 'error') return { approve: false, note: 'undecided' };
  return { approve: false };
}

/** The card helper of `src/renderer/liveact.js` (UMD; it loads `lookalike.js` and `safetext.js` beside it): the part this file uses. */
export interface CardCheckModule {
  reviewable(p: Record<string, unknown>, mask: Record<string, (t: string) => string>): boolean;
}

/**
 * FR-124 (C5): the window's own card helper (`liveact.js`), loaded once from the build's renderer folder (`dist/renderer`, copied by
 * copy-assets.js), so the gate reads the card's words exactly as the window shows them. Not there, or it throws: `undefined`, and every
 * request keeps its card. `dir` is for tests.
 */
export function loadCardCheck(dir: string = path.join(__dirname, '..', 'renderer')): CardCheckModule | undefined {
  try {
    const m = require(path.join(dir, 'liveact.js')) as Partial<CardCheckModule>; // eslint-disable-line @typescript-eslint/no-require-imports
    return m && typeof m.reviewable === 'function' ? (m as CardCheckModule) : undefined;
  } catch {
    return undefined;
  }
}

/** The masks the window's card uses (`LIVE_MASK` in app.js), from the same shared module. */
const CARD_MASK: Record<string, (t: string) => string> = { redact: (t) => redact(t), cmd: (t) => maskSecretCommand(t), url: (t) => maskSecretUrl(t), home: (t) => maskHomePaths(t) };

/**
 * FR-124, FR-132 (C5): may the reviewer approve this request without a card? Only when the card the window would draw shows its text (not cut,
 * unchecked or concealed) and none of its words (summary, scope label, broad label, the session button's text from the key), nor the raw
 * keys and paths behind them, has lookalike letters or could not be checked. No module, or a throw: false (a card).
 */
export function cardReviewable(mod: CardCheckModule | undefined, card: { summary: string; kind: string; scopeKey?: string; scopeLabel?: string; broadScopeKey?: string; broadScopeLabel?: string; paths?: string[] }): boolean {
  if (!mod) return false;
  try {
    return mod.reviewable(card as unknown as Record<string, unknown>, CARD_MASK) === true;
  } catch {
    return false;
  }
}
