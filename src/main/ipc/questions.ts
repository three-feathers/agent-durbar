/** IPC for an agent's questions: a plain question, an MCP elicitation and its https page (spec 012 FR-128, FR-151, spec 066 FR-007 plan answer; moved out of main.ts as it was, spec 045 FR-060). */
import { shell } from 'electron';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import { answerQuestionOp, errText } from '../agentops';
import { checkElicitAnswer, elicitHttpsUrl } from '../../shared/elicit';
import type { createElicitTracker } from '../../shared/elicit';

export interface QuestionsIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  /** Open MCP elicitations: main checks each answer against the fields it was asked with. */
  elicitTracker: ReturnType<typeof createElicitTracker>;
}

export function register(deps: QuestionsIpcDeps): void {
  const { agents, router, elicitTracker } = deps;
  // spec 012 FR-128: the user's answer to an agent's question (the body is `answerQuestionOp`, testable without Electron)
  ipcHandle('agents:answerQuestion', (_e, id: unknown, requestId: unknown, answers: unknown) => {
    return answerQuestionOp({ agents, router }, id, requestId, answers);
  });

  // spec 012 FR-151: the answer to an MCP elicitation, checked here against the open request (types, choices, lengths, required).
  // The values are never logged: they can be secrets.
  ipcHandle('agents:answerElicitation', (_e, id: unknown, requestId: unknown, action: unknown, values: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    const req = a && typeof requestId === 'string' && requestId.length <= 300 ? elicitTracker.get(a.id, requestId) : undefined;
    if (!a || !ad?.answerElicitation || !req) return { ok: false, error: 'That request is no longer open.' };
    const r = checkElicitAnswer(req, action, values);
    if (!r.ok) return { ok: false, error: r.error, ...(r.field ? { field: r.field } : {}) };
    ad.answerElicitation(a.id, requestId as string, r.answer);
    return { ok: true };
  });
  // spec 012 FR-151: open the request's own https address (never one sent by the window), only after the user clicked
  ipcHandle('agents:openElicitationUrl', async (_e, id: unknown, requestId: unknown) => {
    const req = typeof id === 'string' && typeof requestId === 'string' && requestId.length <= 300 ? elicitTracker.get(id, requestId) : undefined;
    const u = req?.url ? elicitHttpsUrl(req.url) : undefined;
    if (!u) return { ok: false, error: 'That request has no https page to open.' };
    await shell.openExternal(u.url);
    return { ok: true };
  });
  // spec 066 FR-007: a proposed plan is answered only from Durbar's own window (never MCP, remote control or schedules)
  ipcHandle('agents:resolvePlan', async (e, id: unknown, requestId: unknown, answer: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad || !ad.resolvePlan || typeof requestId !== 'string' || !requestId || requestId.length > 200) return { ok: false, error: 'unknown plan' };
    const x = (answer && typeof answer === 'object' ? answer : {}) as { kind?: unknown; feedback?: unknown };
    const fb = typeof x.feedback === 'string' ? x.feedback.replace(/\u0000/g, '').trim().slice(0, 4000) : '';
    const parsed = x.kind === 'approve' ? { kind: 'approve' as const } : x.kind === 'reject' ? { kind: 'reject' as const } : x.kind === 'revise' && fb ? { kind: 'revise' as const, feedback: fb } : undefined;
    if (!parsed) return { ok: false, error: 'Invalid answer.' };
    try {
      await ad.resolvePlan(a.id, requestId, parsed);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
  });
}
