import type { AgentEvent } from '../adapters/types';

/** Permission policy chosen when adding a folder. */
export type PermMode = 'read-only' | 'ask' | 'allow';

export interface AgentInfo {
  /** Session id. */
  id: string;
  name: string;
  cwd: string;
  /** Set when the agent was added from a .code-workspace file. */
  workspaceFile?: string;
  folders: string[];
  permMode: PermMode;
  model?: string;
}

export interface PickedFile {
  path: string;
  name: string;
  kind: 'file' | 'image';
}

export interface AddResult {
  ok: boolean;
  agents: AgentInfo[];
  error?: string;
}

/** Bridge exposed by the preload script as `window.agentDurbar`. */
export interface DurbarApi {
  version(): Promise<string>;
  addFolder(permMode: PermMode): Promise<AddResult>;
  addWorkspaceFile(permMode: PermMode): Promise<AddResult>;
  /** Agents already running in main (survives renderer reloads) and startup paths. */
  listAgents(): Promise<AgentInfo[]>;
  pickAttachments(): Promise<PickedFile[]>;
  send(id: string, text: string, attachments: PickedFile[]): Promise<{ ok: boolean; error?: string }>;
  stop(id: string): Promise<void>;
  /** `remember` = "Approve for this session" (ignored when denying). */
  resolvePermission(id: string, requestId: string, approve: boolean, remember?: boolean): Promise<void>;
  /** Forget one "Approve for this session" grant (key from the `grants` event). */
  revokeGrant(id: string, key: string): Promise<void>;
  openInVSCode(id: string): Promise<{ ok: boolean; error?: string }>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAgentAdded(cb: (a: AgentInfo) => void): () => void;
}
