/**
 * Spec 045 FR-066 (issue #1682, review of #1980): the one place that turns a caught error into text for the window. A `ShownError` (words
 * Agent Durbar wrote for the person, `src/shared/shownerror.ts`) keeps its message, masked with `redact` and `maskHomePaths` (a runtime's
 * reason inside it may name a file under the home folder); any other value gives a fixed text
 * (`IPC_FAILED`, or the caller's own fixed fallback), and the real error is logged in main as one line through `redact` (the masked log line,
 * spec 012 FR-080). Used by `answer` in `ipcguard.ts` for a throw, and by every handler that catches and returns `{ ok: false, error }`.
 * No Electron here, so the ops modules and their unit tests can use it. `test:ipcthrow` fails if a caught error's own text is used elsewhere.
 */
import { maskHomePaths, redact } from '../shared/redact';
import { ShownError } from '../shared/shownerror';

/** What the window gets for any error that is not a `ShownError`. Fixed: nothing of the thrown value. */
export const IPC_FAILED = 'Agent Durbar could not do that: something unexpected went wrong. The details stay in its own log.';

/** The window's text for a caught error (see the file comment). `where` names the place in main's log line; `fallback` is fixed text. */
export function failText(err: unknown, where: string, fallback: string = IPC_FAILED): string {
  let detail: string;
  try { detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : `a thrown ${err === null ? 'null' : typeof err}: ${String(err)}`; } catch { detail = 'a thrown value that cannot be read'; }
  console.warn(redact(`[ipc] ${where} failed: ${detail}`));
  return err instanceof ShownError ? maskHomePaths(redact(err.message)) : fallback;
}
