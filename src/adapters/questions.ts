/**
 * Questions from the agent (spec 012 FR-128): parse a vendor's question list into the normalized shape, and answers back.
 * Pure: no I/O. Text is cut and cleaned here so the renderer and the event log never get unbounded strings.
 */
import { cleanSessionTitle } from './history';
import type { AskedQuestion } from './types';

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 6;
export const MAX_ANSWER = 500;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
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
    const question = line(q.question, 300);
    if (!question) continue;
    const options = (Array.isArray(q.options) ? q.options : [])
      .slice(0, MAX_OPTIONS)
      .filter(isObj)
      .map((o) => ({ label: line(o.label, 80), description: line(o.description, 200) }))
      .filter((o): o is { label: string; description: string | undefined } => !!o.label)
      .map((o) => (o.description ? { label: o.label, description: o.description } : { label: o.label }));
    const header = line(q.header, 40);
    out.push({ question, ...(header ? { header } : {}), multiSelect: q.multiSelect === true, options });
    originals.push(String(q.question));
  }
  return { asked: out, originals };
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
  return Object.keys(out).length ? out : undefined;
}
