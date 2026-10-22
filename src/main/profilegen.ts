/**
 * Spec 043 FR-021..FR-023, FR-026..FR-030: the `profiles:generate` request, apart from Electron so it can be tested with a fake
 * one-shot (`test:profilegen`). It checks the request, asks the one-shot path once, checks the reply and hands back a draft;
 * it never writes a file.
 */
import { PROFILE_NAME } from './profilefiles';
import { buildProfilePrompt, MAX_GEN_ANSWER, MAX_GEN_DESCRIPTION, parseToolList, PROFILE_QUESTIONS, validateGeneratedProfile } from '../shared/profiletemplates';
import type { FrontmatterParse, GenInput } from '../shared/profiletemplates';

export interface OneShot { name: string; generate(prompt: string): Promise<{ text: string; costUsd?: number; nanoAiu?: number }> }
export type GenerateResult =
  | { ok: true; text: string; warnings: string[]; extraTools: string[]; by: string; costUsd?: number; nanoAiu?: number }
  | { ok: false; error: string; costUsd?: number; nanoAiu?: number };

export async function generateProfile(req: unknown, deps: { oneShot(id: string): OneShot | undefined; parse(t: string): FrontmatterParse; errText(e: unknown): string }): Promise<GenerateResult> {
  const r = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>;
  const app = r.app === 'claude' || r.app === 'copilot' ? r.app : undefined;
  if (!app) return { ok: false, error: 'Choose an agent app.' };
  if (typeof r.name !== 'string' || !PROFILE_NAME.test(r.name)) return { ok: false, error: 'Choose a valid name first.' };
  const mode = r.mode === 'questions' ? 'questions' : 'describe';
  const answers: Record<string, string> = {};
  const a = (r.answers && typeof r.answers === 'object' ? r.answers : {}) as Record<string, unknown>;
  // over-long text is refused, not cut (the dialog's maxlength keeps it under; anything longer did not come from the dialog)
  for (const q of PROFILE_QUESTIONS) {
    if (typeof a[q.id] !== 'string') continue;
    if ((a[q.id] as string).length > MAX_GEN_ANSWER) return { ok: false, error: `An answer is longer than ${MAX_GEN_ANSWER} characters.` };
    answers[q.id] = a[q.id] as string;
  }
  if (typeof r.description === 'string' && r.description.length > MAX_GEN_DESCRIPTION) return { ok: false, error: `The description is longer than ${MAX_GEN_DESCRIPTION} characters.` };
  const tl = parseToolList(r.tools);
  if (!tl.ok) return { ok: false, error: tl.error };
  const input: GenInput = { app, name: r.name, mode, description: typeof r.description === 'string' ? r.description : '', answers, tools: tl.tools };
  if (mode === 'describe' && (input.description ?? '').trim().length < 10) return { ok: false, error: 'Describe what the agent does in a sentence or two.' };
  if (mode === 'questions' && !Object.values(answers).some((x) => x.trim())) return { ok: false, error: 'Answer at least one question.' };
  const by = typeof r.by === 'string' ? deps.oneShot(r.by.slice(0, 40)) : undefined;
  if (!by) return { ok: false, error: 'That agent app cannot write a profile here. Pick an installed, signed-in one.' };
  try {
    const g = await by.generate(buildProfilePrompt(input));
    const cost = { ...(g.costUsd ? { costUsd: g.costUsd } : {}), ...(g.nanoAiu ? { nanoAiu: g.nanoAiu } : {}) };
    const v = validateGeneratedProfile(g.text, input, deps.parse);
    return v.ok ? { ok: true, text: v.text, warnings: v.warnings, extraTools: v.extraTools, by: by.name, ...cost } : { ok: false, error: v.error, ...cost };
  } catch (err) {
    return { ok: false, error: deps.errText(err) };
  }
}
