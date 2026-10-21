/**
 * Spec 066 (plan first): shared helpers for the adapters' plan-mode flows. Pure.
 */
import type { PlanAnswer } from './types';

/** A plan's text as one string the window can show: control characters removed (not tabs or newlines), at most 20,000 characters. */
export function cleanPlanText(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 20_000);
}

/** The feedback of a `revise` answer, as the agent app should read it. */
export function reviseText(answer: PlanAnswer): string {
  return answer.kind === 'revise' ? `Please revise the plan: ${answer.feedback}` : '';
}

/** Spec 066 FR-004: what Claude Code is told when the user rejects or revises its plan (the tool call is denied with this). */
export const PLAN_REJECTED = 'The user rejected the plan. Do not make any changes; stop and wait for their next message.';
