/** IPC for spec 005 FR-411 (issue #2060 item 4): Copy on a tool chip; main writes the real argument text to the clipboard and answers a result word, never the text. */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { ToolArgCopies, ToolCopyResult } from '../toolargcopy';

export interface ToolCopyIpcDeps {
  copies: ToolArgCopies;
}

export function register(deps: ToolCopyIpcDeps): void {
  ipcHandle('agents:copyToolArg', (e, sessionId: unknown, callId: unknown, confirmed: unknown): ToolCopyResult => {
    if (!fromApp(e)) return { ok: false, reason: 'unknown' };
    return deps.copies.copy(sessionId, callId, confirmed === true);
  });
}
