/**
 * IPC for the scheduled prompts that were held behind a door before the update (spec 017 FR-031). The rules are in doormigrate.ts
 * (unit-tested); this file checks the frame and the input (run ids as strings, one of two words) and wires main's parts.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { HeldBeforeUpdate } from '../doormigrate';

export interface HeldMigIpcDeps {
  held(): HeldBeforeUpdate | undefined;
  router: AdapterRouter;
  /** The stable key of a session (its resume id), or undefined for an unknown agent id. */
  keyOf(agentId: string): string | undefined;
}

const MAX_IDS = 200;
const okIds = (v: unknown): v is string[] | undefined => v === undefined || (Array.isArray(v) && v.length <= MAX_IDS && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 100));

export function register(deps: HeldMigIpcDeps): void {
  const empty = { items: [], notice: false, damaged: false };
  deps.router.onEvent((e) => deps.held()?.onStatus(e, deps.keyOf));
  ipcHandle('heldmig:list', (e) => (fromApp(e) ? deps.held()?.list() ?? empty : empty));
  ipcHandle('heldmig:noticed', (e) => {
    if (fromApp(e)) deps.held()?.noticed();
    return { ok: true };
  });
  ipcHandle('heldmig:discard', (e, ids: unknown) => (fromApp(e) && okIds(ids) && deps.held() ? { ok: true, discarded: deps.held()?.discard(ids) ?? 0 } : { ok: false, error: 'invalid request' }));
  ipcHandle('heldmig:send', async (e, ids: unknown) => {
    const h = deps.held();
    if (!fromApp(e) || !okIds(ids) || !h) return { ok: false, error: 'invalid request' };
    return { ok: true, ...(await h.send(ids)) };
  });
}
