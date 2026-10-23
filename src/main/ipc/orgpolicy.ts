/** IPC for the agent apps' own organization policies (spec 076 FR-207, issue #602): a values-free view per app for the window. */
import { ipcHandle } from '../ipcguard';
import type { OrgPolicyAppView } from '../../shared/orgpolicy';

export interface OrgPolicyIpcDeps {
  view(): Promise<Record<string, OrgPolicyAppView>>;
}

export function register(deps: OrgPolicyIpcDeps): void {
  ipcHandle('orgpolicy:view', (): Promise<Record<string, OrgPolicyAppView>> => deps.view());
}
