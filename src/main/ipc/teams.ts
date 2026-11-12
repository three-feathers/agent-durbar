/**
 * IPC for the person's team templates (spec 111 T007, FR-010, FR-023, FR-100): window-only channels, each checked with `fromApp(e)`. The window
 * sends a template object or an id, never a path. Every check is in `TeamsOps` (unit tested without Electron). The ops are created when first
 * asked, so a simulator run (which refuses these channels before this code) never opens the profile's store.
 * `teams:markMine` takes the rest arguments only to refuse them: the call can change nothing but that one mark.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { TeamsOps } from '../teamsops';

export interface TeamsIpcDeps {
  getOps(): TeamsOps | undefined;
}

const NO = { ok: false as const, code: 'invalid' as const, errors: ['Team templates are not available.'], blocked: false };

export function register(deps: TeamsIpcDeps): void {
  const ops = deps.getOps;
  ipcHandle('teams:list', (e) => (!fromApp(e) ? NO : ops()?.list() ?? NO));
  ipcHandle('teams:put', (e, value: unknown) => (!fromApp(e) ? NO : ops()?.put(value) ?? NO));
  ipcHandle('teams:delete', (e, id: unknown) => (!fromApp(e) ? NO : ops()?.delete(id) ?? NO));
  ipcHandle('teams:duplicate', (e, id: unknown) => (!fromApp(e) ? NO : ops()?.duplicate(id) ?? NO));
  ipcHandle('teams:markMine', (e, templateId: unknown, memberId: unknown, ...extra: unknown[]) => (!fromApp(e) ? NO : ops()?.markMine(templateId, memberId, ...extra) ?? NO));
}
