import type { AgentInfo } from '../shared/api';
import type { FolderStore } from './folders';

/**
 * Spec 058 (2026-11-14 delta, FR-247): where one chat's switched-off MCP server NAMES are kept across closing the chat and an app restart:
 * the folder store, keyed by the folder (`wsKey`) and the session's resume id (`resumeIdFor`). One helper for main and the test, so the
 * key the test uses is the key main uses. Names only.
 */
export interface SavedMcpOff {
  /** The names saved for this chat under its current resume id. */
  read(a: AgentInfo): string[];
  /** The names saved for this folder under a given resume id (a session about to be resumed: its agent is not in the office yet). */
  readFor(a: AgentInfo, sessionId: string): string[];
  write(a: AgentInfo, names: string[]): void;
}

export function savedMcpOff(store: () => Pick<FolderStore, 'sessionMcpOff' | 'setSessionMcpOff'> | undefined, wsKey: (a: AgentInfo) => string, resumeIdFor: (agentId: string) => string): SavedMcpOff {
  return {
    read: (a) => store()?.sessionMcpOff(wsKey(a), resumeIdFor(a.id)) ?? [],
    readFor: (a, sessionId) => store()?.sessionMcpOff(wsKey(a), sessionId) ?? [],
    write: (a, names) => void store()?.setSessionMcpOff(wsKey(a), resumeIdFor(a.id), names),
  };
}
