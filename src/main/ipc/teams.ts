/**
 * IPC for the person's team templates (spec 111 T007, FR-010, FR-023, FR-100): window-only channels, each checked with `fromApp(e)`. The window
 * sends a template object or an id, never a path. Every check is in `TeamsIpcOps` (unit tested without Electron). The ops are created when first
 * asked, so a simulator run (which refuses these channels before this code) never opens the profile's store.
 * `teams:markMine` takes the rest arguments only to refuse them: the call can change nothing but that one mark.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { TeamsIpcOps } from '../teamsipc';
import type { TeamOps } from '../teamops';

export interface TeamsIpcDeps {
  getOps(): TeamsIpcOps | undefined;
  /** spec 111 T010: the create preview; undefined under the simulator (its channels are refused before this code) */
  getTeamOps(): TeamOps | undefined;
}

const NO = { ok: false as const, code: 'invalid' as const, errors: ['Team templates are not available.'], blocked: false };
/** Any throw (a store that breaks, a bug) answers one fixed `failed`: no message, no value, no stack (spec 111, review of #1640). */
const FAILED = { ok: false as const, code: 'failed' as const, errors: ['The team templates could not be used.'], blocked: false };
function guard(fn: () => unknown): unknown {
  try { return fn(); } catch { return FAILED; }
}

async function guardAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try { return await fn(); } catch { return FAILED; }
}

export function register(deps: TeamsIpcDeps): void {
  const ops = deps.getOps;
  ipcHandle('teams:list', (e) => (!fromApp(e) ? NO : guard(() => ops()?.list() ?? NO)));
  ipcHandle('teams:put', (e, value: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.put(value) ?? NO)));
  ipcHandle('teams:delete', (e, id: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.delete(id) ?? NO)));
  ipcHandle('teams:duplicate', (e, id: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.duplicate(id) ?? NO)));
  const preview = deps.getTeamOps;
  // spec 111 T010: the create preview. The arguments are checked inside `TeamOps` (shape and size before any copy); a throw answers the fixed `failed`.
  ipcHandle('teams:createPreview', (e, target: unknown, templateId: unknown) => (!fromApp(e) ? NO : guardAsync(async () => (await preview()?.createPreview(target, templateId)) ?? NO)));
  ipcHandle('teams:previewRow', (e, token: unknown, rowId: unknown, change: unknown) => (!fromApp(e) ? NO : guardAsync(async () => (await preview()?.previewRow(token, rowId, change)) ?? NO)));
  // spec 111 T011: creates the not-started members; the token and the choices are checked inside `TeamOps.create` (fixed words); a throw answers `failed`
  ipcHandle('teams:create', (e, token: unknown, choices: unknown) => (!fromApp(e) ? NO : guardAsync(async () => (await preview()?.create(token, choices)) ?? NO)));
  ipcHandle('teams:markMine', (e, templateId: unknown, memberId: unknown, ...extra: unknown[]) => (!fromApp(e) ? NO : guard(() => ops()?.markMine(templateId, memberId, ...extra) ?? NO)));
}
