/**
 * Questions from the agent (spec 012 FR-128): parse a vendor's question list into the normalized shape, and answers back.
 * Pure: no I/O. Text is cut and cleaned here so the renderer and the event log never get unbounded strings.
 */
import { cleanSessionTitle } from './history';
import type { AskedQuestion } from './types';
import { isObj } from '../shared/guards';

/** Why a question ended unanswered (spec 052 FR-178): a code for the event and the debug log, never any text. */
export type SkipReason = 'user' | 'stop' | 'interrupt' | 'reconnect' | 'exit' | 'unreadable';
/** Request id -> the reason noted just before its waiter was resolved with nothing; `take` gives it once ('unreadable' when none was noted). */
export class SkipNotes {
  private readonly m = new Map<string, SkipReason>();
  note(id: string, why: SkipReason): void { this.m.set(id, why); }
  take(id: string): SkipReason { const w = this.m.get(id) ?? 'unreadable'; this.m.delete(id); return w; }
}

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 6;
export const MAX_ANSWER = 500;
/** Spec 052 FR-160: the card shows all of it; these only bound the event log and the renderer, far above what agents send. */
export const MAX_QUESTION_TEXT = 2000;
export const MAX_OPTION_LABEL = 300;
export const MAX_OPTION_DESCRIPTION = 1000;

const line = (v: unknown, max: number): string | undefined => cleanSessionTitle(v, max);

/** `AskUserQuestion`'s input (`questions[]` with `question`, `header`, `options[]`, `multiSelect`) to the normalized list; [] when unusable. */
export function parseQuestions(input: unknown): AskedQuestion[] {
  return parseQuestionsWithOriginals(input).asked;
}

/** The same, plus each kept question's original text (the vendor expects its answers keyed by it). */
export function parseQuestionsWithOriginals(input: unknown): { asked: AskedQuestion[]; originals: string[] } {
  const qs = isObj(input) && Array.isArray(input.questions) ? input.questions : [];
  const out: AskedQuestion[] = [];
  const originals: string[] = [];
  for (const q of qs.slice(0, 50)) {
    if (out.length >= MAX_QUESTIONS) break;
    if (!isObj(q)) continue;
    const question = line(q.question, MAX_QUESTION_TEXT);
    if (!question) continue;
    const options = (Array.isArray(q.options) ? q.options : [])
      .slice(0, MAX_OPTIONS)
      .filter(isObj)
      .map((o) => ({ label: line(o.label, MAX_OPTION_LABEL), description: line(o.description, MAX_OPTION_DESCRIPTION) }))
      .filter((o): o is { label: string; description: string | undefined } => !!o.label)
      .map((o) => (o.description ? { label: o.label, description: o.description } : { label: o.label }));
    const header = line(q.header, 40);
    out.push({ question, ...(header ? { header } : {}), multiSelect: q.multiSelect === true, options });
    originals.push(String(q.question));
  }
  return { asked: out, originals };
}

/**
 * The window's answer as main takes it (spec 052 FR-178): strings only, at most MAX_QUESTIONS entries, a key (the question's text) up to
 * MAX_QUESTION_TEXT and a value up to MAX_ANSWER. `null` is a skip. `undefined` = nothing usable, which main refuses; it must never read as a skip.
 */
export function readAnswerPayload(answers: unknown): Record<string, string> | null | undefined {
  if (answers === null) return null;
  if (!isObj(answers)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers).slice(0, MAX_QUESTIONS)) if (typeof v === 'string' && k.length <= MAX_QUESTION_TEXT) out[k] = v.slice(0, MAX_ANSWER);
  return Object.keys(out).length ? out : undefined;
}

/** The user's answers, kept only for the questions asked, each one line of at most 500 characters; undefined when none is left. */
export function cleanAnswers(asked: readonly AskedQuestion[], answers: unknown): Record<string, string> | undefined {
  if (!isObj(answers)) return undefined;
  const out: Record<string, string> = {};
  for (const q of asked) {
    const a = answers[q.question];
    const v = typeof a === 'string' ? a.replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER) : '';
    if (v) out[q.question] = v;
  }
  // spec 052 FR-178: one question asked and one answer given, but under a key that is not the question's text (any difference in how the two
  // sides cleaned it): it is still that question's answer. Never a skip.
  if (!Object.keys(out).length && asked.length === 1) {
    const only = Object.values(answers).filter((a): a is string => typeof a === 'string' && !!a.trim());
    if (only.length === 1) out[asked[0].question] = only[0].replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER);
  }
  return Object.keys(out).length ? out : undefined;
}
