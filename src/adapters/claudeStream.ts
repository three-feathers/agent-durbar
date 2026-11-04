/**
 * Spec 095 FR-024: the conversation search's read of an earlier Claude Code session. Async and streamed, line by line: `fs.promises.stat`
 * against the 50 MB cap, then `createReadStream` + `readline`, each line handed to the same per-line parser as `claudeHistoryFromText`
 * (`claudeHistoryBuilder`), side-chain lines skipped. So a large file is never held whole, and the main loop is never blocked by a
 * synchronous read. Read-only: nothing is written, copied or sent. `[KNOWN GAP]` one line is still held whole by `readline` (a file of
 * one 40 MB line would be).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ID_RE, MAX_FILE_BYTES, claudeConfigDir, claudeHistoryBuilder, claudeProjectSlug } from './claudeHistory';
import type { HistoryLimits, HistoryResult } from './history';

export type ClaudeStreamResult = { ok: true; history: HistoryResult } | { ok: false; reason: 'too-large' | 'missing' | 'unreadable' };

export interface ClaudeStreamOptions {
  /** Read only up to here; checked between lines (a cancelled scan stops reading). */
  stop?: () => boolean;
  /** Tests: another size cap. */
  maxBytes?: number;
}

/** The text history of one earlier session of `cwd` (the folder is always known: earlier sessions are listed per folder). */
export async function readClaudeHistoryStream(sessionId: string, cwd: string, limits: Partial<HistoryLimits> = {}, configDir = claudeConfigDir(), o: ClaudeStreamOptions = {}): Promise<ClaudeStreamResult> {
  if (typeof sessionId !== 'string' || !ID_RE.test(sessionId) || typeof cwd !== 'string' || !cwd) return { ok: false, reason: 'missing' };
  const file = path.join(configDir, 'projects', claudeProjectSlug(cwd), `${sessionId}.jsonl`);
  let size: number;
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) return { ok: false, reason: 'unreadable' };
    size = st.size;
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (size > (o.maxBytes ?? MAX_FILE_BYTES)) return { ok: false, reason: 'too-large' };
  const b = claudeHistoryBuilder(limits);
  if (size === 0) return { ok: true, history: b.result() };
  // `end` is the size seen by stat: a file that grows while it is read is read only up to there (the cap holds)
  const input = fs.createReadStream(file, { encoding: 'utf8', start: 0, end: size - 1 });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (o.stop?.()) break;
      b.line(line);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    rl.close();
    input.destroy();
  }
  return { ok: true, history: b.result() };
}
