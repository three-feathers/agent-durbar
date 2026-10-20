/**
 * Hand-off summary for a new session (spec 030 FR-034, FR-035). Pure: the fixed prompt and the cleanup, shared by the
 * adapters that ask their runtime for a summary. The summary is user content: shown for editing, never logged.
 */

/** What every harness is asked (Claude and Codex as a prompt on a fork; Copilot has its own summarizer). */
export const HANDOFF_PROMPT = [
  'Write a hand-off summary of this conversation so that a new session can continue the work without it.',
  'Use short markdown with these parts: Goal; What was done; Open items; Important files and decisions; Next step.',
  // spec 030 FR-043 (#409): the next session may run in another agent app, which knows neither this app's tools nor its paths
  'Name files by their paths relative to the project folder, and describe actions in plain words, not by tool names: the next session may use a different agent app.',
  'At most about 300 words. Do not use any tools. Do not include secrets, tokens or passwords. Reply with the summary only.',
].join(' ');

export const HANDOFF_MAX_CHARS = 8000;

export interface HandoffResult {
  /** Markdown, trimmed and at most HANDOFF_MAX_CHARS; empty means "no summary". */
  summary: string;
  /** The vendor's dollar estimate for making it, when reported (Claude). */
  costUsd?: number;
}

/** Trim, drop a wrapping code fence, cut at the limit (on a line break when one is near). */
export function cleanSummary(text: unknown): string {
  if (typeof text !== 'string') return '';
  let t = text.replace(/\r\n/g, '\n').trim();
  const fence = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(t);
  if (fence) t = fence[1].trim();
  if (t.length <= HANDOFF_MAX_CHARS) return t;
  const cut = t.slice(0, HANDOFF_MAX_CHARS);
  const nl = cut.lastIndexOf('\n');
  return (nl > HANDOFF_MAX_CHARS * 0.8 ? cut.slice(0, nl) : cut).trimEnd() + '\n…';
}
