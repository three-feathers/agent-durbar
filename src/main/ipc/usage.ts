/** IPC for tool usage (all time) and the credit totals per folder (specs 020, 011; moved out of main.ts as it was, spec 045 FR-060). */
import { ipcHandle } from '../ipcguard';
import type { AgentInfo } from '../../shared/api';
import { folderKeyOf } from '../../shared/usagedoc';
import type { UsageStore } from '../usagestore';
import type { UsageTotalsStore } from '../usagetotalsstore';

export interface UsageIpcDeps {
  agents: Map<string, AgentInfo>;
  /** Created when the app is ready: read when a handler runs. */
  getUsageStore(): UsageStore | undefined;
  getUsageTotalsStore(): UsageTotalsStore | undefined;
  usageLabel(a: AgentInfo): string;
}

export function register(deps: UsageIpcDeps): void {
  const { agents, usageLabel } = deps;
  const usageStore = deps.getUsageStore;
  const usageTotalsStore = deps.getUsageTotalsStore;
  /** What the window needs to show the totals: the saved figures from before this run (it adds this run's own on top). */
  const usageTotalsView = (): unknown => {
    const st = usageTotalsStore();
    if (!st) return { ok: false };
    const b = st.baselineView();
    const folders: unknown[] = [];
    const seen = new Set<string>();
    for (const a of agents.values()) {
      const k = folderKeyOf(a);
      if (seen.has(k)) continue;
      seen.add(k);
      const f = b.folderOf(k);
      if (f) folders.push({ path: k, ...f });
    }
    return { ok: true, since: b.since, office: b.office, folders, error: st.lastError };
  };
  // ---- AI-credit caps (spec 011): numbers only, validated here ----
  ipcHandle('usage:allTime', () => ({
    doc: usageStore()?.view(),
    labels: Object.fromEntries([...agents.values()].map((a) => [a.id, usageLabel(a)])),
    error: usageStore()?.lastError,
  }));
  ipcHandle('usage:totals', () => usageTotalsView());
  ipcHandle('usage:resetTotals', () => {
    usageTotalsStore()?.reset();
    return usageTotalsView();
  });
  ipcHandle('usage:reset', () => {
    usageStore()?.reset();
    return { ok: true, doc: usageStore()?.view() };
  });
}
