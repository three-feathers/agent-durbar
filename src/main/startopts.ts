/** Pure mapping from an agent's saved choices to the adapter's `StartOptions` (no Electron, testable). The permission mode goes as `permissionMode` only (spec 012 FR-028). */
import type { AutoTier, ContextTier } from '../shared/modelswitch';
import type { PermissionMode, StartOptions } from '../adapters/types';

export interface StartSource {
  permMode: PermissionMode;
  model?: string;
  tier?: ContextTier;
  /** Spec 007 FR-016: the Auto tier the user chose for this agent; absent = none chosen. */
  autoTier?: AutoTier;
  maxAiCredits?: number;
}

export function startOptionsOf(a: StartSource, workspace: string, defaultModel: string, reasoningEffort: StartOptions['reasoningEffort']): StartOptions {
  const model = a.model ?? defaultModel;
  return {
    workspace,
    model,
    reasoningEffort,
    // The saved choice goes on create AND resume (spec 030 FR-013). The Auto tier only when the user chose one (spec 007 FR-016): otherwise
    // the adapter picks its default for a NEW `auto` session (Copilot: `efficiency`, or the organization's tier) and nothing on resume.
    contextTier: a.tier,
    autoTier: model === 'auto' ? a.autoTier : undefined,
    permissionMode: a.permMode,
    maxAiCredits: a.maxAiCredits,
  };
}
