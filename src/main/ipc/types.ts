/** Function types that main.ts hands to several IPC modules (spec 045 FR-060). Types only: nothing is registered here. */
import type { AgentAdapter } from '../../adapters/types';
import type { AgentInfo, PermMode, PickedFile } from '../../shared/api';

export type AddWorkspaceOpts = { resumeSessionId?: string; silent?: boolean; model?: string; effort?: string; persist?: boolean; maxAiCredits?: number | null; floor?: string; adapterId?: string; readyIds?: ReadonlySet<string> };
export type AddWorkspace = (workspace: string, permMode: PermMode, opts?: AddWorkspaceOpts) => Promise<AgentInfo>;
/** Make sure the agent has a live runtime session (resume it by id when it has history, else start one under that id). */
export type EnsureLive = (a: AgentInfo, opts?: { quiet?: boolean }) => Promise<void>;
export type SendOp = (id: string, text: string, attachments: PickedFile[], ad: AgentAdapter, plan?: boolean) => Promise<{ ok: boolean; error?: string; slash?: string; slashNote?: string }>;
