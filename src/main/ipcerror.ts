/**
 * Spec 045 FR-066 (issue #1682, review of #1980; changed 2026-11-23 by the owner's decision, issue #2060 item 1): the one place that turns a
 * caught error into text for the window. Any `Error` (a `ShownError`, `src/shared/shownerror.ts`, or a file system, network or library error)
 * gives its own message through `shownText`: the shared secret mask `redact` (FR-031: reused), no stack frames, no path of the app's own code,
 * one plain line, at most `SHOWN_MAX` characters. Paths are shown as written. A value that is not an `Error`, an empty message, or a mask that
 * fails gives the fixed text (`IPC_FAILED`, or the caller's own fixed fallback). The real error is logged in main as one line through `redact`
 * (the masked log line, spec 012 FR-080). Used by `answer` in `ipcguard.ts` for a throw, and by every handler that catches and returns
 * `{ ok: false, error }`. No Electron here, so the ops modules and their unit tests can use it. `test:ipcthrow` fails if a caught error's own
 * text is used elsewhere.
 */
import * as path from 'path';
import { cut, redact, unhide } from '../shared/redact';

/** What the window gets when an error has no message that can be shown (see the file comment). Fixed: nothing of the thrown value. */
export const IPC_FAILED = 'Agent Durbar could not do that: something unexpected went wrong. The details stay in its own log.';

/** How much of a message is read, and how much is shown (FR-066 as changed 2026-11-23). */
const READ_MAX = 20_000;
export const SHOWN_MAX = 400;
const FAILED = '[redaction failed]';
/** A stack frame line (`    at fn (file:1:2)`, `    at file:1:2`, `    at new X (<anonymous>)`, `    at async Promise.all (index 0)`). */
const FRAME = /^[ \t]+at [^\n]*(?::\d+:\d+\)?|\((?:native|<anonymous>|index \d+)\))[ \t\r]*$/gm;
/** The folder the app's own code is installed in (dist/main/../..: the repository in development, `app.asar` when installed). */
const APP_DIRS = [path.resolve(__dirname, '..', '..'), (process as { resourcesPath?: string }).resourcesPath].filter((d): d is string => typeof d === 'string' && d.length > 3);
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const APP_DIR_RE = new RegExp(APP_DIRS.map((d) => escRe(d).replace(/\\\\|\//g, '[\\\\/]')).join('|') || '(?!)', process.platform === 'linux' ? 'g' : 'gi');
const cutText = (s: string, max: number): string => cut(s, max).replace(/ \[truncated\]$/, '');

/** An error message made safe for the screen (see the file comment), or undefined when there is none or the mask failed. */
export function shownText(message: unknown): string | undefined {
  if (typeof message !== 'string' || !message.trim()) return undefined;
  const read = message.length > READ_MAX ? cutText(message, READ_MAX) : message;
  let s = redact(read.replace(FRAME, '').replace(APP_DIR_RE, '[app folder]'));
  if (s.includes(FAILED)) return undefined;
  s = redact(unhide(s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')).replace(/\s+/g, ' ').trim());
  if (!s || s.includes(FAILED)) return undefined;
  if (s.length <= SHOWN_MAX && read === message) return s;
  const head = cutText(s, SHOWN_MAX);
  return `${head}… ${s.length - head.length + message.length - read.length} more characters`;
}

/** The window's text for a caught error (see the file comment). `where` names the place in main's log line; `fallback` is fixed text. */
export function failText(err: unknown, where: string, fallback: string = IPC_FAILED): string {
  let detail: string;
  try { detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : `a thrown ${err === null ? 'null' : typeof err}: ${String(err)}`; } catch { detail = 'a thrown value that cannot be read'; }
  console.warn(redact(`[ipc] ${where} failed: ${detail}`));
  let msg: unknown;
  try { msg = err instanceof Error ? err.message : undefined; } catch { msg = undefined; }
  return shownText(msg) ?? fallback;
}
