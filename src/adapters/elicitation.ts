/**
 * MCP elicitation in the question card (spec 012 FR-151), shared by the adapters: parse the vendor's request (message, schema or
 * URL), show it, wait for the user, and return the MCP `{action, content?}`. A request Durbar cannot show (an unsupported
 * required field, a non-https URL) is declined with a reason the user sees. Values are never put in an event or a log line.
 */
import { parseElicitRequest, validateElicitContent, type ElicitAnswer, type ElicitRequest } from '../shared/elicit';
import type { EventBody } from './map';

export interface ElicitWaiter {
  request: ElicitRequest;
  resolve: (a: ElicitAnswer) => void;
}

export interface ElicitInput {
  message?: unknown;
  schema?: unknown;
  mode?: unknown;
  url?: unknown;
  source?: unknown;
}

/** Show the request and wait. `pending` holds the waiter by request id until the user answers, or `cancelElicitations` runs. */
export async function runElicitation(emit: (b: EventBody) => void, pending: Map<string, ElicitWaiter>, requestId: string, input: ElicitInput, debug?: (m: string) => void): Promise<ElicitAnswer> {
  const parsed = parseElicitRequest(input);
  if (!parsed.ok) {
    debug?.(`elicitation declined: ${parsed.reason}`);
    emit({ type: 'status', status: 'working', intent: `Declined an MCP request: ${parsed.reason}` });
    return { action: 'decline' };
  }
  if (parsed.dropped.length) debug?.(`elicitation: optional fields not shown: ${parsed.dropped.join(',')}`);
  const request = parsed.request;
  const answer = await new Promise<ElicitAnswer>((resolve) => {
    pending.set(requestId, { request, resolve });
    emit({ type: 'question', phase: 'asked', requestId, questions: [{ question: request.message, ...(request.source ? { header: request.source.slice(0, 40) } : {}), multiSelect: false, options: [] }], elicitation: request });
    emit({ type: 'status', status: 'needs-permission', intent: 'Waiting for your answer' });
  });
  pending.delete(requestId);
  let out: ElicitAnswer = answer;
  if (answer.action === 'accept' && !request.url) {
    // checked again here (main checked first): a bad answer is never passed on
    const v = validateElicitContent(request.fields ?? [], answer.content ?? {});
    out = v.ok ? { action: 'accept', content: v.content } : { action: 'decline' };
  } else if (answer.action === 'accept') out = { action: 'accept' };
  // a cancel comes from the user or from Stop / End (which set the status themselves): no status here
  if (out.action === 'cancel') emit({ type: 'question', phase: 'cancelled', requestId });
  else {
    emit({ type: 'question', phase: 'answered', requestId, elicitAction: out.action });
    emit({ type: 'status', status: 'working', intent: out.action === 'accept' ? 'Answered' : 'Declined' });
  }
  return out;
}

/** The user's answer (already checked by main); unknown ids are ignored. */
export function answerElicitation(pending: Map<string, ElicitWaiter> | undefined, requestId: string, answer: ElicitAnswer): void {
  pending?.get(requestId)?.resolve(answer);
}

/** Stop, interrupt or end: every open elicitation is cancelled. */
export function cancelElicitations(pending: Map<string, ElicitWaiter> | undefined): void {
  for (const w of [...(pending?.values() ?? [])]) w.resolve({ action: 'cancel' });
}
