/**
 * IPC for the person's team templates (spec 111 T007, FR-010, FR-023, FR-100): window-only channels, each checked with `fromApp(e)`. The window
 * sends a template object or an id, never a path. Every check is in `TeamsIpcOps` (unit tested without Electron). The ops are created when first
 * asked, so a simulator run (which refuses these channels before this code) never opens the profile's store.
 * `teams:markMine` takes the rest arguments only to refuse them: the call can change nothing but that one mark.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { TeamsIpcOps } from '../teamsipc';

export interface TeamsIpcDeps {
  getOps(): TeamsIpcOps | undefined;
}

const NO = { ok: false as const, code: 'invalid' as const, errors: ['Team templates are not available.'], blocked: false };
/** Any throw (a store that breaks, a bug) answers one fixed `failed`: no message, no value, no stack (spec 111, review of #1640). */
const FAILED = { ok: false as const, code: 'failed' as const, errors: ['The team templates could not be used.'], blocked: false };
function guard(fn: () => unknown): unknown {
  try { return fn(); } catch { return FAILED; }
}

export function register(deps: TeamsIpcDeps): void {
  const ops = deps.getOps;
  ipcHandle('teams:list', (e) => (!fromApp(e) ? NO : guard(() => ops()?.list() ?? NO)));
  ipcHandle('teams:put', (e, value: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.put(value) ?? NO)));
  ipcHandle('teams:delete', (e, id: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.delete(id) ?? NO)));
  ipcHandle('teams:duplicate', (e, id: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.duplicate(id) ?? NO)));
  ipcHandle('teams:markMine', (e, templateId: unknown, memberId: unknown, ...extra: unknown[]) => (!fromApp(e) ? NO : guard(() => ops()?.markMine(templateId, memberId, ...extra) ?? NO)));
}
