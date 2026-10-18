/** Pure mapping from an agent's saved choices to the adapter's `StartOptions` (no Electron, testable). The permission mode goes as `permissionMode` only (spec 012 FR-028). */
import type { ContextTier } from '../shared/modelswitch';
import type { PermissionMode, StartOptions } from '../adapters/types';

export interface StartSource {
  permMode: PermissionMode;
  model?: string;
  tier?: ContextTier;
  maxAiCredits?: number;
}

export function startOptionsOf(a: StartSource, workspace: string, defaultModel: string, reasoningEffort: StartOptions['reasoningEffort']): StartOptions {
  const model = a.model ?? defaultModel;
  return {
    workspace,
    model,
    reasoningEffort,
    // The saved choice goes on create AND resume (spec 030 FR-013); the adapter only uses `autoTier` for a NEW `auto` session.
    contextTier: a.tier,
    autoTier: model === 'auto' ? 'efficiency' : undefined,
    permissionMode: a.permMode,
    maxAiCredits: a.maxAiCredits,
  };
}
